package com.safehouse.pg;

import android.app.Activity;
import android.os.Bundle;
import android.widget.TextView;

/** A test-only intent receiver. Makes no network or payment calls. */
public class UpiFixtureActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        TextView text = new TextView(this);
        text.setBackgroundColor(android.graphics.Color.WHITE);
        text.setTextColor(android.graphics.Color.BLACK);
        text.setTextSize(18); text.setPadding(32, 100, 32, 32);
        text.setText("UPI handoff received (test only)\n\n" + getIntent().getDataString() + "\n\nNo payment is performed.");
        setContentView(text);
    }
}
