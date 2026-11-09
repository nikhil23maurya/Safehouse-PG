package com.safehouse.pg;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/** Provider KYC is isolated from PGOne's vault and JavaScript/native bridge. */
public final class MerchantOnboardingActivity extends Activity {
    private WebView web;
    private ValueCallback<Uri[]> fileChoice;
    private static final int PICK_DOCUMENT = 9431;

    static boolean allowedInitialUrl(String value) {
        try {
            Uri uri = Uri.parse(value);
            return "https".equals(uri.getScheme()) && uri.getUserInfo() == null && uri.getPort() == -1 &&
                "merchant.cashfree.com".equals(uri.getHost());
        } catch (Exception ignored) { return false; }
    }
    private boolean providerUrl(Uri uri) {
        String host = uri.getHost();
        return "https".equals(uri.getScheme()) && uri.getUserInfo() == null && uri.getPort() == -1 && host != null &&
            (host.equals("cashfree.com") || host.endsWith(".cashfree.com"));
    }
    private boolean returned(Uri uri) {
        return "https".equals(uri.getScheme()) && "safehouse-api.onrender.com".equals(uri.getHost()) &&
            "/merchant-return".equals(uri.getPath()) && uri.getUserInfo() == null && uri.getPort() == -1;
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        String url = getIntent().getStringExtra("onboardingUrl");
        if (!allowedInitialUrl(url)) { finish(); return; }
        LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL); layout.setBackgroundColor(Color.WHITE);
        TextView close = new TextView(this); close.setText("‹   PGOne · Secure owner setup"); close.setTextColor(Color.rgb(9,45,134));
        close.setTextSize(17); close.setGravity(Gravity.CENTER_VERTICAL); close.setPadding(dp(20),0,dp(20),0);
        close.setContentDescription("Close secure owner setup and return to PGOne"); close.setOnClickListener(v -> finish());
        layout.addView(close,new LinearLayout.LayoutParams(-1,dp(60)));
        TextView note = new TextView(this); note.setText("Cashfree verifies your documents and settlement account.");
        note.setTextColor(Color.rgb(85,99,125)); note.setTextSize(12); note.setPadding(dp(20),dp(8),dp(20),dp(12));
        layout.addView(note,new LinearLayout.LayoutParams(-1,-2));
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false); settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setSaveFormData(false);
        // Deliberately no addJavascriptInterface: untrusted provider frames cannot read PGOne tokens.
        web.setWebViewClient(new WebViewClient() {
            private boolean navigate(Uri uri) {
                if (returned(uri)) {
                    Toast.makeText(MerchantOnboardingActivity.this,"Refresh setup status in PGOne to check provider confirmation.",Toast.LENGTH_LONG).show();
                    finish(); return true;
                }
                if (providerUrl(uri)) return false;
                // Required third-party KYC authorisation can use the system browser, never PGOne's bridged WebView.
                if ("https".equals(uri.getScheme()) && uri.getUserInfo() == null) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW,uri)); }
                    catch (Exception ignored) { Toast.makeText(MerchantOnboardingActivity.this,"This verification link is unavailable.",Toast.LENGTH_LONG).show(); }
                }
                return true;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return request.isForMainFrame() && navigate(request.getUrl()); }
            @Override public boolean shouldOverrideUrlLoading(WebView view,String target) { return navigate(Uri.parse(target)); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params) {
                if (fileChoice != null) fileChoice.onReceiveValue(null);
                fileChoice = callback;
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT); picker.addCategory(Intent.CATEGORY_OPENABLE);
                picker.setType("*/*"); picker.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"application/pdf","image/*"});
                try { startActivityForResult(picker,PICK_DOCUMENT); }
                catch (Exception ignored) { fileChoice.onReceiveValue(null); fileChoice = null; }
                return true;
            }
        });
        layout.addView(web,new LinearLayout.LayoutParams(-1,0,1)); setContentView(layout); web.loadUrl(url);
    }
    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if (request == PICK_DOCUMENT && fileChoice != null) {
            Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
            fileChoice.onReceiveValue(uri == null ? null : new Uri[]{uri}); fileChoice = null;
        }
    }
    @Override public void onBackPressed() { if (web != null && web.canGoBack()) web.goBack(); else finish(); }
    @Override protected void onDestroy() {
        if (fileChoice != null) { fileChoice.onReceiveValue(null); fileChoice = null; }
        if (web != null) { web.stopLoading(); web.loadUrl("about:blank"); web.clearHistory(); web.removeAllViews(); web.destroy(); web = null; }
        super.onDestroy();
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
