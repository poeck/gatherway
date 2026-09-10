package com.gatherway.companion

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class EventLedgerTest {
  private fun event(id: String = "a", created: Long = 1000, expiry: Long = 46000) = JSONObject().put("id", id).put("type", "alert").put("createdAt", created).put("expiresAt", expiry)
  @Test fun duplicateDeliveryDoesNotRestartRinging() {
    val ledger = EventLedger(JSONObject())
    assertEquals(EventLedger.Decision.DISPLAY, ledger.accept(event(), 1000))
    assertEquals(EventLedger.Decision.DROP, ledger.accept(event(), 2000))
  }
  @Test fun cancellationBeforePushPreventsRingingAcrossRestart() {
    val ledger = EventLedger(JSONObject())
    assertEquals(EventLedger.Decision.CANCEL, ledger.accept(JSONObject().put("type", "cancel").put("id", "a"), 1000))
    val restored = EventLedger(JSONObject(ledger.entries.toString()))
    assertEquals(EventLedger.Decision.DROP, restored.accept(event(), 2000))
  }
  @Test fun expiredAndFutureMessagesCannotRing() {
    val ledger = EventLedger(JSONObject())
    assertEquals(EventLedger.Decision.DROP, ledger.accept(event(), 46000))
    assertEquals(EventLedger.Decision.DROP, ledger.accept(event(created = 100000, expiry = 145000), 1000))
    assertEquals(EventLedger.Decision.DROP, ledger.accept(event(expiry = 1000000), 1000))
  }
  @Test fun cancellationCanInvalidateAnAlreadyQueuedServiceStart() {
    val ledger = EventLedger(JSONObject())
    ledger.accept(event(), 1000); assertFalse(ledger.canceled("a"))
    ledger.accept(JSONObject().put("type", "cancel").put("id", "a"), 1001)
    assertTrue(ledger.canceled("a"))
  }
}
