import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
Object.assign(process.env, {
  DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/merchant_unit",
  JWT_ACCESS_SECRET: "merchant-unit-access-32-characters-long",
  JWT_REFRESH_SECRET: "merchant-unit-refresh-32-characters-long",
  PGONE_PLATFORM_ENABLED: "true", PGONE_CASHFREE_EMBEDDED_ENABLED: "true",
  PGONE_CASHFREE_PARTNER_API_KEY: "synthetic-partner-key", PGONE_CASHFREE_ENV: "LIVE",
});
const { merchantReference, merchantStage, safeOnboardingLink, cashfreeSignature,
  merchantBankInput, CashfreeMerchantProvider } = await import("../src/platform/cashfree-merchant.js");

test("merchant approval requires the exact organisation binding and an approved PG product", () => {
  const id = merchantReference("owner-org-a");
  assert.match(id, /^pgo_[a-f0-9]{32}$/);
  assert.notEqual(id, merchantReference("owner-org-b"));
  const remote = (onboarding_status: string, kyc: string) => ({ merchant_id: id, onboarding_status,
    product_status: [{ product_name: "PG", product_min_kyc_status: kyc }] });
  assert.equal(merchantStage(remote("Created", "MIN_KYC_APPROVED"), id).status, "VERIFY_EMAIL");
  assert.equal(merchantStage(remote("Email Verified", "MIN_KYC_PENDING"), id).status, "KYC_REQUIRED");
  assert.equal(merchantStage(remote("Email Verified", "MIN_KYC_SUBMITTED"), id).status, "UNDER_REVIEW");
  assert.equal(merchantStage(remote("Email Verified", "MIN_KYC_APPROVED"), id).status, "APPROVED");
  assert.equal(merchantStage(remote("SUSPENDED", "MIN_KYC_APPROVED"), id).status, "CHECKING");
  assert.equal(merchantStage(remote("ACTIVE", "MIN_KYC_REJECTED"), id).status, "ACTION_REQUIRED");
  assert.throws(() => merchantStage(remote("ACTIVE", "MIN_KYC_APPROVED"), "another-merchant"), { code: "MERCHANT_RESPONSE_MISMATCH" });
  const conflict = remote("ACTIVE", "MIN_KYC_APPROVED");
  conflict.product_status.push({ product_name: "PG", product_min_kyc_status: "MIN_KYC_REJECTED" });
  assert.throws(() => merchantStage(conflict, id), { code: "MERCHANT_RESPONSE_MISMATCH" });
});

test("only the official live onboarding host can enter the isolated KYC view", () => {
  const safe = "https://merchant.cashfree.com/merchantwebapp/validate/token?goto=onboarding";
  assert.equal(safeOnboardingLink(safe), safe);
  for (const url of ["http://merchant.cashfree.com/", "https://merchant.cashfree.com.evil.test/",
    "https://evil.test/merchant.cashfree.com", "https://merchant.cashfree.com@evil.test/",
    "https://name:password@merchant.cashfree.com/", "https://merchant.cashfree.com:8443/",
    "javascript:alert(1)", "https://test.cashfree.com/", "not-a-url"])
    assert.throws(() => safeOnboardingLink(url), { code: "UNSAFE_ONBOARDING_LINK" });
});

test("merchant notifications require the signed raw timestamp and body within the replay window", () => {
  const now = Date.now(), timestamp = String(now), raw = Buffer.from('{"type":"MERCHANT_ONBOARDING_STATUS"}');
  const sign = (stamp: string, body = raw) => crypto.createHmac("sha256", "synthetic-partner-key").update(stamp).update(body).digest("base64");
  assert.equal(cashfreeSignature(raw,timestamp,sign(timestamp),"synthetic-partner-key",now), true);
  const iso = new Date(now).toISOString();
  assert.equal(cashfreeSignature(raw,iso,sign(iso),"synthetic-partner-key",now), true);
  assert.equal(cashfreeSignature(Buffer.from(`${raw} `),timestamp,sign(timestamp),"synthetic-partner-key",now), false);
  assert.equal(cashfreeSignature(raw,timestamp,sign(timestamp),"wrong-key",now), false);
  for (const time of [now-300001,now+30001]) {
    const stamp=String(time);
    assert.equal(cashfreeSignature(raw,stamp,sign(stamp),"synthetic-partner-key",now), false);
  }
  assert.equal(cashfreeSignature(raw,timestamp,"bad","synthetic-partner-key",now), false);
});

test("bank submissions require matching numbers, valid IFSC and explicit consent", () => {
  const input = {accountNumber:"123456789012",confirmAccountNumber:"123456789012",ifsc:"abcd0123456",consent:true};
  assert.equal(merchantBankInput.parse(input).ifsc,"ABCD0123456");
  for (const patch of [{confirmAccountNumber:"123456789013"},{ifsc:"ABCD1123456"},{consent:false},{accountNumber:"1234"}])
    assert.equal(merchantBankInput.safeParse({...input,...patch}).success,false);
});

test("merchant API uses partner authentication, exact paths, bounded requests and sanitised failures", async () => {
  const requests:any[]=[];
  const provider = new CashfreeMerchantProvider(async (url,options) => {
    requests.push({url:String(url),options});
    return new Response(JSON.stringify({merchant_id:"pgo_example"}),{status:200});
  });
  await provider.get("pgo_example");
  await provider.bank("pgo_example","123456789012","ABCD0123456");
  assert.equal(requests[0].url,"https://api.cashfree.com/partners/merchants/pgo_example");
  assert.equal(requests[0].options.headers["x-api-version"],"2023-01-01");
  assert.equal(requests[0].options.headers["x-partner-apikey"],"synthetic-partner-key");
  assert.equal(requests[0].options.redirect,"error");
  assert.ok(requests[0].options.signal);
  assert.equal(requests[1].options.method,"PATCH");
  assert.deepEqual(JSON.parse(requests[1].options.body),{bank_account_details:{bank_account_number:"123456789012",bank_ifsc:"ABCD0123456"}});
  await assert.rejects(()=>provider.get("../other"),{code:"INVALID_PROVIDER_PATH"});
  const rejected = new CashfreeMerchantProvider(async()=>new Response("private provider details",{status:403}));
  await assert.rejects(()=>rejected.get("pgo_example"),(error:any)=>error.code==="MERCHANT_PROVIDER_UNAVAILABLE" && !error.message.includes("private"));
  const unreadable = new CashfreeMerchantProvider(async()=>new Response("private provider details",{status:200}));
  await assert.rejects(()=>unreadable.get("pgo_example"),(error:any)=>error.code==="MERCHANT_PROVIDER_UNAVAILABLE" && !error.message.includes("private"));
});
