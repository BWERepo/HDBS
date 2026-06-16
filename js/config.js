// ── GLOBALS ──
var SEC=null;
var SQUARE_MODE='live';
var SQ_FEE_PCT=2.6;
var SQ_FEE_CENTS=0.10;
var TAX_RATES={
  'AL':4,'AK':0,'AZ':5.6,'AR':6.5,'CA':7.25,'CO':2.9,'CT':6.35,'DE':0,
  'FL':6,'GA':4,'HI':4,'ID':6,'IL':6.25,'IN':7,'IA':6,'KS':6.5,
  'KY':6,'LA':4.45,'ME':5.5,'MD':6,'MA':6.25,'MI':6,'MN':6.875,'MS':7,
  'MO':4.225,'MT':0,'NE':5.5,'NV':6.85,'NH':0,'NJ':6.625,'NM':5.125,'NY':4,
  'NC':4.75,'ND':5,'OH':5.75,'OK':4.5,'OR':0,'PA':6,'RI':7,'SC':6,
  'SD':4.5,'TN':7,'TX':6.25,'UT':4.85,'VT':6,'VA':4.3,'WA':6.5,'WV':6,
  'WI':5,'WY':4,'DC':6
};
var TN_COUNTY_RATES={
  'anderson':9.75,'bedford':9.75,'benton':9.5,'bledsoe':9.75,'blount':9.75,
  'bradley':9.75,'campbell':9.75,'cannon':9.75,'carroll':9.5,'carter':9.75,
  'cheatham':9.75,'chester':9.75,'claiborne':9.75,'clay':9.5,'cocke':9.75,
  'coffee':9.75,'crockett':9.75,'cumberland':9.75,'davidson':9.75,'decatur':9.5,
  'dekalb':9.75,'dickson':9.75,'dyer':9.75,'fayette':9.75,'fentress':9.75,
  'franklin':9.75,'gibson':9.75,'giles':9.75,'grainger':9.75,'greene':9.75,
  'grundy':9.75,'hamblen':9.75,'hamilton':9.25,'hancock':9.75,'hardeman':9.75,
  'hardin':9.75,'hawkins':9.75,'haywood':9.75,'henderson':9.75,'henry':9.75,
  'hickman':9.75,'houston':9.5,'humphreys':9.75,'jackson':9.5,'jefferson':9.75,
  'johnson':9.75,'knox':9.75,'lake':9.75,'lauderdale':9.75,'lawrence':9.75,
  'lewis':9.75,'lincoln':9.75,'loudon':9.75,'mcminn':9.75,'mcnairy':9.75,
  'macon':9.75,'madison':9.75,'marion':9.75,'marshall':9.75,'maury':9.75,
  'meigs':9.75,'monroe':9.75,'montgomery':9.75,'moore':9.75,'morgan':9.75,
  'obion':9.75,'overton':9.75,'perry':9.5,'pickett':9.5,'polk':9.75,
  'putnam':9.75,'rhea':9.75,'roane':9.75,'robertson':9.75,'rutherford':9.75,
  'scott':9.75,'sequatchie':9.75,'sevier':9.75,'shelby':9.75,'smith':9.75,
  'stewart':9.5,'sullivan':9.75,'sumner':9.75,'tipton':9.75,'trousdale':9.75,
  'unicoi':9.75,'union':9.75,'van buren':9.5,'warren':9.75,'washington':9.75,
  'wayne':9.75,'weakley':9.75,'white':9.75,'williamson':9.75,'wilson':9.75
};
var TN_CITY_COUNTY={
  'knoxville':'knox','nashville':'davidson','memphis':'shelby','chattanooga':'hamilton',
  'clarksville':'montgomery','murfreesboro':'rutherford','franklin':'williamson',
  'jackson':'madison','johnson city':'washington','hendersonville':'sumner',
  'kingsport':'sullivan','columbia':'maury','oak ridge':'anderson','morristown':'hamblen',
  'cookeville':'putnam','smyrna':'rutherford','maryville':'blount','brentwood':'williamson',
  'bristol':'sullivan','bartlett':'shelby','germantown':'shelby','collierville':'shelby',
  'spring hill':'williamson','gallatin':'sumner','la vergne':'rutherford',
  'lebanon':'wilson','mount juliet':'wilson','east ridge':'hamilton','athens':'mcminn',
  'cleveland':'bradley','elizabethton':'carter','greeneville':'greene','sevierville':'sevier',
  'gatlinburg':'sevier','pigeon forge':'sevier','oak hill':'davidson','goodlettsville':'davidson'
};
var CATS=['Tote Bags','Purses','Clutches','Crossbody','Mini Bags','Other']; // admin-managed
var CAT_PREFIXES={'Tote Bags':'TOT','Purses':'PUR','Clutches':'CLU','Crossbody':'CRS','Mini Bags':'MIN','Other':'OTH'}; // persisted to DB
var ACTIVE_CAT='All'; // current filter // loaded from DB on startup
var PRODS=[], ORDERS=[], CUSTS=[], CART=[], SUBS=[];
var CUR_USER=null;
var EDITID=null, CAMSTREAM=null;
var EDIT_PHOTOS=['','',''];
var ACTIVE_SLOT=0; // which slot camera/upload is targeting

