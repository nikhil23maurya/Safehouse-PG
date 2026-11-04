package com.safehouse.pg;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.View;
import android.view.ViewGroup;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Controlled fixture journeys against the actual installed WebView APK. */
@RunWith(AndroidJUnit4.class)
public class MobileJourneyTest {
    private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
    private final Context target = instrumentation.getTargetContext();
    private Activity activity;
    private WebView web;

    private String read(InputStream input) throws Exception {
        try (InputStream stream = input; ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int n;
            while ((n = stream.read(buffer)) >= 0) bytes.write(buffer, 0, n);
            return bytes.toString("UTF-8");
        }
    }
    private WebView findWeb(View view) {
        if (view instanceof WebView) return (WebView)view;
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup)view).getChildCount(); i++) {
            WebView found = findWeb(((ViewGroup)view).getChildAt(i)); if (found != null) return found;
        }
        return null;
    }
    private String js(String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1); AtomicReference<String> value = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> web.evaluateJavascript(script, result -> { value.set(result); done.countDown(); }));
        assertTrue("JavaScript evaluation timed out", done.await(10, TimeUnit.SECONDS)); return value.get();
    }
    private void await(String expression) throws Exception {
        long deadline = System.currentTimeMillis() + 25000;
        do { if ("true".equals(js("Boolean(" + expression + ")"))) return; Thread.sleep(150); } while (System.currentTimeMillis() < deadline);
        fail("Condition failed: " + expression + " state=" + js("document.body.innerText.slice(0,1200)"));
    }
    private void go(String name, String params) throws Exception {
        js("history.pushState({name:'" + name + "',params:" + params + ",depth:1},'','#" + name + "');dispatchEvent(new PopStateEvent('popstate',{state:history.state}));");
        await("document.getElementById('app').dataset.screen==='" + name + "'&&!document.querySelector('.page-progress')");
        assertEquals("Horizontal overflow: " + name, "true", js("document.documentElement.scrollWidth<=innerWidth+1"));
    }
    private void screenshot(String name) throws Exception {
        Thread.sleep(150);
        Bitmap bitmap = instrumentation.getUiAutomation().takeScreenshot(); assertNotNull(bitmap);
        File directory = new File(target.getExternalFilesDir(null), "qa"); directory.mkdirs();
        try (FileOutputStream output = new FileOutputStream(new File(directory, name + ".png"))) { bitmap.compress(Bitmap.CompressFormat.PNG, 100, output); }
        bitmap.recycle();
    }
    private void signIn(boolean student) throws Exception {
        js("document.querySelector('[name=email]').value='" + (student ? "resident" : "owner") + "@example.test';document.querySelector('[name=password]').value='FixturePass123!';document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));");
        await("document.getElementById('app').dataset.screen==='" + (student ? "studentHome" : "ownerHome") + "'");
    }

    @Test public void installedAppJourneysAndScreenshots() throws Exception {
        new SessionVault(target).save("");
        Intent intent = new Intent(target, MainActivity.class); intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity = instrumentation.startActivitySync(intent);
        instrumentation.runOnMainSync(() -> web = findWeb(activity.getWindow().getDecorView()));
        assertNotNull("WebView did not initialize", web);
        await("document.querySelector('[data-form=login]')");
        String fixtures = read(instrumentation.getContext().getAssets().open("fixtures.js"));
        instrumentation.runOnMainSync(() -> {
            WebViewClient production = web.getWebViewClient();
            web.setWebViewClient(new WebViewClient() {
                @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    try {
                        if (request.getUrl().toString().equals("https://rzp.io/i/fixture")) return new WebResourceResponse("image/png", null, instrumentation.getContext().getAssets().open("qr-fixture.png"));
                        if ("/assets/app.js".equals(request.getUrl().getPath())) {
                            String source = fixtures + "\n" + read(target.getAssets().open("app.js"));
                            return new WebResourceResponse("application/javascript", "UTF-8", new ByteArrayInputStream(source.getBytes(StandardCharsets.UTF_8)));
                        }
                    } catch (Exception error) { throw new RuntimeException(error); }
                    return production.shouldInterceptRequest(view, request);
                }
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return production.shouldOverrideUrlLoading(view, request); }
                @Override public void onPageFinished(WebView view, String url) { production.onPageFinished(view, url); }
            });
        });
        // Reload with fixtures prefixed before the production API client captures fetch.
        instrumentation.runOnMainSync(() -> { web.clearCache(true); web.reload(); });
        await("window.__nativeFixtures&&document.querySelector('[data-form=login]')");
        screenshot("01-login");
        js("document.querySelector('[name=password]').focus()");
        instrumentation.runOnMainSync(() -> { web.requestFocus(); ((android.view.inputmethod.InputMethodManager)target.getSystemService(Context.INPUT_METHOD_SERVICE)).showSoftInput(web, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT); });
        Thread.sleep(1500); screenshot("02-login-keyboard");
        try (FileOutputStream info = new FileOutputStream(new File(target.getExternalFilesDir(null), "qa/keyboard-layout.txt"))) {
            info.write(js("JSON.stringify({height:innerHeight,visualHeight:visualViewport.height,focused:document.activeElement.tagName,input:document.querySelector('[name=password]').getBoundingClientRect().toJSON()})").getBytes(StandardCharsets.UTF_8));
        }
        instrumentation.runOnMainSync(() -> ((android.view.inputmethod.InputMethodManager)target.getSystemService(Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(web.getWindowToken(),0));
        signIn(false); screenshot("03-owner-home");
        assertTrue("Encrypted session did not restore", new SessionVault(target).load().contains("fixture_OWNER_access"));
        assertFalse("Plaintext session must not be in preferences", target.getSharedPreferences("safehouse_secure_session", Context.MODE_PRIVATE).getString("ciphertext", "").contains("fixture_OWNER_access"));
        instrumentation.runOnMainSync(() -> web.reload());
        await("document.getElementById('app').dataset.screen==='ownerHome'"); screenshot("04-session-restored");
        go("residents", "{}"); screenshot("05-residents");
        go("resident", "{id:'resident1'}"); screenshot("06-resident");
        go("residentForm", "{}"); screenshot("07-add-resident");
        go("rooms", "{}"); screenshot("08-rooms");
        go("room", "{id:'room1'}"); screenshot("09-room");
        go("roomForm", "{}"); screenshot("10-add-room");
        go("dues", "{}"); screenshot("11-dues");
        go("invoice", "{id:'invoice1',residentId:'resident1'}"); screenshot("12-invoice");
        go("manualPayment", "{id:'invoice1',residentId:'resident1'}"); screenshot("13-record-payment");
        go("invoiceCharges", "{id:'invoice1',residentId:'resident1'}"); screenshot("14-charges");
        go("ownerPayments", "{}"); screenshot("15-owner-payments");
        go("notifications", "{}"); screenshot("16-notifications");
        go("notificationForm", "{}"); screenshot("17-compose");
        go("properties", "{}"); screenshot("18-properties");
        go("profile", "{}"); screenshot("19-owner-profile");
        js("document.querySelector('[data-action=logout]').click()"); await("document.querySelector('[data-action=dialog-confirm]')");
        js("document.querySelector('[data-action=dialog-confirm]').click()"); await("document.querySelector('[data-form=login]')");
        signIn(true); screenshot("20-resident-home");
        go("invoices", "{}"); screenshot("21-invoices");
        go("history", "{}"); screenshot("22-history");
        go("payment", "{invoiceId:'invoice1'}"); await("document.querySelector('[data-payment-qr]:not([hidden])')"); screenshot("23-payment-qr");
        assertEquals("false", js("document.body.innerText.includes('Payment Successful')"));
        js("window.__nativeFixtures.control.paymentState='CAPTURED';document.querySelector('[data-action=checkPayment]').click()");
        await("document.querySelector('.success-amount')"); screenshot("24-payment-success");
        assertTrue(js("document.body.innerText").contains("pay_fixture1"));
        instrumentation.runOnMainSync(() -> activity.onBackPressed());
        await("!document.querySelector('.success-amount')"); screenshot("25-hardware-back");
        go("studentHome", "{}");
        instrumentation.runOnMainSync(() -> { activity.moveTaskToBack(true); });
        Thread.sleep(300);
        instrumentation.runOnMainSync(() -> target.startActivity(intent));
        await("document.getElementById('app').dataset.screen==='studentHome'"); screenshot("26-warm-resume");
        instrumentation.runOnMainSync(() -> activity.finish());
    }
}
