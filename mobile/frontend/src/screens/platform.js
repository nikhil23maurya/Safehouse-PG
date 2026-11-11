import {ownerMerchantScreen} from "./owner-merchant.js";
import {money} from "../domain/finance.js";
import {planCheckout,paymentContact} from "../payments/plan.js";
import { brand, icon } from "../components/icons.js";
import {
  esc,
  button,
  notice,
  date,
  badge,
  card,
  heading,
  routeAttrs,
} from "../components/ui.js";
import { field, formValues } from "../components/forms.js";
import {
  onboarding,
  organisation,
  platformConfig,
  requestId,
} from "../platform/client.js";

const image = (name, extra = "") =>
  `<img class="onboarding-art ${extra}" src="onboarding-${name}.webp" alt="" draggable="false">`;
const arrow = icon("arrow");
const primary = (label, props = {}) =>
  button(label, { kind: "primary block royal-button", ...props });
const top = (back = "welcome") =>
  `<header class="onboarding-top"><button class="royal-back" data-action="back" aria-label="Go back">${icon("back")}</button>${brand()}</header>`;
const step = (number, label) =>
  `<div class="setup-step"><span>Step ${number} of 2</span><span class="setup-track"><i style="width:${number * 50}%"></i></span><small>${esc(label)}</small></div>`;
const form = (name, content, label = "Continue") =>
  `<form data-form="${name}" novalidate><div class="form-error" role="alert"></div>${content}${primary(label, { type: "submit", glyph: "arrow" })}</form>`;
function page(title, content, back = "workspaces", art = "") {
  return {
    bare: true,
    title,
    content: `<main class="onboarding-page royal-page">${top(back)}<div class="onboarding-body">${content}</div>${art}</main>`,
  };
}
const intro = (kicker, title, text) =>
  `<div class="royal-intro">${kicker?`<span class="royal-kicker">${esc(kicker)}</span>`:""}<h1>${esc(title)}</h1>${text?`<p>${esc(text)}</p>`:""}</div>`;

