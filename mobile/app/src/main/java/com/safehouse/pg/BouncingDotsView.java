package com.safehouse.pg;

import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;

/** Sequential bubbles; reduced motion uses opacity only and never freezes. */
final class BouncingDotsView extends LinearLayout {
    private final float density;
    private boolean running;
    private final Runnable frame=new Runnable(){public void run(){
        if(!running)return;
        boolean reduced=Settings.Global.getFloat(getContext().getContentResolver(),Settings.Global.ANIMATOR_DURATION_SCALE,1f)==0f;
        long now=SystemClock.uptimeMillis(),duration=reduced?1200:900;
        for(int i=0;i<getChildCount();i++){
            float phase=((now-i*120)%duration+duration)%duration/(float)duration;
            float wave=phase<.65f?(float)Math.pow(Math.sin(Math.PI*phase/.65f),2):0;
            View dot=getChildAt(i);dot.setAlpha(.35f+.65f*wave);dot.setTranslationY(reduced?0:-4*density*wave);
            dot.setScaleX(reduced?1:.88f+.12f*wave);dot.setScaleY(reduced?1:.88f+.12f*wave);
        }
        postOnAnimation(this);
    }};
    BouncingDotsView(Context context){
        super(context);setOrientation(HORIZONTAL);setGravity(Gravity.CENTER);
        density=getResources().getDisplayMetrics().density;
        setPadding(0,(int)(24*density),0,(int)(24*density));
        setContentDescription("Loading");setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_YES);
        for(int i=0;i<3;i++){
            View dot=new View(context);GradientDrawable circle=new GradientDrawable();circle.setShape(GradientDrawable.OVAL);circle.setColor(Color.rgb(32,86,239));dot.setBackground(circle);
            LayoutParams bounds=new LayoutParams((int)(7*density),(int)(7*density));bounds.setMargins((int)(3*density),0,(int)(3*density),0);addView(dot,bounds);
        }
    }
    private void update(){removeCallbacks(frame);running=isAttachedToWindow()&&getWindowVisibility()==VISIBLE&&isShown();if(running)postOnAnimation(frame);}
    @Override protected void onAttachedToWindow(){super.onAttachedToWindow();update();}
    @Override protected void onWindowVisibilityChanged(int visibility){super.onWindowVisibilityChanged(visibility);if(frame!=null)update();}
    @Override protected void onDetachedFromWindow(){running=false;removeCallbacks(frame);super.onDetachedFromWindow();}
}
