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
      val home = NativeStore.config(context)?.optString("homeWifi")
      return (if (home.isNullOrBlank()) "unknown" else if (ssid == home) "home" else "away") to ssid
    }
  }
  private val executor = Executors.newSingleThreadScheduledExecutor()
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
    if (advertising) return
    if (checkSelfPermission(Manifest.permission.BLUETOOTH_ADVERTISE) != PackageManager.PERMISSION_GRANTED || checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) return
    val adapter = getSystemService(BluetoothManager::class.java).adapter ?: return
    if (!adapter.isEnabled) return
    val beacon = NativeStore.config(this)?.optString("beacon") ?: return
    advertiser = adapter.bluetoothLeAdvertiser ?: return
    if (callback != null) return
    callback = object : AdvertisingSetCallback() {
      override fun onAdvertisingSetStarted(set: AdvertisingSet?, txPower: Int, status: Int) {
        if (callback !== this) { runCatching { advertiser?.stopAdvertisingSet(this) }; return }
        advertising = status == ADVERTISE_SUCCESS
        if (!advertising) { callback = null; connection = "BLE advertising failed ($status)" }
      }
      override fun onAdvertisingSetStopped(set: AdvertisingSet?) { if (callback === this) { advertising = false; callback = null } }
    }
    // 3200 × 0.625 ms = 2 seconds, scheduled by the Bluetooth controller.
    val settings = AdvertisingSetParameters.Builder().setLegacyMode(true).setScannable(true).setConnectable(false).setInterval(3200).setTxPowerLevel(AdvertisingSetParameters.TX_POWER_MEDIUM).build()
    val uuid = ParcelUuid.fromString(beacon)
    val data = AdvertiseData.Builder().addServiceUuid(uuid).setIncludeDeviceName(false).build()
    val scanResponse = AdvertiseData.Builder().addServiceData(uuid, byteArrayOf(1)).build()
    advertiser?.startAdvertisingSet(settings, data, scanResponse, null, null, callback)
  }
  private fun stopAdvertising() { runCatching { callback?.let { advertiser?.stopAdvertisingSet(it) } }; callback = null; advertising = false }
  private fun exchange() {
    val config = NativeStore.config(this) ?: return
    if (working) startAdvertising() else stopAdvertising()
    val prefs = NativeStore.prefs(this)
    val acks = synchronized(Alerts) { prefs.getStringSet("acks", emptySet())!!.toSet() }
    val body = JSONObject().put("wifi", wifi(this).first).put("bluetooth", advertising).put("serviceRunning", running).put("acks", JSONArray(acks.toList())).put("fcmToken", prefs.getString("fcmToken", null))
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
      working = state.optBoolean("working")
      lastExchange = System.currentTimeMillis(); CompanionService.connection = if (working) "Connected · working" else "Connected · waiting for Gather"
      synchronized(Alerts) { val remaining = prefs.getStringSet("acks", emptySet())!!.toMutableSet(); remaining.removeAll(acks); prefs.edit().putStringSet("acks", remaining).apply() }
      val events = result.getJSONArray("events")
      for (index in 0 until events.length()) Alerts.receive(this, events.getJSONObject(index))
      if (!working) stopAdvertising()
    } finally { connection.disconnect() }
  }
  override fun onDestroy() { executor.shutdownNow(); stopAdvertising(); running = false; working = false; connection = "Stopped — open the app to restart"; super.onDestroy() }
}
