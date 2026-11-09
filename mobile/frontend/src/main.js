import {
  state,
  currentPeriod,
  contextKey,
  periodQuery,
  matchesContext,
  ResourceCache,
} from "./core/state.js";
import { createApiClient, API_BASE } from "./core/api.js";
import { native } from "./core/native.js";
import { notificationRoute } from "./core/notification-routes.js";
import { PaymentController } from "./payments/controller.js";
import { shell, skeleton, errorState, button, esc } from "./components/ui.js";
import {
  clearErrors,
  showFormError,
  validateForm,
} from "./components/forms.js";
import { loginScreen, passwordScreen } from "./screens/auth.js";
import { ownerHomeScreen, studentHomeScreen } from "./screens/dashboards.js";
import {
  residentsScreen,
  residentScreen,
  residentFormScreen,
  resetPasswordScreen,
} from "./screens/residents.js";
import { roomsScreen, roomScreen, roomFormScreen } from "./screens/rooms.js";
import {
  duesScreen,
  invoiceScreen,
  invoicesScreen,
  paymentsScreen,
  manualPaymentScreen,
  invoiceChargesScreen,
} from "./screens/finances.js";
import {
  notificationsScreen,
  notificationFormScreen,
} from "./screens/notifications.js";
import {
  profileScreen,
  propertiesScreen,
  propertyFormScreen,
} from "./screens/profile.js";
import { paymentScreen } from "./screens/payment.js";
import {
  welcomeScreen,
  phoneScreen,
  otpScreen,
  chooseRoleScreen,
  setupProfileScreen,
  setupPropertyScreen,
  setupReadyScreen,
  workspacesScreen,
  joinWorkspaceScreen,
  linkAccountScreen,
  subscriptionScreen,
  merchantScreen,
  merchantProfileScreen,
  merchantBankScreen,
  invitationsScreen,
  staffScreen,
  legalScreen,
} from "./screens/platform.js";
import { onboarding, platformStart } from "./platform/client.js";
import { ownerActivationRoute, ownerHasPaidAccess } from "./platform/activation.js";

const routes = {
  welcome: [welcomeScreen, null],
  phone: [phoneScreen, null],
  otp: [otpScreen, null],
  legal: [legalScreen, null],
  chooseRole: [chooseRoleScreen, "PLATFORM"],
  setupProfile: [setupProfileScreen, "PLATFORM"],
  setupProperty: [setupPropertyScreen, "PLATFORM"],
  setupReady: [setupReadyScreen, "PLATFORM"],
  workspaces: [workspacesScreen, "PLATFORM"],
  joinWorkspace: [joinWorkspaceScreen, "PLATFORM"],
  linkAccount: [linkAccountScreen, "PLATFORM"],
  subscription: [subscriptionScreen, "PLATFORM"],
  merchant: [merchantScreen, "PLATFORM"],
  merchantProfile: [merchantProfileScreen, "PLATFORM"],
  merchantBank: [merchantBankScreen, "PLATFORM"],
  invitations: [invitationsScreen, "PLATFORM"],
  staffHome: [staffScreen, "PLATFORM"],
  login: [loginScreen, null],
  password: [passwordScreen, "BOTH"],
  ownerHome: [ownerHomeScreen, "OWNER"],
  residents: [residentsScreen, "OWNER"],
  resident: [residentScreen, "OWNER"],
  residentForm: [residentFormScreen, "OWNER"],
  resetPassword: [resetPasswordScreen, "OWNER"],
  rooms: [roomsScreen, "OWNER"],
  room: [roomScreen, "OWNER"],
  roomForm: [roomFormScreen, "OWNER"],
  dues: [duesScreen, "OWNER"],
  ownerPayments: [paymentsScreen, "OWNER"],
  manualPayment: [manualPaymentScreen, "OWNER"],
  invoiceCharges: [invoiceChargesScreen, "OWNER"],
  studentHome: [studentHomeScreen, "STUDENT"],
  invoices: [invoicesScreen, "STUDENT"],
  history: [paymentsScreen, "STUDENT"],
  payment: [paymentScreen, "STUDENT"],
  invoice: [invoiceScreen, "BOTH"],
  profile: [profileScreen, "BOTH"],
  notifications: [notificationsScreen, "BOTH"],
  notificationForm: [notificationFormScreen, "OWNER"],
  properties: [propertiesScreen, "OWNER"],
  propertyForm: [propertyFormScreen, "OWNER"],
};
const rootRoutes = new Set([
  "ownerHome",
  "residents",
  "rooms",
  "dues",
  "profile",
  "studentHome",
  "invoices",
  "history",
]);
const cache = new ResourceCache();
function applyMotionPreference() {
  document.body.classList.toggle(
    "reduced-motion",
    Boolean(native.call("prefersReducedMotion")),
  );
}
applyMotionPreference();
let sequence = 0,
  screen = null,
  dirty = false,
  depth = 0,
  dialogResolver = null,
  toastTimer,
  loadingTimer;
