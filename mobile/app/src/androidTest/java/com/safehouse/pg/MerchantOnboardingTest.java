package com.safehouse.pg;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.lang.reflect.Method;
import static org.junit.Assert.*;
@RunWith(AndroidJUnit4.class)
public class MerchantOnboardingTest {
 @Test public void retiredPhoneAndProviderBridgesAreNotExposed() {
  for(Method method:MainActivity.NativeBridge.class.getDeclaredMethods()){
   assertFalse("Phone auth bridge must not ship",method.getName().contains("PhoneSignIn")||method.getName().equals("verifyPhoneCode"));
   assertFalse("Retired provider bridge must not ship",method.getName().equals("openMerchantOnboarding"));
  }
 }
 @Test public void officialCustomSdkExposesNativeSubmissionAndLifecycle() throws Exception {
  assertNotNull(com.razorpay.Razorpay.class.getMethod("submit",org.json.JSONObject.class,com.razorpay.PaymentResultListener.class));
  assertNotNull(com.razorpay.Razorpay.class.getMethod("setWebView",android.webkit.WebView.class));
  assertNotNull(com.razorpay.Razorpay.class.getMethod("onActivityResult",int.class,int.class,android.content.Intent.class));
 }
}
