import fs from 'node:fs';

const file = process.env.SAFEHOUSE_MOBILE_HTML || 'mobile/app/src/main/assets/index.html';
let s = fs.readFileSync(file, 'utf8');
if (s.includes('SAFEHOUSE_RUNTIME_STABILITY_V1')) {
  console.log('SafeHouse runtime stability patch already applied.');
  process.exit(0);
}

function replaceExact(oldText, newText, label) {
  if (!s.includes(oldText)) throw new Error(`Runtime stability patch failed: ${label}`);
  s = s.replace(oldText, newText);
}

function replaceRegex(re, replacement, label) {
  if (!re.test(s)) throw new Error(`Runtime stability patch failed: ${label}`);
  s = s.replace(re, replacement);
}

// Make validation errors actionable and avoid HTMLFormElement built-in property collisions
// such as form.name and form.method.
replaceExact(
  "function errorMessage(e){return e?.message||'Something went wrong. Please try again.'}",
  `const SAFEHOUSE_RUNTIME_STABILITY_V1=true;\nfunction errorMessage(e){const fields=e?.details?.fieldErrors;if(fields&&typeof fields==='object'){for(const [field,messages] of Object.entries(fields)){if(Array.isArray(messages)&&messages[0])return friendlyField(field)+': '+messages[0]}}const formErrors=e?.details?.formErrors;if(Array.isArray(formErrors)&&formErrors[0])return formErrors[0];return e?.message||'Something went wrong. Please try again.'}\nfunction friendlyField(name){return ({fullName:'Full name',email:'Email',mobile:'Mobile',roomId:'Room',bedLabel:'Bed',joiningDate:'Joining date',monthlyRent:'Monthly rent',securityDeposit:'Deposit',rentDueDay:'Rent due day',tempPassword:'Temporary password',name:'Property name',timezone:'Timezone',number:'Room',capacity:'Capacity',amount:'Amount',method:'Payment method'})[name]||name}\nfunction formControl(form,name){const el=form?.elements?.namedItem?.(name);if(!el||typeof el.value==='undefined')throw new Error(friendlyField(name)+' field is missing');return el}\nfunction formValue(form,name){return String(formControl(form,name).value??'')}\nfunction formNumber(form,name,{required=false,min=null,max=null,fallback=0}={}){const raw=formValue(form,name).trim();if(!raw){if(required)throw new Error('Enter '+friendlyField(name).toLowerCase());return fallback}const n=Number(raw);if(!Number.isFinite(n))throw new Error('Enter a valid '+friendlyField(name).toLowerCase());if(min!==null&&n<min)throw new Error(friendlyField(name)+' must be at least '+min);if(max!==null&&n>max)throw new Error(friendlyField(name)+' must be at most '+max);return n}`,
  'form and validation helpers'
);

// Students page styling regressed because financial patch introduced class names without CSS.
replaceExact(
  '</style>',
  `\n/* SAFEHOUSE_RUNTIME_STABILITY_V1: mobile UI + form reliability */\n.search-wrap{position:relative;margin-bottom:11px}.search-wrap>span{position:absolute;left:14px;top:50%;transform:translateY(-50%);width:18px;height:18px;color:#98a2b3;display:flex;align-items:center;justify-content:center;pointer-events:none}.search-wrap>span svg{width:18px;height:18px}.search-wrap .input{padding-left:43px;background:#fff;border-color:#e2e7ee;box-shadow:0 1px 2px rgba(16,24,40,.02)}\n.filter-chip{height:34px;padding:0 13px;border-radius:999px;background:#fff;border:1px solid var(--line);color:#667085;font-size:11.5px;font-weight:650;white-space:nowrap;transition:background .15s ease,border-color .15s ease,color .15s ease,transform .15s ease}.filter-chip:active{transform:scale(.97)}.filter-chip.active{background:#172033;color:#fff;border-color:#172033}.student-list{margin-top:9px}.students-action{display:flex;justify-content:flex-end;margin:7px 0 2px}.students-action .btn{min-width:116px}.student-row{width:100%;text-align:left}\n@media(max-width:390px){.search-wrap{margin-bottom:9px}.filter-chip{height:32px;padding:0 11px;font-size:11px}.students-action .btn{min-width:108px}}\n</style>`,
  'students page CSS'
);

replaceRegex(
  /async function createProperty\(form\)\{[^\n]+\}/,
  `async function createProperty(form){const btn=$('button[type=submit]',form);setButtonLoading(btn,true,'Creating…');try{const name=formValue(form,'name').trim();const timezone=formValue(form,'timezone').trim()||'Asia/Kolkata';if(name.length<2)throw new Error('Property name must be at least 2 characters');const d=await api('/api/owner/properties',{method:'POST',body:{name,timezone}});const id=d.property?.id;if(!id)throw new Error('Property was not confirmed by server.');const fresh=await api('/api/owner/properties');S.properties=fresh.properties||[];const p=S.properties.find(x=>x.id===id);if(!p)throw new Error('Property was created but verification failed.');S.activePropertyId=p.id;S.property=p;resetPropertyData();saveStored();closeModal();toast(p.name+' created','success');navigate('ownerHome',{},true)}catch(e){toast(errorMessage(e),'error');setButtonLoading(btn,false)}}`,
  'property creation form'
);

