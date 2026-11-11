import {test,expect} from "@playwright/test";
import fs from "node:fs/promises";
import {setup,login,go,noOverflow} from "./helpers.js";
import {platform} from "./platform-helper.js";
test("request review, capacity error, rent setup and logical back preserve the selected property",async({page})=>{
 const f=await setup(page);await login(page);await page.locator('.quick-actions [data-route=residentRequests]').click();
 await expect(page.getByRole('heading',{name:'Resident requests'})).toBeVisible();await page.getByRole('button',{name:/Nisha Rao/}).click();
 await expect(page.getByRole('heading',{name:'Nisha Rao'})).toBeVisible();await page.getByRole('button',{name:'Go back'}).click();await expect(page).toHaveURL(/#residentRequests$/);
 await page.getByRole('button',{name:/Nisha Rao/}).click();await page.getByLabel('Confirm your PGOne password').fill('FixturePass123!');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Accept request'}).click();
 await expect(page).toHaveURL(/#residentRentSetup$/);await page.getByLabel('Room',{exact:true}).selectOption('room1');await page.getByLabel('Monthly rent',{exact:true}).fill('8500.99');await page.getByLabel('Confirm your PGOne password').fill('FixturePass123!');await page.getByRole('checkbox').check();
 f.control.capacityRejected=true;await page.getByRole('button',{name:'Save and activate resident'}).click();await expect(page.locator('.form-error')).toContainText('no vacant beds');await expect(page.getByLabel('Monthly rent',{exact:true})).toHaveValue('8500.99');
 await fs.mkdir('visual-evidence/owner-ux',{recursive:true});await noOverflow(page);await page.screenshot({path:'visual-evidence/owner-ux/rent-setup-error.png',fullPage:true});
 f.control.capacityRejected=false;await page.getByRole('button',{name:'Save and activate resident'}).click();await expect(page).toHaveURL(/#resident$/);
 const writes=f.control.requests.filter(r=>r.path.endsWith('/resident-requests/request1/rent'));expect(writes.at(-1).body).toMatchObject({monthlyRentPaise:850099,rentDueDay:5,identityChecked:true,roomId:'room1'});
 expect(f.control.requests.filter(r=>r.path==='/api/owner/students'&&r.method==='POST')).toHaveLength(0);expect(f.errors).toEqual([]);
});
test("reject request closes access and does not expose rent activation",async({page})=>{
 const f=await setup(page);await login(page);await go(page,'residentRequest',{id:'request1'});await page.getByLabel('Confirm your PGOne password').fill('FixturePass123!');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Reject request'}).click();await page.getByRole('dialog').getByRole('button',{name:'Reject request'}).click();
 await expect(page.getByText('Rejected',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Set up room and rent'})).toHaveCount(0);expect(f.control.requestStatus).toBe('REJECTED');
});
test("all three loading bubbles keep moving with a subtle reduced-motion alternative",async({page})=>{
 await setup(page);await login(page);await page.emulateMedia({reducedMotion:'reduce'});let release;const hold=new Promise(r=>release=r);
 await page.route('**/resident-requests?**',async route=>{await hold;await route.fulfill({json:{requests:[]}});});
 await page.locator('.quick-actions [data-route=residentRequests]').click();await expect(page.locator('.screen-loading .loading-dots i')).toHaveCount(3);
 const sample=()=>page.locator('.screen-loading .loading-dots i').evaluateAll(nodes=>nodes.map(n=>({opacity:getComputedStyle(n).opacity,animation:getComputedStyle(n).animationName,transform:getComputedStyle(n).transform})));
 const frames=[];for(let i=0;i<5;i++){frames.push(await sample());await page.waitForTimeout(130);}
 expect(new Set(frames.map(f=>f.map(n=>n.opacity).join(','))).size).toBeGreaterThan(2);expect(frames.flat().every(n=>n.animation==='dot-pulse'&&n.transform==='none')).toBe(true);
 await page.emulateMedia({reducedMotion:'no-preference'});const moving=[];for(let i=0;i<4;i++){moving.push(await sample());await page.waitForTimeout(130);}expect(moving.flat().some(n=>n.transform!=='none')).toBe(true);release();
});
test("payment and subscription remain light; back never initiates another payment",async({page})=>{
 const f=await platform(page,{billing:true});await page.getByRole('button',{name:'New to PGOne? Create account'}).click();await page.getByLabel('Email address').fill('owner@example.test');await page.getByLabel('Password',{exact:true}).fill('Private synthetic password 123!');await page.getByLabel('Confirm password').fill('Private synthetic password 123!');await page.getByRole('button',{name:'Create account',exact:true}).click();await page.getByLabel('Full name').fill('Owner Person');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('PG name').fill('First PG');await page.getByLabel('City',{exact:true}).fill('Pune');await page.getByRole('button',{name:'Create my PG'}).click();
 await expect(page.locator('.royal-plan')).toHaveCSS('background-color','rgb(255, 255, 255)');await expect(page.locator('.plan-price')).toContainText('₹1');await page.getByRole('button',{name:'Go back'}).click();await expect(page).toHaveURL(/#workspaces$/);await expect(page.getByRole('button',{name:'Add another property'})).toBeVisible();await expect(page.getByRole('button',{name:/Join with a PG code|Set up or join/})).toHaveCount(0);
 await go(page,'subscription');await page.getByLabel('Mobile number for payment').fill('9999999999');await page.getByRole('button',{name:'Pay ₹1 with UPI'}).click();await expect.poll(()=>page.evaluate(()=>window.__lastPlanOptions?.order_id)).toBe('order_SYNTHETIC001');await page.evaluate(()=>window.PGOnePlanPaymentResult('order_SYNTHETIC001','RETURNED_CHECK_PROVIDER'));await expect(page).toHaveURL(/#planVerification$/);
 await expect(page.locator('.verification-page')).toHaveCSS('background-color','rgb(248, 250, 255)');await expect(page.getByRole('button',{name:'Go back'})).toBeVisible();const order=await page.evaluate(()=>window.__lastPlanOptions.order_id);await page.getByRole('button',{name:'Go back'}).click();await expect(page).toHaveURL(/#subscription$/);expect(await page.evaluate(()=>window.__lastPlanOptions.order_id)).toBe(order);expect(f.propertiesCreated).toBe(1);
 await fs.mkdir('visual-evidence/owner-ux',{recursive:true});await page.screenshot({path:'visual-evidence/owner-ux/light-plan.png',fullPage:true});
 f.activatePaid();await go(page,'workspaces');await page.getByRole('button',{name:'Add another property'}).click();
 await page.getByLabel('PG name').fill('Second PG');await page.getByLabel('City',{exact:true}).fill('Pune');await page.getByRole('button',{name:'Create my PG'}).click();
 await expect(page).toHaveURL(/#properties$/);await expect(page.getByRole('button',{name:/Second PG/})).toBeVisible();expect(f.propertiesCreated).toBe(2);
 await page.getByRole('button',{name:'Go back'}).click();await expect(page).toHaveURL(/#ownerHome$/);await expect(page.locator('.property-context')).toContainText('Second PG');
 await go(page,'workspaces');await expect(page.getByRole('button',{name:/I'm a Resident|Join with a PG code/})).toHaveCount(0);
 await page.screenshot({path:'visual-evidence/owner-ux/owner-properties.png',fullPage:true});
});
