import { createFixtures } from "../e2e/fixtures.mjs";
window.__nativeFixtures = createFixtures();
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
  const result = window.__nativeFixtures.handler({
    url,
    method: options.method || "GET",
    body,
    headers: options.headers || {},
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