const submissions = new WeakSet();
let submittedForms = 0,
  submissionNavigationAllowed = false;
const home = () =>
  state.user?.role === "ACCOUNT"
    ? platformStart(state)
    : state.user?.role === "STAFF"
      ? "staffHome"
      : state.user?.role === "OWNER"
        ? "ownerHome"
        : "studentHome";
let pendingNotificationRoute = null;
let restoringMetadata = null;
function postAuthRoute() {
  if (state.user?.mustChangePassword) return "password";
  if (pendingNotificationRoute === null) return home();
  const target = notificationRoute(pendingNotificationRoute, state.user?.role);
  pendingNotificationRoute = null;
  return target;
}

function persist() {
  if (state.tokens && !state.user && restoringMetadata) {
    native.save({ ...restoringMetadata, tokens: state.tokens });
    return;
  }
  native.save(
    state.tokens
      ? {
          tokens: state.tokens,
          userId: state.user?.id,
          activePropertyId: state.property?.id,
          period: state.period,
          pendingPayment: state.pendingPayment,
          onboardingDraft: state.onboardingDraft,
        }
      : null,
  );
}
function toast(message, type = "") {
  clearTimeout(toastTimer);
  const root = document.getElementById("toasts");
  root.innerHTML = `<div class="toast ${type === "error" ? "error" : ""}">${esc(message)}</div>`;
  toastTimer = setTimeout(
    () => {
      root.innerHTML = "";
    },
    type === "error" ? 7000 : 4500,
  );
}

function clearSession() {
  restoringMetadata = null;
  state.authEpoch++;
  payment.stop();
  cache.clear();
  Object.assign(state, {
    tokens: null,
    user: null,
    property: null,
    properties: [],
    student: null,
    platform: null,
    onboardingDraft: null,
    pendingPayment: null,
    period: currentPeriod(),
  });
  dirty = false;
  onboarding.propertyKey = null;
  onboarding.attempt = "";
  onboarding.exchangeAttempt = "";
  onboarding.sentAt = 0;
  native.call("cancelPhoneSignIn");
  try {
    native.save(null);
  } catch {
    /* Local session is cleared even if a damaged vault cannot be written. */
  }
}

const api = createApiClient({
  getState: () => state,
  saveTokens: async (tokens) => {
    state.tokens = tokens;
    persist();
  },
  onExpired: () => {
    const phone = state.tokens?.kind === "PLATFORM";
    clearSession();
    toast("Your session expired. Please sign in again.", "error");
    void navigate(phone ? "phone" : "login", phone ? { mode: "SIGN_IN" } : {}, { replace: true, force: true });
  },
});

const payment = new PaymentController({
  api,
  getPending: () => state.pendingPayment,
  setPending: async (value) => {
    state.pendingPayment = value;
    persist();
  },
  onSettled: () => cache.clear(),
});

function confirm({
  title,
  message,
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  danger = false,
  onlyConfirm = false,
}) {
  if (dialogResolver) dialogResolver(false);
  const previousFocus = document.activeElement;
  const root = document.getElementById("dialogs");
  root.innerHTML = `<div class="dialog-backdrop"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-description" tabindex="-1"><div class="dialog-header"><h2 id="dialog-title">${esc(title)}</h2></div><p class="dialog-body" id="dialog-description">${esc(message)}</p><div class="dialog-actions">${onlyConfirm ? "" : button(cancelLabel, { action: "dialog-cancel", kind: "secondary" })}${button(confirmLabel, { action: "dialog-confirm", kind: danger ? "danger" : "primary" })}</div></div></div>`;
  document.body.classList.add("dialog-open");
  root.querySelector(".dialog").focus();
  return new Promise((resolve) => {
    dialogResolver = (value) => {
      root.innerHTML = "";
      document.body.classList.remove("dialog-open");
      dialogResolver = null;
      previousFocus?.isConnected && previousFocus.focus();
      resolve(value);
    };
  });
}

async function canLeave() {
  if (submittedForms && !submissionNavigationAllowed) {
    toast("Please wait for the current request to finish.");
    return false;
  }
  if (!dirty) return true;
  return confirm({
    title: "Leave without saving?",
    message: "Your entered details will be lost.",
    confirmLabel: "Leave page",
    cancelLabel: "Keep editing",
    danger: true,
  });
}

