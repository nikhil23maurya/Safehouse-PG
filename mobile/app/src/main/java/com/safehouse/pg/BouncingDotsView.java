package com.safehouse.pg;

import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;

/** Staggered bounce, with an opacity-only reduced-motion variant. */
final class BouncingDotsView extends LinearLayout {
    private final float density;
    private boolean running;
    private boolean reducedMotion;
    private final Runnable frame = new Runnable() {
        @Override public void run() {
            if (!running) return;
            long now = SystemClock.uptimeMillis();
            int duration = reducedMotion ? 1200 : 920;
            for (int i = 0; i < getChildCount(); i++) {
                float phase = ((now - i * 125) % duration + duration) % duration / (float) duration;
                float wave = phase < .65f ? (float) Math.pow(Math.sin(Math.PI * phase / .65f), 2) : 0f;
                View dot = getChildAt(i);
                dot.setAlpha(.55f + .45f * wave);
                dot.setTranslationY(reducedMotion ? 0f : -13 * density * wave);
                float scale = reducedMotion ? 1f : .84f + .16f * wave;
                dot.setScaleX(scale);
                dot.setScaleY(scale);
            }
            postOnAnimation(this);
        }
    };

    BouncingDotsView(Context context) {
        super(context);
        setOrientation(HORIZONTAL);
        setGravity(Gravity.CENTER);
        density = getResources().getDisplayMetrics().density;
        setPadding(0, dp(24), 0, dp(24));
        setContentDescription("Loading");
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_YES);
        int[] colors = { Color.rgb(22, 71, 207), Color.rgb(55, 104, 223), Color.rgb(169, 112, 4) };
        for (int color : colors) {
            View dot = new View(context);
            GradientDrawable circle = new GradientDrawable();
            circle.setShape(GradientDrawable.OVAL);
            circle.setColor(color);
            dot.setBackground(circle);
            LayoutParams bounds = new LayoutParams(dp(15), dp(15));
            bounds.setMargins(dp(5.5f), 0, dp(5.5f), 0);
            addView(dot, bounds);
        }
    }

    private int dp(float size) {
        return Math.round(size * density);
    }

    private void update() {
        removeCallbacks(frame);
        running = isAttachedToWindow() && getWindowVisibility() == VISIBLE && isShown();
        if (running) {
            reducedMotion = Settings.Global.getFloat(getContext().getContentResolver(),
                    Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f;
            postOnAnimation(frame);
        }
    }

    @Override protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        update();
    }

    @Override protected void onWindowVisibilityChanged(int visibility) {
        super.onWindowVisibilityChanged(visibility);
        if (frame != null) update();
    }

    @Override protected void onDetachedFromWindow() {
        running = false;
        removeCallbacks(frame);
        super.onDetachedFromWindow();
    }
}
