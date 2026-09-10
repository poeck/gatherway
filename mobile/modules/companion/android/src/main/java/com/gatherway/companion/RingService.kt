package com.gatherway.companion

import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.VibratorManager
import androidx.core.app.NotificationCompat

class RingService : Service() {
  companion object {
    @Volatile var activeId: String? = null
    private var instance: RingService? = null
    fun cancel(context: Context, id: String?) {
      Handler(Looper.getMainLooper()).post { if (id == null || activeId == id) instance?.finish() }
    }
  }
  private var ringtone: Ringtone? = null
  private val handler = Handler(Looper.getMainLooper())
  private var expiry = 0L
  private var lastMode = -1
  override fun onBind(intent: Intent?): IBinder? = null
  override fun onCreate() { super.onCreate(); instance = this; Alerts.channels(this) }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val id = intent?.getStringExtra("id") ?: run { finish(); return START_NOT_STICKY }
    expiry = intent.getLongExtra("expiresAt", 0)
    if (expiry <= System.currentTimeMillis() || wasCanceled(id) || !NativeStore.prefs(this).getBoolean("enabled", false)) { finish(); return START_NOT_STICKY }
    stopSound(); activeId = id; lastMode = -1
    val dismiss = PendingIntent.getBroadcast(this, id.hashCode(), Intent(this, AcknowledgeReceiver::class.java).putExtra("id", id), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val title = intent.getStringExtra("title") ?: "Someone wants to talk"
    val screen = PendingIntent.getActivity(this, id.hashCode(), Intent(this, RingActivity::class.java).putExtra("id", id).putExtra("title", title).putExtra("expiresAt", expiry), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val builder = NotificationCompat.Builder(this, Alerts.CALL_CHANNEL).setSmallIcon(android.R.drawable.sym_call_incoming).setContentTitle(title).setContentText("Return to Gather to respond.").setCategory(NotificationCompat.CATEGORY_CALL).setContentIntent(screen).setOngoing(true).setDeleteIntent(dismiss).setTimeoutAfter(expiry - System.currentTimeMillis()).addAction(android.R.drawable.ic_menu_close_clear_cancel, "Acknowledge", dismiss)
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT < 34 || manager.canUseFullScreenIntent()) builder.setFullScreenIntent(screen, true)
    startForeground(1002, builder.build())
    handler.removeCallbacksAndMessages(null)
    handler.post(object : Runnable {
      override fun run() { if (System.currentTimeMillis() >= expiry || wasCanceled(id)) { finish(); return }; updateSound(); handler.postDelayed(this, 500) }
    })
    return START_NOT_STICKY
  }
  private fun wasCanceled(id: String): Boolean = EventLedger(org.json.JSONObject(NativeStore.prefs(this).getString("seen", "{}")!!)).canceled(id)
  private fun updateSound() {
    val audio = getSystemService(AudioManager::class.java)
    val notifications = getSystemService(NotificationManager::class.java)
    val allowed = notifications.currentInterruptionFilter == NotificationManager.INTERRUPTION_FILTER_ALL && notifications.areNotificationsEnabled() && notifications.getNotificationChannel(Alerts.CALL_CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE
    val mode = if (allowed) audio.ringerMode else AudioManager.RINGER_MODE_SILENT
    if (mode == lastMode) return
    stopSound(); lastMode = mode
    val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
    if (mode == AudioManager.RINGER_MODE_NORMAL) {
      ringtone = RingtoneManager.getRingtone(this, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))?.apply { audioAttributes = attributes; isLooping = true; play() }
    }
    if (mode != AudioManager.RINGER_MODE_SILENT) getSystemService(VibratorManager::class.java).defaultVibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 500, 500, 500, 1500), 0), attributes)
  }
  private fun stopSound() { ringtone?.stop(); ringtone = null; getSystemService(VibratorManager::class.java).defaultVibrator.cancel() }
  private fun finish() { stopSound(); handler.removeCallbacksAndMessages(null); activeId = null; stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() }
  override fun onDestroy() { stopSound(); handler.removeCallbacksAndMessages(null); activeId = null; instance = null; super.onDestroy() }
}