replaceExact(
  "async function searchStudentsDebounced(){clearTimeout(window.__studentSearch);window.__studentSearch=setTimeout(()=>loadStudents($('.chip.active')?.dataset.studentFilter||'ALL',$('#student-search')?.value.trim()||''),380)}",
  "async function searchStudentsDebounced(){clearTimeout(window.__studentSearch);window.__studentSearch=setTimeout(()=>loadStudents($('[data-student-filter].active')?.dataset.studentFilter||S.params.status||'ALL',$('#student-search')?.value.trim()||''),320)}",
  'student search active filter'
);

replaceRegex(
  /function renderStudents\(status='ALL',query=''\)\{[^\n]+\}/,
  `function renderStudents(status='ALL',query=''){const p=S.period||periodNow();const rows=S.students.map(st=>{const inv=st.periodInvoice||st.currentInvoice;const overdue=inv&&inv.status!=='PAID'&&inv.status!=='WAIVED'&&new Date(inv.dueDate)<new Date();const rent=inv?.rentPaise??st.monthlyRentPaise;return \`<button class="student-row" data-student-id="\${esc(st.id)}"><div class="avatar">\${esc(initials(st.name))}</div><div class="row-main"><div class="row-title">\${esc(st.name)}</div><div class="row-sub">\${esc(st.room?.number?'Room '+st.room.number+(st.bedLabel?' · '+st.bedLabel:''):'No room')} · \${esc(st.mobile||'')}</div></div><div class="amount-col"><b>\${moneyP(rent)}</b>\${inv?\`<div style="margin-top:4px">\${statusPill(inv.status,overdue)}</div>\`:'<small>No invoice</small>'}</div></button>\`}).join('');const chips=['ALL','PAID','PENDING','OVERDUE'].map(x=>\`<button class="filter-chip \${status===x?'active':''}" data-student-filter="\${x}">\${x==='ALL'?'All':x[0]+x.slice(1).toLowerCase()}</button>\`).join('');const content=\`<div class="page-head"><div><h1>Students</h1><div class="period-caption">\${esc(S.property?.name||'Property')} · \${esc(monthName(p.year,p.month))}</div></div><div class="month-nav"><button data-action="period-prev">‹</button><span>\${esc(monthName(p.year,p.month))}</span><button data-action="period-next">›</button></div></div><div class="search-wrap"><span>\${icon('search')}</span><input id="student-search" class="input" placeholder="Search residents, rooms…" value="\${esc(query)}"></div><div class="filter-row">\${chips}</div><div class="students-action"><button class="btn primary small" data-route="studentForm">\${icon('plus')} Add student</button></div><div class="student-list">\${rows||emptyState('users','No residents found',query?'Try another search or filter.':'Add your first resident to this property.',\`<button class="btn primary" data-route="studentForm">Add student</button>\`)}</div>\`;$('#app').innerHTML=shell(content,{nav:'students'})}`,
  'students render'
);

replaceExact(
  "async function ensureRooms(){if(!S.rooms.length){const d=await api('/api/owner/rooms');S.rooms=d.rooms||[]}return S.rooms}",
  "async function ensureRooms(){if(!S.roomsLoaded){const d=await api('/api/owner/rooms');S.rooms=d.rooms||[];S.roomsLoaded=true}return S.rooms}",
  'rooms preload cache'
);

replaceRegex(
  /async function saveStudent\(form\)\{[^\n]+\}/,
  `async function saveStudent(form){const id=form.dataset.id||null;let body;try{const fullName=formValue(form,'fullName').trim(),email=formValue(form,'email').trim(),mobile=formValue(form,'mobile').trim(),monthlyRent=formNumber(form,'monthlyRent',{required:true,min:1,max:1000000}),securityDeposit=formNumber(form,'securityDeposit',{min:0,max:10000000,fallback:0}),rentDueDay=formNumber(form,'rentDueDay',{required:true,min:1,max:28});if(fullName.length<2)throw new Error('Full name must be at least 2 characters');if(!email||!email.includes('@'))throw new Error('Enter a valid email');if(mobile.replace(/\\D/g,'').length<10)throw new Error('Enter a valid mobile number');body={fullName,email,mobile,roomId:formValue(form,'roomId')||null,bedLabel:formValue(form,'bedLabel').trim()||null,monthlyRent,securityDeposit,rentDueDay,notes:formValue(form,'notes').trim()||null};if(id)body.status=formValue(form,'status');else{body.joiningDate=formValue(form,'joiningDate');body.tempPassword=formValue(form,'tempPassword');if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(body.joiningDate))throw new Error('Choose a valid joining date');if(body.tempPassword.length<8)throw new Error('Temporary password must be at least 8 characters')}}catch(e){toast(errorMessage(e),'error');return}const btn=$('button[type=submit]',form);setButtonLoading(btn,true,id?'Saving…':'Creating…');try{const path=id?'/api/owner/students/'+encodeURIComponent(id)+'?'+contextQuery():'/api/owner/students?'+contextQuery();const d=await api(path,{method:id?'PATCH':'POST',body});S.students=[];S.studentsKey='';S.dashboard=null;S.dues=null;S.duesKey='';S.payments=[];S.paymentsKey='';S.rooms=[];S.roomsLoaded=false;if(id&&d.rentChange){const effective=monthName(d.rentChange.effectiveYear,d.rentChange.effectiveMonth);toast(d.rentChange.appliedToSelectedInvoice?\`Rent updated for \${effective}\`:\`New rent starts \${effective}\`,'success')}else toast(id?'Resident updated':'Resident added','success');navigate(id?'studentDetail':'students',id?{id}:{},true)}catch(e){toast(errorMessage(e),'error');setButtonLoading(btn,false)}}`,
  'student save flow'
);

