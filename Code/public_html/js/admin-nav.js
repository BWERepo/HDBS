// ── ADMIN NAV ──
function aNav(el,sec){var items=document.querySelectorAll('.sitem');for(var i=0;i<items.length;i++)items[i].classList.remove('on');el.classList.add('on');aNavById(sec);}
function aNavById(sec){
  ;
  var titles={dash:'Dashboard',prods:'Product Management',orders:'Orders',custs:'Customers',inv:'Inventory',sales:'Sales Report',subs:'Newsletter Subscribers',blast:'Email Blast',faqs:'FAQs',reviews:'Reviews',cats:'Categories',shipping:'Shipping Charges',manord:'Manual Order',sqpay:'Square Payments',sweep:'Tax Sweep',regtest:'Regression Tests',bizprofile:'Business Profile',emaillog:'Email Log',logs:'Error Logs',settings:'Settings',tncity:'TN City Sales Taxes'};
  document.getElementById('aptitle').textContent=titles[sec]||sec;
  var ab=document.getElementById('addbtn');
  if(sec==='prods'){ab.style.display='inline-block';ab.textContent='+ Add Product';ab.onclick=function(){showPF(null);};}
  else if(sec==='orders'){
    ab.style.display='none';
}
  else{
    ab.style.display='none';
  }
  var amain=document.querySelector('.amain');
  if(amain)amain.style.overflowY=(sec==='emaillog')?'visible':'';
  if(typeof _dbgScreen==='function')_dbgScreen(sec);
  var el=document.getElementById('acnt');
  if(sec==='dash')rDash(el);else if(sec==='prods')rProds(el);else if(sec==='orders')rOrders(el);
  else if(sec==='custs')rCusts(el);else if(sec==='inv')rInv(el);else if(sec==='sales')rSales(el);else if(sec==='subs')rSubs(el);else if(sec==='blast')rBlast(el);else if(sec==='tncity')rTnCity(el);else if(sec==='faqs')rAdminFAQs(el);else if(sec==='reviews')rAdminReviews(el);else if(sec==='cats')rCats(el);else if(sec==='shipping')rShipping(el);else if(sec==='emaillog')rEmailLog(el);else if(sec==='logs')rLogs(el);else if(sec==='settings')rSettings(el);else if(sec==='bizprofile')rBizProfile(el);else if(sec==='sweep')rSweep(el);else if(sec==='regtest')rRegTest(el);else if(sec==='sqpay')rSqPay(el);else if(sec==='manord')showManualOrderForm();
}

function rDash(el){
  var rev=0;for(var i=0;i<ORDERS.length;i++)rev+=ORDERS[i].total;
  var low=0;for(var j=0;j<PRODS.length;j++)if(PRODS[j].stock>0&&PRODS[j].stock<=3)low++;
  el.innerHTML='<div class="stats"><div class="stat"><div class="stl">Revenue</div><div class="stv">$'+rev.toFixed(2)+'</div></div><div class="stat"><div class="stl">Orders</div><div class="stv">'+ORDERS.length+'</div></div><div class="stat"><div class="stl">Customers</div><div class="stv">'+CUSTS.length+'</div></div><div class="stat"><div class="stl">Products</div><div class="stv">'+PRODS.length+'</div></div><div class="stat"><div class="stl">Subscribers</div><div class="stv">'+SUBS.length+'</div></div></div>';
}

function rSubs(el){
  el.innerHTML='<div style="padding:2rem;text-align:center;color:#6b6040">Loading subscribers…</div>';
  apiFetch('subscribers.php').then(function(d){
    if(d.success)SUBS=d.subscribers||[];
    renderSubsTable(el);
  }).catch(function(){renderSubsTable(el);});
}
function renderSubsTable(el){
  var rows='';
  for(var i=SUBS.length-1;i>=0;i--){
    var s=SUBS[i];
    rows+='<tr><td>'+s.email+'</td><td>'+s.date+'</td>' +
      '<td><button class="bd" onclick="delSub(\''+s.email+'\')">Remove</button></td></tr>';
  }
  el.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">' +
    '<div style="font-size:.88rem;color:#6b6040">'+SUBS.length+' subscriber'+(SUBS.length!==1?'s':'')+'</div>' +
    '<button class="bp" onclick="exportSubs()" style="font-size:.78rem;padding:.38rem .8rem">⬇ Export CSV</button>' +
    '</div>' +
    '<table><thead><tr><th>Email</th><th>Subscribed</th><th>Action</th></tr></thead><tbody>' +
    (rows||'<tr><td colspan="3" style="text-align:center;padding:2rem;color:#6b6040">No subscribers yet.<br><span style="font-size:.8rem">The newsletter section on the homepage will collect emails here.</span></td></tr>') +
    '</tbody></table>';
}
function delSub(email){
  if(!confirm('Remove '+email+' from the newsletter list?'))return;
  SUBS=SUBS.filter(function(s){return s.email!==email;});
  apiFetch('subscribers.php','DELETE',{email:email}).catch(function(){});
  rSubs(document.getElementById('acnt'));
}
function exportSubs(){
  if(!SUBS.length){alert('No subscribers to export.');return;}
  var csv='Email,Date Subscribed\n';
  for(var i=0;i<SUBS.length;i++)csv+=SUBS[i].email+','+SUBS[i].date+'\n';
  var a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download='suzi_newsletter_subscribers.csv';
  a.click();
}

