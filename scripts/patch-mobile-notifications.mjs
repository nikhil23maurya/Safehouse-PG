import fs from 'node:fs';

const file = process.env.SAFEHOUSE_MOBILE_HTML || 'mobile/app/src/main/assets/index.html';
let s = fs.readFileSync(file, 'utf8');
if (s.includes('SAFEHOUSE_NOTIFICATIONS_UI_V1')) {
  console.log('SafeHouse notifications UI already applied.');
  process.exit(0);
}

function exact(oldText, newText, label) {
  if (!s.includes(oldText)) throw new Error(`Notification UI patch failed: ${label}`);
  s = s.replace(oldText, newText);
}
function regex(re, replacement, label) {
  if (!re.test(s)) throw new Error(`Notification UI patch failed: ${label}`);
  s = s.replace(re, replacement);
}

exact('</style>', `
/* SAFEHOUSE_NOTIFICATIONS_UI_V1 */
.notify-hero{padding:18px;background:linear-gradient(145deg,#f8fbff,#fff);border:1px solid #e4ebf6;border-radius:20px;margin-bottom:13px}.notify-hero-top{display:flex;align-items:flex-start;gap:12px}.notify-orb{width:42px;height:42px;border-radius:14px;background:#edf4ff;color:#2563eb;display:flex;align-items:center;justify-content:center;flex:none}.notify-orb svg{width:20px;height:20px}.notify-hero h2{font-size:18px;font-weight:690;letter-spacing:-.35px;margin:1px 0 4px}.notify-hero p{font-size:12px;color:#7b8798;line-height:1.5;margin:0}.notify-segment{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;background:#f1f4f8;border-radius:13px;margin:13px 0}.notify-segment button{height:36px;border:0;border-radius:10px;background:transparent;color:#687386;font-size:12px;font-weight:650}.notify-segment button.active{background:#fff;color:#172033;box-shadow:0 1px 4px rgba(16,24,40,.08)}.notify-card{padding:16px;margin-bottom:12px}.notify-preview{border:1px solid #e5e9f0;background:#f9fafc;border-radius:17px;padding:13px;margin-top:11px}.notify-preview-head{display:flex;align-items:center;gap:8px;font-size:10.5px;color:#8a94a5;margin-bottom:8px}.notify-preview-icon{width:24px;height:24px;border-radius:8px;background:#2563eb;color:#fff;display:flex;align-items:center;justify-content:center}.notify-preview-icon svg{width:13px;height:13px}.notify-preview b{font-size:12.5px;font-weight:680;display:block;color:#202a3a}.notify-preview p{font-size:11.5px;color:#667085;line-height:1.45;margin:3px 0 0}.notify-template-row{display:flex;gap:7px;overflow:auto;padding:1px 0 5px;scrollbar-width:none}.notify-template-row::-webkit-scrollbar{display:none}.notify-template{flex:none;border:1px solid #e3e8ef;background:#fff;border-radius:11px;padding:8px 11px;color:#526071;font-size:11px;font-weight:620}.notify-template:active{transform:scale(.97)}.notify-help{font-size:10.5px;color:#8b95a5;line-height:1.45;margin-top:6px}.notify-audience-note{display:flex;gap:7px;align-items:center;color:#667085;font-size:11px;margin-top:8px}.notify-schedule-times{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.notify-schedule-times .field{margin:0}.notify-student-picker{max-height:190px;overflow:auto;border:1px solid #e5e9f0;border-radius:13px;margin-top:8px;background:#fff}.notify-student-check{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid #f0f2f5;font-size:12px}.notify-student-check:last-child{border-bottom:0}.notify-student-check input{width:17px;height:17px;accent-color:#2563eb}.campaign-card{padding:14px 15px;margin-bottom:9px}.campaign-top{display:flex;gap:10px;align-items:flex-start}.campaign-main{min-width:0;flex:1}.campaign-main b{display:block;font-size:13px;font-weight:680;color:#273142}.campaign-main p{font-size:11px;color:#7f8998;line-height:1.45;margin:3px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.campaign-meta{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;font-size:10.5px;color:#7b8798}.campaign-actions{display:flex;gap:7px;margin-top:11px}.campaign-actions .btn{height:32px;padding:0 11px;font-size:10.5px}.push-setup{border:1px solid #fee3b3;background:#fffaf0;color:#8a5a12;border-radius:14px;padding:11px 12px;font-size:11.5px;line-height:1.45;margin-bottom:12px}.push-ready{border-color:#d7f0e2;background:#f7fdf9;color:#397052}.notify-count{font-size:11px;color:#7b8798}.notify-inline-status{display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:9.5px;font-weight:700;letter-spacing:.2px;text-transform:uppercase;background:#f0f2f5;color:#667085}.notify-inline-status.active{background:#eaf2ff;color:#2563eb}.notify-inline-status.completed{background:#eaf8f0;color:#16804b}.notify-inline-status.paused{background:#fff5df;color:#99670c}.notify-inline-status.cancelled{background:#f2f3f5;color:#7b8492}@media(max-width:360px){.notify-schedule-times{grid-template-columns:1fr}.notify-card{padding:14px}.campaign-meta{gap:6px}}
</style>`, 'notification css');

exact('<button class="quick-action" data-route="dues"><span>${icon(\'alert\')}</span>Send reminder</button>', '<button class="quick-action" data-route="notifications"><span>${icon(\'message\')}</span>Notify residents</button>', 'dashboard notification action');
exact('<div style="display:grid;gap:9px;margin-top:12px"><button class="btn secondary block" data-route="changePassword">${icon(\'lock\')} Change password</button>', '<div style="display:grid;gap:9px;margin-top:12px">${owner?`<button class="btn secondary block" data-route="notifications">${icon(\'message\')} Notifications</button>`:\'\'}<button class="btn secondary block" data-route="changePassword">${icon(\'lock\')} Change password</button>', 'profile notification entry');
regex(/async function doLogin\(form\)\{[^\n]+\}/, (match) => match.replace('saveStored();navigate(', 'saveStored();setTimeout(()=>setupPushNotifications(),650);navigate('), 'login push setup');
regex(/async function logout\(\)\{[^\n]+\}/, `async function logout(){try{await unregisterSafeHousePush()}catch{}try{await api('/api/auth/logout',{method:'POST',body:{}})}catch{}clearStored();S.route='role';history.replaceState({route:'role'},'','#role');renderRole();toast('Logged out')}`, 'logout device unlink');

const runtimeFile = new URL('./mobile-notifications-runtime.js', import.meta.url);
const js = fs.readFileSync(runtimeFile, 'utf8');
let insertionIndex = s.lastIndexOf('\nboot();\n</script>');
if (insertionIndex < 0) insertionIndex = s.lastIndexOf('</script>');
if (insertionIndex < 0) throw new Error('Notification UI patch failed: script marker');
s = s.slice(0, insertionIndex) + '\n' + js + '\n' + s.slice(insertionIndex);

fs.writeFileSync(file, s);
console.log('SafeHouse notifications UI applied.');
