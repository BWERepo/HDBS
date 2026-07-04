// ── IMAGE LIGHTBOX ──
var LB_IMGS=[];var LB_IDX=0;
var LB_ALT='';
function openLightbox(imgs,idx,altText){
  LB_IMGS=imgs;LB_IDX=idx||0;LB_ALT=altText||'';
  var lbImg=document.getElementById('lightbox-img');
  lbImg.src=LB_IMGS[LB_IDX];
  lbImg.alt=LB_ALT?(LB_ALT+(LB_IMGS.length>1?' photo '+(LB_IDX+1):'')):'';
  document.getElementById('lightbox').classList.add('on');
  document.body.style.overflow='hidden';
  updateLightboxCounter();
}
function closeLightbox(){
  document.getElementById('lightbox').classList.remove('on');
  document.body.style.overflow='';
}
function lightboxNav(dir){
  LB_IDX=(LB_IDX+dir+LB_IMGS.length)%LB_IMGS.length;
  var img=document.getElementById('lightbox-img');
  img.style.opacity='0';
  setTimeout(function(){
    img.src=LB_IMGS[LB_IDX];
    img.alt=LB_ALT?(LB_ALT+(LB_IMGS.length>1?' photo '+(LB_IDX+1):'')):'';
    img.style.opacity='1';
    updateLightboxCounter();
  },120);
}
function updateLightboxCounter(){
  var el=document.getElementById('lightbox-counter');
  if(LB_IMGS.length>1)el.textContent=(LB_IDX+1)+' / '+LB_IMGS.length;
  else el.textContent='';
  // Hide nav arrows if only one image
  var pv=document.querySelector('.lightbox-prev'),nx=document.querySelector('.lightbox-next');
  if(pv)pv.style.display=LB_IMGS.length>1?'flex':'none';
  if(nx)nx.style.display=LB_IMGS.length>1?'flex':'none';
}
// Keyboard navigation
document.addEventListener('keydown',function(e){
  var lb=document.getElementById('lightbox');
  if(!lb.classList.contains('on'))return;
  if(e.key==='Escape')closeLightbox();
  if(e.key==='ArrowLeft')lightboxNav(-1);
  if(e.key==='ArrowRight')lightboxNav(1);
});

// ── STICKY NAV SCROLL EFFECT ──
window.addEventListener('scroll',function(){
  var navs=document.querySelectorAll('nav');
  for(var i=0;i<navs.length;i++){
    navs[i].classList.toggle('scrolled',window.scrollY>40);
  }
},{passive:true});

