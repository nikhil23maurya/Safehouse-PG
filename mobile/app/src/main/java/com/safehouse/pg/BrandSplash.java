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
    private final Typeface wordmark;
    private android.graphics.Shader wash;

    BrandSplash(Context context) {
        super(context);
        setBackgroundColor(Color.WHITE);
        Typeface face;
        try { face=Typeface.createFromAsset(context.getAssets(), "ManropeVariable.ttf"); }
        catch(Exception missing){ face=Typeface.create("sans-serif",Typeface.BOLD); }
        wordmark=android.os.Build.VERSION.SDK_INT>=28?Typeface.create(face,750,false):Typeface.create(face,Typeface.BOLD);
        reducedMotion = Settings.Global.getFloat(context.getContentResolver(), Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f;
        setContentDescription("Opening PGOne");
        setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
    }

    @Override protected void onSizeChanged(int w,int h,int oldw,int oldh) {
        super.onSizeChanged(w,h,oldw,oldh);
        wash=new android.graphics.LinearGradient(0,0,w,h,new int[]{Color.WHITE,Color.rgb(242,247,255)},null,android.graphics.Shader.TileMode.CLAMP);
    }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        final float density = getResources().getDisplayMetrics().density;
        final float centerX = getWidth() / 2f;
        final float centerY = getHeight() / 2f - 32f * density;
        final float progress = reducedMotion ? 1f : Math.min(1f, (android.os.SystemClock.uptimeMillis() - started) / 220f);
        final int opacity = Math.round(255f * progress);

        paint.setShader(wash);canvas.drawRect(0,0,getWidth(),getHeight(),paint);paint.setShader(null);
        paint.setColor(Color.rgb(233,240,255));
        canvas.drawCircle(getWidth()+90f*density,-70f*density,250f*density,paint);
        paint.setColor(Color.rgb(23,77,255));
        canvas.drawCircle(getWidth()+90f*density,-70f*density,211f*density,paint);
        paint.setColor(Color.rgb(239,244,255));
        canvas.drawCircle(centerX,centerY-29f*density,65f*density,paint);

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
        paint.setTypeface(wordmark);
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
        paint.setTextSize(10f*density);paint.setTypeface(Typeface.create(wordmark,Typeface.NORMAL));
        paint.setColor(Color.rgb(120,140,176));paint.setTextAlign(Paint.Align.CENTER);
        canvas.drawText("Manage · Stay · Pay",centerX,y+29f*density,paint);
        paint.setAlpha(255);
        long duration=reducedMotion?1200:900,now=android.os.SystemClock.uptimeMillis();
        for(int i=0;i<3;i++){
            float phase=((now-i*120)%duration+duration)%duration/(float)duration;
            float wave=phase<.65f?(float)Math.pow(Math.sin(Math.PI*phase/.65f),2):0;
            paint.setColor(Color.rgb(32,86,239));paint.setAlpha((int)(90+165*wave));
            canvas.drawCircle(centerX+(i-1)*13*density,y+65*density-(reducedMotion?0:4*density*wave),3*density,paint);
        }
        paint.setAlpha(255);
        if(isAttachedToWindow()&&getWindowVisibility()==VISIBLE)postInvalidateOnAnimation();
    }
}
