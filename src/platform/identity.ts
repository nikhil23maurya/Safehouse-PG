import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { config } from "../config.js";
import { AppError, assert } from "../errors.js";
import { platformConfig, platformEnabled } from "./config.js";

export function phoneConfig(packageId: string) {
  const apiKey =
    packageId === "web"
      ? platformConfig.PGONE_FIREBASE_WEB_API_KEY
      : config.FIREBASE_ANDROID_API_KEY;
  const applicationId =
    packageId === "com.safehouse.pg.testing"
      ? platformConfig.PGONE_FIREBASE_TESTING_APP_ID
      : packageId === "web"
        ? platformConfig.PGONE_FIREBASE_WEB_APP_ID
        : packageId === "com.safehouse.pg"
          ? config.FIREBASE_ANDROID_APP_ID
          : null;
  if (
    !platformEnabled() ||
    platformConfig.PGONE_PHONE_AUTH_ENABLED !== "true" ||
    !applicationId ||
    !config.FIREBASE_PROJECT_ID ||
    !apiKey ||
    !config.FIREBASE_SENDER_ID ||
    !config.FIREBASE_SERVICE_ACCOUNT_JSON
  )
    return null;
  return {
    projectId: config.FIREBASE_PROJECT_ID,
    applicationId,
    apiKey,
    senderId: config.FIREBASE_SENDER_ID,
    authDomain: `${config.FIREBASE_PROJECT_ID}.firebaseapp.com`,
  };
}
export async function verifyPhoneIdentity(idToken: string) {
  assert(
    platformEnabled() &&
      platformConfig.PGONE_PHONE_AUTH_ENABLED === "true" &&
      config.FIREBASE_SERVICE_ACCOUNT_JSON &&
      config.FIREBASE_PROJECT_ID,
    503,
    "PHONE_AUTH_UNAVAILABLE",
    "Phone sign-in is not activated yet. Existing users can sign in with email.",
  );
  let app = getApps().find((item) => item.name === "pgone-phone-auth");
  if (!app) {
    try {
      app = initializeApp(
        {
          projectId: config.FIREBASE_PROJECT_ID,
          credential: cert(JSON.parse(config.FIREBASE_SERVICE_ACCOUNT_JSON!)),
        },
        "pgone-phone-auth",
      );
    } catch {
      throw new AppError(
        503,
        "PHONE_AUTH_UNAVAILABLE",
        "Phone sign-in configuration needs operator attention.",
      );
    }
  }
  let token;
  try {
    token = await getAuth(app).verifyIdToken(idToken, true);
  } catch {
    throw new AppError(
      401,
      "PHONE_VERIFICATION_FAILED",
      "Your phone verification expired. Request a new code.",
    );
  }
  assert(
    token.firebase?.sign_in_provider === "phone" &&
      token.phone_number &&
      /^\+91[6-9]\d{9}$/.test(token.phone_number),
    401,
    "PHONE_VERIFICATION_REQUIRED",
    "Verify your Indian mobile number to continue.",
  );
  assert(
    token.auth_time &&
      Date.now() / 1000 - token.auth_time <= 600 &&
      token.auth_time <= Date.now() / 1000 + 30,
    401,
    "PHONE_VERIFICATION_EXPIRED",
    "Verify your number again to continue.",
  );
  return { uid: token.uid, phoneE164: token.phone_number };
}