replaceRegex(
  /async function saveRoom\(form\)\{[^\n]+\}/,
  `async function saveRoom(form){const btn=$('button[type=submit]',form);setButtonLoading(btn,true,'Creating…');try{const number=formValue(form,'number').trim();const capacity=formNumber(form,'capacity',{required:true,min:1,max:50});if(!number)throw new Error('Enter room number or name');await api('/api/owner/rooms',{method:'POST',body:{number,capacity}});S.rooms=[];S.roomsLoaded=false;S.dashboard=null;toast('Room created','success');navigate('rooms',{},true)}catch(e){toast(errorMessage(e),'error');setButtonLoading(btn,false)}}`,
  'room creation cache and validation'
);

replaceRegex(
  /async function saveProperty\(form\)\{[^\n]+\}/,
  `async function saveProperty(form){const btn=$('button[type=submit]',form);setButtonLoading(btn,true,'Saving…');try{const name=formValue(form,'name').trim();if(name.length<2)throw new Error('Property name must be at least 2 characters');const d=await api('/api/owner/property',{method:'PATCH',body:{name}});S.property=d.property;S.properties=S.properties.map(p=>p.id===d.property?.id?{...p,...d.property}:p);saveStored();toast('Property updated','success');renderProfile()}catch(e){toast(errorMessage(e),'error');setButtonLoading(btn,false)}}`,
  'property rename form and cache'
);

replaceRegex(
  /async function recordManual\(form\)\{[^\n]+\}/,
  `async function recordManual(form){const btn=$('button[type=submit]',form);setButtonLoading(btn,true,'Recording…');try{const amount=formNumber(form,'amount',{required:true,min:.01});const method=formValue(form,'method')||'CASH';await api(\`/api/owner/invoices/\${encodeURIComponent(form.dataset.id)}/manual-payment\`,{method:'POST',body:{amount,method}});closeModal();toast('Payment recorded','success');S.dashboard=null;S.dues=null;S.duesKey='';S.payments=[];S.paymentsKey='';S.students=[];S.studentsKey='';if(S.route==='dues')loadDues();else if(S.route==='studentDetail')loadStudentDetail(S.params.id)}catch(e){toast(errorMessage(e),'error');setButtonLoading(btn,false)}}`,
  'manual payment form and caches'
);

replaceRegex(
  /async function updateInvoice\(form\)\{[^\n]+\}/,
  `async function updateInvoice(form){const btn=$('button[type=submit]',form);setButtonLoading(btn,true,'Updating…');try{const body={electricity:formNumber(form,'electricity',{min:0}),lateFee:formNumber(form,'lateFee',{min:0}),otherCharges:formNumber(form,'otherCharges',{min:0}),discount:formNumber(form,'discount',{min:0})};await api(\`/api/owner/invoices/\${encodeURIComponent(form.dataset.id)}\`,{method:'PATCH',body});closeModal();toast('Invoice updated','success');S.dashboard=null;S.dues=null;S.duesKey='';S.students=[];S.studentsKey='';if(S.route==='dues')loadDues();else if(S.route==='studentDetail')loadStudentDetail(S.params.id)}catch(e){toast(errorMessage(e),'error');setButtonLoading(btn,false)}}`,
  'invoice edit caches'
);

replaceRegex(
  /async function updateRoom\(form\)\{[^\n]+\}/,
  `async function updateRoom(form){const btn=$('button[type=submit]',form);setButtonLoading(btn,true,'Saving…');try{const number=formValue(form,'number').trim(),capacity=formNumber(form,'capacity',{required:true,min:1,max:50});if(!number)throw new Error('Enter room number or name');await api(\`/api/owner/rooms/\${encodeURIComponent(form.dataset.id)}\`,{method:'PATCH',body:{number,capacity}});closeModal();toast('Room updated','success');S.rooms=[];S.roomsLoaded=false;S.dashboard=null;loadRooms()}catch(e){toast(errorMessage(e),'error');setButtonLoading(btn,false)}}`,
  'room update cache'
);

fs.writeFileSync(file, s);
console.log('SafeHouse runtime stability patch applied.');
