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
test("direct rent refreshes server amounts before copying and never opens a payment intent",async()=>{
  const calls=[];
  const data={claim:{id:"claim",status:"PENDING_OWNER_CONFIRMATION",amountPaise:10000,payeeName:"Owner",payeeAddress:"owner@example",reference:"PGO1234567890123456"},
    remainingPaise:10000,payable:true,ownerConfigured:true};
  const screen=await directRentScreen({params:{invoiceId:"invoice"},api:async(_path,opts)=>{calls.push(opts?.method||"GET");return data;},
    native:{has:()=>true,call:(name,value)=>{calls.push([name,value]);return true;}},toast:()=>{}});
  assert.deepEqual(calls,["GET"]);
  assert.match(screen.content,/Pay via UPI/);
  await screen.action("copyAmount");
  assert.deepEqual(calls,["GET","GET",["copyPaymentDetail","100.00"]]);
});
test("changed or paid direct-rent requests render status without another financial initiation",async()=>{
  const screen=await directRentScreen({params:{id:"invoice"},api:async()=>({remainingPaise:7000,claim:{id:"claim",payeeName:"Owner",payeeAddress:"owner@example",reference:"ref"},
    issue:"The invoice balance changed. Do not pay this old amount.",ownerConfigured:true,payable:false,intent:null}),native:{call:()=>undefined}});
  assert.doesNotMatch(screen.content,/data-action="copyPayee"/);
  assert.match(screen.content,/Do not pay this old amount/);
});
