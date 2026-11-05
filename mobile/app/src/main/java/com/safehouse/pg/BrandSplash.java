package com.safehouse.pg;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.provider.Settings;
import android.view.View;

/** PGOne cold-start logo. Dismissed by app readiness, never by a decorative timer. */
final class BrandSplash extends View {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final long started = android.os.SystemClock.uptimeMillis();
    private final boolean reducedMotion;

    BrandSplash(Context context) {
        super(context);
        setBackgroundColor(Color.WHITE);
        reducedMotion = Settings.Global.getFloat(context.getContentResolver(), Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f;
        setContentDescription("Opening PGOne");
        setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
    }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        final float density = getResources().getDisplayMetrics().density;
        final float centerX = getWidth() / 2f;
        final float centerY = getHeight() / 2f - 32f * density;
        final float progress = reducedMotion ? 1f : Math.min(1f, (android.os.SystemClock.uptimeMillis() - started) / 700f);
        final int opacity = Math.round(255f * progress);

        // Identical vector geometry to the website/app launcher; no alternate house icon.
        Drawable mark = getContext().getDrawable(R.drawable.ic_launcher);
        if (mark != null) {
            int size = Math.round(92f * density);
            int left = Math.round(centerX - size / 2f);
            int top = Math.round(centerY - 75f * density);
            mark.setBounds(left, top, left + size, top + size);
            mark.setAlpha(opacity);
            mark.draw(canvas);
        }

        paint.setStyle(Paint.Style.FILL);
        paint.setTextSize(27f * density);
        paint.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        paint.setTextAlign(Paint.Align.LEFT);
        paint.setAlpha(opacity);
        float pgWidth = paint.measureText("PG");
        float oneWidth = paint.measureText("One");
        float x = centerX - (pgWidth + oneWidth) / 2f;
        float y = centerY + 55f * density;
        paint.setColor(Color.rgb(11, 33, 72));
        canvas.drawText("PG", x, y, paint);
        paint.setColor(Color.rgb(32, 86, 239));
        canvas.drawText("One", x + pgWidth, y, paint);
        paint.setAlpha(255);
        if (progress < 1f) postInvalidateOnAnimation();
    }
}