function tryLoad(){
  // Load Square fee config
  apiFetch('admin.php','POST',{action:'get_setting',key:'square_fees'}).then(function(d){
    if(d.success&&d.value){try{var f=JSON.parse(d.value);SQ_FEE_PCT=f.pct||2.6;SQ_FEE_CENTS=f.cents||0.10;}catch(e){}}
  }).catch(function(){});
  // Load tax rates config
  apiFetch('admin.php','POST',{action:'get_setting',key:'tax_rates'}).then(function(d){
    if(d.success&&d.value){try{var t=JSON.parse(d.value);if(t&&typeof t==='object')TAX_RATES=t;}catch(e){}}
  }).catch(function(){});
  // Show skeleton immediately
  showSkeleton();
  // Load cached products for instant display (no images)
  try{
    var cached=localStorage.getItem('suzi_products_cache');
    if(cached){
      var parsed=JSON.parse(cached);
      if(parsed&&parsed.length){PRODS=parsed;renderStore();injectProductSchemas();}
    }
  }catch(e){}
  // Fetch all products from DB
  apiFetch('products.php').then(function(d){
    if(d.success&&d.products){
      PRODS=d.products;
      try{localStorage.setItem('suzi_products_cache',JSON.stringify(stripImgs(PRODS)));}catch(e){}
      renderStore();injectProductSchemas();
    }
    checkThankYou();checkProductParam();
  }).catch(function(){renderStore();checkThankYou();});
  // Load reviews
  loadReviews();
  // Pre-load FAQs
  apiFetch('faqs.php').then(function(d){if(d.success)FAQS=d.faqs||[];}).catch(function(){});
  // Load shipping config (zone rates, free threshold, weight tiers)
  // Load saved product categories and prefixes
  apiFetch('admin.php','POST',{action:'get_setting',key:'product_categories'}).then(function(d){
    if(d.success&&d.value){try{var cats=JSON.parse(d.value);if(Array.isArray(cats)&&cats.length){CATS=cats;if(typeof renderCatFilter==='function')renderCatFilter();}}catch(e){}}
  }).catch(function(){});
  apiFetch('admin.php','POST',{action:'get_setting',key:'cat_prefixes'}).then(function(d){
    if(d.success&&d.value){try{
      var cp=JSON.parse(d.value);
      if(cp&&typeof cp==='object'){
        CAT_PREFIXES=cp;
        // Re-render cats panel if it's currently visible
        var acnt=document.getElementById('acnt');
        if(acnt&&document.getElementById('cat-list'))rCats(acnt);
      }
    }catch(e){}}
  }).catch(function(){});
  apiFetch('admin.php','POST',{action:'get_setting',key:'shipping_config'}).then(function(d){
    if(d.success&&d.value){try{applyShippingConfig(JSON.parse(d.value));}catch(e){}}
  }).catch(function(){});
  // Load Payment Configuration from DB - applies to all browsers (Online | InPerson | Test)
  apiFetch('admin.php','POST',{action:'get_setting',key:'payment_configuration'}).then(function(md){
    if(md.success&&md.value)PAY_CONFIG=md.value;
  }).catch(function(){});
  // Load Square Payment Mode from DB - overrides the hostname-based default (live | test)
  apiFetch('admin.php','POST',{action:'get_setting',key:'square_mode'}).then(function(md){
    if(md.success&&md.value)SQUARE_MODE=md.value;
  }).catch(function(){});
  // Load confirm token for order_confirm.php auth
  apiFetch('admin.php','POST',{action:'get_setting',key:'confirm_token'}).then(function(d){
    if(d.success&&d.value)window._confirmToken=d.value;
  }).catch(function(){});
}
function checkProductParam(){
  var params=new URLSearchParams(window.location.search);
  var pid=params.get('p');
  if(pid&&typeof findProd==='function'&&findProd(pid)){
    history.replaceState({},'',window.location.pathname);
    openPD(pid);
  }
}
function checkThankYou(){
  var params=new URLSearchParams(window.location.search);
  if(params.get('thankyou')==='1'){
    var oid=params.get('order')||'';
    document.getElementById('ty-order-id').textContent=oid?'Order #'+oid:'';
    openModal('ty-modal');
    window.history.replaceState({},'',window.location.pathname);
    if(oid&&!sessionStorage.getItem('vp_'+oid)){
      sessionStorage.setItem('vp_'+oid,'1');
      fetch(SITE_ORIGIN+'/verify_payment.php',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({order_id:oid})
      }).then(function(r){return r.json();})
      .then(function(){/* payment status polled silently */})
      .catch(function(e){console.error('VP error:',e);});
    }
  }
}
function trySave(){
  // Individual save calls handle their own persistence
  // This is kept as a no-op for compatibility
}

// ── NEWSLETTER ──
function nlSubscribe(){
  var em=document.getElementById('nl-email').value.trim();
  var err=document.getElementById('nl-err');
  var ok=document.getElementById('nl-ok');
  err.classList.remove('on');ok.classList.remove('on');
  if(!em||em.indexOf('@')<0){err.textContent='Please enter a valid email address.';err.classList.add('on');return;}
  for(var i=0;i<SUBS.length;i++){
    if(SUBS[i].email===em){err.textContent='You\'re already subscribed — thank you!';err.classList.add('on');return;}
  }
  apiFetch('subscribers.php','POST',{email:em}).then(function(d){
    if(!d.success){err.textContent=d.error||'Subscription failed.';err.classList.add('on');return;}
    document.getElementById('nl-email').value='';
    ok.classList.add('on');
  }).catch(function(){err.textContent='Network error. Please try again.';err.classList.add('on');});
}
function seed(){return[];} // Not used with database