function guardedRoute(name) {
  if (!state.tokens || !state.user)
    return routes[name]?.[1] === null ? name : "welcome";
  if (routes[name]?.[1] === "PLATFORM") {
    if (state.tokens.kind !== "PLATFORM") return home();
    const ownerOnly = ["subscription", "merchant", "merchantProfile", "merchantBank"];
    if (ownerOnly.includes(name) && state.user.role !== "OWNER") return home();
    // Merchant setup follows verified subscription activation; it cannot be
    // used to bypass the owner's paid workspace boundary.
    if (name.startsWith("merchant") && !ownerHasPaidAccess(state))
      return "subscription";
    return name;
  }
  if (
    state.tokens.kind === "PLATFORM" &&
    ["ACCOUNT", "STAFF"].includes(state.user.role)
  )
    return home();
  if (state.user.mustChangePassword) return "password";
  const role = routes[name]?.[1];
  if (
    !routes[name] ||
    role === null ||
    (role !== "BOTH" && role !== state.user.role)
  )
    return home();
  if (
    state.user.role === "OWNER" &&
    !state.property &&
    !["properties", "propertyForm", "password", "profile"].includes(name)
  )
    return "properties";
  return ownerActivationRoute(state, name);
}

async function navigate(
  name,
  params = {},
  { replace = false, force = false } = {},
) {
  const next = guardedRoute(name);
  if (
    !force &&
    next === state.route.name &&
    JSON.stringify(params) === JSON.stringify(state.route.params)
  )
    return;
  if (!force && !(await canLeave())) return;
  if (
    ["phone", "otp"].includes(state.route.name) &&
    !["phone", "otp"].includes(next)
  ) {
    onboarding.attempt = "";
    onboarding.exchangeAttempt = "";
    native.call("cancelPhoneSignIn");
  }
  if (rootRoutes.has(next) && rootRoutes.has(state.route.name)) replace = true;
  dirty = false;
  state.route = { name: next, params: next === name ? params : {} };
  if (!replace) depth++;
  const record = { safehouse: true, ...state.route, depth };
  history[replace ? "replaceState" : "pushState"](record, "", `#${next}`);
  await render();
}

async function back() {
  if (dialogResolver) {
    dialogResolver(false);
    return;
  }
  if (!(await canLeave())) return;
  dirty = false;
  if (depth > 0) history.back();
  else if (state.tokens && state.route.name !== home())
    await navigate(home(), {}, { replace: true, force: true });
}

window.SafeHouseBack = () => {
  if (
    dialogResolver ||
    dirty ||
    submittedForms ||
    depth > 0 ||
    (state.tokens && state.route.name !== home())
  ) {
    void back();
    return true;
  }
  return false;
};

window.addEventListener("popstate", async (event) => {
  if (!(await canLeave())) {
    history.pushState(
      { safehouse: true, ...state.route, depth },
      "",
      `#${state.route.name}`,
    );
    return;
  }
  dirty = false;
  const requested = event.state || {};
  const name = guardedRoute(requested.name);
  depth = Math.max(0, Number(requested.depth) || 0);
  state.route = {
    name,
    params: name === requested.name ? requested.params || {} : {},
  };
  history.replaceState(
    { safehouse: true, ...state.route, depth },
    "",
    `#${name}`,
  );
  await render();
});

async function signIn(email, password) {
  const result = await api("/api/auth/login", {
    method: "POST",
    public: true,
    body: { email, password },
  });
  if (
    !["OWNER", "STUDENT"].includes(result.user?.role) ||
    !result.tokens?.accessToken ||
    !result.tokens?.refreshToken
  )
    throw new Error("The server returned an invalid account response.");
  state.authEpoch++;
  cache.clear();
  Object.assign(state, {
    tokens: result.tokens,
    user: result.user,
    property: result.property || null,
    properties: result.properties || [],
    student: result.student || null,
    pendingPayment: null,
  });
  state.period = currentPeriod(state.property?.timezone);
  try {
    persist();
  } catch (error) {
    clearSession();
    throw error;
  }
  dirty = false;
  await navigate(postAuthRoute(), {}, { replace: true, force: true });
  void setupPush().catch(() => {});
}

