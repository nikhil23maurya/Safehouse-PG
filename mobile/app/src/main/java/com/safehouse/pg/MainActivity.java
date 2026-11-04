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
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;
import com.razorpay.Checkout;
import com.razorpay.PaymentData;
import com.razorpay.PaymentResultWithDataListener;

import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity implements PaymentResultWithDataListener {
    static final String PREFS = "safehouse_native";
    static final String ACTION_FCM_REGISTRATION = "com.safehouse.pg.FCM_REGISTRATION";
    static final String EXTRA_INSTALLATION_ID = "installationId";
    static final String EXTRA_NOTIFICATION_ROUTE = "safehouse_route";
    static final String EXTRA_NOTIFICATION_PAYLOAD = "safehouse_payload";
    private static final int NOTIFICATION_PERMISSION_REQUEST = 9421;

    private WebView webView;
    private View splashView;
    private FrameLayout hostView;
    private SessionVault sessionVault;
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
        sessionVault = new SessionVault(this);
        hostView = new FrameLayout(this);
        hostView.setBackgroundColor(Color.WHITE);
        splashView = buildSplash();
        hostView.addView(splashView);
        setContentView(hostView);
        hostView.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
                callJs("window.SafeHouseKeyboard && window.SafeHouseKeyboard(" + insets.isVisible(WindowInsets.Type.ime()) + ");");
                return WindowInsets.CONSUMED;
            }
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        hostView.requestApplyInsets();
        Checkout.preload(getApplicationContext());
        createWebView();
    }

    private void configureSystemBars() {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= 30) window.setDecorFitsSystemWindows(false);
        window.setStatusBarColor(Color.rgb(255, 255, 255));
        window.setNavigationBarColor(Color.rgb(255, 255, 255));
        int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= 26) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        window.getDecorView().setSystemUiVisibility(flags);
    }

    private View buildSplash() {
        return new BrandSplash(this);
    }

    private void createWebView() {
        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setTextZoom(Math.round(getResources().getConfiguration().fontScale * 100));
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMediaPlaybackRequiresUserGesture(false);
        webView.addJavascriptInterface(new NativeBridge(), "SafeHouseNative");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isAssetUri(uri)) return false;
                if (request.isForMainFrame()) openExternal(uri.toString());
                return true;
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!"appassets.androidplatform.net".equals(uri.getHost())) return null;
                String path = uri.getPath();
                if (!isAssetUri(uri) || path == null) return missingAsset();
                String name = path.substring("/assets/".length());
                if (!("index.html".equals(name) || "app.js".equals(name) || "app.css".equals(name))) return missingAsset();
                try {
                    String mime = name.endsWith(".js") ? "application/javascript" : name.endsWith(".css") ? "text/css" : "text/html";
                    return new WebResourceResponse(mime, "UTF-8", 200, "OK", java.util.Collections.singletonMap("Cache-Control", "no-cache"), getAssets().open(name));
                } catch (Exception ignored) { return missingAsset(); }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (isAssetUri(Uri.parse(url))) { pageReady = true; flushNativeEvents(); }
            }
        });
        hostView.addView(webView, 0, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.loadUrl("https://appassets.androidplatform.net/assets/index.html");
    }

    private static boolean isAssetUri(Uri uri) {
        return "https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost()) && uri.getPath() != null && uri.getPath().startsWith("/assets/");
    }

    private static WebResourceResponse missingAsset() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", java.util.Collections.emptyMap(), new ByteArrayInputStream("Not found".getBytes(StandardCharsets.UTF_8)));
    }

    @Override protected void onResume() {
        super.onResume();
        if (webView != null) { webView.onResume(); callJs("window.SafeHouseResume && window.SafeHouseResume();"); }
    }

    @Override protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
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
        try {
            Uri target = Uri.parse(url == null ? "" : url);
            String scheme = target.getScheme(), host = target.getHost() == null ? "" : target.getHost().toLowerCase(java.util.Locale.ROOT);
            boolean allowed = "tel".equals(scheme) || "mailto".equals(scheme) || ("https".equals(scheme) &&
                ("wa.me".equals(host) || "api.whatsapp.com".equals(host) || "rzp.io".equals(host) || "razorpay.com".equals(host) || host.endsWith(".razorpay.com")));
            if (!allowed) { Toast.makeText(this, "Unsupported external link", Toast.LENGTH_SHORT).show(); return; }
            startActivity(new Intent(Intent.ACTION_VIEW, target));
        }
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
        if (webView != null && pageReady) {
            webView.evaluateJavascript("Boolean(window.SafeHouseBack && window.SafeHouseBack())", handled -> { if (!"true".equals(handled)) finish(); });
        } else super.onBackPressed();
    }

    public final class NativeBridge {
        @JavascriptInterface public String getSession() { return sessionVault.load(); }
        @JavascriptInterface public boolean saveSession(String value) { return sessionVault.save(value); }
        @JavascriptInterface public void ready() {
            runOnUiThread(() -> {
                pageReady = true;
                if (splashView != null) { hostView.removeView(splashView); splashView = null; }
                flushNativeEvents();
            });
        }
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

        // SAFEHOUSE_ATELIER_UPI_NATIVE_V3
        // Save the provider-issued QR without redirecting to a branded payment website.
        @JavascriptInterface
        public void savePaymentQr(String imageUrl) {
            runOnUiThread(() -> {
                try {
                    Uri uri = Uri.parse(imageUrl == null ? "" : imageUrl);
                    String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(java.util.Locale.ROOT);
                    if (!"https".equalsIgnoreCase(uri.getScheme()) ||
                        !("rzp.io".equals(host) || host.endsWith(".razorpay.com") || "razorpay.com".equals(host))) {
                        Toast.makeText(MainActivity.this, "Invalid payment QR provider", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    if (Build.VERSION.SDK_INT <= 28 && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                        requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, 9422);
                        Toast.makeText(MainActivity.this, "Allow storage access, then save the QR again", Toast.LENGTH_LONG).show(); return;
                    }
                    DownloadManager.Request request = new DownloadManager.Request(uri);
                    request.setTitle("SafeHouse Rent UPI QR");
                    request.setDescription("Save this payment QR and use Scan from Gallery in your UPI app");
                    request.setMimeType("image/png");
                    request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,
                        "SafeHouse-UPI-QR-" + System.currentTimeMillis() + ".png");
                    DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    dm.enqueue(request);
                    Toast.makeText(MainActivity.this, "QR download started. Open your UPI app and scan from gallery.", Toast.LENGTH_LONG).show();
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "QR could not be saved. Try using another device.", Toast.LENGTH_LONG).show();
                }
            });
        }

        @JavascriptInterface
        public void openUpiApp() {
            runOnUiThread(() -> {
                try {
                    String[] packages = {
                        "com.google.android.apps.nbu.paisa.user",
                        "com.phonepe.app",
                        "net.one97.paytm",
                        "in.org.npci.upiapp",
                        "in.amazon.mShop.android.shopping",
                        "com.dreamplug.androidapp"
                    };
                    java.util.ArrayList<Intent> targets = new java.util.ArrayList<>();
                    for (String p : packages) {
                        Intent launch = getPackageManager().getLaunchIntentForPackage(p);
                        if (launch != null) targets.add(launch);
                    }
                    if (targets.isEmpty()) {
                        Toast.makeText(MainActivity.this, "No supported UPI app was found", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    Intent first = targets.remove(0);
                    Intent chooser = Intent.createChooser(first, "Open your UPI app to scan saved QR");
                    if (!targets.isEmpty()) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, targets.toArray(new Intent[0]));
                    startActivity(chooser);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Could not launch a UPI app", Toast.LENGTH_SHORT).show();
                }
            });
        }


        /**
         * SAFEHOUSE_NATIVE_QR_UPI_V4
         * Decode only a Razorpay-generated QR image, validate the exact rupee
         * amount against the invoice, then let Android launch the UPI app.
         * App return results never credit rent: only backend capture can do that.
         */
        @JavascriptInterface
        public void openQrInUpiApp(String imageUrl, int amountPaise) {
            new Thread(() -> {
                try {
                    Uri imageUri = Uri.parse(imageUrl == null ? "" : imageUrl);
                    String h = imageUri.getHost() == null ? "" : imageUri.getHost().toLowerCase(java.util.Locale.ROOT);
                    if (!"https".equalsIgnoreCase(imageUri.getScheme()) ||
                        !("rzp.io".equals(h) || "razorpay.com".equals(h) || h.endsWith(".razorpay.com"))) {
                        throw new IllegalArgumentException("Unrecognised QR provider");
                    }
                    if (amountPaise < 100 || amountPaise > 100000000) {
                        throw new IllegalArgumentException("Invalid payment amount");
                    }
                    android.graphics.Bitmap bmp = ProviderQr.load(imageUri);
                    if (bmp == null || bmp.getWidth() < 80 || bmp.getHeight() < 80 ||
                        ((long)bmp.getWidth()) * bmp.getHeight() > 4000000) {
                        throw new IllegalArgumentException("QR image unavailable");
                    }
                    int width = bmp.getWidth(), height = bmp.getHeight();
                    int[] pixels = new int[width * height];
                    bmp.getPixels(pixels, 0, width, 0, 0, width, height);
                    bmp.recycle();
                    com.google.zxing.BinaryBitmap binary = new com.google.zxing.BinaryBitmap(
                        new com.google.zxing.common.HybridBinarizer(
                            new com.google.zxing.RGBLuminanceSource(width, height, pixels)));
                    String encoded = new com.google.zxing.qrcode.QRCodeReader().decode(binary).getText();
                    Uri payment = Uri.parse(encoded);
                    if (!"upi".equalsIgnoreCase(payment.getScheme()) ||
                        !"pay".equalsIgnoreCase(payment.getHost()) ||
                        payment.getQueryParameter("pa") == null ||
                        payment.getQueryParameter("pa").isEmpty()) {
                        throw new IllegalArgumentException("QR is not a valid UPI payment");
                    }
                    String currency = payment.getQueryParameter("cu");
                    if (currency != null && !"INR".equalsIgnoreCase(currency)) {
                        throw new IllegalArgumentException("Unexpected currency");
                    }
                    String amount = payment.getQueryParameter("am");
                    if (amount == null || amount.isEmpty()) throw new IllegalArgumentException("UPI QR is missing fixed amount");
                    java.math.BigDecimal paise = new java.math.BigDecimal(amount).multiply(new java.math.BigDecimal(100));
                    if (paise.intValueExact() != amountPaise) throw new IllegalArgumentException("QR amount mismatch");
                    runOnUiThread(() -> {
                        try {
                            Intent intent = new Intent(Intent.ACTION_VIEW, payment);
                            startActivity(Intent.createChooser(intent, "Pay rent with UPI"));
                        } catch (Exception e) {
                            callJs("window.SafeHouseUpiError && window.SafeHouseUpiError(" +
                                q("No UPI app could open the payment. Use the saved QR instead.") + ");");
                        }
                    });
                } catch (Exception e) {
                    callJs("window.SafeHouseUpiError && window.SafeHouseUpiError(" +
                        q("Direct UPI could not start. Save the QR and scan it from your UPI app gallery.") + ");");
                }
            }).start();
        }

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
            downloadReceipt(url, token, "", fileName);
        }

        @JavascriptInterface
        public void downloadReceipt(String url, String token, String propertyId, String fileName) {
            runOnUiThread(() -> {
                try {
                    Uri uri = Uri.parse(url == null ? "" : url);
                    if (!"https".equals(uri.getScheme()) || !"safehouse-api.onrender.com".equals(uri.getHost()) ||
                        uri.getPath() == null || !uri.getPath().matches("/api/(owner|student)/payments/[a-zA-Z0-9_-]+/receipt\\.pdf") || uri.getQuery() != null || uri.getUserInfo() != null) {
                        Toast.makeText(MainActivity.this, "Invalid receipt link", Toast.LENGTH_SHORT).show(); return;
                    }
                    if (Build.VERSION.SDK_INT <= 28 && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                        requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, 9422);
                        Toast.makeText(MainActivity.this, "Allow storage access, then download the receipt again", Toast.LENGTH_LONG).show(); return;
                    }
                    String safeName = fileName == null ? "SafeHouse-Receipt.pdf" : fileName.replaceAll("[^a-zA-Z0-9_.-]", "");
                    DownloadManager.Request request = new DownloadManager.Request(uri);
                    request.setTitle(safeName);
                    request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    if (token != null && !token.isEmpty()) request.addRequestHeader("Authorization", "Bearer " + token);
                    if (propertyId != null && !propertyId.isEmpty()) request.addRequestHeader("X-Property-Id", propertyId);
                    request.setMimeType("application/pdf");
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, safeName);
                    DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    dm.enqueue(request);
                    Toast.makeText(MainActivity.this, "Receipt download started", Toast.LENGTH_SHORT).show();
                } catch (Exception e) { Toast.makeText(MainActivity.this, "Could not download receipt", Toast.LENGTH_SHORT).show(); }
            });
        }
    }
}
