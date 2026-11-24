const attribute=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** One indicator for boot, routes, buttons, requests and payment confirmation. */
export function dots(label="Loading",extra="") {
 return `<div class="pgone-loader loading-dots ${attribute(extra)}" role="status" aria-label="${attribute(label)}"><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span></div>`;
}
