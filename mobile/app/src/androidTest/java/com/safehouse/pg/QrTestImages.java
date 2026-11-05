package com.safehouse.pg;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;

final class QrTestImages {
    static final String PAYLOAD = "upi://pay?pa=safehouse-test%40invalid&pn=SafeHouse%20Fixture&am=8500.99&cu=INR&tr=provider_fixture_order&sign=fixture%2Bsignature%3D";
    static Bitmap square(String payload) throws Exception {
        java.util.Map<EncodeHintType, Object> hints = new java.util.EnumMap<>(EncodeHintType.class);
        hints.put(EncodeHintType.MARGIN, 4);
        BitMatrix matrix = new QRCodeWriter().encode(payload, BarcodeFormat.QR_CODE, 420, 420, hints);
        int[] pixels = new int[420 * 420];
        for (int y = 0; y < 420; y++) for (int x = 0; x < 420; x++) pixels[y * 420 + x] = matrix.get(x, y) ? Color.BLACK : Color.WHITE;
        return Bitmap.createBitmap(pixels, 420, 420, Bitmap.Config.ARGB_8888);
    }
    static Bitmap poster(String payload) throws Exception {
        Bitmap poster = Bitmap.createBitmap(800, 1600, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(poster); canvas.drawColor(Color.WHITE);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG); paint.setColor(Color.rgb(23, 70, 200)); paint.setTextSize(44);
        canvas.drawText("Cyntrova - fixture merchant", 60, 180, paint);
        paint.setColor(Color.BLACK); canvas.drawText("Scan & pay", 60, 300, paint);
        Bitmap qr = square(payload); canvas.drawBitmap(qr, 190, 560, null); qr.recycle();
        paint.setTextSize(32); canvas.drawText("Razorpay - fixture poster footer", 60, 1250, paint);
        canvas.drawText("Test image only. No valid recipient.", 60, 1370, paint);
        return poster;
    }
}
