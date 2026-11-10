import {brand,icon} from "../components/icons.js";
import {button,esc,heading,card,notice,badge} from "../components/ui.js";
import {field,formValues} from "../components/forms.js";

export const unassignedResident=s=>s.tokens?.kind==="PLATFORM"&&s.user?.role==="STUDENT"&&!s.student;
export function unassignedHomeScreen(ctx){
  return {title:"My PG",nav:"studentHome",contentClass:"resident-dashboard",content:
    `<section class="dashboard-hero"><span>RESIDENT</span><h1>Welcome to ${esc(ctx.snapshot.property?.name||"your PG")}</h1></section>`+
    card(`<span class="row-icon">${icon("building")}</span><h2>${esc(ctx.snapshot.property?.name)}</h2>${badge("Joined","green")}`,"property-card")+
    `<section class="assignment-empty"><img src="illustration-room.webp" alt=""><h2>Your room is on its way</h2><p>Your owner will assign your room and rent details.</p></section>`+
    card(`<p class="subtitle">Rent due</p><strong class="empty-amount">—</strong><p>Available after your owner assigns your rent record.</p>`)+
    button("Pay rent",{kind:"primary block",attrs:'disabled aria-describedby="assignment-note"'})+`<p id="assignment-note" class="payment-safety">No rent invoice has been assigned.</p>`+
    button("Payment history",{route:"history",kind:"secondary block"})+button("Refresh my details",{action:"refreshAssignment",kind:"text-button block"}),
    async action(name){if(name!=="refreshAssignment")return;await ctx.refreshPlatform();return ctx.reload();}};
}
export function unassignedRecordsScreen(){return {title:"Payment history",back:true,nav:"history",content:`<div class="assignment-empty"><img src="illustration-records.webp" alt=""><h1>No payment records yet</h1><p>Your receipts will appear after rent is assigned and payment is confirmed.</p></div>`};}
export function unassignedProfileScreen(ctx){return {title:"My account",nav:"profile",content:heading("","My account")+card(`<h2>${esc(ctx.snapshot.platform.account.fullName||"Resident")}</h2><p>${esc(ctx.snapshot.platform.account.email)}</p><p>${esc(ctx.snapshot.property?.name)}</p>`)+button("Change password",{route:"password",kind:"secondary block"})+button("Your workspaces",{route:"workspaces",kind:"secondary block"})+button("Sign out",{action:"logout",kind:"text-button block"})};}
export async function pgCodeScreen(ctx){
 const property=ctx.snapshot.property,id=encodeURIComponent(property.id),path=`/api/platform/properties/${id}/join-code`;
 let data=await ctx.api(path);
 if(!data.code)data=await ctx.api(path,{method:"POST",body:{action:"ENSURE"}});
 const text=`Join ${property.name} on PGOne. PG code: ${data.code}`;
 return {title:"Your PG code",back:true,nav:false,content:heading("",property.name,"Share this code with your residents.")+
   `<img class="code-art" src="illustration-residence.webp" alt=""><div class="join-code-card">${badge(data.enabled?"Joining open":"Joining paused",data.enabled?"green":"warning")}<p class="join-code">${esc(data.code)}</p>${button("Copy code",{action:"copyCode",kind:"secondary"})}</div>`+
   (data.enabled?button("Share PG code",{action:"shareCode",kind:"primary block"}):notice("New residents cannot join until you generate a new code."))+
   button("Enter dashboard",{route:"ownerHome",kind:"secondary block"})+button("Joined residents",{route:"joinedResidents",kind:"text-button block"})+
   `<details class="disclosure"><summary>Manage joining</summary><p>Changing or pausing this code does not remove existing residents.</p>${button("Generate new code",{action:"rotateCode",kind:"secondary block"})}${data.enabled?button("Pause joining",{action:"disableCode",kind:"text-button block"}):""}</details>`,
   async action(name){
     if(name==="copyCode"){if(ctx.native.has("copyPgCode"))ctx.native.call("copyPgCode",data.code);else await navigator.clipboard.writeText(data.code);ctx.toast("PG code copied.");return;}
     if(name==="shareCode"){if(ctx.native.has("sharePgCode"))ctx.native.call("sharePgCode",property.name,data.code);else if(navigator.share)await navigator.share({title:"Join my PG",text});else {await navigator.clipboard.writeText(text);ctx.toast("Joining details copied.");}return;}
     if(!["rotateCode","disableCode"].includes(name))return;
     const rotate=name==="rotateCode";
     if(!await ctx.confirm({title:rotate?"Generate a new PG code?":"Pause joining?",message:rotate?"The current code will stop working. Existing residents keep their access.":"New joins will stop. Existing residents keep their access.",confirmLabel:rotate?"Generate new code":"Pause joining"}))return;
     await ctx.api(path,{method:"POST",body:{action:rotate?"ROTATE":"DISABLE"}});ctx.markSaved();return ctx.reload();
   }};
}
export async function joinedResidentsScreen(ctx){
 const path=`/api/platform/properties/${encodeURIComponent(ctx.snapshot.property.id)}`,data=await ctx.api(`${path}/joined-residents`);
 return {title:"Joined residents",back:true,nav:false,content:heading("","Joined residents","Assign a rent record only after checking identity.")+
   (data.members.length?data.members.map(m=>card(`<h2>${esc(m.name||m.email||"Resident")}</h2>${m.name?`<p>${esc(m.email)}</p>`:""}${badge(m.assigned?"Record assigned":"Room not assigned",m.assigned?"green":"neutral")}${m.assigned?"":`<details class="disclosure"><summary>Assign existing resident record</summary><form data-form="assignResident" data-id="${esc(m.id)}" novalidate><div class="form-error" role="alert"></div><label class="field"><span>Resident record</span><select name="studentId" required><option value="">Choose after verifying identity</option>${data.records.filter(r=>!r.linked).map(r=>`<option value="${esc(r.id)}">${esc(r.name)}${r.room?` · Room ${esc(r.room)}`:""}</option>`).join("")}</select></label>${field("password","Confirm your password",{type:"password",required:true,attrs:'autocomplete="current-password" maxlength="128"'})}<label class="merchant-consent"><input type="checkbox" name="identityChecked" required>I independently checked this resident's identity and this is their own rent record.</label>${button("Assign record",{type:"submit",kind:"primary block"})}</form></details>`}`)).join(""):notice("Residents who join with your PG code will appear here."))+
   button("Add resident record",{route:"residentForm",kind:"secondary block"})+button("Share PG code",{route:"pgCode",kind:"text-button block"}),
   async submit(name,form){if(name!=="assignResident")return;const v=formValues(form);await ctx.api(`${path}/resident-record`,{method:"POST",body:{membershipId:form.dataset.id,studentId:v.studentId,password:v.password,identityChecked:v.identityChecked==="on"}});ctx.markSaved();ctx.toast("Resident record assigned.");return ctx.reload();}};
}