async function refreshPlatform() {
  const result = await api("/api/platform/session");
  state.platform = result;
  state.user = result.user;
  state.property = result.property;
  state.student = result.student;
  state.properties = result.memberships
    .filter((m) => m.role === "OWNER")
    .map((m) => m.property);
  persist();
  return result;
}
async function acceptPlatform(tokens, target) {
  if (
    tokens?.kind !== "PLATFORM" ||
    !tokens.accessToken ||
    !tokens.refreshToken
  )
    throw new Error("Account verification was not completed.");
  state.authEpoch++;
  cache.clear();
  state.tokens = tokens;
  state.pendingPayment = null;
  await refreshPlatform();
  state.period = currentPeriod(state.property?.timezone);
  dirty = false;
  persist();
  await navigate(
    target || (state.platform.membershipId ? home() : platformStart(state)),
    {},
    { replace: true, force: true },
  );
}
async function selectWorkspace(membershipId, target) {
  if (state.pendingPayment)
    throw new Error(
      "Check your pending rent payment before switching workspace.",
    );
  const result = await api("/api/platform/workspace", {
    method: "POST",
    body: { membershipId },
  });
  await acceptPlatform(result.tokens, target);
}
window.PGOnePhoneEvent = async (attempt, type, value) => {
  if (
    attempt !== onboarding.attempt ||
    !["phone", "otp"].includes(state.route.name)
  )
    return;
  if (type === "sent") onboarding.sentAt = Date.now();
  screen?.phoneEvent?.(type, value);
  if (type === "verified") {
    const epoch = state.authEpoch;
    onboarding.exchangeAttempt = attempt;
    onboarding.attempt = "";
    onboarding.sentAt = 0;
    const current = () =>
      onboarding.exchangeAttempt === attempt && !onboarding.attempt &&
      state.authEpoch === epoch && ["phone", "otp"].includes(state.route.name);
    let tokens;
    try {
      let result;
      try {
        result = await api("/api/platform/phone", {
          public: true,
          method: "POST",
          body: { idToken: value, mode: onboarding.authMode },
        });
      } catch (error) {
        if (!current()) return;
        if (error.code !== "PHONE_ACCOUNT_NOT_FOUND") throw error;
        const create = await confirm({
          title: "Create a PGOne account?",
          message:
            "Your number is verified, but it has no PGOne phone account yet. Create one to set up or join a PG. Existing password accounts can be linked after signing in with email.",
          confirmLabel: "Create account",
          cancelLabel: "Back to sign in",
        });
        if (!current()) return;
        if (!create) {
          await navigate("phone", { mode: "SIGN_IN" }, { replace: true, force: true });
          return;
        }
        onboarding.authMode = "SIGN_UP";
        result = await api("/api/platform/phone", {
          public: true,
          method: "POST",
          body: { idToken: value, mode: "SIGN_UP" },
        });
      }
      if (!current()) return;
      tokens = result.tokens;
    } catch (error) {
      if (!current()) return;
      toast(error.message, "error");
      await navigate("phone", {}, { replace: true, force: true });
      return;
    }
    try {
      await acceptPlatform(tokens);
    } catch (error) {
      if (state.tokens?.accessToken !== tokens?.accessToken) return;
      clearSession();
      toast(error.message, "error");
      await navigate("phone", { mode: "SIGN_IN" }, { replace: true, force: true });
    }
  }
};

async function logout() {
  if (
    !(await confirm({
      title: "Sign out of PGOne?",
      message: "You can sign back in securely whenever you need.",
      confirmLabel: "Sign out",
    }))
  )
    return;
  const phone = state.tokens?.kind === "PLATFORM";
  const logoutEpoch = state.authEpoch;
  let revoked = true;
  const installationId = native.call("getNotificationInstallationId");
  if (installationId)
    try {
      await api("/api/notifications/devices/unregister", {
        method: "POST",
        body: { installationId },
        timeout: 8000,
      });
    } catch {
      /* Logout still revokes this user's server credentials. */
    }
  try {
    await api(
      state.tokens?.kind === "PLATFORM"
        ? "/api/platform/logout"
        : "/api/auth/logout",
      { method: "POST", timeout: 10000 },
    );
  } catch {
    revoked = false;
  }
  if (state.authEpoch !== logoutEpoch) return;
  clearSession();
  await navigate(phone ? "phone" : "login", phone ? { mode: "SIGN_IN" } : {}, { replace: true, force: true });
  if (!revoked)
    toast(
      "Signed out on this device. Server session revocation could not be confirmed.",
      "error",
    );
}

async function setupPush(requestPermission = false) {
  if (!state.tokens || !native.has("configureNotifications")) return;
  const epoch = state.authEpoch;
  const config = await api("/api/notifications/config");
  if (epoch !== state.authEpoch || !config.clientEnabled || !config.firebase)
    return;
  native.call("configureNotifications", JSON.stringify(config.firebase));
  if (requestPermission) native.call("requestNotificationPermission");
  const installationId = native.call("getNotificationInstallationId");
  if (
    installationId &&
    native.call("notificationPermissionStatus") === "granted"
  )
    await api("/api/notifications/devices/register", {
      method: "POST",
      body: { installationId, platform: "ANDROID", appVersion: "5.1.0" },
    });
}