export function welcomeScreen(ctx) {
  return {bare:true,title:"Welcome",content:`<main class="entry-page"><header>${brand()}</header><div class="entry-heading"><h1>A better way<br>to run your PG.</h1><p>Manage · Stay · Pay</p></div><img class="entry-residence" src="illustration-royal-residence.webp" alt=""><div class="entry-options"><button class="entry-option owner-entry" data-action="entry" data-role="OWNER"><span class="entry-icon">${icon("building")}</span><span><strong>I'm an Owner</strong><small>Manage your property</small></span>${arrow}</button><button class="entry-option resident-entry" data-action="entry" data-role="RESIDENT"><span class="entry-icon">${icon("users")}</span><span><strong>I'm a Resident</strong><small>Join your PG and pay rent</small></span>${arrow}</button></div></main>`,action(name,el){if(name!=="entry")return;onboarding.intent=el.dataset.role;return ctx.navigate("signup");}};
}
export function chooseRoleScreen(ctx) {
  return {...page("Continue as",`${intro("","Choose your path","")}<div class="role-options">${[["OWNER","building","I'm an Owner"],["RESIDENT","users","I'm a Resident"]].map(([role,glyph,label])=>`<button class="role-option" data-action="role" data-role="${role}"><span class="role-icon">${icon(glyph)}</span><strong>${label}</strong>${arrow}</button>`).join("")}</div>`,"workspaces"),async action(name,el){if(name!=="role")return;onboarding.intent=el.dataset.role;await ctx.api("/api/platform/onboarding-intent",{method:"POST",body:{intent:onboarding.intent}});await ctx.refreshPlatform();return ctx.navigate(onboarding.intent==="OWNER"?"setupProfile":"joinWorkspace");}};
}
export function setupProfileScreen(ctx) {
  const account = ctx.snapshot.platform.account;
  const owner = (account.setupIntent || onboarding.intent) === "OWNER";
  return {
    ...page(
      "Your profile",
      `${intro("", owner ? "Your owner profile" : "Your profile", account.email || "")}${step(1, "Your profile")}${form("setupProfile", `${field("fullName", "Full name", { required: true, value: account.fullName, attrs: 'minlength="2" maxlength="100" autocomplete="name"', placeholder: "Your full name" })}${field("contactPhone", "Contact phone (optional)", {value:account.contactPhone||"",attrs:'inputmode="tel" maxlength="25" autocomplete="tel"'})}`)}`,
      "chooseRole",
    ),
    async submit(_name, el) {
      const values = formValues(el);
      await ctx.api("/api/platform/profile", {
        method: "POST",
        body: {
          fullName: values.fullName,
          contactPhone: values.contactPhone,
          intent: owner ? "OWNER" : "RESIDENT",
        },
      });
      ctx.markSaved();
      await ctx.refreshPlatform();
      return ctx.navigate(owner ? "setupProperty" : "joinWorkspace");
    },
  };
}
export function setupPropertyScreen(ctx) {
  const adding=ctx.snapshot.platform.memberships.some(m=>m.role==="OWNER");
  const draft = ctx.snapshot.onboardingDraft;
  onboarding.propertyKey ||= draft?.key || requestId();
  let saveTimer;
  const saveDraft = (values) =>
    ctx.saveOnboardingDraft({ key: onboarding.propertyKey, values });
  return {
    ...page(
      adding?"Add property":"Your first PG",
      `${intro("", "Set up your PG", "")}${adding?"":step(2, "Your property")}${form("setupProperty", `${field("name", "PG name", { value: draft?.values?.name || "", required: true, placeholder: "e.g. Maple House", attrs: 'minlength="2" maxlength="120" autocomplete="organization"' })}${field("city", "City", { value: draft?.values?.city || "", required: true, placeholder: "e.g. Bengaluru", attrs: 'minlength="2" maxlength="100" autocomplete="address-level2"' })}${field("approximateRooms", "Approximate number of rooms", { value: draft?.values?.approximateRooms || "", type: "number", placeholder: "Optional", attrs: 'min="1" max="100000" inputmode="numeric"' })}`, "Create my PG")}`,
      adding?"properties":"setupProfile",
    ),
    input(_name, _el, form) {
      clearTimeout(saveTimer);
      const values = formValues(form);
      saveTimer = setTimeout(() => {
        try {
          saveDraft(values);
        } catch {
          ctx.toast("Your draft could not be saved on this device.", "error");
        }
      }, 250);
    },
    unmount() {
      clearTimeout(saveTimer);
    },
    async submit(_name, el) {
      const values = formValues(el);
      clearTimeout(saveTimer);
      saveDraft(values);
      const body = {
        name: values.name,
        city: values.city,
        key: onboarding.propertyKey,
        ...(values.approximateRooms
          ? { approximateRooms: Number(values.approximateRooms) }
          : {}),
      };
      const result = await ctx.api("/api/platform/properties", {
        method: "POST",
        body,
      });
      const member = result.memberships.find(
        (m) => m.property.id === result.property.id && m.role === "OWNER",
      );
      ctx.markSaved();
      ctx.saveOnboardingDraft(null);
      await ctx.selectWorkspace(member.id, adding?"properties":"subscription");
      onboarding.propertyKey = null;
    },
  };
}
export function setupReadyScreen(ctx) {
  const entitled = organisation(ctx.snapshot)?.entitled === true;
  return page(
    "Your PG is ready",
    `<div class="ready-art">${`<img class="onboarding-art" src="illustration-royal-residence.webp" alt="">`}<span class="ready-check">${icon("check")}</span></div>${intro("MADE FOR YOUR EVERYDAY", `${ctx.snapshot.property.name} is ready.`, entitled ? "Your subscription is verified. Set up payments whenever you are ready." : "Your PG is saved. Activate PGOne to start managing rooms and residents.")}${primary(entitled ? "Enter my workspace" : "Activate PGOne", { route: entitled ? "ownerHome" : "subscription", glyph: "arrow" })}${entitled ? button("Set up online rent collection", { route: "merchant", kind: "secondary block" }) : ""}<p class="legal-copy">Online rent collection requires a separately approved merchant account. Your monthly PGOne plan does not automatically enable rent payments.</p>`,
    "workspaces",
  );
}
export async function workspacesScreen(ctx) {
  const data = await ctx.api("/api/platform/session");
  const owns=data.memberships.some(m=>m.role==="OWNER");
  return {
    ...page(
      "Your workspaces",
      `${intro("WELCOME BACK", data.account.fullName ? `Hello, ${data.account.fullName.split(" ")[0]}.` : "Your PG, connected.", "Choose a workspace to continue.")}<div class="workspace-list">${data.memberships.map((m) => `<button class="workspace-option" data-action="workspace" data-id="${esc(m.id)}"><span class="role-icon">${icon(m.role === "OWNER" ? "building" : "home")}</span><span><strong>${esc(m.property.name)}</strong><small>${esc(m.role === "RESIDENT" ? "Resident" : m.role === "STAFF" ? "Staff" : "Property owner")}</small></span>${icon("arrow")}</button>`).join("") || notice("You haven’t joined a property yet. Create your PG or join with a PG code.")}</div>${owns?primary("Add another property",{route:"setupProperty",glyph:"plus"}):primary("Join with a PG code",{route:"joinWorkspace",glyph:"plus"})}${owns?"":button("My PG requests",{route:"joinStatus",kind:"secondary block"})}${owns?"":button("Staff invitation",{route:"staffInvitation",kind:"text-button block"})}${button("Change password",{route:"password",kind:"secondary block"})}${button("Sign out", { action: "logout", kind: "text-button" })}`,
      "chooseRole",
    ),
    action(name, el) {
      if (name === "workspace") return ctx.selectWorkspace(el.dataset.id);
    },
  };
}
export function joinWorkspaceScreen(ctx) {
 const account=ctx.snapshot.platform.account;
 return {...page("Request to join",`${intro("","Request to join a PG","Enter the code shared by your owner.")}${form("joinCode",field("code","PG code",{required:true,placeholder:"ABCD-EFGH-JKLM",attrs:'minlength="12" maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false"'})+field("fullName","Full name",{required:true,value:account.fullName||"",attrs:'minlength="2" maxlength="100" autocomplete="name"'})+field("mobile","Mobile number",{required:true,value:account.contactPhone||"",type:"tel",attrs:'inputmode="tel" autocomplete="tel" maxlength="20"'}),"Send join request")}${button("My PG requests",{route:"joinStatus",kind:"text-button block"})}`,"workspaces"),async submit(name,el){if(name!=="joinCode")return;const v=formValues(el),mobile=paymentContact(v.mobile);if(!mobile)throw new Error("Enter a valid Indian mobile number.");const result=await ctx.api("/api/platform/join",{method:"POST",body:{code:v.code.trim(),fullName:v.fullName.trim(),mobile}});ctx.markSaved();if(result.tokens)await ctx.acceptPlatform(result.tokens,"studentHome");else {await ctx.refreshPlatform();return ctx.navigate("joinStatus",{},{replace:true});}}};
}
export function staffInvitationScreen(ctx) {
  const confirmed=ctx.snapshot.platform.account.emailVerified;
  return {
    ...page(
      "Join your PG",
      `${intro("", "Join your PG", "Use the invitation code from your owner.")}${button("Refresh workspaces",{action:"refreshEmail",kind:"text-button block"})}${form("invitation", field("code", "Invitation code", { required: true, attrs: 'minlength="43" maxlength="43" autocomplete="off" autocapitalize="none" spellcheck="false"' }), "Review invitation")}<p class="payment-safety">Your owner confirms your identity before granting access.</p>`,
      "workspaces",
    ),
    async action(name){if(name==="refreshEmail"){await ctx.refreshPlatform();await ctx.navigate("workspaces");}},
    async submit(_name, el) {
      const code = formValues(el).code.trim();
      const preview = await ctx.api("/api/platform/invitations/preview", {
        method: "POST",
        body: { code },
      });
      const yes = await ctx.confirm({
        title: `Join ${preview.property.name}?`,
        message: `You’ll join as ${preview.role.toLowerCase()}${preview.permissions.length ? ` with ${preview.permissions.join(", ").toLowerCase().replaceAll("_", " ")}` : ""}.`,
        confirmLabel: "Accept invitation",
      });
      if (!yes) return;
      const result = await ctx.api("/api/platform/invitations/accept", {
        method: "POST",
        body: { code },
      });
      ctx.markSaved();
      if(result.pendingOwnerApproval){ctx.toast("Request sent. Your owner must confirm your identity before access is granted.");await ctx.navigate("workspaces");}
      else await ctx.acceptPlatform(result.tokens);
    },
  };
}
export function linkAccountScreen(ctx) {
  return {...page("Existing account",`${intro("YOUR EXISTING ACCOUNT", "Sign in to your records.", "Your existing password proves ownership. Accounts are never merged just because email addresses match.")}${button("Sign out and sign in",{action:"logout",kind:"primary block"})}`,"workspaces")};
}
export async function subscriptionScreen(ctx) {
 const org=organisation(ctx.snapshot);if(!org)throw new Error("Select your owner workspace first.");
 const [data,cfg]=await Promise.all([ctx.api(`/api/platform/organisations/${org.id}/subscription`),platformConfig(ctx)]);
 const account=ctx.snapshot.platform.account,active=data.entitled===true;
 const amountPaise=data.plan?.amountPaise??cfg.plan?.amountPaise,price=money(amountPaise);
 const pendingPriceReview=Boolean(data.pendingOrder?.providerOrderId&&Number.isSafeInteger(data.pendingOrder.amountPaise)&&data.pendingOrder.amountPaise!==amountPaise);
 const canPay=Number.isSafeInteger(amountPaise)&&amountPaise>=100&&!pendingPriceReview&&cfg.androidBilling==="CUSTOM_UPI_INTENT"&&ctx.native.has("openPlanRazorpayUpi")&&data.configured===true;
 planCheckout.restore(ctx.native,org.id);
 const pending=data.pendingOrder?.providerOrderId;
 if(pending&&!planCheckout.orderId)Object.assign(planCheckout,{orderId:pending,organisationId:org.id,status:"INTERRUPTED_CHECK_PROVIDER",busy:false});
 const payForm=`<form data-form="planPay" novalidate><fieldset data-plan-controls><div class="form-error" role="alert"></div>${field("paymentContact","Mobile number for payment",{type:"tel",required:true,value:paymentContact(account.contactPhone)||"",placeholder:"10-digit mobile number",attrs:'inputmode="tel" autocomplete="tel" maxlength="20"'})}${primary(active?`Renew ${price} with UPI`:`Pay ${price} with UPI`,{type:"submit",glyph:"arrow"})}</fieldset></form>`;
 const check=()=>ctx.navigate("planVerification",{},{replace:true,force:true});
 const paint=()=>{const status=document.querySelector("[data-plan-checkout-status]");if(status)status.textContent=planCheckout.message;const controls=document.querySelector("[data-plan-controls]");if(controls)controls.disabled=planCheckout.busy;};
 return {...page(active?"Your PGOne plan":"Activate your PG",`${intro("",active?"Your PGOne plan":"Activate your owner account","")}<div class="royal-plan refined-plan">${active?badge("Active","green"):""}<span class="plan-name">Owner plan</span><div class="plan-price">${esc(price)}<small>/ month</small></div><p>One calendar month · no automatic debit</p>${data.accessEnd?`<p>Access until ${date(data.accessEnd)}</p>`:""}</div>${active?primary("Enter dashboard",{route:"ownerHome",glyph:"arrow"}):""}${canPay?(active?`<details class="disclosure"><summary>Renew for another month</summary>${payForm}</details>`:payForm):notice(pendingPriceReview?`Your earlier ${money(data.pendingOrder.amountPaise)} payment needs confirmation before a new ${price} payment. Check its status before paying again.`:"In-app payment is unavailable. Your existing access and records are preserved.")}<p data-plan-checkout-status role="status" aria-live="polite"></p>${planCheckout.orderId?button("Check payment status",{action:"subscriptionRefresh",kind:"secondary block"}):""}<details class="disclosure"><summary>Plan and receipts</summary><p>Rooms, residents and rent management. ${esc(price)} total; GST is not charged. Renew manually each month.</p><p>Rent is paid separately to your PG owner. Verify bank credit before confirming direct rent payments.</p>${data.subscription?.payments?.map(p=>card(`<strong>₹${(p.amountPaise/100).toFixed(2)}</strong><p>${date(p.paidAt)} · ${esc(p.receiptNumber)}</p>${button("Download receipt",{action:"planReceipt",kind:"text-button",attrs:`data-id="${esc(p.id)}" data-number="${esc(p.receiptNumber)}"`})}`)).join("")||""}</details>`,"workspaces"),
 onPlanResult:paint,mount:paint,
 async action(name,el){if(name==="subscriptionRefresh")return check();if(name==="planReceipt")return ctx.downloadAccountReceipt(`/api/platform/organisations/${org.id}/plan/receipts/${el.dataset.id}.pdf`,el.dataset.number);},
 async submit(name,el){
  if(name!=="planPay")return;if(!canPay)throw new Error("UPI payment is unavailable.");
  if(planCheckout.busy)throw new Error("Finish or cancel the open UPI checkout first.");
  const contact=paymentContact(formValues(el).paymentContact);
  if(!contact)throw Object.assign(new Error("Enter a valid 10-digit Indian mobile number."),{details:{fieldErrors:{paymentContact:["Enter a valid Indian mobile number."]}}});
  if(planCheckout.orderId){
   if(planCheckout.checkedOrder!==planCheckout.orderId){ctx.markSaved();return check();}
   if(!await ctx.confirm({title:"Check your bank before retrying",message:"If money was debited, check payment status and wait. Continue only if no debit occurred.",confirmLabel:"No debit — retry"}))return;
  }
  const order=await ctx.api(`/api/platform/organisations/${org.id}/plan/android/orders`,{method:"POST",body:{accepted:true,amountPaise,recurring:false,requestKey:requestId()}});
  if(!order.payable){ctx.markSaved();await ctx.refreshPlatform();return ctx.navigate("subscription",{},{replace:true,force:true});}
  if(!/^order_[a-zA-Z0-9]+$/.test(order.orderId||"")||!/^rzp_(test|live)_[a-zA-Z0-9]+$/.test(order.keyId||"")||!Number.isSafeInteger(order.amountPaise)||order.currency!=="INR"||order.recurring!==false)throw new Error("The provider returned an invalid plan payment request.");
  if(order.amountPaise!==amountPaise){Object.assign(planCheckout,{organisationId:org.id,orderId:order.orderId,status:"INTERRUPTED_CHECK_PROVIDER",busy:false});ctx.markSaved();return ctx.navigate("subscription",{},{replace:true,force:true});}
  planCheckout.begin(org.id,order.orderId);
  ctx.native.call("openPlanRazorpayUpi",JSON.stringify({organisationId:org.id,key:order.keyId,order_id:order.orderId,amount:order.amountPaise,currency:"INR",email:account.email||"",contact}));paint();
 }
 };
}

