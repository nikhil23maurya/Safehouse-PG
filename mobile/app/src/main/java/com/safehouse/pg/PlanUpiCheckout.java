package com.safehouse.pg;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.ProgressDialog;
import android.content.Intent;
import android.content.Context;
import android.view.View;
import android.webkit.WebView;
import android.widget.FrameLayout;
import com.razorpay.Razorpay;
import com.razorpay.PaymentResultListener;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

/** One native checkout operation; independent of the app WebView's current screen. */
final class PlanUpiCheckout {
    interface Events { void result(String order, String status, String message); }
    static final class App {
        final String label, packageName;
        App(String label,String packageName){this.label=label==null||label.trim().isEmpty()?packageName:label;this.packageName=packageName;}
    }
    interface Apps { void ready(List<App> apps); void failed(String code); }
    interface Gateway {
        void discover(Apps callback);
        void submit(JSONObject payload,PaymentResultListener result) throws Exception;
        void activityResult(int request,int result,Intent data);
        void back();
    }
    interface Factory { Gateway create(Activity activity,String key,WebView view); }
    static final Factory OFFICIAL = (activity,key,view) -> {
        Razorpay sdk = new Razorpay(activity,key);
        sdk.setWebView(view);
        return new Gateway() {
            public void discover(Apps callback) {
                sdk.getPaymentMethods(new com.razorpay.PaymentMethodsCallback(){
                    public void onPaymentMethodsReceived(String raw) {
                        try {
                            JSONObject methods=new JSONObject(raw);
                            if(!methods.optBoolean("upi",false)){callback.failed("UPI_NOT_ENABLED");return;}
                            Razorpay.getAppsWhichSupportUpi(activity, discovered -> {
                                List<App> apps=new ArrayList<>();
                                java.util.HashSet<String> seen=new java.util.HashSet<>();
                                if(discovered!=null) for(com.razorpay.ApplicationDetails item:discovered) {
                                    String pkg=item.getPackageName();
                                    if(pkg!=null && pkg.matches("[A-Za-z0-9_.]+") && seen.add(pkg))
                                        apps.add(new App(item.getAppName(),pkg));
                                }
                                callback.ready(apps);
                            });
                        }catch(Exception e){callback.failed("SDK_DISCOVERY_ERROR");}
                    }
                    public void onError(String ignored){callback.failed("METHODS_UNAVAILABLE");}
                });
            }
            public void submit(JSONObject payload,PaymentResultListener result){sdk.submit(payload,result);}
            public void activityResult(int request,int result,Intent data){sdk.onActivityResult(request,result,data);}
            public void back(){sdk.onBackPressed();}
        };
    };
    private final Activity activity;
    private final FrameLayout host;
    private final Events events;
    private final Factory factory;
    private WebView view;
    private Gateway gateway;
    private AlertDialog chooser;
    private ProgressDialog progress;
    private String order;
    private boolean submitted;
    private final android.content.SharedPreferences prefs;

