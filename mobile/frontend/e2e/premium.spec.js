import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import {platform} from './platform-helper.js';
import {go,noOverflow} from './helpers.js';

async function signup(page){
 await page.getByLabel('Email address').fill('premium@example.test');
 await page.getByLabel('Password',{exact:true}).fill('Private synthetic password 123!');
 await page.getByLabel('Confirm password',{exact:true}).fill('Private synthetic password 123!');
 await page.getByRole('button',{name:'Create account',exact:true}).click();
}
async function owner(page,options={}){
 const f=await platform(page,{billing:true,...options});
 await page.getByRole('button',{name:'New to PGOne? Create account'}).click();await signup(page);
 await expect(page).toHaveURL(/#setupProfile$/);
 await page.getByLabel('Full name').fill('Premium Owner');await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByLabel('PG name').fill('Premium PG');await page.getByLabel('City',{exact:true}).fill('Pune');
 await page.getByRole('button',{name:'Create my PG'}).click();await expect(page).toHaveURL(/#subscription$/);return f;
}
async function pay(page){await page.getByLabel('Mobile number for payment').fill('9999999999');await page.getByRole('button',{name:'Pay ₹1 with UPI'}).click();await expect.poll(()=>page.evaluate(()=>window.__lastPlanOptions?.order_id)).toBe('order_SYNTHETIC001');}

test('reduced-price UI preserves earlier 249 requests and never launches a different price',async({page})=>{
 await owner(page,{pendingAmount:24900});
 await expect(page.getByText(/earlier ₹249 payment needs confirmation before a new ₹1 payment/)).toBeVisible();
 await expect(page.getByRole('button',{name:'Pay ₹1 with UPI'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Check payment status'})).toBeVisible();
 expect(await page.evaluate(()=>window.__lastPlanOptions)).toBeUndefined();
 await page.screenshot({path:'visual-evidence/premium/historical-price-pending.png',fullPage:true});
});

test('a recovered old-price order returned after review cannot open the UPI SDK',async({page})=>{
 await owner(page,{orderAmount:24900});
 await page.getByLabel('Mobile number for payment').fill('9999999999');await page.getByRole('button',{name:'Pay ₹1 with UPI'}).click();
 await expect(page.getByRole('button',{name:'Check payment status'})).toBeVisible();
 expect(await page.evaluate(()=>window.__lastPlanOptions)).toBeUndefined();
});
test('exactly two entry paths; resident joins immediately without legacy financial access',async({page})=>{
 await platform(page);await go(page,'welcome');
 await expect(page.locator('[data-action=entry]')).toHaveCount(2);
 await page.locator('[data-action=entry][data-role=RESIDENT]').click();
 await expect(page.getByRole('heading',{name:'Create resident account'})).toBeVisible();await signup(page);
 await expect(page).toHaveURL(/#joinWorkspace$/);await expect(page.locator('[data-role]')).toHaveCount(0);
 const financial=[];page.on('request',r=>{if(r.url().includes('/api/student/'))financial.push(r.url());});
 await page.getByLabel('PG code',{exact:true}).fill('ABCD-EFGH-JKLM');await page.getByRole('button',{name:'Join PG',exact:true}).click();
 await expect(page).toHaveURL(/#studentHome$/);await expect(page.getByRole('heading',{name:'Your room is on its way'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Pay rent',exact:true})).toBeDisabled();
 await expect(page.getByText('Rent due',{exact:true})).toBeVisible();await expect(page.locator('.empty-amount')).toHaveText('—');
 await go(page,'history');await expect(page.getByRole('heading',{name:'No payment records yet'})).toBeVisible();expect(financial).toEqual([]);
 await go(page,'profile');await noOverflow(page);await expect(page.getByRole('button',{name:/bank|rent collection|PGOne plan/i})).toHaveCount(0);
 await fs.mkdir('visual-evidence/premium',{recursive:true});await go(page,'studentHome');await page.screenshot({path:'visual-evidence/premium/unassigned-resident.png',fullPage:true});
});
test('UPI return paints dedicated verification before the first network request; uncertainty never creates a second order',async({page})=>{
 await owner(page);await pay(page);let release;const hold=new Promise(r=>release=r);let calls=0;
 await page.route('**/subscription/recheck',async route=>{calls++;await hold;await route.fulfill({json:{entitled:false}});});
 await page.evaluate(()=>window.PGOnePlanPaymentResult('order_SYNTHETIC001','RETURNED_CHECK_PROVIDER'));
 await expect(page.locator('.verification-page')).toBeVisible();await expect.poll(()=>calls).toBe(1);
 await expect(page.getByRole('heading',{name:'Verifying your payment'})).toBeVisible();
 await fs.mkdir('visual-evidence/premium',{recursive:true});await page.screenshot({path:'visual-evidence/premium/verifying-payment.png',fullPage:true});
 release();await expect(page.getByRole('heading',{name:'Payment not confirmed yet'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Payment successful',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Check again'}).click();await expect.poll(()=>calls).toBe(2);
 expect(await page.evaluate(()=>window.__lastPlanOptions.order_id)).toBe('order_SYNTHETIC001');
});
test('existing paid access cannot make an unpaid renewal look successful; exact capture leads to receipt and stable PG code',async({page})=>{
 const f=await owner(page);await pay(page);f.activatePaid();f.setOrderCaptured(false);
 await page.evaluate(()=>window.PGOnePlanPaymentResult('order_SYNTHETIC001','RETURNED_CHECK_PROVIDER'));
 await expect(page.getByRole('heading',{name:'Payment not confirmed yet'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Payment successful',exact:true})).toHaveCount(0);
 f.setOrderCaptured(true);await page.getByRole('button',{name:'Check again'}).click();await expect(page).toHaveURL(/#planSuccess$/);
 await expect(page.getByText('SYNTHETIC-249',{exact:true})).toBeVisible();await noOverflow(page);
 await fs.mkdir('visual-evidence/premium',{recursive:true});await page.screenshot({path:'visual-evidence/premium/payment-success.png',fullPage:true});
 await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page).toHaveURL(/#pgCode$/);
 await expect(page.locator('.join-code')).toHaveText('ABCD-EFGH-JKLM');await page.screenshot({path:'visual-evidence/premium/pg-code.png',fullPage:true});
});
test('cold restart restores the pending order and verifies before showing activation',async({page})=>{
 await owner(page);await pay(page);
 await page.evaluate(()=>{sessionStorage.setItem('synthetic-plan',JSON.stringify({...window.__planState,status:'INTERRUPTED_CHECK_PROVIDER'}));});
 await page.reload();await expect(page).toHaveURL(/#planVerification$/);
 await expect(page.getByRole('heading',{name:'Payment not confirmed yet'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Pay ₹1 with UPI'})).toHaveCount(0);
});
test('button loading keeps geometry and uses three circular reduced-motion dots',async({page})=>{
 await platform(page);let release;const hold=new Promise(r=>release=r);
 await page.route('**/auth/login',async route=>{await hold;await route.fulfill({status:400,json:{error:{message:'Synthetic failure'}}});});
 await page.getByLabel('Email address').fill('owner@example.test');await page.getByLabel('Password',{exact:true}).fill('Synthetic password 123!');
 const button=page.getByRole('button',{name:'Sign in',exact:true}),before=await button.boundingBox();await button.click();
 const loading=page.locator('[aria-busy=true]');await expect(loading).toBeVisible();const after=await loading.boundingBox();expect(after.width).toBe(before.width);expect(after.height).toBe(before.height);
 const dots=await loading.locator('.loading-dots i').evaluateAll(nodes=>nodes.map(n=>{const s=getComputedStyle(n);return {width:s.width,height:s.height,round:s.borderRadius,animation:s.animationName};}));
 expect(dots).toHaveLength(3);for(const d of dots){expect(d.width).toBe(d.height);expect(d.round).toBe('50%');expect(d.animation).toBe('none');}
 release();await expect(page.locator('[aria-busy=true]')).toHaveCount(0);await expect(button).toBeEnabled();
});
test('owner UPI password rejection preserves the form and saved details survive restart',async({page})=>{
 const f=await owner(page);f.activatePaid();await go(page,'workspaces');await page.locator('[data-action=workspace]').click();await expect(page).toHaveURL(/#ownerHome$/);
 let payee=null,reads=0;
 await page.route('**/api/platform/rent/owner',async route=>{
  if(route.request().method()==='GET'){reads++;return route.fulfill({json:{payee,claims:[]}});}
  const body=route.request().postDataJSON();
  if(body.password!=='Correct synthetic password')return route.fulfill({status:403,json:{error:{code:'PASSWORD_CONFIRMATION_FAILED',message:'Your password did not match.',details:{fieldErrors:{password:['Enter your current PGOne password.']}}}}});
  payee={...body,enabled:true,revision:1};return route.fulfill({json:{ok:true,state:'DETAILS_SAVED',providerVerified:false,payee}});
 });
 await go(page,'ownerDirectRent');await page.getByLabel('Your UPI address').fill('fixture-owner@invalid');await page.getByLabel('Payee name').fill('Synthetic Owner');await page.getByLabel('Confirm your PGOne password').fill('wrong');await page.locator('[name=accepted]').check();
 await page.getByRole('button',{name:'Save payment details'}).click();await expect(page.locator('.form-error')).toContainText('did not match');await expect(page.getByLabel('Your UPI address')).toHaveValue('fixture-owner@invalid');await expect(page).toHaveURL(/#ownerDirectRent$/);
 await page.getByLabel('Confirm your PGOne password').fill('Correct synthetic password');await page.getByRole('button',{name:'Save payment details'}).click();await expect(page.getByText('Details saved',{exact:true})).toBeVisible();expect(reads).toBeGreaterThanOrEqual(3);
 await page.reload();await expect(page).toHaveURL(/#ownerHome$/);await go(page,'ownerDirectRent');await expect(page.getByLabel('Your UPI address')).toHaveValue('fixture-owner@invalid');await expect(page.getByText('Bank confirmation required for each payment.')).toBeVisible();
 await fs.mkdir('visual-evidence/premium',{recursive:true});await page.screenshot({path:'visual-evidence/premium/owner-upi-saved.png',fullPage:true});
});
