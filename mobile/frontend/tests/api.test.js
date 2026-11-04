import test from "node:test";
import assert from "node:assert/strict";
import { createApiClient } from "../src/core/api.js";

const response = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function harness(fetchImpl) {
  const state = {
    authEpoch: 1,
    user: { id: "owner1", role: "OWNER" },
    tokens: { accessToken: "old", refreshToken: "refresh" },
    property: { id: "property1" },
  };
  let expired = 0;
  const api = createApiClient({
    getState: () => state,
    saveTokens: async (tokens) => {
      state.tokens = tokens;
    },
    onExpired: () => expired++,
    fetchImpl,
  });
  return { state, api, expired: () => expired };
}
test("authenticated owner requests send the captured property context", async () => {
  let observed;
  const h = harness(async (url, options) => {
    observed = options;
    return response({ rooms: [] });
  });
  await h.api("/api/owner/rooms");
  assert.equal(observed.headers.Authorization, "Bearer old");
  assert.equal(observed.headers["X-Property-Id"], "property1");
  assert.equal(observed.credentials, "omit");
});
test("concurrent expired access requests use a single refresh", async () => {
  let refreshes = 0;
  const h = harness(async (url, opts) => {
    if (url.endsWith("/auth/refresh")) {
      refreshes++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return response({
        tokens: { accessToken: "new", refreshToken: "new-refresh" },
      });
    }
    return opts.headers.Authorization === "Bearer old"
      ? response({ error: { message: "expired" } }, 401)
      : response({ ok: true });
  });
  const results = await Promise.all([
    h.api("/api/owner/rooms"),
    h.api("/api/owner/dashboard"),
  ]);
  assert.ok(results.every((x) => x.ok));
  assert.equal(refreshes, 1);
});
test("property stays captured while an expired request is refreshed", async () => {
  const observed = [];
  const h = harness(async (url, opts) => {
    if (url.endsWith("/auth/refresh")) {
      h.state.property = { id: "property2" };
      return response({
        tokens: { accessToken: "new", refreshToken: "new-refresh" },
      });
    }
    observed.push(opts.headers["X-Property-Id"]);
    return opts.headers.Authorization === "Bearer old"
      ? response({}, 401)
      : response({ ok: true });
  });
  await h.api("/api/owner/rooms");
  assert.deepEqual(observed, ["property1", "property1"]);
});
test("financial transport failures are uncertain and never replayed", async () => {
  let calls = 0;
  const h = harness(async () => {
    calls++;
    throw new Error("connection reset");
  });
  await assert.rejects(
    h.api("/api/owner/invoices/i/manual-payment", {
      method: "POST",
      body: { amount: 100 },
    }),
    (error) => error.uncertain === true,
  );
  assert.equal(calls, 1);
});
test("refresh transport failure preserves the session", async () => {
  const h = harness(async (url) => {
    if (url.endsWith("/auth/refresh")) throw new Error("offline");
    return response({}, 401);
  });
  await assert.rejects(h.api("/api/owner/rooms"));
  assert.equal(h.expired(), 0);
  assert.ok(h.state.tokens);
});
test("invalid refresh credentials expire only the original session", async () => {
  const h = harness(async () =>
    response({ error: { message: "invalid" } }, 401),
  );
  await assert.rejects(h.api("/api/owner/rooms"));
  assert.equal(h.expired(), 1);
});
test("stale unauthorized response cannot clear another signed-in user", async () => {
  let release;
  const h = harness(async () => {
    await new Promise((resolve) => {
      release = resolve;
    });
    return response({}, 401);
  });
  const request = h.api("/api/owner/rooms");
  h.state.authEpoch++;
  h.state.user = { id: "another", role: "OWNER" };
  release();
  await assert.rejects(request, (error) => error.code === "STALE_SESSION");
  assert.equal(h.expired(), 0);
});
test("server field errors and permission failures reach the form unchanged", async () => {
  const details = { fieldErrors: { roomId: ["Room is full"] } };
  const h = harness(async () =>
    response(
      {
        error: {
          code: "ROOM_FULL",
          message: "This room has no vacant beds",
          details,
        },
      },
      409,
    ),
  );
  await assert.rejects(
    h.api("/api/owner/students", { method: "POST", body: {} }),
    (error) =>
      error.code === "ROOM_FULL" &&
      error.details.fieldErrors.roomId[0] === "Room is full",
  );
});
test("public login sends no owner token or property header", async () => {
  const h = harness(async (_url, opts) => {
    assert.equal(opts.headers.Authorization, undefined);
    assert.equal(opts.headers["X-Property-Id"], undefined);
    return response({});
  });
  await h.api("/api/auth/login", {
    method: "POST",
    public: true,
    body: { email: "fixture@example.test", password: "fixture" },
  });
});
