package com.gatherway.companion

import android.Manifest
import android.content.pm.PackageManager
import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.google.firebase.FirebaseApp
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

class CompanionModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext)
  override fun definition() = ModuleDefinition {
    Name("GatherwayCompanion")
    AsyncFunction("configure") { raw: String ->
      val config = JSONObject(raw)
      require(config.optInt("v") == 1)
      context.stopService(Intent(context, CompanionService::class.java)); Alerts.cancelAll(context)
      NativeStore.save(context, config)
      FirebaseApp.getApps(context).forEach { it.delete() }
      NativeStore.prefs(context).edit().remove("fcmToken").apply()
      NativeStore.initializeFirebase(context)
    }
    AsyncFunction("start") {
      require(NativeStore.config(context) != null) { "Pair your laptop first" }
      for (permission in listOf(Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.ACCESS_FINE_LOCATION)) require(context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) { "Grant Bluetooth and precise location permissions before starting" }
      NativeStore.initializeFirebase(context)
      NativeStore.prefs(context).edit().putBoolean("enabled", true).apply()
      context.startForegroundService(Intent(context, CompanionService::class.java))
    }
    AsyncFunction("stop") { NativeStore.prefs(context).edit().putBoolean("enabled", false).apply(); context.stopService(Intent(context, CompanionService::class.java)); Alerts.cancelAll(context) }
    AsyncFunction("status") {
      val manager = context.getSystemService(NotificationManager::class.java)
      val config = NativeStore.config(context)
      mapOf(
        "paired" to (config != null), "running" to CompanionService.running,
        "advertising" to CompanionService.advertising, "working" to CompanionService.working,
        "connection" to CompanionService.connection, "lastExchange" to CompanionService.lastExchange,
        "wifi" to CompanionService.wifi(context).first, "currentSsid" to CompanionService.wifi(context).second,
        "homeWifi" to config?.optString("homeWifi"), "notifications" to manager.areNotificationsEnabled(),
        "fullScreen" to (Build.VERSION.SDK_INT < 34 || manager.canUseFullScreenIntent()),
        "fcmReady" to !NativeStore.prefs(context).getString("fcmToken", null).isNullOrEmpty(),
      )
    }
    AsyncFunction("fullScreenSettings") {
      if (Build.VERSION.SDK_INT >= 34) context.startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    AsyncFunction("notificationSettings") { context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
  }
}