export async function merchantScreen(ctx) { return ownerMerchantScreen(ctx); }
export async function invitationsScreen(ctx) {
  const org = organisation(ctx.snapshot);
  if (!org) throw new Error("Select your owner workspace first.");
  const list = await ctx.api(
    `/api/platform/organisations/${org.id}/invitations`,
  );
  const { members = [] } = await ctx.api(
    `/api/platform/organisations/${org.id}/members`,
  );
  const { students = [] } = await ctx.api(
    `/api/owner/students?${ctx.periodQuery}`,
  );
  return {
    ...page(
      "Invite your people",
      `${intro("BETTER TOGETHER", "The right people. The right access.", "Invite a resident or staff member to your PG.")}${form("createInvitation", `<label class="field"><span class="field-label">Invite as</span><select name="role"><option value="STAFF">Staff · occupancy access</option><option value="RESIDENT">Resident · their own records</option></select></label>${field("email", "Invitation email", { required: true, type:"email", attrs: 'autocomplete="email" maxlength="254"' })}<div data-invited-resident hidden>${field("studentId", "Resident", { options: [["", "Choose a resident"], ...students.filter((s) => s.status === "ACTIVE").map((s) => [s.id, `${s.name} / ${s.mobile}`])], help: "Add residents in Resident Management before inviting them." })}</div>`, "Create invitation")}<div data-invitation-result aria-live="polite"></div><h2 class="royal-section-title">Recent invitations</h2>${list.invitations.map((i) => `<div class="invitation-row"><span><strong>${esc(i.role)}</strong><small>${esc(i.email || "Retired phone invitation — issue a new email invitation")}</small></span>${badge(i.status)}${i.status === "REQUESTED" ? button("Review access request",{action:"approveInvitation",kind:"secondary",attrs:`data-id="${esc(i.id)}" data-account="${esc(i.requestedAccountId)}" data-email="${esc(i.email)}"`}) : ""}${["PENDING","REQUESTED"].includes(i.status) ? button("Revoke", { action: "revoke", kind: "text-button", attrs: `data-id="${esc(i.id)}"` }) : ""}</div>`).join("") || '<p class="legal-copy">Your invitations will appear here.</p>'}<h2 class="royal-section-title">People with access</h2>${members.map((m) => `<div class="invitation-row"><span><strong>${esc(m.fullName || m.role)}</strong><small>${esc(m.role)} / ${esc(m.propertyName)}</small></span>${button("Remove access", { action: "revokeMember", kind: "text-button", attrs: `data-id="${esc(m.id)}"` })}</div>`).join("") || '<p class="legal-copy">No resident or staff memberships yet.</p>'}`,
      "profile",
    ),
    change(name, el, form) {
      if (name === "role") {
        const group = form.querySelector("[data-invited-resident]");
        group.hidden = el.value !== "RESIDENT";
        form.elements.studentId.required = el.value === "RESIDENT";
      }
      if (name === "studentId") {
        const student = students.find((s) => s.id === el.value);
        if (student)
          form.elements.email.value = student.email || "";
      }
    },
    async submit(_name, el) {
      const v = formValues(el);
      const result = await ctx.api("/api/platform/invitations", {
        method: "POST",
        body: {
          organisationId: org.id,
          propertyId: ctx.snapshot.property.id,
          role: v.role,
          email: v.email.trim().toLowerCase(),
          ...(v.studentId ? { studentId: v.studentId } : {}),
          permissions: v.role === "STAFF" ? ["OCCUPANCY_READ"] : [],
        },
      });
      ctx.markSaved();
      document.querySelector("[data-invitation-result]").innerHTML =
        `<div class="invitation-code"><h2>Invitation ready</h2><p>Share privately with the invited person. Expires ${date(result.expiresAt)}.</p><code>${esc(result.code)}</code></div>`;
    },
    async action(name, el) {
      if(name==="approveInvitation"){
        const yes=await ctx.confirm({title:"Confirm this person's identity",message:`I independently confirmed that the account using ${el.dataset.email} belongs to the intended invited person. This grants their assigned property access.`,confirmLabel:"Identity checked — approve"});
        if(!yes)return;
        await ctx.api(`/api/platform/invitations/${el.dataset.id}/approve`,{method:"POST",body:{accountId:el.dataset.account,identityChecked:true}});
        return ctx.reload();
      }

      if (
        name === "revokeMember" &&
        (await ctx.confirm({
          title: "Remove workspace access?",
          message:
            "This person will lose this membership. Their unused invitations for this property and role will also be revoked.",
          confirmLabel: "Remove access",
          danger: true,
        }))
      ) {
        await ctx.api(
          `/api/platform/memberships/${encodeURIComponent(el.dataset.id)}/revoke`,
          { method: "POST" },
        );
        return ctx.reload();
      }
      if (name === "revoke") {
        await ctx.api(
          `/api/platform/invitations/${encodeURIComponent(el.dataset.id)}/revoke`,
          { method: "POST" },
        );
        return ctx.reload();
      }
    },
  };
}
export async function staffScreen(ctx) {
  const data = await ctx.api("/api/platform/staff");
  return page(
    "Your staff workspace",
    `${intro("YOUR WORKSPACE", data.property.name, "Access assigned by your property owner.")}${data.occupancy ? `<div class="staff-counts">${card(`<strong>${data.occupancy.activeResidents}</strong><span>Active residents</span>`)}${card(`<strong>${data.occupancy.activeRooms}</strong><span>Active rooms</span>`)}</div>` : notice("No occupancy permission is assigned to this workspace.")}${primary("Switch workspace", { route: "workspaces" })}${button("Sign out", { action: "logout", kind: "secondary block" })}`,
    "workspaces",
  );
}
export async function legalScreen(ctx) {
  const config = await platformConfig(ctx);
  const privacy = ctx.params.kind === "privacy";
  const url = privacy ? config.legal?.privacy : config.legal?.terms;
  return {
    ...page(
      privacy ? "Privacy Policy" : "Terms",
      `${intro("YOUR TRUST MATTERS", privacy ? "Your privacy, clearly." : "A clear understanding.", url ? "Read the published policy before continuing." : "The published policy is currently unavailable.")}${url ? primary("Read published policy", { action: "openPolicy", glyph: "arrow" }) : ""}`,
      "login",
    ),
    action(name) {
      if (name === "openPolicy" && url?.startsWith("https://")) {
        if (ctx.native.has("openLegalLink"))
          ctx.native.call("openLegalLink", url);
        else window.open(url, "_blank", "noopener,noreferrer");
      }
    },
  };
}
