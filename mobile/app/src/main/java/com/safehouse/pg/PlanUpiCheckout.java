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
            public void submit(JSONObject payload,PaymentResultListener result) throws Exception {sdk.submit(payload,result);}
            public void activityResult(int request,int result,Intent data){sdk.onActivityResult(request,result,data);}
            public void back(){sdk.onBackPressed();}
        };
    };
    private final Activity activity;
    private final FrameLayout host;
    private final Events events;
    private final Factory factory;
    private final boolean ownerRent;
    private WebView view;
    private Gateway gateway;
    private AlertDialog chooser;
    private AlertDialog progress;
    private String order;
    private boolean submitted;
    private final android.content.SharedPreferences prefs;

    PlanUpiCheckout(Activity activity,FrameLayout host,Events events){this(activity,host,events,OFFICIAL);}
    PlanUpiCheckout(Activity activity,FrameLayout host,Events events,Factory factory){this(activity,host,events,factory,false);}
    PlanUpiCheckout(Activity activity,FrameLayout host,Events events,boolean ownerRent){this(activity,host,events,OFFICIAL,ownerRent);}
    PlanUpiCheckout(Activity activity,FrameLayout host,Events events,Factory factory,boolean ownerRent){
        this.activity=activity;this.host=host;this.events=events;this.factory=factory;
        this.ownerRent=ownerRent;
        prefs=activity.getSharedPreferences(ownerRent?"pgone_owner_rent_checkout":"pgone_plan_checkout",Context.MODE_PRIVATE);
        if(!prefs.getString("status","").isEmpty() && java.util.Arrays.asList("DISCOVERING","CHOOSING_APP","SUBMITTED").contains(prefs.getString("status","")))
            save(prefs.getString("order",""),"INTERRUPTED_CHECK_PROVIDER","Checkout was interrupted. Check payment status before retrying.");
    }
    String snapshot(){
        try{JSONObject value=new JSONObject().put("organisationId",prefs.getString("organisation"," ")).put("orderId",prefs.getString("order","")).put("status",prefs.getString("status","")).put("message",prefs.getString("message",""));
            if(ownerRent)for(String field:new String[]{"invoiceId","rentOrderId","membershipId"})value.put(field,prefs.getString(field,""));return value.toString();}
        catch(Exception e){return "{}";}
    }
    void acknowledge(String id){
        if(id!=null&&id.equals(prefs.getString("order",""))&&order==null)prefs.edit().clear().apply();
    }
    boolean busy(){return order!=null;}
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
        String attemptOrder="";
        try {
            JSONObject input=new JSONObject(raw);
            attemptOrder=input.optString("order_id","");
            String id=input.optString("order_id"),key=input.optString("key");
            boolean validProfile=ownerRent
                ? key.matches("rzp_(live|test)_oauth_[A-Za-z0-9]+") && input.optInt("amount")>=100 && input.optString("invoiceId").matches("[A-Za-z0-9_-]{1,100}") && input.optString("rentOrderId").matches("[A-Za-z0-9_-]{1,100}") && input.optString("membershipId").matches("[A-Za-z0-9_-]{1,100}")
                : "SIDELOAD".equals(BuildConfig.BILLING_DISTRIBUTION) && key.matches("rzp_(live|test)_[A-Za-z0-9]+") && (input.optInt("amount")==100 || input.optInt("amount")==24900);
            if(!validProfile || !id.matches("order_[A-Za-z0-9]+") || !"INR".equals(input.optString("currency")))
                throw new IllegalArgumentException("Invalid checkout session");
            if(paymentContact(input.optString("contact", ""))==null){
                events.result(id,"INVALID_PAYMENT_CONTACT","Enter a valid mobile number for payment.");return;
            }
            JSONObject payload=ownerRent?rentPaymentPayload(input):paymentPayload(input);
            order=id;submitted=false;
            prefs.edit().putString("organisation",input.optString("organisationId","")).apply();
            if(ownerRent){android.content.SharedPreferences.Editor edit=prefs.edit();for(String field:new String[]{"invoiceId","rentOrderId","membershipId"})edit.putString(field,input.optString(field,""));edit.apply();}
            view=new WebView(activity);view.setVisibility(View.GONE);view.setBackgroundColor(android.graphics.Color.WHITE);
            view.getSettings().setJavaScriptEnabled(true);view.getSettings().setDomStorageEnabled(true);
            view.getSettings().setAllowFileAccess(false);view.getSettings().setAllowContentAccess(false);
            view.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            host.addView(view,new FrameLayout.LayoutParams(-1,-1));
            gateway=factory.create(activity,key,view);
            emit("DISCOVERING","Finding your installed UPI apps…");
            progress=new AlertDialog.Builder(activity).setTitle("PGOne · Finding UPI apps").setView(new BouncingDotsView(activity)).create();progress.setCancelable(true);
            progress.setOnCancelListener(d->finish("CANCELLED_BEFORE_SUBMIT","App selection cancelled. No payment was submitted."));progress.show();polishDialog(progress);
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
                    String amountLabel=java.math.BigDecimal.valueOf(input.getLong("amount"),2).stripTrailingZeros().toPlainString();
                    chooser=new AlertDialog.Builder(activity).setTitle(ownerRent?"PGOne · Pay rent":"PGOne · Pay ₹"+amountLabel).setItems(labels,(dialog,which)->{
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
                    chooser.show();polishDialog(chooser);
                });}
            });
        }catch(Exception e){
            if(order!=null)finish("SDK_UNAVAILABLE","UPI checkout could not start. Check payment status, then retry.");
            else events.result(attemptOrder,"SDK_UNAVAILABLE","The checkout session is incomplete. Refresh payment status and retry.");
        }
    }
    static String paymentContact(String value){
        String clean=value==null?"":value.replaceAll("[\\s()-]","");
        java.util.regex.Matcher match=java.util.regex.Pattern.compile("^(?:\\+91|91)?([6-9][0-9]{9})$").matcher(clean);
        return match.matches()?"+91"+match.group(1):null;
    }
    static JSONObject paymentPayload(JSONObject input) throws Exception {
        String contact=paymentContact(input.optString("contact",""));
        if(contact==null)throw new IllegalArgumentException("Payment contact required");
        String email=input.optString("email","").trim();
        if(!android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches())throw new IllegalArgumentException("Payment email required");
        JSONObject payload=new JSONObject();
        // The key belongs in the SDK constructor. Submit the documented payment fields only.
        for(String field:new String[]{"order_id","amount","currency"})payload.put(field,input.get(field));
        return payload.put("email",email).put("contact",contact).put("method","upi")
            .put("_[flow]","intent").put("description","PGOne monthly workspace access");
    }
    private void polishDialog(AlertDialog dialog) {
        // Visual styling only; SDK selection, submission and cancellation stay unchanged.
        android.view.Window window=dialog.getWindow();if(window==null)return;
        float density=activity.getResources().getDisplayMetrics().density;
        android.graphics.drawable.GradientDrawable panel=new android.graphics.drawable.GradientDrawable(android.graphics.drawable.GradientDrawable.Orientation.TL_BR,new int[]{android.graphics.Color.WHITE,android.graphics.Color.rgb(245,248,255)});
        panel.setCornerRadius(27f*density);window.setBackgroundDrawable(panel);
        window.setGravity(android.view.Gravity.BOTTOM);
        window.setLayout(activity.getResources().getDisplayMetrics().widthPixels-Math.round(28f*density),android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
        android.view.WindowManager.LayoutParams params=window.getAttributes();params.y=Math.round(14f*density);params.dimAmount=.32f;window.setAttributes(params);
        if(dialog.getListView()!=null){dialog.getListView().setDivider(new android.graphics.drawable.ColorDrawable(android.graphics.Color.rgb(232,238,249)));dialog.getListView().setDividerHeight(Math.max(1,Math.round(density)));}
        android.graphics.Typeface face;
        try{face=android.graphics.Typeface.createFromAsset(activity.getAssets(),"ManropeVariable.ttf");}catch(Exception ignored){face=android.graphics.Typeface.create("sans-serif",android.graphics.Typeface.NORMAL);}
        styleDialogText(window.getDecorView(),face);
    }
    private void styleDialogText(View view,android.graphics.Typeface face) {
        if(view instanceof android.widget.TextView){android.widget.TextView text=(android.widget.TextView)view;text.setTypeface(face,text.getTypeface()==null?0:text.getTypeface().getStyle());text.setTextColor(android.graphics.Color.rgb(20,47,103));}
        if(view instanceof android.view.ViewGroup){android.view.ViewGroup group=(android.view.ViewGroup)view;for(int i=0;i<group.getChildCount();i++)styleDialogText(group.getChildAt(i),face);}
    }
    static JSONObject rentPaymentPayload(JSONObject input) throws Exception {
        return paymentPayload(input).put("description","PG rent payment");
    }
    static String safeDescription(String text){
        if(text==null)return "";
        // SDK errors can wrap the useful field failure in JSON. Do not truncate its envelope first.
        try{JSONObject root=new JSONObject(text);JSONObject error=root.optJSONObject("error");
            String description=(error==null?root:error).optString("description","");
            if(!description.isEmpty())text=description;
        }catch(Exception ignored){}
        String clean=text.replaceAll("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+","[redacted]")
            .replaceAll("rzp_(live|test)_[A-Za-z0-9]+|order_[A-Za-z0-9]+|pay_[A-Za-z0-9]+|[0-9]{6,}","[redacted]")
            .replaceAll("https?://\\S+","[link]");
        return clean.substring(0,Math.min(320,clean.length()));
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
