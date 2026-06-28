// ── STORE RENDER ──
function firstImg(p){return(p.imgs&&p.imgs[0])||p.img||'';}
function renderCatFilter(){
  var el=document.getElementById('cat-filter');if(!el)return;
  var allCats=['All'].concat(CATS);
  var h='';
  for(var i=0;i<allCats.length;i++){
    var active=allCats[i]===ACTIVE_CAT;
    h+='<button onclick="setActiveCat(\''+allCats[i]+'\')" style="'+
      'background:'+(active?'#B88A44':'#fff')+';'+
      'color:'+(active?'#fff':'#6b6040')+';'+
      'border:1.5px solid '+(active?'#B88A44':'#e7e1d6')+';'+
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
  // Only show products listed for sale (sell !== 0) and not flagged Coming Soon
  var forSale=PRODS.filter(function(p){return p.sell!==0&&!p.coming_soon;});
  var filtered=ACTIVE_CAT==='All'?forSale:forSale.filter(function(p){return parseCats(p.cat).indexOf(ACTIVE_CAT)>=0;});
  renderCatFilter();
  for(var i=0;i<filtered.length;i++){
    var p=filtered[i];
    var imgs=p.imgs||[p.img||''];
    var validImgs=[];for(var x=0;x<imgs.length;x++)if(imgs[x])validImgs.push(imgs[x]);
    var imgHtml='';
    if(validImgs.length>0){
      imgHtml='<img src="'+validImgs[0]+'" alt="'+p.name+'">';
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
  renderComingSoon();
  renderFeatured();
  renderGallery();
}
// ── GALLERY — masonry of product photos ──
function renderGallery(){
  var grid=document.getElementById('gallery-grid'),sec=document.getElementById('gallery');
  if(!grid||!sec)return;
  var imgs=[];
  PRODS.forEach(function(p){if(p.sell!==0&&!p.coming_soon){var im=firstImg(p);if(im)imgs.push({src:im,name:p.name,id:p.id});}});
  if(!imgs.length){sec.style.display='none';return;}
  sec.style.display='block';
  imgs=imgs.slice(0,12);
  var h='';
  for(var i=0;i<imgs.length;i++){
    h+='<div class="masonry-item" onclick="openPD(\''+imgs[i].id+'\')"><img src="'+imgs[i].src+'" alt="'+imgs[i].name+'" loading="lazy"></div>';
  }
  grid.innerHTML=h;
}
function goGallery(){
  if(typeof showOnly==='function')showOnly('store');
  if(typeof updateNav==='function')updateNav();
  setTimeout(function(){var g=document.getElementById('gallery');if(g)g.scrollIntoView({behavior:'smooth'});},60);
}
// ── COMING SOON — tease products not yet for sale ──
function renderComingSoon(){
  var sec=document.getElementById('coming-soon'),grid=document.getElementById('cs-grid');
  if(!sec||!grid)return;
  var cs=PRODS.filter(function(p){return p.coming_soon;});
  if(!cs.length){sec.style.display='none';return;}
  sec.style.display='block';
  var h='';
  for(var i=0;i<cs.length;i++){
    var p=cs[i],img=firstImg(p);
    h+='<div class="cs-card">'+
      '<div class="cs-img">'+(img?'<img src="'+img+'" alt="'+p.name+'">':'<div class="cs-noimg">👜</div>')+'<span class="cs-badge">Coming Soon</span></div>'+
      '<div class="cs-body"><h3>'+p.name+'</h3><p>'+(p.desc||'')+'</p>'+
        '<button class="cs-notify" onclick="notifyMe(\''+p.id+'\')">Notify me when available</button>'+
      '</div></div>';
  }
  grid.innerHTML=h;
}
function notifyMe(id){
  var p=findProd(id);if(!p)return;
  var def=(typeof CUR_USER!=='undefined'&&CUR_USER&&CUR_USER.email)?CUR_USER.email:'';
  var em=prompt('Enter your email and we’ll let you know the moment “'+p.name+'” is available:',def);
  if(em===null)return;
  em=em.trim();
  if(!em||em.indexOf('@')<0){alert('Please enter a valid email address.');return;}
  apiFetch('subscribers.php','POST',{email:em,source:'Coming Soon: '+p.name}).then(function(d){
    if(d.success||(''+(d.error||'')).toLowerCase().indexOf('already')>=0){
      alert('You’re on the list! We’ll email you when “'+p.name+'” is ready.');
    } else { alert(d.error||'Could not save your request. Please try again.'); }
  }).catch(function(){alert('Network error. Please try again.');});
}
// ── FEATURED COLLECTIONS — three top categories with a representative photo ──
function renderFeatured(){
  var wrap=document.getElementById('featured-cards'),sec=document.getElementById('featured');
  if(!wrap||!sec)return;
  var counts={};
  PRODS.forEach(function(p){if(p.sell!==0&&!p.coming_soon)parseCats(p.cat).forEach(function(c){if(c)counts[c]=(counts[c]||0)+1;});});
  var cats=Object.keys(counts).sort(function(a,b){return counts[b]-counts[a];}).slice(0,3);
  if(!cats.length){sec.style.display='none';return;}
  sec.style.display='block';
  var h='';
  for(var i=0;i<cats.length;i++){
    var cat=cats[i];
    var rep=PRODS.filter(function(p){return p.sell!==0&&!p.coming_soon&&parseCats(p.cat).indexOf(cat)>=0&&firstImg(p);})[0];
    var img=rep?firstImg(rep):'';
    h+='<div class="fc-card" onclick="goCat(\''+String(cat).replace(/'/g,"\\'")+'\')">'+
      '<div class="fc-img"'+(img?' style="background-image:url(\''+img+'\')"':'')+'>'+(img?'':'<span>👜</span>')+'</div>'+
      '<div class="fc-body"><h3>'+cat+'</h3><span class="fc-link">Explore →</span></div></div>';
  }
  wrap.innerHTML=h;
}
function goCat(cat){if(typeof setActiveCat==='function')setActiveCat(cat);var ps=document.getElementById('ps');if(ps)ps.scrollIntoView({behavior:'smooth'});}

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
      gallerySlides+='<div class="gallery-img'+(i===0?' on':'')+'" id="gslide-'+i+'"><img src="'+validImgs[i]+'" alt="'+p.name+'" onerror="this.parentNode.style.display=\'none\'"></div>';
      dots+='<button class="gdot'+(i===0?' on':'')+'" onclick="goSlide('+i+')"></button>';
    }
    if(validImgs.length>1){
      thumbsHtml='<div class="pd-thumbs">';
      for(var t=0;t<validImgs.length;t++)thumbsHtml+='<img class="pd-thumb'+(t===0?' on':'')+'" src="'+validImgs[t]+'" alt="'+p.name+' photo '+(t+1)+'" onclick="goSlide('+t+')" onerror="this.style.display=\'none\'">';
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
        '<div class="detail-cat">Category: '+parseCats(p.cat).join(', ')+(p.weight?' &nbsp;·&nbsp; '+p.weight+' lbs':'')+'</div>'+
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
          openLightbox(window._pdImgs,idx,p.name);
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
  // Update title, meta description, and URL for SEO
  document.title=p.name+' | Handmade Designs By Suzi';
  var _md=document.querySelector('meta[name="description"]');
  if(_md)_md.setAttribute('content',(p.desc||'').replace(/<[^>]+>/g,'').substring(0,155));
  history.pushState({p:p.id},'','?p='+p.id);
}
function closePD(){
  // Restore original title, meta description, and URL
  document.title='Handmade Designs By Suzi — Handcrafted Bags & Purses | Knoxville, TN';
  var _md=document.querySelector('meta[name="description"]');
  if(_md)_md.setAttribute('content','Handmade Designs By Suzi — one-of-a-kind handmade tote bags and purses crafted with love in Knoxville, TN. Unique Corvette and car show themed bags, embroidered designs, and custom gifts for car enthusiasts.');
  history.pushState({},'',window.location.pathname);
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
function openCart(){if(typeof gtag==='function')gtag('event','page_view',{page_title:'Your Cart',page_path:'/#cart'});if(localStorage.getItem('hdbs_pagelog')==='1')apiFetch('admin.php','POST',{action:'log_page_view',page:'Your Cart'});document.getElementById('cart-ov').classList.add('on');document.getElementById('cart-drawer').classList.add('on');renderCart();}
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
var FREE_THRESHOLD=Infinity; // free shipping eliminated — threshold never reached

function applyShippingConfig(cfg){
  if(!cfg)return;
  if(cfg.zone_rates&&Array.isArray(cfg.zone_rates))ZONE_RATES=cfg.zone_rates;
  // free_threshold intentionally ignored — free shipping has been eliminated
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
// Per-item shipping: a product ships 'by weight' (zone rate + weight surcharge) or
// 'fixed' (a flat dollar amount per unit). Fixed items add on top; the zone base
// applies once if the cart contains any by-weight items.
function isFixedShip(p){return p&&p.ship_mode==='fixed';}
function cartFixedShip(){var s=0;for(var i=0;i<CART.length;i++){var p=findProd(CART[i].id);if(isFixedShip(p))s+=(parseFloat(p.ship_fixed)||0)*CART[i].q;}return s;}
function cartWeightItems(){var w=0;for(var i=0;i<CART.length;i++){var p=findProd(CART[i].id);if(p&&!isFixedShip(p))w+=(parseFloat(p.weight)||0)*CART[i].q;}return w;}
function hasWeightItems(){for(var i=0;i<CART.length;i++){var p=findProd(CART[i].id);if(p&&!isFixedShip(p))return true;}return false;}
function calcShipping(subtotal,stateStr){
  var fixed=cartFixedShip();
  var weightShip=0;
  if(hasWeightItems()){
    var zone=getZone(stateStr);
    weightShip=(ZONE_RATES[zone]||15)+weightSurcharge(cartWeightItems());
  }
  return fixed+weightShip;
}
function updateShippingDisplay(){
  var sub=cartTotal();
  var st=document.getElementById('co-sz')?document.getElementById('co-sz').value:'';
  var fixed=cartFixedShip();
  var hasWt=hasWeightItems();
  var zone=getZone(st);
  var wsur=hasWt?weightSurcharge(cartWeightItems()):0;
  var base=hasWt?(ZONE_RATES[zone]||15):0;
  var ship=fixed+base+wsur;
  // InPerson: shipping is optional via the "Add shipping charge" checkbox
  var shipReqEl=document.getElementById('co-ship-req');
  var noShip=PAY_CONFIG==='InPerson'&&shipReqEl&&!shipReqEl.checked;
  if(noShip)ship=0;
  var tax=Math.round(sub*0.0975*100)/100;
  var shipEl=document.getElementById('oc-ship');
  var totEl=document.getElementById('oc-tot');
  var taxEl=document.getElementById('oc-tax');
  var zoneNames=['','Tennessee','South','East Coast','Midwest','West'];
  var zoneEl=document.getElementById('oc-zone');
  if(taxEl)taxEl.textContent='$'+tax.toFixed(2);
  // No shipping (InPerson pickup): total computes without an address
  if(noShip){
    if(zoneEl)zoneEl.textContent='';
    if(shipEl)shipEl.textContent='None';
    if(totEl)totEl.textContent='$'+(sub+tax).toFixed(2);
    return;
  }
  // The zone rate needs the address only when there are by-weight items
  if(hasWt&&!st.trim()){
    if(zoneEl)zoneEl.textContent='';
    if(shipEl)shipEl.textContent='Enter address';
    if(totEl)totEl.textContent='—';
    return;
  }
  var tot=sub+ship+tax;
  var parts=[];
  if(hasWt)parts.push((zoneNames[zone]||'Zone '+zone)+(wsur>0?' + weight $'+wsur.toFixed(2):''));
  if(fixed>0)parts.push('fixed $'+fixed.toFixed(2));
  if(zoneEl)zoneEl.textContent=parts.length?'('+parts.join(', ')+')':'';
  if(shipEl)shipEl.textContent=ship>0?'$'+ship.toFixed(2):'Free';
  if(totEl)totEl.textContent='$'+tot.toFixed(2);
}
function orderTotal(){
  var sub=cartTotal();
  var st=document.getElementById('co-sz')?document.getElementById('co-sz').value:'';
  var tax=Math.round(sub*0.0975*100)/100;
  return sub+calcShipping(sub,st)+tax;
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
      '<div class="cart-item-img">'+(thumb?'<img src="'+thumb+'" alt="'+p.name+'">':'👜')+'</div>'+
      '<div class="cart-item-info"><div class="cart-item-name">'+p.name+'</div><div class="cart-item-price">$'+p.price.toFixed(2)+'</div>'+
      '<div class="cart-qty"><button class="qbtn" onclick="chCartQ(\''+it.id+'\',-1)">−</button><span class="qval">'+it.q+'</span><button class="qbtn" onclick="chCartQ(\''+it.id+'\',1)">+</button></div>'+
      '</div><button class="cart-rem" onclick="remFromCart(\''+it.id+'\')">×</button></div>';
  }
  el.innerHTML=h;document.getElementById('cart-subtotal').textContent='$'+cartTotal().toFixed(2);
}

// ── CHECKOUT ──
function _show(id){var e=document.getElementById(id);if(e)e.style.display='block';}
function _hide(id){var e=document.getElementById(id);if(e)e.style.display='none';}
function _showFlex(id){var e=document.getElementById(id);if(e)e.style.display='flex';}
function openCheckout(){
  if(!CART.length)return;
  if(typeof gtag==='function')gtag('event','page_view',{page_title:'Checkout',page_path:'/#checkout'});
  if(localStorage.getItem('hdbs_pagelog')==='1')apiFetch('admin.php','POST',{action:'log_page_view',page:'Checkout'});
  closeCart();
  // Reset all panels
  var _f=document.getElementById('co-form');if(_f)_f.style.display='block';
  var _p=document.getElementById('co-payment');if(_p)_p.style.display='none';
  var _pr=document.getElementById('co-processing');if(_pr)_pr.style.display='none';
  var _r=document.getElementById('co-result');if(_r)_r.style.display='none';
  // Destroy any leftover Square card widget
  if(window._sqCard){try{window._sqCard.destroy();}catch(e){}window._sqCard=null;}
  // Clear address fields so shipping starts clean
  document.getElementById('co-sz').value='';
  document.getElementById('co-ad').value='';
  document.getElementById('co-ci').value='';
  var sub=cartTotal();
  var tax=Math.round(sub*0.0975*100)/100;
  document.getElementById('oc-sub').textContent='$'+sub.toFixed(2);
  document.getElementById('oc-tax').textContent='$'+tax.toFixed(2);
  document.getElementById('oc-ship').textContent=sub>=FREE_THRESHOLD?'Free 🎉':'Enter address';
  document.getElementById('oc-tot').textContent=sub>=FREE_THRESHOLD?'$'+(sub+tax).toFixed(2):'—';
  if(CUR_USER){document.getElementById('co-fn').value=CUR_USER.fn||'';document.getElementById('co-ln').value=CUR_USER.ln||'';document.getElementById('co-em').value=CUR_USER.em||'';document.getElementById('co-ph').value=CUR_USER.ph||'';}
  updateInPersonUI();
  openModal('co-modal');
}

// Toggle the storefront checkout UI for the active Payment Configuration.
function updateInPersonUI(){
  var inPerson=PAY_CONFIG==='InPerson';
  var ip=document.getElementById('co-inperson');if(ip)ip.style.display=inPerson?'block':'none';
  var method=document.getElementById('co-paymethod')?document.getElementById('co-paymethod').value:'Credit Card';
  var cw=document.getElementById('co-checknum-wrap');if(cw)cw.style.display=(inPerson&&method==='Check')?'block':'none';
  var cardPay=(!inPerson)||method==='Credit Card';
  var note=document.getElementById('co-secure-note');if(note)note.style.display=cardPay?'block':'none';
  var btn=document.getElementById('co-submit-btn');if(btn)btn.textContent=cardPay?'Review & Pay →':'Place Order';
  updateShippingDisplay();
}

function _showCheckoutModal(){
  var _f=document.getElementById('co-form');if(_f)_f.style.display='block';
  var _p=document.getElementById('co-payment');if(_p)_p.style.display='none';
  var _pr=document.getElementById('co-processing');if(_pr)_pr.style.display='none';
  var _r=document.getElementById('co-result');if(_r)_r.style.display='none';
  if(CUR_USER){document.getElementById('co-fn').value=CUR_USER.fn||'';document.getElementById('co-ln').value=CUR_USER.ln||'';document.getElementById('co-em').value=CUR_USER.em||'';document.getElementById('co-ph').value=CUR_USER.ph||'';}
  openModal('co-modal');
  updateInPersonUI();
}
function placeOrder(){
  var fn=document.getElementById('co-fn').value.trim(),em=document.getElementById('co-em').value.trim();
  var ad=document.getElementById('co-ad').value.trim();
  if(!fn||!em){alert('Please enter your name and email.');return;}
  // Payment Configuration: Online | InPerson | Test
  var mode=PAY_CONFIG;
  var method='Credit Card',checkNum='';
  if(mode==='InPerson'){
    method=document.getElementById('co-paymethod')?document.getElementById('co-paymethod').value:'Credit Card';
    if(method==='Check')checkNum=document.getElementById('co-checknum')?document.getElementById('co-checknum').value.trim():'';
  }
  var shipReqEl=document.getElementById('co-ship-req');
  var noShip=mode==='InPerson'&&shipReqEl&&!shipReqEl.checked;
  if(!ad&&!noShip){alert('Please enter your shipping address.');return;}
  var isCard=(mode!=='InPerson')||method==='Credit Card';
  var oid='ORD-'+Date.now().toString(36).toUpperCase();
  var items=[];for(var i=0;i<CART.length;i++){var p=findProd(CART[i].id);if(p)items.push({id:CART[i].id,name:p.name,price:p.price,q:CART[i].q});}
  var subtotal=cartTotal();
  var shipState=document.getElementById('co-sz').value||'';
  var shipping=noShip?0:calcShipping(subtotal,shipState);
  var tax=Math.round(subtotal*0.0975*100)/100;
  var total=Math.round((subtotal+shipping+tax)*100)/100;
  var now=new Date();
  var isoDate=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
  var dispDate=(now.getMonth()+1)+'/'+now.getDate()+'/'+now.getFullYear();
  var hrs=now.getHours();var mins=String(now.getMinutes()).padStart(2,'0');
  var dispTime=(hrs%12||12)+':'+mins+' '+(hrs<12?'AM':'PM');
  var addr=ad?(ad+', '+document.getElementById('co-ci').value+' '+document.getElementById('co-sz').value):'';
  var o={id:oid,date:isoDate,dispDate:dispDate,time:dispTime,cust:fn+' '+document.getElementById('co-ln').value.trim(),email:em,
    phone:document.getElementById('co-ph').value,
    addr:addr,
    items:items,total:total,subtotal:subtotal,shipping:shipping,tax:tax,
    pay:method,order_type:(mode==='InPerson'?'In Person':'Online'),payment_config:mode,check_number:checkNum,
    source:'storefront',
    status:(mode==='InPerson'&&!isCard)?'Paid':'Awaiting Payment'};
  // Decrement local stock
  for(var j=0;j<CART.length;j++){var p2=findProd(CART[j].id);if(p2)p2.stock=Math.max(0,p2.stock-CART[j].q);}
  // Update local customer list
  var ec=null;for(var k=0;k<CUSTS.length;k++)if(CUSTS[k].em===em){ec=CUSTS[k];break;}
  if(!ec)CUSTS.push({id:'C'+Date.now(),fn:fn,ln:document.getElementById('co-ln').value.trim(),em:em,ph:document.getElementById('co-ph').value});
  // Preserve cart for Back-button restore
  window._pendingCartItems=JSON.parse(JSON.stringify(CART));
  window._pendingOrder=o;
  window._pendingOrderId=oid;
  window._pendingTotal=total;
  window._pendingSubtotal=subtotal;
  window._pendingShipping=shipping;
  window._pendingTax=tax;
  // ── Test mode: skip card form, show mock confirmation ──
  if(mode==='Test'){
    apiFetch('orders.php','POST',o).then(function(){}).catch(function(){});
    apiFetch('customers.php','POST',{action:'inc_orders',em:em}).catch(function(){});
    CART=[];window._pendingCartItems=null;updCartCount();renderStore();
    var tOpts={method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({order_id:oid,date:o.date,customer_name:o.cust,customer_email:o.email,
        phone:o.phone||'',address:o.addr||'',subtotal:subtotal,shipping:shipping,total:total,items:items})};
    fetch(SITE_ORIGIN+'/notify.php',tOpts).catch(function(){});
    fetch(SITE_ORIGIN+'/verify_payment.php',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({order_id:oid,test_mode:true})}).catch(function(){});
    showTestOrderConfirm(oid,total,o);
    return;
  }
  // ── InPerson cash/check: save as Paid, no online payment ──
  if(mode==='InPerson'&&!isCard){
    // orders.php sends + logs the customer confirmation server-side for in-person cash/check sales
    apiFetch('orders.php','POST',o).then(function(){}).catch(function(){});
    apiFetch('customers.php','POST',{action:'inc_orders',em:em}).catch(function(){});
    CART=[];window._pendingCartItems=null;updCartCount();renderStore();
    var nOpts={method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({order_id:oid,date:o.date,customer_name:o.cust,customer_email:o.email,
        phone:o.phone||'',address:o.addr||'',subtotal:subtotal,shipping:shipping,total:total,items:items})};
    fetch(SITE_ORIGIN+'/notify.php',nOpts).catch(function(){});
    showInPersonConfirm(oid,total,o,method,checkNum);
    return;
  }
  // ── Card flow (Online, or InPerson credit card): save order then show embedded card form ──
  _hide('co-form');_show('co-processing');
  apiFetch('orders.php','POST',o)
    .then(function(d){
      window._pendingCancelToken=d.cancel_token||null;
      apiFetch('customers.php','POST',{action:'inc_orders',em:em}).catch(function(){});
      CART=[];updCartCount();renderStore();
      showPaymentStep(subtotal,shipping,tax,total);
    })
    .catch(function(){
      _hide('co-processing');_show('co-form');
      window._pendingOrderId=null;
      window._pendingCartItems=null;
      alert('Could not save your order. Please try again.');
    });
}

function showPaymentStep(subtotal,shipping,tax,total){
  // Populate summary
  var shipLine=shipping>0?'<div style="display:flex;justify-content:space-between;margin-bottom:.3rem"><span>Shipping</span><span>$'+shipping.toFixed(2)+'</span></div>':
    '<div style="display:flex;justify-content:space-between;margin-bottom:.3rem"><span>Shipping</span><span style="color:#2e7d32">Free &#127881;</span></div>';
  var s=document.getElementById('co-pay-summary');
  if(s)s.innerHTML=
    '<div style="display:flex;justify-content:space-between;margin-bottom:.3rem"><span>Subtotal</span><span>$'+subtotal.toFixed(2)+'</span></div>'+
    shipLine+
    '<div style="display:flex;justify-content:space-between;margin-bottom:.3rem"><span>Tax (9.75%)</span><span>$'+tax.toFixed(2)+'</span></div>'+
    '<div style="display:flex;justify-content:space-between;font-weight:700;color:#2d2220;border-top:1px solid #e8e0b8;padding-top:.4rem;margin-top:.3rem"><span>Total</span><span style="color:#a07810">$'+total.toFixed(2)+'</span></div>';
  // Update pay button label
  var btn=document.getElementById('pay-btn');
  if(btn){btn.textContent='Pay $'+total.toFixed(2);btn.disabled=false;}
  _show('card-loading');
  var cc=document.getElementById('card-container');if(cc)cc.innerHTML='';
  _hide('card-error');
  _hide('co-processing');_show('co-payment');
  // Load Square SDK then initialize card
  loadSquareSdk(function(){
    var appId=SQUARE_MODE==='test'?'sandbox-sq0idb-YOUR_SANDBOX_APP_ID':'sq0idp-08N-GQIys4jnwilvp0STsQ';
    var locId='LJP687TQBTWTA';
    initSquareCard(appId,locId);
  });
}

function loadSquareSdk(cb){
  if(window.Square){cb();return;}
  var url=SQUARE_MODE==='test'
    ?'https://sandbox.web.squarecdn.com/v1/square.js'
    :'https://web.squarecdn.com/v1/square.js';
  var s=document.createElement('script');
  s.src=url;
  s.onload=cb;
  s.onerror=function(){var cl=document.getElementById('card-loading');if(cl)cl.textContent='Could not load payment form. Please refresh and try again.';};
  document.head.appendChild(s);
}

function initSquareCard(appId,locId){
  var payments=window.Square.payments(appId,locId);
  window._sqPayments=payments;
  payments.card().then(function(card){
    window._sqCard=card;
    return card.attach('#card-container');
  }).then(function(){
    _hide('card-loading');
  }).catch(function(err){
    var cl=document.getElementById('card-loading');if(cl)cl.textContent='Could not load payment form. Please refresh and try again.';
  });
}

function submitPayment(){
  if(!window._sqCard)return;
  var btn=document.getElementById('pay-btn');
  btn.disabled=true;btn.textContent='Processing…';
  _hide('card-error');_hide('co-payment');_show('co-processing');
  window._sqCard.tokenize().then(function(result){
    if(result.status==='OK'){
      return apiFetch('process_payment.php','POST',{source_id:result.token,order_id:window._pendingOrderId});
    } else {
      var msg=(result.errors&&result.errors[0])?result.errors[0].message:'Please check your card details and try again.';
      throw{cardError:true,message:msg};
    }
  }).then(function(d){
    _hide('co-processing');
    if(d.success){
      window._pendingOrderId=null;
      window._pendingCartItems=null;
      window._pendingCancelToken=null;
      var body=document.getElementById('co-result-body');
      if(body)body.innerHTML='Your payment of <strong>$'+d.total.toFixed(2)+'</strong> was received.<br>Order #<strong>'+d.order_id+'</strong><br>A confirmation email has been sent to you.';
      _show('co-result');
    } else {
      _show('co-payment');
      showCardError(d.error||'Payment failed. Please try again.');
      btn.disabled=false;btn.textContent='Pay $'+(window._pendingTotal||0).toFixed(2);
    }
  }).catch(function(err){
    _hide('co-processing');_show('co-payment');
    var msg=(err&&err.cardError)?err.message:'Payment failed. Please try again.';
    showCardError(msg);
    btn.disabled=false;btn.textContent='Pay $'+(window._pendingTotal||0).toFixed(2);
  });
}

function showCardError(msg){
  var el=document.getElementById('card-error');
  if(el){el.textContent=msg;el.style.display='block';}
}

function backToCheckoutForm(){
  // Destroy card widget
  if(window._sqCard){try{window._sqCard.destroy();}catch(e){}window._sqCard=null;}
  // Cancel the pending order so stock is restored
  var oid=window._pendingOrderId;
  if(oid){
    apiFetch('customers.php','POST',{action:'cancel_order',order_id:oid,cancel_token:window._pendingCancelToken}).catch(function(){});
    window._pendingOrderId=null;
    window._pendingCancelToken=null;
  }
  // Restore cart items
  if(window._pendingCartItems){
    CART=window._pendingCartItems;
    window._pendingCartItems=null;
    updCartCount();renderStore();
  }
  _hide('co-payment');_show('co-form');
  updateShippingDisplay();
}

// ── IN-PERSON (cash/check) ORDER CONFIRMATION ──
function showInPersonConfirm(oid,total,o,method,checkNum){
  closeModal('co-modal');
  var existing=document.getElementById('inperson-confirm-modal');
  if(existing)existing.remove();
  var div=document.createElement('div');
  div.id='inperson-confirm-modal';
  div.className='modal-ov on';
  div.style.zIndex='300';
  div.innerHTML=
    '<div class="modal-box" style="max-width:460px;text-align:center;padding:0;overflow:hidden">'+
    '<div style="background:#2e7d32;padding:1.5rem 2rem">'+
      '<div style="font-size:1.8rem;margin-bottom:.3rem">✅</div>'+
      '<div style="color:#fff;font-weight:700;font-size:1.1rem">Order Placed</div>'+
      '<div style="color:rgba(255,255,255,.85);font-size:.82rem;margin-top:.3rem">Paid by '+method+(checkNum?' (Check #'+checkNum+')':'')+'</div>'+
    '</div>'+
    '<div style="padding:1.8rem 2rem">'+
      '<div style="background:#fffdf0;border:1px solid #e8e0b8;border-radius:10px;padding:1rem;margin-bottom:1.2rem;font-size:.88rem">'+
        '<div style="display:flex;justify-content:space-between;margin-bottom:.4rem"><span style="color:#6b6040">Order ID</span><strong style="font-family:monospace">#'+oid+'</strong></div>'+
        '<div style="display:flex;justify-content:space-between;margin-bottom:.4rem"><span style="color:#6b6040">Customer</span><strong>'+o.cust+'</strong></div>'+
        '<div style="display:flex;justify-content:space-between"><span style="color:#6b6040">Total</span><strong style="color:#a07810;font-size:1.1rem">$'+total.toFixed(2)+'</strong></div>'+
      '</div>'+
      '<div style="font-size:.82rem;color:#6b6040;margin-bottom:1.2rem;line-height:1.6">'+
        'Your order has been saved with status <strong>Paid</strong>.<br>'+
        'A confirmation email has been sent to <strong>'+o.email+'</strong>.'+
      '</div>'+
      '<button class="mbtn" style="max-width:240px;margin:0 auto" onclick="document.getElementById(\'inperson-confirm-modal\').remove()">Close</button>'+
    '</div>'+
    '</div>';
  document.body.appendChild(div);
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

function cancelPendingOrder(){
  var oid=window._pendingOrderId;
  if(!oid)return;
  var btn=document.getElementById('co-cancel-btn');
  if(btn){btn.disabled=true;btn.textContent='Cancelling…';}
  apiFetch('customers.php','POST',{action:'cancel_order',order_id:oid,cancel_token:window._pendingCancelToken})
    .then(function(){
      window._pendingOrderId=null;
      window._pendingCancelToken=null;
      if(window._sqCard){try{window._sqCard.destroy();}catch(e){}window._sqCard=null;}
      // Restore cart items if cancelling from payment step
      if(window._pendingCartItems){
        CART=window._pendingCartItems;
        window._pendingCartItems=null;
        updCartCount();renderStore();
      }
      closeModal('co-modal');
      // Reset panels for next time
      _show('co-form');_hide('co-payment');_hide('co-processing');_hide('co-result');
      showToast('Order cancelled.');
    })
    .catch(function(){
      if(btn){btn.disabled=false;btn.textContent='Cancel order';}
      showToast('Could not cancel — please contact us if you need help.','error');
    });
}

