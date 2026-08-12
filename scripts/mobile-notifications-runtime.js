// SAFEHOUSE_NOTIFICATIONS_UI_V1
const NotificationState={mode:'now',campaigns:[],students:[],config:null,loading:false};
const notificationTemplates=[
 {label:'Rent reminder',audience:'PENDING',title:'Rent ka scene sorted? 🏠',body:'Hi {{name}}, your {{month}} rent of {{amount}} is pending. Clear it from SafeHouse and stay sorted.'},
 {label:'Overdue',audience:'OVERDUE',title:'Thoda late ho gaya 👀',body:'Hi {{name}}, your {{month}} rent is overdue. Please clear {{amount}} from SafeHouse.'},
 {label:'Friendly',audience:'PENDING',title:'Rent yaad hai na? 😄',body:'A quick reminder, {{name}} — {{amount}} for {{month}} is pending.'},
 {label:'Announcement',audience:'ALL',title:'SafeHouse update 🏠',body:'Hi {{name}}, we have an important update for residents of {{property}}.'}
];

const __safehouseRenderRouteNotificationV1=renderRoute;
renderRoute=async function(){
 if(S.route==='notifications'){
  if(S.role!=='OWNER')return navigate(routeHome(),{},true);
  try{return await loadNotifications()}catch(e){toast(errorMessage(e),'error');return renderFatal(e)}
 }
 return __safehouseRenderRouteNotificationV1();
};

function nativeNotificationAvailable(){return !!window.SafeHouseNative?.configureNotifications}
async function registerSafeHouseInstallation(fid){
 if(!fid||!S.session)return;
 try{await api('/api/notifications/devices/register',{method:'POST',body:{installationId:String(fid),platform:'ANDROID',appVersion:'2.1.0'}});localStorage.setItem('safehouse_notification_fid',String(fid))}catch(e){console.warn('SafeHouse device registration failed',e)}
}
window.SafeHouseNotificationRegistration=function(fid){void registerSafeHouseInstallation(fid)};
window.SafeHouseNotificationPermissionResult=function(status){
 if(status==='granted'){localStorage.setItem('safehouse_notification_prompted','1');const fid=window.SafeHouseNative?.getNotificationInstallationId?.();if(fid)void registerSafeHouseInstallation(fid);toast('Notifications enabled','success')}
};
window.SafeHouseNotificationOpened=function(route,payload){
 const target=String(route||'studentHome');
 if(S.session){navigate(target,{},true)}else{window.__safehousePendingNotification={route:target,payload}}
};

async function setupPushNotifications(){
 if(!S.session||!nativeNotificationAvailable())return;
 try{
  const cfg=await api('/api/notifications/config');NotificationState.config=cfg;
  if(!cfg?.firebase)return;
  window.SafeHouseNative.configureNotifications(JSON.stringify(cfg.firebase));
  const fid=window.SafeHouseNative.getNotificationInstallationId?.();if(fid)await registerSafeHouseInstallation(fid);
  const status=String(window.SafeHouseNative.notificationPermissionStatus?.()||'unknown');
  if(status==='granted')return;
  if(!localStorage.getItem('safehouse_notification_prompted'))setTimeout(showNotificationPermissionPrompt,900);
 }catch(e){console.warn('SafeHouse push setup skipped',e)}
}
function showNotificationPermissionPrompt(){
 if(!S.session||!nativeNotificationAvailable()||localStorage.getItem('safehouse_notification_prompted'))return;
 showModal('Stay updated with SafeHouse',`<div style="text-align:center;padding:4px 4px 2px"><div class="notify-orb" style="margin:0 auto 12px">${icon('message')}</div><p style="font-size:12px;color:#6f7a8a;line-height:1.55;margin:0 2px 16px">Get rent reminders, payment confirmations and important PG updates even when SafeHouse is closed.</p><button class="btn primary block" type="button" data-action="enable-notifications">Enable notifications</button><button class="btn soft block" style="margin-top:8px" type="button" data-action="notifications-later">Maybe later</button></div>`)
}
async function unregisterSafeHousePush(){
 const fid=window.SafeHouseNative?.getNotificationInstallationId?.()||localStorage.getItem('safehouse_notification_fid');
 if(fid&&S.session)await api('/api/notifications/devices/unregister',{method:'POST',body:{installationId:String(fid)}});
 localStorage.removeItem('safehouse_notification_fid');
}