window.SafeHouseNotificationRegistration = async (installationId) => {
  if (
    state.tokens &&
    typeof installationId === "string" &&
    installationId.length >= 8
  ) {
    try {
      await api("/api/notifications/devices/register", {
        method: "POST",
        body: { installationId, platform: "ANDROID", appVersion: "5.1.0" },
      });
    } catch {
      /* Notification screen provides configuration and retry state. */
    }
  }
};
window.SafeHouseNotificationPermissionResult = (result) => {
  toast(
    result === "granted"
      ? "Notifications allowed."
      : result === "denied"
        ? "Notifications are disabled. You can enable them in Android settings."
        : "Device registration is temporarily unavailable.",
  );
  if (result === "granted")
    void setupPush().catch(() =>
      toast(
        "Device registration could not be confirmed. Try again from notifications.",
        "error",
      ),
    );
};
window.SafeHouseNotificationOpened = (route) => {
  pendingNotificationRoute = typeof route === "string" ? route : "studentHome";
  if (state.tokens && state.user)
    void navigate(postAuthRoute(), {}, { replace: true });
};
window.SafeHouseUpiError = (message) => {
  const text =
    message ||
    "The UPI app could not open. Save the QR and scan it from your UPI app gallery.";
  if (screen?.upiResult) screen.upiResult(text);
  else toast(text, "error");
};
window.SafeHouseUpiOpened = () => screen?.upiResult?.();
// A native callback is never payment evidence. QR status must reconcile server-side.
window.SafeHousePaymentSuccess = () => void payment.resume();
window.SafeHousePaymentError = () => {
  toast("Check payment status before trying again.");
  void payment.resume();
};
window.SafeHouseResume = () => {
  applyMotionPreference();
  if (screen?.paymentFlow) void payment.resume();
  else if (state.tokens && state.user && !dirty && !submittedForms) {
    cache.clear();
    void render();
  }
};

async function receipt(id, receiptNumber) {
  if (!id) return;
  // Refresh expired access credentials before delegating a download to Android.
  await api("/api/auth/me");
  const role = state.user.role === "OWNER" ? "owner" : "student";
  const path = `/api/${role}/payments/${encodeURIComponent(id)}/receipt.pdf`;
  const filename = `PGOne-${String(receiptNumber || id).replace(/[^a-zA-Z0-9_-]/g, "")}.pdf`;
  if (native.has("downloadReceipt"))
    native.call(
      "downloadReceipt",
      API_BASE + path,
      state.tokens.accessToken,
      role === "owner" ? state.property?.id || "" : "",
      filename,
    );
  else {
    const blob = await api(path, { response: "blob" });
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast("Receipt download requested.");
  }
}

function makeContext(snapshot, key) {
  const scopedApi = async (path, options) => {
    if (contextKey() !== key)
      throw Object.assign(
        new Error("This request belongs to an earlier account or property."),
        { code: "STALE_CONTEXT" },
      );
    const data = await api(path, options);
    if (
      contextKey() !== key ||
      (!path.startsWith("/api/platform/") && !matchesContext(data, snapshot))
    )
      throw Object.assign(
        new Error(
          "The response does not match the selected property and billing month. Please refresh.",
        ),
        { code: "STALE_CONTEXT" },
      );
    return data;
  };
  return {
    snapshot,
    params: state.route.params,
    periodQuery: periodQuery(snapshot.period),
    api: scopedApi,
    read: (path) => cache.get(`${key}:${path}`, () => scopedApi(path)),
    navigate,
    back,
    toast,
    confirm,
    native,
    payment,
    signIn,
    refreshPlatform,
    acceptPlatform,
    selectWorkspace,
    saveOnboardingDraft: (value) => {
      if (contextKey() !== key)
        throw new Error("Your account context changed.");
      state.onboardingDraft = value
        ? { ...value, accountId: state.platform.account.id }
        : null;
      persist();
    },
    refreshPaidAccess: async () => {
      // Re-read the signed-in workspace and its server-computed entitlement.
      await refreshPlatform();
      return ownerHasPaidAccess(state);
    },
    enablePlatform: async () => {
      if (state.pendingPayment)
        throw new Error(
          "Check your pending rent payment before linking workspaces.",
        );
      const result = await api("/api/platform/link-legacy", {
        method: "POST",
        body: { legacyAccessToken: state.tokens.accessToken },
      });
      await acceptPlatform(result.tokens);
    },
    setupPush,
    invalidate: () => cache.clear(),
    markSaved: () => {
      dirty = false;
      submissionNavigationAllowed = true;
    },
    reload: async () => {
      if (await canLeave()) {
        dirty = false;
        cache.clear();
        await render();
      }
    },
    openExternal: (url) => native.openExternal(url),
    selectProperty: async (property, properties) => {
      if (state.tokens?.kind === "PLATFORM") {
        const member = state.platform.memberships.find(
          (m) => m.role === "OWNER" && m.property.id === property.id,
        );
        if (!member) throw new Error("Choose an authorised workspace.");
        return selectWorkspace(member.id);
      }
      state.property = property;
      state.properties = properties;
      state.period = currentPeriod(property.timezone);
      state.pendingPayment = null;
      cache.clear();
      persist();
      dirty = false;
      return navigate("ownerHome", {}, { replace: true, force: true });
    },
    updatePasswordSession: async (tokens) => {
      if (!tokens?.accessToken || !tokens?.refreshToken)
        throw new Error(
          "Password changed, but a new session was not returned. Sign in again.",
        );
      state.tokens = tokens;
      state.user = { ...state.user, mustChangePassword: false };
      cache.clear();
      dirty = false;
      persist();
      await navigate(postAuthRoute(), {}, { replace: true, force: true });
    },
  };
}

