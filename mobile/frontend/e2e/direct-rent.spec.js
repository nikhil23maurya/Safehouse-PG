import {test,expect} from "@playwright/test";
import {createFixtures} from "./fixtures.mjs";
import fs from "node:fs/promises";

test("fresh resident uses UPI first, retries a failed app launch and reads confirmed status without another transfer",async({page})=>{
  const fixtures=createFixtures();let claim=null,created=0,settled=false;
  const intent="upi://pay?pa=owner%40example&pn=Owner&am=8500.99&cu=INR&tr=PGO1234567890123456";
  await page.addInitScript(()=>{window.__directLaunches=0;window.SafeHouseNative={
    getPackageId:()=>"com.safehouse.pg.testing",ready:()=>{},saveSession:()=>true,
    getSession:()=>JSON.stringify({tokens:{kind:"PLATFORM",accessToken:"fixture_STUDENT_access",refreshToken:"fixture_STUDENT_refresh_token"},userId:"user1",activePropertyId:"property1"}),
    directRentQrImageUrl:()=>"https://example.invalid/optional-qr.png",
    openDirectOwnerUpi:()=>{window.__directLaunches++;setTimeout(()=>window.PGOneDirectUpiResult(false,"The UPI app did not open. Retry or use the optional QR."),20);},
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
  await expect(page.getByRole("button",{name:"Pay with UPI app",exact:true})).toBeVisible();
  expect(created).toBe(0);await expect(page.locator("[data-direct-qr]")).toBeHidden();
  await fs.mkdir("visual-evidence/email-journey",{recursive:true});
  await page.screenshot({path:"visual-evidence/email-journey/direct-upi-first.png",fullPage:true});
  await page.getByRole("button",{name:"Pay with UPI app",exact:true}).click();
  await expect(page.locator("[data-direct-upi-status]")).toContainText("did not open");
  await page.getByRole("button",{name:"Pay with UPI app",exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__directLaunches)).toBe(2);expect(created).toBe(1);
  settled=true;claim.status="OWNER_CONFIRMED";
  await page.getByRole("button",{name:"Refresh payment status"}).click();
  await expect(page.getByText("Your owner confirmed this rent payment.")).toBeVisible();
  await expect(page.getByRole("button",{name:"Pay with UPI app",exact:true})).toHaveCount(0);expect(created).toBe(1);
});
