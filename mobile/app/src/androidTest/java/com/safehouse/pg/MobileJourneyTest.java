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
    private String shell(String command) throws Exception {
        try (android.os.ParcelFileDescriptor descriptor = instrumentation.getUiAutomation().executeShellCommand(command)) {
            return read(new java.io.FileInputStream(descriptor.getFileDescriptor()));
        }
    }
    private void setReceiverEnabled(boolean enabled) {
        android.content.ComponentName receiver = new android.content.ComponentName(instrumentation.getContext(), UpiFixtureActivity.class);
        int desired = enabled ? android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED : android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
        instrumentation.getUiAutomation().adoptShellPermissionIdentity();
        try {
            target.getPackageManager().setComponentEnabledSetting(receiver, desired, android.content.pm.PackageManager.DONT_KILL_APP);
            assertEquals("Test receiver state: " + receiver.flattenToString(), desired, target.getPackageManager().getComponentEnabledSetting(receiver));
        } finally { instrumentation.getUiAutomation().dropShellPermissionIdentity(); }
    }
    private String nativeTree(AccessibilityNodeInfo node) {
        if (node == null) return "(no active window)";
        StringBuilder text = new StringBuilder();
        text.append(node.getClassName()).append(" ").append(node.getText()).append(" ").append(node.getContentDescription()).append("\n");
        for (int i = 0; i < node.getChildCount(); i++) text.append(nativeTree(node.getChild(i)));
        return text.toString();
    }
    private boolean nativeText(String text) {
        AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow();
        return root != null && !root.findAccessibilityNodeInfosByText(text).isEmpty();
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
        screenshot(name, true);
    }
    private void screenshot(String name, boolean requireAppFocus) throws Exception {
        if (requireAppFocus) {
            await("Array.from(document.images).filter(i=>(i.getAttribute('src')||'').startsWith('illustration-')).every(i=>i.complete&&i.naturalWidth>0)");
            long deadline = System.currentTimeMillis() + 10000;
            AtomicReference<Boolean> focused = new AtomicReference<>(false);
            do {
                instrumentation.runOnMainSync(() -> focused.set(activity.hasWindowFocus()));
                if (!focused.get()) {
                    // A resource-constrained CI emulator can show a Pixel Launcher ANR
                    // over an otherwise healthy app. Dismiss only this exact system
                    // dialog; never suppress errors from the PGOne activity itself.
                    AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow();
                    if (root != null &&
                        !root.findAccessibilityNodeInfosByText("Pixel Launcher isn't responding").isEmpty()) {
                        java.util.List<AccessibilityNodeInfo> buttons =
                            root.findAccessibilityNodeInfosByText("Close app");
                        if (!buttons.isEmpty()) {
                            buttons.get(0).performAction(AccessibilityNodeInfo.ACTION_CLICK);
                            System.out.println("Dismissed Pixel Launcher ANR during emulator startup");
                        }
                    }
                    Thread.sleep(150);
                }
            } while (!focused.get() && System.currentTimeMillis() < deadline);
            if (!focused.get()) {
                captureBitmap(name + "-foreground-failure");
                android.os.ParcelFileDescriptor descriptor = instrumentation.getUiAutomation().executeShellCommand("dumpsys window windows");
                try (InputStream input = new java.io.FileInputStream(descriptor.getFileDescriptor()); FileOutputStream output = new FileOutputStream(new File(target.getExternalFilesDir(null), "qa/window-focus-failure.txt"))) {
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
                } finally { descriptor.close(); }
                fail("Activity did not return to the foreground: " + name);
            }
            CountDownLatch painted = new CountDownLatch(1);
            instrumentation.runOnMainSync(() -> web.postVisualStateCallback(System.nanoTime(), new WebView.VisualStateCallback() {
                @Override public void onComplete(long requestId) {
                    web.invalidate();
                    activity.getWindow().getDecorView().postInvalidateOnAnimation();
                    web.postOnAnimation(() -> web.postOnAnimation(painted::countDown));
                }
            }));
            assertTrue("WebView did not present the current frame: " + name, painted.await(10, TimeUnit.SECONDS));
        }
        // Allow short UI transitions and emulator composition to finish before capture.
        Thread.sleep(1200);
        captureBitmap(name);
    }
    private void captureBitmap(String name) throws Exception {
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
        setReceiverEnabled(false);
        new SessionVault(target).save("");
        Intent intent = target.getPackageManager().getLaunchIntentForPackage(target.getPackageName());
        assertNotNull("Launcher intent unavailable", intent);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        activity = instrumentation.startActivitySync(intent);
        instrumentation.runOnMainSync(() -> web = findWeb(activity.getWindow().getDecorView()));
        assertNotNull("WebView did not initialize", web);
        ((MainActivity)activity).providerQr = new ProviderQr(uri -> QrTestImages.poster(QrTestImages.PAYLOAD));
        await("document.querySelector('[data-action=entry]') || document.querySelector('[data-form=login]')");
        if("true".equals(js("Boolean(document.querySelector('[data-action=entry]'))"))){screenshot("00-premium-entry");js("document.querySelector('[data-action=entry][data-role=OWNER]').click()");await("document.querySelector('[data-route=login]')");}
        if ("true".equals(js("Boolean(document.querySelector('[data-route=login]'))"))) {
            js("document.querySelector('[data-route=login]').click()");
        }
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
        await("window.__nativeFixtures && (document.querySelector('[data-action=entry]') || document.querySelector('[data-form=login]'))");
        if("true".equals(js("Boolean(document.querySelector('[data-action=entry]'))"))){js("document.querySelector('[data-action=entry][data-role=OWNER]').click()");await("document.querySelector('[data-route=login]')");}
        if ("true".equals(js("Boolean(document.querySelector('[data-route=login]'))"))) {
            js("document.querySelector('[data-route=login]').click()");
        }
        await("document.querySelector('[data-form=login]')");
        screenshot("01-login");
        js("document.querySelector('[name=password]').focus()");
        instrumentation.runOnMainSync(() -> { web.requestFocus(); ((android.view.inputmethod.InputMethodManager)target.getSystemService(Context.INPUT_METHOD_SERVICE)).showSoftInput(web, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT); });
        Thread.sleep(1500);
        await("document.querySelector('[name=password]').getBoundingClientRect().bottom<visualViewport.height*.8");
        screenshot("02-login-keyboard");
        try (FileOutputStream info = new FileOutputStream(new File(target.getExternalFilesDir(null), "qa/keyboard-layout.txt"))) {
            info.write(js("JSON.stringify({height:innerHeight,visualHeight:visualViewport.height,focused:document.activeElement.tagName,input:document.querySelector('[name=password]').getBoundingClientRect().toJSON()})").getBytes(StandardCharsets.UTF_8));
        }
        instrumentation.runOnMainSync(() -> ((android.view.inputmethod.InputMethodManager)target.getSystemService(Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(web.getWindowToken(),0));
        signIn(false); screenshot("03-owner-home");
        assertTrue("Encrypted session did not restore", new SessionVault(target).load().contains("fixture_OWNER_access"));
        assertFalse("Plaintext session must not be in preferences", target.getSharedPreferences("safehouse_secure_session", Context.MODE_PRIVATE).getString("ciphertext", "").contains("fixture_OWNER_access"));
        js("window.__beforeReload=true");
        instrumentation.runOnMainSync(() -> web.reload());
        await("!window.__beforeReload&&window.__nativeFixtures&&document.getElementById('app').dataset.screen==='ownerHome'"); screenshot("04-session-restored");
        go("residents", "{}"); screenshot("05-residents");
        go("resident", "{id:'resident1'}"); screenshot("06-resident");
        go("residentForm", "{}"); screenshot("07-add-resident");
        js("document.querySelector('[name=fullName]').value='Draft kept on rotation';document.querySelector('[name=fullName]').dispatchEvent(new Event('input',{bubbles:true}));");
        instrumentation.runOnMainSync(() -> activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
        await("innerWidth>innerHeight");
        assertEquals("true", js("document.querySelector('[name=fullName]').value==='Draft kept on rotation'"));
        screenshot("07b-form-landscape");
        instrumentation.runOnMainSync(() -> activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
        await("innerHeight>innerWidth");
        assertEquals("true", js("document.querySelector('[name=fullName]').value==='Draft kept on rotation'"));
        js("document.querySelector('[data-action=back]').click()"); await("document.querySelector('[data-action=dialog-confirm]')");
        js("document.querySelector('[data-action=dialog-confirm]').click()"); await("!document.querySelector('[data-form=resident]')");
        go("rooms", "{}"); screenshot("08-rooms");
        go("room", "{id:'room1'}"); screenshot("09-room");
        go("roomForm", "{}"); screenshot("10-add-room");
        go("dues", "{}"); screenshot("11-dues");
        go("invoice", "{id:'invoice1',residentId:'resident1'}"); screenshot("12-invoice");
        go("manualPayment", "{id:'invoice1',residentId:'resident1'}"); screenshot("13-record-payment");
        go("invoiceCharges", "{id:'invoice1',residentId:'resident1'}"); screenshot("14-charges");
        go("ownerPayments", "{}"); screenshot("15-owner-payments");
        go("notifications", "{}"); screenshot("16-notifications");
        if (!"true".equals(js("SafeHouseNative.notificationPermissionStatus()==='granted'"))) {
            js("SafeHouseNative.requestNotificationPermission()");
            long permissionDeadline = System.currentTimeMillis() + 15000;
            boolean allowed = false;
            do {
                AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow();
                if (root != null) for (AccessibilityNodeInfo node : root.findAccessibilityNodeInfosByText("Allow")) {
                    if (node.getText() != null && "Allow".equalsIgnoreCase(node.getText().toString())) {
                        screenshot("16b-notification-permission", false); node.performAction(AccessibilityNodeInfo.ACTION_CLICK); allowed = true; break;
                    }
                }
                if (!allowed) Thread.sleep(200);
            } while (!allowed && System.currentTimeMillis() < permissionDeadline);
            assertTrue("Notification permission prompt unavailable", allowed);
            await("SafeHouseNative.notificationPermissionStatus()==='granted'");
        }
        screenshot("16c-notification-allowed");
        go("notificationForm", "{}"); screenshot("17-compose");
        go("properties", "{}"); screenshot("18-properties");
        go("profile", "{}"); screenshot("19-owner-profile");
        instrumentation.runOnMainSync(() -> web.getSettings().setTextZoom(130));
        go("ownerHome", "{}"); screenshot("19b-larger-text");
        instrumentation.runOnMainSync(() -> web.getSettings().setTextZoom(100));
        go("profile", "{}");
        js("document.querySelector('[data-action=logout]').click()"); await("document.querySelector('[data-action=dialog-confirm]')");
        js("document.querySelector('[data-action=dialog-confirm]').click()"); await("document.querySelector('[data-form=login]')");
        signIn(true); screenshot("20-resident-home");
        go("invoices", "{}"); screenshot("21-invoices");
        go("history", "{}"); screenshot("22-history");
        go("payment", "{invoiceId:'invoice1'}"); await("Boolean(document.querySelector('[data-payment-qr]')?.complete && document.querySelector('[data-payment-qr]')?.naturalWidth>0)"); screenshot("23-payment-qr");
        assertEquals("true", js("document.querySelector('[data-payment-qr]').src.startsWith('https://appassets.androidplatform.net/assets/payment-qr.png?')"));
        assertEquals("true", js("document.querySelector('[data-payment-qr]').naturalWidth===document.querySelector('[data-payment-qr]').naturalHeight"));
        js("document.querySelector('[data-action=upi]').click()");
        await("document.querySelector('.upi-help')");
        assertTrue(js("document.querySelector('.upi-help').innerText").contains("No compatible UPI app"));
        screenshot("23b-upi-no-app");
        setReceiverEnabled(true);
        try {
            Intent upiQuery = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(QrTestImages.PAYLOAD));
            long registrationDeadline = System.currentTimeMillis() + 5000;
            java.util.List<android.content.pm.ResolveInfo> handlers;
            do {
                handlers = target.getPackageManager().queryIntentActivities(upiQuery, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY);
                if (handlers.isEmpty()) Thread.sleep(150);
            } while (handlers.isEmpty() && System.currentTimeMillis() < registrationDeadline);
            assertFalse("Enabled receiver is not visible to Android: " + shell("dumpsys package " + instrumentation.getContext().getPackageName()), handlers.isEmpty());
            js("document.querySelector('[data-action=upi]').click()");
            long chooserDeadline = System.currentTimeMillis() + 15000;
            while (!nativeText("UPI Test Receiver") && !nativeText("UPI handoff received") && System.currentTimeMillis() < chooserDeadline) Thread.sleep(150);
            if (!nativeText("UPI handoff received")) {
                AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow();
                assertNotNull("UPI chooser unavailable", root);
                java.util.List<AccessibilityNodeInfo> choices = root.findAccessibilityNodeInfosByText("UPI Test Receiver");
                if (choices.isEmpty()) {
                    captureBitmap("23c-upi-chooser-failure");
                    String state = nativeTree(root) + "\nWEB: " + js("document.body.innerText");
                    try (FileOutputStream output = new FileOutputStream(new File(target.getExternalFilesDir(null), "qa/upi-chooser-failure.txt"))) { output.write(state.getBytes(StandardCharsets.UTF_8)); }
                    fail("Compatible app not in chooser: " + state);
                }
                AccessibilityNodeInfo choice = choices.get(0);
                while (!choice.isClickable() && choice.getParent() != null) choice = choice.getParent();
                choice.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            }
            long handoffDeadline = System.currentTimeMillis() + 10000;
            while (!nativeText("UPI handoff received") && System.currentTimeMillis() < handoffDeadline) Thread.sleep(150);
            assertTrue("UPI receiver not launched", nativeText("UPI handoff received"));
            assertTrue("Provider payload changed during handoff", nativeText(QrTestImages.PAYLOAD));
            screenshot("23c-upi-handoff-receiver", false);
            instrumentation.getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);
            await("Boolean(document.querySelector('[data-payment-qr]')?.complete && document.querySelector('[data-payment-qr]')?.naturalWidth>0)");
            screenshot("23d-upi-return-pending");
        } finally { setReceiverEnabled(false); }
        assertEquals("false", js("document.body.innerText.includes('Payment Successful')"));
        js("window.__nativeFixtures.control.paymentState='CAPTURED';document.querySelector('[data-action=checkPayment]').click()");
        await("document.querySelector('.success-amount')"); screenshot("24-payment-success");
        assertTrue(js("document.body.innerText").contains("pay_fixture1"));
        instrumentation.runOnMainSync(() -> activity.onBackPressed());
        await("!document.querySelector('.success-amount')"); screenshot("25-hardware-back");
        go("studentHome", "{}");
        instrumentation.runOnMainSync(() -> { activity.moveTaskToBack(true); });
        Thread.sleep(300);
        Intent resumeIntent = target.getPackageManager().getLaunchIntentForPackage(target.getPackageName());
        assertNotNull(resumeIntent);
        resumeIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        instrumentation.runOnMainSync(() -> target.startActivity(resumeIntent));
        await("document.getElementById('app').dataset.screen==='studentHome'"); screenshot("26-warm-resume");
        js("document.querySelector('[data-route=profile]').click()");
        await("document.querySelector('[data-action=logout]')");
        js("document.querySelector('[data-action=logout]').click()");
        await("document.querySelector('[data-action=dialog-confirm]')");
        js("document.querySelector('[data-action=dialog-confirm]').click()");
        await("document.querySelector('[data-form=login]')");
        js("window.__platformFixtureEnabled=true");
        go("welcome", "{}");
        js("document.querySelector('[data-action=entry][data-role=OWNER]').click()");
        await("document.querySelector('[data-form=signup]')"); screenshot("40-create-account");
        js("document.querySelector('[name=email]').value='rahul@example.test';document.querySelector('[name=password]').value='Private password 123!';document.querySelector('[name=confirmPassword]').value='Private password 123!';document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));");

        await("document.querySelector('[data-form=setupProfile]')"); screenshot("43-owner-profile");
        js("document.querySelector('[name=fullName]').value='Rahul Sharma';document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));");
        await("document.querySelector('[data-form=setupProperty]')"); screenshot("44-create-pg");
        js("document.querySelector('[name=name]').value='Maple House';document.querySelector('[name=city]').value='Bengaluru';document.querySelector('[name=approximateRooms]').value='12';document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));");
        await("document.getElementById('app').dataset.screen==='subscription'"); screenshot("45-unpaid-activation");
        assertEquals("A PG must be created only once", "1", js("window.__platformFixtures.propertiesCreated"));
        assertEquals("Owner dashboard must not unlock without a verified payment", "false", js("window.__platformFixtures.handler('https://fixture.test/api/platform/session',{}).memberships[0].organisation.entitled"));
        js("history.pushState({name:'ownerHome',params:{},depth:1},'','#ownerHome');dispatchEvent(new PopStateEvent('popstate',{state:history.state}));");
        await("document.getElementById('app').dataset.screen==='subscription'");
        screenshot("45b-unpaid-dashboard-blocked");
        js("history.pushState({name:'merchant',params:{},depth:1},'','#merchant');dispatchEvent(new PopStateEvent('popstate',{state:history.state}));");
        await("document.getElementById('app').dataset.screen==='subscription'");
        go("workspaces", "{}"); screenshot("46-workspaces");
        go("subscription", "{}"); screenshot("47-plan");
        assertEquals("No external purchase funnel in Android", "true", js("![...document.querySelectorAll('button,a')].some(e=>/buy|subscribe|pay now|upgrade/i.test(e.textContent))"));
        js("window.__platformFixtures.activatePaid()");
        go("workspaces", "{}");
        js("document.querySelector('[data-action=workspace]').click()");
        await("document.getElementById('app').dataset.screen==='ownerHome'");
        go("pgCode", "{}"); screenshot("45c-verified-paid-pg-code");
        go("merchant", "{}"); screenshot("48-merchant");
        assertEquals("No premature bank/KYC collection", "0", js("document.querySelectorAll('input').length"));
        go("invitations", "{}"); screenshot("49-invitations");
        go("joinWorkspace", "{}"); screenshot("50-join-pg");
        instrumentation.runOnMainSync(() -> activity.finish());
    }
}