async function render() {
  const seq = ++sequence;
  screen?.unmount?.();
  screen = null;
  clearTimeout(loadingTimer);
  const snapshot = {
      ...state,
      period: { ...state.period },
      route: { ...state.route },
    },
    key = contextKey(snapshot);
  const ctx = makeContext(snapshot, key);
  const nav = snapshot.user?.role === "OWNER" ? "ownerHome" : "studentHome";
  loadingTimer = setTimeout(() => {
    if (seq !== sequence) return;
    document.getElementById("app").innerHTML = shell(
      { title: "Loading", content: skeleton(state.route.name), nav },
      snapshot,
    );
  }, 130);
  document.body.insertAdjacentHTML(
    "beforeend",
    '<div class="page-progress" aria-hidden="true"></div>',
  );
  try {
    const next = await routes[state.route.name][0](ctx);
    if (seq !== sequence || contextKey() !== key) return;
    clearTimeout(loadingTimer);
    screen = next;
    document.getElementById("app").innerHTML = shell(next, snapshot);
    document.getElementById("app").dataset.screen = state.route.name;
    document.title = `${next.title || "PGOne"} · PGOne`;
    window.scrollTo(0, 0);
    document.getElementById("main")?.focus({ preventScroll: true });
    screen.mount?.();
    native.call("ready");
  } catch (error) {
    if (seq !== sequence || contextKey() !== key) return;
    clearTimeout(loadingTimer);
    screen = {
      title: "Page unavailable",
      content: errorState(error.message),
      back: true,
      nav,
    };
    document.getElementById("app").innerHTML = shell(screen, snapshot);
    document.getElementById("app").dataset.screen = state.route.name;
    native.call("ready");
  } finally {
    if (seq === sequence)
      document.querySelectorAll(".page-progress").forEach((el) => el.remove());
  }
}

document.addEventListener("click", async (event) => {
  const element = event.target.closest("button");
  if (!element || element.disabled) return;
  const action = element.dataset.action;
  if (action === "dialog-confirm" || action === "dialog-cancel") {
    dialogResolver?.(action === "dialog-confirm");
    return;
  }
  if (dialogResolver) return;
  if (element.dataset.route) {
    event.preventDefault();
    let params = {};
    try {
      params = JSON.parse(element.dataset.params || "{}");
    } catch {
      return;
    }
    await navigate(element.dataset.route, params);
    return;
  }
  if (!action) return;
  event.preventDefault();
  try {
    if (action === "back") return await back();
    if (action === "reload") {
      if (await canLeave()) {
        dirty = false;
        cache.clear();
        await render();
      }
      return;
    }
    if (action === "logout") return await logout();
    if (action === "toggle-password") {
      const input = document.getElementById(element.dataset.target);
      if (!input) return;
      input.type = input.type === "password" ? "text" : "password";
      element.setAttribute("aria-pressed", String(input.type === "text"));
      element.setAttribute(
        "aria-label",
        input.type === "text" ? "Hide password" : "Show password",
      );
      return;
    }
    if (action === "scroll-section") {
      document.getElementById(element.dataset.target)?.scrollIntoView({
        behavior:
          document.body.classList.contains("reduced-motion") ||
          matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        block: "start",
      });
      return;
    }
    if (action === "period") {
      const d = new Date(
        Date.UTC(
          state.period.year,
          state.period.month - 1 + Number(element.dataset.delta),
          1,
        ),
      );
      if (d.getUTCFullYear() < 2020 || d.getUTCFullYear() > 2100) return;
      state.period = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
      cache.clear();
      persist();
      await render();
      return;
    }
    if (action === "receipt")
      return await receipt(element.dataset.id, element.dataset.number);
    if (element.dataset.busy) return;
    const restoreFocus = document.activeElement === element;
    element.dataset.busy = "true";
    element.disabled = true;
    try {
      await screen?.action?.(action, element, event);
    } finally {
      delete element.dataset.busy;
      element.disabled = false;
      if (
        restoreFocus &&
        element.isConnected &&
        document.activeElement === document.body
      )
        element.focus({ preventScroll: true });
    }
  } catch (error) {
    toast(error.message, "error");
  }
});

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!form.matches("[data-form]")) return;
  event.preventDefault();
  if (submissions.has(form) || form.dataset.uncertain || !screen) return;
  if (!validateForm(form)) return;
  const activeScreen = screen;
  const submit = form.querySelector('[type="submit"]');
  const original = submit?.innerHTML;
  const mutation = form.dataset.form !== "search";
  submissions.add(form);
  if (mutation) submittedForms++;
  if (submit) {
    submit.disabled = true;
    submit.innerHTML =
      '<span class="spinner" aria-hidden="true"></span><span>Please wait…</span>';
  }
  try {
    await activeScreen.submit?.(form.dataset.form, form);
  } catch (error) {
    if (form.isConnected) {
      showFormError(form, error);
      if (
        error.uncertain &&
        !["login", "password", "reset"].includes(form.dataset.form)
      ) {
        form.dataset.uncertain = "true";
        const summary = form.querySelector(".form-error");
        if (summary)
          summary.textContent = activeScreen.financialMutation
            ? "The response was interrupted. This payment may already be recorded. Check payment history before taking another payment action."
            : "The response was interrupted. Your changes may already be saved. Check the relevant list before trying again.";
        form.insertAdjacentHTML(
          "beforeend",
          button(
            activeScreen.financialMutation
              ? "Check payment history"
              : "Check saved records",
            {
              route: activeScreen.financialMutation
                ? "ownerPayments"
                : state.user?.role === "OWNER"
                  ? "ownerHome"
                  : "studentHome",
              kind: "secondary block",
            },
          ),
        );
      }
    } else if (state.tokens) toast(error.message, "error");
  } finally {
    if (mutation) submittedForms--;
    submissionNavigationAllowed = false;
    submissions.delete(form);
    if (submit && !form.dataset.uncertain) {
      submit.disabled = false;
      submit.innerHTML = original;
    }
  }
});

