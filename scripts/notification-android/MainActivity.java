package com.safehouse.pg;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;
import com.razorpay.Checkout;
import com.razorpay.PaymentData;
import com.razorpay.PaymentResultWithDataListener;

import org.json.JSONObject;

public class MainActivity extends Activity implements PaymentResultWithDataListener {
    static final String PREFS = "safehouse_native";
    static final String ACTION_FCM_REGISTRATION = "com.safehouse.pg.FCM_REGISTRATION";
    static final String EXTRA_INSTALLATION_ID = "installationId";
    static final String EXTRA_NOTIFICATION_ROUTE = "safehouse_route";
    static final String EXTRA_NOTIFICATION_PAYLOAD = "safehouse_payload";
    private static final int NOTIFICATION_PERMISSION_REQUEST = 9421;

    private WebView webView;
    private View splashView;
    private boolean pageReady = false;
    private boolean registrationReceiverAdded = false;
    private String pendingNotificationRoute;
    private String pendingNotificationPayload;

    private final BroadcastReceiver registrationReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String installationId = intent.getStringExtra(EXTRA_INSTALLATION_ID);
            if (installationId != null && !installationId.isEmpty()) {
                callJs("window.SafeHouseNotificationRegistration && window.SafeHouseNotificationRegistration(" + q(installationId) + ");");
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureSystemBars();
        registerFcmReceiver();
        handleNotificationIntent(getIntent(), false);
        splashView = buildSplash();
        setContentView(splashView);
        Checkout.preload(getApplicationContext());
        createWebView();
    }

