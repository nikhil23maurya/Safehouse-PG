(function atelier() {
  'use strict';
  var A = {};
  function glyph(name) { return icon(name); }
  function mark() {
    return '<div class="sh-entrance" aria-hidden="true"><svg viewBox="0 0 108 108" fill="none"><defs><radialGradient id="shMarkGlow"><stop stop-color="#e1bd80" stop-opacity=".3"/><stop offset="1" stop-color="#e1bd80" stop-opacity="0"/></radialGradient></defs><circle cx="54" cy="54" r="49" fill="url(#shMarkGlow)"/><path class="sh-arch" d="M23 53L54 25 85 53 M31 50V81H77V50 M44 81V62H64V81" /><circle class="sh-glow" cx="54" cy="53" r="3"/></svg></div>';
  }
  function heading(kicker, title, subtitle, accessory) {
    return '<header class="sh-heading sh-stagger"><div class="sh-topline"><div><div class="sh-page-overline">'+esc(kicker)+'</div><h1 class="sh-h1">'+title+'</h1>'+(subtitle?'<p class="sh-sub">'+subtitle+'</p>':'')+'</div>'+(accessory||'')+'</div></header>';
  }
  function itemAvatar(name) {
    return '<div class="avatar">'+esc(initials(name||'Resident'))+'</div>';
  }
  function frame(content,nav='',opts={}) {
    $('#app').innerHTML=shell('<div class="sh-stage">'+content+'</div>',{nav:nav, title:opts.title||'',back:!!opts.back,brand:opts.brand!==false});
  }
  function section(title, action, body) {
    return '<section class="sh-section sh-stagger"><div class="sh-section-top"><h2>'+esc(title)+'</h2>'+(action||'')+'</div>'+body+'</section>';
  }
  function money(value) { return moneyP(Number(value)||0); }
  function periodLabel(p) {return p ? esc(monthName(p.year,p.month)): 'This month';}
  function safeStatus(inv) {return statusPill(inv?.status||'DUE', !!inv?.overdue || (!!inv?.dueDate && inv?.status!=='PAID' && new Date(inv.dueDate)<new Date()));}
  function quick(route,kind,label) {return '<button class="sh-action" data-route="'+route+'">'+glyph(kind)+'<span>'+esc(label)+'</span></button>';}
  function metric(v,label,kind) {return '<div class="sh-metric"><div class="sh-metric-icon">'+glyph(kind)+'</div><b>'+v+'</b><small>'+esc(label)+'</small></div>';}
  function asResident(st) {
    const invoice=st.periodInvoice||st.currentInvoice;
    const status=invoice?safeStatus(invoice):'<span class="pill neutral">No invoice</span>';
    const label=(st.room?.number?'Room '+st.room.number:'Unassigned')+(st.bedLabel?' · Bed '+st.bedLabel:'');
    const amount=invoice?.remainingPaise ?? st.monthlyRentPaise ?? 0;
    return '<button class="sh-item sh-item-button" data-student-id="'+esc(st.id)+'">'+itemAvatar(st.name)+
      '<span class="sh-item-main"><span class="sh-item-name">'+esc(st.name||'Resident')+'</span><span class="sh-item-meta">'+esc(label)+'</span></span>'+
      '<span class="sh-item-end"><strong>'+money(amount)+'</strong>'+status+'</span><span class="sh-arrow">'+glyph('right')+'</span></button>';
  }
  function transaction(p,owner) {
    const label=owner?(p.student?.name||'Resident'):monthName(p.invoice?.year||new Date(p.paidAt).getFullYear(),p.invoice?.month||new Date(p.paidAt).getMonth()+1);
    const room=owner&&p.student?.room?' · Room '+p.student.room:'';
    const id=esc(p.id||'');
    return '<div class="sh-item"><div class="sh-metric-icon" style="margin:0;flex:0 0 auto">'+glyph('checkcircle')+'</div><div class="sh-item-main"><div class="sh-item-name">'+esc(label)+'</div><div class="sh-item-meta">'+esc(dateFmt(p.paidAt)+' · '+(p.method||p.source||'Payment')+room)+'</div></div><div class="sh-item-end"><strong>'+money(p.amountPaise)+'</strong><button aria-label="Download receipt" class="sh-icon-button" style="height:30px;width:32px;margin:7px 0 0 auto" data-download-receipt="'+id+'" data-owner="'+(owner?'1':'0')+'" data-receipt="'+esc(p.receiptNumber||'SafeHouse-Receipt')+'">'+glyph('download')+'</button></div></div>';
  }
  function transactionList(payments,owner){
    return '<div class="sh-list">'+((payments||[]).length?(payments||[]).map(p=>transaction(p,owner)).join(''):emptyState('receipt','No payments yet','Verified payments and receipts will appear here.'))+'</div>';
  }
  renderLogin=function(role='OWNER'){
    const owner=role==='OWNER'; S.params.role=role;
    const content='<main class="login-page"><div class="login-wrap"><div class="sh-stage">'+
    '<div class="sh-login-art sh-stagger">'+mark()+'<div class="sh-brand-name">SafeHouse<span style="color:#e1ba79">.</span></div><span class="sh-brand-caption">Property and resident management</span></div>'+
    '<div class="sh-heading sh-stagger" style="text-align:center;margin-top:29px"><div class="sh-page-overline">SAFEHOUSE</div><h1 class="sh-h1">Manage your property with confidence.</h1><p class="sh-sub">Secure access for owners and residents.</p></div>'+
    '<section class="login-card sh-login-form sh-stagger"><div class="segmented"><button type="button" class="'+(owner?'active':'')+'" data-login-role="OWNER">Property owner</button><button type="button" class="'+(!owner?'active':'')+'" data-login-role="STUDENT">Resident</button></div>'+
    '<form id="login-form" data-role="'+esc(role)+'">'+
    '<div class="field"><label for="sh-email">EMAIL ADDRESS</label><div class="input-wrap"><span class="input-icon">'+glyph('mail')+'</span><input id="sh-email" class="input" name="email" type="email" autocomplete="username" placeholder="name@example.com" required></div></div>'+
    '<div class="field"><label for="login-password">PASSWORD</label><div class="input-wrap"><span class="input-icon">'+glyph('lock')+'</span><input id="login-password" class="input" name="password" type="password" autocomplete="current-password" placeholder="Your private password" required><button class="input-right" type="button" aria-label="Show or hide password" data-action="toggle-password">'+glyph('eye')+'</button></div></div>'+
    '<button class="sh-action-primary" type="submit">'+(owner?'Sign in as owner':'Sign in as resident')+' '+glyph('right')+'</button></form></section>'+
    '<div class="sh-security-foot sh-stagger">'+glyph('shield')+' Secure private access · SafeHouse</div>'+
    '<div class="login-credit sh-stagger">Crafted with care by <strong>Nikhil Maurya</strong></div></div></div></main>';
    $('#app').innerHTML=content;
  };
  renderOwnerHome=function(){
    const d=S.dashboard||{},m=d.metrics||{},p=d.period||S.period||periodNow();
    const name=esc((S.user?.fullName||'Owner').split(' ')[0]);
    const pct=Math.min(100,Math.max(0,Number(m.collectionRate)||0));
    const ringOffset=(270*(100-pct)/100).toFixed(2);
    const ring='<div class="sh-ring"><svg viewBox="0 0 100 100" aria-label="'+pct+' percent collected"><circle class="sh-ring-track" cx="50" cy="50" r="43"/><circle class="sh-ring-value" cx="50" cy="50" r="43" style="--ring-off:'+ringOffset+'"/></svg><span>'+pct+'%</span></div>';
    const property=esc(d.property?.name||S.property?.name||'SafeHouse PG');
    const months='<div class="month-nav" style="margin-top:13px"><button aria-label="Previous month" data-action="period-prev">‹</button><span>'+periodLabel(p)+'</span><button aria-label="Next month" data-action="period-next">›</button></div>';
    const intro=heading('OVERVIEW','Welcome back, '+name,
      '<button class="property-switch" data-action="properties"><b>'+property+'</b>'+glyph('down')+'</button>',months);
    const hero='<section class="sh-overview sh-stagger"><div class="sh-overview-label">Collected this month</div><div class="sh-overview-head"><div><div class="sh-overview-amount">'+money(m.totalCollectedPaise)+'</div><div class="sh-overview-sub">of '+money(m.totalExpectedPaise)+' expected</div></div>'+ring+'</div><div class="sh-track"><span style="width:'+pct+'%"></span></div><div class="sh-overview-foot"><div class="sh-balance">Awaiting collection<strong>'+money(m.pendingTotalPaise)+'</strong></div><span class="sh-badge">THIS MONTH</span></div></section>';
    const metrics='<div class="sh-metrics sh-stagger">'+metric(Number(m.totalStudents)||0,'Total residents','users')+metric(Number(m.paidStudents)||0,'Rent paid','checkcircle')+metric(Number(m.pendingStudents)||0,'Awaiting payment','calendar')+metric(Number(m.vacantBeds)||0,'Available beds','bed')+'</div>';
    const actions=section('Quick actions','', '<div class="sh-actions">'+quick('studentForm','plus','Add resident')+quick('rooms','bed','Manage rooms')+quick('dues','alert','Collect dues')+'</div>');
    const pending=Number(m.pendingStudents)||0,overdue=Number(m.overdueStudents)||0;
    const attention=section('Needs your attention','<button class="text-link" data-route="dues">Review all</button>',
      '<div class="sh-notice">'+glyph(pending?'alert':'checkcircle')+'<div><b>'+(pending?overdue+' overdue · '+pending+' awaiting payment':'Everything is up to date')+'</b><p>'+(pending?'Outstanding: '+money(m.pendingTotalPaise)+'. Review and send reminders.':'No outstanding rent needs attention this month.')+'</p></div></div>');
    const recent=section('Recent payments','<button class="text-link" data-route="ownerPayments">View all</button>',transactionList(d.recentPayments||[],true));
    frame(intro+hero+metrics+actions+attention+recent,'ownerHome');
  };
  renderStudentHome=function(){
    const d=S.studentDashboard||{},st=d.student||S.student||{},inv=d.currentInvoice,paid=inv?.status==='PAID';
    const name=esc((st.name||S.user?.fullName||'Resident').split(' ')[0]);
    const room=st.room?.number?'Room '+esc(st.room.number):'Your resident suite';
    const intro=heading('RESIDENT DASHBOARD','Hello, '+name,room+(st.bedLabel?' · Bed '+esc(st.bedLabel):''));
    const hero=inv?'<section class="sh-overview sh-stagger"><div class="sh-overview-label">'+periodLabel(inv)+' rent</div><div class="sh-overview-head"><div><div class="sh-overview-amount">'+(paid?'Paid in full':money(inv.remainingPaise??inv.totalPaise))+'</div><div class="sh-overview-sub">'+(paid?'Your rent is settled.': 'Due '+esc(dateFmt(inv.dueDate)))+'</div></div><span class="sh-badge">'+(paid?'SETTLED':'PAYMENT DUE')+'</span></div><div class="sh-detail-separator"></div><button class="sh-action-primary" data-route="'+(paid?'history':'pay')+'">'+(paid?'View receipt':'Pay rent securely')+' '+glyph(paid?'receipt':'right')+'</button></section>':
    '<section class="sh-panel sh-stagger">'+emptyState('calendar','All clear for now','Your monthly rent statement will appear here once generated.')+'</section>';
    const metrics='<div class="sh-invoice-grid sh-stagger">'+metric(esc(st.room?.number||'—'),'Your room','bed')+metric(money(st.securityDepositPaise),'Security deposit','shield')+'</div>';
    const actions=section('At your fingertips','', '<div class="sh-actions">'+quick('history','receipt','Rent history')+quick('profile','user','My details')+quick('pay','wallet','Pay rent')+'</div>');
    const recent=section('Payment activity','<button class="text-link" data-route="history">View history</button>',transactionList(d.recentPayments||[],false));
    frame(intro+hero+metrics+actions+recent,'studentHome');
  };
  renderStudents=function(status='ALL',query=''){
    const p=S.period||periodNow();
    const filters=['ALL','PAID','PENDING','OVERDUE'].map(x=>'<button class="chip filter-chip '+(status===x?'active':'')+'" data-student-filter="'+x+'">'+(x==='ALL'?'All':x[0]+x.slice(1).toLowerCase())+'</button>').join('');
    const intro=heading('RESIDENT MANAGEMENT','Residents','Manage resident information and rent status.',
      '<button class="sh-icon-button" data-route="studentForm" aria-label="Add resident">'+glyph('plus')+'</button>');
    const search='<div class="sh-stagger"><div class="search-wrap"><span>'+glyph('search')+'</span><input id="student-search" class="input" placeholder="Search names, rooms or contacts" autocomplete="off" value="'+esc(query)+'"/></div><div class="filter-row">'+filters+'</div></div>';
    const list=(S.students||[]).map(asResident).join('')||emptyState('users','No residents found',query?'Try a different search.':'Add a resident to begin.','<button class="btn primary" data-route="studentForm">Add resident</button>');
    const count='<div class="sh-section-top"><h2>'+((S.students||[]).length)+' residents</h2><div class="sh-micro">'+periodLabel(p)+'</div></div>';
    frame(intro+search+'<section class="sh-section sh-stagger" style="margin-top:18px!important">'+count+'<div class="sh-list">'+list+'</div></section>','students');
  };
  renderRooms=function(){
    const rooms=S.rooms||[],total=rooms.reduce((a,r)=>a+Number(r.capacity||0),0),occupied=rooms.reduce((a,r)=>a+Number(r.occupied||0),0);
    const intro=heading('PROPERTY MANAGEMENT','Rooms & beds',occupied+' occupied · '+Math.max(0,total-occupied)+' available',
      '<button class="sh-icon-button" data-route="roomForm" aria-label="Add room">'+glyph('plus')+'</button>');
    const overview='<div class="sh-metrics sh-stagger">'+metric(rooms.length,'Rooms','bed')+metric(total,'Total beds','users')+'</div>';
    const cards=rooms.map(r=>{
      const occ=Number(r.occupied)||0,capacity=Number(r.capacity)||0,vacant=Math.max(0,capacity-occ),pct=capacity?Math.min(100,occ/capacity*100):0;
      return '<article class="sh-panel"><div class="sh-topline" style="align-items:center"><div class="sh-room-number">'+esc(r.number)+'</div><div style="flex:1;min-width:0"><div class="sh-item-name">Room '+esc(r.number)+'</div><div class="sh-item-meta">'+occ+' of '+capacity+' beds occupied</div></div><span class="pill '+(vacant?'paid':'neutral')+'">'+(vacant?vacant+' available':'Full')+'</span><button class="icon-btn" style="width:35px;height:35px" aria-label="Edit room" data-edit-room="'+esc(r.id)+'" data-room-number="'+esc(r.number)+'" data-room-capacity="'+capacity+'">'+glyph('edit')+'</button></div><div class="sh-room-progress"><span style="width:'+pct+'%"></span></div><div class="sh-room-foot"><span>'+occ+' occupied</span><span>'+vacant+' vacant</span></div></article>';
    }).join('');
    const body=section('All rooms','<button class="text-link" data-route="roomForm">Add room</button>', '<div class="sh-list">'+(cards||emptyState('bed','No rooms yet','Create your first room to begin.','<button class="btn primary" data-route="roomForm">Add room</button>'))+'</div>');
    frame(intro+overview+body,'rooms');
  };
  renderDues=function(){
    const d=S.dues||{},p=d.period||S.period||periodNow();
    const months='<div class="month-nav"><button aria-label="Previous month" data-action="period-prev-dues">‹</button><span>'+periodLabel(p)+'</span><button aria-label="Next month" data-action="period-next-dues">›</button></div>';
    const intro=heading('RENT COLLECTIONS','Pending dues',(Number(d.overdueCount)||0)+' overdue · '+((d.dues||[]).length)+' awaiting payment',months);
    const summary='<div class="sh-callout sh-stagger"><small>Total outstanding</small><strong>'+money(d.totalDuePaise)+'</strong><p>'+periodLabel(p)+' · Verified collection overview</p></div>';
    const cards=(d.dues||[]).map(x=>{
      const name=x.student?.name||'Resident',r=x.student?.room||'—';
      return '<article class="sh-panel"><div class="sh-item" style="padding:0;background:transparent;border:0">'+itemAvatar(name)+
      '<div class="sh-item-main"><div class="sh-item-name">'+esc(name)+'</div><div class="sh-item-meta">Room '+esc(r)+' · Due '+esc(dateFmt(x.dueDate))+'</div></div><div class="sh-item-end"><strong>'+money(x.remainingPaise)+'</strong>'+safeStatus(x)+'</div></div>'+
      '<div class="sh-detail-separator"></div><div class="due-actions"><button class="btn secondary small" data-whatsapp="'+esc(x.whatsappUrl||'')+'">'+glyph('whatsapp')+' Remind</button>'+
      '<button class="btn green small" data-manual-payment="'+esc(x.id)+'" data-remaining="'+Number(x.remainingPaise||0)+'">Record payment</button></div>'+
      '<button class="text-link" data-edit-invoice="'+esc(x.id)+'" style="display:block;width:100%;text-align:center;margin-top:8px">Manage rent charges</button></article>';
    }).join('');
    frame(intro+summary+section('Collection queue','', '<div class="sh-list">'+(cards||emptyState('checkcircle','Nothing pending','Every rent account is clear for this period.'))+'</div>'),'dues');
  };
  renderOwnerPayments=function(){
    const p=S.period||periodNow();
    const intro=heading('FINANCIAL ACTIVITY','Payment ledger', 'Every verified transaction, in one place.');
    const sum=(S.payments||[]).reduce((v,p)=>v+Number(p.amountPaise||0),0);
    const overview='<div class="sh-metrics sh-stagger">'+metric((S.payments||[]).length,'Transactions','receipt')+metric(money(sum),'Total recorded','wallet')+'</div>';
    frame(intro+overview+section('Transactions','<span class="sh-micro">'+periodLabel(p)+'</span>',transactionList(S.payments||[],true)),'ownerPayments');
  };
  renderHistory=function(){
    const intro=heading('PAYMENT RECORDS','Rent history','Invoices, receipts, and a clear view of your rent.');
    const items=(S.invoices||[]).map(inv=>
      '<article class="sh-panel"><div class="sh-item" style="border:0;padding:0;background:transparent">'+
      '<div class="sh-metric-icon" style="margin:0;flex:0 0 auto">'+glyph(inv.status==='PAID'?'checkcircle':'calendar')+'</div>'+
      '<div class="sh-item-main"><div class="sh-item-name">'+periodLabel(inv)+' rent</div><div class="sh-item-meta">Due '+esc(dateFmt(inv.dueDate))+'</div></div>'+
      '<div class="sh-item-end"><strong>'+money(inv.totalPaise)+'</strong>'+safeStatus(inv)+'</div></div>'+
      ((inv.payments||[]).length?'<div class="sh-detail-separator"></div><div class="sh-list">'+inv.payments.map(p=>transaction(p,false)).join('')+'</div>':'')+
      '</article>').join('');
    frame(intro+section('Monthly statements','', '<div class="sh-list">'+(items||emptyState('receipt','No history yet','Your invoices and payments will appear here.'))+'</div>'),'history');
  };
  renderPay=function(){
    const inv=S.studentDashboard?.currentInvoice;
    if(!inv)return loadStudentHome();
    if(inv.status==='PAID'){toast('Rent already paid','success');return navigate('studentHome',{},true)}
    const intro=heading('SAFEHOUSE PAY','Settle your rent','Review your bill and choose a secure payment method.');
    const hero='<section class="sh-overview sh-stagger" style="text-align:center"><div class="sh-overview-label">Total amount due</div><div class="sh-checkout-value">'+money(inv.remainingPaise)+'</div><div class="sh-overview-sub">'+periodLabel(inv)+' · '+safeStatus(inv)+'</div></section>';
    const line=(label,v,negative)=>v?'<div class="bill-line"><span>'+esc(label)+'</span><strong style="'+(negative?'color:#8ed6ac':'')+'">'+(negative?'−':'')+money(v)+'</strong></div>':'';
    const bill='<section class="sh-panel sh-stagger"><div class="sh-ghost-header">Statement details</div>'+
      line('Monthly rent',inv.rentPaise)+line('Electricity',inv.electricityPaise)+line('Late fee',inv.lateFeePaise)+line('Additional charges',inv.otherChargesPaise)+line('Discount',inv.discountPaise,true)+
      '<div class="bill-line total"><span>Remaining balance</span><strong>'+money(inv.remainingPaise)+'</strong></div></section>';
    const secure='<div class="sh-security-foot sh-stagger">'+glyph('shield')+' Payment confirmed only after verified provider capture</div>';
    const cta='<div class="sh-sticky-action sh-stagger"><button class="sh-action-primary" id="pay-now" data-pay-invoice="'+esc(inv.id)+'">'+glyph('lock')+' Proceed to secure checkout '+glyph('right')+'</button></div>';
    frame(intro+hero+'<div style="height:14px"></div>'+bill+secure+cta,'studentHome',{title:'Secure payment',back:true});
  };
  renderProfile=function(){
    const owner=S.role==='OWNER',name=S.user?.fullName||'SafeHouse User';
    const intro=heading('ACCOUNT & PREFERENCES','Your profile','Manage your account and property settings.');
    const portrait='<section class="sh-panel sh-portrait sh-stagger"><div class="profile-avatar">'+esc(initials(name))+'</div><h2>'+esc(name)+'</h2><p>'+esc(S.user?.email||'')+'</p><span class="sh-badge">'+(owner?'PROPERTY OWNER':'RESIDENT')+'</span></section>';
    const details='<section class="sh-panel sh-stagger"><div class="sh-ghost-header">Account details</div><div class="sh-display-table">'+
    '<div class="detail-line"><span>Property</span><strong>'+esc(S.property?.name||'SafeHouse PG')+'</strong></div>'+
    (!owner&&S.student?'<div class="detail-line"><span>Room</span><strong>'+esc(S.student.room?.number||'Not assigned')+'</strong></div><div class="detail-line"><span>Mobile</span><strong>'+esc(S.student.mobile||'—')+'</strong></div>':'')+'</div></section>';
    const property=owner?'<section class="sh-panel sh-stagger"><div class="sh-section-top"><h2>Property settings</h2><button class="text-link" data-action="properties">Switch property</button></div><form id="property-form"><div class="field"><label>PROPERTY NAME</label><input class="input" name="name" value="'+esc(S.property?.name||'SafeHouse PG')+'" required></div><button class="btn secondary block" type="submit">Save property name</button></form></section>':'';
    const buttons='<div class="sh-stagger" style="display:grid;gap:10px;margin-top:13px"><button class="btn secondary block" data-route="changePassword">'+glyph('lock')+' Change password</button><button class="btn danger-soft block" data-action="logout">'+glyph('logout')+' Sign out securely</button></div>';
    frame(intro+portrait+'<div style="height:12px"></div>'+details+(owner?'<div style="height:12px"></div>'+property:'')+buttons+'<div class="sh-security-foot">SafeHouse · Privacy by design</div>','profile');
  };
  renderStudentDetail=function(st){
    if(!st)return navigate('students');
    const p=S.period||periodNow(),inv=st.periodInvoice||st.invoices?.find(x=>x.year===p.year&&x.month===p.month)||st.invoices?.[0];
    const intro=heading('RESIDENT MANAGEMENT','Resident details','Contact, room and rent details.');
    const portrait='<div class="sh-panel sh-portrait sh-stagger"><div class="profile-avatar">'+esc(initials(st.name))+'</div><h2>'+esc(st.name||'Resident')+'</h2><p>'+(st.room?.number?'Room '+esc(st.room.number):'No room assigned')+(st.bedLabel?' · '+esc(st.bedLabel):'')+'</p><span class="sh-badge">'+esc(st.status||'ACTIVE')+'</span></div>';
    const actions='<div class="sh-actions sh-stagger" style="margin:12px 0">'+
     '<a class="sh-action" href="tel:'+esc(st.mobile||'')+'">'+glyph('phone')+'Call resident</a>'+
     '<a class="sh-action" href="https://wa.me/91'+esc(String(st.mobile||'').slice(-10))+'">'+glyph('message')+'WhatsApp</a>'+
     '<button class="sh-action" data-edit-student="'+esc(st.id)+'">'+glyph('edit')+'Edit profile</button></div>';
    const attrs=[['Email',st.email||'—'],['Mobile',st.mobile||'—'],['Monthly rent',money(st.monthlyRentPaise)],['Security deposit',money(st.securityDepositPaise)],['Rent due', 'Day '+(Number(st.rentDueDay)||5)],['Joined',dateFmt(st.joiningDate)]];
    const about='<section class="sh-panel sh-stagger"><div class="sh-ghost-header">Resident information</div><div class="sh-display-table">'+attrs.map(a=>'<div class="detail-line"><span>'+esc(a[0])+'</span><strong>'+esc(a[1])+'</strong></div>').join('')+'</div></section>';
    const bill=inv?section('Rent account',safeStatus(inv),
      '<div class="sh-panel"><div class="bill-line"><span>'+periodLabel(inv)+' rent</span><strong>'+money(inv.rentPaise)+'</strong></div><div class="bill-line total"><span>Remaining</span><strong>'+money(inv.remainingPaise)+'</strong></div>'+
      (inv.status==='DUE'?'<div class="due-actions" style="margin-top:15px"><button class="btn secondary small" data-edit-invoice="'+esc(inv.id)+'">Edit bill</button><button class="btn green small" data-manual-payment="'+esc(inv.id)+'" data-remaining="'+Number(inv.remainingPaise||0)+'">Record payment</button></div>':'')+'</div>'):'';
    const history=(st.invoices||[]).length?section('Payment history','', '<div class="sh-list">'+st.invoices.map(x=>
      '<div class="sh-item"><div class="sh-item-main"><div class="sh-item-name">'+periodLabel(x)+'</div><div class="sh-item-meta">Due '+esc(dateFmt(x.dueDate))+'</div></div><div class="sh-item-end"><strong>'+money(x.totalPaise)+'</strong>'+safeStatus(x)+'</div></div>').join('')+'</div>'):'';
    const reset='<button class="btn secondary block sh-stagger" style="margin-top:18px" data-reset-student="'+esc(st.id)+'">'+glyph('lock')+' Reset resident password</button>';
    frame(intro+portrait+actions+about+bill+history+reset,'',{title:'Resident',back:true});
  };
  renderRoomForm=function(){
    const intro=heading('PROPERTY MANAGEMENT','Create a room','Create a comfortable space for residents.');
    const form='<section class="sh-panel sh-stagger"><div class="sh-progress-steps"><i></i><i></i><i></i></div><form id="room-form">'+
      '<div class="field"><label for="sh-room-number">ROOM NUMBER / NAME</label><input id="sh-room-number" class="input" name="number" required placeholder="e.g. A-101"></div>'+
      '<div class="field"><label for="sh-room-capacity">NUMBER OF BEDS</label><input id="sh-room-capacity" class="input" name="capacity" type="number" min="1" max="50" value="2" required></div>'+
      '<button type="submit" class="sh-action-primary">'+glyph('plus')+' Create room</button></form></section>';
    frame(intro+form,'',{title:'New room',back:true});
  };
  const oldStudentForm=renderStudentForm;
  renderStudentForm=async function(){
    const r=await oldStudentForm.apply(this,arguments);
    const root=document.querySelector('#student-form');
    if(root){
      const card=root.closest('.form-card,.card');
      if(card)card.classList.add('sh-panel');
      const pageHead=document.querySelector('.page-head');
      if(pageHead){pageHead.classList.add('sh-heading');const h=pageHead.querySelector('h1');if(h)h.classList.add('sh-h1');}
      root.querySelectorAll('label').forEach(l=>l.style.letterSpacing='.06em');
      const submit=root.querySelector('button[type="submit"]');if(submit){submit.classList.add('sh-action-primary');submit.classList.remove('primary');}
    }
    return r;
  };
  const oldChangePassword=renderChangePassword;
  renderChangePassword=function(){
    const r=oldChangePassword.apply(this,arguments);
    const root=document.querySelector('#password-form');
    if(root){const card=root.closest('.card');if(card)card.classList.add('sh-panel');const submit=root.querySelector('button[type="submit"]');if(submit){submit.classList.add('sh-action-primary');submit.classList.remove('primary');}}
    return r;
  };
  const priorShowModal=showModal;
  showModal=function(){
    const r=priorShowModal.apply(this,arguments);
    const modal=document.querySelector('#modal-root .modal');
    if(modal){modal.classList.add('sh-reveal');const first=modal.querySelector('input,select,textarea');if(first)first.setAttribute('autocomplete',first.getAttribute('autocomplete')||'off');}
    return r;
  };
  // Reset the stale inline Razorpay blue branding while preserving checkout verification.
  const previousStart=startPayment;
  startPayment=function(invoiceId,button){
    const originalNative=window.SafeHouseNative?.openRazorpay;
    if(originalNative && typeof originalNative==='function'){
      // The provider checkout remains responsible for app selection and live QR capability.
    }
    return previousStart(invoiceId,button);
  };
  window.__SAFEHOUSE_ATELIER_V3=true;
})();
