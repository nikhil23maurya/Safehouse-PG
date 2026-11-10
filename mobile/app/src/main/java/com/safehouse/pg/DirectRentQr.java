package com.safehouse.pg;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.common.BitMatrix;
import java.io.ByteArrayOutputStream;
import java.util.EnumMap;

/** Locally encodes the server-bound owner's UPI intent. Never provider-verified settlement. */
final class DirectRentQr {
    static Uri validate(String encoded) {
        if (encoded == null || encoded.length() > 2048) throw new IllegalArgumentException("Invalid owner payment");
        Uri uri = Uri.parse(encoded);
        String amount = uri.getQueryParameter("am");
        if (amount == null || !amount.matches("[0-9]{1,7}\\.[0-9]{2}")) throw new IllegalArgumentException("Invalid rent amount");
        int paise = new java.math.BigDecimal(amount).movePointRight(2).intValueExact();
        ProviderQr.validatePayment(encoded, paise);
        if (!"INR".equals(uri.getQueryParameter("cu")) || uri.getQueryParameter("tr") == null ||
                !uri.getQueryParameter("tr").matches("PGO[A-Za-z0-9_-]{16,32}")) throw new IllegalArgumentException("Missing rent reference");
        return uri;
    }
    static byte[] png(String encoded) throws Exception {
        validate(encoded);
        EnumMap<EncodeHintType,Object> hints = new EnumMap<>(EncodeHintType.class);
        hints.put(EncodeHintType.MARGIN,4);
        hints.put(EncodeHintType.CHARACTER_SET,"UTF-8");
        BitMatrix matrix = new QRCodeWriter().encode(encoded,BarcodeFormat.QR_CODE,640,640,hints);
        int[] pixels = new int[matrix.getWidth()*matrix.getHeight()];
        for(int y=0;y<matrix.getHeight();y++) for(int x=0;x<matrix.getWidth();x++) pixels[y*matrix.getWidth()+x]=matrix.get(x,y)?Color.BLACK:Color.WHITE;
        Bitmap bitmap = Bitmap.createBitmap(pixels,matrix.getWidth(),matrix.getHeight(),Bitmap.Config.ARGB_8888);
        try { ByteArrayOutputStream bytes = new ByteArrayOutputStream(); bitmap.compress(Bitmap.CompressFormat.PNG,100,bytes); return bytes.toByteArray(); }
        finally { bitmap.recycle(); }
    }
}
