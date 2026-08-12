import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.join(here, 'notification-android');
const javaDir = 'mobile/app/src/main/java/com/safehouse/pg';
const drawableDir = 'mobile/app/src/main/res/drawable';
const gradleFile = 'mobile/app/build.gradle';
const manifestFile = 'mobile/app/src/main/AndroidManifest.xml';

if (!fs.existsSync(javaDir) || !fs.existsSync(gradleFile) || !fs.existsSync(manifestFile)) throw new Error('Android notification patch: reconstructed mobile source is missing');

for (const name of ['MainActivity.java','SafeHouseFirebaseService.java','SafeHouseFirebaseInitProvider.java']) {
  fs.writeFileSync(path.join(javaDir, name), fs.readFileSync(path.join(templateDir, name), 'utf8'));
}
fs.mkdirSync(drawableDir, { recursive: true });
fs.copyFileSync(path.join(templateDir, 'ic_notification.xml'), path.join(drawableDir, 'ic_notification.xml'));

let gradle = fs.readFileSync(gradleFile, 'utf8');
gradle = gradle.replace(/versionCode\s+\d+/, 'versionCode 21').replace(/versionName\s+'[^']+'/, "versionName '2.1.0'");
if (!gradle.includes('SAFEHOUSE_NOTIFICATIONS_ANDROID_V1')) {
  gradle = gradle.replace(/dependencies\s*\{([\s\S]*?)\n\}/, (match, body) => `dependencies {${body}\n    // SAFEHOUSE_NOTIFICATIONS_ANDROID_V1\n    implementation platform('com.google.firebase:firebase-bom:34.17.0')\n    implementation 'com.google.firebase:firebase-messaging'\n}`);
}
fs.writeFileSync(gradleFile, gradle);

const manifest = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />

    <application
        android:allowBackup="false"
        android:usesCleartextTraffic="false"
        android:theme="@style/Theme.SafeHouse"
        android:label="SafeHouse"
        android:icon="@drawable/ic_launcher"
        android:roundIcon="@drawable/ic_launcher">
        <meta-data android:name="firebase_messaging_installation_id_enabled" android:value="true" />
        <meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/ic_notification" />
        <provider
            android:name=".SafeHouseFirebaseInitProvider"
            android:authorities="\${applicationId}.safehouse-firebase-init"
            android:exported="false"
            android:initOrder="1000" />
        <service android:name=".SafeHouseFirebaseService" android:exported="false">
            <intent-filter>
                <action android:name="com.google.firebase.MESSAGING_EVENT" />
            </intent-filter>
        </service>
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:launchMode="singleTop"
            android:screenOrientation="unspecified"
            android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`;
fs.writeFileSync(manifestFile, manifest);

const checks = [
  [path.join(javaDir, 'MainActivity.java'), 'configureNotifications'],
  [path.join(javaDir, 'SafeHouseFirebaseService.java'), 'onRegistered'],
  [manifestFile, 'firebase_messaging_installation_id_enabled'],
  [gradleFile, 'firebase-messaging']
];
for (const [target, marker] of checks) if (!fs.readFileSync(target, 'utf8').includes(marker)) throw new Error(`Android notification patch verification failed: ${target}`);
console.log('SafeHouse Android FCM notification integration applied.');