var PD_CUR=0;
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
var WEIGHT_TIERS=[
  {min:5,   max:null, charge:10},
  {min:3,   max:5,    charge:6},
  {min:1,   max:3,    charge:3},
  {min:0,   max:1,    charge:0}
];
var API='https://handmadedesignsbysuzi.com/api';
var LB_IMGS=[];var LB_IDX=0;
var BLAST_TARGET='subs';
var ORDER_FILTER='';
var ORDER_DATE_FROM='';
var ORDER_DATE_TO='';
var MO_ITEMS=[];
var MO_PRODS_OPTS='';
var ORD_SORT={col:'date',dir:-1};
var ORD_F={id:'',cust:'',dateFrom:'',dateTo:'',total:'',tax:'',pay:'',status:'',swept_date:''};
var RT_GROUPS={
  'DB Schema':['orders.tax_amount','orders.tax_swept_date','orders.payment_method','orders.customer_email','orders.total','orders.shipping_carrier','orders.tracking_number','orders.square_payment_id','products.sku','products.img1','products.price','products.name','products.stock','products.weight','orders table','products table','order_items table','settings table','tax_sweeps table','settings LONGTEXT','tax_swept removed'],
  'Data Integrity':['products exist','orders exist','settings exist','square_mode set','shipping_config','biz_profile','products have SKUs','no duplicate SKUs'],
  'Required Files':['api/config.php','api/admin.php','api/orders.php','api/products.php','api/tax_sweep.php','api/square_payments.php','mailer.php','checkout.php','send_confirm.php','send_shipping.php','index.html'],
  'JS Functions':['JS:openCheckout','JS:placeOrder','JS:renderOrdersTable','JS:viewOrder','JS:showManualOrderForm','JS:sendConfirmEmail','JS:rSweep','JS:rSqPay','JS:applyShippingConfig','JS:rBizProfile','JS:buildAdminNav','JS:saveNavOrder','JS:rRegTest','JS:runRegTests','JS:cancelRegTests','JS:SQ_FEE_PCT','JS:TAX_RATES','JS:admin-nav','JS:updCarrier','JS:updTracking','JS:deleteOrder','JS:sendShippingEmail','JS:pfNextSku','JS:pfAutoSku','JS:fetchOrderTax']
};
var ADMIN_NAV_DEFAULT=[
  {sec:'dash',    label:'📊 Dashboard'},
  {sec:'prods',   label:'👜 Products'},
  {sec:'orders',  label:'📦 Orders'},
  {sec:'manord',  label:'📋 Manual Order'},
  {sec:'custs',   label:'👥 Customers'},
  {sec:'sales',   label:'💰 Sales'},
  {sec:'subs',    label:'✉️ Subscribers'},
  {sec:'blast',   label:'📣 Email Blast'},
  {sec:'faqs',    label:'❓ FAQs'},
  {sec:'reviews', label:'⭐ Reviews'},
  {sec:'cats',    label:'🏷️ Categories'},
  {sec:'shipping',label:'🚚 Shipping Charges'},
  {sec:'sqpay',   label:'💳 Square Payments'},
  {sec:'sweep',   label:'🧾 Tax Sweep'},
  {sec:'regtest', label:'🧪 Regression Tests'},
  {sec:'logs',    label:'📋 Error Logs'},
  {sec:'bizprofile',label:'🏢 Business Profile'},
  {sec:'settings',label:'⚙️ Settings'}
];
var FAQS=[];
var REVIEWS=[];
var SELECTED_STARS=5;
var CFP_USER=null; // the customer being reset


