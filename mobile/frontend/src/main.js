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

const routes = {
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
const home = () => (state.user?.role === "OWNER" ? "ownerHome" : "studentHome");

function persist() {
  native.save(
    state.tokens
      ? {
          tokens: state.tokens,
          userId: state.user?.id,
          activePropertyId: state.property?.id,
          period: state.period,
          pendingPayment: state.pendingPayment,
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
  state.authEpoch++;
  payment.stop();
  cache.clear();
  Object.assign(state, {
    tokens: null,
    user: null,
    property: null,
    properties: [],
    student: null,
    pendingPayment: null,
    period: currentPeriod(),
  });
  dirty = false;
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
    clearSession();
    toast("Your session expired. Please sign in again.", "error");
    void navigate("login", {}, { replace: true, force: true });
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
  if (!state.tokens || !state.user) return "login";
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
  return name;
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
  await navigate(
    result.user.mustChangePassword ? "password" : home(),
    {},
    { replace: true, force: true },
  );
  void setupPush().catch(() => {});
}

async function logout() {
  if (
    !(await confirm({
      title: "Sign out of SafeHouse?",
      message: "You can sign back in with your email and password.",
      confirmLabel: "Sign out",
    }))
  )
    return;
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
    await api("/api/auth/logout", { method: "POST", timeout: 10000 });
  } catch {
    revoked = false;
  }
  if (state.authEpoch !== logoutEpoch) return;
  clearSession();
  await navigate("login", {}, { replace: true, force: true });
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
      body: { installationId, platform: "ANDROID", appVersion: "5.0.0" },
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
        body: { installationId, platform: "ANDROID", appVersion: "5.0.0" },
      });
    } catch {
      /* Notification screen provides configuration and retry state. */
    }
  }
};
window.SafeHouseNotificationPermissionResult = (result) => {
  toast(
    result === "granted"
      ? "Notifications allowed. Registering this device…"
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
window.SafeHouseNotificationOpened = () => {
  if (state.tokens)
    void navigate(
      state.user?.role === "OWNER" ? "notifications" : "studentHome",
    );
};
window.SafeHouseUpiError = (message) =>
  toast(
    message ||
      "The UPI app could not open. Save the QR and scan it from your UPI app instead.",
    "error",
  );
// A native callback is never payment evidence. QR status must reconcile server-side.
window.SafeHousePaymentSuccess = () => void payment.resume();
window.SafeHousePaymentError = () => {
  toast("Check payment status before trying again.");
  void payment.resume();
};
window.SafeHouseResume = () => {
  if (screen?.paymentFlow) void payment.resume();
  else if (state.tokens && !dirty && !submittedForms) {
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
  const filename = `SafeHouse-${String(receiptNumber || id).replace(/[^a-zA-Z0-9_-]/g, "")}.pdf`;
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
    if (contextKey() !== key || !matchesContext(data, snapshot))
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
      await navigate(home(), {}, { replace: true, force: true });
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
    document.title = `${next.title || "SafeHouse"} · SafeHouse`;
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
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
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
    element.dataset.busy = "true";
    element.disabled = true;
    try {
      await screen?.action?.(action, element, event);
    } finally {
      delete element.dataset.busy;
      element.disabled = false;
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
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && screen?.paymentFlow) void payment.resume();
});
let nativeKeyboardOpen = false;
const updateKeyboard = () => {
  const focused = /^(INPUT|TEXTAREA|SELECT)$/.test(
    document.activeElement?.tagName,
  );
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
document.addEventListener("focusout", () => {
  document.body.classList.remove("keyboard-open");
});

async function boot() {
  const stored = native.load();
  if (stored?.tokens?.accessToken && stored.tokens.refreshToken) {
    state.tokens = stored.tokens;
    try {
      const me = await api("/api/auth/me");
      if (!["OWNER", "STUDENT"].includes(me.user?.role))
        throw new Error("Invalid account.");
      state.user = me.user;
      state.properties = me.properties || [];
      state.student = me.student || null;
      state.property =
        state.properties.find((p) => p.id === stored.activePropertyId) ||
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
      state.route = { name: guardedRoute(home()), params: {} };
    } catch (error) {
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
