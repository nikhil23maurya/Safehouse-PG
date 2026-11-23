import test from "node:test";
import assert from "node:assert/strict";
import {pendingDirect,saveDirect} from "../src/payments/direct-return.js";
const s=(a="account-one",m="member-one")=>({platform:{account:{id:a},membershipId:m}});
function bridge(){let value="";return {has:()=>true,call(name,v){if(name==="getDirectTransferState")return value;if(name==="saveDirectTransferState"){value=v;return true;}}};}
test("return state restores only the exact account/workspace and never asserts paid",()=>{
 const native=bridge();saveDirect(s(),native,{transferId:"transfer-one",invoiceId:"invoice-one",stage:"PROOF"});
 assert.equal(pendingDirect(s(),native).stage,"PROOF");assert.equal(pendingDirect(s("another-account"),native),null);assert.equal(pendingDirect(s("account-one","another-member"),native),null);
 saveDirect(s("another-account"),native,{transferId:"transfer-two",invoiceId:"invoice-two"});assert.equal(pendingDirect(s(),native).transferId,"transfer-one");
 saveDirect(s(),native,null);assert.equal(pendingDirect(s(),native),null);assert.equal(pendingDirect(s("another-account"),native).transferId,"transfer-two");
});
test("failed native persistence prevents outgoing payment and invalid recovery IDs are ignored",()=>{
 assert.throws(()=>saveDirect(s(),{has:()=>true,call:()=>false},{transferId:"t",invoiceId:"i"}),/recovery/);
 assert.equal(pendingDirect(s(),{call:()=>JSON.stringify([{accountId:"account-one",membershipId:"member-one",transferId:"https://evil.test",invoiceId:"x"}])}),null);
});