for (const name of ["input", "change"])
  document.addEventListener(name, (event) => {
    const el = event.target,
      form = el.closest("form");
    if (!form) return;
    if (screen?.guardForm && form.dataset.form !== "search") dirty = true;
    if (name === "input") {
      el.removeAttribute("aria-invalid");
      const error = document.getElementById(`field-${el.name}-error`);
      if (error) error.textContent = "";
    }
    screen?.[name]?.(el.name, el, form);
  });
document.addEventListener(
  "load",
  (event) => {
    if (event.target.matches?.("[data-payment-qr]"))
      payment.imageLoaded(event.target.dataset.paymentQr);
  },
  true,
);
document.addEventListener(
  "error",
  (event) => {
    if (event.target.matches?.("[data-payment-qr]"))
      payment.imageFailed(event.target.dataset.paymentQr);
  },
  true,
);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && dialogResolver) {
    event.preventDefault();
    dialogResolver(false);
  }
  if (event.key === "Tab" && dialogResolver) {
    const buttons = [...document.querySelectorAll(".dialog button")];
    if (!buttons.length) return;
    const first = buttons[0],
      last = buttons[buttons.length - 1];
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        document.activeElement.classList.contains("dialog"))
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});
window.addEventListener("beforeunload", (event) => {
  if (dirty || submittedForms) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("online", () => {
  if (screen?.paymentFlow) void payment.resume();
});
let activationRefreshInFlight = false;
async function revalidateOwnerActivation() {
  if (activationRefreshInFlight || dirty || submittedForms ||
      !state.tokens || state.tokens.kind !== "PLATFORM" ||
      state.user?.role !== "OWNER" || !state.platform?.membershipId) return;
  activationRefreshInFlight = true;
  try {
    const previouslyPaid = ownerHasPaidAccess(state);
    await refreshPlatform(); // Backend calculates entitlements from captured payments.
    if (!ownerHasPaidAccess(state)) {
      // Expired/refunded access also revokes an already-open dashboard.
      if (guardedRoute(state.route.name) !== state.route.name)
        await navigate("subscription", {}, { replace: true, force: true });
    } else if (!previouslyPaid && state.route.name === "subscription") {
      await navigate("setupReady", {}, { replace: true, force: true });
    }
  } catch {
    // Do not invent activation on a network failure. Owner APIs remain gated.
  } finally {
    activationRefreshInFlight = false;
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  if (screen?.paymentFlow) void payment.resume();
  void revalidateOwnerActivation();
});
let nativeKeyboardOpen = false,
  keyboardFrame;
function revealFocusedField() {
  cancelAnimationFrame(keyboardFrame);
  keyboardFrame = requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const field = document.activeElement;
      if (
        document.body.classList.contains("keyboard-open") &&
        /^(INPUT|TEXTAREA|SELECT)$/.test(field?.tagName)
      ) {
        field.scrollIntoView({ block: "center", behavior: "auto" });
      }
    }),
  );
}
const updateKeyboard = () => {
  const focused = /^(INPUT|TEXTAREA|SELECT)$/.test(
    document.activeElement?.tagName,
  );
  if (focused && document.body.classList.contains("keyboard-open"))
    revealFocusedField();
  document.body.classList.toggle(
    "keyboard-open",
    nativeKeyboardOpen ||
      (focused &&
        (window.visualViewport?.height || innerHeight) < innerHeight * 0.8),
  );
};
window.SafeHouseKeyboard = (open) => {
  nativeKeyboardOpen = !!open;
  updateKeyboard();
};
window.visualViewport?.addEventListener("resize", updateKeyboard);
document.addEventListener("focusin", revealFocusedField);
document.addEventListener("focusout", () => {
  document.body.classList.remove("keyboard-open");
});

