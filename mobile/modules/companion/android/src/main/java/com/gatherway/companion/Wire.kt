package com.gatherway.companion

import org.json.JSONObject
import java.security.SecureRandom
import java.util.UUID
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

object Wire {
  private val aad = "gatherway:v1".toByteArray(Charsets.UTF_8)
  fun encode(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)
  fun decode(value: String): ByteArray = Base64.getDecoder().decode(value)
  fun packet(kind: String, body: JSONObject): JSONObject = JSONObject().put("id", UUID.randomUUID().toString()).put("sentAt", System.currentTimeMillis()).put("kind", kind).put("body", body)
  fun seal(key: String, message: JSONObject): JSONObject {
    val bytes = decode(key); require(bytes.size == 32)
    val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(bytes, "AES"), GCMParameterSpec(128, iv)); cipher.updateAAD(aad)
    return JSONObject().put("v", 1).put("iv", encode(iv)).put("data", encode(cipher.doFinal(message.toString().toByteArray(Charsets.UTF_8))))
  }
  fun open(key: String, envelope: JSONObject): JSONObject {
    require(envelope.getInt("v") == 1)
    val iv = decode(envelope.getString("iv")); val data = decode(envelope.getString("data"))
    require(iv.size == 12 && data.size in 16..32768)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(decode(key), "AES"), GCMParameterSpec(128, iv)); cipher.updateAAD(aad)
    return JSONObject(String(cipher.doFinal(data), Charsets.UTF_8))
  }
}
