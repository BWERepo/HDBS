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
    CUR_USER={id:d.id,fn:fn,ln:ln,name:d.name,em:em,ph:ph,orders:0,secQ:sq};
    ['su-fn','su-ln','su-em','su-pw','su-pw2','su-ph','su-sa','su-sa2'].forEach(function(id2){document.getElementById(id2).value='';});
    document.getElementById('su-sq').value='';
    updateNav();goStore();
  }).catch(function(){err.textContent='Network error. Please try again.';err.style.display='block';});
}
function doSignOut(){CUR_USER=null;updateNav();goStore();}
function renderAcct(){
  if(!CUR_USER)return;
  var myO=[];for(var i=0;i<ORDERS.length;i++)if(ORDERS[i].email===CUR_USER.em)myO.push(ORDERS[i]);
  var orows='';for(var j=myO.length-1;j>=0;j--){var o=myO[j];orows+='<div class="acct-row"><span class="acct-label"><code style="font-size:.74rem">'+o.id+'</code> '+o.date+'</span><span class="acct-val" style="color:#a07810">$'+o.total.toFixed(2)+' <span class="badge ba">'+o.status+'</span></span></div>';}
  document.getElementById('acct-content').innerHTML=
    '<div class="acct-card"><div class="acct-title">👤 My Profile</div>'+
    '<div class="acct-row"><span class="acct-label">Name</span><span class="acct-val">'+CUR_USER.name+'</span></div>'+
    '<div class="acct-row"><span class="acct-label">Email</span><span class="acct-val">'+CUR_USER.em+'</span></div>'+
    '<div class="acct-row"><span class="acct-label">Phone</span><span class="acct-val">'+(CUR_USER.ph||'—')+'</span></div>'+
    '<div class="acct-row"><span class="acct-label">Member since</span><span class="acct-val">'+CUR_USER.joined+'</span></div></div>'+
    '<div class="acct-card"><div class="acct-title">📦 My Orders ('+(myO.length)+')</div>'+(orows||'<p style="font-size:.83rem;color:#6b6040;padding:.6rem 0">No orders yet — start shopping!</p>')+'</div>'+
    '<div class="acct-card"><div class="acct-title">🔒 Change Password</div>'+
    '<div class="mok" id="cpw-ok">✓ Password updated!</div><div class="merr" id="cpw-err"></div>'+
    '<label class="fl">Current Password</label><input class="fi" id="cpw-c" type="password" placeholder="Current password">'+
    '<label class="fl">New Password</label><input class="fi" id="cpw-n" type="password" placeholder="New password (min 6 chars)">'+
    '<label class="fl">Confirm</label><input class="fi" id="cpw-cf" type="password" placeholder="Confirm new password">'+
    '<button class="bp" onclick="changeCustPw()">Update Password</button></div>'+
    '<button class="bp" onclick="changeCustPw()">Update Password</button></div>';
}
function changeCustPw(){
  var c=document.getElementById('cpw-c').value,n=document.getElementById('cpw-n').value,cf=document.getElementById('cpw-cf').value;
  var ok=document.getElementById('cpw-ok'),err=document.getElementById('cpw-err');ok.style.display='none';err.style.display='none';
  if(c!==CUR_USER.pw){err.textContent='Current password is incorrect.';err.style.display='block';return;}
  if(!n||n.length<6){err.textContent='New password must be at least 6 characters.';err.style.display='block';return;}
  if(n!==cf){err.textContent='Passwords do not match.';err.style.display='block';return;}
  apiFetch('customers.php','POST',{action:'change_password',id:CUR_USER.id,old_pw:c,new_pw:n}).then(function(d){
    if(!d.success){err.textContent=d.error||'Failed.';err.style.display='block';return;}
    document.getElementById('cpw-c').value='';document.getElementById('cpw-n').value='';document.getElementById('cpw-cf').value='';
    ok.style.display='block';
  }).catch(function(){err.textContent='Network error.';err.style.display='block';});
}


// ── ADMIN LOGIN ──
function doLogin(){
  var pw=document.getElementById('lpw').value;
  if(!pw)return;
  apiFetch('admin.php','POST',{action:'login',password:pw}).then(function(d){
    if(d.success){document.getElementById('lerr').style.display='none';document.getElementById('lpw').value='';goPanel();}
    else document.getElementById('lerr').style.display='block';
  }).catch(function(){document.getElementById('lerr').style.display='block';});
}
document.getElementById('lpw').addEventListener('keydown',function(e){if(e.key==='Enter')doLogin();});
document.addEventListener('DOMContentLoaded',function(){
  var nl=document.getElementById('nl-email');
  if(nl)nl.addEventListener('keydown',function(e){if(e.key==='Enter')nlSubscribe();});
});

