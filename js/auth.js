// ── AUTH ──
function doSignIn(){
  var em=document.getElementById('si-em').value.trim(),pw=document.getElementById('si-pw').value;
  var err=document.getElementById('si-err');err.style.display='none';
  if(!em||!pw){err.textContent='Please enter email and password.';err.style.display='block';return;}
  apiFetch('customers.php','POST',{action:'login',em:em,pw:pw}).then(function(d){
    if(!d.success){err.textContent=d.error||'Incorrect email or password.';err.style.display='block';return;}
    CUR_USER=d;
    document.getElementById('si-em').value='';document.getElementById('si-pw').value='';
    updateNav();goStore();
  }).catch(function(){err.textContent='Network error. Please try again.';err.style.display='block';});
}
function doSignUp(){
  var fn=document.getElementById('su-fn').value.trim(),ln=document.getElementById('su-ln').value.trim();
  var em=document.getElementById('su-em').value.trim(),pw=document.getElementById('su-pw').value,pw2=document.getElementById('su-pw2').value;
  var ph=document.getElementById('su-ph').value.trim();
  var sq=document.getElementById('su-sq').value;
  var sa=document.getElementById('su-sa').value.trim();
  var sa2=document.getElementById('su-sa2').value.trim();
  var err=document.getElementById('su-err');err.style.display='none';
  if(!fn){err.textContent='Please enter your first name.';err.style.display='block';return;}
  if(!em){err.textContent='Please enter your email.';err.style.display='block';return;}
  if(!pw||pw.length<6){err.textContent='Password must be at least 6 characters.';err.style.display='block';return;}
  if(pw!==pw2){err.textContent='Passwords do not match.';err.style.display='block';return;}
  if(!sq){err.textContent='Please choose a security question.';err.style.display='block';return;}
  if(!sa){err.textContent='Please enter your security answer.';err.style.display='block';return;}
  if(sa.toLowerCase()!==sa2.toLowerCase()){err.textContent='Security answers do not match.';err.style.display='block';return;}
  for(var i=0;i<CUSTS.length;i++)if(CUSTS[i].em===em){err.textContent='Email already registered.';err.style.display='block';return;}
  apiFetch('customers.php','POST',{action:'register',fn:fn,ln:ln,em:em,pw:pw,ph:ph,secQ:sq,secA:sa}).then(function(d){
    if(!d.success){err.textContent=d.error||'Registration failed.';err.style.display='block';return;}
    CUR_USER={id:d.id,fn:fn,ln:ln,name:d.name,em:em,ph:ph,orders:0,secQ:sq,orders_token:d.orders_token};
    ['su-fn','su-ln','su-em','su-pw','su-pw2','su-ph','su-sa','su-sa2'].forEach(function(id2){document.getElementById(id2).value='';});
    document.getElementById('su-sq').value='';
    updateNav();goStore();
  }).catch(function(){err.textContent='Network error. Please try again.';err.style.display='block';});
}
function doSignOut(){CUR_USER=null;updateNav();goStore();}
function renderAcct(){
  if(!CUR_USER)return;
  document.getElementById('acct-content').innerHTML=
    '<div class="acct-card"><div class="acct-title">👤 My Profile</div>'+
    '<div class="acct-row"><span class="acct-label">Name</span><span class="acct-val">'+CUR_USER.name+'</span></div>'+
    '<div class="acct-row"><span class="acct-label">Email</span><span class="acct-val">'+CUR_USER.em+'</span></div>'+
    '<div class="acct-row"><span class="acct-label">Phone</span><span class="acct-val">'+(CUR_USER.ph||'—')+'</span></div>'+
    '<div class="acct-row"><span class="acct-label">Member since</span><span class="acct-val">'+(CUR_USER.joined||'—')+'</span></div></div>'+
    '<div class="acct-card"><div class="acct-title">📦 My Orders</div><div id="acct-orders"><p style="font-size:.83rem;color:#6b6040;padding:.6rem 0">Loading your orders…</p></div></div>'+
    '<div class="acct-card"><div class="acct-title">🔒 Change Password</div>'+
    '<div class="mok" id="cpw-ok">✓ Password updated!</div><div class="merr" id="cpw-err"></div>'+
    '<label class="fl">Current Password</label><input class="fi" id="cpw-c" type="password" placeholder="Current password">'+
    '<label class="fl">New Password</label><input class="fi" id="cpw-n" type="password" placeholder="New password (min 6 chars)">'+
    '<label class="fl">Confirm</label><input class="fi" id="cpw-cf" type="password" placeholder="Confirm new password">'+
    '<button class="bp" onclick="changeCustPw()">Update Password</button></div>';
  loadMyOrders(CUR_USER.orders_token,'acct-orders');
}

