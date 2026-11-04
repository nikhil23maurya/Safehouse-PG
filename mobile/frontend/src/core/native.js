export const native = {
  has(name) {
    return typeof window.SafeHouseNative?.[name] === "function";
  },
  call(name, ...args) {
    if (this.has(name)) return window.SafeHouseNative[name](...args);
  },
  load() {
    const raw = this.call("getSession");
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  save(value) {
    // Browser previews intentionally have no persistent token storage.
    if (!this.has("saveSession")) return;
    if (this.call("saveSession", value ? JSON.stringify(value) : "") !== true)
      throw new Error(
        "Secure session storage is unavailable. Please restart the app and sign in again.",
      );
  },
  openExternal(url) {
    let target;
    try {
      target = new URL(url);
    } catch {
      throw new Error("This link is unavailable.");
    }
    const allowed =
      ["tel:", "mailto:"].includes(target.protocol) ||
      (target.protocol === "https:" &&
        (target.hostname === "wa.me" ||
          target.hostname === "api.whatsapp.com" ||
          target.hostname === "rzp.io" ||
          target.hostname === "razorpay.com" ||
          target.hostname.endsWith(".razorpay.com")));
    if (!allowed) throw new Error("This link is not supported by SafeHouse.");
    if (this.has("openExternal")) this.call("openExternal", target.href);
    else window.open(target.href, "_blank", "noopener,noreferrer");
  },
};
