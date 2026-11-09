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
  `<header class="onboarding-top"><button class="royal-back" ${routeAttrs(back)} aria-label="Go back">${icon("back")}</button>${brand()}</header>`;
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
  `<div class="royal-intro"><span class="royal-kicker">${esc(kicker)}</span><h1>${esc(title)}</h1><span class="gold-rule"></span><p>${esc(text)}</p></div>`;

export function welcomeScreen() {
  return {
    bare: true,
    title: "Welcome",
    content: `<main class="welcome-page royal-page"><div class="welcome-art">${image("hero")}</div><div class="welcome-copy">${brand()}<span class="royal-kicker">A BETTER WAY TO RUN YOUR PG</span><h1>Your PG.<br>Beautifully<br><em>managed.</em></h1><span class="gold-rule"></span><p>Rooms, residents, rent.<br>Everything feels in place.</p></div><div class="welcome-bottom"><span class="welcome-caption">A little more calm. Every day.</span>${primary("Create account", { route: "phone", params: { mode: "SIGN_UP" }, glyph: "arrow" })}${button("Sign in", { route: "phone", params: { mode: "SIGN_IN" }, kind: "secondary block" })}<p class="welcome-foot">Thoughtfully made for life at your PG.</p></div></main>`,
  };
}
export async function phoneScreen(ctx) {
  onboarding.authMode = ctx.params.mode || onboarding.authMode || "SIGN_UP";
  const signingUp = onboarding.authMode === "SIGN_UP";
  const config = await platformConfig(ctx);
  const available =
    !!config.phone &&
    ctx.native.has("startPhoneSignIn") &&
    config.legal?.terms &&
    config.legal?.privacy;
  return {
    ...page(
      signingUp ? "Create account" : "Sign in",
      `${intro(signingUp ? "NEW TO PGONE" : "WELCOME BACK", signingUp ? "Create your PGOne account." : "Sign in to PGOne.", signingUp ? "Verify your mobile number, then set up or join your PG." : "Use your registered mobile number to open your workspaces.")}<div class="phone-secure">${icon("shield")}<span>Secure sign-in with a verification code</span></div>${!available ? notice(config.unavailable ? "The updated account service is not available yet. Retry, or use email sign-in for an existing account." : "Phone sign-in is awaiting activation on this installation. Use your existing account below.") : ""}${form("phone", `<label class="field"><span class="field-label">Mobile number</span><span class="phone-field"><span>+91</span><input name="phone" aria-label="Mobile number" inputmode="tel" autocomplete="tel-national" maxlength="10" pattern="[6-9][0-9]{9}" required placeholder="Enter your mobile number" value="${esc(onboarding.phone.replace(/^\+91/, ""))}"></span><span class="field-error" id="field-phone-error"></span></label>`, "Continue")}${!available ? button("Retry phone service", { action: "retryPhone", kind: "secondary block" }) : ""}${button("Use email & password", { route: "login", kind: "secondary block" })}${button(signingUp ? "Already registered? Sign in" : "New here? Create account", { route: "phone", params: { mode: signingUp ? "SIGN_IN" : "SIGN_UP" }, kind: "text-button block" })}<p class="legal-copy">By continuing, you agree to our <button class="text-button" data-route="legal" data-params='{"kind":"terms"}'>Terms</button> and <button class="text-button" data-route="legal" data-params='{"kind":"privacy"}'>Privacy Policy</button>.</p>`,
      "welcome",
      `<div class="auth-architecture">${image("property")}</div>`,
    ),
    mount() {
      const submit = document.querySelector(
        '[data-form="phone"] [type="submit"]',
      );
      if (submit) {
        submit.disabled = !available;
        submit.querySelector("span").textContent = "Send verification code";
      }
    },
    action(name) {
      if (name === "retryPhone") {
        onboarding.config = null;
        return ctx.reload();
      }
    },
    async submit(_name, el) {
      if (!available)
        throw new Error(
          "Phone sign-in is not activated on this installation. Use email & password, or retry after setup.",
        );
      const number = formValues(el).phone.replace(/\D/g, "");
      if (!/^[6-9]\d{9}$/.test(number))
        throw new Error("Enter a valid 10-digit Indian mobile number.");
      onboarding.phone = `+91${number}`;
      onboarding.attempt = requestId();
      onboarding.error = "";
      ctx.native.call(
        "startPhoneSignIn",
        JSON.stringify(config.phone),
        onboarding.phone,
        onboarding.attempt,
        false,
      );
      ctx.markSaved();
      await ctx.navigate("otp");
    },
  };
}
export function otpScreen(ctx) {
  if (!onboarding.attempt) return phoneScreen(ctx);
  let timer;
  const result = {
    ...page(
      "Verify your number",
      `${intro("A SECURE START", "Verify your number.", `Enter the six-digit verification code for ${onboarding.phone}.`)}<div class="otp-status" role="status">${onboarding.sentAt ? "Verification code sent." : "Requesting your code…"}</div>${form("otp", `<label class="field"><span class="field-label">Verification code</span><input class="otp-input" name="code" aria-label="Verification code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="— — — — — —"><span class="field-error" id="field-code-error"></span></label>`, "Verify & continue")}<div class="otp-actions">${button("Resend code", { action: "resend", kind: "secondary block", attrs: "disabled" })}<span data-countdown role="status"></span>${button("Change mobile number", { action: "changeNumber", kind: "text-button" })}</div><p class="legal-copy">Never share your verification code with anyone.</p>`,
      "phone",
    ),
    mount() {
      const tick = () => {
        const remaining = Math.max(
          0,
          Math.ceil((onboarding.sentAt + 60000 - Date.now()) / 1000),
        );
        const button = document.querySelector('[data-action="resend"]');
        if (button) button.disabled = !onboarding.sentAt || remaining > 0;
        const label = document.querySelector("[data-countdown]");
        if (label)
          label.textContent =
            onboarding.sentAt && remaining
              ? `Resend available in ${remaining}s`
              : "";
      };
      tick();
      timer = setInterval(tick, 1000);
    },
    unmount() {
      clearInterval(timer);
    },
    phoneEvent(type, value) {
      const label = document.querySelector(".otp-status");
      if (type === "sent") {
        onboarding.sentAt = Date.now();
        if (label) label.textContent = "Verification code sent.";
        const countdown = document.querySelector("[data-countdown]");
        if (countdown) countdown.textContent = "Resend available in 60s";
      }
      if (type === "error") {
        if (label) label.textContent = value;
        onboarding.sentAt ||= Date.now();
      }
    },
    submit(_name, el) {
      if (!onboarding.sentAt)
        throw new Error("Wait for the verification code to be sent.");
      ctx.native.call(
        "verifyPhoneCode",
        formValues(el).code,
        onboarding.attempt,
      );
      const label = document.querySelector(".otp-status");
      if (label) label.textContent = "Verifying your code…";
    },
    async action(name) {
      if (name === "changeNumber") {
        onboarding.attempt = "";
        onboarding.exchangeAttempt = "";
        onboarding.sentAt = 0;
        ctx.native.call("cancelPhoneSignIn");
        return ctx.navigate("phone");
      }
      if (name === "resend" && Date.now() - onboarding.sentAt >= 60000) {
        onboarding.attempt = requestId();
        onboarding.sentAt = Date.now();
        ctx.native.call(
          "startPhoneSignIn",
          JSON.stringify(onboarding.config.phone),
          onboarding.phone,
          onboarding.attempt,
          true,
        );
      }
    },
  };
  return result;
}
export function chooseRoleScreen(ctx) {
  return {
    ...page(
      "Your role",
      `${intro("YOUR PGONE", "A place for everyone.", "Choose how you’ll use PGOne. Your property access is confirmed separately.")}<div class="role-options">${[
        [
          "OWNER",
          "building",
          "I manage a PG",
          "Set up your property and bring everything together.",
        ],
        [
          "RESIDENT",
          "home",
          "I live in a PG",
          "Your rent, receipts and updates, in one place.",
        ],
        [
          "STAFF",
          "users",
          "I work at a PG",
          "Join the workspace your owner has invited you to.",
        ],
      ]
        .map(
          ([role, glyph, title, desc]) =>
            `<button class="role-option" data-action="role" data-role="${role}"><span class="role-icon">${icon(glyph)}</span><span><strong>${title}</strong><small>${desc}</small></span>${icon("chevron")}</button>`,
        )
        .join(
          "",
        )}</div>${button("Your workspaces", { route: "workspaces", kind: "secondary block" })}`,
      "workspaces",
    ),
    action(name, el) {
      if (name === "role") {
        onboarding.intent = el.dataset.role;
        return ctx.navigate("setupProfile");
      }
    },
  };
}
export function setupProfileScreen(ctx) {
  const account = ctx.snapshot.platform.account;
  const owner = onboarding.intent === "OWNER";
  return {
    ...page(
      "Your profile",
      `<div class="setup-hero">${intro("MAKE IT YOURS", owner ? "Set up your owner profile." : "Let’s get to know you.", "A few details for a more personal workspace.")}${image("property")}</div>${step(1, "Your profile")}${form("setupProfile", `${field("fullName", "Full name", { required: true, value: account.fullName, attrs: 'minlength="2" maxlength="100" autocomplete="name"', placeholder: "Your full name" })}${field("email", "Email address", { type: "email", value: account.email || "", placeholder: "Optional contact email", attrs: 'maxlength="254" autocomplete="email"', help: "Optional. This email is not verified for sign-in." })}${field("verifiedPhone", account.phoneE164 ? "Verified mobile number" : "Sign-in identity", { value: account.phoneE164 || "Linked existing account", attrs: 'readonly aria-readonly="true"' })}`)}<div class="quiet-note">${icon("shield")}<span>${account.phoneE164 ? "Your phone number is verified securely." : "Your existing account is linked securely."}</span></div>`,
      "chooseRole",
    ),
    async submit(_name, el) {
      const values = formValues(el);
      await ctx.api("/api/platform/profile", {
        method: "POST",
        body: {
          fullName: values.fullName,
          email: values.email,
          intent: onboarding.intent,
        },
      });
      ctx.markSaved();
      await ctx.refreshPlatform();
      return ctx.navigate(owner ? "setupProperty" : "joinWorkspace");
    },
  };
}
export function setupPropertyScreen(ctx) {
  const draft = ctx.snapshot.onboardingDraft;
  onboarding.propertyKey ||= draft?.key || requestId();
  let saveTimer;
  const saveDraft = (values) =>
    ctx.saveOnboardingDraft({ key: onboarding.propertyKey, values });
  return {
    ...page(
      "Your first PG",
      `<div class="setup-hero">${intro("A NEW BEGINNING", "Your PG starts here.", "Give your property a home in PGOne.")}${image("property")}</div>${step(2, "Your property")}${form("setupProperty", `${field("name", "PG name", { value: draft?.values?.name || "", required: true, placeholder: "e.g. Maple House", attrs: 'minlength="2" maxlength="120" autocomplete="organization"' })}${field("city", "City", { value: draft?.values?.city || "", required: true, placeholder: "e.g. Bengaluru", attrs: 'minlength="2" maxlength="100" autocomplete="address-level2"' })}${field("approximateRooms", "Approximate number of rooms", { value: draft?.values?.approximateRooms || "", type: "number", placeholder: "Optional", attrs: 'min="1" max="100000" inputmode="numeric"', help: "You can add the actual rooms in your workspace." })}`, "Create my PG")}<div class="quiet-note">${icon("check")}<span>You can update property details later.</span></div>`,
      "setupProfile",
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
      await ctx.selectWorkspace(member.id, "subscription");
      onboarding.propertyKey = null;
    },
  };
}
export function setupReadyScreen(ctx) {
  const entitled = organisation(ctx.snapshot)?.entitled === true;
  return page(
    "Your PG is ready",
    `<div class="ready-art">${image("ready")}<span class="ready-check">${icon("check")}</span></div>${intro("MADE FOR YOUR EVERYDAY", `${ctx.snapshot.property.name} is ready.`, entitled ? "Your subscription is verified. Set up payments whenever you are ready." : "Your PG is saved. Activate PGOne to start managing rooms and residents.")}${primary(entitled ? "Enter my workspace" : "Activate PGOne · ₹249", { route: entitled ? "ownerHome" : "subscription", glyph: "arrow" })}${entitled ? button("Set up online rent collection", { route: "merchant", kind: "secondary block" }) : ""}<p class="legal-copy">Online rent collection requires a separately approved merchant account. Your monthly PGOne plan does not automatically enable rent payments.</p>`,
    "workspaces",
  );
}
export async function workspacesScreen(ctx) {
  const data = await ctx.api("/api/platform/session");
  return {
    ...page(
      "Your workspaces",
      `${intro("WELCOME BACK", data.account.fullName ? `Hello, ${data.account.fullName.split(" ")[0]}.` : "Your PG, connected.", "Choose a workspace to continue.")}<div class="workspace-list">${data.memberships.map((m) => `<button class="workspace-option" data-action="workspace" data-id="${esc(m.id)}"><span class="role-icon">${icon(m.role === "OWNER" ? "building" : "home")}</span><span><strong>${esc(m.property.name)}</strong><small>${esc(m.role === "RESIDENT" ? "Resident" : m.role === "STAFF" ? "Staff" : "Property owner")}</small></span>${icon("arrow")}</button>`).join("") || notice("You haven’t joined a property yet. Set up your PG or use your owner’s invitation.")}</div>${primary("Set up or join a PG", { route: "chooseRole", glyph: "plus" })}${button("I have an invitation", { route: "joinWorkspace", kind: "secondary block" })}${button("Sign out", { action: "logout", kind: "text-button" })}`,
      "chooseRole",
    ),
    action(name, el) {
      if (name === "workspace") return ctx.selectWorkspace(el.dataset.id);
    },
  };
}
export function joinWorkspaceScreen(ctx) {
  return {
    ...page(
      "Join your PG",
      `${intro("YOU’RE INVITED", "Your place is waiting.", "Enter the invitation code shared by your PG owner. Use the mobile number they invited.")}${form("invitation", field("code", "Invitation code", { required: true, attrs: 'minlength="43" maxlength="43" autocomplete="off" autocapitalize="none" spellcheck="false"' }), "Review invitation")}${button("Link an existing account", { route: "linkAccount", kind: "secondary block" })}<p class="legal-copy">Your owner controls property access and staff permissions.</p>`,
      "workspaces",
    ),
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
      await ctx.acceptPlatform(result.tokens);
    },
  };
}
export function linkAccountScreen(ctx) {
  return {
    ...page(
      "Link your account",
      `${intro("KEEP EVERYTHING TOGETHER", "Your existing PG, here.", "Confirm your existing email and password to link your records securely.")}${form("linkAccount", `${field("email", "Existing email", { type: "email", required: true, attrs: 'autocomplete="username"' })}${field("password", "Password", { type: "password", required: true, attrs: 'autocomplete="current-password" maxlength="128"' })}`, "Link account")}`,
      "workspaces",
    ),
    async submit(_name, el) {
      const v = formValues(el);
      const old = await ctx.api("/api/auth/login", {
        public: true,
        method: "POST",
        body: v,
      });
      const linked = await ctx.api("/api/platform/link-legacy", {
        method: "POST",
        body: { legacyAccessToken: old.tokens.accessToken },
      });
      ctx.markSaved();
      await ctx.acceptPlatform(linked.tokens);
    },
  };
}
export async function subscriptionScreen(ctx) {
  const org = organisation(ctx.snapshot);
  if (!org) throw new Error("Select your owner workspace first.");
  const data = await ctx.api(`/api/platform/organisations/${org.id}/subscription`);
  const active = data.entitled === true;
  return {
    ...page(
      active ? "PGOne activated" : "Activate PGOne",
      `${intro(active ? "ACCESS CONFIRMED" : "ACTIVATE YOUR PROPERTY", active ? "You're ready to manage your PG." : "Your PG is ready. One last step.", active ? "Your monthly PGOne access has been verified." : "Your property and account are safely saved. Activate PGOne before entering your management dashboard.")}<div class="royal-plan"><span class="plan-name">PGOne · One plan</span><div class="plan-price">₹249<small>/ month</small></div><p>One payment covers one calendar month · no automatic debit</p><ul>${["Manage rooms and residents", "Track rent, receipts and dues", "Manage staff access", "Enable online rent collection after separate merchant approval"].map(t => `<li>${icon("check")}${t}</li>`).join("")}</ul></div><div class="subscription-state">${badge(active ? "ACTIVE" : "ACTIVATION REQUIRED", active ? "green" : "neutral")}${data.accessEnd ? `<p>Access ends ${date(data.accessEnd)}</p>` : ""}</div>${active ? `${primary("Enter my dashboard", { route: "ownerHome", glyph: "arrow" })}${button("Set up rent collection", { route: "merchant", kind: "secondary block" })}` : `${notice(data.checkoutEnabled ? "Complete the ₹249 purchase on PGOne's separate authorised billing website, then return here to verify activation." : "Subscription checkout is not yet activated for this account. The application cannot take payment until the merchant billing setup is complete.")}${data.pendingOrder ? notice("A payment is awaiting confirmation. Do not pay again before verifying its status.") : ""}${primary("I have paid · Check activation", { action: "subscriptionRefresh", glyph: "refresh" })}${button("Switch workspace", { route: "workspaces", kind: "secondary block" })}`}${data.subscription?.payments?.length ? `<h2 class="royal-section-title">Verified payment history</h2>${data.subscription.payments.map(p => card(`<strong>₹${(p.amountPaise / 100).toFixed(2)}</strong><p>${date(p.paidAt)} · ${esc(p.receiptNumber)}</p>`)).join("")}` : ""}<p class="legal-copy">Google Play Android distribution uses consumption-only billing. This app does not initiate third-party checkout or redirect to an external purchase page. A payment return is never proof of activation; PGOne verifies captured payment on its server. Rent settlement onboarding is separate.</p>`,
      "workspaces",
    ),
    async action(name) {
      if (name === "subscriptionRefresh") {
        if (data.configured) {
          await ctx.api(`/api/platform/organisations/${org.id}/subscription/recheck`, { method: "POST" });
        }
        const hasAccess = await ctx.refreshPaidAccess();
        return hasAccess ? ctx.navigate("setupReady", {}, { replace: true }) : ctx.reload();
      }
    },
  };
}

