package com.safehouse.pg;

import android.app.AlertDialog;
import android.app.Instrumentation;
import android.content.Intent;
import android.view.View;
import android.webkit.WebView;
import android.widget.FrameLayout;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.razorpay.PaymentResultListener;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import static org.junit.Assert.*;

/** Native UI/adapter contracts, not a claim of merchant-authorized bank acceptance. */
@RunWith(AndroidJUnit4.class)
public class PlanCheckoutTest {
    @Test public void ownerRentUsesOAuthContextAndSeparateNativeState() throws Exception {
        MainActivity activity=start();final JSONObject[] submitted={null};final PlanUpiCheckout[] rent={null};
        instrumentation.runOnMainSync(()->{
            try{
                FrameLayout host=(FrameLayout)((android.view.ViewGroup)activity.findViewById(android.R.id.content)).getChildAt(0);
                PlanUpiCheckout plan=new PlanUpiCheckout(activity,host,(id,state,message)->{});String before=plan.snapshot();
                rent[0]=new PlanUpiCheckout(activity,host,(id,state,message)->{},(owner,key,view)->new PlanUpiCheckout.Gateway(){
                    public void discover(PlanUpiCheckout.Apps result){assertEquals("rzp_test_oauth_SYNTHRENT",key);result.ready(java.util.Arrays.asList(new PlanUpiCheckout.App("Synthetic UPI","fixture.upi.app")));}
                    public void submit(JSONObject value,PaymentResultListener listener){submitted[0]=value;listener.onPaymentError(7,"Synthetic cancellation");}
                    public void activityResult(int request,int result,Intent data){}public void back(){}
                },true);
                JSONObject request=input().put("key","rzp_test_oauth_SYNTHRENT").put("amount",850099).put("invoiceId","syntheticInvoice").put("rentOrderId","syntheticRentOrder").put("membershipId","syntheticMembership");
                rent[0].open(request.toString());java.lang.reflect.Field field=PlanUpiCheckout.class.getDeclaredField("chooser");field.setAccessible(true);AlertDialog chooser=(AlertDialog)field.get(rent[0]);
                ArrayList<View> titles=new ArrayList<>();chooser.getWindow().getDecorView().findViewsWithText(titles,"PGOne · Pay rent",View.FIND_VIEWS_WITH_TEXT);assertFalse(titles.isEmpty());
                chooser.getListView().performItemClick(chooser.getListView().getChildAt(0),0,0);
                assertEquals(before,plan.snapshot());assertEquals("syntheticInvoice",new JSONObject(rent[0].snapshot()).getString("invoiceId"));
            }catch(Exception e){throw new RuntimeException(e);}
        });
        assertEquals(850099,submitted[0].getInt("amount"));assertEquals("PG rent payment",submitted[0].getString("description"));assertEquals("intent",submitted[0].getString("_[flow]"));assertFalse(submitted[0].has("key"));assertFalse(submitted[0].has("merchantId"));
        instrumentation.runOnMainSync(()->{try{rent[0].acknowledge(new JSONObject(rent[0].snapshot()).getString("orderId"));}catch(Exception e){throw new RuntimeException(e);}activity.finish();});
    }
    @Test public void subscriptionProfileRejectsOwnerOAuthCheckout() throws Exception {
        MainActivity activity=start();final String[] result={null};
        instrumentation.runOnMainSync(()->{
            try{FrameLayout host=(FrameLayout)((android.view.ViewGroup)activity.findViewById(android.R.id.content)).getChildAt(0);PlanUpiCheckout plan=new PlanUpiCheckout(activity,host,(id,state,message)->result[0]=state,(owner,key,view)->{throw new AssertionError("Rent token reached the software-fee gateway");});plan.open(input().put("key","rzp_test_oauth_SYNTHRENT").put("amount",850099).toString());activity.finish();}catch(Exception e){throw new RuntimeException(e);}
        });assertEquals("SDK_UNAVAILABLE",result[0]);
    }
    final Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    MainActivity start(){
        instrumentation.getTargetContext().getSharedPreferences("safehouse_secure_session",android.content.Context.MODE_PRIVATE).edit().clear().commit();
        Intent launch=new Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return (MainActivity)instrumentation.startActivitySync(launch);
    }
    JSONObject input() throws Exception{return new JSONObject().put("organisationId","native-test-org").put("key","rzp_test_NATIVEFIXTURE")
        .put("order_id","order_NATIVEFIXTURE").put("amount",24900).put("currency","INR").put("email","native@example.invalid").put("contact","9999999999");}
    @Test public void nativeAppChoiceSubmitsExactOrderAndRetainsRedactedFailure() throws Exception {
        MainActivity activity=start();List<String> events=new ArrayList<>();final PlanUpiCheckout[] checkout={null};final JSONObject[] submitted={null};
        instrumentation.runOnMainSync(()->{
            FrameLayout host=(FrameLayout)((android.view.ViewGroup)activity.findViewById(android.R.id.content)).getChildAt(0);
            checkout[0]=new PlanUpiCheckout(activity,host,(id,status,message)->events.add(status),(owner,key,view)->new PlanUpiCheckout.Gateway(){
                public void discover(PlanUpiCheckout.Apps result){assertEquals(View.GONE,view.getVisibility());result.ready(java.util.Arrays.asList(new PlanUpiCheckout.App("UPI Test Receiver","fixture.upi.app")));}
                public void submit(JSONObject value,PaymentResultListener result){submitted[0]=value;assertEquals(View.VISIBLE,view.getVisibility());result.onPaymentError(7,"Rejected payer@example.invalid order_SECRET 9027666856");}
                public void activityResult(int request,int result,Intent data){}public void back(){}
            });
            try{checkout[0].open(input().toString());
                java.lang.reflect.Field field=PlanUpiCheckout.class.getDeclaredField("chooser");field.setAccessible(true);
                AlertDialog dialog=(AlertDialog)field.get(checkout[0]);assertTrue(dialog.isShowing());
                dialog.getListView().performItemClick(dialog.getListView().getChildAt(0),0,0);
            }catch(Exception e){throw new RuntimeException(e);}
        });
        assertEquals(24900,submitted[0].getInt("amount"));assertEquals("order_NATIVEFIXTURE",submitted[0].getString("order_id"));
        assertEquals("fixture.upi.app",submitted[0].getString("upi_app_package_name"));
        assertEquals("+919999999999",submitted[0].getString("contact"));assertFalse(submitted[0].has("key"));
        assertTrue(events.contains("CHOOSING_APP"));assertTrue(events.contains("SUBMITTED"));assertTrue(events.contains("FAILED_OR_UNKNOWN_CHECK_PROVIDER"));
        JSONObject saved=new JSONObject(checkout[0].snapshot());assertEquals("FAILED_OR_UNKNOWN_CHECK_PROVIDER",saved.getString("status"));
        assertTrue(saved.getString("message").contains("error 7"));assertFalse(saved.getString("message").contains("payer@example.invalid"));
        assertFalse(saved.getString("message").contains("9027666856"));
        instrumentation.runOnMainSync(activity::finish);
    }
    @Test public void blankContactCannotReachProviderOrCreateAnOverlay() throws Exception {
        MainActivity activity=start();final String[] status={null};
        instrumentation.runOnMainSync(()->{
            FrameLayout host=(FrameLayout)((android.view.ViewGroup)activity.findViewById(android.R.id.content)).getChildAt(0);int children=host.getChildCount();
            PlanUpiCheckout checkout=new PlanUpiCheckout(activity,host,(id,state,message)->status[0]=state,(owner,key,view)->{throw new AssertionError("Blank contact reached SDK");});
            try {JSONObject request=input();request.remove("contact");checkout.open(request.toString());}
            catch(Exception e){throw new RuntimeException(e);}
            assertEquals("INVALID_PAYMENT_CONTACT",status[0]);assertEquals(children,host.getChildCount());activity.finish();
        });
    }
    @Test public void oneRupeePlanShowsAndSubmitsExactReducedPrice() throws Exception {
        MainActivity activity=start();final JSONObject[] submitted={null};
        instrumentation.runOnMainSync(()->{
            try{
                FrameLayout host=(FrameLayout)((android.view.ViewGroup)activity.findViewById(android.R.id.content)).getChildAt(0);
                PlanUpiCheckout checkout=new PlanUpiCheckout(activity,host,(id,status,message)->{},(owner,key,view)->new PlanUpiCheckout.Gateway(){
                    public void discover(PlanUpiCheckout.Apps result){result.ready(java.util.Arrays.asList(new PlanUpiCheckout.App("Synthetic UPI","fixture.upi.app")));}
                    public void submit(JSONObject value,PaymentResultListener listener){submitted[0]=value;listener.onPaymentError(7,"Synthetic cancellation");}
                    public void activityResult(int request,int result,Intent data){}public void back(){}
                });
                checkout.open(input().put("amount",100).toString());
                java.lang.reflect.Field field=PlanUpiCheckout.class.getDeclaredField("chooser");field.setAccessible(true);AlertDialog chooser=(AlertDialog)field.get(checkout);
                ArrayList<View> titles=new ArrayList<>();chooser.getWindow().getDecorView().findViewsWithText(titles,"PGOne · Pay ₹1",View.FIND_VIEWS_WITH_TEXT);assertFalse(titles.isEmpty());
                chooser.getListView().performItemClick(chooser.getListView().getChildAt(0),0,0);
                assertEquals(100,submitted[0].getInt("amount"));assertEquals("order_NATIVEFIXTURE",submitted[0].getString("order_id"));assertFalse(submitted[0].has("subscription_id"));
                activity.finish();
            }catch(Exception e){throw new RuntimeException(e);}
        });
    }
    @Test public void providerValidationCauseIsReadableAndPayerDataIsRedacted() throws Exception {
        String raw=new JSONObject().put("error",new JSONObject().put("code","BAD_REQUEST_ERROR")
            .put("description","Could not validate payment create request due to: contact: cannot be blank. payer@example.invalid 9999999999")).toString();
        String result=PlanUpiCheckout.safeDescription(raw);
        assertTrue(result.contains("contact: cannot be blank"));assertFalse(result.contains("{\"error\""));
        assertFalse(result.contains("payer@example.invalid"));assertFalse(result.contains("9999999999"));
        for(String value:new String[]{"9999999999","+91 99999 99999","919999999999"})
            assertEquals("+919999999999",PlanUpiCheckout.paymentContact(value));
        assertNull(PlanUpiCheckout.paymentContact("123"));assertNull(PlanUpiCheckout.paymentContact(""));
    }
    @Test public void correctedPayloadPassesTheOfficialSdkFieldValidator() throws Exception {
        MainActivity activity=start();CountDownLatch done=new CountDownLatch(2);final String[] error={null};
        instrumentation.runOnMainSync(()->{
            try {
                for(int amount:new int[]{100,24900}){
                    JSONObject payload=PlanUpiCheckout.paymentPayload(input().put("amount",amount)).put("upi_app_package_name","in.org.npci.upiapp");
                    new com.razorpay.Razorpay(activity,"rzp_test_NATIVEFIXTURE").validateFields(payload,new com.razorpay.ValidationListener(){
                        public void onValidationSuccess(){done.countDown();}
                        public void onValidationError(java.util.Map<String,String> fields){error[0]=String.valueOf(fields);done.countDown();}
                    });
                }
            }catch(Exception e){throw new RuntimeException(e);}
        });
        assertTrue(done.await(10,TimeUnit.SECONDS));assertNull(error[0]);instrumentation.runOnMainSync(activity::finish);
    }
    @Test public void failedDiscoveryRemovesOverlayAndAllowsAnotherInitiation() throws Exception {
        MainActivity activity=start();final int[] discoveries={0};
        instrumentation.runOnMainSync(()->{
            FrameLayout host=(FrameLayout)((android.view.ViewGroup)activity.findViewById(android.R.id.content)).getChildAt(0);int children=host.getChildCount();
            PlanUpiCheckout checkout=new PlanUpiCheckout(activity,host,(id,status,message)->{},(owner,key,view)->new PlanUpiCheckout.Gateway(){
                public void discover(PlanUpiCheckout.Apps result){discoveries[0]++;assertEquals(View.GONE,view.getVisibility());result.ready(java.util.Collections.emptyList());}
                public void submit(JSONObject value,PaymentResultListener result){fail("No payment may be submitted without an app choice");}
                public void activityResult(int request,int result,Intent data){}public void back(){}
            });
            try{checkout.open(input().toString());assertEquals(children,host.getChildCount());
                assertEquals("NO_SUPPORTED_APP",new JSONObject(checkout.snapshot()).getString("status"));checkout.open(input().toString());
            }catch(Exception e){throw new RuntimeException(e);}
            assertEquals(2,discoveries[0]);assertEquals(children,host.getChildCount());activity.finish();
        });
    }
    @Test public void officialSdkActuallyDiscoversDeviceAppsWithoutSubmittingPayment() throws Exception {
        MainActivity activity=start();CountDownLatch done=new CountDownLatch(1);
        instrumentation.runOnMainSync(()->{
            WebView provider=new WebView(activity);provider.setVisibility(View.GONE);
            PlanUpiCheckout.OFFICIAL.create(activity,"rzp_test_NATIVEFIXTURE",provider);
            // Exercise the real SDK discovery API, not reflection or a JavaScript stub.
            com.razorpay.Razorpay.getAppsWhichSupportUpi(activity,apps->{assertNotNull(apps);done.countDown();});
        });
        assertTrue("Official UPI discovery callback did not return",done.await(25,TimeUnit.SECONDS));
        instrumentation.runOnMainSync(activity::finish);
    }
}
