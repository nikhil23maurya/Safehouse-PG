import {test,expect} from "@playwright/test";
import fs from "node:fs/promises";
import {createFixtures} from "./fixtures.mjs";
import {createOwnerPaymentFixtures} from "../test-support/owner-payment-fixtures.js";
import {go,noOverflow} from "./helpers.js";

async function setup(page,role="STUDENT"){
 const base=createFixtures(),f=createOwnerPaymentFixtures();
 await page.addInitScript(role=>{
  const initial={tokens:{kind:"PLATFORM",accessToken:`fixture_${role}_access`,refreshToken:`fixture_${role}_refresh_token`},userId:role==="OWNER"?"owner1":"user1",activePropertyId:"property1"};
  window.SafeHouseNative={getPackageId:()=>"com.safehouse.pg.testing",getSession:()=>sessionStorage.getItem("owner-test-vault")||JSON.stringify(initial),saveSession:raw=>{sessionStorage.setItem("owner-test-vault",raw||"null");return true;},ready:()=>{},getRentPaymentState:()=>sessionStorage.getItem("owner-test-rent")||"{}",getMerchantReturnPending:()=>false,acknowledgeMerchantReturn:()=>{},acknowledgeRentPayment:()=>sessionStorage.removeItem("owner-test-rent"),connectOwnerPaymentAccount:url=>{window.__merchantUrl=url;},openOwnerRentUpi:raw=>{
   window.__ownerRentOptions=JSON.parse(raw);const p=window.__ownerRentOptions;sessionStorage.setItem("owner-test-rent",JSON.stringify({invoiceId:p.invoiceId,rentOrderId:p.rentOrderId,membershipId:p.membershipId,orderId:p.order_id,status:"RETURNED_CHECK_PROVIDER"}));
  }};
 },role);
 await page.route("https://safehouse-api.onrender.com/api/**",async route=>{
  const r=route.request(),body=r.postDataJSON()||{},data=f.handler(r.url(),r.method(),body);
  if(data!==null)return route.fulfill({json:data});
  const result=base.handler({url:r.url(),method:r.method(),headers:r.headers(),body});return route.fulfill({status:result.status,contentType:result.contentType||"application/json",body:result.contentType?result.data:JSON.stringify(result.data)});
 });
 await page.goto("/");await expect(page).toHaveURL(role==="OWNER"?/#ownerHome$/:/#studentHome$/);return f;
}
async function start(page){await go(page,"payment",{invoiceId:"invoice1"});await page.getByLabel("Mobile number for payment").fill("9999999999");await page.getByRole("button",{name:"Pay rent with UPI",exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__ownerRentOptions?.order_id)).toBe("order_SYNTHRENT");}
async function screenshot(page,name){await fs.mkdir("visual-evidence/owner-payments",{recursive:true});await page.screenshot({path:`visual-evidence/owner-payments/${name}.png`,fullPage:true});}
test("owner connects using provider-hosted consent; pending KYC never shows ready",async({page})=>{
 const f=await setup(page,"OWNER");await go(page,"merchant");await expect(page.getByText("Verification pending",{exact:true})).toBeVisible();await expect(page.getByText("Your payment account is ready.")).toHaveCount(0);await noOverflow(page);await screenshot(page,"owner-kyc-pending");
 await page.locator('[name="accepted"]').check();await page.getByRole("button",{name:"Continue verification",exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__merchantUrl||"")).toContain("https://auth.razorpay.com/authorize?");
 f.ready=true;await page.getByRole("button",{name:"Refresh account status",exact:true}).click();await expect(page.getByText("Your payment account is ready.",{exact:true})).toBeVisible();await screenshot(page,"owner-account-ready");
});
test("approval-disabled and suspended merchants have honest UI and preserve manual fallback",async({page})=>{
 const f=await setup(page,"OWNER");f.enabled=false;await go(page,"merchant");await expect(page.getByText(/awaiting Razorpay platform activation/)).toBeVisible();await expect(page.getByRole("button",{name:"Set up direct owner UPI",exact:true})).toBeVisible();await expect(page.getByText("Your payment account is ready.")).toHaveCount(0);await screenshot(page,"owner-activation-pending");
 f.enabled=true;f.ownerStatus="SUSPENDED";await page.getByRole("button",{name:"Refresh account status",exact:true}).click();await expect(page.getByText("Collection paused",{exact:true})).toBeVisible();await screenshot(page,"owner-collection-paused");
});
test("UPI return shows dedicated verification before reconciliation; only server capture produces success",async({page})=>{
 const f=await setup(page);await start(page);
 const payload=await page.evaluate(()=>window.__ownerRentOptions);expect(payload.amount).toBe(850099);expect(payload.key).toBe("rzp_test_oauth_SYNTHRENT");expect(payload.contact).toBe("+919999999999");expect(payload).not.toHaveProperty("merchantId");
 let release;const hold=new Promise(resolve=>release=resolve);await page.route("**/orders/rent-synthetic/recheck",async route=>{await hold;await route.fulfill({json:f.status()});});
 await page.evaluate(()=>window.PGOneRentPaymentResult("order_SYNTHRENT","RETURNED_CHECK_PROVIDER"));await expect(page.getByRole("heading",{name:"Verifying your payment",exact:true})).toBeVisible();await expect(page.locator(".loading-dots i")).toHaveCount(3);await expect(page.getByRole("button",{name:"Pay rent with UPI",exact:true})).toHaveCount(0);await noOverflow(page);await screenshot(page,"resident-verifying-rent");
 release();await expect(page.getByRole("heading",{name:"Payment is still being verified.",exact:true})).toBeVisible();expect(f.creates).toBe(1);
 f.captured=true;await page.getByRole("button",{name:"Check again",exact:true}).click();await expect(page).toHaveURL(/#rentSuccess$/);await expect(page.getByText("pay_SYNTHRENT",{exact:true})).toBeVisible();await expect(page.getByText("₹8,500.99",{exact:true})).toBeVisible();await screenshot(page,"resident-rent-success");expect(f.creates).toBe(1);
});
test("cold restart resumes exact pending rent and ignores a different order's capture",async({page})=>{
 const f=await setup(page);await start(page);f.pending=true;await page.reload();await expect(page).toHaveURL(/#rentVerification$/);await expect(page.getByRole("heading",{name:"Payment is still being verified.",exact:true})).toBeVisible();expect(f.creates).toBe(1);
 f.captured=true;f.wrongOrder=true;await page.getByRole("button",{name:"Check again",exact:true}).click();await expect(page.getByRole("heading",{name:"Payment successful",exact:true})).toHaveCount(0);await expect(page).toHaveURL(/#rentVerification$/);
});
test("SDK callback alone and refund never produce green rent success",async({page})=>{
 const f=await setup(page);await start(page);await page.evaluate(()=>window.PGOneRentPaymentResult("order_OTHER","RETURNED_CHECK_PROVIDER"));await expect(page).toHaveURL(/#payment$/);
 await page.evaluate(()=>window.PGOneRentPaymentResult("order_SYNTHRENT","RETURNED_CHECK_PROVIDER"));await expect(page.getByRole("heading",{name:"Payment is still being verified.",exact:true})).toBeVisible();f.captured=true;f.refunded=true;await page.getByRole("button",{name:"Check again",exact:true}).click();await expect(page.getByRole("heading",{name:"Payment successful",exact:true})).toHaveCount(0);
});
test("owner collections show captured rent separately from unconfirmed bank settlement",async({page})=>{
 const f=await setup(page,"OWNER");f.captured=true;await go(page,"merchantCollections");await expect(page.getByText("Bank settlement not confirmed yet",{exact:true})).toBeVisible();await expect(page.getByText("No bank settlements have been confirmed.",{exact:true})).toBeVisible();await noOverflow(page);await screenshot(page,"owner-rent-collections");
});
test("compact owner setup remains usable at 360 by 640",async({page})=>{
 await page.setViewportSize({width:360,height:640});await setup(page,"OWNER");await go(page,"merchant");await noOverflow(page);await expect(page.getByRole("button",{name:"Continue verification",exact:true})).toBeVisible();await screenshot(page,"owner-compact-360");
});
