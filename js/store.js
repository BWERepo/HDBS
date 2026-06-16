// ── STORE RENDER ──
function firstImg(p){return(p.imgs&&p.imgs[0])||p.img||'';}
function renderCatFilter(){
  var el=document.getElementById('cat-filter');if(!el)return;
  var allCats=['All'].concat(CATS);
  var h='';
  for(var i=0;i<allCats.length;i++){
    var active=allCats[i]===ACTIVE_CAT;
    h+='<button onclick="setActiveCat(\''+allCats[i]+'\')" style="'+
      'background:'+(active?'#d4a017':'#fff')+';'+
      'color:'+(active?'#fff':'#6b6040')+';'+
      'border:1.5px solid '+(active?'#d4a017':'#e8e0b8')+';'+
      'padding:.32rem .85rem;border-radius:20px;cursor:pointer;font-size:.8rem;'+
      'font-family:sans-serif;font-weight:'+(active?'700':'500')+'">'+allCats[i]+'</button>';
  }
  el.innerHTML=h;
}
function setActiveCat(cat){
  ACTIVE_CAT=cat;
  renderCatFilter();
  renderStore();
}
function renderStore(){
  var g=document.getElementById('pgrid'),h='';
  // Only show products listed for sale (sell !== 0)
  var forSale=PRODS.filter(function(p){return p.sell!==0;});
  var filtered=ACTIVE_CAT==='All'?forSale:forSale.filter(function(p){return p.cat===ACTIVE_CAT;});
  renderCatFilter();
  for(var i=0;i<filtered.length;i++){
    var p=filtered[i];
    var imgs=p.imgs||[p.img||''];
    var validImgs=[];for(var x=0;x<imgs.length;x++)if(imgs[x])validImgs.push(imgs[x]);
    var imgHtml='';
    if(validImgs.length>0){
      imgHtml='<img src="'+validImgs[0]+'">';
      if(validImgs.length>1){imgHtml+='<div class="cimg-dots">';for(var d=0;d<validImgs.length;d++)imgHtml+='<div class="cimg-dot'+(d===0?' on':'')+'"></div>';imgHtml+='</div>';}
    } else {imgHtml='<div style="font-size:3rem;opacity:.28">👜</div>';}
    var qvMeta='';
    if(p.cat)qvMeta+=p.cat;
    if(p.stock>0&&p.stock<=5)qvMeta+=(qvMeta?' · ':'')+p.stock+' left!';
    h+='<div class="card" onclick="openPD(\''+p.id+'\')" style="position:relative;overflow:hidden">'+
      '<div class="cimg" style="position:relative">'+imgHtml+
      (p.stock<=0?'<div style="position:absolute;inset:0;pointer-events:none;overflow:hidden">'+
        '<svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0">'+
          '<line x1="0" y1="0" x2="100" y2="100" stroke="#c62828" stroke-width="6" stroke-linecap="round" vector-effect="non-scaling-stroke"/>'+
        '</svg>'+
        '<div style="position:absolute;bottom:8px;left:0;right:0;text-align:center">'+
          '<span style="background:rgba(198,40,40,.88);color:#fff;font-size:.7rem;font-weight:700;padding:2px 10px;border-radius:4px;letter-spacing:.05em">SOLD OUT</span>'+
        '</div>'+
      '</div>':'')+'</div>'+
      '<h3>'+p.name+'</h3><p>'+p.desc+'</p>'+
      '<div class="cfoot"><span class="price">$'+p.price.toFixed(2)+'</span>'+
      '<button class="acb'+(p.stock<=0?' os':'')+'" onclick="event.stopPropagation();'+(p.stock<=0?'':'addToCart(\''+p.id+'\')')+(p.stock<=0?' return false':'')+'" '+(p.stock<=0?'disabled':'')+'>'+(p.stock>0?'Add to Cart':'Sold Out')+'</button>'+
      '</div>'+
      '<div class="card-qv" onclick="event.stopPropagation()">'+
        '<div class="qv-name">'+p.name+'</div>'+
        '<div class="qv-price">$'+p.price.toFixed(2)+'</div>'+
        (qvMeta?'<div class="qv-meta">'+qvMeta+'</div>':'')+
        (p.size?'<div style="font-size:.72rem;font-family:monospace;color:#a07810;margin:.15rem 0;letter-spacing:.04em">Size: '+p.size+'</div>':'')+
        (p.sku?'<div style="font-size:.72rem;font-family:monospace;color:#a07810;margin:.15rem 0;letter-spacing:.04em">SKU: '+p.sku+'</div>':'')+
        '<div class="qv-btns">'+
          '<button class="qv-add'+(p.stock<=0?' os':'')+'" '+(p.stock<=0?'disabled':"onclick=\"addToCart('"+p.id+"');\"")+'>'+
            (p.stock>0?'🛒 Add to Cart':'Sold Out')+'</button>'+
          '<button class="qv-view" onclick="openPD(\''+p.id+'\')" >View Details →</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  }
  g.innerHTML=h||'<p style="grid-column:1/-1;text-align:center;padding:3rem;color:#6b6040">'+(ACTIVE_CAT==='All'?'No products yet.':'No products in this category.')+'</p>';
}

// ── PRODUCT DETAIL with gallery ──
var PD_CUR=0;
function openPD(id){
  var p=findProd(id);if(!p)return;
  var imgs=p.imgs||[p.img||''];
  var validImgs=[];for(var x=0;x<imgs.length;x++)if(imgs[x])validImgs.push(imgs[x]);
  PD_CUR=0;
  var gallerySlides='',dots='',thumbsHtml='';
  if(validImgs.length===0){
    gallerySlides='<div class="gallery-img on"><div class="no-img">👜</div></div>';
  } else {
    for(var i=0;i<validImgs.length;i++){
      gallerySlides+='<div class="gallery-img'+(i===0?' on':'')+'" id="gslide-'+i+'"><img src="'+validImgs[i]+'" alt="'+p.name+'"></div>';
      dots+='<button class="gdot'+(i===0?' on':'')+'" onclick="goSlide('+i+')"></button>';
    }
    if(validImgs.length>1){
      thumbsHtml='<div class="pd-thumbs">';
      for(var t=0;t<validImgs.length;t++)thumbsHtml+='<img class="pd-thumb'+(t===0?' on':'')+'" src="'+validImgs[t]+'" onclick="goSlide('+t+')">';
      thumbsHtml+='</div>';
    }
  }
  var navBtns=validImgs.length>1?'<div class="gallery-nav"><button class="gnav-btn" onclick="goSlide(PD_CUR-1)">‹</button><button class="gnav-btn" onclick="goSlide(PD_CUR+1)">›</button></div>':'';
  var dotsHtml=validImgs.length>1?'<div class="gallery-dots">'+dots+'</div>':'';
  var badgeHtml=p.badge?'<div class="detail-badge">'+p.badge+'</div>':'';
  var stockHtml=p.stock>0?'<div class="detail-stock" style="color:#2e7d32">✓ '+p.stock+' in stock</div>':'<div class="detail-stock" style="color:#c0392b">✗ Out of stock</div>';
  document.getElementById('pd-content').innerHTML=
    '<nav style="background:#fff;border-bottom:1px solid #e8e0b8;padding:.75rem 1.5rem;position:sticky;top:0;z-index:10">'+
    '<button class="pd-back" onclick="closePD()">← Back to Shop</button></nav>'+
    '<div class="pd-layout">'+
      '<div>'+
        '<div class="gallery" id="pd-gallery">'+gallerySlides+navBtns+dotsHtml+'</div>'+
        thumbsHtml+
      '</div>'+
      '<div class="detail-body">'+
        badgeHtml+
        '<div class="detail-name">'+p.name+'</div>'+
        '<div class="detail-price">$'+p.price.toFixed(2)+'</div>'+
        '<div class="detail-desc">'+p.desc+'</div>'+
        stockHtml+
        (p.sku?'<div style="font-size:.78rem;font-family:monospace;color:#a07810;margin-bottom:.3rem;letter-spacing:.04em">SKU: '+p.sku+'</div>':'')+
        '<div class="detail-cat">Category: '+p.cat+(p.weight?' &nbsp;·&nbsp; '+p.weight+' lbs':'')+'</div>'+
        (p.size?'<div style="font-size:.85rem;color:#2d2220;margin-bottom:.6rem;"><strong>Size:</strong> '+p.size+'</div>':'')+

        '<button class="detail-add'+(p.stock<=0?' os':'')+'" id="pdadd-btn" data-pid="'+p.id+'"'+(p.stock<=0?' disabled':'')+'>'+
        (p.stock>0?'🛒 Add to Cart':'Out of Stock')+'</button>'+
      '</div>'+
    '</div>';
  window._pdImgs=validImgs;window._pdTotal=validImgs.length;
  // Wire gallery images to open lightbox
  setTimeout(function(){
    var galImgs=document.querySelectorAll('#pd-page .gallery-img img');
    for(var gi=0;gi<galImgs.length;gi++){
      (function(idx){
        galImgs[idx].onclick=function(e){
          e.stopPropagation();
          openLightbox(window._pdImgs,idx);
        };
      })(gi);
    }
  },50);
  // Wire Add to Cart button immediately after innerHTML is set
  var pdBtn=document.getElementById('pdadd-btn');
  if(pdBtn&&!pdBtn.disabled){
    (function(pid){pdBtn.onclick=function(){addToCart(pid);};})(p.id);
  }
  // Switch to product page
  var pages=['store','authpage','alog','apanel','pd-page'];
  for(var pi=0;pi<pages.length;pi++){
    var pel=document.getElementById(pages[pi]);
    if(pel)pel.style.display=(pages[pi]==='pd-page'?'block':'none');
  }
  window.scrollTo(0,0);
}
function closePD(){
  var pages=['store','authpage','alog','apanel','pd-page'];
  for(var pi=0;pi<pages.length;pi++){
    var pel=document.getElementById(pages[pi]);
    if(pel)pel.style.display=(pages[pi]==='store'?'block':'none');
  }
  updateNav();
}
function goSlide(n){
  var total=window._pdTotal||0;if(total<=1)return;
  PD_CUR=(n+total)%total;
  var slides=document.querySelectorAll('.gallery-img');
  var dots2=document.querySelectorAll('.gdot');
  var thumbs=document.querySelectorAll('.pd-thumb');
  for(var i=0;i<slides.length;i++)slides[i].classList.toggle('on',i===PD_CUR);
  for(var j=0;j<dots2.length;j++)dots2[j].classList.toggle('on',j===PD_CUR);
  for(var k=0;k<thumbs.length;k++)thumbs[k].classList.toggle('on',k===PD_CUR);
}

// ── PHONE FORMATTER ──
function fmtPhone(input){
  var v=input.value.replace(/\D/g,'').substring(0,10);
  if(v.length>=7) v='('+v.substring(0,3)+') '+v.substring(3,6)+'-'+v.substring(6);
  else if(v.length>=4) v='('+v.substring(0,3)+') '+v.substring(3);
  else if(v.length>0) v='('+v;
  input.value=v;
}

// ── CART ──
function openCart(){document.getElementById('cart-ov').classList.add('on');document.getElementById('cart-drawer').classList.add('on');renderCart();}
function closeCart(){document.getElementById('cart-ov').classList.remove('on');document.getElementById('cart-drawer').classList.remove('on');}
function addToCart(id){
  var p=findProd(id);if(!p||p.stock<=0)return;
  var ex=null;for(var i=0;i<CART.length;i++)if(CART[i].id===id){ex=CART[i];break;}
  if(ex){if(ex.q<p.stock)ex.q++;}else CART.push({id:id,q:1});
  updCartCount();renderCart();openCart();
}
function remFromCart(id){var nc=[];for(var i=0;i<CART.length;i++)if(CART[i].id!==id)nc.push(CART[i]);CART=nc;updCartCount();renderCart();}
function chCartQ(id,d){
  var p=findProd(id);
  for(var i=0;i<CART.length;i++){if(CART[i].id===id){CART[i].q=Math.max(0,Math.min(CART[i].q+d,p?p.stock:99));if(CART[i].q===0){remFromCart(id);return;}break;}}
  updCartCount();renderCart();
}
function cartTotal(){var s=0;for(var i=0;i<CART.length;i++){var p=findProd(CART[i].id);if(p)s+=p.price*CART[i].q;}return s;}
var SHIP_ZONES={
  // Zone 1 — Tennessee
  'TN':1,
  // Zone 2 — South
  'AL':2,'AR':2,'FL':2,'GA':2,'KY':2,'LA':2,'MS':2,'NC':2,'SC':2,'VA':2,'WV':2,'OK':2,'TX':2,
  // Zone 3 — East Coast
  'CT':3,'DE':3,'MA':3,'MD':3,'ME':3,'NH':3,'NJ':3,'NY':3,'PA':3,'RI':3,'VT':3,'DC':3,
  // Zone 4 — Midwest
  'IA':4,'IL':4,'IN':4,'KS':4,'MI':4,'MN':4,'MO':4,'ND':4,'NE':4,'OH':4,'SD':4,'WI':4,
  // Zone 5 — West
  'AK':5,'AZ':5,'CA':5,'CO':5,'HI':5,'ID':5,'MT':5,'NM':5,'NV':5,'OR':5,'UT':5,'WA':5,'WY':5
};
var ZONE_RATES=[0,1,1,1,1,1]; // loaded from DB — fallback matches DB defaults
var FREE_THRESHOLD=75;

function applyShippingConfig(cfg){
  if(!cfg)return;
  if(cfg.zone_rates&&Array.isArray(cfg.zone_rates))ZONE_RATES=cfg.zone_rates;
  if(cfg.free_threshold!==undefined)FREE_THRESHOLD=cfg.free_threshold;
  if(cfg.weight_tiers&&Array.isArray(cfg.weight_tiers))WEIGHT_TIERS=cfg.weight_tiers;
}
function getZone(stateStr){
  // Extract 2-letter state abbreviation from address string
  if(!stateStr)return 3; // default to Zone 3
  var m=stateStr.toUpperCase().match(/\b([A-Z]{2})\b/);
  if(!m)return 3;
  return SHIP_ZONES[m[1]]||3;
}
function getStateTaxRate(stateStr,cityStr){
  if(!stateStr)return 0;
  var m=stateStr.toUpperCase().match(/\b([A-Z]{2})\b/);
  if(!m)return 0;
  var state=m[1];
  if(state==='TN'){
    var city=(cityStr||'').toLowerCase().trim();
    var county=TN_CITY_COUNTY[city];
    if(county&&TN_COUNTY_RATES[county])return TN_COUNTY_RATES[county]/100;
    return 9.75/100;
  }
  return (TAX_RATES[state]||0)/100;
}
// Weight tiers: [{maxLbs, surcharge}] — sorted descending by maxLbs
// maxLbs:null means 'over the previous tier'
var WEIGHT_TIERS=[
  {min:5,   max:null, charge:10},
  {min:3,   max:5,    charge:6},
  {min:1,   max:3,    charge:3},
  {min:0,   max:1,    charge:0}
];
function weightSurcharge(lbs){
  lbs=parseFloat(lbs)||0;
  // Sort tiers descending by min so highest bracket matches first
  var sorted=WEIGHT_TIERS.slice().sort(function(a,b){return b.min-a.min;});
  for(var i=0;i<sorted.length;i++){
    var t=sorted[i];
    if(lbs>=t.min&&(t.max===null||lbs<t.max))return parseFloat(t.charge)||0;
  }
  return 0;
}
function cartWeight(){
  var w=0;
  for(var i=0;i<CART.length;i++){
    var p=findProd(CART[i].id);
    if(p)w+=(parseFloat(p.weight)||0)*CART[i].q;
  }
  return w;
}
function calcShipping(subtotal,stateStr){
  if(subtotal>=FREE_THRESHOLD)return 0;
  var zone=getZone(stateStr);
  var base=ZONE_RATES[zone]||15;
  var surcharge=weightSurcharge(cartWeight());
  return base+surcharge;
}
function updateShippingDisplay(){
  var sub=cartTotal();
  var st=document.getElementById('co-sz')?document.getElementById('co-sz').value:'';
  var wt=cartWeight();
  var zone=getZone(st);
  var base=sub>=FREE_THRESHOLD?0:(ZONE_RATES[zone]||15);
  var wsur=sub>=FREE_THRESHOLD?0:weightSurcharge(wt);
  var ship=base+wsur;
  var tot=sub+ship;
  var shipEl=document.getElementById('oc-ship');
  var totEl=document.getElementById('oc-tot');
  var zoneNames=['','Tennessee','South','East Coast','Midwest','West'];
  var zoneEl=document.getElementById('oc-zone');
  if(!st.trim()){
    // No address yet — don't show a rate
    if(zoneEl)zoneEl.textContent='';
    if(shipEl)shipEl.textContent=sub>=FREE_THRESHOLD?'Free 🎉':'Enter address';
    if(totEl)totEl.textContent=sub>=FREE_THRESHOLD?'$'+sub.toFixed(2):'—';
    return;
  }
  var zoneTxt=(zoneNames[zone]||'Zone '+zone)+(wsur>0?' + weight $'+wsur.toFixed(2):'');
  if(zoneEl)zoneEl.textContent='('+zoneTxt+')';
  if(shipEl)shipEl.textContent=ship>0?'$'+ship.toFixed(2):(sub>=FREE_THRESHOLD?'Free 🎉':'Free');
  if(totEl)totEl.textContent='$'+tot.toFixed(2);
}
function orderTotal(){
  var sub=cartTotal();
  var st=document.getElementById('co-sz')?document.getElementById('co-sz').value:'';
  return sub+calcShipping(sub,st);
}
function updCartCount(){var t=0;for(var i=0;i<CART.length;i++)t+=CART[i].q;document.getElementById('cart-count').textContent=t;}
function renderCart(){
  var el=document.getElementById('cart-items');
  if(!CART.length){el.innerHTML='<div class="cart-empty"><div style="font-size:2.5rem;opacity:.3;margin-bottom:.5rem">🛍</div><p>Your cart is empty</p></div>';document.getElementById('cart-subtotal').textContent='$0.00';return;}
  var h='';
  for(var i=0;i<CART.length;i++){
    var it=CART[i],p=findProd(it.id);if(!p)continue;
    var thumb=firstImg(p);
    h+='<div class="cart-item">'+
      '<div class="cart-item-img">'+(thumb?'<img src="'+thumb+'">':'👜')+'</div>'+
      '<div class="cart-item-info"><div class="cart-item-name">'+p.name+'</div><div class="cart-item-price">$'+p.price.toFixed(2)+'</div>'+
      '<div class="cart-qty"><button class="qbtn" onclick="chCartQ(\''+it.id+'\',-1)">−</button><span class="qval">'+it.q+'</span><button class="qbtn" onclick="chCartQ(\''+it.id+'\',1)">+</button></div>'+
      '</div><button class="cart-rem" onclick="remFromCart(\''+it.id+'\')">×</button></div>';
  }
  el.innerHTML=h;document.getElementById('cart-subtotal').textContent='$'+cartTotal().toFixed(2);
}

// ── CHECKOUT ──
function openCheckout(){
  if(!CART.length)return;closeCart();
  // Clear address fields first so shipping calculation starts clean
  document.getElementById('co-sz').value='';
  document.getElementById('co-ad').value='';
  document.getElementById('co-ci').value='';
  var sub=cartTotal();
  document.getElementById('oc-sub').textContent='$'+sub.toFixed(2);
  document.getElementById('oc-ship').textContent=sub>=FREE_THRESHOLD?'Free 🎉':'Enter address';
  document.getElementById('oc-tot').textContent=sub>=FREE_THRESHOLD?'$'+sub.toFixed(2):'—';
  if(CUR_USER){document.getElementById('co-fn').value=CUR_USER.fn||'';document.getElementById('co-ln').value=CUR_USER.ln||'';document.getElementById('co-em').value=CUR_USER.em||'';document.getElementById('co-ph').value=CUR_USER.ph||'';}
  document.getElementById('co-form').style.display='block';
  openModal('co-modal');
}

function _showCheckoutModal(){
  document.getElementById('co-form').style.display='block';
  document.getElementById('co-success').style.display='none';
  if(CUR_USER){document.getElementById('co-fn').value=CUR_USER.fn||'';document.getElementById('co-ln').value=CUR_USER.ln||'';document.getElementById('co-em').value=CUR_USER.em||'';document.getElementById('co-ph').value=CUR_USER.ph||'';}
  openModal('co-modal');
  updateShippingDisplay();
}
function placeOrder(){
  var fn=document.getElementById('co-fn').value.trim(),em=document.getElementById('co-em').value.trim();
  var ad=document.getElementById('co-ad').value.trim();
  if(!fn||!em){alert('Please enter your name and email.');return;}
  if(!ad){alert('Please enter your shipping address.');return;}
  var oid='ORD-'+Date.now().toString(36).toUpperCase();
  var items=[];for(var i=0;i<CART.length;i++){var p=findProd(CART[i].id);if(p)items.push({id:CART[i].id,name:p.name,price:p.price,q:CART[i].q});}
  var subtotal=cartTotal();
  var shipState=document.getElementById('co-sz').value||'';
  var shipWt=cartWeight();
  var shipZone=getZone(shipState);
  var shipBase=subtotal>=FREE_THRESHOLD?0:(ZONE_RATES[shipZone]||15);
  var shipSur=subtotal>=FREE_THRESHOLD?0:weightSurcharge(shipWt);
  var shipping=shipBase+shipSur;
  var total=subtotal+shipping;
  var now=new Date();
  var isoDate=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
  var dispDate=(now.getMonth()+1)+'/'+now.getDate()+'/'+now.getFullYear();
  var hrs=now.getHours();var mins=String(now.getMinutes()).padStart(2,'0');
  var dispTime=(hrs%12||12)+':'+mins+' '+(hrs<12?'AM':'PM');
  var o={id:oid,date:isoDate,dispDate:dispDate,time:dispTime,cust:fn+' '+document.getElementById('co-ln').value.trim(),email:em,
    phone:document.getElementById('co-ph').value,
    addr:ad+', '+document.getElementById('co-ci').value+' '+document.getElementById('co-sz').value,
    items:items,total:total,subtotal:subtotal,shipping:shipping,pay:'Credit Card',order_type:'Online',status:'Awaiting Payment'};
  for(var j=0;j<CART.length;j++){var p2=findProd(CART[j].id);if(p2)p2.stock=Math.max(0,p2.stock-CART[j].q);}
  var ec=null;for(var k=0;k<CUSTS.length;k++)if(CUSTS[k].em===em){ec=CUSTS[k];break;}
  if(!ec)CUSTS.push({id:'C'+Date.now(),name:fn+' '+document.getElementById('co-ln').value.trim(),fn:fn,ln:document.getElementById('co-ln').value.trim(),em:em,ph:document.getElementById('co-ph').value,joined:new Date().toLocaleDateString(),orders:1});
  else ec.orders=(ec.orders||0)+1;
  // Save order to database
  apiFetch('orders.php','POST',o).then(function(){}).catch(function(){});
  // Increment customer order count
  apiFetch('customers.php','POST',{action:'inc_orders',em:em}).catch(function(){});
  CART=[];updCartCount();renderStore();
  // Show spinner while creating Square checkout
  document.getElementById('co-form').style.display='none';
  document.getElementById('co-success').style.display='block';
  // ── Test mode: skip Square, show confirmation screen ──
  if(SQUARE_MODE==='test'){
    var tData=JSON.stringify({
      order_id:oid,date:o.date,customer_name:o.cust,customer_email:o.email,
      phone:o.phone||'',address:o.addr||'',
      subtotal:o.subtotal||o.total,shipping:o.shipping||0,total:o.total,items:o.items
    });
    var tOpts={method:'POST',headers:{'Content-Type':'application/json'},body:tData};
    fetch('https://handmadedesignsbysuzi.com/notify.php',tOpts).catch(function(){});
    fetch('https://handmadedesignsbysuzi.com/verify_payment.php',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({order_id:oid,test_mode:true})
    }).then(function(r){return r.json();})
    .then(function(d){console.log('Test confirm:',d.status);})
    .catch(function(){});
    showTestOrderConfirm(oid,total,o);
    return;
  }
  // ── Live mode: create Square checkout with pre-filled amount ──
  fetch('checkout.php',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      order_id:oid,
      total:total,
      customer_name:o.cust,
      customer_email:o.email,
      mode:SQUARE_MODE
    })
  })
  .then(function(r){return r.json();})
  .then(function(d){
    if(d.success&&d.checkout_url){
      document.getElementById('sq-fallback').href=d.checkout_url;
      // Send confirmation emails before redirecting
      var confirmData=JSON.stringify({
        order_id:oid,date:o.date,customer_name:o.cust,customer_email:o.email,
        phone:o.phone||'',address:o.addr||'',
        subtotal:o.subtotal||o.total,shipping:o.shipping||0,total:o.total,items:o.items
      });
      var opts={method:'POST',headers:{'Content-Type':'application/json'},body:confirmData};
      Promise.all([
        fetch('https://handmadedesignsbysuzi.com/order_confirm.php',opts),
        fetch('https://handmadedesignsbysuzi.com/notify.php',opts)
      ]).catch(function(){})
      .finally(function(){window.location.href=d.checkout_url;});
    } else {
      document.getElementById('sq-fallback').href='https://square.link/u/G0Cs5vTd';
      document.getElementById('sq-fallback').style.display='inline-block';
      alert('Payment redirect failed: '+(d.error||'Unknown error')+'. Please use the button to pay.');
    }
  })
  .catch(function(){
    document.getElementById('sq-fallback').href='https://square.link/u/G0Cs5vTd';
    document.getElementById('sq-fallback').style.display='inline-block';
  });
}

