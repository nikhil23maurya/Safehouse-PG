import {esc} from "./ui.js";

export function dots(label="Loading",extra="") {
  return `<span class="loading-dots ${extra}" role="status" aria-label="${esc(label)}"><i aria-hidden="true"></i><i aria-hidden="true"></i><i aria-hidden="true"></i></span>`;
}
export function successMark(label="Confirmed") {
  return `<span class="confirmed-mark" role="img" aria-label="${esc(label)}"><svg viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="31"/><path d="m22 36 9 9 20-21"/></svg></span>`;
}
// Keep the original nodes and geometry; replace neither the label nor its listeners.
export function busyButton(element,label="Working") {
  const previousDisabled=element.disabled;
  const original=document.createElement("span");original.className="busy-original";
  while(element.firstChild)original.append(element.firstChild);
  const overlay=document.createElement("span");overlay.className="busy-overlay";overlay.innerHTML=dots(label);
  element.append(original,overlay);element.setAttribute("aria-busy","true");element.disabled=true;
  return ()=>{
    overlay.remove();while(original.firstChild)element.insertBefore(original.firstChild,original);
    original.remove();element.removeAttribute("aria-busy");element.disabled=previousDisabled;
  };
}
