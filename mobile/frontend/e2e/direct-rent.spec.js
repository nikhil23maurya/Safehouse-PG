import {test,expect} from "@playwright/test";
import {createFixtures} from "./fixtures.mjs";
import fs from "node:fs/promises";

test("legacy rent still copies the UPI ID when Paytm is unavailable",async({page})=>{
  const fixtures=createFixtures();let claim=null,created=0,settled=false;
  const intent="upi://pay?pa=owner%40example&pn=Owner&am=8500.99&cu=INR&tr=PGO1234567890123456";
  await page.addInitScript(()=>{window.__directLaunches=0;window.SafeHouseNative={
    getPackageId:()=>"com.safehouse.pg.testing",ready:()=>{},saveSession:()=>true,
    getSession:()=>JSON.stringify({tokens:{kind:"PLATFORM",accessToken:"fixture_STUDENT_access",refreshToken:"fixture_STUDENT_refresh_token"},userId:"user1",activePropertyId:"property1"}),
    copyPaymentDetail:value=>{window.__copiedPaymentDetail=value;return true;},
    openPaytm:()=>false,
    openDirectOwnerUpi:()=>{window.__directLaunches++;},
  };});
  await page.route("https://safehouse-api.onrender.com/api/**",async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    if(path.startsWith("/api/platform/rent/invoices/")){
      if(req.method()==="POST"&&!claim){created++;claim={id:"claim-one",amountPaise:850099,payeeName:"Owner",payeeAddress:"owner@example",reference:"PGO1234567890123456",status:"PENDING_OWNER_CONFIRMATION"};}
      return route.fulfill({json:{claim,remainingPaise:settled?0:850099,settled,ownerConfigured:true,canPrepare:!claim,payable:Boolean(claim)&&!settled,intent:claim&&!settled?intent:null}});
    }
    const result=fixtures.handler({url:req.url(),method:req.method(),headers:req.headers(),body:req.postDataJSON()||{}});
    if(path==="/api/platform/session")for(const m of result.data.memberships)m.organisation.legacyAccess=false;
    return route.fulfill({status:result.status,json:result.data});
  });
  await page.goto("/");
  await page.getByRole("button",{name:"Pay rent",exact:true}).first().click();
  await expect(page.getByRole("button",{name:"Get UPI details",exact:true})).toBeVisible();
  expect(created).toBe(0);
  await page.getByRole("button",{name:"Get UPI details",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Pay in Paytm or another UPI app",exact:true})).toBeVisible();
  await fs.mkdir("visual-evidence/email-journey",{recursive:true});
  await page.screenshot({path:"visual-evidence/email-journey/direct-upi-manual.png",fullPage:true});
  await page.getByRole("button",{name:"Copy UPI ID & open Paytm",exact:true}).click();
  await expect(page.locator("#toasts")).toContainText("Paytm could not open. Paste the ID in your UPI app.");
  await expect.poll(()=>page.evaluate(()=>window.__copiedPaymentDetail)).toBe("owner@example");
  expect(await page.evaluate(()=>window.__directLaunches)).toBe(0);
  expect(created).toBe(1);
  settled=true;claim.status="OWNER_CONFIRMED";
  await page.getByRole("button",{name:"Refresh payment status"}).click();
  await expect(page.getByText("Your owner confirmed this rent payment.")).toBeVisible();
  await expect(page.getByRole("button",{name:"Copy UPI ID & open Paytm",exact:true})).toHaveCount(0);expect(created).toBe(1);
});
