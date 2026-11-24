import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import {setup,login,go,noOverflow} from './helpers.js';

for(const [width,height] of [[393,852],[360,640],[412,915]])test(`PGOne branded guide and both roles fit ${width}x${height}`,async({page})=>{
 await page.setViewportSize({width,height});await setup(page);await go(page,'welcome');
 const guide=page.locator('.entry-guide');await expect.poll(()=>guide.evaluate(i=>i.complete&&i.naturalWidth>=1000)).toBe(true);
 await expect(page.getByRole('button',{name:"I'm an Owner Manage your property"})).toBeInViewport();
 await expect(page.getByRole('button',{name:"I'm a Resident Join your PG and pay rent"})).toBeInViewport();
 await noOverflow(page);expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1)).toBe(true);
 await fs.mkdir('visual-evidence/final-ux',{recursive:true});await page.screenshot({path:`visual-evidence/final-ux/welcome-${width}.png`,fullPage:true});
});

test('submitted rent replaces an empty received amount without claiming collection, then confirmation turns green',async({page})=>{
 const f=await setup(page);let confirmed=false;
 await page.route('**/api/owner/dashboard?**',async route=>{
  const result=f.handler({url:route.request().url(),method:'GET',headers:route.request().headers(),body:{}});
  Object.assign(result.data.metrics,{totalExpectedPaise:850099,totalCollectedPaise:confirmed?850099:0,pendingTotalPaise:confirmed?0:850099,collectionRate:confirmed?100:0});
  result.data.recentPayments=[];await route.fulfill({json:result.data});
 });
 await page.route('**/api/platform/direct-payments/owner/overview?**',route=>route.fulfill({json:{summary:{proofCount:confirmed?0:1,rentSubmittedPaise:confirmed?0:850099,electricityBilledPaise:65025,electricityCollectedPaise:confirmed?65025:0,electricitySubmittedPaise:confirmed?0:65025,electricityBillCount:1},proofs:[],bills:[],rentProofInvoiceIds:[]}}));
 await login(page);
 const region=page.getByRole('region',{name:'Monthly collection',exact:true});
 await expect(region).toHaveAttribute('data-collection-state','submitted');
 await expect(region.locator('.financial-amount')).toHaveText('₹8,500.99');
 await expect(region.locator('.collection-confirmed strong')).toHaveText('—');
 await expect(region.getByRole('progressbar')).toHaveAttribute('aria-valuenow','0');
 await expect(page.locator('.collection-proof-inbox')).toHaveCount(1);
 await page.screenshot({path:'visual-evidence/final-ux/owner-submitted.png',fullPage:true});
 confirmed=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(region).toHaveAttribute('data-collection-state','confirmed');
 await expect(region.locator('.financial-amount')).toHaveText('₹8,500.99');
 await expect(region.locator('.collection-submitted strong')).toHaveText('—');
 await expect(region.getByRole('progressbar')).toHaveAttribute('aria-valuenow','100');
 await page.screenshot({path:'visual-evidence/final-ux/owner-confirmed.png',fullPage:true});
});
