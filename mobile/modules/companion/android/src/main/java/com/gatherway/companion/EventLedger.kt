package com.gatherway.companion

import org.json.JSONObject

class EventLedger(val entries: JSONObject) {
  enum class Decision { DROP, CANCEL, DISPLAY }
  fun accept(event: JSONObject, now: Long): Decision {
    entries.keys().asSequence().toList().filter { (entries.optJSONObject(it)?.optLong("until") ?: entries.optLong(it)) < now }.forEach { entries.remove(it) }
    val id = event.optString("id")
    if (id.isBlank() || id.length > 100) return Decision.DROP
    if (event.optString("type") == "cancel") {
      entries.put(id, JSONObject().put("until", now + 120000).put("canceled", true))
      return Decision.CANCEL
    }
    if (entries.has(id)) return Decision.DROP
    if (event.optString("type") !in listOf("alert", "reminder")) return Decision.DROP
    val expiry = event.optLong("expiresAt"); val created = event.optLong("createdAt")
    if (expiry <= now || created > now + 5000 || expiry - created !in 1..60000 || entries.length() >= 500) return Decision.DROP
    entries.put(id, JSONObject().put("until", expiry + 120000).put("canceled", false))
    return Decision.DISPLAY
  }
  fun canceled(id: String): Boolean = entries.optJSONObject(id)?.optBoolean("canceled") == true
}
