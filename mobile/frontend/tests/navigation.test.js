import test from "node:test";
import assert from "node:assert/strict";
import {backTarget} from "../src/core/navigation.js";
test("logical back parents preserve account and payment context without a role-selection loop",()=>{
 const owner=name=>({tokens:{kind:"PLATFORM"},user:{role:"OWNER"},route:{name}});
 for(const [from,to]of Object.entries({residentRequest:"residentRequests",residentRentSetup:"residentRequests",residentEdit:"residents",subscription:"workspaces",planVerification:"subscription",properties:"ownerHome"}))assert.equal(backTarget(owner(from)),to);
 assert.equal(backTarget(owner("ownerHome")),null);
 assert.equal(backTarget({route:{name:"login"}}),"welcome");assert.equal(backTarget({route:{name:"welcome"}}),null);
 assert.equal(backTarget({tokens:{},user:{role:"STUDENT"},route:{name:"rentVerification"}}),"invoices");
});
