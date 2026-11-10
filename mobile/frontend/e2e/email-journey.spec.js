import {test,expect} from "@playwright/test";
import fs from "node:fs/promises";
import {platform} from "./platform-helper.js";
import {noOverflow} from "./helpers.js";
async function createAccount(page){
  await page.getByRole("button",{name:"New to PGOne? Create account"}).click();
  await page.getByLabel("Email address").fill("rahul@example.test");
  await page.getByLabel("Password",{exact:true}).fill("Private password 123!");
  await page.getByLabel("Confirm password",{exact:true}).fill("Private password 123!");
  await page.getByRole("button",{name:"Create account",exact:true}).click();
  await expect(page).toHaveURL(/#chooseRole$/);
}
async function createOwnerProperty(page){
  await createAccount(page);
  await page.getByRole("button",{name:"I manage a PG",exact:false}).click();
  await page.getByLabel("Full name").fill("Rahul Sharma");
  await page.getByRole("button",{name:"Continue",exact:true}).click();
  await page.getByLabel("PG name").fill("Maple House");
  await page.getByLabel("City",{exact:true}).fill("Bengaluru");
  await page.getByRole("button",{name:"Create my PG"}).click();
  await expect(page).toHaveURL(/#subscription$/);
}
async function forceRoute(page,name){await page.evaluate(name=>{const state={safehouse:true,name,params:{},depth:1};history.pushState(state,"",`#${name}`);dispatchEvent(new PopStateEvent("popstate",{state}));},name);}
test("email screens contain the intended fields and retire phone routes",async({page})=>{
  await platform(page);
  await expect(page.locator('[data-form=login] input')).toHaveCount(2);
  await expect(page.getByRole("button",{name:/phone|mobile|OTP/i})).toHaveCount(0);
  await page.getByRole("button",{name:"New to PGOne? Create account"}).click();
  await expect(page.locator('[data-form=signup] input')).toHaveCount(3);
  await page.getByLabel("Email address").fill("rahul@example.test");
  await page.getByLabel("Password",{exact:true}).fill("Private password 123!");
  await page.getByLabel("Confirm password",{exact:true}).fill("not the same password");
  await page.getByRole("button",{name:"Create account",exact:true}).click();
  await expect(page.locator('.form-error')).toContainText("Passwords do not match");
  for(const route of ["phone","otp"]){await forceRoute(page,route);await expect(page.locator('[data-form=phone], [data-form=otp]')).toHaveCount(0);}
});
test("one PG, unpaid route denial and server-confirmed entitlement through native checkout",async({page})=>{
  const fixture=await platform(page,{billing:true});await createOwnerProperty(page);
  expect(fixture.propertiesCreated).toBe(1);
  await forceRoute(page,"ownerHome");await expect(page).toHaveURL(/#subscription$/);
  await forceRoute(page,"merchant");await expect(page).toHaveURL(/#subscription$/);
  await page.getByRole("button",{name:"Pay ₹249 securely with UPI"}).click();
  await expect.poll(()=>page.evaluate(()=>window.__lastPlanOptions)).toMatchObject({amount:24900,currency:"INR",email:"rahul@example.test",order_id:"order_SYNTHETIC001"});
  expect(await page.evaluate(()=>window.__lastPlanOptions.contact)).toBeUndefined();
  await page.evaluate(()=>window.PGOnePlanPaymentResult("order_SYNTHETIC001","RETURNED_CHECK_PROVIDER"));
  await expect(page).toHaveURL(/#subscription$/);expect(fixture.entitled).toBe(false);
  fixture.activatePaid();await page.getByRole("button",{name:"Check payment status"}).click();
  await expect(page).toHaveURL(/#setupReady$/);
});
test("recovery uses a neutral response and visibility control shows the password",async({page})=>{
  await platform(page);await page.getByLabel("Password",{exact:true}).fill("private");
  await page.getByRole("button",{name:"Show password",exact:true}).click();
  await expect(page.getByLabel("Password",{exact:true})).toHaveAttribute("type","text");
  await page.getByRole("button",{name:"Forgot password?"}).click();
  await page.getByLabel("Email address").fill("unknown@example.test");
  await page.getByRole("button",{name:"Send recovery link"}).click();
  await expect(page.locator('[data-recovery-status]')).toContainText("If this email has an eligible account");
});
test("resident onboarding uses owner-approved email invitations without an owner fee",async({page})=>{
  await platform(page);await createAccount(page);
  await page.getByRole("button",{name:"I live in a PG",exact:false}).click();
  await page.getByLabel("Full name").fill("Ananya Rao");
  await page.getByRole("button",{name:"Continue",exact:true}).click();
  await expect(page).toHaveURL(/#joinWorkspace$/);
  await expect(page.getByRole("button",{name:"Refresh workspaces"})).toBeVisible();
  await expect(page.getByRole("button",{name:/Pay.*249/})).toHaveCount(0);
});
test("email screens fit supported mobile widths",async({page})=>{
  await platform(page);await fs.mkdir('visual-evidence/email-journey',{recursive:true});
  for(const width of [360,393,412,600]){await page.setViewportSize({width,height:852});await noOverflow(page);await page.screenshot({path:`visual-evidence/email-journey/login-${width}.png`,fullPage:true});}
  await page.getByRole("button",{name:"New to PGOne? Create account"}).click();
  await page.screenshot({path:'visual-evidence/email-journey/signup.png',fullPage:true});await noOverflow(page);
});
