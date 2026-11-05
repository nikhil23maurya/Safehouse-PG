package com.safehouse.pg;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.RGBLuminanceSource;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.QRCodeReader;
import com.google.zxing.qrcode.decoder.Decoder;
import com.google.zxing.qrcode.detector.Detector;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Bounded image decoding; every redirect stays on an HTTPS provider host. */
final class ProviderQr {
    interface ImageLoader { Bitmap load(Uri uri) throws Exception; }
    static final class Prepared {
        final byte[] png;
        final Uri payment;
        Prepared(byte[] png, Uri payment) { this.png = png; this.payment = payment; }
    }
    private final ImageLoader loader;
    private String cachedKey;
    private Prepared cached;

    ProviderQr(ImageLoader loader) { this.loader = loader; }

    synchronized Prepared prepare(Uri source, int amountPaise) throws Exception {
        if (!trusted(source)) throw new IllegalArgumentException("Unrecognised QR provider");
        String key = source.toString() + "|" + amountPaise;
        if (key.equals(cachedKey) && cached != null) return cached;
        Bitmap original = loader.load(source);
        try {
            Prepared prepared = extract(original, amountPaise);
            cachedKey = key; cached = prepared;
            return prepared;
        } finally { if (original != null) original.recycle(); }
    }

    private static BinaryBitmap binary(Bitmap image) {
        int width = image.getWidth(), height = image.getHeight();
        int[] pixels = new int[width * height];
        image.getPixels(pixels, 0, width, 0, 0, width, height);
        return new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(width, height, pixels)));
    }

    /** Extract the detected provider matrix, not a fixed crop or a newly constructed UPI request. */
    static Prepared extract(Bitmap image, int amountPaise) throws Exception {
        if (image == null || image.getWidth() < 80 || image.getHeight() < 80 || (long)image.getWidth() * image.getHeight() > 4000000)
            throw new IllegalArgumentException("QR image unavailable");
        java.util.Map<DecodeHintType, Object> hints = new java.util.EnumMap<>(DecodeHintType.class);
        hints.put(DecodeHintType.TRY_HARDER, Boolean.TRUE);
        BitMatrix modules = new Detector(binary(image).getBlackMatrix()).detect(hints).getBits();
        // ZXing unmasks its input in place while decoding. Keep display modules intact.
        String encoded = new Decoder().decode(modules.clone(), hints).getText();
        Uri payment = validatePayment(encoded, amountPaise);
        // Four-module quiet zone, integral pixel scaling, no logo/text overlay.
        // Preserve every sampled data module including provider signature/reference fields.
        int scale = Math.max(4, 512 / (modules.getWidth() + 8));
        int size = (modules.getWidth() + 8) * scale;
        int[] pixels = new int[size * size];
        java.util.Arrays.fill(pixels, Color.WHITE);
        for (int y = 0; y < modules.getHeight(); y++) for (int x = 0; x < modules.getWidth(); x++) {
            if (!modules.get(x, y)) continue;
            for (int dy = 0; dy < scale; dy++) {
                int start = ((y + 4) * scale + dy) * size + (x + 4) * scale;
                java.util.Arrays.fill(pixels, start, start + scale, Color.BLACK);
            }
        }
        Bitmap square = Bitmap.createBitmap(pixels, size, size, Bitmap.Config.ARGB_8888);
        try {
            if (!encoded.equals(new QRCodeReader().decode(binary(square), hints).getText()))
                throw new IllegalArgumentException("Extracted QR content changed");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            square.compress(Bitmap.CompressFormat.PNG, 100, output);
            return new Prepared(output.toByteArray(), payment);
        } finally { square.recycle(); }
    }

    static Uri validatePayment(String encoded, int amountPaise) {
        if (amountPaise <= 0 || amountPaise > 100000000 || encoded == null || encoded.length() > 8192)
            throw new IllegalArgumentException("Invalid payment amount");
        Uri payment = Uri.parse(encoded);
        if (!"upi".equalsIgnoreCase(payment.getScheme()) || !"pay".equalsIgnoreCase(payment.getEncodedAuthority()) ||
            (payment.getPath() != null && !payment.getPath().isEmpty()) || payment.getFragment() != null)
            throw new IllegalArgumentException("QR is not a valid UPI payment");
        for (String parameter : new String[]{"pa", "am", "cu"})
            if (payment.getQueryParameters(parameter).size() > 1) throw new IllegalArgumentException("Ambiguous UPI payment");
        String payee = payment.getQueryParameter("pa"), amount = payment.getQueryParameter("am"), currency = payment.getQueryParameter("cu");
        if (payee == null || !payee.matches("[A-Za-z0-9._-]+@[A-Za-z0-9._-]+"))
            throw new IllegalArgumentException("QR is missing a valid payee");
        if (currency != null && !"INR".equalsIgnoreCase(currency)) throw new IllegalArgumentException("Unexpected currency");
        if (amount == null || !amount.matches("[0-9]+(?:\\.[0-9]{1,2})?")) throw new IllegalArgumentException("UPI QR is missing fixed amount");
        if (new java.math.BigDecimal(amount).movePointRight(2).intValueExact() != amountPaise)
            throw new IllegalArgumentException("QR amount mismatch");
        return payment;
    }

    static boolean trusted(Uri uri) {
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(java.util.Locale.ROOT);
        return "https".equalsIgnoreCase(uri.getScheme()) && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443) &&
                ("rzp.io".equals(host) || "razorpay.com".equals(host) || host.endsWith(".razorpay.com"));
    }

    static Bitmap load(Uri uri) throws Exception {
        for (int redirects = 0; redirects <= 4; redirects++) {
            if (!trusted(uri)) throw new IllegalArgumentException("Unrecognised QR provider");
            HttpURLConnection connection = (HttpURLConnection)new URL(uri.toString()).openConnection();
            connection.setConnectTimeout(10000); connection.setReadTimeout(15000); connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Accept", "image/png,image/jpeg,image/webp,image/*;q=0.9,*/*;q=0.5");
            try {
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400) {
                    String location = connection.getHeaderField("Location");
                    if (location == null) throw new IllegalArgumentException("Invalid QR redirect");
                    uri = Uri.parse(new URL(new URL(uri.toString()), location).toString());
                    continue;
                }
                if (status != 200 || connection.getContentLength() > 8388608) throw new IllegalArgumentException("QR image unavailable");
                byte[] image;
                try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192]; int n;
                    while ((n = input.read(buffer)) >= 0) {
                        if (output.size() + n > 8388608) throw new IllegalArgumentException("QR image too large");
                        output.write(buffer, 0, n);
                    }
                    image = output.toByteArray();
                }
                BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(image, 0, image.length, bounds);
                if (bounds.outWidth < 80 || bounds.outHeight < 80 || (long)bounds.outWidth * bounds.outHeight > 4000000) throw new IllegalArgumentException("Invalid QR image dimensions");
                Bitmap bitmap = BitmapFactory.decodeByteArray(image, 0, image.length);
                if (bitmap == null) throw new IllegalArgumentException("Invalid QR image");
                return bitmap;
            } finally { connection.disconnect(); }
        }
        throw new IllegalArgumentException("Too many QR redirects");
    }
}
