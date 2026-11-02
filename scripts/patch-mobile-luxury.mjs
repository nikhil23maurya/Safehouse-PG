import fs from 'node:fs';
const target='mobile/app/src/main/assets/index.html';
let html=fs.readFileSync(target,'utf8');
if(html.includes('SAFEHOUSE_LUXURY_V1')){console.log('Luxury skin already installed');process.exit(0);}
const css=fs.readFileSync('scripts/safehouse-luxury.css','utf8');
if(!html.includes('</style>')||!html.includes('</script>'))throw new Error('Missing SafeHouse mobile HTML boundaries');
html=html.replace('</style>',css+'\n</style>');
const addon=`
/* SAFEHOUSE_LUXURY_CHECKOUT_V1 - UI shell; Razorpay remains the regulated PSP. */
(function(){
 let busy=false;
 function svg(name){
  const paths={
   phone:'<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
   qr:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M15 14h2v2h-2zm4 0h2m-2 4h2v3h-3m-4-2v2h2"/>',
   shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>'
  };
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths[name]+'</svg>';
 }
 function dismiss(){document.getElementById('shpay-root')?.remove();}
 const original=startPayment;
 function openPayment(invoiceId,button){
  if(!invoiceId||busy)return;
  dismiss();
  const host=document.createElement('div');host.id='shpay-root';host.className='shpay-backdrop';
  host.innerHTML='<section class="shpay-sheet" role="dialog" aria-modal="true" aria-label="SafeHouse secure payments"><div class="shpay-handle"></div><div class="shpay-head"><div class="shpay-brand"><span class="shpay-logo">⌂</span> SafeHouse <span style="font-size:11px;color:#b18a58;font-weight:600">PAY</span></div><button type="button" class="shpay-close" aria-label="Close payment sheet" data-shpay-close>×</button></div><div class="shpay-eyebrow">A refined way to settle your stay</div><h2 class="shpay-title">Make your rent payment.</h2><p class="shpay-note">Complete payment securely using your preferred UPI app or Razorpay checkout.</p><div class="shpay-methods"><button type="button" class="shpay-method active" data-shpay-method="upi">'+svg('phone')+'<strong>Pay with UPI app</strong><span>PhonePe, GPay, BHIM & more</span></button><button type="button" class="shpay-method" data-shpay-method="qr">'+svg('qr')+'<strong>UPI QR</strong><span>Scan using another device</span></button></div><div class="shpay-panel" id="shpay-detail"><strong>Pay directly with UPI</strong><p>Choose your installed UPI app in secure checkout. Payment is verified with the bank.</p><button type="button" class="shpay-primary" data-shpay-submit>Continue securely</button></div><div class="shpay-safe">'+svg('shield')+' Payment processing is handled by Razorpay. SafeHouse confirms rent only after verified capture.</div></section>';
  document.body.appendChild(host);
  function renderPanel(method){
   const holder=host.querySelector('#shpay-detail');
   if(method==='qr'){
    holder.innerHTML='<strong>Scan & pay using UPI QR</strong><p>Open secure checkout to use its UPI QR option where supported by your device and payment provider. We do not display an unverified or static QR code.</p><button type="button" class="shpay-primary" data-shpay-submit>Open secure UPI checkout</button><p class="shpay-small">If QR is unavailable in the checkout, choose a supported UPI app instead.</p>';
   }else holder.innerHTML='<strong>Pay directly with UPI</strong><p>Choose your installed UPI app in secure checkout. Payment is verified with the bank.</p><button type="button" class="shpay-primary" data-shpay-submit>Continue securely</button>';
  }
  host.addEventListener('click',async e=>{
   if(e.target===host||e.target.closest('[data-shpay-close]')){dismiss();return}
   const method=e.target.closest('[data-shpay-method]');
   if(method){host.querySelectorAll('[data-shpay-method]').forEach(x=>x.classList.toggle('active',x===method));renderPanel(method.dataset.shpayMethod);return}
   if(e.target.closest('[data-shpay-submit]')){
    if(busy)return;busy=true;
    const control=e.target.closest('[data-shpay-submit]');control.disabled=true;control.textContent='Preparing secure checkout…';
    try{dismiss();await original(invoiceId,button||control)}catch(err){if(typeof toast==='function')toast(err?.message||'Could not open checkout','error')}finally{busy=false}
   }
  });
 }
 startPayment=openPayment;
})();
`;
html=html.replace('</script>',addon+'\n</script>');
fs.writeFileSync(target,html);
console.log('SafeHouse Luxury design and branded secure checkout installed');