    PlanUpiCheckout(Activity activity,FrameLayout host,Events events){this(activity,host,events,OFFICIAL);}
    PlanUpiCheckout(Activity activity,FrameLayout host,Events events,Factory factory){
        this.activity=activity;this.host=host;this.events=events;this.factory=factory;
        prefs=activity.getSharedPreferences("pgone_plan_checkout",Context.MODE_PRIVATE);
        if(!prefs.getString("status","").isEmpty() && java.util.Arrays.asList("DISCOVERING","CHOOSING_APP","SUBMITTED").contains(prefs.getString("status","")))
            save(prefs.getString("order",""),"INTERRUPTED_CHECK_PROVIDER","Checkout was interrupted. Check payment status before retrying.");
    }
    String snapshot(){
        try{return new JSONObject().put("organisationId",prefs.getString("organisation"," ")).put("orderId",prefs.getString("order","")).put("status",prefs.getString("status","")).put("message",prefs.getString("message","")).toString();}
        catch(Exception e){return "{}";}
    }
    private void save(String id,String status,String message){
        prefs.edit().putString("order",id).putString("status",status).putString("message",message).apply();
    }
    private void emit(String status,String message){
        save(order,status,message);
        android.util.Log.i("PGOnePlan","stage="+status); // No key, payer, order or payment data.
        events.result(order,status,message);
    }
    void open(String raw){
        if(order!=null){events.result(order,submitted?"SUBMITTED":"CHOOSING_APP","A checkout is already open. Finish or cancel it first.");return;}
        try {
            JSONObject input=new JSONObject(raw);
            String id=input.optString("order_id"),key=input.optString("key");
            if(!"SIDELOAD".equals(BuildConfig.BILLING_DISTRIBUTION) || !id.matches("order_[A-Za-z0-9]+") ||
                !key.matches("rzp_(live|test)_[A-Za-z0-9]+") || input.optInt("amount")!=24900 || !"INR".equals(input.optString("currency")))
                throw new IllegalArgumentException("Invalid checkout session");
            order=id;submitted=false;
            prefs.edit().putString("organisation",input.optString("organisationId","")).apply();
            view=new WebView(activity);view.setVisibility(View.GONE);view.setBackgroundColor(android.graphics.Color.WHITE);
            view.getSettings().setJavaScriptEnabled(true);view.getSettings().setDomStorageEnabled(true);
            view.getSettings().setAllowFileAccess(false);view.getSettings().setAllowContentAccess(false);
            view.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            host.addView(view,new FrameLayout.LayoutParams(-1,-1));
            gateway=factory.create(activity,key,view);
            JSONObject payload=new JSONObject();
            for(String field:new String[]{"key","order_id","amount","currency","email"}) if(input.has(field)) payload.put(field,input.get(field));
            payload.put("method","upi");payload.put("_[flow]","intent");payload.put("description","PGOne monthly workspace access");
            String contact=input.optString("contact","").replaceAll("[ ()-]","");
            if(!contact.isEmpty() && contact.matches("(\\+91)?[6-9][0-9]{9}"))payload.put("contact",contact);
            emit("DISCOVERING","Finding your installed UPI apps…");
            progress=new ProgressDialog(activity);progress.setMessage("Finding UPI apps…");progress.setCancelable(true);
            progress.setOnCancelListener(d->finish("CANCELLED_BEFORE_SUBMIT","App selection cancelled. No payment was submitted."));progress.show();
            view.postDelayed(()->{if(id.equals(order)&&!submitted&&chooser==null)finish("APP_DISCOVERY_TIMEOUT","UPI app discovery timed out. Check your connection and retry.");},20000);
            gateway.discover(new Apps(){
                public void failed(String code){activity.runOnUiThread(()->{if(id.equals(order))finish("SDK_UNAVAILABLE","Razorpay could not prepare UPI checkout ("+code+"). Check payment status, then retry.");});}
                public void ready(List<App> apps){activity.runOnUiThread(()->{
                    if(!id.equals(order))return;
                    if(progress!=null){progress.dismiss();progress=null;}
                    if(apps==null||apps.isEmpty()){
                        boolean installed=!activity.getPackageManager().queryIntentActivities(new Intent(Intent.ACTION_VIEW,android.net.Uri.parse("upi://pay")),android.content.pm.PackageManager.MATCH_DEFAULT_ONLY).isEmpty();
                        finish("NO_SUPPORTED_APP",installed?"A UPI app is installed, but Razorpay did not return a supported app. Update the UPI app and retry; no payment was submitted.":"No supported UPI app was detected. Enable a supported UPI app and retry; no payment was submitted.");return;
                    }
                    emit("CHOOSING_APP","Choose your UPI app.");
                    String[] labels=new String[apps.size()];for(int i=0;i<apps.size();i++)labels[i]=apps.get(i).label;
                    chooser=new AlertDialog.Builder(activity).setTitle("PGOne · Pay ₹249").setItems(labels,(dialog,which)->{
                        if(!id.equals(order))return;
                        try {
                            chooser=null;payload.put("upi_app_package_name",apps.get(which).packageName);submitted=true;
                            view.setVisibility(View.VISIBLE);emit("SUBMITTED","Approve in your UPI app. PGOne checks payment with Razorpay.");
                            gateway.submit(payload,new PaymentResultListener(){
                                public void onPaymentSuccess(String ignored){activity.runOnUiThread(()->finish("RETURNED_CHECK_PROVIDER","Checking payment with Razorpay…"));}
                                public void onPaymentError(int code,String description){activity.runOnUiThread(()->finish("FAILED_OR_UNKNOWN_CHECK_PROVIDER","UPI checkout returned error "+code+". "+safeDescription(description)+" Check payment status before retrying."));}
                            });
                        }catch(Exception e){finish("SDK_UNAVAILABLE","UPI checkout could not start. Check payment status, then retry.");}
                    }).setNegativeButton("Cancel",(dialog,which)->finish("CANCELLED_BEFORE_SUBMIT","App selection cancelled. No payment was submitted."))
                      .setOnCancelListener(dialog->finish("CANCELLED_BEFORE_SUBMIT","App selection cancelled. No payment was submitted.")).create();
                    chooser.show();
                });}
            });
        }catch(Exception e){
            if(order!=null)finish("SDK_UNAVAILABLE","UPI checkout could not start. Check payment status, then retry.");
            else events.result("","SDK_UNAVAILABLE","The checkout session is incomplete. Refresh payment status and retry.");
        }
    }
    private static String safeDescription(String text){
        if(text==null)return "";
        String clean=text.replaceAll("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+","[redacted]")
            .replaceAll("rzp_(live|test)_[A-Za-z0-9]+|order_[A-Za-z0-9]+|pay_[A-Za-z0-9]+|[0-9]{6,}","[redacted]")
            .replaceAll("https?://\\S+","[link]");
        return clean.substring(0,Math.min(180,clean.length()));
    }
    private void finish(String status,String message){
        if(order==null)return;
        emit(status,message);order=null;gateway=null;submitted=false;
        if(progress!=null){progress.dismiss();progress=null;}
        if(chooser!=null){chooser.dismiss();chooser=null;}
        if(view!=null){host.removeView(view);view.stopLoading();view.destroy();view=null;}
    }
    boolean back(){if(order==null)return false;if(gateway!=null&&submitted)try{gateway.back();}catch(Exception ignored){}
        finish(submitted?"INTERRUPTED_CHECK_PROVIDER":"CANCELLED_BEFORE_SUBMIT",submitted?"Checkout interrupted. Check payment status before retrying.":"App selection cancelled. No payment was submitted.");return true;}
    void activityResult(int request,int result,Intent data){if(gateway!=null)try{gateway.activityResult(request,result,data);}catch(Exception e){finish("FAILED_OR_UNKNOWN_CHECK_PROVIDER","The UPI app returned an unreadable result. Check payment status before retrying.");}}
    void destroy(){if(order!=null)finish("INTERRUPTED_CHECK_PROVIDER","Checkout interrupted. Check payment status before retrying.");}
}