// ── CUSTOMER ORDER LOOKUP (account view + guest magic link) ──
function _moEsc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function _moBadge(st){return (st==='Delivered'||st==='Paid')?'bg':st==='Shipped'?'bb':(st==='Cancelled'||st==='Refunded')?'br':st==='Awaiting Payment'?'bw':'ba';}
function renderOrderCards(orders){
  if(!orders||!orders.length)return '<p style="font-size:.85rem;color:#6b6040;padding:.8rem 0;text-align:center">No orders found for this email yet.</p>';
  return orders.map(function(o){
    var items=(o.items||[]).map(function(it){return '<div style="display:flex;justify-content:space-between;font-size:.82rem;color:#2d2220;padding:.12rem 0"><span>'+_moEsc(it.name)+' &times;'+it.q+'</span><span>$'+(it.price*it.q).toFixed(2)+'</span></div>';}).join('');
    var track=o.tracking?'<div style="font-size:.8rem;color:#2e7d32;margin-top:.4rem">📦 '+_moEsc(o.carrier||'')+' '+_moEsc(o.tracking)+'</div>':'';
    return '<div style="border:1px solid #e8e0b8;border-radius:10px;padding:.85rem 1rem;margin-bottom:.7rem;background:#fff">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;gap:.5rem;flex-wrap:wrap">'+
        '<span style="font-weight:700;color:#2d2220"><code style="font-size:.76rem;color:#a07810">'+_moEsc(o.id)+'</code> &middot; '+_moEsc(o.date)+'</span>'+
        '<span class="badge '+_moBadge(o.status)+'">'+_moEsc(o.status)+'</span>'+
      '</div>'+items+
      '<div style="border-top:1px solid #f0e8d0;margin-top:.5rem;padding-top:.4rem;font-size:.82rem;color:#6b6040">'+
        '<div style="display:flex;justify-content:space-between"><span>Shipping</span><span>'+(o.shipping>0?'$'+o.shipping.toFixed(2):'Free')+'</span></div>'+
        '<div style="display:flex;justify-content:space-between"><span>Tax</span><span>$'+(o.tax||0).toFixed(2)+'</span></div>'+
        (o.refunded>0?'<div style="display:flex;justify-content:space-between;color:#c0392b"><span>Refunded</span><span>-$'+o.refunded.toFixed(2)+'</span></div>':'')+
        '<div style="display:flex;justify-content:space-between;font-weight:700;color:#a07810;margin-top:.2rem"><span>Total</span><span>$'+o.total.toFixed(2)+'</span></div>'+
      '</div>'+track+
    '</div>';
  }).join('');
}
function loadMyOrders(token,containerId){
  var el=document.getElementById(containerId);if(!el)return;
  if(!token){el.innerHTML='<p style="font-size:.83rem;color:#6b6040;padding:.6rem 0">Please sign in again to view your orders.</p>';return;}
  apiFetch('order_lookup.php','POST',{action:'view',token:token}).then(function(d){
    if(!d||!d.success){el.innerHTML='<p style="font-size:.83rem;color:#c0392b;padding:.6rem 0">'+((d&&d.error)||'Could not load your orders.')+'</p>';return;}
    el.innerHTML=renderOrderCards(d.orders||[]);
  }).catch(function(){el.innerHTML='<p style="font-size:.83rem;color:#c0392b;padding:.6rem 0">Network error loading orders.</p>';});
}
function openMyOrders(){
  if(typeof closeMenu==='function')closeMenu();
  var form=document.getElementById('mo-form'),list=document.getElementById('mo-list');
  if(CUR_USER&&CUR_USER.orders_token){
    form.style.display='none';list.style.display='block';
    document.getElementById('mo-list-body').innerHTML='<p style="color:#6b6040;padding:.6rem 0">Loading your orders…</p>';
    loadMyOrders(CUR_USER.orders_token,'mo-list-body');
  } else {
    form.style.display='block';list.style.display='none';
    var msg=document.getElementById('mo-msg');if(msg)msg.style.display='none';
    var em=document.getElementById('mo-email');if(em)em.value=(CUR_USER&&CUR_USER.em)||'';
  }
  openModal('myorders-modal');
}
function requestOrderLink(){
  var em=(document.getElementById('mo-email').value||'').trim();
  var msg=document.getElementById('mo-msg'),btn=document.getElementById('mo-send-btn');
  if(!em||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)){msg.style.display='block';msg.style.background='#fde8e8';msg.style.color='#c0392b';msg.textContent='Please enter a valid email address.';return;}
  btn.disabled=true;btn.textContent='Sending…';
  apiFetch('order_lookup.php','POST',{action:'request',email:em}).then(function(d){
    btn.disabled=false;btn.textContent='Email me a link to my orders';
    msg.style.display='block';
    if(d&&d.success){msg.style.background='#e8f5e9';msg.style.color='#2e7d32';msg.textContent=d.message||'Check your email for a link to view your orders.';}
    else{msg.style.background='#fde8e8';msg.style.color='#c0392b';msg.textContent=(d&&d.error)||'Something went wrong. Please try again.';}
  }).catch(function(){btn.disabled=false;btn.textContent='Email me a link to my orders';msg.style.display='block';msg.style.background='#fde8e8';msg.style.color='#c0392b';msg.textContent='Network error. Please try again.';});
}
function checkOrdersLink(){
  var params=new URLSearchParams(window.location.search);
  var tok=params.get('orders');
  if(!tok)return;
  history.replaceState({},'',window.location.pathname);
  var form=document.getElementById('mo-form'),list=document.getElementById('mo-list');
  if(form)form.style.display='none';if(list)list.style.display='block';
  var body=document.getElementById('mo-list-body');if(body)body.innerHTML='<p style="color:#6b6040;padding:.6rem 0">Loading your orders…</p>';
  openModal('myorders-modal');
  loadMyOrders(tok,'mo-list-body');
}
function changeCustPw(){
  var c=document.getElementById('cpw-c').value,n=document.getElementById('cpw-n').value,cf=document.getElementById('cpw-cf').value;
  var ok=document.getElementById('cpw-ok'),err=document.getElementById('cpw-err');ok.style.display='none';err.style.display='none';
  if(!n||n.length<6){err.textContent='New password must be at least 6 characters.';err.style.display='block';return;}
  if(n!==cf){err.textContent='Passwords do not match.';err.style.display='block';return;}
  apiFetch('customers.php','POST',{action:'change_password',id:CUR_USER.id,old_pw:c,new_pw:n}).then(function(d){
    if(!d.success){err.textContent=d.error||'Failed.';err.style.display='block';return;}
    document.getElementById('cpw-c').value='';document.getElementById('cpw-n').value='';document.getElementById('cpw-cf').value='';
    ok.style.display='block';
  }).catch(function(){err.textContent='Network error.';err.style.display='block';});
}


