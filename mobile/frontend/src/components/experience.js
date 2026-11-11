// Presentation only: never consumes clicks, delays actions or changes app state.
const reduce = () => document.body.classList.contains("reduced-motion") || matchMedia("(prefers-reduced-motion: reduce)").matches;
let installed = false;
export function enhanceExperience(root) {
  if (!root) return;
  root.querySelector(".app-shell")?.classList.toggle("shell-home", Boolean(root.querySelector(".owner-dashboard,.resident-dashboard")));
  root.querySelectorAll(".content > *, .login-inner > *, .onboarding-body > *, .entry-page > *").forEach((el, index) => {
    if (index > 12) return;
    // Moving a viewport-edge element can create a temporary scroll bar.
    el.classList.add(el.getBoundingClientRect().bottom > innerHeight-16 ? "surface-fade" : "surface-enter");
    el.style.setProperty("--stage", Math.min(index, 4));
  });
  if (installed) return;
  installed = true;
  document.addEventListener("visibilitychange", () => root.classList.toggle("effects-paused", document.hidden));
  root.addEventListener("pointerdown", event => {
    const button = event.target.closest(".button, .entry-option, .quick-action, .nav-item");
    if (!button || button.disabled || reduce()) return;
    const box = button.getBoundingClientRect();
    button.style.setProperty("--touch-x", `${event.clientX-box.left}px`);
    button.style.setProperty("--touch-y", `${event.clientY-box.top}px`);
    button.classList.remove("touch-feedback"); void button.offsetWidth;
    button.classList.add("touch-feedback");
    setTimeout(() => button.classList.remove("touch-feedback"), 650);
  }, {passive:true});
  let frame = 0, target = null, x = 0, y = 0;
  root.addEventListener("pointermove", event => {
    if (event.pointerType !== "mouse" || reduce()) return;
    const next = event.target.closest("[data-depth]");
    if (target && target !== next) {target.style.removeProperty("--look-x"); target.style.removeProperty("--look-y");}
    target = next;
    if (!target) return;
    const box = target.getBoundingClientRect();
    x = ((event.clientX-box.left)/box.width-.5)*8; y = ((event.clientY-box.top)/box.height-.5)*6;
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      if (!target || !target.isConnected || reduce()) return;
      target.style.setProperty("--look-x", `${x}px`); target.style.setProperty("--look-y", `${y}px`);
    });
  }, {passive:true});
  root.addEventListener("pointerleave", () => {
    if (target) {target.style.removeProperty("--look-x"); target.style.removeProperty("--look-y");}
    target = null;
  }, {passive:true});
}
