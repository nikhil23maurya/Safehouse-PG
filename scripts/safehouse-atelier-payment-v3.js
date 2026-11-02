(function checkout() {
  'use strict';
  let statusTimer=null, pending=false, current=null;
  function fmt(n){return moneyP(Number(n)||0)}
  function ico(n){return icon(n)}
  function modal(){return document.getElementById('sh-final-pay')}
  function close(){if(statusTimer){clearTimeout(statusTimer);statusTimer=null}modal()?.remove();document.body.classList.remove('sh-pay-open');current=null}
  function qrValid(d){return !!(d?.qr?.id?.startsWith('qr_')&&/^https:\/\//.test(d.qr.imageUrl||'')&&Number(d.qr.amountPaise)>0)}
  function status(txt,isError=false){
    const x=modal()?.querySelector('#sh-pay-status');
    if(x){x.textContent=txt;x.style.color=isError?'#b4444e':'#637588';}
  }
  function renderQr(){
    const holder=modal()?.querySelector('#sh-pay-view');
    if(!holder)return;
    const x=current?.qr;
    if(!x){holder.innerHTML='<div class="sh-pay-loader"><div class="spinner"></div><p>Creating your secure, one-time rent QR…</p></div>';return}
    holder.innerHTML='<div class="sh-pay-qr-card"><div class="sh-pay-qr-frame"><img src="'+esc(x.imageUrl)+'" alt="Invoice-linked UPI payment QR" loading="eager"></div><div class="sh-pay-qr-meta"><strong>'+fmt(x.amountPaise)+'</strong><span>Invoice-linked · Single use</span></div></div>'+
    '<p class="sh-pay-instruction">Scan from another phone, or save the QR and open it from your UPI app gallery. Your rent updates after confirmed payment.</p>'+
    '<div class="sh-pay-row"><button class="sh-pay-tertiary" data-shpay-save>'+ico('download')+' Save QR</button><button class="sh-pay-tertiary" data-shpay-tab="app">'+ico('wallet')+' Use this phone</button></div>';
    const image=holder.querySelector('.sh-pay-qr-frame img');
    if(image)image.addEventListener('error',()=>{
      const frame=holder.querySelector('.sh-pay-qr-frame');
      if(frame){frame.textContent='QR image could not load. Check your internet connection.';frame.style.padding='18px';}
    });
  }
  function renderApps(){
    const holder=modal()?.querySelector('#sh-pay-view');if(!holder)return;
    const x=current?.qr;
    if(!x){holder.innerHTML='<div class="sh-pay-loader"><div class="spinner"></div><p>Preparing your secure rent QR…</p></div>';return}
    holder.innerHTML='<div class="sh-pay-app-intro"><div class="sh-pay-app-badge">'+ico('shield')+'</div><h3>Pay using your UPI app.</h3><p>Save this one-time QR, open your UPI app and choose <strong>Scan from gallery</strong>. Review the payee and amount before authorising.</p></div>'+
    '<div class="sh-pay-app-actions"><button class="sh-action-primary" data-shpay-save>'+ico('download')+' 1. Save payment QR</button>'+
    (current?.intentUrl?'<button class="sh-action-primary" data-shpay-intent>Pay directly with UPI</button>':'<button class="sh-pay-tertiary" data-shpay-open>'+ico('wallet')+' 2. Open a UPI app</button>')+'</div>'+
    '<p class="sh-pay-caveat">Direct prefilled UPI payment is only offered when the payment provider supplies a verified UPI Intent. No personal UPI IDs or untracked transfers are used.</p>';
  }
  function choose(tab){
    const root=modal();if(!root)return;
    root.querySelectorAll('[data-shpay-tab]').forEach(b=>b.classList.toggle('active',b.dataset.shpayTab===tab));
    if(tab==='qr')renderQr();else renderApps();
  }
  async function fetchQr(invoiceId){
    status('Connecting securely to payment provider…');
    try{
      const d=await api('/api/student/payments/upi-qr',{method:'POST',body:{invoiceId}});
      if(!modal())return;
      if(!qrValid(d))throw new Error('The payment provider did not return a valid QR. No payment was started.');
      current={qr:d.qr, intentUrl: typeof d.intentUrl==='string' && /^upi:\/\/pay\?/.test(d.intentUrl)?d.intentUrl:null};
      choose(modal()?.querySelector('[data-shpay-tab].active')?.dataset.shpayTab||'qr');
      status('Waiting for secure bank confirmation');
      schedulePoll();
    }catch(e){
      if(!modal())return;
      const detail=errorMessage(e);
      const message=/UPI_QR_NOT_ENABLED|not activated|not enabled/i.test(detail)?'UPI QR is not enabled for this merchant yet. The owner must activate Razorpay QR API and configure the signed webhook.':(/route not found|not found/i.test(detail)?'Your payment server appears to be outdated or unavailable. Update the backend before making a payment.':detail);
      const holder=modal().querySelector('#sh-pay-view');
      if(holder)holder.innerHTML='<div class="sh-pay-error"><div style="font-size:25px;color:#e3bb82">!</div><h3>Secure QR unavailable</h3><p>'+esc(message)+'</p><button class="sh-pay-tertiary" data-shpay-retry>Try again</button></div>';
      status('Payment not started',true);
    }
  }
  function schedulePoll(){
    if(statusTimer)clearTimeout(statusTimer);
    let checks=0;
    const poll=async()=>{
      if(!modal()||!current?.qr?.id)return;
      try{
        const r=await api('/api/student/payments/orders/'+encodeURIComponent(current.qr.id)+'/status');
        if(!modal())return;
        if(r.paid===true && r.invoiceStatus==='PAID'){
          const amount=current.qr.amountPaise;
          const captured=r.attemptStatus==='CAPTURED';
          close();
          S.studentDashboard=null;
          if(captured)showPaymentSuccess(amount);
          else {navigate('studentHome',{},true);toast('Rent was settled through another payment','success')}
          return;
        }
        if(r.attemptStatus==='FAILED'){status('Payment failed or expired. Please refresh your QR.',true);return}
        if(Number(current.qr.expiresAt)>0 && Date.now()>Number(current.qr.expiresAt)*1000){
          status('QR expired. Tap Refresh QR to create a new one.',true);
          const b=modal()?.querySelector('#sh-pay-refresh');if(b)b.hidden=false;
          return;
        }
        checks++;
      }catch(e){
        // A dropped network connection must never imply payment failure or success.
        status('Still waiting for bank confirmation · check internet connection');
      }
      if(modal()&&current)statusTimer=setTimeout(poll,checks<20?4000:9000);
    };
    statusTimer=setTimeout(poll,3000);
  }
  function open(invoiceId){
    if(pending||!invoiceId)return;
    close();
    const inv=S.studentDashboard?.currentInvoice;
    if(!inv||inv.id!==invoiceId||inv.status==='PAID'){toast('Refresh your rent invoice first','error');return}
    const node=document.createElement('div');
    node.id='sh-final-pay';node.className='sh-pay-overlay';
    node.innerHTML='<div class="sh-pay-container" role="dialog" aria-modal="true" aria-label="SafeHouse secure UPI checkout"><div class="sh-pay-handle"></div>'+
    '<div class="sh-pay-header"><div class="sh-pay-wordmark"><span class="sh-pay-mark">'+ico('home')+'</span> SafeHouse<span class="sh-pay-gold">Pay</span></div><button class="sh-pay-x" data-shpay-close aria-label="Close checkout">×</button></div>'+
    '<div class="sh-pay-amount-label">SECURE RENT SETTLEMENT</div><div class="sh-pay-amount">'+fmt(inv.remainingPaise)+'</div><div class="sh-pay-identity">'+esc(monthName(inv.year,inv.month))+' · '+esc(S.property?.name||'Your property')+'</div>'+
    '<div class="sh-pay-tabs"><button data-shpay-tab="qr" class="active">'+ico('grid')+' Scan QR</button><button data-shpay-tab="app">'+ico('wallet')+' UPI app</button></div>'+
    '<div id="sh-pay-view"></div><div class="sh-pay-foot"><div class="sh-pay-dot"></div><span id="sh-pay-status" aria-live="polite">Preparing payment…</span><button id="sh-pay-refresh" data-shpay-retry hidden>Refresh QR</button></div>'+
    '<div class="sh-pay-security">'+ico('shield')+' Secure provider-verified payments. Rent is marked paid only after confirmed capture.</div></div>';
    document.body.appendChild(node);
    document.body.classList.add('sh-pay-open');
    renderQr();
    fetchQr(invoiceId);
    node.addEventListener('click',e=>{
      const b=e.target.closest('button');
      if(e.target===node||b?.hasAttribute('data-shpay-close')){dismiss();return}
      if(!b)return;
      if(b.dataset.shpayTab){choose(b.dataset.shpayTab);return}
      if(b.hasAttribute('data-shpay-retry')){current=null;const x=modal()?.querySelector('#sh-pay-refresh');if(x)x.hidden=true;fetchQr(invoiceId);return}
      if(b.hasAttribute('data-shpay-save')){
        if(!current?.qr?.imageUrl)return;
        if(window.SafeHouseNative?.savePaymentQr)window.SafeHouseNative.savePaymentQr(current.qr.imageUrl);
        else {
          const a=document.createElement('a');a.href=current.qr.imageUrl;a.target='_blank';a.rel='noopener';a.click();
          toast('Save or screenshot the QR, then scan it with your UPI app');
        }
        return;
      }
      if(b.hasAttribute('data-shpay-open')){
        if(window.SafeHouseNative?.openUpiApp)window.SafeHouseNative.openUpiApp();
        else toast('Open your UPI app and select Scan from Gallery.');
        return;
      }
      if(b.hasAttribute('data-shpay-intent') && current?.intentUrl && window.SafeHouseNative?.openVerifiedUpiIntent)window.SafeHouseNative.openVerifiedUpiIntent(current.intentUrl);
    });
  }
  function dismiss(){close();document.body.classList.remove('sh-pay-open')}
  // This override deliberately does NOT invoke the old Razorpay SDK or the previous branded wrapper.
  startPayment=function(invoiceId,btn){open(invoiceId)};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modal())dismiss()});
  const originalNavigate=navigate;
  navigate=function(){if(modal())dismiss();return originalNavigate.apply(this,arguments)};
  window.__SAFEHOUSE_QR_CHECKOUT_V3=true;
})();