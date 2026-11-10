import test,{after} from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
assert.equal(process.env.NODE_ENV,"test");
const url=new URL(process.env.DATABASE_URL!);assert.equal(url.hostname,"127.0.0.1");assert.equal(url.pathname,"/pgone_test");
const server=spawn(process.execPath,["dist/server.js"],{env:{...process.env,PORT:"10089",PGONE_PLATFORM_ENABLED:"true"},stdio:["ignore","ignore","pipe"]});
let diagnostics="";server.stderr.on("data",chunk=>{diagnostics+=chunk.toString().slice(0,2000);});
const base="http://127.0.0.1:10089";
after(()=>{server.kill();});
async function request(path:string,body?:object,token?:string){const response=await fetch(base+path,{method:body?"POST":"GET",headers:{"content-type":"application/json",...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json() as any};}
test("real backend email signup through owner activation, restoration and logout; phone auth remains retired",async()=>{
  let ready=false;
  for(let i=0;i<60;i++){try{ready=(await fetch(base+"/ready")).ok;if(ready)break;}catch{}await new Promise(resolve=>setTimeout(resolve,250));}
  assert.ok(ready,`Isolated server did not become ready: ${diagnostics}`);
  const email=`http-${crypto.randomUUID()}@example.test`,password="Private HTTP password 123!";
  assert.equal((await request("/api/platform/auth/register",{email,password,role:"OWNER"})).status,400);
  const registered=await request("/api/platform/auth/register",{email,password});assert.equal(registered.status,201);
  const accountToken=registered.body.tokens.accessToken;
  assert.equal((await request("/api/platform/session",undefined,accountToken)).body.user.role,"ACCOUNT");
  assert.equal((await request("/api/platform/auth/register",{email:email.toUpperCase(),password})).status,409);
  assert.equal((await request("/api/platform/phone",{idToken:"not-used"})).status,410);
  assert.equal((await request("/api/platform/auth/login",{email,password:"wrong"})).status,401);
  assert.equal((await request("/api/platform/profile",{fullName:"HTTP owner",intent:"OWNER"},accountToken)).status,200);
  const key=crypto.randomUUID();
  const input={name:"HTTP Synthetic PG",city:"Pune",key};
  const first=await request("/api/platform/properties",input,accountToken);
  const repeat=await request("/api/platform/properties",input,accountToken);
  assert.equal(first.status,200);assert.equal(repeat.body.property.id,first.body.property.id);
  const chosen=await request("/api/platform/workspace",{membershipId:first.body.memberships[0].id},accountToken);
  const token=chosen.body.tokens.accessToken;
  const session=await request("/api/platform/session",undefined,token);
  assert.equal(session.body.journey.state,"PAYMENT_REQUIRED");
  assert.equal((await request("/api/owner/dashboard",undefined,token)).status,402);
  const login=await request("/api/platform/auth/login",{email,password});assert.equal(login.status,200);
  assert.equal((await request("/api/platform/session",undefined,login.body.tokens.accessToken)).body.property.id,first.body.property.id);
  await request("/api/platform/logout",{},login.body.tokens.accessToken);
  assert.equal((await request("/api/platform/session",undefined,token)).status,401);
});
