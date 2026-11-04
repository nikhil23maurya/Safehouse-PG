package com.safehouse.pg;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PathMeasure;
import android.graphics.Typeface;
import android.provider.Settings;
import android.view.View;

/** Lightweight cold-start drawing. Readiness, not an animation timer, dismisses it. */
final class BrandSplash extends View {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final long started = android.os.SystemClock.uptimeMillis();
    private final boolean reducedMotion;

    BrandSplash(Context context) {
        super(context);
        setBackgroundColor(Color.WHITE);
        reducedMotion = Settings.Global.getFloat(context.getContentResolver(), Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f;
        setContentDescription("Opening SafeHouse");
        setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
    }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float density = getResources().getDisplayMetrics().density;
        float centerX = getWidth() / 2f, centerY = getHeight() / 2f - 30 * density;
        float progress = reducedMotion ? 1f : Math.min(1f, (android.os.SystemClock.uptimeMillis() - started) / 800f);
        canvas.save(); canvas.translate(centerX - 38 * density, centerY - 38 * density); canvas.scale(76 * density / 48f, 76 * density / 48f);
        paint.setColor(Color.rgb(23, 70, 200)); paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(2.8f); paint.setStrokeCap(Paint.Cap.ROUND); paint.setStrokeJoin(Paint.Join.ROUND);
        Path logo = new Path(); logo.moveTo(5, 22); logo.lineTo(24, 6); logo.lineTo(43, 22); logo.moveTo(11, 22); logo.lineTo(11, 41); logo.lineTo(22, 41); logo.lineTo(22, 29); logo.lineTo(32, 29); logo.lineTo(32, 41); logo.lineTo(37, 41); logo.lineTo(37, 22);
        // Two contours reveal the roof first and then the house.
        PathMeasure measure = new PathMeasure(logo, false); Path drawn = new Path();
        measure.getSegment(0, measure.getLength() * Math.min(1f, progress * 2), drawn, true);
        if (measure.nextContour()) measure.getSegment(0, measure.getLength() * Math.max(0f, progress * 2 - 1), drawn, true);
        canvas.drawPath(drawn, paint); canvas.restore();
        paint.setStyle(Paint.Style.FILL); paint.setColor(Color.rgb(20, 36, 67)); paint.setAlpha(Math.round(255 * Math.min(1f, progress * 2)));
        paint.setTextSize(26 * density); paint.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL)); paint.setTextAlign(Paint.Align.CENTER);
        canvas.drawText("SafeHouse", centerX, centerY + 76 * density, paint); paint.setAlpha(255);
        if (progress < 1) postInvalidateOnAnimation();
    }
}
