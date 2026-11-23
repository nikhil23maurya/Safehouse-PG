export function brand({ compact = false, stacked = false } = {}) {
  if (stacked) return '<img class="brand-logo" src="pgone-logo.png" width="420" height="438" alt="PGOne">';
  return `<span class="brand"><img class="brand-mark" src="pgone-mark.png" width="34" height="34" alt="${compact ? "PGOne" : ""}">${compact ? "" : '<span class="brand-wordmark">PG<span class="brand-dot">One</span></span>'}</span>`;
}
