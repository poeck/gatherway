package com.gatherway.companion

import android.Manifest
import android.app.Service
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertisingSet
import android.bluetooth.le.AdvertisingSetCallback
import android.bluetooth.le.AdvertisingSetParameters
import android.bluetooth.le.AdvertiseData
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.IBinder
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class CompanionService : Service() {
  companion object {
    @Volatile var running = false
    @Volatile var advertising = false
    @Volatile var connection = "Stopped"
    @Volatile var working = false
    @Volatile var lastExchange = 0L
    @Volatile var lastExchangeElapsed = 0L
    @Volatile var dashboard: String? = null
    @Volatile var pendingCommand: String? = null
    @Volatile var commandMessage: String? = null
    @Synchronized fun requestMove(destination: String) {
      require(destination in listOf("available", "brief", "away")) { "Unknown destination" }
      require(running && working && android.os.SystemClock.elapsedRealtime() - lastExchangeElapsed < 10000) { "Connect to your laptop first" }
      require(pendingCommand == null) { "A request is already pending" }
      val current = JSONObject(requireNotNull(dashboard) { "Update and restart the desktop client first" })
      val moves = current.getJSONObject("moves")
      require(moves.has(destination) && moves.isNull(destination)) { moves.optString(destination, "Movement unavailable") }
      require(current.optJSONObject("command")?.optString("status") != "moving") { "Movement is already in progress" }
      pendingCommand = JSONObject().put("id", java.util.UUID.randomUUID().toString()).put("session", current.getString("session")).put("destination", destination).put("createdAt", System.currentTimeMillis()).toString()
      commandMessage = "Sending movement request…"
    }
    fun wifi(context: Context): Pair<String, String?> {
      if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return "unknown" to null
      val manager = context.applicationContext.getSystemService(WifiManager::class.java)
      if (!manager.isWifiEnabled) return "unknown" to null
      val connectivity = context.getSystemService(ConnectivityManager::class.java)
      val connected = connectivity.allNetworks.any { network -> connectivity.getNetworkCapabilities(network)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true }
      if (!connected) return "away" to null
      @Suppress("DEPRECATION") val ssid = manager.connectionInfo?.ssid?.removeSurrounding("\"")
      if (ssid.isNullOrBlank() || ssid == "<unknown ssid>" || ssid == "0x") return "unknown" to null
      // Onboarding needs the current SSID before pairing has been saved.
      val home = NativeStore.prefs(context).getString("profileHomeWifi", null) ?: NativeStore.config(context)?.optString("homeWifi")
      return (if (home.isNullOrBlank()) "unknown" else if (ssid == home) "home" else "away") to ssid
    }
  }
  private val executor = Executors.newSingleThreadScheduledExecutor()
  private val bluetoothHandler = Handler(Looper.getMainLooper())
  private val advertisingTimeout = Runnable { advertisingFailed("BLE update timed out; retrying") }
  private var beaconSequence = 0
  @Volatile private var callback: AdvertisingSetCallback? = null
  private var advertiser: android.bluetooth.le.BluetoothLeAdvertiser? = null
  override fun onBind(intent: Intent?): IBinder? = null
  override fun onCreate() {
    super.onCreate()
    if (!NativeStore.prefs(this).getBoolean("enabled", false)) { stopSelf(); return }
    Alerts.channels(this)
    try { startForeground(1001, NotificationCompat.Builder(this, Alerts.SERVICE_CHANNEL).setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle("Gatherway companion").setContentText("Connecting to your laptop").setOngoing(true).setContentIntent(Alerts.openApp(this)).build()) }
    catch (_: Exception) { connection = "Open the app and check service permissions"; stopSelf(); return }
    running = true
    executor.scheduleWithFixedDelay({ runCatching { exchange() }.onFailure { connection = "Laptop unreachable"; if (System.currentTimeMillis() - lastExchange > 10000) { working = false; stopAdvertising(); Alerts.cancelAll(this) } } }, 0, 2, TimeUnit.SECONDS)
  }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY
  private fun startAdvertising() {
    if (Looper.myLooper() != Looper.getMainLooper()) { bluetoothHandler.post { startAdvertising() }; return }
    if (!running || !working) return
    if (advertising) return
    if (checkSelfPermission(Manifest.permission.BLUETOOTH_ADVERTISE) != PackageManager.PERMISSION_GRANTED || checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) return
    val adapter = getSystemService(BluetoothManager::class.java).adapter ?: return
    if (!adapter.isEnabled) return
    val beacon = NativeStore.config(this)?.optString("beacon") ?: return
    advertiser = adapter.bluetoothLeAdvertiser ?: return
    if (callback != null) return
    val uuid = ParcelUuid.fromString(beacon)
    callback = object : AdvertisingSetCallback() {
      override fun onAdvertisingSetStarted(set: AdvertisingSet?, txPower: Int, status: Int) {
        if (callback !== this) { runCatching { advertiser?.stopAdvertisingSet(this) }; return }
        bluetoothHandler.removeCallbacks(advertisingTimeout)
        if (status != ADVERTISE_SUCCESS || set == null) { advertisingFailed("BLE advertising failed ($status)"); return }
        advertising = true
        scheduleHeartbeat(set, uuid, this)
      }
      override fun onAdvertisingDataSet(set: AdvertisingSet?, status: Int) {
        if (callback !== this) return
        bluetoothHandler.removeCallbacks(advertisingTimeout)
        if (status != ADVERTISE_SUCCESS || set == null) { advertisingFailed("BLE update failed ($status)"); return }
        scheduleHeartbeat(set, uuid, this)
      }
      override fun onAdvertisingSetStopped(set: AdvertisingSet?) { if (callback === this) stopAdvertising() }
    }
    // Repeat every 250 ms to intersect the laptop's receive windows. The payload
    // changes every two seconds; reception cadence still needs device validation.
    val settings = AdvertisingSetParameters.Builder().setLegacyMode(true).setScannable(false).setConnectable(false).setInterval(400).setTxPowerLevel(AdvertisingSetParameters.TX_POWER_MEDIUM).build()
    bluetoothHandler.postDelayed(advertisingTimeout, 10000)
    runCatching { advertiser?.startAdvertisingSet(settings, beaconData(uuid), null, null, null, callback) }
      .onFailure { advertisingFailed("BLE advertising unavailable; check Bluetooth permissions") }
  }
  private fun beaconData(uuid: ParcelUuid): AdvertiseData {
    beaconSequence = (beaconSequence + 1) and 0xffff
    // Keep identity and a changing heartbeat in the primary packet (21 bytes).
    // No scan response is needed, and unchanged packets cannot mask every update.
    return AdvertiseData.Builder().addServiceData(uuid, byteArrayOf(1, beaconSequence.toByte(), (beaconSequence ushr 8).toByte())).build()
  }
  private fun scheduleHeartbeat(set: AdvertisingSet, uuid: ParcelUuid, owner: AdvertisingSetCallback) {
    // Run independently of HTTP exchanges; allow only one outstanding data update.
    bluetoothHandler.postDelayed({
      if (callback === owner && running && working && advertising) {
        bluetoothHandler.postDelayed(advertisingTimeout, 8000)
        runCatching { set.setAdvertisingData(beaconData(uuid)) }
          .onFailure { advertisingFailed("BLE update unavailable; check Bluetooth permissions") }
      }
    }, 2000)
  }
  private fun advertisingFailed(message: String) { stopAdvertising(); connection = message }
  private fun stopAdvertising() {
    if (Looper.myLooper() != Looper.getMainLooper()) { bluetoothHandler.post { stopAdvertising() }; return }
    bluetoothHandler.removeCallbacksAndMessages(null)
    val previous = callback; callback = null; advertising = false
    runCatching { previous?.let { advertiser?.stopAdvertisingSet(it) } }
  }
  private fun exchange() {
    val config = NativeStore.config(this) ?: return
    if (working) startAdvertising() else stopAdvertising()
    val prefs = NativeStore.prefs(this)
    val acks = synchronized(Alerts) { prefs.getStringSet("acks", emptySet())!!.toSet() }
    val wifiState = wifi(this)
    val body = JSONObject().put("wifi", wifiState.first).put("wifiTelemetryVersion", 1).put("wifiSsid", wifiState.second ?: JSONObject.NULL).put("bluetooth", advertising).put("serviceRunning", running).put("acks", JSONArray(acks.toList())).put("fcmToken", prefs.getString("fcmToken", null))
    synchronized(CompanionService) {
      pendingCommand?.let { raw ->
        val command = JSONObject(raw)
        if (System.currentTimeMillis() - command.getLong("createdAt") > 15000) { pendingCommand = null; commandMessage = "Request timed out; check your position before trying again." }
        else body.put("command", command)
      }
    }
    val message = Wire.packet("exchange", body)
    val endpoint = config.getString("endpoint"); NativeStore.validateEndpoint(endpoint)
    val connection = URI(endpoint.trimEnd('/') + "/v1/exchange").toURL().openConnection() as HttpURLConnection
    connection.requestMethod = "POST"; connection.connectTimeout = 4000; connection.readTimeout = 4000; connection.instanceFollowRedirects = false
    connection.doOutput = true; connection.setRequestProperty("Content-Type", "application/json")
    try {
      connection.outputStream.use { it.write(Wire.seal(config.getString("key"), message).toString().toByteArray(Charsets.UTF_8)) }
      require(connection.responseCode == 200)
      val bytes = connection.inputStream.use { it.readNBytes(32769) }; require(bytes.size <= 32768)
      val response = Wire.open(config.getString("key"), JSONObject(String(bytes, Charsets.UTF_8)))
      require(response.getString("kind") == "exchange-result" && kotlin.math.abs(System.currentTimeMillis() - response.getLong("sentAt")) < 60000)
      val result = response.getJSONObject("body"); require(result.getString("requestId") == message.getString("id"))
      if (!running || !prefs.getBoolean("enabled", false)) return
      val state = result.getJSONObject("state")
      synchronized(CompanionService) {
        dashboard = state.optJSONObject("dashboard")?.toString()
        val receipt = state.optJSONObject("dashboard")?.optJSONObject("command")
        pendingCommand?.let { if (receipt?.optString("id") == JSONObject(it).getString("id")) { pendingCommand = null; commandMessage = null } }
      }
      val profile = state.optJSONObject("presenceProfile")
      if (profile != null) {
        val name = profile.getString("name"); val home = profile.getString("homeWifi")
        require(name.length <= 80 && home.toByteArray(Charsets.UTF_8).size <= 32)
        if (prefs.getString("profileName", null) != name || prefs.getString("profileHomeWifi", null) != home) prefs.edit().putString("profileName", name).putString("profileHomeWifi", home).apply()
      } else if (prefs.contains("profileName")) prefs.edit().remove("profileName").remove("profileHomeWifi").apply()
      working = state.optBoolean("working")
      lastExchange = System.currentTimeMillis(); lastExchangeElapsed = android.os.SystemClock.elapsedRealtime(); CompanionService.connection = if (working) "Connected · working" else if (state.optBoolean("paused")) "Connected · desktop paused" else "Connected · waiting for Gather"
      synchronized(Alerts) { val remaining = prefs.getStringSet("acks", emptySet())!!.toMutableSet(); remaining.removeAll(acks); prefs.edit().putStringSet("acks", remaining).apply() }
      val events = result.getJSONArray("events")
      for (index in 0 until events.length()) Alerts.receive(this, events.getJSONObject(index))
      if (!working) stopAdvertising()
    } finally { connection.disconnect() }
  }
  override fun onDestroy() { running = false; working = false; synchronized(CompanionService) { pendingCommand = null; commandMessage = null; dashboard = null }; executor.shutdownNow(); stopAdvertising(); connection = "Stopped — open the app to restart"; super.onDestroy() }
}
