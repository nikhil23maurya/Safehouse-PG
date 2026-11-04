package com.safehouse.pg;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Bounded image decoding; every redirect stays on an HTTPS provider host. */
final class ProviderQr {
    static boolean trusted(Uri uri) {
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(java.util.Locale.ROOT);
        return "https".equalsIgnoreCase(uri.getScheme()) && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443) &&
                ("rzp.io".equals(host) || "razorpay.com".equals(host) || host.endsWith(".razorpay.com"));
    }

    static Bitmap load(Uri uri) throws Exception {
        for (int redirects = 0; redirects <= 4; redirects++) {
            if (!trusted(uri)) throw new IllegalArgumentException("Unrecognised QR provider");
            HttpURLConnection connection = (HttpURLConnection)new URL(uri.toString()).openConnection();
            connection.setConnectTimeout(9000); connection.setReadTimeout(9000); connection.setInstanceFollowRedirects(false);
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
