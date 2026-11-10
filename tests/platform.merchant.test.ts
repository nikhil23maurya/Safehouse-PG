import test from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_URL ||= "postgresql://unused:unused@127.0.0.1:1/unit";
process.env.JWT_ACCESS_SECRET ||= "unit-access-secret-32-characters-long";
process.env.JWT_REFRESH_SECRET ||= "unit-refresh-secret-32-characters-long";
const {phoneConfig,verifyPhoneIdentity}=await import("../src/platform/identity.js");
test("retired phone credentials never enable account access regardless of old environment flags",async()=>{
 process.env.PGONE_PHONE_AUTH_ENABLED="true";
 for(const id of ["web","com.safehouse.pg","com.safehouse.pg.testing"])assert.equal(phoneConfig(id),null);
 await assert.rejects(()=>verifyPhoneIdentity("old-provider-token"),{code:"PHONE_AUTH_RETIRED"});
});
