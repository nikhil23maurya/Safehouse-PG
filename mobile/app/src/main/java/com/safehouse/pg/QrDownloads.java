package com.safehouse.pg;

import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/** Saves the same verified square displayed by the app, never the provider poster. */
final class QrDownloads {
    static Uri save(Context context, byte[] png) throws Exception {
        String name = "SafeHouse-UPI-QR-" + System.currentTimeMillis() + ".png";
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            values.put(MediaStore.MediaColumns.MIME_TYPE, "image/png");
            // Pictures makes Scan from Gallery available in UPI apps.
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/SafeHouse");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri uri = context.getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IllegalStateException("Gallery unavailable");
            try {
                try (OutputStream output = context.getContentResolver().openOutputStream(uri)) {
                    if (output == null) throw new IllegalStateException("Gallery unavailable");
                    output.write(png);
                }
                values.clear(); values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                context.getContentResolver().update(uri, values, null, null);
            } catch (Exception error) { context.getContentResolver().delete(uri, null, null); throw error; }
            return uri;
        } else {
            File directory = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "SafeHouse");
            if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("Gallery unavailable");
            File image = new File(directory, name);
            try (OutputStream output = new FileOutputStream(image)) { output.write(png); }
            android.media.MediaScannerConnection.scanFile(context, new String[]{image.getAbsolutePath()}, new String[]{"image/png"}, null);
            return Uri.fromFile(image);
        }
    }
}