// ── PAGE CONTROL ──
function showOnly(id,flex){
  var pages=['store','authpage','alog','apanel','contactpage','aboutpage','faqpage','custompg','pd-page'];
  for(var i=0;i<pages.length;i++){
    var el=document.getElementById(pages[i]);
    if(pages[i]===id){
      el.style.display=flex?'flex':'block';
      el.classList.remove('page-fade');
      void el.offsetWidth; // force reflow to restart animation
      el.classList.add('page-fade');
    } else {
      el.style.display='none';
      el.classList.remove('page-fade');
    }
  }
}
function goStore(){showOnly('store');updateNav();}
function submitContact(){
  var em=document.getElementById('ctc-em').value.trim();
  var msg=document.getElementById('ctc-msg').value.trim();
  var ok=document.getElementById('ctc-ok');
  var err=document.getElementById('ctc-err');
  if(!em||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)){if(err){err.style.display='block';err.textContent='Please enter a valid email address.';}return;}
  if(!msg){if(err){err.style.display='block';err.textContent='Please enter a message.';}return;}
  if(err)err.style.display='none';
  var fn=document.getElementById('ctc-fn').value.trim();
  var ln=document.getElementById('ctc-ln').value.trim();
  apiFetch('contact.php','POST',{name:(fn+' '+ln).trim(),email:em,message:msg})
    .then(function(d){
      if(d&&d.success){
        if(ok){ok.style.display='block';}
        document.getElementById('ctc-fn').value='';
        document.getElementById('ctc-ln').value='';
        document.getElementById('ctc-em').value='';
        document.getElementById('ctc-msg').value='';
      } else {
        if(err){err.style.display='block';err.textContent='Error: '+(d&&d.error?d.error:'Could not send message.');}
      }
    }).catch(function(){if(err){err.style.display='block';err.textContent='Network error. Please email us directly.';}});
}
function goAdminLogin(){document.getElementById('lpw').value='';document.getElementById('lerr').style.display='none';showOnly('alog',true);}
function goPanel(){
  showOnly('apanel',true);
  buildAdminNav();
  // Show loading state on dashboard
  document.getElementById('aptitle').textContent='Dashboard';
  document.getElementById('addbtn').style.display='none';
  document.getElementById('acnt').innerHTML='<div style="padding:3rem;text-align:center;color:#6b6040">Loading…</div>';
  // Fetch all data in parallel then render dashboard
  Promise.all([
    apiFetch('orders.php').then(function(d){if(d.success)ORDERS=d.orders||[];}),
    apiFetch('customers.php?action=list').then(function(d){if(d.success)CUSTS=d.customers||[];}),
    apiFetch('products.php').then(function(d){if(d.success&&d.products)PRODS=d.products;}),
    apiFetch('subscribers.php').then(function(d){if(d.success)SUBS=d.subscribers||[];})
  ]).catch(function(){}).then(function(){
    aNavById('dash');
  });
}
function goAbout(){showOnly('aboutpage');window.scrollTo(0,0);}
function goFAQ(){loadFAQs();showOnly('faqpage');window.scrollTo(0,0);}
function goCustom(){showOnly('custompg');window.scrollTo(0,0);}
function submitCustomRequest(){
  var name=document.getElementById('cust-name').value.trim();
  var email=document.getElementById('cust-email').value.trim();
  var type=document.getElementById('cust-type').value;
  var idea=document.getElementById('cust-idea').value.trim();
  var phone=document.getElementById('cust-phone').value.trim();
  var budget=document.getElementById('cust-budget').value;
  var err=document.getElementById('custom-err');
  var ok=document.getElementById('custom-ok');
  err.style.display='none';
  if(!name||!email||!idea){err.textContent='Please fill in your name, email and idea.';err.style.display='block';return;}
  apiFetch('api/contact.php','POST',{
    name:name,email:email,
    subject:'Custom Order Request — '+type,
    message:'Phone: '+(phone||'Not provided')+'\n\nType: '+type+'\n\nBudget: '+(budget||'Not specified')+'\n\nIdea:\n'+idea
  }).then(function(d){
    if(d.success){
      ok.style.display='block';
      ['cust-name','cust-email','cust-phone','cust-idea'].forEach(function(id){document.getElementById(id).value='';});
      document.getElementById('cust-type').value='';
      document.getElementById('cust-budget').value='';
    } else {
      err.textContent=d.error||'Failed to send. Please email us directly.';
      err.style.display='block';
    }
  }).catch(function(){err.textContent='Network error. Please email handmadedesignsbysuzi@yahoo.com directly.';err.style.display='block';});
}
function goContact(){
  showOnly('contactpage',true);
  window.scrollTo(0,0);
  document.getElementById('contact-ok').style.display='none';
  ['ct-name','ct-email','ct-subject','ct-msg'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
}
function sendContact(){
  var name=document.getElementById('ct-name').value.trim();
  var email=document.getElementById('ct-email').value.trim();
  var subject=(document.getElementById('ct-subject')||{}).value||'';
  var msg=document.getElementById('ct-msg').value.trim();
  var ok=document.getElementById('contact-ok');
  if(!name||!email||!msg){alert('Please fill in your name, email, and message.');return;}
  ok.style.background='#e8f5e9';ok.style.color='#2e7d32';
  ok.textContent='Sending...';
  ok.style.display='block';
  apiFetch('contact.php','POST',{name:name,email:email,subject:subject,message:msg})
  .then(function(d){
    if(d.success){
      ok.textContent='Message sent! We will be in touch soon.';
      ['ct-name','ct-email','ct-subject','ct-msg'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
    } else {
      ok.style.background='#fde8e8';ok.style.color='#c0392b';
      ok.textContent=d.error||'Failed to send. Please email us directly.';
    }
  })
  .catch(function(){
    ok.style.background='#fde8e8';ok.style.color='#c0392b';
    ok.textContent='Network error. Please email us directly at handmadedesignsbysuzi@yahoo.com';
  });
}
function goAuth(tab){
  showOnly('authpage',true);
  if(tab==='account'&&CUR_USER){document.getElementById('auth-tabs').style.display='none';switchTab('ac');renderAcct();}
  else{document.getElementById('auth-tabs').style.display='flex';switchTab(tab==='su'?'su':'si');}
}
function switchTab(t){
  var ts=['si','su','ac','fp'];
  for(var i=0;i<ts.length;i++){var sv=document.getElementById('sv-'+ts[i]);if(sv)sv.classList.toggle('on',ts[i]===t);}
  var tsi=document.getElementById('tab-si'),tsu=document.getElementById('tab-su');
  if(tsi)tsi.classList.toggle('on',t==='si');if(tsu)tsu.classList.toggle('on',t==='su');
  // reset forgot-password steps when entering that panel
  if(t==='fp'){
    document.getElementById('cfp-s1').style.display='block';
    document.getElementById('cfp-s2').style.display='none';
    document.getElementById('cfp-s3').style.display='none';
    ['cfp-em','cfp-ans','cfp-pw1','cfp-pw2'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
    ['cfp-err1','cfp-err2','cfp-err3'].forEach(function(id){var el=document.getElementById(id);if(el)el.style.display='none';});
  }
}
function openMenu(){
  document.getElementById('side-menu').classList.add('on');
  document.getElementById('menu-overlay').classList.add('on');
  document.body.style.overflow='hidden';
}
function closeMenu(){
  document.getElementById('side-menu').classList.remove('on');
  document.getElementById('menu-overlay').classList.remove('on');
  document.body.style.overflow='';
}
function updateNav(){
  var ab=document.getElementById('auth-btn'),acb=document.getElementById('acct-btn'),sob=document.getElementById('so-btn'),gr=document.getElementById('greeting');
  if(CUR_USER){
    gr.textContent='Hi, '+(CUR_USER.fn||CUR_USER.name)+'!';
    ab.style.display='none';acb.style.display='inline-block';sob.style.display='inline-block';
  } else {
    gr.textContent='';ab.style.display='inline-block';acb.style.display='none';sob.style.display='none';
  }
  var ssi=document.getElementById('sm-signin'),sac=document.getElementById('sm-account'),sso=document.getElementById('sm-signout');
  if(ssi)ssi.style.display=CUR_USER?'none':'flex';
  if(sac)sac.style.display=CUR_USER?'flex':'none';
  if(sso)sso.style.display=CUR_USER?'flex':'none';
}
function openModal(id){document.getElementById(id).classList.add('on');}
function closeModal(id){document.getElementById(id).classList.remove('on');}

