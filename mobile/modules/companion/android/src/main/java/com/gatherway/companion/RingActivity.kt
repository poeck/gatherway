package com.gatherway.companion

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class RingActivity : Activity() {
  private val handler = Handler(Looper.getMainLooper())
  override fun onCreate(state: Bundle?) {
    super.onCreate(state); setShowWhenLocked(true); setTurnScreenOn(true)
    val id = intent.getStringExtra("id") ?: run { finish(); return }
    val expiresAt = intent.getLongExtra("expiresAt", 0)
    val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setPadding(40, 60, 40, 60); setBackgroundColor(Color.rgb(16, 23, 22)) }
    layout.addView(TextView(this).apply { text = "GATHERWAY"; textSize = 14f; setTextColor(Color.rgb(145, 213, 180)); gravity = Gravity.CENTER })
    layout.addView(TextView(this).apply { text = intent.getStringExtra("title") ?: "Someone wants to talk"; textSize = 30f; setTextColor(Color.WHITE); gravity = Gravity.CENTER; setPadding(0, 40, 0, 40) })
    layout.addView(TextView(this).apply { text = "Return to Gather when you are ready."; textSize = 17f; setTextColor(Color.LTGRAY); gravity = Gravity.CENTER })
    layout.addView(Button(this).apply { text = "Acknowledge"; setOnClickListener { Alerts.acknowledge(this@RingActivity, id); finish() } })
    setContentView(layout)
    handler.post(object : Runnable { override fun run() { if (System.currentTimeMillis() >= expiresAt || RingService.activeId != id) finish() else handler.postDelayed(this, 500) } })
  }
  override fun onDestroy() { handler.removeCallbacksAndMessages(null); super.onDestroy() }
}
