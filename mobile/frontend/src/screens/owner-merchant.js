import {heading,card,button,badge,esc} from "../components/ui.js";
import {organisation} from "../platform/client.js";
import {field,formValues} from "../components/forms.js";
const labels={NOT_CONNECTED:"Not connected",DRAFT:"Not submitted",ONBOARDING_STARTED:"Setup started",DETAILS_SUBMITTED:"Details submitted",KYC_PENDING:"Verification pending",ACTION_REQUIRED:"Action required",UNDER_REVIEW:"Under review",VERIFIED:"Merchant verified",ACTIVATED:"Ready to collect",REJECTED:"Not approved",SUSPENDED:"Collection paused",DISABLED:"Disconnected"};
export async function ownerMerchantScreen(ctx){
 const org=organisation(ctx.snapshot);if(!org)throw new Error("Select an owner workspace first.");
 const data=await ctx.api(`/api/platform/organisations/${org.id}/merchant`),ready=data.collectionEnabled===true;
 const status=labels[data.status]||"Activation pending";
 return {title:"Rent collection",back:true,nav:false,content:
  heading("","Connect your payment account","Receive resident rent in your own bank.")+
  card(`${badge(ready?"Ready to collect":status,ready?"green":"amber")}${ready?"<h2>Your payment account is ready.</h2><p>Residents can now pay rent directly through PGOne.</p>":""}<dl class="merchant-facts"><div><dt>Merchant connection</dt><dd>${data.connected?"Connected":"Not connected"}</dd></div><div><dt>Payment acceptance</dt><dd>${data.paymentAcceptance==="ENABLED"?"Enabled":"Pending"}</dd></div><div><dt>Bank settlement</dt><dd>${data.settlementReadiness==="READY"?"Enabled by Razorpay":"Pending verification"}</dd></div>${data.bank?.last4?`<div><dt>Account ending</dt><dd>•••• ${esc(data.bank.last4)}</dd></div>`:""}</dl>`)+
  (!data.onboardingAvailable?`<div class="notice" role="status">Merchant onboarding is awaiting Razorpay platform activation. Automatic collection is not enabled.</div>${button("Connect payment account",{kind:"primary block",attrs:"disabled aria-disabled=true"})}`:!ready?`<form data-form="connectOwnerMerchant" novalidate><div class="form-error" role="alert"></div><label class="merchant-consent"><input type="checkbox" name="accepted" required>I am authorised to connect this PG owner's payment account.</label>${button(data.connected?"Continue verification":"Connect payment account",{type:"submit",kind:"primary block",glyph:"arrow"})}</form>`:"")+
  button("Refresh account status",{action:"refreshOwnerMerchant",kind:"secondary block"})+
  button("View rent collection",{route:"merchantCollections",kind:"secondary block"})+
  (data.connected?button("Manage bank with Razorpay",{action:"manageOwnerBank",kind:"text-button block"}):"")+
  `<details class="disclosure" ${!data.onboardingAvailable?"open":""}><summary>Other payment arrangements</summary><p>Direct UPI transfers require you to check your bank and confirm each receipt.</p>${button("Set up direct owner UPI",{route:"ownerDirectRent",kind:"secondary block"})}${button("Record rent received",{route:"dues",kind:"text-button block"})}</details>`+
  (data.connected?`<details class="disclosure"><summary>Disconnect payment account</summary><form data-form="disconnectOwnerMerchant" novalidate><div class="form-error" role="alert"></div>${field("password","Confirm your PGOne password",{type:"password",required:true,attrs:'autocomplete="current-password" maxlength="128"'})}${button("Disconnect",{type:"submit",kind:"secondary block"})}</form></details>`:"")+
  `<details class="disclosure"><summary>About verification and charges</summary><p>Razorpay handles KYC, bank verification and required consent. PGOne does not store your KYC documents.</p><p>Your ₹249 PGOne plan is separate from resident rent. Provider charges follow your merchant agreement.</p></details>`,
  mount(){ctx.native.call("acknowledgeMerchantReturn");},
  async action(name){if(name==="manageOwnerBank")return ctx.openExternal("https://dashboard.razorpay.com/");if(name==="refreshOwnerMerchant"){await ctx.api(`/api/platform/owner-payments/organisations/${org.id}/recheck`,{method:"POST"});return ctx.reload();}},
  async submit(name,form){
   if(name==="disconnectOwnerMerchant"){await ctx.api(`/api/platform/owner-payments/organisations/${org.id}/disconnect`,{method:"POST",body:{password:formValues(form).password}});ctx.markSaved();return ctx.reload();}
   if(name!=="connectOwnerMerchant")return;
   const result=await ctx.api(`/api/platform/owner-payments/organisations/${org.id}/connect`,{method:"POST",body:{accepted:formValues(form).accepted==="on"}});
   const url=new URL(result.url);if(url.protocol!=="https:"||url.hostname!=="auth.razorpay.com"||url.pathname!=="/authorize"||url.username||url.password)throw new Error("The secure merchant connection could not start.");
   ctx.markSaved();if(ctx.native.has("connectOwnerPaymentAccount"))ctx.native.call("connectOwnerPaymentAccount",url.toString());else ctx.openExternal(url.toString());
  },
 };
}