    private void configureSystemBars() {
        Window window = getWindow();
        window.setStatusBarColor(Color.WHITE);
        window.setNavigationBarColor(Color.WHITE);
        int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= 26) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        window.getDecorView().setSystemUiVisibility(flags);
    }

    private View buildSplash() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(dp(28), dp(28), dp(28), dp(28));
        root.setBackgroundColor(Color.WHITE);

        TextView mark = new TextView(this);
        mark.setText("⌂");
        mark.setTextColor(Color.WHITE);
        mark.setTextSize(40);
        mark.setGravity(Gravity.CENTER);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.rgb(36, 99, 235));
        bg.setCornerRadius(dp(23));
        mark.setBackground(bg);
        LinearLayout.LayoutParams markLp = new LinearLayout.LayoutParams(dp(78), dp(78));
        markLp.bottomMargin = dp(16);
        root.addView(mark, markLp);

        TextView name = new TextView(this);
        name.setText("SafeHouse");
        name.setTextColor(Color.rgb(23, 32, 51));
        name.setTextSize(25);
        name.setGravity(Gravity.CENTER);
        name.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        root.addView(name, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView tagline = new TextView(this);
        tagline.setText("Rent. Rooms. Residents. Effortlessly.");
        tagline.setTextColor(Color.rgb(133, 144, 160));
        tagline.setTextSize(11.5f);
        tagline.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams tagLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        tagLp.topMargin = dp(7);
        root.addView(tagline, tagLp);
        return root;
    }

    private void createWebView() {
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(247, 248, 251));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMediaPlaybackRequiresUserGesture(false);
        webView.addJavascriptInterface(new NativeBridge(), "SafeHouseNative");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                String host = uri.getHost();
                if ("tel".equalsIgnoreCase(scheme) || "mailto".equalsIgnoreCase(scheme) || "whatsapp".equalsIgnoreCase(scheme) || "wa.me".equalsIgnoreCase(host)) {
                    openExternal(uri.toString());
                    return true;
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                if (webView.getParent() == null || splashView != null) setContentView(webView);
                splashView = null;
                flushNativeEvents();
            }
        });
        webView.loadUrl("file:///android_asset/index.html");
    }

    private void flushNativeEvents() {
        if (!pageReady) return;
        String installationId = getSharedPreferences(PREFS, MODE_PRIVATE).getString(EXTRA_INSTALLATION_ID, "");
        if (installationId != null && !installationId.isEmpty()) {
            callJs("window.SafeHouseNotificationRegistration && window.SafeHouseNotificationRegistration(" + q(installationId) + ");");
        }
        if (pendingNotificationRoute != null) {
            String route = pendingNotificationRoute;
            String payload = pendingNotificationPayload == null ? "{}" : pendingNotificationPayload;
            pendingNotificationRoute = null;
            pendingNotificationPayload = null;
            callJs("window.SafeHouseNotificationOpened && window.SafeHouseNotificationOpened(" + q(route) + "," + q(payload) + ");");
        }
    }

    private void handleNotificationIntent(Intent intent, boolean deliverNow) {
        if (intent == null) return;
        String route = intent.getStringExtra(EXTRA_NOTIFICATION_ROUTE);
        if (route == null || route.isEmpty()) return;
        pendingNotificationRoute = route;
        pendingNotificationPayload = intent.getStringExtra(EXTRA_NOTIFICATION_PAYLOAD);
        if (deliverNow) flushNativeEvents();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleNotificationIntent(intent, true);
    }

    private void registerFcmReceiver() {
        IntentFilter filter = new IntentFilter(ACTION_FCM_REGISTRATION);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(registrationReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(registrationReceiver, filter);
        registrationReceiverAdded = true;
    }

    @Override
    protected void onDestroy() {
        if (registrationReceiverAdded) {
            try { unregisterReceiver(registrationReceiver); } catch (Exception ignored) {}
        }
        super.onDestroy();
    }

    static boolean initializeFirebaseFromPreferences(Context context) {
        try { FirebaseApp.getInstance(); return true; } catch (Exception ignored) {}
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String projectId = prefs.getString("firebase_project_id", "");
        String appId = prefs.getString("firebase_app_id", "");
        String apiKey = prefs.getString("firebase_api_key", "");
        String senderId = prefs.getString("firebase_sender_id", "");
        if (projectId == null || projectId.isEmpty() || appId == null || appId.isEmpty() || apiKey == null || apiKey.isEmpty() || senderId == null || senderId.isEmpty()) return false;
        try {
            FirebaseOptions options = new FirebaseOptions.Builder().setProjectId(projectId).setApplicationId(appId).setApiKey(apiKey).setGcmSenderId(senderId).build();
            FirebaseApp.initializeApp(context.getApplicationContext(), options);
            return true;
        } catch (Exception error) { return false; }
    }

    private boolean hasNotificationPermission() {
        return Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private void registerWithFcm() {
        if (!initializeFirebaseFromPreferences(this) || !hasNotificationPermission()) return;
        try {
            FirebaseMessaging.getInstance().setAutoInitEnabled(true);
            FirebaseMessaging.getInstance().register().addOnFailureListener(error -> callJs("window.SafeHouseNotificationPermissionResult && window.SafeHouseNotificationPermissionResult(" + q("registration_failed") + ");"));
        } catch (Exception ignored) {}
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != NOTIFICATION_PERMISSION_REQUEST) return;
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (granted) registerWithFcm();
        callJs("window.SafeHouseNotificationPermissionResult && window.SafeHouseNotificationPermissionResult(" + q(granted ? "granted" : "denied") + ");");
    }

    private void openExternal(String url) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
        catch (ActivityNotFoundException ex) { Toast.makeText(this, "No app found to open this link", Toast.LENGTH_SHORT).show(); }
    }

    @Override
    public void onPaymentSuccess(String razorpayPaymentId, PaymentData paymentData) {
        String orderId = paymentData != null ? paymentData.getOrderId() : "";
        String paymentId = paymentData != null && paymentData.getPaymentId() != null ? paymentData.getPaymentId() : razorpayPaymentId;
        String signature = paymentData != null ? paymentData.getSignature() : "";
        callJs("window.SafeHousePaymentSuccess && window.SafeHousePaymentSuccess(" + q(orderId) + "," + q(paymentId) + "," + q(signature) + ");");
    }

    @Override
    public void onPaymentError(int code, String response, PaymentData paymentData) {
        String message = "Payment was not completed";
        try {
            JSONObject payload = new JSONObject(response == null ? "{}" : response);
            JSONObject error = payload.optJSONObject("error");
            if (error != null) message = error.optString("description", message); else message = payload.optString("description", message);
        } catch (Exception ignored) {}
        callJs("window.SafeHousePaymentError && window.SafeHousePaymentError(" + q(message) + ");");
    }

    private void callJs(String js) {
        runOnUiThread(() -> { if (webView != null && pageReady) webView.evaluateJavascript(js, null); });
    }
    private static String q(String value) { return JSONObject.quote(value == null ? "" : value); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }

    public final class NativeBridge {
        @JavascriptInterface
        public void openRazorpay(String optionsJson) {
            runOnUiThread(() -> {
                try {
                    JSONObject options = new JSONObject(optionsJson);
                    Checkout checkout = new Checkout();
                    String keyId = options.optString("key", "");
                    if (!keyId.isEmpty()) checkout.setKeyID(keyId);
                    checkout.open(MainActivity.this, options);
                } catch (Exception e) { callJs("window.SafeHousePaymentError && window.SafeHousePaymentError(" + q("Unable to open secure payment. Please try again.") + ");"); }
            });
        }

        @JavascriptInterface public void openExternal(String url) { runOnUiThread(() -> MainActivity.this.openExternal(url)); }

        @JavascriptInterface
        public void configureNotifications(String configJson) {
            runOnUiThread(() -> {
                try {
                    JSONObject input = new JSONObject(configJson == null ? "{}" : configJson);
                    String projectId = input.optString("projectId", "").trim();
                    String appId = input.optString("applicationId", "").trim();
                    String apiKey = input.optString("apiKey", "").trim();
                    String senderId = input.optString("senderId", "").trim();
                    if (projectId.isEmpty() || appId.isEmpty() || apiKey.isEmpty() || senderId.isEmpty()) return;
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("firebase_project_id", projectId).putString("firebase_app_id", appId).putString("firebase_api_key", apiKey).putString("firebase_sender_id", senderId).apply();
                    if (hasNotificationPermission()) registerWithFcm();
                } catch (Exception ignored) {}
            });
        }

        @JavascriptInterface public String getNotificationInstallationId() { return getSharedPreferences(PREFS, MODE_PRIVATE).getString(EXTRA_INSTALLATION_ID, ""); }
        @JavascriptInterface public String notificationPermissionStatus() { return hasNotificationPermission() ? "granted" : "denied"; }

        @JavascriptInterface
        public void requestNotificationPermission() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
                else { registerWithFcm(); callJs("window.SafeHouseNotificationPermissionResult && window.SafeHouseNotificationPermissionResult(" + q("granted") + ");"); }
            });
        }

        @JavascriptInterface
        public void downloadFile(String url, String token, String fileName) {
            runOnUiThread(() -> {
                try {
                    DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                    request.setTitle(fileName == null || fileName.isEmpty() ? "SafeHouse Receipt.pdf" : fileName);
                    request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    if (token != null && !token.isEmpty()) request.addRequestHeader("Authorization", "Bearer " + token);
                    request.setMimeType("application/pdf");
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName == null || fileName.isEmpty() ? "SafeHouse-Receipt.pdf" : fileName);
                    DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    dm.enqueue(request);
                    Toast.makeText(MainActivity.this, "Receipt download started", Toast.LENGTH_SHORT).show();
                } catch (Exception e) { Toast.makeText(MainActivity.this, "Could not download receipt", Toast.LENGTH_SHORT).show(); }
            });
        }
    }
}
