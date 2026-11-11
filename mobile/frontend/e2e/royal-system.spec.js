import {test,expect} from "@playwright/test";
import fs from "node:fs/promises";
import {setup,go,noOverflow} from "./helpers.js";

test("royal artwork loads locally across entry and authentication without losing form input",async({page})=>{
  await setup(page);await go(page,"welcome");
  const hero=page.locator(".entry-residence");
  await expect.poll(()=>hero.evaluate(image=>image.complete&&image.naturalWidth>=1200)).toBe(true);
  expect(await hero.getAttribute("src")).toBe("illustration-royal-residence.webp");
  await page.locator('[data-action=entry][data-role=OWNER]').click();
  await page.getByLabel("Email address").fill("visual@example.test");
  const art=page.locator(".auth-art img");
  await expect.poll(()=>art.evaluate(image=>image.complete&&image.naturalWidth>=1200)).toBe(true);
  const box=await art.boundingBox();await page.mouse.move(box.x+box.width*.75,box.y+box.height*.5);
  await expect(page.getByLabel("Email address")).toHaveValue("visual@example.test");
  await noOverflow(page);await fs.mkdir("visual-evidence/royal-system",{recursive:true});
  await page.screenshot({path:"visual-evidence/royal-system/owner-signup.png",fullPage:true,animations:"disabled"});
});

test("reduced motion disables decorative movement while all primary actions remain usable",async({page})=>{
  await page.emulateMedia({reducedMotion:"reduce"});await setup(page);await go(page,"welcome");
  await expect.poll(()=>page.locator(".entry-residence").evaluate(el=>getComputedStyle(el).animationName)).toBe("none");
  expect(await page.locator(".surface-enter,.surface-fade").evaluateAll(elements=>elements.every(el=>getComputedStyle(el).animationName==="none"))).toBe(true);
  await page.locator('[data-action=entry][data-role=RESIDENT]').click();
  await expect(page.getByRole("heading",{name:"Create resident account"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Create account",exact:true})).toBeEnabled();
  await noOverflow(page);
});
