package com.safehouse.pg;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import org.json.JSONObject;

import java.util.Map;

public class SafeHouseFirebaseService extends FirebaseMessagingService {
    @Override
    public void onRegistered(String installationId) {
        super.onRegistered(installationId);
        if (installationId == null || installationId.isEmpty()) return;
        SharedPreferences prefs = getSharedPreferences(MainActivity.PREFS, MODE_PRIVATE);
        prefs.edit().putString(MainActivity.EXTRA_INSTALLATION_ID, installationId).apply();
        Intent update = new Intent(MainActivity.ACTION_FCM_REGISTRATION);
        update.setPackage(getPackageName());
        update.putExtra(MainActivity.EXTRA_INSTALLATION_ID, installationId);
        sendBroadcast(update);
    }

    @Override
    public void onUnregistered(String installationId) {
        super.onUnregistered(installationId);
        SharedPreferences prefs = getSharedPreferences(MainActivity.PREFS, MODE_PRIVATE);
        String stored = prefs.getString(MainActivity.EXTRA_INSTALLATION_ID, "");
        if (stored != null && stored.equals(installationId)) prefs.edit().remove(MainActivity.EXTRA_INSTALLATION_ID).apply();
    }

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        Map<String, String> data = remoteMessage.getData();
        String title = clean(data.get("title"), "SafeHouse");
        String body = clean(data.get("body"), "You have a new SafeHouse update.");
        String route = clean(data.get("route"), "studentHome");
        String channel = clean(data.get("channel"), "general");
        showNotification(remoteMessage.getMessageId(), title, body, route, channel, data);
    }

    private void showNotification(String messageId, String title, String body, String route, String channel, Map<String, String> data) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        String channelId = channelId(channel);
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(buildChannel(channelId));

        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        open.putExtra(MainActivity.EXTRA_NOTIFICATION_ROUTE, route);
        open.putExtra(MainActivity.EXTRA_NOTIFICATION_PAYLOAD, new JSONObject(data).toString());
        int requestCode = Math.abs((messageId == null ? String.valueOf(System.nanoTime()) : messageId).hashCode());
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pendingIntent = PendingIntent.getActivity(this, requestCode, open, flags);

        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, channelId) : new Notification.Builder(this);
        builder.setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setColor(Color.rgb(36, 99, 235))
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setWhen(System.currentTimeMillis());
        if (Build.VERSION.SDK_INT < 26) builder.setPriority(Notification.PRIORITY_HIGH);
        manager.notify(requestCode, builder.build());
    }

    private NotificationChannel buildChannel(String id) {
        String name;
        String description;
        if ("safehouse_payments".equals(id)) { name = "Payments"; description = "Payment confirmations and receipt updates"; }
        else if ("safehouse_rent".equals(id)) { name = "Rent reminders"; description = "Rent due and overdue reminders"; }
        else if ("safehouse_announcements".equals(id)) { name = "PG announcements"; description = "Important property announcements"; }
        else { name = "SafeHouse updates"; description = "General SafeHouse notifications"; }
        NotificationChannel channel = new NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(description);
        channel.enableVibration(true);
        return channel;
    }

    private String channelId(String value) {
        if ("payments".equalsIgnoreCase(value)) return "safehouse_payments";
        if ("rent".equalsIgnoreCase(value)) return "safehouse_rent";
        if ("announcements".equalsIgnoreCase(value)) return "safehouse_announcements";
        return "safehouse_general";
    }

    private String clean(String value, String fallback) { return value == null || value.trim().isEmpty() ? fallback : value.trim(); }
}
