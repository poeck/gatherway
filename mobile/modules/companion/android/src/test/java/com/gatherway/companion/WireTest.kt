package com.gatherway.companion

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class WireTest {
  @Test fun decryptsNodeGeneratedEnvelope() {
    val raw = javaClass.getResource("/wire-vector.json")!!.readText()
    val fixture = JSONObject(raw)
    assertEquals(fixture.getJSONObject("message").toString(), Wire.open(fixture.getString("key"), fixture.getJSONObject("envelope")).toString())
  }
  @Test fun roundTripAndTamperProtection() {
    val key = Wire.encode(ByteArray(32) { it.toByte() }); val message = Wire.packet("event", JSONObject().put("hello", "👋"))
    val envelope = Wire.seal(key, message)
    assertEquals(message.toString(), Wire.open(key, envelope).toString())
    val bytes = Wire.decode(envelope.getString("data")); bytes[0] = (bytes[0].toInt() xor 1).toByte(); envelope.put("data", Wire.encode(bytes))
    assertThrows(Exception::class.java) { Wire.open(key, envelope) }
  }
}
