import {test,expect} from "@playwright/test";
import fs from "node:fs/promises";
import {platform} from "./platform-helper.js";
import {setup,login,go,noOverflow} from "./helpers.js";

async function fits(page,action,name){
  await page.evaluate(()=>scrollTo(0,0));
  await noOverflow(page);
  await expect(action).toBeInViewport({ratio:1});
  const size=await page.evaluate(()=>({viewport:innerHeight,height:document.documentElement.scrollHeight}));
  expect(size.height,`${name}: avoid forced scrolling`).toBeLessThanOrEqual(size.viewport+1);
  await page.screenshot({path:`visual-evidence/compact/${name}.png`,fullPage:true});
}
for(const [width,height] of [[360,640],[393,786],[412,840]]){
  test(`primary onboarding actions fit at ${width}x${height}`,async({page})=>{
    await fs.mkdir('visual-evidence/compact',{recursive:true});
    await page.setViewportSize({width,height});
    await platform(page,{billing:true});
    await fits(page,page.getByRole('button',{name:'Sign in',exact:true}),`login-${width}`);
    await page.getByRole('button',{name:'New to PGOne? Create account'}).click();
    await fits(page,page.getByRole('button',{name:'Create account',exact:true}),`signup-${width}`);
    await page.getByLabel('Email address').fill('compact@example.test');
    await page.getByLabel('Password',{exact:true}).fill('A long private password!');
    await page.getByLabel('Confirm password',{exact:true}).fill('A long private password!');
    await page.getByRole('button',{name:'Create account',exact:true}).click();
    await expect(page).toHaveURL(/#setupProfile$/);
    await fits(page,page.getByRole('button',{name:'Continue',exact:true}),`profile-${width}`);
    await page.getByLabel('Full name').fill('Rahul Sharma');
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await expect(page.getByLabel('PG name')).toBeVisible();
    await fits(page,page.getByRole('button',{name:'Create my PG'}),`property-${width}`);
    await page.getByLabel('PG name').fill('Maple House');
    await page.getByLabel('City',{exact:true}).fill('Bengaluru');
    await page.getByRole('button',{name:'Create my PG'}).click();
    await expect(page).toHaveURL(/#subscription$/);
    await fits(page,page.getByRole('button',{name:'Pay ₹1 with UPI'}),`plan-${width}`);
    const details=page.locator('details').filter({has:page.locator('summary', {hasText:'Plan and receipts'})});
    await expect(details).not.toHaveAttribute('open','');
    await details.locator('summary').click();
    await expect(details).toContainText('₹1 total');
    await expect(details).toContainText('Renew manually');
    await noOverflow(page);
  });
}
test('welcome fits a short phone; larger text remains scrollable and reachable',async({page})=>{
  await page.setViewportSize({width:360,height:640});
  await page.route('**/api/platform/config**',route=>route.fulfill({json:{enabled:true,authentication:'EMAIL_PASSWORD'}}));
  await page.goto('/');
  await fits(page,page.getByRole('button',{name:"I'm a Resident",exact:false}),'welcome-360');
  await page.locator('[data-action=entry][data-role=OWNER]').click();
  await page.addStyleTag({content:'html { font-size: 24px; } .royal-page * { font-size: max(1em, 18px); }'});
  const submit=page.getByRole('button',{name:'Create account',exact:true});
  await submit.scrollIntoViewIfNeeded();
  await expect(submit).toBeInViewport({ratio:1});
  await expect(page.getByLabel('Confirm password',{exact:true})).toBeVisible();
});
test('dashboard keeps a short preview and links to full lists',async({page})=>{
  await page.setViewportSize({width:360,height:640});
  await setup(page);await login(page);
  await noOverflow(page);
  await page.screenshot({path:'visual-evidence/compact/owner-home-360.png',fullPage:true});
  expect(await page.locator('.list').first().locator('.list-row').count()).toBeLessThanOrEqual(3);
  await expect(page.getByRole('button',{name:'View dues',exact:true})).toBeInViewport({ratio:1});
  const action=await page.getByRole('button',{name:'View dues',exact:true}).boundingBox();
  const nav=await page.locator('.bottom-nav').boundingBox();
  expect(action.y+action.height,'quick actions clear the fixed navigation').toBeLessThanOrEqual(nav.y);
});

test('rooms and rent dues use compact cards with reachable actions',async({page})=>{
  await page.setViewportSize({width:360,height:640});await setup(page);await login(page);
  await go(page,'rooms');await noOverflow(page);
  expect((await page.locator('.room-card').first().boundingBox()).height).toBeLessThanOrEqual(165);
  await page.screenshot({path:'visual-evidence/compact/rooms-360.png',fullPage:true});
  await go(page,'dues');await noOverflow(page);
  expect((await page.locator('.dues-card').first().boundingBox()).height).toBeLessThanOrEqual(250);
  await expect(page.getByRole('button',{name:'View invoice',exact:true}).first()).toBeVisible();
  await page.screenshot({path:'visual-evidence/compact/dues-360.png',fullPage:true});
});
