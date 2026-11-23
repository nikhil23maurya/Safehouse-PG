package com.safehouse.pg;

import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.view.Gravity;
import android.widget.ImageView;
import android.widget.LinearLayout;

import java.io.IOException;
import java.io.InputStream;

/** Cold-start artwork. MainActivity dismisses this view when the app is ready. */
final class BrandSplash extends LinearLayout {
    BrandSplash(Context context) {
        super(context);
        setBackgroundColor(Color.WHITE);
        setOrientation(VERTICAL);
        setGravity(Gravity.CENTER);
        setContentDescription("Opening PGOne");
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_YES);

        ImageView logo = new ImageView(context);
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        logo.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
        try (InputStream asset = context.getAssets().open("pgone-logo.png")) {
            logo.setImageDrawable(Drawable.createFromStream(asset, null));
        } catch (IOException unavailable) {
            logo.setImageResource(R.drawable.pgone_icon_foreground);
        }
        addView(logo, new LayoutParams(dp(180), dp(188)));

        BouncingDotsView dots = new BouncingDotsView(context);
        dots.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        addView(dots, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
    }

    private int dp(int size) {
        return Math.round(size * getResources().getDisplayMetrics().density);
    }
}
