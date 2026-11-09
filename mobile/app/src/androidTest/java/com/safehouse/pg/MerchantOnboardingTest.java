package com.safehouse.pg;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.ActivityInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class MerchantOnboardingTest {
    @Test public void providerEntryPointRejectsUntrustedUrls() {
        assertTrue(MerchantOnboardingActivity.allowedInitialUrl("https://merchant.cashfree.com/merchantwebapp/validate/synthetic-token"));
        for (String url : new String[]{null, "http://merchant.cashfree.com/", "https://merchant.cashfree.com.evil.test/",
            "https://merchant.cashfree.com@evil.test/", "https://name:password@merchant.cashfree.com/",
            "https://merchant.cashfree.com:8443/", "file:///sdcard/private", "javascript:alert(1)", "https://evil.test/"}) {
            assertFalse("Untrusted entry point accepted", MerchantOnboardingActivity.allowedInitialUrl(url));
        }
    }
    @Test public void providerActivityIsNotExportedToOtherApps() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        ActivityInfo info = context.getPackageManager().getActivityInfo(new ComponentName(context, MerchantOnboardingActivity.class), 0);
        assertFalse(info.exported);
    }
}