async function loadNotifications(){
 if(NotificationState.loading)return;NotificationState.loading=true;
 if(!S.period)S.period=periodNow();loading('Loading notifications…');
 try{
  const [campaigns,students,configData]=await Promise.all([
   api('/api/owner/notifications/campaigns'),
   api('/api/owner/students?'+contextQuery()+'&status=ALL'),
   api('/api/notifications/config')
  ]);
  NotificationState.campaigns=campaigns.campaigns||[];NotificationState.students=students.students||[];NotificationState.config=configData;renderNotifications();
 }finally{NotificationState.loading=false}
}
function renderNotifications(){
 const p=S.period||periodNow(),ready=!!NotificationState.config?.clientEnabled&&!!NotificationState.config?.serverEnabled;
 const mode=NotificationState.mode;
 const setup=ready?`<div class="push-setup push-ready">Push service ready · Android devices that allow notifications can receive messages.</div>`:`<div class="push-setup"><b>Firebase setup required</b><br>Campaign UI is ready, but push delivery starts after Firebase values are added to the backend environment.</div>`;
 const templateButtons=notificationTemplates.map((t,i)=>`<button type="button" class="notify-template" data-notification-template="${i}">${esc(t.label)}</button>`).join('');
 const studentChecks=NotificationState.students.map(st=>`<label class="notify-student-check"><input type="checkbox" name="selectedStudent" value="${esc(st.id)}"><span><b>${esc(st.name)}</b><small style="display:block;color:#8a94a5;margin-top:2px">${esc(st.room?.number?'Room '+st.room.number:'No room')}</small></span></label>`).join('')||`<div class="notify-help" style="padding:12px">No active residents in this property.</div>`;
 const today=localDateInput(new Date()),end=localDateInput(new Date(Date.now()+4*86400000));
 const schedule=mode==='schedule'?`<div class="two-col"><div class="field"><label>Start date</label><input class="input" type="date" name="startDate" value="${today}" required></div><div class="field"><label>End date</label><input class="input" type="date" name="endDate" value="${end}" required></div></div><div class="field"><label>Times per day</label><select class="select" name="frequency" data-notification-frequency><option value="1">Once daily</option><option value="2" selected>Twice daily</option><option value="3">3 times daily</option></select></div><div class="notify-schedule-times"><div class="field" data-notification-time="1"><label>Time 1</label><input class="input" type="time" name="time1" value="10:00" min="08:00" max="22:00"></div><div class="field" data-notification-time="2"><label>Time 2</label><input class="input" type="time" name="time2" value="19:00" min="08:00" max="22:00"></div><div class="field" data-notification-time="3" style="display:none"><label>Time 3</label><input class="input" type="time" name="time3" value="20:30" min="08:00" max="22:00"></div></div><div class="notify-help">Maximum 3 campaign sends per resident in 24 hours. Scheduled times stay between 8 AM and 10 PM.</div>`:'';
 const campaignHtml=NotificationState.campaigns.map(renderCampaignCard).join('')||`<div class="card">${emptyState('message','No notification history','Send an immediate message or schedule your first campaign.')}</div>`;
 const content=`<div class="page-head"><div><h1>Notifications</h1><div class="period-caption">${esc(S.property?.name||'Property')} · ${esc(monthName(p.year,p.month))}</div></div></div>${setup}<div class="notify-hero"><div class="notify-hero-top"><div class="notify-orb">${icon('message')}</div><div><h2>Reach residents instantly</h2><p>Send a message now or schedule friendly reminders. Pending audiences are re-checked before every send.</p></div></div></div><div class="notify-segment"><button type="button" class="${mode==='now'?'active':''}" data-notification-mode="now">Send now</button><button type="button" class="${mode==='schedule'?'active':''}" data-notification-mode="schedule">Schedule</button></div><form id="notification-form" data-mode="${mode}"><div class="card notify-card"><div class="field"><label>Audience</label><select class="select" name="audienceType" data-notification-audience><option value="ALL">All students</option><option value="PENDING" selected>Pending rent · selected month</option><option value="OVERDUE">Overdue rent · selected month</option><option value="SELECTED">Selected students</option></select><div class="notify-audience-note">${icon('calendar')} Financial audiences use ${esc(monthName(p.year,p.month))} only.</div></div><div data-notification-students style="display:none"><div class="notify-student-picker">${studentChecks}</div></div><div class="field"><label>Suggested messages</label><div class="notify-template-row">${templateButtons}</div></div><div class="field"><label>Title</label><input class="input" name="title" maxlength="80" value="Rent ka scene sorted? 🏠" required></div><div class="field"><label>Message</label><textarea class="input" name="body" rows="4" maxlength="240" required>Hi {{name}}, your {{month}} rent of {{amount}} is pending. Clear it from SafeHouse and stay sorted.</textarea><div class="notify-help">Variables: {{name}}, {{property}}, {{room}}, {{month}}, {{amount}}, {{due_date}}, {{days_overdue}}</div></div><div class="notify-preview"><div class="notify-preview-head"><span class="notify-preview-icon">${icon('home')}</span><span>SafeHouse · now</span></div><b data-notification-preview-title>Rent ka scene sorted? 🏠</b><p data-notification-preview-body>Hi Aman, your ${esc(monthName(p.year,p.month))} rent is pending.</p></div>${schedule}<button class="btn primary block" type="submit" style="margin-top:14px" ${ready?'':'disabled'}>${mode==='now'?'Send notification now':'Start campaign'}</button></div></form><section class="section"><div class="section-head"><div class="section-title">Recent campaigns</div><span class="notify-count">${NotificationState.campaigns.length} shown</span></div>${campaignHtml}</section>`;
 $('#app').innerHTML=shell(content,{title:'Resident communication',back:true,nav:'profile'});updateNotificationPreview();
}
function renderCampaignCard(c){
 const status=String(c.status||'').toLowerCase(),times=(c.scheduleTimes||[]).join(' · '),when=c.scheduleType==='IMMEDIATE'?'Sent immediately':`${esc(c.startDate)} → ${esc(c.endDate)}${times?' · '+esc(times):''}`;
 const actions=c.status==='ACTIVE'&&c.scheduleType==='SCHEDULED'?`<button type="button" class="btn soft" data-campaign-action="PAUSE" data-campaign-id="${esc(c.id)}">Pause</button><button type="button" class="btn danger-soft" data-campaign-action="CANCEL" data-campaign-id="${esc(c.id)}">End</button>`:c.status==='PAUSED'?`<button type="button" class="btn soft" data-campaign-action="RESUME" data-campaign-id="${esc(c.id)}">Resume</button><button type="button" class="btn danger-soft" data-campaign-action="CANCEL" data-campaign-id="${esc(c.id)}">End</button>`:'';
 return `<div class="card campaign-card"><div class="campaign-top"><div class="campaign-main"><b>${esc(c.title)}</b><p>${esc(c.body)}</p></div><span class="notify-inline-status ${status}">${esc(c.status)}</span></div><div class="campaign-meta"><span>${esc(audienceLabel(c.audienceType))}</span><span>${when}</span><span>${Number(c.delivery?.sent)||0} sent</span>${Number(c.delivery?.failed)?`<span>${Number(c.delivery.failed)} failed</span>`:''}</div>${actions?`<div class="campaign-actions">${actions}</div>`:''}</div>`
}
function audienceLabel(type){return ({ALL:'All residents',PENDING:'Pending rent',OVERDUE:'Overdue rent',SELECTED:'Selected residents'})[type]||type}
function localDateInput(d){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`}
function selectedNotificationStudents(form){return [...form.querySelectorAll('input[name="selectedStudent"]:checked')].map(x=>x.value)}
function updateNotificationPreview(){const f=$('#notification-form');if(!f)return;const title=formValue(f,'title'),body=formValue(f,'body');const sample=NotificationState.students[0]||{name:'Aman',room:{number:'203'}};const p=S.period||periodNow(),vars={name:sample.name||'Aman',property:S.property?.name||'SafeHouse PG',room:sample.room?.number||'203',month:monthName(p.year,p.month),amount:'₹8,500',due_date:'05 '+monthName(p.year,p.month).split(' ')[0],days_overdue:'2'};const fill=v=>String(v||'').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi,(_,k)=>vars[k]||'');const t=$('[data-notification-preview-title]'),b=$('[data-notification-preview-body]');if(t)t.textContent=fill(title)||'Notification title';if(b)b.textContent=fill(body)||'Your message preview appears here.'}
function updateNotificationAudience(){const f=$('#notification-form');if(!f)return;const selected=formValue(f,'audienceType')==='SELECTED';const picker=$('[data-notification-students]');if(picker)picker.style.display=selected?'block':'none'}
function updateNotificationFrequency(){const f=$('#notification-form');if(!f)return;const n=Number(formValue(f,'frequency')||1);$$('[data-notification-time]').forEach(el=>{el.style.display=Number(el.dataset.notificationTime)<=n?'block':'none'})}
async function submitNotification(form){
 const btn=$('button[type=submit]',form);setButtonLoading(btn,true,form.dataset.mode==='schedule'?'Scheduling…':'Sending…');
 try{
  const p=S.period||periodNow(),audienceType=formValue(form,'audienceType'),body={title:formValue(form,'title').trim(),body:formValue(form,'body').trim(),audienceType,selectedStudentIds:selectedNotificationStudents(form),financialYear:p.year,financialMonth:p.month};
  if(audienceType==='SELECTED'&&!body.selectedStudentIds.length)throw new Error('Select at least one student');
  if(form.dataset.mode==='schedule'){
   const count=Number(formValue(form,'frequency')||1),scheduleTimes=[];for(let i=1;i<=count;i++)scheduleTimes.push(formValue(form,'time'+i));
   await api('/api/owner/notifications/campaigns',{method:'POST',body:{...body,startDate:formValue(form,'startDate'),endDate:formValue(form,'endDate'),scheduleTimes}});toast('Notification campaign scheduled','success')
  }else{
   const result=await api('/api/owner/notifications/send-now',{method:'POST',body});toast(`${Number(result.sent)||0} notification${Number(result.sent)===1?'':'s'} sent`,'success')
  }
  NotificationState.loading=false;await loadNotifications();
 }catch(e){toast(errorMessage(e),'error');setButtonLoading(btn,false)}
}
async function campaignAction(id,action){try{await api('/api/owner/notifications/campaigns/'+encodeURIComponent(id),{method:'PATCH',body:{action}});toast(action==='PAUSE'?'Campaign paused':action==='RESUME'?'Campaign resumed':'Campaign ended','success');NotificationState.loading=false;await loadNotifications()}catch(e){toast(errorMessage(e),'error')}}

window.addEventListener('SafeHouseNotificationRefresh',()=>{if(S.route==='notifications'){NotificationState.loading=false;void loadNotifications()}});
document.addEventListener('click',e=>{
 const mode=e.target.closest('[data-notification-mode]');if(mode){NotificationState.mode=mode.dataset.notificationMode;return renderNotifications()}
 const tpl=e.target.closest('[data-notification-template]');if(tpl){const t=notificationTemplates[Number(tpl.dataset.notificationTemplate)];const f=$('#notification-form');if(t&&f){formControl(f,'title').value=t.title;formControl(f,'body').value=t.body;formControl(f,'audienceType').value=t.audience;updateNotificationAudience();updateNotificationPreview()}return}
 const ca=e.target.closest('[data-campaign-action]');if(ca)return campaignAction(ca.dataset.campaignId,ca.dataset.campaignAction);
 const act=e.target.closest('[data-action]');if(!act)return;if(act.dataset.action==='enable-notifications'){localStorage.setItem('safehouse_notification_prompted','1');closeModal();window.SafeHouseNative?.requestNotificationPermission?.();return}if(act.dataset.action==='notifications-later'){localStorage.setItem('safehouse_notification_prompted','1');closeModal();return}
});
document.addEventListener('input',e=>{if(e.target.closest('#notification-form'))updateNotificationPreview()});
document.addEventListener('change',e=>{if(e.target.matches('[data-notification-audience]'))updateNotificationAudience();if(e.target.matches('[data-notification-frequency]'))updateNotificationFrequency()});
document.addEventListener('submit',e=>{if(e.target.id==='notification-form'){e.preventDefault();e.stopImmediatePropagation();return submitNotification(e.target)}},true);

const __safehouseBootNotificationV1=boot;
boot=async function(){const result=await __safehouseBootNotificationV1();if(S.session)setTimeout(()=>setupPushNotifications(),650);if(window.__safehousePendingNotification&&S.session){const pending=window.__safehousePendingNotification;window.__safehousePendingNotification=null;setTimeout(()=>navigate(pending.route||routeHome(),{},true),300)}return result};