export async function merchantScreen(ctx) {
  const org = organisation(ctx.snapshot);
  if (!org) throw new Error("Select your owner workspace first.");
  const data = await ctx.api(`/api/platform/organisations/${org.id}/merchant`);
  return {
    ...page(
      "Online rent payments",
      `<div class="payments-art">${image("payments")}</div>${intro("YOUR RENT. YOUR ACCOUNT.", "Payments, beautifully connected.", "Receive rent through your approved payment account.")}<div class="merchant-checklist">${[
        [
          "building",
          "Business details",
          "Required fields depend on your approved provider.",
        ],
        [
          "wallet",
          "Settlement bank account",
          data.bankSubmission
            ? `Last submitted account ending ${data.bankSubmission.last4}. Cashfree confirms verification.`
            : "Linked directly through the approved provider.",
        ],
        [
          "shield",
          "Identity verification",
          "Your provider confirms KYC and activation.",
        ],
      ]
        .map(
          ([glyph, title, text]) =>
            `<div>${icon(glyph)}<span><strong>${title}</strong><small>${esc(text)}</small></span></div>`,
        )
        .join(
          "",
        )}</div>${notice(data.message)}${data.environment === "TEST" ? notice("Sandbox merchant setup. This is not live approval or rent collection.") : ""}${badge(data.status.replaceAll("_", " "))}${data.onboardingAvailable && !data.setupStarted ? primary("Set up owner payment account", { route: "merchantProfile", glyph: "arrow" }) : ""}${data.onboardingAvailable && data.setupStarted && data.status !== "APPROVED" ? `${button("Add settlement bank account", { route: "merchantBank", kind: "secondary block" })}${primary("Complete secure KYC", { action: "merchantKyc", glyph: "shield" })}` : ""}${primary("Refresh setup status", { action: "merchantRefresh", glyph: "refresh" })}<p class="legal-copy">Owner rent collection and your PGOne monthly fee are separate. No payment or merchant approval is inferred from returning to this screen.</p>`,
      "profile",
    ),
    async action(name) {
      if (name === "merchantRefresh") {
        if (data.setupStarted && data.onboardingAvailable)
          await ctx.api(`/api/platform/organisations/${org.id}/merchant/recheck`, { method: "POST" });
        return ctx.reload();
      }
      if (name === "merchantKyc") {
        if (!ctx.native.has("openMerchantOnboarding")) throw new Error("Secure in-app KYC needs the updated Android app.");
        const link = await ctx.api(`/api/platform/organisations/${org.id}/merchant/onboarding-link`, { method: "POST" });
        ctx.native.call("openMerchantOnboarding", link.url);
      }
    },
  };
}
export async function merchantProfileScreen(ctx) {
  const org = organisation(ctx.snapshot);
  if (!org) throw new Error("Select your owner workspace first.");
  const data = await ctx.api(`/api/platform/organisations/${org.id}/merchant`);
  if (!data.onboardingAvailable) throw new Error(data.message);
  const account = ctx.snapshot.platform.account;
  return {
    ...page("Owner payment account", `${intro("RENT. DIRECTLY TO YOU.", "Your business, connected.", "Create your own Cashfree merchant profile. Your PGOne fee and residents’ rent remain separate.")}${form("merchantProfile", `${field("name", "Business or PG name", {required:true,value:org.name,attrs:'maxlength="120"'})}${field("legalName", "Legal name", {required:true,value:account.fullName,help:"Use the name on your business or individual documents.",attrs:'maxlength="150"'})}${field("email", "Merchant contact email", {required:true,type:"email",value:account.email||"",help:"Cashfree sends account verification to this address.",attrs:'autocomplete="email" maxlength="254"'})}${field("website", "Business website or booking page", {required:true,type:"url",placeholder:"https://",help:"Use a real public page for your own business.",attrs:'maxlength="500"'})}${field("businessType", "Business type", {required:true,options:[["","Select your business type"],...["Individual","Proprietorship","LLP","Partnership","Private Limited","Public Limited","Trust","Society","NGO","Hindu Undivided Family (HUF)","Association of Persons (AOP)","Body of Individuals (BOI)","Local Authority","Artificial Juridical Person","Government"].map(v=>[v,v])]})}${field("businessModel", "Customers", {required:true,options:[["","Select your customer type"],["B2C","Individuals / residents"],["B2B","Businesses"],["Both","Both"]]})}<label class="merchant-consent"><input name="consent" type="checkbox" required> I authorise PGOne to submit these details to Cashfree for my merchant account and receive its onboarding status.</label>`,"Create merchant profile")}<p class="legal-copy">Cashfree verifies the account. No bank or KYC approval is created by this form.</p>`, "merchant"),
    async submit(_name, el) {
      const values = formValues(el);
      await ctx.api(`/api/platform/organisations/${org.id}/merchant/profile`, {method:"POST",body:{...values,consent:el.elements.consent.checked}});
      ctx.markSaved();
      await ctx.navigate("merchantBank");
    },
  };
}
export async function merchantBankScreen(ctx) {
  const org = organisation(ctx.snapshot);
  if (!org) throw new Error("Select your owner workspace first.");
  const data = await ctx.api(`/api/platform/organisations/${org.id}/merchant`);
  if (!data.onboardingAvailable || !data.setupStarted) throw new Error("Complete the merchant profile before bank setup.");
  const uncertain = ["SUBMITTING","CHECKING"].includes(data.bankSubmission?.status);
  const blocked = uncertain || data.status === "APPROVED";
  const masked = (name,label) => `<label class="field"><span class="field-label">${label}</span><input type="password" name="${name}" aria-label="${label}" required inputmode="numeric" autocomplete="off" maxlength="34" pattern="[0-9]{6,34}"><span class="field-error" id="field-${name}-error"></span></label>`;
  return {
    ...page("Settlement bank",`${intro("YOUR RENT. YOUR BANK.", "Where rent belongs.", "Submit your settlement bank details directly to Cashfree. PGOne keeps only the last four digits.")}${data.bankSubmission ? notice(`Last submission: account ending ${data.bankSubmission.last4}. Status: ${data.bankSubmission.status.replaceAll("_"," ")}. This is not bank verification.`) : ""}${blocked ? notice(uncertain ? "The earlier submission needs provider confirmation. Use secure KYC to review it; do not submit the bank again." : "This merchant is approved. Bank changes need Cashfree’s approved change process.") : form("merchantBank",`${masked("accountNumber","Account number")}${masked("confirmAccountNumber","Confirm account number")}${field("ifsc","IFSC code",{required:true,attrs:'autocomplete="off" maxlength="11" pattern="[A-Za-z]{4}0[A-Za-z0-9]{6}"',placeholder:"ABCD0123456"})}<label class="merchant-consent"><input name="consent" type="checkbox" required> I authorise submitting this account to Cashfree as my settlement destination for verification.</label>`,"Submit bank details")}${button("Continue to secure KYC",{route:"merchant",kind:"secondary block"})}<p class="legal-copy">Never enter a UPI PIN or internet-banking password here. Cashfree performs verification and can request additional information.</p>`,"merchant"),
    async submit(_name,el) {
      const values=formValues(el);
      if (values.accountNumber !== values.confirmAccountNumber) throw new Error("Account numbers must match.");
      await ctx.api(`/api/platform/organisations/${org.id}/merchant/bank`,{method:"POST",body:{...values,ifsc:values.ifsc.toUpperCase(),consent:el.elements.consent.checked}});
      el.reset();
      ctx.markSaved();
      await ctx.navigate("merchant");
    },
  };
}
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
      `${intro("BETTER TOGETHER", "The right people. The right access.", "Invite a resident or staff member to your PG.")}${form("createInvitation", `<label class="field"><span class="field-label">Invite as</span><select name="role"><option value="STAFF">Staff · occupancy access</option><option value="RESIDENT">Resident · their own records</option></select></label>${field("phone", "Mobile number", { required: true, attrs: 'inputmode="tel" pattern="[6-9][0-9]{9}" maxlength="10"', placeholder: "10-digit Indian number" })}<div data-invited-resident hidden>${field("studentId", "Resident", { options: [["", "Choose a resident"], ...students.filter((s) => s.status === "ACTIVE").map((s) => [s.id, `${s.name} / ${s.mobile}`])], help: "Add residents in Resident Management before inviting them." })}</div>`, "Create invitation")}<div data-invitation-result aria-live="polite"></div><h2 class="royal-section-title">Recent invitations</h2>${list.invitations.map((i) => `<div class="invitation-row"><span><strong>${esc(i.role)}</strong><small>Number ending ${esc(i.phoneLast4)}</small></span>${badge(i.status)}${i.status === "PENDING" ? button("Revoke", { action: "revoke", kind: "text-button", attrs: `data-id="${esc(i.id)}"` }) : ""}</div>`).join("") || '<p class="legal-copy">Your invitations will appear here.</p>'}<h2 class="royal-section-title">People with access</h2>${members.map((m) => `<div class="invitation-row"><span><strong>${esc(m.fullName || m.role)}</strong><small>${esc(m.role)} / ${esc(m.propertyName)}</small></span>${button("Remove access", { action: "revokeMember", kind: "text-button", attrs: `data-id="${esc(m.id)}"` })}</div>`).join("") || '<p class="legal-copy">No resident or staff memberships yet.</p>'}`,
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
          form.elements.phone.value = student.mobile
            .replace(/\D/g, "")
            .slice(-10);
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
          phoneE164: `+91${v.phone}`,
          ...(v.studentId ? { studentId: v.studentId } : {}),
          permissions: v.role === "STAFF" ? ["OCCUPANCY_READ"] : [],
        },
      });
      ctx.markSaved();
      document.querySelector("[data-invitation-result]").innerHTML =
        `<div class="invitation-code"><h2>Invitation ready</h2><p>Share privately with the invited person. Expires ${date(result.expiresAt)}.</p><code>${esc(result.code)}</code></div>`;
    },
    async action(name, el) {
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
      `${intro("YOUR TRUST MATTERS", privacy ? "Your privacy, clearly." : "A clear understanding.", url ? "Read the published policy before continuing." : "The published policy is awaiting operator configuration. Phone registration stays unavailable until it is supplied.")}${url ? primary("Read published policy", { action: "openPolicy", glyph: "arrow" }) : ""}`,
      "phone",
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
