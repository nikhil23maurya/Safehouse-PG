package com.safehouse.pg;

import android.animation.ObjectAnimator;
import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import java.util.ArrayList;

/** Three fixed circular dots; translation only, never stretching or scaling. */
final class BouncingDotsView extends LinearLayout {
    private final ArrayList<ObjectAnimator> animations=new ArrayList<>();
    BouncingDotsView(Context context){
        super(context);setOrientation(HORIZONTAL);setGravity(Gravity.CENTER);
        float density=getResources().getDisplayMetrics().density;
        setPadding(0,(int)(24*density),0,(int)(24*density));
        setContentDescription("Finding UPI apps");setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_YES);
        boolean reduced=Settings.Global.getFloat(context.getContentResolver(),Settings.Global.ANIMATOR_DURATION_SCALE,1f)==0f;
        for(int i=0;i<3;i++){
            View dot=new View(context);GradientDrawable circle=new GradientDrawable();circle.setShape(GradientDrawable.OVAL);circle.setColor(Color.rgb(32,86,239));dot.setBackground(circle);
            LayoutParams bounds=new LayoutParams((int)(7*density),(int)(7*density));bounds.setMargins((int)(3*density),0,(int)(3*density),0);addView(dot,bounds);
            if(!reduced){ObjectAnimator animation=ObjectAnimator.ofFloat(dot,"translationY",0,-4*density,0);animation.setDuration(700);animation.setStartDelay(i*120);animation.setRepeatCount(ObjectAnimator.INFINITE);animations.add(animation);}
        }
    }
    @Override protected void onAttachedToWindow(){super.onAttachedToWindow();for(ObjectAnimator animation:animations)animation.start();}
    @Override protected void onDetachedFromWindow(){for(ObjectAnimator animation:animations)animation.cancel();super.onDetachedFromWindow();}
}