// ── ADMIN LOGIN ──
// Restore admin token from sessionStorage on page load
(function(){
  var t=sessionStorage.getItem('hdbs_admin_token');
  if(t)window._adminToken=t;
})();

// Called by apiFetch when an authenticated admin request is rejected with an
// expired/invalid session. Clears the stale token and returns to the login
// screen with a clear message. Guarded so parallel 401s only bounce once.
function handleSessionExpired(){
  if(window._sessionExpiredHandled)return;
  window._sessionExpiredHandled=true;
  window._adminToken=null;
  sessionStorage.removeItem('hdbs_admin_token');
  goAdminLogin();
  var el=document.getElementById('lerr');
  if(el){el.textContent='Your admin session expired. Please log in again.';el.style.display='block';}
}

function doLogin(){
  var pw=document.getElementById('lpw').value;
  if(!pw)return;
  apiFetch('admin.php','POST',{action:'login',password:pw}).then(function(d){
    if(d.success){
      window._sessionExpiredHandled=false;   // fresh session — re-arm expiry handling
      if(d.token){window._adminToken=d.token;sessionStorage.setItem('hdbs_admin_token',d.token);}
      document.getElementById('lerr').style.display='none';
      document.getElementById('lpw').value='';
      goPanel();
    } else {
      var el=document.getElementById('lerr');
      el.textContent=d.error||'Incorrect password. Please try again.';
      el.style.display='block';
    }
  }).catch(function(){var el=document.getElementById('lerr');el.textContent='Network error. Please try again.';el.style.display='block';});
}

function doLogout(){
  apiFetch('admin.php','POST',{action:'logout'}).catch(function(){});
  window._adminToken=null;
  sessionStorage.removeItem('hdbs_admin_token');
}

document.getElementById('lpw').addEventListener('keydown',function(e){if(e.key==='Enter')doLogin();});
document.addEventListener('DOMContentLoaded',function(){
  var nl=document.getElementById('nl-email');
  if(nl)nl.addEventListener('keydown',function(e){if(e.key==='Enter')nlSubscribe();});
});

