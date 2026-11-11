import {brand,icon} from "../components/icons.js";
import {button,esc,heading,card,notice,badge} from "../components/ui.js";
import {field,formValues} from "../components/forms.js";

export const unassignedResident=s=>s.tokens?.kind==="PLATFORM"&&s.user?.role==="STUDENT"&&!s.student;
export function unassignedHomeScreen(ctx){
  return {title:"My PG",nav:"studentHome",contentClass:"resident-dashboard",content:
    heading("","My PG")+
    card(`<span class="row-icon">${icon("building")}</span><h2>${esc(ctx.snapshot.property?.name)}</h2>${badge("Joined","green")}`,"property-card")+
    `<section class="assignment-empty"><img src="illustration-room.webp" alt=""><h2>Your room is on its way</h2><p>Your owner will assign your room and rent details.</p><div class="unassigned-rent"><span>Rent due</span><strong class="empty-amount">—</strong></div></section>`+
    button("Pay rent",{kind:"primary block",attrs:'disabled aria-describedby="assignment-note"'})+`<p id="assignment-note" class="payment-safety">No rent invoice has been assigned.</p>`+
    button("Payment history",{route:"history",kind:"secondary block"})+button("Refresh my details",{action:"refreshAssignment",kind:"text-button block"}),
    async action(name){if(name!=="refreshAssignment")return;await ctx.refreshPlatform();return ctx.reload();}};
}
export function unassignedRecordsScreen(ctx){const rent=ctx.snapshot.route.name==="invoices";return {title:rent?"Your rent":"Payment history",back:true,nav:rent?"invoices":"history",content:`<div class="assignment-empty"><img src="illustration-${rent?"room":"records"}.webp" alt=""><h1>${rent?"Your rent is not assigned yet":"No payment records yet"}</h1><p>${rent?"Your owner will add your room and rent details. Your invoices will appear here.":"Your receipts will appear after rent is assigned and payment is confirmed."}</p></div>`};}
export function unassignedProfileScreen(ctx){return {title:"My account",nav:"profile",content:heading("","My account")+card(`<h2>${esc(ctx.snapshot.platform.account.fullName||"Resident")}</h2><p>${esc(ctx.snapshot.platform.account.email)}</p><p>${esc(ctx.snapshot.property?.name)}</p>`)+button("Change password",{route:"password",kind:"secondary block"})+button("Your workspaces",{route:"workspaces",kind:"secondary block"})+button("Sign out",{action:"logout",kind:"text-button block"})};}
export async function pgCodeScreen(ctx){
 const property=ctx.snapshot.property,id=encodeURIComponent(property.id),path=`/api/platform/properties/${id}/join-code`;
 let data=await ctx.api(path);
 if(!data.code)data=await ctx.api(path,{method:"POST",body:{action:"ENSURE"}});
 const text=`Join ${property.name} on PGOne. PG code: ${data.code}`;
 return {title:"Your PG code",back:true,nav:false,content:heading("",property.name,"Share this code with your residents.")+
   `<img class="code-art" src="illustration-residence.webp" alt=""><div class="join-code-card">${badge(data.enabled?"Joining open":"Joining paused",data.enabled?"green":"warning")}<p class="join-code">${esc(data.code)}</p>${button("Copy code",{action:"copyCode",kind:"secondary"})}</div>`+
   (data.enabled?button("Share PG code",{action:"shareCode",kind:"primary block"}):notice("New residents cannot join until you generate a new code."))+
   button("Enter dashboard",{route:"ownerHome",kind:"secondary block"})+button("Resident requests",{route:"residentRequests",kind:"text-button block"})+
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
export function joinedResidentsScreen(ctx){return ctx.navigate("residentRequests",{},{replace:true,force:true});}
