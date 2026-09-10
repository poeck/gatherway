package com.gatherway.companion

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject

object Alerts {
  const val SERVICE_CHANNEL = "gatherway-service"
  const val CALL_CHANNEL = "gatherway-calls"
  const val MESSAGE_CHANNEL = "gatherway-messages"
  fun channels(context: Context) {
    val manager = context.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(NotificationChannel(SERVICE_CHANNEL, "Companion connection", NotificationManager.IMPORTANCE_LOW))
    manager.createNotificationChannel(NotificationChannel(CALL_CHANNEL, "Conversation requests", NotificationManager.IMPORTANCE_HIGH).apply { description = "Incoming requests to speak in Gather"; setSound(null, null); enableVibration(false); setBypassDnd(false) })
    manager.createNotificationChannel(NotificationChannel(MESSAGE_CHANNEL, "Waves and reminders", NotificationManager.IMPORTANCE_DEFAULT))
  }
  fun openApp(context: Context): PendingIntent = PendingIntent.getActivity(context, 0, context.packageManager.getLaunchIntentForPackage(context.packageName)!!, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  @Synchronized fun receive(context: Context, event: JSONObject) {
    if (event.optString("type") != "cancel" && !NativeStore.prefs(context).getBoolean("enabled", false)) return
    val id = event.optString("id")
    val ledger = EventLedger(JSONObject(NativeStore.prefs(context).getString("seen", "{}")!!))
    val decision = ledger.accept(event, System.currentTimeMillis())
    NativeStore.prefs(context).edit().putString("seen", ledger.entries.toString()).apply()
    if (decision == EventLedger.Decision.CANCEL) {
      RingService.cancel(context, id); context.getSystemService(NotificationManager::class.java).cancel(id.hashCode()); return
    }
    if (decision == EventLedger.Decision.DROP) return
    val now = System.currentTimeMillis(); val expiry = event.optLong("expiresAt"); val created = event.optLong("createdAt")
    channels(context)
    val ring = event.optString("mode") == "ring"
    val title = if (event.optString("kind") == "return-reminder") "Still on a break?" else if (event.optString("kind") == "test") "Gatherway test call" else if (event.optString("kind") == "wave") "Someone waved at you" else "Someone wants to talk"
    val text = if (event.optString("kind") == "return-reminder") "You have been near your laptop for five minutes." else "Return to Gather when you are ready."
    val intent = Intent(context, AcknowledgeReceiver::class.java).putExtra("id", id)
    val dismiss = PendingIntent.getBroadcast(context, id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val fullScreen = PendingIntent.getActivity(context, id.hashCode(), Intent(context, RingActivity::class.java).putExtra("id", id).putExtra("title", title).putExtra("expiresAt", expiry), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val builder = NotificationCompat.Builder(context, if (ring) CALL_CHANNEL else MESSAGE_CHANNEL).setSmallIcon(android.R.drawable.sym_call_incoming).setContentTitle(title).setContentText(text).setContentIntent(if (ring) fullScreen else openApp(context)).setCategory(if (ring) NotificationCompat.CATEGORY_CALL else NotificationCompat.CATEGORY_MESSAGE).setTimeoutAfter(expiry - now).setAutoCancel(!ring).setDeleteIntent(dismiss).addAction(android.R.drawable.ic_menu_close_clear_cancel, "Acknowledge", dismiss)
    val manager = context.getSystemService(NotificationManager::class.java)
    if (ring && (Build.VERSION.SDK_INT < 34 || manager.canUseFullScreenIntent())) builder.setFullScreenIntent(fullScreen, true)
    if (ring) {
      val start = Intent(context, RingService::class.java).putExtra("id", id).putExtra("expiresAt", expiry).putExtra("title", title)
      try { context.startForegroundService(start) } catch (_: Exception) { manager.notify(id.hashCode(), builder.build()) }
    } else manager.notify(id.hashCode(), builder.build())
  }
  @Synchronized fun acknowledge(context: Context, id: String) {
    val prefs = NativeStore.prefs(context)
    val acks = prefs.getStringSet("acks", emptySet())!!.toMutableSet(); acks.add(id)
    prefs.edit().putStringSet("acks", acks.toList().takeLast(100).toSet()).apply()
    receive(context, JSONObject().put("id", id).put("type", "cancel"))
  }
  fun cancelAll(context: Context) { RingService.cancel(context, null) }
}
class AcknowledgeReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) { intent.getStringExtra("id")?.let { Alerts.acknowledge(context, it) } }
}
class PushService : FirebaseMessagingService() {
  override fun onNewToken(token: String) { NativeStore.prefs(this).edit().putString("fcmToken", token).apply() }
  override fun onMessageReceived(message: RemoteMessage) {
    val config = NativeStore.config(this) ?: return
    runCatching {
      val raw = message.data["envelope"] ?: return
      if (raw.length > 16384) return
      val packet = Wire.open(config.getString("key"), JSONObject(raw))
      if (packet.getString("kind") != "event" || kotlin.math.abs(System.currentTimeMillis() - packet.getLong("sentAt")) > 60000) return
      Alerts.receive(this, packet.getJSONObject("body"))
    }
  }
}
