import test from "node:test";
import assert from "node:assert/strict";
import {planCheckout} from "../src/payments/plan.js";
import {onboarding,platformConfig} from "../src/platform/client.js";
import {directRentScreen} from "../src/screens/direct-rent.js";

test("native failure is retained across screens and never grants paid access",()=>{
  planCheckout.clear();planCheckout.begin("org-a","order_A");
  assert.equal(planCheckout.receive("order_B","RETURNED_CHECK_PROVIDER"),false);
  assert.equal(planCheckout.receive("order_A","NO_SUPPORTED_APP","Provider could not find a supported app."),true);
  assert.equal(planCheckout.busy,false);assert.match(planCheckout.message,/supported app/);
  const native={call:()=>JSON.stringify({organisationId:"org-a",orderId:"order_A",status:"NO_SUPPORTED_APP",message:"Retry discovery"})};
  planCheckout.clear();planCheckout.restore(native,"org-b");assert.equal(planCheckout.orderId,null);
  planCheckout.restore(native,"org-a");assert.equal(planCheckout.message,"Retry discovery");assert.equal(planCheckout.busy,false);
});
test("payment activation retry fetches fresh capabilities instead of retaining a disabled response",async()=>{
  onboarding.config=null;onboarding.configFetchedAt=0;let reads=0;
  const ctx={native:{call:()=>"com.safehouse.pg.testing"},api:async()=>({androidBilling:++reads===1?"NOT_CONFIGURED":"CUSTOM_UPI_INTENT"})};
  assert.equal((await platformConfig(ctx)).androidBilling,"NOT_CONFIGURED");
  assert.equal((await platformConfig(ctx,{force:true})).androidBilling,"CUSTOM_UPI_INTENT");
  assert.equal(reads,2);
});
test("direct rent is UPI-first, does not create claims on render, and permits retry after failed launch",async()=>{
  const calls=[];globalThis.document={querySelector:()=>({textContent:"",setAttribute(){}})};
  const data={claim:{id:"claim",status:"PENDING_OWNER_CONFIRMATION",amountPaise:10000,payeeName:"Owner",payeeAddress:"owner@example",reference:"PGO1234567890123456"},
    remainingPaise:10000,payable:true,ownerConfigured:true,intent:"upi://pay?pa=owner@example&am=100.00&cu=INR&tr=PGO1234567890123456"};
  const screen=await directRentScreen({params:{invoiceId:"invoice"},api:async(path,opts)=>{calls.push(opts?.method||"GET");return data;},
    native:{has:()=>true,call:(name)=>name==="directRentQrImageUrl"?"https://example.invalid/qr.png":calls.push(name)}});
  assert.deepEqual(calls,["GET"]);assert.match(screen.content,/Pay with UPI app/);
  assert.match(screen.content,/<section data-direct-qr hidden>/);
  await screen.action("directUpi");screen.directUpiResult(false,"App failed to open");await screen.action("directUpi");
  assert.equal(calls.filter(x=>x==="openDirectOwnerUpi").length,2);
  assert.equal(calls.filter(x=>x==="POST").length,2,"each launch revalidates the exact amount and payee");
});
test("changed or paid direct-rent requests render status without another financial initiation",async()=>{
  const screen=await directRentScreen({params:{id:"invoice"},api:async()=>({remainingPaise:7000,claim:{id:"claim",payeeName:"Owner",payeeAddress:"owner@example",reference:"ref"},
    issue:"The invoice balance changed. Do not pay this old amount.",ownerConfigured:true,payable:false,intent:null}),native:{call:()=>undefined}});
  assert.doesNotMatch(screen.content,/data-action="directUpi"/);
  assert.match(screen.content,/Do not pay this old amount/);
});
