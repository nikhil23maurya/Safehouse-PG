package com.safehouse.pg;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

/** User-selected images only; no broad storage permission or file:// access. */
final class PaymentProofPicker extends WebChromeClient {
    static final int REQUEST = 9425;
    private final Activity activity;
    private ValueCallback<Uri[]> callback;
    PaymentProofPicker(Activity activity) { this.activity=activity; }
    @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> result, FileChooserParams params) {
        close(); callback=result;
        Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"image/jpeg","image/png","image/webp"});
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { activity.startActivityForResult(intent,REQUEST); }
        catch(Exception ignored){ close(); }
        return true;
    }
    boolean result(int request,int status,Intent data){
        if(request!=REQUEST)return false;
        ValueCallback<Uri[]> result=callback;callback=null;
        Uri uri=status==Activity.RESULT_OK&&data!=null?data.getData():null;
        try{if(uri!=null){
            String type=activity.getContentResolver().getType(uri);
            if(!"content".equals(uri.getScheme())||!("image/jpeg".equals(type)||"image/png".equals(type)||"image/webp".equals(type)))uri=null;
        }}catch(Exception ignored){uri=null;}
        if(result!=null)result.onReceiveValue(uri==null?null:new Uri[]{uri});return true;
    }
    void close(){ if(callback!=null){callback.onReceiveValue(null);callback=null;} }
}
