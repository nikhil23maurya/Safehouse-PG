import fs from 'node:fs';

const file = 'mobile/app/src/main/assets/index.html';
let s = fs.readFileSync(file, 'utf8');
if (s.includes('SAFEHOUSE_PERF_V1')) {
  console.log('SafeHouse mobile performance patch already applied.');
  process.exit(0);
}
function rep(oldText, newText, label) {
  if (!s.includes(oldText)) throw new Error(`Performance patch failed: ${label}`);
  s = s.replace(oldText, newText);
}

rep(
"const S={session:null,user:null,role:null,property:null,properties:[],activePropertyId:null,student:null,route:'role',params:{},dashboard:null,students:[],rooms:[],dues:null,payments:[],studentDashboard:null,invoices:[],period:null};",
"const S={session:null,user:null,role:null,property:null,properties:[],activePropertyId:null,student:null,route:'role',params:{},dashboard:null,students:[],rooms:[],dues:null,payments:[],studentDashboard:null,invoices:[],period:null,navSeq:0,studentsKey:'',roomsLoaded:false,paymentsLoaded:false,historyLoaded:false};\nconst SAFEHOUSE_PERF_V1=true;\nfunction routeAlive(route,seq){return S.route===route&&S.navSeq===seq}\nfunction dashboardIsCurrent(){const d=S.dashboard,p=S.period||periodNow();return !!(d&&d.period&&d.period.year===p.year&&d.period.month===p.month&&(!S.activePropertyId||d.property?.id===S.activePropertyId))}\nfunction duesIsCurrent(){const d=S.dues,p=S.period||periodNow();return !!(d&&d.period&&d.period.year===p.year&&d.period.month===p.month)}",
'state helpers'
);

rep(
"function resetPropertyData(){S.dashboard=null;S.students=[];S.rooms=[];S.dues=null;S.payments=[]}",
"function resetPropertyData(){S.dashboard=null;S.students=[];S.studentsKey='';S.rooms=[];S.roomsLoaded=false;S.dues=null;S.payments=[];S.paymentsLoaded=false}",
'reset cache flags'
);

rep(
"function navigate(route,params={},replace=false){S.route=route;S.params=params||{};const st={route,params:S.params};try{replace?history.replaceState(st,'','#'+route):history.pushState(st,'','#'+route)}catch{};renderRoute()}\nwindow.addEventListener('popstate',e=>{const st=e.state||{};S.route=st.route||(S.session?routeHome():'role');S.params=st.params||{};renderRoute()});",
"function navigate(route,params={},replace=false){S.navSeq++;S.route=route;S.params=params||{};const st={route,params:S.params};try{replace?history.replaceState(st,'','#'+route):history.pushState(st,'','#'+route)}catch{};requestAnimationFrame(()=>renderRoute())}\nwindow.addEventListener('popstate',e=>{S.navSeq++;const st=e.state||{};S.route=st.route||(S.session?routeHome():'role');S.params=st.params||{};requestAnimationFrame(()=>renderRoute())});",
'navigation sequencing'
);

rep(
"async function loadOwnerHome(){if(!S.period)S.period=periodNow();if(!S.dashboard)loading();await loadProperties();S.dashboard=await api(`/api/owner/dashboard?year=${S.period.year}&month=${S.period.month}`);S.property=S.dashboard.property||S.property;S.activePropertyId=S.property?.id||S.activePropertyId;saveStored();renderOwnerHome()}",
"async function loadOwnerHome(){if(!S.period)S.period=periodNow();const seq=S.navSeq,route='ownerHome',had=dashboardIsCurrent();if(had)renderOwnerHome();else loading();try{await loadProperties();const data=await api(`/api/owner/dashboard?year=${S.period.year}&month=${S.period.month}`);if(!routeAlive(route,seq))return;S.dashboard=data;S.property=data.property||S.property;S.activePropertyId=S.property?.id||S.activePropertyId;saveStored();renderOwnerHome();setTimeout(warmOwnerCaches,180)}catch(e){if(!had)throw e;toast('Showing saved dashboard. Refreshing failed.','error')}}",
'owner home stale-while-revalidate'
);

