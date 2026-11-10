// Openframe: a structural P with an open lower counter. The same editable
// geometry generates Android, documentation and web assets.
export const markPath="M10 56V18L20 8H44L54 18V36L44 46H26V56Z M26 20V34H38L42 30V24L38 20Z";
export const markFold="M26 34H38V46H26Z";
export function brandSymbol({dark=false,mono=false}={}) {
  return `<svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="${markPath}" fill="${dark?"#FFFFFF":"#2056EF"}" fill-rule="evenodd"/>${mono?"":`<path d="${markFold}" fill="${dark?"#A7C8FF":"#0B2148"}"/>`}</svg>`;
}
export function brand({compact=false,dark=false}={}) {
  return `<span class="brand${dark?" brand-on-blue":""}" aria-label="PGOne">${brandSymbol({dark})}${compact?"":'<span class="brand-wordmark">PG<span class="brand-dot">One</span></span>'}</span>`;
}
