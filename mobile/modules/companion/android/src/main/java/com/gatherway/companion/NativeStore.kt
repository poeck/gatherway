package com.gatherway.companion

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.net.URI
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object NativeStore {
  fun prefs(context: Context) = context.getSharedPreferences("gatherway", Context.MODE_PRIVATE)
  private fun masterKey(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey("gatherway-config", null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder("gatherway-config", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
    }.generateKey()
  }
  fun config(context: Context): JSONObject? = runCatching {
    val raw = prefs(context).getString("config", null) ?: return null
    val wrapped = JSONObject(raw)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, masterKey(), GCMParameterSpec(128, Wire.decode(wrapped.getString("iv"))))
    JSONObject(String(cipher.doFinal(Wire.decode(wrapped.getString("data"))), Charsets.UTF_8))
  }.getOrNull()
  fun validateEndpoint(endpoint: String) {
    val uri = URI(endpoint)
    require(uri.scheme == "http" && uri.userInfo == null && uri.query == null && uri.fragment == null && (uri.path.isNullOrEmpty() || uri.path == "/") && uri.port in 1024..65535) { "Use the pairing endpoint from your laptop" }
    val parts = (uri.host ?: "").split('.').map { it.toIntOrNull() ?: -1 }
    require(parts.size == 4 && parts[0] == 100 && parts[1] in 64..127 && parts[2] in 0..255 && parts[3] in 0..255) { "Endpoint must be a Tailscale IPv4 address" }
  }
  @Synchronized fun save(context: Context, value: JSONObject) {
    validateEndpoint(value.getString("endpoint")); require(Wire.decode(value.getString("key")).size == 32)
    java.util.UUID.fromString(value.getString("beacon"))
    val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, masterKey())
    val wrapped = JSONObject().put("iv", Wire.encode(cipher.iv)).put("data", Wire.encode(cipher.doFinal(value.toString().toByteArray(Charsets.UTF_8))))
    prefs(context).edit().putString("config", wrapped.toString()).putBoolean("enabled", false).remove("seen").remove("acks").remove("profileName").remove("profileHomeWifi").apply()
  }
  @Synchronized fun initializeFirebase(context: Context) {
    val settings = config(context)?.optJSONObject("firebase") ?: return
    if (settings.optString("appId").isBlank()) return
    if (FirebaseApp.getApps(context).none { it.name == FirebaseApp.DEFAULT_APP_NAME }) {
      FirebaseApp.initializeApp(context, FirebaseOptions.Builder().setApplicationId(settings.getString("appId")).setApiKey(settings.getString("apiKey")).setProjectId(settings.getString("projectId")).setGcmSenderId(settings.getString("senderId")).build())
    }
    FirebaseMessaging.getInstance().token.addOnSuccessListener { prefs(context).edit().putString("fcmToken", it).apply() }
  }
}
