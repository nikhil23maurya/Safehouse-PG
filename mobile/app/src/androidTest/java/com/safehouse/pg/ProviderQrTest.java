package com.safehouse.pg;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class ProviderQrTest {
    @Test public void galleryDownloadContainsTheSameVerifiedSquare() throws Exception {
        android.content.Context context = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getTargetContext();
        Bitmap poster = QrTestImages.poster(QrTestImages.PAYLOAD);
        Uri saved = null;
        try {
            ProviderQr.Prepared qr = ProviderQr.extract(poster, 850099);
            saved = QrDownloads.save(context, qr.png);
            try (java.io.InputStream input = context.getContentResolver().openInputStream(saved)) {
                java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
                byte[] buffer = new byte[8192]; int count;
                while ((count = input.read(buffer)) >= 0) bytes.write(buffer, 0, count);
                assertArrayEquals(qr.png, bytes.toByteArray());
            }
        } finally {
            poster.recycle();
            if (saved != null) context.getContentResolver().delete(saved, null, null);
        }
    }
    @Test public void tallPosterBecomesSquareWithoutChangingPaymentData() throws Exception {
        Bitmap poster = QrTestImages.poster(QrTestImages.PAYLOAD);
        try {
            ProviderQr.Prepared qr = ProviderQr.extract(poster, 850099);
            assertEquals(QrTestImages.PAYLOAD, qr.payment.toString());
            Bitmap image = BitmapFactory.decodeByteArray(qr.png, 0, qr.png.length);
            assertEquals(image.getWidth(), image.getHeight());
            assertTrue(image.getWidth() >= 240);
            assertTrue(image.getWidth() < poster.getHeight());
            assertEquals(android.graphics.Color.WHITE, image.getPixel(0, 0));
            ProviderQr.Prepared decodedAgain = ProviderQr.extract(image, 850099);
            assertEquals(QrTestImages.PAYLOAD, decodedAgain.payment.toString());
            image.recycle();
        } finally { poster.recycle(); }
    }
    @Test public void squareProviderImageAlsoPreservesEveryReference() throws Exception {
        Bitmap image = QrTestImages.square(QrTestImages.PAYLOAD);
        try { assertEquals(QrTestImages.PAYLOAD, ProviderQr.extract(image, 850099).payment.toString()); }
        finally { image.recycle(); }
    }
    @Test public void mismatchedOrAmbiguousPaymentNeverReachesAnIntent() throws Exception {
        for (String payload : new String[]{
            QrTestImages.PAYLOAD.replace("8500.99", "8500.98"),
            QrTestImages.PAYLOAD + "&am=8500.99",
            QrTestImages.PAYLOAD + "&pa=other%40invalid",
            QrTestImages.PAYLOAD.replace("cu=INR", "cu=USD"),
            QrTestImages.PAYLOAD.replace("upi://pay", "https://pay"),
            QrTestImages.PAYLOAD.replace("am=8500.99", "am=8.50099e3"),
            "upi://pay?pa=safehouse-test%40invalid&cu=INR"
        }) {
            try { ProviderQr.validatePayment(payload, 850099); fail("Unsafe payment accepted"); }
            catch (IllegalArgumentException expected) { /* no intent */ }
        }
    }
    @Test public void imageCacheIsScopedToProviderAndExactAmount() throws Exception {
        int[] loads = {0};
        ProviderQr cache = new ProviderQr(uri -> { loads[0]++; return QrTestImages.poster(QrTestImages.PAYLOAD); });
        Uri source = Uri.parse("https://rzp.io/i/fixture");
        assertSame(cache.prepare(source, 850099), cache.prepare(source, 850099));
        assertEquals(1, loads[0]);
        try { cache.prepare(source, 850000); fail("Amount change reused previous QR"); }
        catch (IllegalArgumentException expected) { }
        assertEquals(2, loads[0]);
        for (String invalid : new String[]{"http://rzp.io/i/a", "https://rzp.io.evil.test/i/a", "https://user@rzp.io/i/a", "https://rzp.io:444/i/a"}) {
            try { cache.prepare(Uri.parse(invalid), 850099); fail("Untrusted provider accepted"); }
            catch (IllegalArgumentException expected) { }
        }
        assertEquals(2, loads[0]);
    }
    @Test public void unreadablePosterFailsInsteadOfShowingUnverifiedContent() throws Exception {
        Bitmap image = Bitmap.createBitmap(800, 1600, Bitmap.Config.ARGB_8888); image.eraseColor(android.graphics.Color.WHITE);
        try {
            try { ProviderQr.extract(image, 850099); fail("Blank poster accepted"); }
            catch (com.google.zxing.NotFoundException expected) { }
        } finally { image.recycle(); }
    }
}