rep(
"async function loadStudents(status=S.params.status||'ALL',query=''){if(!S.students.length)loading();const q=query?`&q=${encodeURIComponent(query)}`:'';const data=await api(`/api/owner/students?status=${encodeURIComponent(status)}${q}`);S.students=data.students||[];renderStudents(status,query)}",
"async function loadStudents(status=S.params.status||'ALL',query=''){const seq=S.navSeq,route='students',key=status+'|'+query,had=S.studentsKey===key;S.params.status=status;if(had)renderStudents(status,query);else loading();const q=query?`&q=${encodeURIComponent(query)}`:'';try{const data=await api(`/api/owner/students?status=${encodeURIComponent(status)}${q}`);if(!routeAlive(route,seq))return;S.students=data.students||[];S.studentsKey=key;renderStudents(status,query)}catch(e){if(!had)throw e;toast('Showing saved residents. Refreshing failed.','error')}}",
'students stale-while-revalidate'
);

rep(
"async function loadRooms(){loading('Loading rooms…');const data=await api('/api/owner/rooms');S.rooms=data.rooms||[];renderRooms()}",
"async function loadRooms(){const seq=S.navSeq,route='rooms',had=S.roomsLoaded;if(had)renderRooms();else loading('Loading rooms…');try{const data=await api('/api/owner/rooms');if(!routeAlive(route,seq))return;S.rooms=data.rooms||[];S.roomsLoaded=true;renderRooms()}catch(e){if(!had)throw e;toast('Showing saved rooms. Refreshing failed.','error')}}",
'rooms stale-while-revalidate'
);

rep(
"async function loadDues(){loading('Loading dues…');if(!S.period)S.period=periodNow();S.dues=await api(`/api/owner/dues?year=${S.period.year}&month=${S.period.month}`);renderDues()}",
"async function loadDues(){if(!S.period)S.period=periodNow();const seq=S.navSeq,route='dues',had=duesIsCurrent();if(had)renderDues();else loading('Loading dues…');try{const data=await api(`/api/owner/dues?year=${S.period.year}&month=${S.period.month}`);if(!routeAlive(route,seq))return;S.dues=data;renderDues()}catch(e){if(!had)throw e;toast('Showing saved dues. Refreshing failed.','error')}}",
'dues stale-while-revalidate'
);

rep(
"async function loadOwnerPayments(){loading('Loading payments…');const d=await api('/api/owner/payments');S.payments=d.payments||[];const rows=S.payments.map(p=>paymentRow(p,true)).join('');const content=`<div class=\"page-head\"><div><h1>Payments</h1><p>${S.payments.length} transaction${S.payments.length===1?'':'s'} recorded</p></div></div><div class=\"card\">${rows||emptyState('receipt','No payments yet','Captured online and manual payments will appear here.')}</div>`;$('#app').innerHTML=shell(content,{title:'Payment history',back:true})}",
"async function loadOwnerPayments(){const seq=S.navSeq,route='ownerPayments',had=S.paymentsLoaded;if(had)renderOwnerPayments();else loading('Loading payments…');try{const d=await api('/api/owner/payments');if(!routeAlive(route,seq))return;S.payments=d.payments||[];S.paymentsLoaded=true;renderOwnerPayments()}catch(e){if(!had)throw e;toast('Showing saved payments. Refreshing failed.','error')}}\nfunction renderOwnerPayments(){const rows=S.payments.map(p=>paymentRow(p,true)).join('');const content=`<div class=\"page-head\"><div><h1>Payments</h1><p>${S.payments.length} transaction${S.payments.length===1?'':'s'} recorded</p></div></div><div class=\"card\">${rows||emptyState('receipt','No payments yet','Captured online and manual payments will appear here.')}</div>`;$('#app').innerHTML=shell(content,{title:'Payment history',back:true,nav:'ownerPayments'})}",
'payments cache render'
);

