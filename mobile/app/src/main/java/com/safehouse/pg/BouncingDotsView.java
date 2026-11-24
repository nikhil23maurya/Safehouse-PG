package com.safehouse.pg;

import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.animation.PathInterpolator;
import android.widget.LinearLayout;

/** Native equivalent of PGOne's 25px, 1.65s breathing loader. */
final class BouncingDotsView extends LinearLayout {
    private final float density;
    private boolean running;
    private boolean reducedMotion;
    private long startedAt;
    private final PathInterpolator easing=new PathInterpolator(.42f,0f,.58f,1f);
    private final Runnable frame = new Runnable() {
        @Override public void run() {
            if (!running) return;
            long now = SystemClock.uptimeMillis();
            int duration = 1650;
            for (int i = 0; i < getChildCount(); i++) {
                float phase = ((now-startedAt+440-i*220)%duration+duration)%duration/(float)duration;
                float wave = phase<.45f?easing.getInterpolation(phase/.45f):phase<=.55f?1f:1f-easing.getInterpolation((phase-.55f)/.45f);
                View dot = getChildAt(i);
                dot.setAlpha(reducedMotion?1f:.55f + .45f * wave);
                dot.setTranslationY(0f);
                float scale = reducedMotion ? 1f : .2f + .88f * wave;
                dot.setScaleX(scale);
                dot.setScaleY(scale);
            }
            if(!reducedMotion)postOnAnimation(this);
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
        for (int i=0;i<3;i++) {
            View dot = new View(context);
            GradientDrawable circle = new GradientDrawable();
            circle.setShape(GradientDrawable.OVAL);
            circle.setColor(Color.rgb(65,105,225));
            dot.setBackground(circle);
            LayoutParams bounds = new LayoutParams(dp(25), dp(25));
            bounds.setMarginStart(i==0?0:dp(12));
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
            startedAt=SystemClock.uptimeMillis();postOnAnimation(frame);
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
