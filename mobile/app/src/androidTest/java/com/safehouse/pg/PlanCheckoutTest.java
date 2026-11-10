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
    final Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    MainActivity start(){
        Intent launch=new Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return (MainActivity)instrumentation.startActivitySync(launch);
    }
    JSONObject input() throws Exception{return new JSONObject().put("organisationId","native-test-org").put("key","rzp_test_NATIVEFIXTURE")
        .put("order_id","order_NATIVEFIXTURE").put("amount",24900).put("currency","INR").put("email","native@example.invalid");}
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
        assertTrue(events.contains("CHOOSING_APP"));assertTrue(events.contains("SUBMITTED"));assertTrue(events.contains("FAILED_OR_UNKNOWN_CHECK_PROVIDER"));
        JSONObject saved=new JSONObject(checkout[0].snapshot());assertEquals("FAILED_OR_UNKNOWN_CHECK_PROVIDER",saved.getString("status"));
        assertTrue(saved.getString("message").contains("error 7"));assertFalse(saved.getString("message").contains("payer@example.invalid"));
        assertFalse(saved.getString("message").contains("9027666856"));
        instrumentation.runOnMainSync(activity::finish);
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