rep(
"async function loadStudentHome(){loading('Loading your rent…');S.studentDashboard=await api('/api/student/dashboard');S.student=S.studentDashboard.student||S.student;saveStored();renderStudentHome()}",
"async function loadStudentHome(){const seq=S.navSeq,route='studentHome',had=!!S.studentDashboard;if(had)renderStudentHome();else loading('Loading your rent…');try{const data=await api('/api/student/dashboard');if(!routeAlive(route,seq))return;S.studentDashboard=data;S.student=data.student||S.student;saveStored();renderStudentHome()}catch(e){if(!had)throw e;toast('Showing saved rent data. Refreshing failed.','error')}}",
'student home cache render'
);

rep(
"async function loadHistory(){loading('Loading rent history…');const d=await api('/api/student/invoices');S.invoices=d.invoices||[];renderHistory()}",
"async function loadHistory(){const seq=S.navSeq,route='history',had=S.historyLoaded;if(had)renderHistory();else loading('Loading rent history…');try{const d=await api('/api/student/invoices');if(!routeAlive(route,seq))return;S.invoices=d.invoices||[];S.historyLoaded=true;renderHistory()}catch(e){if(!had)throw e;toast('Showing saved history. Refreshing failed.','error')}}",
'history cache render'
);

rep(
"function renderOwnerHome(){const d=S.dashboard,m=d.metrics||{},pct=Math.max(0,Math.min(100,Number(m.collectionRate)||0));",
"function warmOwnerCaches(){if(S.role!=='OWNER'||S.__warming)return;S.__warming=true;const jobs=[];if(S.studentsKey!=='ALL|')jobs.push(api('/api/owner/students?status=ALL').then(d=>{S.students=d.students||[];S.studentsKey='ALL|'}).catch(()=>{}));if(!S.roomsLoaded)jobs.push(api('/api/owner/rooms').then(d=>{S.rooms=d.rooms||[];S.roomsLoaded=true}).catch(()=>{}));if(!S.paymentsLoaded)jobs.push(api('/api/owner/payments').then(d=>{S.payments=d.payments||[];S.paymentsLoaded=true}).catch(()=>{}));Promise.allSettled(jobs).finally(()=>{S.__warming=false})}\nfunction renderOwnerHome(){const d=S.dashboard,m=d.metrics||{},pct=Math.max(0,Math.min(100,Number(m.collectionRate)||0));",
'owner prefetch'
);

rep("S.dashboard=null;S.dues=null;if(S.route==='dues')loadDues();", "S.dashboard=null;S.dues=null;S.paymentsLoaded=false;if(S.route==='dues')loadDues();", 'manual payment invalidation');
rep("toast('Room updated','success');loadRooms()", "toast('Room updated','success');S.roomsLoaded=false;loadRooms()", 'room update invalidation');

rep(
"</style>",
"\n/* SAFEHOUSE_PERF_V1: keep navigation smooth on Android WebView */\nbutton,a,[role=button]{touch-action:manipulation}\n.student-row,.payment-row,.room-card,.due-card{content-visibility:auto;contain-intrinsic-size:76px;contain:layout paint style}\n@media (max-width:840px){.topbar,.bottom-nav{-webkit-backdrop-filter:none!important;backdrop-filter:none!important;background:#fff!important}.card{box-shadow:0 2px 10px rgba(24,36,56,.025)}.hero-card{box-shadow:0 10px 24px rgba(37,99,235,.16)}}\n@media (prefers-reduced-motion:reduce){*,*:before,*:after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}\n</style>",
'performance css'
);

fs.writeFileSync(file, s);
console.log('SafeHouse mobile performance patch applied.');
