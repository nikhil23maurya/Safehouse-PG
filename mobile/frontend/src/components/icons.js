const paths = {
  home: '<path d="m3 10 9-7 9 7v10H5V10m5 10v-7h5v7"/>',
  users:
    '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m3 10v-3a6 6 0 0 0-2-4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  rooms: '<path d="M3 21V4h18v17M8 4v17m4-11h5m-5 5h5M1 21h22"/>',
  building: '<path d="M4 21V3h12v18m0-13h4v13M2 21h20M8 7h4M8 11h4M8 15h4"/>',
  bed: '<path d="M3 19V7m0 7h18v5m-18-8h14a4 4 0 0 1 4 4M6 11V7h5v4"/>',
  wallet:
    '<path d="M20 8V5H5a2 2 0 0 0 0 4h16v12H5a2 2 0 0 1-2-2V7m18 6h-5v4h5"/>',
  invoice: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3m3 5h6m-6 4h6m-6 4h3"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-9 12a3 3 0 0 0 6 0"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12"/><circle cx="12" cy="12" r="3"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18"/>',
  edit: '<path d="m16 3 5 5-12 12-6 1 1-6L16 3m-3 3 5 5"/>',
  logout: '<path d="M9 5H3v14h6m5-14 7 7-7 7M7 12h14"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  phone:
    '<path d="m4 3 4 1 1 5-2 2a14 14 0 0 0 6 6l2-2 5 1 1 4c-9 3-21-9-17-17"/>',
  refresh: '<path d="M20 8a9 9 0 1 0 1 8M20 3v6h-6"/>',
  alert: '<path d="m12 3 10 18H2L12 3m0 6v5m0 3v1"/>',
  shield: '<path d="m12 3 9 4v5c0 5-9 9-9 9s-9-4-9-9V7l9-4m-4 9 3 3 5-6"/>',
  send: '<path d="m22 2-7 20-4-9-9-4L22 2m-11 11L22 2"/>',
  key: '<circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-6-6 3-3m0 6 3-3"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
  qr: '<path d="M3 3h6v6H3zm12 0h6v6h-6zM3 15h6v6H3zm12 0h3v3h3v3h-6zm6-3v3M12 3v3m0 6h3M3 12h3m6 6v3"/>',
};

export function icon(name, className = "") {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.home}</svg>`;
}

export {brand} from "./brand.js";
