const attribute=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** One indicator for boot, routes, buttons, requests and payment confirmation. */
export function dots(label="Loading",extra="") {
 return `<span class="loading-dots ${attribute(extra)}" role="status" aria-label="${attribute(label)}"><i aria-hidden="true"></i><i aria-hidden="true"></i><i aria-hidden="true"></i></span>`;
}
