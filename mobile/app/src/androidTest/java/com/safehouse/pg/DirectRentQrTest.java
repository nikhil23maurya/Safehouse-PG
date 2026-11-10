package com.safehouse.pg;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.RGBLuminanceSource;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.QRCodeReader;
import org.junit.Test;
import static org.junit.Assert.*;
public class DirectRentQrTest {
 @Test public void optionalQrContainsExactBoundOwnerIntentWithoutBranding() throws Exception {
  String uri="upi://pay?pa=owner%40example&pn=Owner&am=8500.99&cu=INR&tr=PGO1234567890123456&tn=Rent";
  byte[] png=DirectRentQr.png(uri);Bitmap bitmap=BitmapFactory.decodeByteArray(png,0,png.length);
  assertEquals(bitmap.getWidth(),bitmap.getHeight());int[] pixels=new int[bitmap.getWidth()*bitmap.getHeight()];
  bitmap.getPixels(pixels,0,bitmap.getWidth(),0,0,bitmap.getWidth(),bitmap.getHeight());
  assertEquals(uri,new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(bitmap.getWidth(),bitmap.getHeight(),pixels)))).getText());bitmap.recycle();
 }
 @Test public void unrelatedOrUnboundPaymentUriIsRejected() {
  for(String uri:new String[]{"https://example.invalid/pay","upi://pay?pa=owner@example&am=10.00&cu=INR","upi://pay?pa=owner@example&am=10.00&am=20.00&cu=INR&tr=PGO1234567890123456"}) {
   try{DirectRentQr.validate(uri);fail("Unsafe intent was accepted");}catch(IllegalArgumentException expected){}
  }
 }
}