// ── TEST MODE ORDER CONFIRMATION ──
function showTestOrderConfirm(oid,total,o){
  closeModal('co-modal');
  // Build a test confirmation modal
  var existing=document.getElementById('test-confirm-modal');
  if(existing)existing.remove();
  var div=document.createElement('div');
  div.id='test-confirm-modal';
  div.className='modal-ov on';
  div.style.zIndex='300';
  div.innerHTML=
    '<div class="modal-box" style="max-width:460px;text-align:center;padding:0;overflow:hidden">'+
    '<div style="background:#e65100;padding:1.5rem 2rem">'+
      '<div style="font-size:1.5rem;margin-bottom:.3rem">🧪</div>'+
      '<div style="color:#fff;font-weight:700;font-size:1.1rem">TEST MODE</div>'+
      '<div style="color:rgba(255,255,255,.85);font-size:.82rem;margin-top:.3rem">No real payment was processed</div>'+
    '</div>'+
    '<div style="padding:1.8rem 2rem">'+
      '<div style="background:#fffdf0;border:1px solid #e8e0b8;border-radius:10px;padding:1rem;margin-bottom:1.2rem;font-size:.88rem">'+
        '<div style="display:flex;justify-content:space-between;margin-bottom:.4rem"><span style="color:#6b6040">Order ID</span><strong style="font-family:monospace">#'+oid+'</strong></div>'+
        '<div style="display:flex;justify-content:space-between;margin-bottom:.4rem"><span style="color:#6b6040">Customer</span><strong>'+o.cust+'</strong></div>'+
        '<div style="display:flex;justify-content:space-between"><span style="color:#6b6040">Total</span><strong style="color:#a07810;font-size:1.1rem">$'+total.toFixed(2)+'</strong></div>'+
      '</div>'+
      '<div style="font-size:.82rem;color:#6b6040;margin-bottom:1.2rem;line-height:1.6">'+
        'In <strong>live mode</strong> the customer would be redirected to Square to complete payment. '+
        'This order has been saved to your admin panel with status <strong>Awaiting Payment</strong>.<br>'+
        'A confirmation email has been sent to <strong>'+o.email+'</strong>.'+
      '</div>'+
      '<button class="mbtn" style="max-width:240px;margin:0 auto" onclick="document.getElementById(\'test-confirm-modal\').remove()">Close</button>'+
    '</div>'+
    '</div>';
  document.body.appendChild(div);
}

