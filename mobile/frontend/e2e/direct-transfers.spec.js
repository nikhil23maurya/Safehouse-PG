import {test,expect} from "@playwright/test";
import {createFixtures} from "./fixtures.mjs";
import {createDirectPaymentFixtures} from "../test-support/direct-payment-fixtures.js";
import {go,noOverflow} from "./helpers.js";
import fs from "node:fs/promises";
async function setup(page,role="STUDENT",fixture=createDirectPaymentFixtures()){
 const base=createFixtures();
 await page.addInitScript(role=>{
  const initial={tokens:{kind:"PLATFORM",accessToken:`fixture_${role}_access`,refreshToken:`fixture_${role}_refresh_token`},userId:role==="OWNER"?"owner1":"user1",activePropertyId:"property1"};
  window.SafeHouseNative={getPackageId:()=>"com.safehouse.pg.testing",getSession:()=>JSON.stringify(initial),saveSession:()=>true,ready:()=>{},getDirectTransferState:()=>sessionStorage.getItem("direct-payment-state")||"",saveDirectTransferState:v=>{sessionStorage.setItem("direct-payment-state",v);return true;},copyPaymentDetail:value=>{window.__copiedPaymentDetail=value;return true;},openDirectOwnerUpi:uri=>{window.__directIntent=uri;}};
  window.SafeHouseNative.chooseUpiApp=(...args)=>{
   window.__upiAppChoice={args,clipboard:window.__copiedPaymentDetail};
   return true;
  };
 },role);
 await page.route("https://safehouse-api.onrender.com/api/**",async route=>{
  const req=route.request(),data=fixture.handler(req.url(),req.method(),req.postDataJSON()||{});
  if(data?.image)return route.fulfill({status:200,contentType:"image/jpeg",body:Buffer.from(data.data,"base64")});
  if(data)return route.fulfill({status:data.status,json:data.data});
  const result=base.handler({url:req.url(),method:req.method(),headers:req.headers(),body:req.postDataJSON()||{}});return route.fulfill({status:result.status,json:result.data});
 });
 await page.goto("/");await expect(page).toHaveURL(role==="OWNER"?/#ownerHome$/:/#studentHome$/);return fixture;
}
async function jpeg(page){return Buffer.from(await page.evaluate(()=>{const c=document.createElement("canvas");c.width=400;c.height=250;const x=c.getContext("2d");x.fillStyle="white";x.fillRect(0,0,400,250);x.fillStyle="navy";x.font="26px sans-serif";x.fillText("Synthetic meter: 1824",20,100);return c.toDataURL("image/jpeg").split(",")[1];}),"base64");}
async function upload(page,label,buffer){await page.getByLabel(label,{exact:true}).setInputFiles({name:"synthetic-evidence.jpg",mimeType:"image/jpeg",buffer});}
async function bill(page){await page.getByLabel("Electricity amount (₹)").fill("650.25");await upload(page,"Meter photo",await jpeg(page));await page.getByRole("button",{name:"Save electricity bill",exact:true}).click();await expect(page.getByLabel("Choose what to pay")).toBeVisible();}
async function choose(page,choice="RENT"){await page.getByLabel("Choose what to pay").selectOption(choice);await page.getByRole("button",{name:"Continue to payment",exact:true}).click();await expect(page).toHaveURL(/#transferProof$/);}
async function screenshot(page,name){await fs.mkdir("visual-evidence/direct-payments",{recursive:true});await page.screenshot({path:`visual-evidence/direct-payments/${name}.png`,fullPage:true});}
test("copies the exact combined payment details and restores manual proof",async({page})=>{
 const f=await setup(page);await go(page,"payment",{invoiceId:"invoice1"});await bill(page);await choose(page,"BOTH");await expect(page.getByText("₹9,151.24",{exact:true})).toBeVisible();await noOverflow(page);await expect(page.getByRole("heading",{name:"Bill details",exact:true})).toBeVisible();await expect(page.getByText("owner-fixture@invalid",{exact:true})).toHaveCount(1);await screenshot(page,"combined-payment");
 await expect(page.getByRole("heading",{name:"Pay via UPI"})).toBeVisible();
 await expect(page.locator("main")).not.toContainText(/Paytm|PhonePe|Google Pay/i);
 await expect(page.getByRole("button",{name:"Copy UPI ID",exact:true})).toHaveCount(0);
 await page.getByRole("button",{name:"Copy UPI ID & open app",exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__copiedPaymentDetail)).toBe("owner-fixture@invalid");
 await page.getByRole("button",{name:"Copy amount",exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__copiedPaymentDetail)).toBe("9151.24");
 expect(await page.evaluate(()=>window.__directIntent)).toBeUndefined();
 await page.getByRole("button",{name:"Upload payment proof",exact:true}).click();
 await expect(page.getByRole("heading",{level:1,name:"Attach payment proof",exact:true})).toBeVisible();
 expect(f.creates).toBe(1);await screenshot(page,"return-attach-proof");
 await page.reload();await expect(page).toHaveURL(/#transferProof$/);await expect(page.getByLabel("Payment screenshot",{exact:true})).toBeVisible();expect(f.creates).toBe(1);
 await go(page,"invoices");await page.evaluate(()=>window.SafeHouseResume());await expect(page).toHaveURL(/#invoices$/);await go(page,"transferProof",{id:f.transfers[0].id,invoiceId:"invoice1"});
 await expect(page.getByLabel(/UTR|transaction reference/i)).toHaveCount(0);
 await upload(page,"Payment screenshot",await jpeg(page));await page.getByRole("button",{name:"Submit payment proof",exact:true}).click();await expect(page.getByRole("heading",{name:"Payment submitted",exact:true})).toBeVisible();expect(f.transfers[0].status).toBe("SUBMITTED");expect(f.transfers[0].proofs[0].bankReference).toBeNull();await expect(page.getByRole("button",{name:"Download receipt",exact:true})).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>JSON.parse(window.SafeHouseNative.getDirectTransferState()).length)).toBe(0);await screenshot(page,"proof-pending-owner");
 await go(page,"studentHome");await expect(page.getByRole("region",{name:"Current rent"})).toContainText("Payment submitted");
 await expect(page.getByRole("region",{name:"Electricity"})).toContainText("Payment submitted");
 await expect(page.getByRole("button",{name:"Pay rent",exact:true})).toHaveCount(0);await noOverflow(page);await screenshot(page,"resident-dashboard-submitted");
});
test("electricity remains payable after rent was already paid",async({page})=>{
 const f=createDirectPaymentFixtures();f.remainingPaise=0;await setup(page,"STUDENT",f);await go(page,"payment",{invoiceId:"invoice1"});await expect(page.getByText("No rent outstanding")).toBeVisible();await bill(page);
 await expect(page.getByLabel("Choose what to pay").locator("option")).toHaveCount(1);await choose(page,"ELECTRICITY");await expect(page.getByText("₹650.25",{exact:true}).first()).toBeVisible();expect(f.transfers[0].rentPaise).toBe(0);await screenshot(page,"electricity-after-rent");
});
test("owner sees direct UPI setup without merchant onboarding and confirms only after bank checkbox",async({page})=>{
 const f=createDirectPaymentFixtures();f.bill={id:"bill-one",amountPaise:65025,meterEvidenceId:"meter-one",status:"DUE"};f.transfers=[{id:"transfer-one",invoiceId:"invoice1",rentPaise:850099,electricityPaise:65025,amountPaise:915124,payeeAddress:"owner-fixture@invalid",payeeName:"PG Owner",status:"SUBMITTED",proofs:[{id:"proof-one",bankReference:"123456789012",evidenceId:"proof-image",status:"PENDING"}]}];
 await setup(page,"OWNER",f);const photo=(await jpeg(page)).toString("base64");f.evidence={"meter-one":photo,"proof-image":photo};await go(page,"merchant");await expect(page.getByRole("heading",{name:"Rent collection",exact:true})).toBeVisible();await expect(page.getByRole("button",{name:/Connect payment|Continue verification/})).toHaveCount(0);
 await page.getByRole("button",{name:"Review payment",exact:true}).click();await expect(page.getByText("Resident-entered amount: ₹650.25")).toBeVisible();await noOverflow(page);await screenshot(page,"owner-proof-review");
 await page.getByRole("button",{name:"Confirm received payment",exact:true}).click();expect(f.transfers[0].status).toBe("SUBMITTED");await page.getByRole("checkbox").check();await page.getByRole("button",{name:"Confirm received payment",exact:true}).click();await expect(page.getByRole("button",{name:"Download receipt",exact:true})).toBeVisible();expect(f.transfers[0].status).toBe("CONFIRMED");await screenshot(page,"owner-confirmed");
});
test("owner dashboard shows submitted proof and the electricity bill, then reconciles the matched credit",async({page})=>{
 const f=createDirectPaymentFixtures();
 f.bill={id:"bill-one",amountPaise:65025,meterEvidenceId:"meter-one",status:"DUE"};
 f.transfers=[{id:"transfer-one",invoiceId:"invoice1",rentPaise:850099,electricityPaise:65025,amountPaise:915124,
  payeeAddress:"owner-fixture@invalid",payeeName:"PG Owner",status:"SUBMITTED",
  proofs:[{id:"proof-one",bankReference:null,evidenceId:"proof-image",status:"PENDING"}]}];
 await setup(page,"OWNER",f);
 const photo=(await jpeg(page)).toString("base64");f.evidence={"meter-one":photo,"proof-image":photo};
 await expect(page.getByRole("heading",{name:"Payment proofs (1)",exact:true})).toBeVisible();
 await expect(page.getByRole("heading",{name:"Separate electricity",exact:true})).toBeVisible();
 await expect(page.locator(".direct-collection-totals")).toContainText("Collected₹0");
 await noOverflow(page);await screenshot(page,"owner-dashboard-collections");
 await page.getByRole("button",{name:"View bills",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Electricity bills",exact:true})).toBeVisible();
 await expect(page.locator(".direct-collection-row")).toContainText("Aarav Sharma");
 await page.getByText("Meter photo",{exact:true}).click();
 await expect(page.getByRole("img",{name:"Meter photo",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Go back",exact:true}).click();await expect(page).toHaveURL(/#ownerHome$/);
 await page.getByRole("button",{name:"Reconcile payments",exact:true}).click();
 await page.getByRole("checkbox",{name:/Aarav Sharma/}).check();
 await expect(page.locator("[data-reconcile-total]")).toHaveText("₹9,151.24");
 await page.getByLabel("Bank transaction reference",{exact:true}).fill("123456789012");
 await page.getByLabel("Matched bank total (₹)",{exact:true}).fill("9151.23");
 await page.getByRole("checkbox",{name:/I matched each/}).check();
 await page.getByRole("button",{name:"Confirm selected payments",exact:true}).click();
 await expect(page.getByRole("alert")).toContainText("The bank total must match");
 expect(f.transfers[0].status).toBe("SUBMITTED");
 await page.getByLabel("Matched bank total (₹)",{exact:true}).fill("9151.24");
 await page.getByRole("button",{name:"Confirm selected payments",exact:true}).click();
 await expect(page.getByText("1 payment reconciled.",{exact:true})).toBeVisible();
 expect(f.reconciliation.amountPaise).toBe(915124);
 await go(page,"ownerHome");await expect(page.locator(".direct-collection-totals")).toContainText("Collected₹650.25");
});
test("invalid screenshot does not submit an empty proof",async({page})=>{
 const f=await setup(page);await go(page,"payment",{invoiceId:"invoice1"});await choose(page);
 await page.getByRole("button",{name:"Upload payment proof",exact:true}).click();
 await page.getByLabel("Payment screenshot",{exact:true}).setInputFiles({name:"bad.svg",mimeType:"image/svg+xml",buffer:Buffer.from("<svg/>")});
 await page.getByRole("button",{name:"Submit payment proof",exact:true}).click();
 await expect(page.getByText("Choose a JPEG, PNG or WebP photo under 12 MB.",{exact:true})).toBeVisible();
 expect(f.transfers[0].status).toBe("READY");expect(f.uploads).toHaveLength(0);
});
for(const width of [360,393,412])test(`direct bill selection is usable at ${width}px`,async({page})=>{await page.setViewportSize({width,height:800});await setup(page);await go(page,"payment",{invoiceId:"invoice1"});await bill(page);await noOverflow(page);await screenshot(page,`bill-selection-${width}`);});

test("returning from a transfer stays on the prior screen and its invoice", async ({page}) => {
 const fixture = await setup(page);
 await go(page, "invoices");
 await go(page, "payment", {invoiceId:"invoice1"});
 await choose(page);
 await page.getByRole("button", {name:"Upload payment proof", exact:true}).click();
 await page.getByRole("button", {name:"Go back", exact:true}).click();
 await expect(page).toHaveURL(/#payment$/);
 await page.evaluate(()=>window.SafeHouseResume());
 await expect(page).toHaveURL(/#payment$/);
 await page.getByRole("button", {name:"Continue payment", exact:true}).click();
 await expect(page.getByLabel("Payment screenshot", {exact:true})).toBeVisible();
 await page.getByRole("button", {name:"Rent & electricity", exact:true}).click();
 await expect(page).toHaveURL(/#payment$/);
 await page.evaluate(()=>window.SafeHouseBack());
 await expect(page).toHaveURL(/#invoices$/);
 expect(fixture.creates).toBe(1);
 expect(fixture.transfers[0].status).toBe("READY");
});

test("the UPI app chooser opens after copying only the UPI ID and the request stays unpaid", async ({page}) => {
 const fixture=await setup(page);
 await go(page,"payment",{invoiceId:"invoice1"});
 await choose(page);
 await page.getByRole("button",{name:"Copy UPI ID & open app",exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__upiAppChoice)).toEqual({args:[],clipboard:"owner-fixture@invalid"});
 expect(await page.evaluate(()=>window.__directIntent)).toBeUndefined();
 await page.evaluate(()=>window.SafeHouseResume());
 await expect(page.getByRole("heading",{name:"Pay via UPI"})).toBeVisible();
 await expect(page.getByLabel("Payment screenshot",{exact:true})).toBeHidden();
 expect(fixture.transfers[0].status).toBe("READY");
});

test("a changed owner or bill blocks copying and opening the UPI app chooser", async ({page}) => {
 const fixture=await setup(page);
 await go(page,"payment",{invoiceId:"invoice1"});
 await choose(page);
 fixture.paymentIssue="The bill or owner's UPI details changed.";
 await page.getByRole("button",{name:"Copy UPI ID & open app",exact:true}).click();
 await expect(page.locator("#toasts")).toContainText(fixture.paymentIssue);
 expect(await page.evaluate(()=>window.__copiedPaymentDetail)).toBeUndefined();
 expect(await page.evaluate(()=>window.__upiAppChoice)).toBeUndefined();
 expect(await page.evaluate(()=>window.__directIntent)).toBeUndefined();
 expect(fixture.creates).toBe(1);
});
