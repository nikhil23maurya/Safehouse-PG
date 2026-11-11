import { createApiClient } from "../../mobile/frontend/src/core/api.js";
import { brand, icon } from "../../mobile/frontend/src/components/icons.js";
import { money } from "../../mobile/frontend/src/domain/finance.js";
import {busyButton} from "../../mobile/frontend/src/components/motion.js";
import {
  esc,
  date,
  button,
  notice,
} from "../../mobile/frontend/src/components/ui.js";
import {
  field,
  formValues,
  validateForm,
  showFormError,
} from "../../mobile/frontend/src/components/forms.js";
import { CustomUpiPayment, loadCustomSdk } from "./checkout.js";

const state = { tokens: null, user: null, authEpoch: 0, property: null };
let config,
  account,
  org,
  data,
  adapter,
  apps = [],
  authorisation,
  countdown,
  processing = false;
let flowGeneration = 0;
const root = document.getElementById("app");
const api = createApiClient({
  getState: () => state,
  saveTokens: (tokens) => {
    state.tokens = tokens;
  },
  onExpired: () => {
    state.tokens = null;
    state.authEpoch++;
    resetPayment();
    login();
  },
});
function message(text) {
  document.getElementById("billing-message").textContent = text;
}
function resetPayment() {
  adapter = null;
  apps = [];
  authorisation = null;
  processing = false;
}
function page(title, description, content) {
  clearInterval(countdown);
  root.innerHTML = `<main class="onboarding-page royal-page web-billing"><header class="onboarding-top">${brand()}${state.tokens ? button("Sign out", { action: "logout", kind: "text-button" }) : ""}</header><div class="royal-intro"><span class="royal-kicker">YOUR PGONE PLAN</span><h1>${esc(title)}</h1><span class="gold-rule"></span><p>${esc(description)}</p></div>${content}<p class="legal-copy">${config?.legal?.terms ? `<a href="${esc(config.legal.terms)}" target="_blank" rel="noopener noreferrer">Terms</a>` : ""} · ${config?.legal?.privacy ? `<a href="${esc(config.legal.privacy)}" target="_blank" rel="noopener noreferrer">Privacy Policy</a>` : ""}</p></main>`;
}
function login() {
  flowGeneration++;
  if (!config?.enabled)
    return page(
      "A little more patience.",
      "Subscription services are awaiting activation.",
      notice(
        "The PGOne billing service is not activated yet. Existing Android access remains available.",
      ),
    );
  page(
    "Your PG. Connected.",
    "Sign in to manage your PGOne subscription.",
    `<form data-form="email" novalidate><div class="form-error" role="alert"></div>${field("email","Email address",{type:"email",required:true,attrs:'autocomplete="username" maxlength="254"'})}${field("password","Password",{type:"password",required:true,attrs:'autocomplete="current-password" maxlength="128"'})}${button("Sign in",{type:"submit",kind:"primary block"})}</form><p class="legal-copy">Use the same email and password as the PGOne app. Create an account or recover your password in PGOne.</p>`,
  );
}
async function session(tokens) {
  const generation = ++flowGeneration;
  state.tokens = tokens;
  state.authEpoch++;
  resetPayment();
  const snapshot = await api("/api/platform/session");
  if (generation !== flowGeneration) return;
  account = snapshot.account;
  state.user = snapshot.user;
  const organisations = [
    ...new Map(
      snapshot.memberships
        .filter((m) => m.role === "OWNER")
        .map((m) => [m.organisation.id, m.organisation]),
    ).values(),
  ];
  if (!organisations.length)
    return page(
      "Your workspace comes first.",
      "Set up your property in PGOne before managing a subscription.",
      notice(
        "This account has no owner workspace. Resident and staff memberships cannot buy an owner's subscription.",
      ),
    );
  page(
    "Choose your workspace.",
    "Your subscription belongs to the organisation that manages your PG.",
    organisations
      .map((o) =>
        button(o.name, {
          action: "organisation",
          kind: "secondary block",
          attrs: `data-id="${esc(o.id)}"`,
        }),
      )
      .join(""),
  );
}
async function status(recheck = false) {
  const epoch = state.authEpoch,
    organisationId = org;
  const result = await api(
    `/api/platform/organisations/${organisationId}/subscription${recheck ? "/recheck" : ""}`,
    recheck ? { method: "POST" } : {},
  );
  if (epoch !== state.authEpoch || organisationId !== org) return;
  data = result;
  resetPayment();
  message("");
  renderPlan();
}
function renderPlan() {
  const subscribed = data.entitled || data.legacyAccess;
  const amountPaise=data.plan?.amountPaise??config.plan?.amountPaise,price=money(amountPaise);
  const pendingPriceReview=Boolean(data.pendingOrder?.providerOrderId&&data.pendingOrder.amountPaise!==amountPaise);
  const canPay=Number.isSafeInteger(amountPaise)&&amountPaise>=100&&!pendingPriceReview;
  page(
    "More calm. Every month.",
    "One simple plan for your PG workspaces.",
    `<div class="royal-plan"><span class="plan-name">PGOne</span><div class="plan-price">${esc(price)}<small>/ month</small></div><p>One-time payment · one calendar month · no auto-debit</p><ul><li>${icon("check")}Rooms & residents</li><li>${icon("check")}Rent records & receipts</li><li>${icon("check")}Owner-approved team access</li></ul></div>${notice(subscribed ? (data.legacyAccess ? "Your existing workspace access is preserved." : "Your access is active for the confirmed paid period.") : `Make a fresh ${price} payment to activate one calendar month of PGOne.`)}${data.accessEnd ? `<p class="legal-copy">Access until ${date(data.accessEnd)}. An early renewal adds a month after this date.</p>` : ""}${!data.legacyAccess && canPay && config.customWebBilling?.enabled && data.mode === "MANUAL_MONTHLY" ? `<form data-form="prepare" novalidate><div class="form-error" role="alert"></div>${field("email", "Payment contact email", { type: "email", required: true, value: account.email || "", attrs: 'autocomplete="email"' })}<label class="billing-consent"><input name="consent" type="checkbox" required><span>I agree to pay ${esc(price)} once for one calendar month, including applicable tax. Each renewal needs a fresh payment. No recurring mandate or automatic debit.</span></label>${button(subscribed ? `Renew for ${price}` : `Pay ${price} for one month`, { type: "submit", kind: "primary block" })}</form><div data-payment-apps></div>` : pendingPriceReview ? notice(`Your earlier ${money(data.pendingOrder.amountPaise)} payment needs confirmation before a new ${price} payment. Refresh its status before paying again.`) : !subscribed ? notice("Monthly payments are awaiting merchant configuration. No payment will be initiated.") : ""}${button("Refresh payment status", { action: "refresh", kind: "secondary block" })}${data.legacySubscription?.provider && !data.legacySubscription.cancelAtPeriodEnd ? button("Cancel previous auto-renewal", { action: "cancel", kind: "text-button" }) : ""}<p class="legal-copy">Payments use Razorpay’s official Custom SDK and your UPI app. PGOne never asks for your UPI PIN or card details.</p>${data.subscription?.payments?.length ? `<h2 class="royal-section-title">Payment records</h2>${data.subscription.payments.map((p) => `<div class="billing-record"><strong>₹${(p.amountPaise / 100).toFixed(2)}</strong><span>${date(p.paidAt)} · ${esc(p.receiptNumber)}</span>${p.refundedPaise ? `<small>Refunded ₹${(p.refundedPaise / 100).toFixed(2)}</small>` : `<small>Access ${date(p.periodStart)} – ${date(p.periodEnd)}</small>`}</div>`).join("")}` : ""}`,
  );
}
async function prepare(values) {
  const epoch = state.authEpoch,
    organisationId = org;
  const current = () => {
    if (epoch !== state.authEpoch || organisationId !== org || !state.tokens)
      throw new Error(
        "This authorisation belongs to an earlier workspace. Sign in and review again.",
      );
  };
  const Razorpay = await loadCustomSdk();
  current();
  let paymentOrder;
  adapter = new CustomUpiPayment({
    Razorpay,
    keyId: config.customWebBilling.keyId,
    onSigned: async (response) => {
      if (state.authEpoch !== epoch) return;
      try {
        const result = await api(
          `/api/platform/organisations/${organisationId}/plan/orders/${paymentOrder.id}/verify`,
          {
            method: "POST",
            body: {
              paymentId: response.razorpay_payment_id,
              signature: response.razorpay_signature,
            },
          },
        );
        current();
        data = result;
        processing = false;
        renderPlan();
        message(
          data.entitled
            ? "Your monthly payment is verified."
            : "Payment is still being verified; refresh status shortly. No extra payment is needed.",
        );
      } catch (error) {
        message(error.message);
      }
    },
    onUncertain: message,
  });
  apps = await adapter.availableApps();
  if (!apps.length)
    throw new Error(
      "UPI app launching is unavailable in this browser. Open this page in Chrome on your Android phone.",
    );
  current();
  const requestKey = crypto.randomUUID();
  authorisation = await api(
    `/api/platform/organisations/${organisationId}/plan/orders`,
    {
      method: "POST",
      body: { accepted: true, amountPaise: data.plan?.amountPaise??config.plan?.amountPaise, recurring: false, requestKey },
    },
  );
  current();
  if (!authorisation.payable) {
    await status();
    message("This payment is already processed. Review your access and receipt before starting another renewal.");
    return;
  }
  if(authorisation.amountPaise!==(data.plan?.amountPaise??config.plan?.amountPaise)){
    await status();
    message("An earlier payment has a different amount. Refresh its status before making another payment.");
    return;
  }
  paymentOrder = authorisation;
  authorisation.contact =
    account.contactPhone || "";
  authorisation.email = values.email;
  const container = root.querySelector("[data-payment-apps]");
  container.innerHTML = `<h2 class="royal-section-title">Choose your UPI app</h2>${apps.map(([id, name]) => button(name, { action: "authorise", kind: "primary block", attrs: `data-app="${id}"` })).join("")}`;
  root.querySelector('[data-form="prepare"]').hidden = true;
}
document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!form.matches("[data-form]")) return;
  event.preventDefault();
  if (form.dataset.busy || !validateForm(form)) return;
  const generation = flowGeneration;
  form.dataset.busy = "true";
  const submit = form.querySelector('[type="submit"]');
  const restoreBusy=busyButton(submit);
  try {
    const values = formValues(form);
    if (form.dataset.form === "email") {
      const result=await api("/api/platform/auth/login",{public:true,method:"POST",body:values});
      if(generation===flowGeneration)await session(result.tokens);
    }
    if (form.dataset.form === "prepare") await prepare(values);
  } catch (error) {
    if (form.isConnected) showFormError(form, error);
    else message(error.message);
  } finally {
    delete form.dataset.busy;
    restoreBusy();
  }
});
document.addEventListener("click", async (event) => {
  const b = event.target.closest("[data-action]");
  if (!b || b.disabled || b.dataset.busy) return;
  const action = b.dataset.action;
  b.dataset.busy = "true";
  const restoreBusy=busyButton(b);
  try {
    if (action === "toggle-password") {
      const input = document.getElementById(b.dataset.target);
      input.type = input.type === "password" ? "text" : "password";
      b.setAttribute(
        "aria-label",
        input.type === "text" ? "Hide password" : "Show password",
      );
      b.setAttribute("aria-pressed", String(input.type === "text"));
    }
    if (action === "logout") {
      state.authEpoch++;
      flowGeneration++;
      try {
        await api("/api/platform/logout", { method: "POST" });
      } finally {
        state.tokens = null;
        state.user = null;
        state.authEpoch++;
        resetPayment();
        login();
      }
    }
    if (action === "organisation") {
      org = b.dataset.id;
      state.authEpoch++;
      await status();
    }
    if (action === "refresh") await status(true);
    if (
      action === "cancel" &&
      window.confirm(
        "Cancel future renewals? Your confirmed paid period will remain available.",
      )
    ) {
      await api(`/api/platform/organisations/${org}/subscription/cancel`, {
        method: "POST",
      });
      await status();
    }
    if (action === "authorise" && !processing) {
      processing = true;
      adapter.pay({
        orderId: authorisation.orderId,
        amountPaise: authorisation.amountPaise,
        contact: authorisation.contact,
        email: authorisation.email,
        app: b.dataset.app,
      });
      root.querySelectorAll('[data-action="authorise"]').forEach((el) => {
        el.disabled = true;
      });
      message(
        "Complete this one-time payment in your UPI app, then refresh payment status here.",
      );
    }
  } catch (error) {
    message(error.message);
  } finally {
    delete b.dataset.busy;
    restoreBusy();
  }
});
try {
  config = await api("/api/platform/config?package=web", {
    public: true,
    timeout: 10000,
  });
  login();
} catch (error) {
  page(
    "We’ll be right back.",
    "The account service could not be reached.",
    notice(error.message),
  );
}