async function boot() {
  const stored = native.load();
  if (stored?.tokens?.accessToken && stored.tokens.refreshToken) {
    const restoreEpoch = state.authEpoch;
    restoringMetadata = stored;
    state.tokens = stored.tokens;
    document.getElementById("app").innerHTML =
      `<main class="boot session-restore" role="status"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M5 30.1 30.1 8.3a7.5 7.5 0 0 1 9.8 0L59 24.8v11.1L35 15.7 15.2 32.8V59H5Z" fill="#0B2148"/><path d="M15.2 33 35 15.7l24 20.2V52a7 7 0 0 1-7 7H41V45h4V37.5c0-4.9-3.6-8.2-8.8-8.2H31V59H15.2Z" fill="#2056EF"/><path d="M31 29.3h5.2c5.2 0 8.8 3.3 8.8 8.2V45h-4V39c0-2.2-1.5-3.8-3.8-3.8H31Z" fill="#0B2148"/><path d="M23 59V37.2l8-7.9V59Z" fill="#FFF"/><rect x="30.3" y="21.3" width="4" height="4" rx=".7" fill="white"/><rect x="36.2" y="21.3" width="4" height="4" rx=".7" fill="white"/></svg><span>PGOne</span><p>Restoring your account…</p><span class="spinner" aria-hidden="true"></span></main>`;
    requestAnimationFrame(() => native.call("ready"));
    try {
      const platform = state.tokens.kind === "PLATFORM";
      const me = await api(platform ? "/api/platform/session" : "/api/auth/me");
      if (state.authEpoch !== restoreEpoch) return;
      if (
        !(
          platform
            ? ["OWNER", "STUDENT", "STAFF", "ACCOUNT"]
            : ["OWNER", "STUDENT"]
        ).includes(me.user?.role)
      )
        throw new Error("Invalid account.");
      state.user = me.user;
      state.platform = platform ? me : null;
      if (
        platform &&
        stored.onboardingDraft?.accountId === me.account.id &&
        /^[a-zA-Z0-9_-]{16,100}$/.test(stored.onboardingDraft.key || "")
      )
        state.onboardingDraft = stored.onboardingDraft;
      state.properties = platform
        ? me.memberships
            .filter((m) => m.role === "OWNER")
            .map((m) => m.property)
        : me.properties || [];
      state.student = me.student || null;
      state.property =
        (!platform &&
          state.properties.find((p) => p.id === stored.activePropertyId)) ||
        me.property ||
        null;
      state.period =
        stored.period &&
        Number.isInteger(stored.period.year) &&
        stored.period.year >= 2020 &&
        stored.period.year <= 2100 &&
        Number.isInteger(stored.period.month) &&
        stored.period.month >= 1 &&
        stored.period.month <= 12
          ? stored.period
          : currentPeriod(state.property?.timezone);
      state.pendingPayment =
        stored.userId === me.user.id ? stored.pendingPayment || null : null;
      persist();
      restoringMetadata = null;
      state.route = { name: guardedRoute(postAuthRoute()), params: {} };
    } catch (error) {
      if (state.authEpoch !== restoreEpoch) return;
      if (error.status === 401 || !state.tokens) clearSession();
      else {
        // Preserve a valid encrypted session during an outage; never delete it on a timeout.
        document.getElementById("app").innerHTML = shell(
          {
            bare: true,
            content: `<main class="login-page"><div class="login-inner">${errorState("Could not restore your session. Check your connection and retry.")}<button class="button secondary block" id="restore-signout">Sign in again</button></div></main>`,
          },
          state,
        );
        const retry = document.querySelector('[data-action="reload"]');
        retry.removeAttribute("data-action");
        retry.addEventListener("click", () => void boot());
        document
          .getElementById("restore-signout")
          .addEventListener("click", () => {
            clearSession();
            void boot();
          });
        native.call("ready");
        return;
      }
    }
  }
  history.replaceState(
    { safehouse: true, ...state.route, depth: 0 },
    "",
    `#${state.route.name}`,
  );
  await render();
  if (state.tokens) void setupPush().catch(() => {});
}
void boot();
