import test, { after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import helmet from "helmet";
import { legalRouter } from "../src/platform/legal.js";
import { billingWebRouter } from "../src/platform/web-static.js";

const app = express();
app.use(helmet());
app.use("/legal", legalRouter);
app.use("/billing", billingWebRouter);
app.get("/api/probe", (_req, res) => res.json({ ok: true }));
app.use((error: any, _req: any, res: any, _next: any) =>
  res.status(error.statusCode || 500).json({ error: { code: error.code } }),
);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.on("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
after(() => { server.close(); });

test("published policies and account requests work without authentication or tracking scripts", async () => {
  for (const path of ["terms", "privacy", "delete-account"]) {
    const response = await fetch(`${base}/legal/${path}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type")!, /text\/html/);
    assert.match(response.headers.get("content-security-policy")!, /default-src 'none'/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const html = await response.text();
    assert.match(html, /nikhil23maurya@gmail.com/);
    assert.match(html, /\/legal\/delete-account/);
    assert.doesNotMatch(html, /<script|<form/i);
  }
  assert.equal((await fetch(`${base}/legal/not-a-policy`)).status, 404);
});

test("billing hosting permits the official custom SDK only on the new surface and serves no source files", async () => {
  const redirect = await fetch(`${base}/billing`, { redirect: "manual" });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get("location"), "/billing/");
  const canonical = await fetch(`${base}/billing/`, { redirect: "manual" });
  assert.equal(canonical.status, 200, "canonical billing URL must never redirect to itself");
  assert.equal((await fetch(`${base}/billing`)).status, 200, "the redirect must terminate");
  const response = await fetch(`${base}/billing/`);
  assert.equal(response.status, 200, "run the root build before this test");
  assert.match(await response.text(), /billing.js/);
  const policy = response.headers.get("content-security-policy")!;
  assert.match(policy, /https:\/\/checkout.razorpay.com/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin-allow-popups");
  for (const name of ["billing.js", "billing.css", "ManropeVariable.ttf", "onboarding-payments.webp"])
    assert.equal((await fetch(`${base}/billing/${name}`)).status, 200);
  for (const name of ["app.js", ".env", "config.json", "package.json"])
    assert.equal((await fetch(`${base}/billing/${name}`)).status, 404);
  const api = await fetch(`${base}/api/probe`);
  assert.doesNotMatch(api.headers.get("content-security-policy")!, /razorpay|firebasejs/);
});
