import { createFixtures } from "../e2e/fixtures.mjs";
import { createPlatformFixtures } from "./platform-fixtures.js";
import {createOwnerPaymentFixtures} from "./owner-payment-fixtures.js";
window.__nativeFixtures = createFixtures();
window.__platformFixtures = createPlatformFixtures();
window.__platformFixtureEnabled = false;
window.__ownerRentFixtureEnabled = false;
window.__ownerRentFixtures = createOwnerPaymentFixtures();
window.fetch = async (input, options = {}) => {
  const url = typeof input === "string" ? input : input.url;
  if (!url.startsWith("https://safehouse-api.onrender.com/api/"))
    throw new Error("External requests disabled by instrumentation");
  let body = {};
  try {
    body = JSON.parse(options.body || "{}");
  } catch {
    /* no request body */
  }
  if(window.__ownerRentFixtureEnabled){if(window.__ownerRentHold&&url.endsWith('/orders/rent-synthetic/recheck'))await new Promise(resolve=>window.__releaseOwnerRentCheck=resolve);const ownerResult=window.__ownerRentFixtures.handler(url,options.method||"GET",body);if(ownerResult!==null)return new Response(JSON.stringify(ownerResult),{status:200,headers:{"Content-Type":"application/json"}});}
  if (
    window.__platformFixtureEnabled &&
    new URL(url).pathname.startsWith("/api/platform/")
  )
    return new Response(
      JSON.stringify(window.__platformFixtures.handler(url, body)),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  const headers = { ...(options.headers || {}) };
  if (
    window.__platformFixtureEnabled &&
    String(headers.Authorization || "").startsWith("Bearer pg1.")
  )
    headers.Authorization = "Bearer fixture_OWNER_access_token";
  const result = window.__nativeFixtures.handler({
    url,
    method: options.method || "GET",
    body,
    headers,
  });
  // Never configure a real FCM project from a test fixture.
  if (url.endsWith("/notifications/config"))
    result.data = { clientEnabled: false, serverEnabled: true, firebase: null };
  return new Response(
    result.contentType ? result.data : JSON.stringify(result.data),
    {
      status: result.status,
      headers: { "Content-Type": result.contentType || "application/json" },
    },
  );
};
