package com.safehouse.pg;

import android.app.Activity;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseException;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.PhoneAuthCredential;
import com.google.firebase.auth.PhoneAuthOptions;
import com.google.firebase.auth.PhoneAuthProvider;
import org.json.JSONObject;
import java.util.concurrent.TimeUnit;

/** Official Firebase phone verification. No test codes, SMS parsing or payment state. */
final class PhoneSignIn {
    interface Events { void send(String attempt, String type, String value); }
    private final Activity activity;
    private final Events events;
    private FirebaseAuth auth;
    private String attempt = "", verificationId, phone;
    private PhoneAuthProvider.ForceResendingToken resendToken;
    private long lastRequestAt;
    PhoneSignIn(Activity activity, Events events) { this.activity = activity; this.events = events; }

    void start(String configuration, String number, String requestId, boolean resend) {
        try {
            if (!number.matches("\\+91[6-9]\\d{9}") || !requestId.matches("[a-zA-Z0-9_-]{8,100}")) throw new IllegalArgumentException();
            if (android.os.SystemClock.elapsedRealtime() - lastRequestAt < 60000 && lastRequestAt != 0) { events.send(requestId, "error", "Please wait one minute before requesting another code."); return; }
            JSONObject config = new JSONObject(configuration);
            FirebaseApp app;
            try { app = FirebaseApp.getInstance("pgone-phone"); }
            catch (IllegalStateException missing) {
                app = FirebaseApp.initializeApp(activity.getApplicationContext(), new FirebaseOptions.Builder()
                    .setProjectId(config.getString("projectId")).setApplicationId(config.getString("applicationId"))
                    .setApiKey(config.getString("apiKey")).setGcmSenderId(config.getString("senderId")).build(), "pgone-phone");
            }
            auth = FirebaseAuth.getInstance(app);
            auth.setLanguageCode("en");
            boolean samePhone = number.equals(phone);
            phone = number; attempt = requestId; verificationId = null;
            lastRequestAt = android.os.SystemClock.elapsedRealtime();
            PhoneAuthOptions.Builder options = PhoneAuthOptions.newBuilder(auth).setPhoneNumber(number)
                .setTimeout(60L, TimeUnit.SECONDS).setActivity(activity)
                .setCallbacks(new PhoneAuthProvider.OnVerificationStateChangedCallbacks() {
                    @Override public void onCodeSent(String id, PhoneAuthProvider.ForceResendingToken token) {
                        if (!attempt.equals(requestId)) return;
                        verificationId = id; resendToken = token; events.send(requestId, "sent", "");
                    }
                    @Override public void onVerificationCompleted(PhoneAuthCredential credential) { if (attempt.equals(requestId)) finish(credential, requestId); }
                    @Override public void onVerificationFailed(FirebaseException error) {
                        if (attempt.equals(requestId)) events.send(requestId, "error", "Phone verification could not start. Check your connection and phone-auth setup, then retry.");
                    }
                });
            if (resend && samePhone && resendToken != null) options.setForceResendingToken(resendToken);
            PhoneAuthProvider.verifyPhoneNumber(options.build());
        } catch (Exception error) { events.send(requestId, "error", "Phone verification is unavailable on this installation. Existing email sign-in remains available."); }
    }
    void verify(String code, String requestId) {
        if (!attempt.equals(requestId) || verificationId == null || !code.matches("\\d{6}")) { events.send(requestId, "error", "Request a fresh code and enter all six digits."); return; }
        finish(PhoneAuthProvider.getCredential(verificationId, code), requestId);
    }
    private void finish(PhoneAuthCredential credential, String requestId) {
        auth.signInWithCredential(credential).addOnCompleteListener(activity, result -> {
            if (!attempt.equals(requestId)) return;
            if (!result.isSuccessful() || result.getResult().getUser() == null) { events.send(requestId, "error", "The verification code is invalid or expired. Try again."); return; }
            result.getResult().getUser().getIdToken(true).addOnCompleteListener(activity, token -> {
                if (!attempt.equals(requestId)) return;
                if (!token.isSuccessful() || token.getResult().getToken() == null) { events.send(requestId, "error", "Verification could not finish. Request a new code."); return; }
                events.send(requestId, "verified", token.getResult().getToken());
                cancel();
            });
        });
    }
    void cancel() { attempt = ""; verificationId = null; if (auth != null) auth.signOut(); }
}
