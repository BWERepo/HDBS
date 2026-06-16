// ── Send confirmation email ──
function updCarrier(id,val){
  for(var i=0;i<ORDERS.length;i++)if(ORDERS[i].id===id){ORDERS[i].carrier=val;break;}
  apiFetch('orders.php','PUT',{id:id,carrier:val}).catch(function(){});
}
function updTracking(id){
  var el=document.getElementById('vo-track-'+id);
  if(!el)return;
  var val=el.value.trim();
  for(var i=0;i<ORDERS.length;i++)if(ORDERS[i].id===id){ORDERS[i].tracking=val;break;}
  apiFetch('orders.php','PUT',{id:id,tracking:val})
  .then(function(d){
    var msg=document.getElementById('vo-msg-'+id);
    if(msg){msg.style.color='#2e7d32';msg.textContent='✓ Tracking saved';setTimeout(function(){msg.textContent='';},2500);}
  }).catch(function(){});
}
function sendConfirmEmail(oid){
  var order=ORDERS.find(function(o){return o.id===oid;});
  var email=order?order.email:'';
  if(!email||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){
    var msgEl2=document.getElementById('vo-msg-'+oid);
    if(msgEl2){msgEl2.style.color='#c62828';msgEl2.textContent='Cannot send: no valid email address on this order.';}
    return;
  }
  var msgEl=document.getElementById('vo-msg-'+oid);
  if(msgEl){msgEl.style.color='#6b6040';msgEl.textContent='Sending…';}
  fetch('https://handmadedesignsbysuzi.com/send_confirm.php',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({order_id:oid})
  }).then(function(r){return r.json();})
  .then(function(d){
    if(msgEl){
      if(d.success){
        msgEl.style.color='#2e7d32';
        msgEl.textContent='\u2713 Confirmation email sent to '+(d.to||'customer')+'!';
      } else {
        msgEl.style.color='#c62828';
        msgEl.textContent='Email failed: '+(d.error||'unknown');
      }
    }
  }).catch(function(e){
    if(msgEl){msgEl.style.color='#c62828';msgEl.textContent='Network error: '+e;}
  });
}
// ── Send shipping notification email ──
function sendShippingEmail(oid){
  var order=ORDERS.find(function(o){return o.id===oid;});
  if(!order){alert('Order not found.');return;}
  var email=order.email||'';
  if(!email||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){
    var msgEl3=document.getElementById('vo-msg-'+oid);
    if(msgEl3){msgEl3.style.color='#c62828';msgEl3.textContent='Cannot send: no valid email address on this order.';}
    return;
  }
  if(!order.carrier&&!order.tracking){
    if(!confirm('No carrier or tracking set. Send anyway?'))return;
  }
  var msgEl=document.getElementById('vo-msg-'+oid);
  if(msgEl){msgEl.style.color='#6b6040';msgEl.textContent='Sending shipping notification…';}
  fetch('https://handmadedesignsbysuzi.com/send_shipping.php',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({order_id:oid})
  }).then(function(r){return r.json();})
  .then(function(d){
    if(msgEl){
      if(d.success){
        msgEl.style.color='#2e7d32';
        msgEl.textContent='\u2713 Shipping email sent to '+(d.to||'customer')+'!';
      } else {
        msgEl.style.color='#c62828';
        msgEl.textContent='Failed: '+(d.error||'unknown');
      }
    }
  }).catch(function(e){
    if(msgEl){msgEl.style.color='#c62828';msgEl.textContent='Network error: '+e;}
  });
}
// ── Edit order inline ──
function editOrderDetail(oid){
  var order=ORDERS.find(function(o){return o.id===oid;});
  if(!order)return;
  var el=document.getElementById('acnt');
  el.innerHTML=
    '<div style="max-width:800px;margin:0 auto">'+
    '<div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem">'+
      '<button class="bs" onclick="viewOrder(\''+oid+'\')" style="font-size:.82rem">← Back to Order</button>'+
      '<div style="font-size:1.1rem;font-weight:700;color:#2d2220">Edit Order <code style="font-size:.82rem;color:#a07810">'+oid+'</code></div>'+
    '</div>'+
    '<div class="pform">'+
    '<div class="g2">'+
      '<div><label class="fl">Customer Name</label><input class="afi" id="eo-cust" value="'+(order.cust||'')+'"></div>'+
      '<div><label class="fl">Email</label><input class="afi" id="eo-email" value="'+(order.email||'')+'"></div>'+
      '<div><label class="fl">Phone</label><input class="afi" id="eo-phone" value="'+(order.phone||'')+'"></div>'+
      '<div><label class="fl">Total ($)</label><input class="afi" id="eo-total" type="number" step="0.01" value="'+order.total.toFixed(2)+'"></div>'+
      '<div><label class="fl">Tax Amount ($)</label><input class="afi" id="eo-tax" type="number" step="0.01" min="0" value="'+(order.tax||0).toFixed(2)+'"></div>'+
      '<div><label class="fl">Transaction Fee ($)</label><input class="afi" id="eo-fee" type="number" step="0.01" min="0" value="'+(order.fee||0).toFixed(2)+'"></div>'+
    '</div>'+
    '<label class="fl">Shipping Address</label><input class="afi" id="eo-addr" value="'+(order.addr||'')+'">'+
    '<div class="g2">'+
      '<div><label class="fl">Shipping Carrier</label>'+
        '<select class="afi" id="eo-carrier">'+
        ['USPS','UPS','FedEx','Other'].map(function(cr){return'<option'+(cr===(order.carrier||'USPS')?' selected':'')+'>'+cr+'</option>';}).join('')+
        '</select></div>'+
      '<div><label class="fl">Tracking Number</label><input class="afi" id="eo-tracking" value="'+(order.tracking||'')+'" placeholder="Tracking #" style="font-family:monospace"></div>'+
      '<div><label class="fl">Status</label>'+
        '<select class="afi" id="eo-status">'+
        ['Awaiting Payment','Paid','Pending','Processing','Shipped','Delivered','Cancelled','Refunded'].map(function(s){return'<option'+(s===order.status?' selected':'')+'>'+s+'</option>';}).join('')+
        '</select></div>'+
      '<div><label class="fl">Paid By</label>'+
        '<select class="afi" id="eo-pay">'+
        ['Credit Card','Cash','Check','Square','Other'].map(function(p){return'<option'+(p===(order.pay||'Credit Card')?' selected':'')+'>'+p+'</option>';}).join('')+
        '</select></div>'+
      '<div><label class="fl">Tax Swept Date</label>'+
        '<input class="afi" id="eo-swept-date" type="date" value="'+(order.swept_date||'')+'">'+
      '</div>'+
      '<div style="display:flex;align-items:flex-end;padding-bottom:.3rem">'+
        '<button class="bs" style="font-size:.78rem" onclick="document.getElementById(\'eo-swept-date\').value=\'\'">Clear Swept Date</button>'+
      '</div>'+
    '</div>'+
    '<div class="aerr" id="eo-err" style="display:none"></div>'+
    '<div class="aok" id="eo-ok" style="display:none">\u2713 Order saved!</div>'+
    '<div style="display:flex;gap:.6rem;margin-top:.5rem">'+
      '<button class="bp" onclick="saveEditOrder(\''+oid+'\')">💾 Save Changes</button>'+
      '<button class="bs" onclick="viewOrder(\''+oid+'\')">❌ Cancel</button>'+
    '</div>'+
    '</div></div>';
}
function saveEditOrder(oid){
  var order=ORDERS.find(function(o){return o.id===oid;});
  if(!order)return;
  var cust=document.getElementById('eo-cust').value.trim();
  var email=document.getElementById('eo-email').value.trim();
  var phone=document.getElementById('eo-phone').value.trim();
  var addr=document.getElementById('eo-addr').value.trim();
  var total=parseFloat(document.getElementById('eo-total').value)||0;
  var tax=parseFloat(document.getElementById('eo-tax').value)||0;
  var fee=parseFloat(document.getElementById('eo-fee').value)||0;
  var status=document.getElementById('eo-status').value;
  var pay=document.getElementById('eo-pay').value;
  var sweptDate=document.getElementById('eo-swept-date').value;
  var carrier=document.getElementById('eo-carrier').value;
  var tracking=document.getElementById('eo-tracking').value.trim();
  var ok=document.getElementById('eo-ok');
  var err=document.getElementById('eo-err');
  ok.style.display='none';err.style.display='none';
  if(!cust){err.textContent='Customer name required.';err.style.display='block';return;}
  apiFetch('orders.php','PUT',{id:oid,status:status,pay:pay,cust:cust,email:email,phone:phone,addr:addr,total:total,tax:tax,fee:fee,swept_date:sweptDate,carrier:carrier,tracking:tracking})
  .then(function(d){
    // Update local ORDERS array
    order.cust=cust;order.email=email;order.phone=phone;order.addr=addr;
    order.total=total;order.tax=tax;order.fee=fee;order.status=status;order.pay=pay;
    order.swept_date=sweptDate;order.carrier=carrier;order.tracking=tracking;
    ok.style.display='block';
    setTimeout(function(){viewOrder(oid);},1000);
  }).catch(function(){err.textContent='Save failed.';err.style.display='block';});
}
function showRefundForm(){
  var opts=ORDERS.filter(function(o){return o.status!=='Refunded';}).slice().reverse().map(function(o){
    return '<option value="'+o.id+'">'+o.id+' — '+o.cust+' ($'+o.total.toFixed(2)+')</option>';
  }).join('');
  if(!opts){alert('No orders available to refund.');return;}
  var panel=document.createElement('div');
  panel.id='refund-panel';
  panel.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,.2);padding:1.8rem;z-index:500;width:420px;max-width:95vw';
  panel.innerHTML=
    '<div style="font-weight:700;font-size:1rem;margin-bottom:1.1rem;color:#2d2220">↩ Record Refund</div>'+
    '<div class="merr" id="ref-err" style="display:none;background:#fdecea;color:#c0392b;padding:.5rem .8rem;border-radius:6px;font-size:.82rem;margin-bottom:.7rem"></div>'+
    '<label class="fl">Select Order *</label>'+
    '<select class="afi" id="ref-order-id" onchange="updateRefundAmount()"><option value="">-- Select an order --</option>'+opts+'</select>'+
    '<label class="fl">Refund Type *</label>'+
    '<div style="display:flex;gap:.6rem;margin-bottom:.8rem">'+
      '<label style="display:flex;align-items:center;gap:.35rem;font-size:.85rem;cursor:pointer"><input type="radio" name="ref-type" value="full" checked onchange="updateRefundAmount()"> Full Refund</label>'+
      '<label style="display:flex;align-items:center;gap:.35rem;font-size:.85rem;cursor:pointer"><input type="radio" name="ref-type" value="partial" onchange="updateRefundAmount()"> Partial Refund</label>'+
    '</div>'+
    '<label class="fl">Refund Amount *</label>'+
    '<input class="afi" id="ref-amount" type="number" step="0.01" min="0.01" placeholder="0.00">'+
    '<label class="fl">Reason (optional)</label>'+
    '<input class="afi" id="ref-reason" placeholder="e.g. Customer returned item">'+
    '<div style="display:flex;gap:.6rem;margin-top:.5rem">'+
      '<button class="bp" onclick="saveRefund()">↩ Record Refund</button>'+
      '<button class="bs" onclick="document.getElementById(\'refund-panel\').remove();document.getElementById(\'refund-overlay\').remove()">Cancel</button>'+
    '</div>';
  var ov=document.createElement('div');
  ov.id='refund-overlay';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:499';
  ov.onclick=function(){panel.remove();ov.remove();};
  document.body.appendChild(ov);
  document.body.appendChild(panel);
}
function updateRefundAmount(){
  var sel=document.getElementById('ref-order-id');
  var inp=document.getElementById('ref-amount');
  var typeEl=document.querySelector('input[name="ref-type"]:checked');
  if(!sel||!inp||!typeEl)return;
  var order=ORDERS.find(function(o){return o.id===sel.value;});
  if(order&&typeEl.value==='full'){
    inp.value=order.total.toFixed(2);
    inp.readOnly=true;
    inp.style.background='#f5f5f5';
  } else {
    inp.readOnly=false;
    inp.style.background='';
    if(typeEl.value==='partial')inp.value='';
  }
}
function saveRefund(){
  var oid=document.getElementById('ref-order-id').value;
  var amt=parseFloat(document.getElementById('ref-amount').value);
  var reason=document.getElementById('ref-reason').value.trim();
  var typeEl=document.querySelector('input[name="ref-type"]:checked');
  var err=document.getElementById('ref-err');
  err.style.display='none';
  if(!oid){err.textContent='Please select an order.';err.style.display='block';return;}
  if(!amt||amt<=0){err.textContent='Please enter a valid refund amount.';err.style.display='block';return;}
  var order=ORDERS.find(function(o){return o.id===oid;});
  if(order&&amt>order.total){err.textContent='Refund cannot exceed order total ($'+order.total.toFixed(2)+').';err.style.display='block';return;}
  var refType=typeEl?typeEl.value:'full';
  var now=new Date();
  var refDate=now.toLocaleDateString('en-US');
  var refDateISO=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0')+' '+String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')+':00';
  var refId=oid+'-REF';
  apiFetch('orders.php','POST',{
    id:refId,
    cust:order?order.cust:'',
    email:order?order.email||'':'',
    phone:'',
    addr:order?order.addr||'':'',
    total:-amt,
    tax:0,
    pay:'Refund',
    status:'Refunded',
    date:refDateISO
  }).then(function(d){
    ORDERS.push({id:refId,cust:order?order.cust:'',total:-amt,tax:0,pay:'Refund',status:'Refunded',date:refDate,dispDate:refDate,time:now.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true}),items:[]});
    document.getElementById('refund-panel').remove();
    document.getElementById('refund-overlay').remove();
    var toast=document.createElement('div');
    toast.textContent='✓ Refund recorded: $'+amt.toFixed(2)+' for '+oid;
    toast.style.cssText='position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);background:#2e7d32;color:#fff;padding:.65rem 1.4rem;border-radius:24px;font-size:.85rem;font-family:sans-serif;font-weight:600;z-index:9999';
    document.body.appendChild(toast);
    setTimeout(function(){toast.remove();},3000);
    renderOrdersTable(document.getElementById('acnt'));
  }).catch(function(){err.textContent='Failed to save refund.';err.style.display='block';});
}
var MANUAL_PAY_TYPE='';
function setManualPayType(type){
  MANUAL_PAY_TYPE=type;
  var btns={Cash:'mo-btn-cash',Check:'mo-btn-check','Credit Card':'mo-btn-cc'};
  Object.keys(btns).forEach(function(t){
    var btn=document.getElementById(btns[t]);
    if(!btn)return;
    if(t===type){
      btn.className='bp';btn.style.flex='1';
    } else {
      btn.className='bs';btn.style.flex='1';
    }
  });
  // Set the Paid By dropdown and Order Type to match
  var pay=document.getElementById('mo-pay');
  if(pay){pay.value=type;moUpdateFee();}
  var typeMap={Cash:'In Person',Check:'Phone','Credit Card':'Phone'};
  var otype=document.getElementById('mo-type');
  if(otype&&typeMap[type])otype.value=typeMap[type];
  // Cash: zero out shipping and fee, set tax placeholder
  if(type==='Cash'){
    var ship=document.getElementById('mo-shipping');
    var fee=document.getElementById('mo-fee');
    var taxEl=document.getElementById('mo-tax');
    var taxLbl=document.getElementById('mo-tax-lbl');
    if(ship)ship.value='0.00';
    if(fee)fee.value='0.00';
    if(taxEl){taxEl.value='0.00';taxEl.readOnly=true;taxEl.style.background='#f5f0e8';taxEl.placeholder='Looks up by city';}
    if(taxLbl)taxLbl.textContent='Sales Tax (auto from city)';
    moRecalc();
  } else {
    var taxEl2=document.getElementById('mo-tax');
    var taxLbl2=document.getElementById('mo-tax-lbl');
    if(taxEl2){taxEl2.readOnly=false;taxEl2.style.background='';taxEl2.placeholder='0.00';}
    if(taxLbl2)taxLbl2.textContent='Sales Tax ($)';
    moUpdateFee();
  }
}

var _moTaxTimer=null;
var _moTaxRate=null;
var _moFormReady=false;

function moHighlightTotal(pay){
  if(!_moFormReady)return;
  var rowCash=document.getElementById('mo-row-cashcheck');
  var rowCC=document.getElementById('mo-row-cc');
  if(!rowCash||!rowCC)return;
  var isCash=pay==='Cash'||pay==='Check';
  var isCC=pay==='Credit Card'||pay==='Square';
  // Highlight active row, reset inactive row
  rowCash.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:.3rem;border-radius:6px;padding:.4rem .7rem;transition:all .2s;'+
    (isCash?'background:#fff3cd;border:1.5px solid #d4a017;':'border:1.5px solid transparent;');
  rowCC.style.cssText='display:flex;justify-content:space-between;align-items:center;border-radius:6px;padding:.4rem .7rem;transition:all .2s;'+
    (isCC?'background:#fff3cd;border:1.5px solid #d4a017;':'border:1.5px solid transparent;');
  // Color the amounts
  var amtCash=document.getElementById('mo-total-cashcheck');
  var amtCC=document.getElementById('mo-total-cc');
  if(amtCash)amtCash.style.color=isCash?'#a07810':'#6b6040';
  if(amtCC)amtCC.style.color=isCC?'#a07810':'#6b6040';
}

function moFmtPhone(input){
  var v=input.value.replace(/\D/g,'').substring(0,10);
  if(v.length>=7) v='('+v.substring(0,3)+') '+v.substring(3,6)+'-'+v.substring(6);
  else if(v.length>=4) v='('+v.substring(0,3)+') '+v.substring(3);
  else if(v.length>0) v='('+v;
  input.value=v;
}

var _moSavedOrderId=null;

function moSendConfirm(){
  if(!_moSavedOrderId){alert('Save the order first.');return;}
  var msg=document.getElementById('mo-confirm-msg');
  var email=document.getElementById('mo-email').value.trim();
  if(!email){if(msg){msg.style.color='#c62828';msg.textContent='No email address on this order.';}return;}
  if(msg){msg.style.color='#6b6040';msg.textContent='Sending…';}
  fetch('https://handmadedesignsbysuzi.com/send_confirm.php',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({order_id:_moSavedOrderId})
  }).then(function(r){return r.json();})
  .then(function(d){
    if(msg){
      if(d.success){msg.style.color='#2e7d32';msg.textContent='✓ Confirmation sent to '+email;}
      else{msg.style.color='#c62828';msg.textContent='Error: '+(d.error||'Unknown');}
    }
  }).catch(function(e){if(msg){msg.style.color='#c62828';msg.textContent='Network error: '+e.message;}});
}

function moToggleShipping(checked){
  var wrap=document.getElementById('mo-shipping-wrap');
  if(!wrap)return;
  if(checked){
    wrap.style.display='';
    moCalcShipping(); // calculate shipping based on state/zone
    moUpdateFee();    // recalculate transaction fee
  } else {
    wrap.style.display='none';
    var ship=document.getElementById('mo-shipping');
    if(ship)ship.value='0.00';
    moUpdateFee();    // recalculate transaction fee with $0 shipping
    moRecalc();
  }
}

function moSetPay(type){
  var pay=document.getElementById('mo-pay');
  if(pay){pay.value=type;moUpdateFee();}
  var typeMap={Cash:'In Person',Check:'Phone','Credit Card':'Phone'};
  var otype=document.getElementById('mo-type');
  if(otype&&typeMap[type])otype.value=typeMap[type];
  // Cash: zero shipping and fee
  if(type==='Cash'){
    var ship=document.getElementById('mo-shipping');
    var fee=document.getElementById('mo-fee');
    if(ship)ship.value='0.00';
    if(fee)fee.value='0.00';
  }
  moLookupCityTax(document.getElementById('mo-city').value);
  moRecalc();
}

function moRecalcTax(){
  if(_moTaxRate===null)return;
  var subtotal=parseFloat(document.getElementById('mo-subtotal').value)||0;
  var tax=Math.round(subtotal*_moTaxRate*100)/100;
  var taxEl=document.getElementById('mo-tax');
  if(taxEl)taxEl.value=tax.toFixed(2);
  moRecalc();
}

function moLookupCityTax(cityVal){
  // Lookup city tax whenever city is provided
  if(_moTaxTimer)clearTimeout(_moTaxTimer);
  _moTaxTimer=setTimeout(function(){
    var city=cityVal?cityVal.trim():'';
    if(!city||city.length<2)return;
    var taxLbl=document.getElementById('mo-tax-lbl');
    if(taxLbl)taxLbl.textContent='Sales Tax (looking up '+city+'…)';
    apiFetch('tn_city_tax.php?search='+encodeURIComponent(city)).then(function(d){
      if(!d.success||!d.cities||!d.cities.length){
        if(taxLbl)taxLbl.textContent='Sales Tax (city not found: '+city+')';
        return;
      }
      // Find exact or closest match
      var match=null;
      for(var i=0;i<d.cities.length;i++){
        if(d.cities[i].city.toLowerCase()===city.toLowerCase()){match=d.cities[i];break;}
      }
      if(!match)match=d.cities[0];
      var subtotal=parseFloat(document.getElementById('mo-subtotal').value)||0;
      _moTaxRate=parseFloat(match.tax_rate);
      if(taxLbl)taxLbl.textContent='Sales Tax ('+match.city+' '+match.county+' '+(_moTaxRate*100).toFixed(2)+'%)';
      setTimeout(function(){moRecalc();},50);
    }).catch(function(){if(taxLbl)taxLbl.textContent='Sales Tax (lookup failed)';});
  }, 600);
}

function showManualOrderForm(){
  if(typeof _dbgLog==='function')_dbgLog('SCREEN','Manual Order Form opened');
  var el=document.getElementById('acnt');
  var popts='<option value="">— Select a product —</option>';
  for(var i=0;i<PRODS.length;i++)popts+='<option value="'+PRODS[i].id+'">'+PRODS[i].name+(PRODS[i].sku?' ['+PRODS[i].sku+']':'')+' — $'+PRODS[i].price.toFixed(2)+'</option>';
  el.innerHTML=
    '<div class="pform" id="mof">'+
    '<div style="font-weight:700;font-size:1rem;margin-bottom:.5rem">📋 Create Manual Order</div>'+
    '<div class="warn" style="margin-bottom:.9rem">This saves a real order directly to the database — use for phone/in-person/cash sales.</div>'+
    '<div class="g2">'+
      '<div><label class="fl">First Name *</label><input class="afi" id="mo-fn" placeholder="Jane"></div>'+
      '<div><label class="fl">Last Name *</label><input class="afi" id="mo-ln" placeholder="Smith"></div>'+
      '<div><label class="fl">Email *</label><input class="afi" id="mo-email" placeholder="customer@email.com"></div>'+
      '<div><label class="fl">Phone</label><input class="afi" id="mo-ph" placeholder="(555) 000-0000" oninput="moFmtPhone(this)"></div>'+
    '</div>'+
    '<label class="fl">Shipping Address</label>'+
    '<input class="afi" id="mo-addr" placeholder="123 Main St" oninput="moCalcShipping()">'+
    '<label class="fl">City *</label>'+
    '<input class="afi" id="mo-city" value="Knoxville" oninput="moLookupCityTax(this.value)">'+
    '<div class="g2">'+
      '<div><label class="fl">State (for shipping zone)</label>'+
        '<input class="afi" id="mo-state" value="TN" maxlength="2" style="text-transform:uppercase" oninput="this.value=this.value.toUpperCase();moCalcShipping()">'+
      '</div>'+
      '<div style="display:flex;align-items:flex-end;padding-bottom:.25rem">'+
        '<span id="mo-zone-info" style="font-size:.78rem;color:#6b6040"></span>'+
      '</div>'+
    '</div>'+
    '<div style="font-weight:700;font-size:.88rem;margin:.7rem 0 .4rem;color:#2d2220">Order Items</div>'+
    '<div id="mo-items-list"></div>'+
    '<button class="bs" style="font-size:.8rem;margin-bottom:.8rem" onclick="moAddItem()">+ Add Item</button>'+
    '<div class="g2">'+
      '<div><label class="fl">Order Type</label><select class="afi" id="mo-type">'+
        ['In Person','Online','Phone'].map(function(t){return'<option'+(t==='In Person'?' selected':'')+'>'+t+'</option>';}).join('')+
      '</select></div>'+
      '<div style="display:flex;align-items:center;gap:.5rem;padding-top:1.6rem">'+
        '<input type="checkbox" id="mo-ship-req" onchange="moToggleShipping(this.checked)">'+
        '<label for="mo-ship-req" style="font-size:.84rem;color:#2d2220;cursor:pointer">Shipping Required</label>'+
      '</div>'+
    '</div>'+
    '<div class="g2" style="margin-bottom:.5rem">'+
      '<div><label class="fl">Paid By</label><select class="afi" id="mo-pay" onchange="moUpdateFee();moRecalc();var _ot=document.getElementById(\'mo-type\');if(_ot){var _pm={Cash:\'In Person\',Check:\'Phone\',\'Credit Card\':\'Phone\'};if(_pm[this.value])_ot.value=_pm[this.value];}">'+
        ['Credit Card','Cash','Check','Other'].map(function(p){return'<option'+(p==='Other'?' selected':'')+'>'+p+'</option>';}).join('')+
      '</select></div>'+
    '</div>'+
    '<div style="background:#fffdf0;border:1px solid #e8e0b8;border-radius:8px;padding:.9rem;margin-bottom:.8rem">'+
      '<div style="font-size:.75rem;font-weight:700;text-transform:uppercase;color:#a07810;margin-bottom:.7rem">Order Totals</div>'+
      '<div class="g2">'+
        '<div><label class="fl">Subtotal ($)</label><input class="afi" id="mo-subtotal" type="number" step="0.01" min="0" value="0.00" oninput="moRecalc();(_moTaxRate!==null?moRecalcTax():moLookupCityTax(document.getElementById(\'mo-city\').value))"></div>'+
        '<div id="mo-shipping-wrap" style="display:none"><label class="fl">Shipping ($)</label><input class="afi" id="mo-shipping" type="number" step="0.01" min="0" value="0.00" oninput="moRecalc()"></div>'+
        '<div><label class="fl" id="mo-tax-lbl">Sales Tax ($)</label><input class="afi" id="mo-tax" type="number" step="0.01" min="0" value="0.00" oninput="moRecalc()"></div>'+
        '<div><label class="fl">Transaction Fee ($)</label><input class="afi" id="mo-fee" type="number" step="0.01" min="0" value="0.00" oninput="moRecalc()"></div>'+
      '</div>'+
      '<div style="margin-top:.8rem;padding-top:.7rem;border-top:1px solid #e8e0b8">'+
        '<div id="mo-row-cashcheck" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.3rem;border-radius:6px;padding:.3rem .5rem;transition:background .2s">'+
          '<span style="font-size:.85rem;color:#6b6040">Cash/Check Total (Subtotal + Shipping + Sales Tax)</span>'+
          '<span id="mo-total-cashcheck" style="font-size:1rem;font-weight:700;color:#6b6040">$0.00</span>'+
        '</div>'+
        '<div id="mo-row-cc" style="display:flex;justify-content:space-between;align-items:center;border-radius:6px;padding:.3rem .5rem;transition:background .2s">'+
          '<span style="font-size:.85rem;color:#6b6040">Credit Card Total (Subtotal + Shipping + Sales Tax + Transaction Fee)</span>'+
          '<span id="mo-total-cc" style="font-size:1rem;font-weight:700;color:#6b6040">$0.00</span>'+
        '</div>'+
        '<input type="hidden" id="mo-total" value="0.00">'+
      '</div>'+
    '</div>'+
    '<div style="display:flex;gap:.6rem;justify-content:flex-end;margin-top:.5rem;flex-wrap:wrap">'+
      '<button class="bs" onclick="rOrders(document.getElementById(\'acnt\'))">Cancel</button>'+
      '<button class="bp" onclick="saveManualOrder()">💾 Save Order</button>'+
    '</div>'+
    '</div>';
  // Add first item row automatically
  MO_ITEMS=[];
  _moFormReady=false;
  moAddItem();
  // Explicitly reset highlight rows on open
  setTimeout(function(){
    var rc=document.getElementById('mo-row-cashcheck');
    var rcc=document.getElementById('mo-row-cc');
    if(rc)rc.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:.3rem;border-radius:6px;padding:.4rem .7rem;border:1.5px solid transparent';
    if(rcc)rcc.style.cssText='display:flex;justify-content:space-between;align-items:center;border-radius:6px;padding:.4rem .7rem;border:1.5px solid transparent';
  },200);
  // Clear any highlights explicitly
  setTimeout(function(){
    var fn=document.getElementById('mo-fn');if(fn)fn.focus();
    moLookupCityTax('Knoxville');
  },100);
  // Only enable highlighting after all init recalcs have fired
  setTimeout(function(){_moFormReady=true;},1500);
}
var ORDER_FILTER='';
var ORDER_DATE_FROM='';
var ORDER_DATE_TO='';
var MO_ITEMS=[];
var MO_PRODS_OPTS='';
function moAddItem(){
  if(!MO_PRODS_OPTS){
    var o='<option value="">— Select product —</option>';
    for(var i=0;i<PRODS.length;i++)o+='<option value="'+PRODS[i].id+'">'+PRODS[i].name+(PRODS[i].sku?' ['+PRODS[i].sku+']':'')+' — $'+PRODS[i].price.toFixed(2)+'</option>';
    MO_PRODS_OPTS=o;
  }
  var idx=MO_ITEMS.length;
  MO_ITEMS.push({pid:'',qty:1,price:0});
  var list=document.getElementById('mo-items-list');
  var row=document.createElement('div');
  row.id='mo-item-'+idx;
  row.style.cssText='display:flex;gap:.4rem;align-items:center;margin-bottom:.4rem';
  row.innerHTML=
    '<select class="afi" style="flex:2;margin:0" onchange="moItemProd('+idx+',this.value)">'+MO_PRODS_OPTS+'</select>'+
    '<input class="afi" id="mo-qty-'+idx+'" type="number" min="1" value="1" style="width:56px;margin:0" oninput="moItemQty('+idx+',this.value)">'+
    '<input class="afi" id="mo-price-'+idx+'" type="number" step="0.01" min="0" value="" placeholder="Unit $" style="width:80px;margin:0" oninput="moItemQty('+idx+',document.getElementById(\'mo-qty-'+idx+'\').value)">'+
    '<span id="mo-line-'+idx+'" style="min-width:52px;text-align:right;font-size:.82rem;color:#a07810;font-weight:600">$0.00</span>'+
    '<button class="bd" style="padding:.35rem .6rem;font-size:.75rem;flex-shrink:0" onclick="moRemoveItem('+idx+')">✕</button>';
  list.appendChild(row);
}
function moItemProd(idx,pid){
  var p=findProd(pid);
  MO_ITEMS[idx]={pid:pid,qty:parseInt(document.getElementById('mo-qty-'+idx).value)||1,price:p?p.price:0};
  var priceEl=document.getElementById('mo-price-'+idx);
  if(priceEl&&p)priceEl.value=p.price.toFixed(2);
  var lineEl=document.getElementById('mo-line-'+idx);
  if(lineEl&&p)lineEl.textContent='$'+((MO_ITEMS[idx].qty||1)*p.price).toFixed(2);
  moUpdateTotal();
}
function moItemQty(idx,val){
  if(MO_ITEMS[idx])MO_ITEMS[idx].qty=parseInt(val)||1;
  // Update line total display
  var priceEl=document.getElementById('mo-price-'+idx);
  var lineEl=document.getElementById('mo-line-'+idx);
  if(lineEl&&priceEl){
    var qty=parseInt(val)||1;
    var price=parseFloat(priceEl.value)||0;
    lineEl.textContent='$'+(qty*price).toFixed(2);
  }
  moUpdateTotal();
}
function moRemoveItem(idx){
  var row=document.getElementById('mo-item-'+idx);
  if(row)row.remove();
  MO_ITEMS[idx]=null;
  moUpdateTotal();
}
function moItemSubtotal(){
  var tot=0;
  for(var i=0;i<MO_ITEMS.length;i++){
    if(!MO_ITEMS[i])continue;
    var priceEl=document.getElementById('mo-price-'+i);
    var unitPrice=priceEl&&priceEl.value?parseFloat(priceEl.value)||0:(MO_ITEMS[i].price||0);
    tot+=unitPrice*(MO_ITEMS[i].qty||1);
  }
  return tot;
}
function moRecalc(){
  // Use live item subtotal if items exist
  var sub=MO_ITEMS&&MO_ITEMS.length>0?moItemSubtotal():(parseFloat(document.getElementById('mo-subtotal').value)||0);
  var subEl=document.getElementById('mo-subtotal');if(subEl)subEl.value=sub.toFixed(2);
  var shipReq=document.getElementById('mo-ship-req');
  var ship=(!shipReq||!shipReq.checked)?0:(parseFloat(document.getElementById('mo-shipping').value)||0);
  // Auto-recalc tax from stored rate if available
  if(_moTaxRate!==null){var taxEl=document.getElementById('mo-tax');if(taxEl)taxEl.value=(Math.round(sub*_moTaxRate*100)/100).toFixed(2);}
  var tax=parseFloat(document.getElementById('mo-tax').value)||0;
  var fee=parseFloat(document.getElementById('mo-fee').value)||0;
  var total=sub+ship+tax+fee;
  // Cash/Check total = subtotal + shipping + tax (no fee)
  var cashTotal=sub+ship+tax;
  // Credit Card total = subtotal + shipping + tax + fee
  var ccTotal=sub+ship+tax+fee;
  // Only update the active total row based on payment method
  var payEl=document.getElementById('mo-pay');
  var payVal=payEl?payEl.value:'';
  var isCash=payVal==='Cash'||payVal==='Check';
  var isCC=payVal==='Credit Card'||payVal==='Square';
  var hid=document.getElementById('mo-total');
  var ccEl=document.getElementById('mo-total-cc');
  var cashEl=document.getElementById('mo-total-cashcheck');
  if(isCash){
    if(hid)hid.value=cashTotal.toFixed(2);
    if(cashEl)cashEl.textContent='$'+cashTotal.toFixed(2);
  } else if(isCC){
    if(hid)hid.value=ccTotal.toFixed(2);
    if(ccEl)ccEl.textContent='$'+ccTotal.toFixed(2);
  } else {
    // Other — don't update either total
  }
  moHighlightTotal(payVal);
}
function moUpdateTotal(){
  var sub=moItemSubtotal();
  var el=document.getElementById('mo-subtotal');
  if(el)el.value=sub.toFixed(2);
  // Recalc shipping and fees based on new subtotal
  moCalcShipping();
  moRecalc();
}
function moCalcTotal(){
  // 1. Subtotal from items
  var sub=moItemSubtotal();
  var subEl=document.getElementById('mo-subtotal');
  if(subEl)subEl.value=sub.toFixed(2);
  // Recalc city tax if rate already looked up
  if(_moTaxRate!==null){
    var tax=Math.round(sub*_moTaxRate*100)/100;
    var taxEl=document.getElementById('mo-tax');
    if(taxEl)taxEl.value=tax.toFixed(2);
  }

  // 2. Extract state — from state field or address
  var stEl=document.getElementById('mo-state');
  var st=stEl?stEl.value.trim().toUpperCase():'';
  if(!st){
    var addrEl=document.getElementById('mo-addr');
    if(addrEl){
      // Match "TN 37918" or ", TN" patterns
      var m=addrEl.value.match(/[,\s]+([A-Z]{2})\s+\d{5}/)||addrEl.value.match(/[,\s]+([A-Z]{2})\s*$/i);
      if(m){st=m[1].toUpperCase();if(stEl)stEl.value=st;}
    }
  }

  // 3. Shipping from zone
  var ship=0;
  if(st){
    ship=calcShipping(sub,st);
    var shipEl=document.getElementById('mo-shipping');
    if(shipEl)shipEl.value=ship.toFixed(2);
    var zone=getZone(st);
    var zoneNames=['','Tennessee','South','East Coast','Midwest','West'];
    var zInfo=document.getElementById('mo-zone-info');
    if(zInfo)zInfo.textContent='Zone '+zone+': '+(zoneNames[zone]||'?')+(sub>=FREE_THRESHOLD?' — Free shipping':'');
  }

  // 4. Sales tax from state + city
  var addrEl2=document.getElementById('mo-addr');
  var addrVal=addrEl2?addrEl2.value:'';
  // Extract city — look for "City, State" or first word after comma
  var city='';
  var cityM=addrVal.match(/,\s*([A-Za-z\s]+?)\s*,?\s*[A-Z]{2}/);
  if(cityM)city=cityM[1].trim();
  var taxRate=getStateTaxRate(st,city);
  var taxAmt=Math.round(sub*taxRate)/100;
  var taxEl=document.getElementById('mo-tax');
  if(taxEl)taxEl.value=taxAmt.toFixed(2);

  // 5. Transaction fee for Square
  var pay=document.getElementById('mo-pay');
  var fee=0;
  if(pay&&pay.value==='Square'){
    fee=Math.round((sub+ship+taxAmt)*(SQ_FEE_PCT/100)*100+SQ_FEE_CENTS*100)/100;
    var feeEl=document.getElementById('mo-fee');
    if(feeEl)feeEl.value=fee.toFixed(2);
  }

  // 6. Update total
  moRecalc();
}
function moUpdateFee(){
  var pay=document.getElementById('mo-pay');
  var payVal=pay?pay.value:'';
  var feeEl=document.getElementById('mo-fee');
  if(payVal==='Credit Card'||payVal==='Square'){
    // Calculate Square transaction fee: (subtotal+shipping+tax)*pct% + per-transaction cost
    var sub=MO_ITEMS&&MO_ITEMS.length>0?moItemSubtotal():(parseFloat(document.getElementById('mo-subtotal').value)||0);
    var ship=parseFloat(document.getElementById('mo-shipping').value)||0;
    var tax=parseFloat(document.getElementById('mo-tax').value)||0;
    var fee=Math.round((sub+ship+tax)*(SQ_FEE_PCT/100)*100+SQ_FEE_CENTS*100)/100;
    if(feeEl)feeEl.value=fee.toFixed(2);
  } else {
    if(feeEl)feeEl.value='0.00';
  }
  moRecalc();
}
function moCalcShipping(){
  // Parse state from mo-state field, or extract from address
  var stEl=document.getElementById('mo-state');
  var addrEl=document.getElementById('mo-addr');
  var st=stEl?stEl.value.trim():'';
  if(!st&&addrEl){
    // Try to extract state abbreviation from address (e.g. 'Knoxville TN 37918')
    var m=addrEl.value.match(/\b([A-Z]{2})\s+\d{5}\b/);
    if(m)st=m[1];
    if(stEl&&st)stEl.value=st;
  }
  var sub=parseFloat(document.getElementById('mo-subtotal').value)||0;
  if(!st)return; // no state yet
  var ship=calcShipping(sub,st);
  var shipEl=document.getElementById('mo-shipping');
  if(shipEl){shipEl.value=ship.toFixed(2);}
  // Auto-estimate fee if Square
  var pay=document.getElementById('mo-pay');
  if(pay&&pay.value==='Square'){
    var tax=parseFloat(document.getElementById('mo-tax').value)||0;
    var estFee=Math.round((sub+ship+tax)*(SQ_FEE_PCT/100)*100+SQ_FEE_CENTS*100)/100;
    var feeEl=document.getElementById('mo-fee');
    if(feeEl)feeEl.value=estFee.toFixed(2);
  }
  moRecalc();
  // Show zone info
  var zone=getZone(st);
  var zoneNames=['','Tennessee','South','East Coast','Midwest','West'];
  var zInfo=document.getElementById('mo-zone-info');
  if(zInfo)zInfo.textContent='Zone '+zone+': '+(zoneNames[zone]||'?')+(sub>=FREE_THRESHOLD?' — Free shipping':'');
}
function printOrdersPdf(){
  var filt=applyOrdFilters();
  if(!filt.length){alert('No orders to print.');return;}
  var cols=['Order ID','Customer','Date','Subtotal','Shipping','Tax','Trans Fee','Total','Paid By','Order Type','Status'];
  var rows=filt.map(function(o){
    return '<tr>'+
      '<td>'+o.id+'</td>'+
      '<td>'+(o.cust||'')+'</td>'+
      '<td>'+(o.dispDate||o.date||'')+'</td>'+
      '<td>$'+(o.subtotal||0).toFixed(2)+'</td>'+
      '<td>$'+(o.shipping||0).toFixed(2)+'</td>'+
      '<td>$'+(o.tax||0).toFixed(2)+'</td>'+
      '<td>$'+(o.fee||0).toFixed(2)+'</td>'+
      '<td><strong>$'+o.total.toFixed(2)+'</strong></td>'+
      '<td>'+(o.pay||'')+'</td>'+
      '<td>'+(o.order_type||'')+'</td>'+
      '<td>'+(o.status||'')+'</td>'+
    '</tr>';
  }).join('');
  var totals={
    sub:filt.reduce(function(s,o){return s+(o.subtotal||0);},0),
    ship:filt.reduce(function(s,o){return s+(o.shipping||0);},0),
    tax:filt.reduce(function(s,o){return s+(o.tax||0);},0),
    fee:filt.reduce(function(s,o){return s+(o.fee||0);},0),
    total:filt.reduce(function(s,o){return s+o.total;},0)
  };
  var html='<!DOCTYPE html><html><head><meta charset="UTF-8">'+
    '<title>Orders — Handmade Designs By Suzi</title>'+
    '<style>'+
      'body{font-family:Arial,sans-serif;font-size:11px;margin:20px;color:#2d2220}'+
      'h2{color:#a07810;margin-bottom:4px}'+
      '.sub{color:#6b6040;font-size:10px;margin-bottom:14px}'+
      'table{width:100%;border-collapse:collapse}'+
      'th{background:#a07810;color:#fff;padding:5px 7px;text-align:left;font-size:10px}'+
      'td{padding:4px 7px;border-bottom:1px solid #e8e0b8;vertical-align:top}'+
      'tr:nth-child(even) td{background:#fffdf0}'+
      '.totals td{font-weight:700;background:#f5f0e8;border-top:2px solid #a07810}'+
      '@media print{@page{margin:1.5cm}button{display:none}}'+
    '</style></head><body>'+
    '<h2>Handmade Designs By Suzi — Orders</h2>'+
    '<div class="sub">Printed: '+new Date().toLocaleString()+' · '+filt.length+' orders</div>'+
    '<table><thead><tr>'+cols.map(function(c){return'<th>'+c+'</th>';}).join('')+'</tr></thead><tbody>'+
    rows+
    '<tr class="totals"><td colspan="3">Totals ('+filt.length+' orders)</td>'+
    '<td>$'+totals.sub.toFixed(2)+'</td>'+
    '<td>$'+totals.ship.toFixed(2)+'</td>'+
    '<td>$'+totals.tax.toFixed(2)+'</td>'+
    '<td>$'+totals.fee.toFixed(2)+'</td>'+
    '<td>$'+totals.total.toFixed(2)+'</td>'+
    '<td colspan="3"></td></tr>'+
    '</tbody></table></body></html>';
  var w=window.open('','_blank');
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(function(){w.focus();w.print();w.close();},400);
}

function exportOrdersCsv(){
  var filt=applyOrdFilters();
  if(!filt.length){alert('No orders to export.');return;}
  var cols=['Order ID','Customer','Email','Phone','Date','Time','Subtotal','Shipping','Tax','Trans Fee','Total','Paid By','Order Type','Status','Tax Swept Date','Address'];
  var rows=[cols.join(',')];
  filt.forEach(function(o){
    var row=[
      '"'+o.id+'"',
      '"'+(o.cust||'').replace(/"/g,'""')+'"',
      '"'+(o.email||'').replace(/"/g,'""')+'"',
      '"'+(o.phone||'').replace(/"/g,'""')+'"',
      '"'+(o.dispDate||o.date||'')+'"',
      '"'+(o.time||'')+'"',
      (o.subtotal||0).toFixed(2),
      (o.shipping||0).toFixed(2),
      (o.tax||0).toFixed(2),
      (o.fee||0).toFixed(2),
      o.total.toFixed(2),
      '"'+(o.pay||'').replace(/"/g,'""')+'"',
      '"'+(o.order_type||'').replace(/"/g,'""')+'"',
      '"'+(o.status||'').replace(/"/g,'""')+'"',
      '"'+(o.swept_date||'').replace(/"/g,'""')+'"',
      '"'+(o.addr||'').replace(/"/g,'""')+'"'
    ];
    rows.push(row.join(','));
  });
  var csv=rows.join('\n');
  var blob=new Blob([csv],{type:'text/csv'});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='orders_'+new Date().toISOString().slice(0,10)+'.csv';
  a.click();
}

function updateTransFees(){
  var btn=document.getElementById('upd-fee-btn');
  if(btn){btn.disabled=true;btn.textContent='Updating…';}
  fetch(API+'/square_payments.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'backfill_fees'})})
  .then(function(r){return r.json();})
  .then(function(d){
    if(btn){btn.disabled=false;btn.textContent='💳 Update Trans Fees';}
    if(d.success){
      console.log('Trans Fee Backfill:',d);
      var msg='✓ Updated '+(d.updated||0)+' of '+(d.total||0)+' orders.';
      if(d.unmatched&&d.unmatched.length){
        msg+='\n\nCould not match '+d.unmatched.length+' order(s) in Square:\n'+d.unmatched.join('\n');
      }
      alert(msg);
      rOrders(document.getElementById('acnt'));
    } else {
      alert('Error: '+(d.error||'Unknown'));
    }
  }).catch(function(e){
    if(btn){btn.disabled=false;btn.textContent='💳 Update Trans Fees';}
    alert('Network error: '+e.message);
  });
}

function saveManualOrder(){
  var fn=document.getElementById('mo-fn').value.trim();
  var ln=document.getElementById('mo-ln').value.trim();
  var email=document.getElementById('mo-email').value.trim();
  if(!email||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){alert('Please enter a valid email address.');return;}
  var city=document.getElementById('mo-city').value.trim();
  if(!city){alert('Please enter a city.');return;}
  var ph=document.getElementById('mo-ph').value.trim();
  var addr=document.getElementById('mo-addr').value.trim();
  var city=document.getElementById('mo-city')?document.getElementById('mo-city').value.trim():city||'';
  if(city&&addr&&addr.indexOf(city)<0)addr=addr+(addr?', ':'')+city;
  var pay=document.getElementById('mo-pay').value;
  var otype=document.getElementById('mo-type')?document.getElementById('mo-type').value:'Phone';
  var status='Paid';
  if(!fn||!ln){alert('Please enter the customer name.');return;}
  var items=[];
  for(var i=0;i<MO_ITEMS.length;i++){
    if(!MO_ITEMS[i]||!MO_ITEMS[i].pid)continue;
    var priceEl=document.getElementById('mo-price-'+i);
    var p=findProd(MO_ITEMS[i].pid);
    items.push({id:MO_ITEMS[i].pid,name:p?p.name:'',price:priceEl?parseFloat(priceEl.value)||0:MO_ITEMS[i].price,q:MO_ITEMS[i].qty||1});
  }
  if(!items.length){alert('Please add at least one product.');return;}
  var totalEl=document.getElementById('mo-total');
  var total=totalEl?parseFloat(totalEl.value)||0:items.reduce(function(s,it){return s+it.price*it.q;},0);
  if(!total||total<=0){alert('Please enter or calculate the order total.');return;}
  var moTax=parseFloat(document.getElementById('mo-tax').value)||0;
  var moShip=parseFloat(document.getElementById('mo-shipping').value)||0;
  // Add shipping as _ship item so order detail shows it correctly
  if(moShip>0)items.push({id:'_ship',name:'Shipping',price:moShip,q:1});
  var oid='MAN-'+Date.now().toString(36).toUpperCase();
  apiFetch('orders.php','POST',{
    id:oid,
    cust:fn+' '+ln,
    email:email,
    phone:ph,
    addr:addr,
    items:items,
    total:total,
    tax:moTax,
    shipping:moShip,
    pay:pay,
    order_type:otype,
    fee:parseFloat(document.getElementById('mo-fee').value)||0,
    status:status
  }).then(function(d){
    if(d.success||d.message){
      var toast=document.createElement('div');
      toast.textContent='\u2713 Order '+oid+' saved!';
      toast.style.cssText='position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);background:#2e7d32;color:#fff;padding:.65rem 1.4rem;border-radius:24px;font-size:.85rem;font-family:sans-serif;font-weight:600;z-index:9999';
      document.body.appendChild(toast);
      _moSavedOrderId=oid;
      var btn=document.getElementById('mo-send-confirm-btn');
      if(btn)btn.style.display='';
      var el2=document.getElementById('acnt');
      if(el2)el2.innerHTML='<div style="text-align:center;padding:3rem 1rem">'+
        '<div style="font-size:2rem;margin-bottom:.5rem">✅</div>'+
        '<div style="font-size:1.1rem;font-weight:700;color:#2e7d32;margin-bottom:.3rem">Order Saved</div>'+
        '<div style="font-size:.85rem;color:#6b6040;margin-bottom:1.2rem">Order <code>'+oid+'</code> has been saved successfully.</div>'+
        '<button class="bp" onclick="showManualOrderForm()">+ New Order</button>'+
        '&nbsp;<button class="bs" onclick="rOrders(document.getElementById(\'acnt\'))">View Orders</button>'+
      '</div>';
      setTimeout(function(){toast.remove();},3000);
    }
  }).catch(function(){alert('Failed to save order.');});
}
function showTestOrderForm(){
  var el=document.getElementById('acnt');
  // Build product options
  var popts='<option value="">— Select a product —</option>';
  for(var i=0;i<PRODS.length;i++)popts+='<option value="'+PRODS[i].id+'">'+PRODS[i].name+' — $'+PRODS[i].price.toFixed(2)+'</option>';
  el.innerHTML=
    '<div class="pform" id="tof">'+
    '<div style="font-weight:700;font-size:1rem;margin-bottom:.9rem">🧪 Add Test Order</div>'+
    '<div class="warn">This order is saved directly — no payment is required. Use it to test your order flow.</div>'+
    '<div class="g2">'+
    '<div><label class="fl">Customer Name *</label><input class="afi" id="to-name" value="Test Customer"></div>'+
    '<div><label class="fl">Email *</label><input class="afi" id="to-email" value="test@example.com"></div>'+
    '<div><label class="fl">Phone</label><input class="afi" id="to-ph" value="(555) 000-0000"></div>'+
    '<div><label class="fl">Status</label><select class="afi" id="to-status">'+
    ['Awaiting Payment','Paid','Pending','Processing','Shipped','Delivered','Cancelled'].map(function(s){return'<option'+(s==='Pending'?' selected':'')+'>'+s+'</option>';}).join('')+
    '</select></div>'+
    '</div>'+
    '<label class="fl">Shipping Address</label><input class="afi" id="to-addr" value="123 Test Street, Nashville TN 37201">'+
    '<label class="fl">Product</label><select class="afi" id="to-prod" onchange="toUpdateTotal()">'+popts+'</select>'+
    '<div class="g2">'+
    '<div><label class="fl">Quantity</label><input class="afi" id="to-qty" type="number" value="1" min="1" oninput="toUpdateTotal()"></div>'+
    '<div><label class="fl">Order Total</label><input class="afi" id="to-total" type="number" step="0.01" placeholder="Auto-calculated"></div>'+
    '</div>'+
    '<div style="display:flex;gap:.6rem;justify-content:flex-end;margin-top:.5rem">'+
    '<button class="bs" onclick="rOrders(document.getElementById(\"acnt\"))">Cancel</button>'+
    '<button class="bp" onclick="saveTestOrder()">💾 Save Test Order</button>'+
    '</div></div>';
}
function toUpdateTotal(){
  var pid=document.getElementById('to-prod').value;
  var qty=parseInt(document.getElementById('to-qty').value)||1;
  var p=findProd(pid);
  if(p){document.getElementById('to-total').value=(p.price*qty).toFixed(2);}
}
function saveTestOrder(){
  var name=document.getElementById('to-name').value.trim();
  var email=document.getElementById('to-email').value.trim();
  var ph=document.getElementById('to-ph').value.trim();
  var addr=document.getElementById('to-addr').value.trim();
  var pid=document.getElementById('to-prod').value;
  var qty=parseInt(document.getElementById('to-qty').value)||1;
  var total=parseFloat(document.getElementById('to-total').value);
  var status=document.getElementById('to-status').value;
  if(!name||!email){alert('Please enter a customer name and email.');return;}
  if(!pid){alert('Please select a product.');return;}
  if(!total||isNaN(total)){alert('Please enter or calculate the order total.');return;}
  var p=findProd(pid);
  var oid='TEST-'+Date.now().toString(36).toUpperCase();
  var o={
    id:oid,
    date:(function(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')+':00';})(),
    cust:name,
    email:email,
    phone:ph,
    addr:addr,
    items:p?[{id:pid,name:p.name,price:p.price,q:qty}]:[],
    total:total,
    pay:'Test',
    status:status
  };
  ORDERS.push(o);
  trySave();
  rOrders(document.getElementById('acnt'));
}

function rOrders(el){
  el.innerHTML='<div style="padding:2rem;text-align:center;color:#6b6040">Loading orders…</div>';
  apiFetch('orders.php').then(function(d){
    if(d.success)ORDERS=d.orders||[];
    renderOrdersTable(el);
  }).catch(function(){renderOrdersTable(el);});
}
var ORD_SORT={col:'date',dir:-1};
var ORD_F={id:'',cust:'',dateFrom:'',dateTo:'',subtotal:'',shipping:'',tax:'',fee:'',total:'',pay:'',order_type:'',status:'',swept_date:''};
function ordNormDate(o){var raw=(o.dispDate||o.date||'');var p=raw.replace(/\//g,'-').split('-');return p.length===3?(p[2]+'-'+p[0].padStart(2,'0')+'-'+p[1].padStart(2,'0')):raw;}
function clearOrdFilters(){ORD_F={id:'',cust:'',dateFrom:'',dateTo:'',subtotal:'',shipping:'',tax:'',fee:'',total:'',pay:'',order_type:'',status:'',swept_date:''};renderOrdersTable(document.getElementById('acnt'));}
function ordSort2(col){if(ORD_SORT.col===col)ORD_SORT.dir*=-1;else ORD_SORT={col:col,dir:1};renderOrdersTable(document.getElementById('acnt'));}
function ordFiltApply(col,btn,evt){if(evt)evt.stopPropagation();var pop=btn.closest('.ord-fp');var list=pop?pop.querySelector('[id^="ord-flist-"]'):null;if(!list)return;var checked=[];list.querySelectorAll('input[type=checkbox]:checked').forEach(function(c2){checked.push(c2.value);});var all=[];list.querySelectorAll('input[type=checkbox]').forEach(function(c2){all.push(c2.value);});ORD_F[col]=(checked.length===all.length)?'':checked.length===0?'__NONE__':checked.join('\x00');pop.remove();renderOrdersTable(document.getElementById('acnt'));}
function ordFiltAll(listId,chk,evt){if(evt)evt.stopPropagation();var list=document.getElementById(listId);if(!list)return;list.querySelectorAll('input[type=checkbox]').forEach(function(c2){c2.checked=chk;});}
function ordFiltSearch(listId,q){var list=document.getElementById(listId);if(!list)return;var labels=list.querySelectorAll('label');for(var i=0;i<labels.length;i++){var txt=labels[i].textContent.toLowerCase();labels[i].style.display=(!q||txt.indexOf(q.toLowerCase())>=0)?'flex':'none';}}
function ordFilt2(e,col){e.stopPropagation();document.querySelectorAll('.ord-fp').forEach(function(p){p.remove();});var th=e.target.closest('th');th.style.position='relative';var pop=document.createElement('div');pop.className='ord-fp';pop.style.cssText='position:absolute;top:100%;left:0;background:#fff;border:1.5px solid #e8e0b8;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.18);z-index:300;min-width:220px;padding:0;overflow:hidden';if(col==='date'){pop.innerHTML='<div style="padding:.5rem .7rem;background:#f9f4e4;border-bottom:1px solid #e8e0b8;font-size:.72rem;font-weight:700;color:#a07810;text-transform:uppercase">Date Range</div><div style="padding:.6rem .7rem"><div style="font-size:.72rem;color:#6b6040;margin-bottom:.2rem">From</div><input type="date" id="ord-fp-dfrom" style="width:100%;margin-bottom:.5rem;padding:.3rem .5rem;border:1px solid #e8e0b8;border-radius:5px;font-size:.78rem;box-sizing:border-box" value="'+ORD_F.dateFrom+'"><div style="font-size:.72rem;color:#6b6040;margin-bottom:.2rem">To</div><input type="date" id="ord-fp-dto" style="width:100%;padding:.3rem .5rem;border:1px solid #e8e0b8;border-radius:5px;font-size:.78rem;box-sizing:border-box" value="'+ORD_F.dateTo+'"></div><div style="padding:.5rem .7rem;border-top:1px solid #f0e8d0;display:flex;justify-content:space-between;align-items:center"><button style="font-size:.72rem;color:#a07810;background:none;border:none;cursor:pointer" onclick="ORD_F.dateFrom=\'\';ORD_F.dateTo=\'\';renderOrdersTable(document.getElementById(\'acnt\'));this.closest(\'.ord-fp\').remove()">Clear</button><button style="font-size:.72rem;color:#6b6040;background:none;border:none;cursor:pointer" onclick="this.closest(\'.ord-fp\').remove()">Close</button><button style="font-size:.78rem;background:#d4a017;color:#fff;border:none;border-radius:6px;padding:.3rem .8rem;cursor:pointer;font-weight:600" onclick="var p=this.closest(\'.ord-fp\');ORD_F.dateFrom=p.querySelector(\'#ord-fp-dfrom\').value;ORD_F.dateTo=p.querySelector(\'#ord-fp-dto\').value;p.remove();renderOrdersTable(document.getElementById(\'acnt\'))">Apply</button></div>';}else{var allVals=[];var seen={};for(var i=0;i<ORDERS.length;i++){var v=String(ORDERS[i][col]||'(blank)');if(!seen[v]){seen[v]=true;allVals.push(v);}}allVals.sort();var selVals=ORD_F[col]?ORD_F[col].split('\x00'):null;var listId='ord-flist-'+col;var checkboxes=allVals.map(function(v){var chk=(selVals===null||selVals.indexOf(v)>=0)?'checked':'';return'<label style="display:flex;align-items:center;gap:.4rem;padding:.25rem .4rem;cursor:pointer;border-radius:4px;font-size:.8rem;color:#2d2220" onmouseover="this.style.background=\'#fffdf0\'" onmouseout="this.style.background=\'\'"><input type="checkbox" value="'+v.replace(/"/g,'&quot;')+'" '+chk+'><span>'+v+'</span></label>';}).join('');pop.innerHTML='<div style="padding:.5rem .7rem;background:#f9f4e4;border-bottom:1px solid #e8e0b8;font-size:.72rem;font-weight:700;color:#a07810;text-transform:uppercase">Filter: '+col+'</div><div style="padding:.4rem .7rem;border-bottom:1px solid #f0e8d0"><input type="text" style="width:100%;padding:.3rem .5rem;border:1px solid #e8e0b8;border-radius:5px;font-size:.8rem;box-sizing:border-box" placeholder="Search..." oninput="ordFiltSearch(\''+listId+'\',this.value)"></div><div style="padding:.3rem .4rem;border-bottom:1px solid #f0e8d0;display:flex;gap:.5rem"><button style="font-size:.72rem;color:#a07810;background:none;border:none;cursor:pointer;padding:0" onclick="ordFiltAll(\''+listId+'\',true)">Select All</button><span style="color:#e8e0b8">|</span><button style="font-size:.72rem;color:#a07810;background:none;border:none;cursor:pointer;padding:0" onclick="ordFiltAll(\''+listId+'\',false)">Clear All</button></div><div id="'+listId+'" style="max-height:180px;overflow-y:auto;padding:.2rem .3rem">'+checkboxes+'</div><div style="padding:.5rem .7rem;border-top:1px solid #f0e8d0;display:flex;justify-content:space-between;align-items:center"><button style="font-size:.72rem;color:#6b6040;background:none;border:none;cursor:pointer;padding:0" onclick="this.closest(\'.ord-fp\').remove()">Close</button><button style="font-size:.78rem;background:#d4a017;color:#fff;border:none;border-radius:6px;padding:.3rem .8rem;cursor:pointer;font-weight:600" onclick="ordFiltApply(\''+col+'\',this)">Apply</button></div>';}th.appendChild(pop);setTimeout(function(){var inp=pop.querySelector('input');if(inp)inp.focus();},50);setTimeout(function(){document.addEventListener('click',function h(ev){if(!pop.contains(ev.target)){pop.remove();document.removeEventListener('click',h);}});},50);}
function applyOrdFilters(){var result=ORDERS.filter(function(o){function chkF(fval,oval){if(!fval)return true;if(fval==='__NONE__')return false;return fval.split('\x00').indexOf(String(oval||'(blank)'))>=0;}if(ORD_F.id&&!chkF(ORD_F.id,o.id))return false;if(ORD_F.cust&&!chkF(ORD_F.cust,o.cust))return false;if(ORD_F.pay&&!chkF(ORD_F.pay,o.pay))return false;if(ORD_F.status&&!chkF(ORD_F.status,o.status))return false;if(ORD_F.swept_date&&!chkF(ORD_F.swept_date,o.swept_date||'\u2014'))return false;if(ORD_F.total&&(o.total||0).toFixed(2).indexOf(ORD_F.total)<0)return false;if(ORD_F.tax&&String((o.tax||0).toFixed(2)).indexOf(ORD_F.tax)<0)return false;if(ORD_F.dateFrom||ORD_F.dateTo){var norm=ordNormDate(o);if(ORD_F.dateFrom&&norm<ORD_F.dateFrom)return false;if(ORD_F.dateTo&&norm>ORD_F.dateTo)return false;}return true;});var sc=ORD_SORT.col,sd=ORD_SORT.dir;if(sc)result.sort(function(a,b){var av=a[sc]||'',bv=b[sc]||'';if(typeof av==='number'&&typeof bv==='number')return sd*(av-bv);if(sc==='date')return sd*ordNormDate(a).localeCompare(ordNormDate(b));return sd*String(av).localeCompare(String(bv));});return result;}
function buildOrdThead(){var cols=[{key:'id',label:'Order ID'},{key:'cust',label:'Customer'},{key:'date',label:'Date'},{key:'time',label:'Time'},{key:'subtotal',label:'Subtotal'},{key:'shipping',label:'Shipping'},{key:'tax',label:'Tax'},{key:'fee',label:'Trans Fee'},{key:'total',label:'Total'},{key:'pay',label:'Paid By'},{key:'order_type',label:'Order Type'},{key:'status',label:'Status'},{key:'swept_date',label:'Tax Swept Date'}];var s='background:#a07810;color:#fff;padding:0;white-space:nowrap';var ths=cols.map(function(col){var isSort=ORD_SORT.col===col.key;var hasF=(ORD_F[col.key]&&ORD_F[col.key]!=='')||(col.key==='date'&&(ORD_F.dateFrom||ORD_F.dateTo));var arrow=isSort?(ORD_SORT.dir===1?'\u25b2':'\u25bc'):'\u25bf';return'<th style="'+s+';position:relative"><div style="display:flex;align-items:center;padding:5px 6px;gap:3px"><span style="font-size:.75rem;font-weight:700">'+col.label+'</span><span style="font-size:.65rem;color:'+(isSort?'#ffe082':'rgba(255,255,255,.75)')+';cursor:pointer" onclick="ordSort2(\''+col.key+'\')" title="Sort">'+arrow+'</span><span style="font-size:.65rem;background:'+(hasF?'#ffe082':'rgba(255,255,255,.2)')+';color:'+(hasF?'#5a3e00':'#fff')+';border-radius:3px;padding:1px 4px;cursor:pointer;line-height:1.4" onclick="ordFilt2(event,\''+col.key+'\')" title="Filter">\u25bc</span></div></th>';}).join('');return'<thead><tr>'+ths+'<th style="'+s+'"><div style="padding:5px 6px;font-size:.75rem;font-weight:700">Status / Pay</div></th><th style="'+s+'"><div style="padding:5px 6px;font-size:.75rem;font-weight:700">Actions</div></th></tr></thead>';}
function renderOrdersTable(el){
  var filt=applyOrdFilters();
  var rows='';
  for(var i=0;i<filt.length;i++){
    var o=filt[i];
    rows+='<tr>'+
      '<td><code style="font-size:.72rem;cursor:pointer;color:#a07810;text-decoration:underline" onclick="viewOrder(\''+o.id+'\')" title="View details">'+o.id+'</code></td>'+
      '<td>'+o.cust+'</td>'+
      '<td>'+(o.dispDate||o.date)+'</td>'+
      '<td style="color:#6b6040;font-size:.78rem">'+(o.time||'')+'</td>'+
      '<td style="font-size:.8rem">$'+parseFloat(o.subtotal||0).toFixed(2)+'</td>'+
      '<td style=\"font-size:.8rem\">'+(o.shipping>0?'$'+parseFloat(o.shipping).toFixed(2):'Free')+'</td>'+
      '<td style="font-size:.8rem;color:#6b6040">'+(o.tax>0?'$'+o.tax.toFixed(2):'\u2014')+'</td>'+
      '<td style="font-size:.78rem">$'+parseFloat(o.fee||0).toFixed(2)+'</td>'+
      '<td style="font-weight:700;color:#a07810">$'+o.total.toFixed(2)+'</td>'+

      '<td>'+(o.pay==='Test'?'<span class="badge bt">Test</span>':o.pay)+'</td>'+
      '<td style="font-size:.78rem;color:#6b6040">'+(o.order_type||'Online')+'</td>'+
      '<td><span class="badge '+(o.status==='Delivered'||o.status==='Paid'?'bg':o.status==='Shipped'?'bb':o.status==='Cancelled'||o.status==='Refunded'?'br':o.status==='Awaiting Payment'?'bw':'ba')+'">'+o.status+'</span></td>'+
      '<td style="text-align:center;font-size:.78rem;color:'+(o.swept_date?'#2e7d32':'#6b6040')+'">'+
        (o.swept_date?o.swept_date:'\u2014')+
      '</td>'+
      '<td></td>'+
      '<td>'+
        '<button class="be" onclick="viewOrder(\''+o.id+'\')" style="font-size:.8rem;padding:.3rem .8rem">View</button>'+
      '</td>'+
    '</tr>';
  }
  var isF=ORD_F.id||ORD_F.cust||ORD_F.pay||ORD_F.order_type||ORD_F.fee||ORD_F.shipping||ORD_F.status||ORD_F.total||ORD_F.tax||ORD_F.swept_date||ORD_F.dateFrom||ORD_F.dateTo;
  el.innerHTML=
    '<div style="display:flex;justify-content:flex-end;gap:.5rem;margin-bottom:.6rem">'+
    '<button class="bs" onclick="clearOrdFilters()" style="font-size:.78rem">✕ Clear Filters</button>'+
    '<button class="bs" onclick="rOrders(document.getElementById(\'acnt\'))" style="font-size:.78rem">🔄 Refresh</button>'+
    '<button class="bs" id="upd-fee-btn" onclick="updateTransFees()" style="font-size:.78rem">💳 Update Trans Fees</button>'+
    '<button class="bs" onclick="exportOrdersCsv()" style="font-size:.78rem">⬇️ Export CSV</button>'+
    '<button class="bs" onclick="printOrdersPdf()" style="font-size:.78rem">🖨️ Print PDF</button>'+
    (ORDERS.length?'<button class="bd" onclick="deleteAllOrders()" style="font-size:.78rem">🗑 Delete All</button>':'')+
    '</div>'+
    '<table>'+buildOrdThead()+
    '<tbody>'+(rows||'<tr><td colspan="11" style="text-align:center;padding:1.5rem;color:#6b6040">No orders yet</td></tr>')+'</tbody>'+
    '<tfoot><tr style="background:#fffdf0;font-weight:700;border-top:2px solid #e8e0b8">'+
      '<td colspan="4" style="padding:8px 12px;color:#6b6040;font-size:.82rem">'+filt.length+' order'+(filt.length!==1?'s':'')+(isF?' (filtered)':'')+'</td>'+
      '<td style="padding:8px 12px;font-size:.8rem">$'+filt.reduce(function(s,o){return s+(o.subtotal||0);},0).toFixed(2)+'</td>'+
      '<td style="padding:8px 12px;font-size:.8rem">$'+filt.reduce(function(s,o){return s+(o.shipping||0);},0).toFixed(2)+'</td>'+
      '<td style="padding:8px 12px;color:#2e7d32">$'+filt.reduce(function(s,o){return s+(o.tax||0);},0).toFixed(2)+'</td>'+
      '<td style="padding:8px 12px;font-size:.8rem">$'+filt.reduce(function(s,o){return s+(o.fee||0);},0).toFixed(2)+'</td>'+
      '<td style="padding:8px 12px;color:#a07810">$'+filt.reduce(function(s,o){return s+o.total;},0).toFixed(2)+'</td>'+
      '<td colspan="3"></td>'+
    '</tr></tfoot>'+
    '</table>';
}
function applyOrderFilters(){
  return ORDERS.filter(function(o){
    var custOk=!ORDER_FILTER||(o.cust||'').toLowerCase().indexOf(ORDER_FILTER.toLowerCase())>=0;
    var oDate=(o.dispDate||o.date||'').replace(/\//g,'-');
    var parts=oDate.split('-');
    var normDate=parts.length===3?(parts[2]+'-'+parts[0].padStart(2,'0')+'-'+parts[1].padStart(2,'0')):oDate;
    var fromOk=!ORDER_DATE_FROM||normDate>=ORDER_DATE_FROM;
    var toOk=!ORDER_DATE_TO||normDate<=ORDER_DATE_TO;
    return custOk&&fromOk&&toOk;
  });
}
function filterOrders(val){
  ORDER_FILTER=val;
  var inp=document.getElementById('order-search');
  if(inp&&inp.value!==val)inp.value=val;
  var tbody=document.querySelector('#acnt table tbody');
  if(!tbody){renderOrdersTable(document.getElementById('acnt'));return;}
  var filtered=applyOrderFilters();
  var rows='';
  for(var i=filtered.length-1;i>=0;i--){
    var o=filtered[i];
    rows+=buildOrderRow(o);
  }
  tbody.innerHTML=rows||'<tr><td colspan="10" style="text-align:center;padding:1.5rem;color:#6b6040">No orders match filters</td></tr>';
  updateOrderTotals(filtered);
}
function clearOrderFilters(){
  ORDER_FILTER='';ORDER_DATE_FROM='';ORDER_DATE_TO='';
  var s=document.getElementById('order-search');if(s)s.value='';
  var df=document.getElementById('order-date-from');if(df)df.value='';
  var dt=document.getElementById('order-date-to');if(dt)dt.value='';
  rOrders(document.getElementById('acnt'));
}
function buildOrderRow(o){
  return '<tr>'+
    '<td><code style="font-size:.72rem;cursor:pointer;color:#a07810;text-decoration:underline" onclick="viewOrder(\''+o.id+'\')" title="View details">'+o.id+'</code></td>'+
    '<td>'+o.cust+'</td>'+
    '<td>'+(o.dispDate||o.date)+'</td>'+
    '<td style="color:#6b6040;font-size:.78rem">'+(o.time||'')+'</td>'+
    '<td style="font-size:.8rem">$'+parseFloat(o.subtotal||0).toFixed(2)+'</td>'+
      '<td style=\"font-size:.8rem\">'+(o.shipping>0?'$'+parseFloat(o.shipping).toFixed(2):'Free')+'</td>'+
    '<td style="font-size:.8rem;color:#6b6040">'+(o.tax>0?'$'+o.tax.toFixed(2):'\u2014')+'</td>'+
      '<td style="font-size:.78rem">$'+parseFloat(o.fee||0).toFixed(2)+'</td>'+
      '<td style="font-weight:700;color:#a07810">$'+o.total.toFixed(2)+'</td>'+

    '<td>'+(o.pay==='Test'?'<span class="badge bt">Test</span>':o.pay)+'</td>'+
    '<td><span class="badge '+(o.status==='Delivered'||o.status==='Paid'?'bg':o.status==='Shipped'?'bb':o.status==='Cancelled'||o.status==='Refunded'?'br':o.status==='Awaiting Payment'?'bw':'ba')+'">'+o.status+'</span></td>'+
    '<td>'+
      '<select style="padding:.24rem .38rem;border:1.5px solid #e8e0b8;border-radius:5px;font-size:.75rem;font-family:sans-serif;display:block;width:100%;margin-bottom:.3rem" onchange="updO(\''+o.id+'\',this.value)">'+['Awaiting Payment','Paid','Pending','Processing','Shipped','Delivered','Cancelled','Refunded'].map(function(s){return'<option'+(s===o.status?' selected':'')+'>'+s+'</option>';}).join('')+'</select>'+
      '<select style="padding:.24rem .38rem;border:1.5px solid #e8e0b8;border-radius:5px;font-size:.75rem;font-family:sans-serif;display:block;width:100%" onchange="updPay(\''+o.id+'\',this.value)">'+['Credit Card','Cash','Check','Square','Other'].map(function(p){return'<option'+(p===(o.pay||'Credit Card')?' selected':'')+'>'+p+'</option>';}).join('')+'</select>'+
    '</td>'+
    '<td>'+
      '<button class="be" onclick="viewOrder(\''+o.id+'\')" style="font-size:.8rem;padding:.3rem .8rem">View</button>'+
    '</td>'+
  '</tr>';
}
function updateOrderTotals(filtered){
  var tfoot=document.querySelector('#acnt table tfoot tr');
  if(!tfoot)return;
  var cells=tfoot.querySelectorAll('td');
  var isFiltered=ORDER_FILTER||ORDER_DATE_FROM||ORDER_DATE_TO;
  if(cells[0])cells[0].textContent=filtered.length+' order'+(filtered.length!==1?'s':'')+(isFiltered?' (filtered)':'');
  if(cells[1])cells[1].textContent='$'+filtered.reduce(function(s,o){return s+o.total;},0).toFixed(2);
  if(cells[2])cells[2].textContent='$'+filtered.reduce(function(s,o){return s+(o.tax||0);},0).toFixed(2);
}
function updSwept(id,dateStr){
  for(var i=0;i<ORDERS.length;i++)if(ORDERS[i].id===id){ORDERS[i].swept_date=dateStr||null;break;}
  apiFetch('orders.php','PUT',{id:id,swept_date:dateStr||null}).catch(function(){});
}
function updO(id,s){
  for(var i=0;i<ORDERS.length;i++)if(ORDERS[i].id===id){ORDERS[i].status=s;break;}
  apiFetch('orders.php','PUT',{id:id,status:s}).catch(function(){});
}
function updPay(id,pay){
  for(var i=0;i<ORDERS.length;i++)if(ORDERS[i].id===id){ORDERS[i].pay=pay;break;}
  apiFetch('orders.php','PUT',{id:id,pay:pay}).catch(function(){});
}
function delOrder(id){
  if(!confirm('Delete this order? This cannot be undone.'))return;
  ORDERS=ORDERS.filter(function(o){return o.id!==id;});
  apiFetch('orders.php','DELETE',{id:id}).catch(function(){});
  rOrders(document.getElementById('acnt'));
}
function exportTaxCSV(){
  var rows=['Order ID,Date,Customer,Total,Tax,Payment Method,Status'];
  for(var i=0;i<ORDERS.length;i++){
    var o=ORDERS[i];
    rows.push([
      '"'+o.id+'"',
      '"'+(o.dispDate||o.date||'')+'"',
      '"'+(o.cust||'').replace(/"/g,'""')+'"',
      o.total.toFixed(2),
      (o.tax||0).toFixed(2),
      '"'+(o.pay||'')+'"',
      '"'+(o.status||'')+'"'
    ].join(','));
  }
  var csv=rows.join('\n');
  var a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download='suzi_tax_report_'+new Date().toISOString().slice(0,10)+'.csv';
  a.click();
}
function deleteAllOrders(){
  if(!confirm('Delete ALL '+ORDERS.length+' orders? This will clear all sales data and cannot be undone.'))return;
  if(!confirm('Are you sure? This is permanent.'))return;
  ORDERS=[];
  apiFetch('orders.php','DELETE',{delete_all:true}).catch(function(){});
  // Re-render whichever section is currently active
  var acnt=document.getElementById('acnt');
  var title=document.getElementById('aptitle').textContent;
  if(title==='Orders')rOrders(acnt);
  else if(title==='Sales Report')rSales(acnt);
  else rDash(acnt);
}

function rCusts(el){
  el.innerHTML='<div style="padding:2rem;text-align:center;color:#6b6040">Loading customers…</div>';
  apiFetch('customers.php?action=list').then(function(d){
    if(d.success)CUSTS=d.customers||[];
    renderCustsTable(el);
  }).catch(function(){renderCustsTable(el);});
}
var CUST_SORT={col:'name',dir:1};
var CUST_F={name:'',em:'',orders:''};

function custSort(col){if(CUST_SORT.col===col)CUST_SORT.dir*=-1;else CUST_SORT={col:col,dir:1};renderCustsTable(document.getElementById('acnt'));}

function custFilt(e,col){
  e.stopPropagation();
  document.querySelectorAll('.cust-fp').forEach(function(p){p.remove();});
  var th=e.target.closest('th');th.style.position='relative';
  var pop=document.createElement('div');
  pop.className='cust-fp';
  pop.style.cssText='position:absolute;top:100%;left:0;background:#fff;border:1.5px solid #e8e0b8;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.18);z-index:300;min-width:200px;padding:0;overflow:hidden';
  var allVals=[];var seen={};
  for(var i=0;i<CUSTS.length;i++){
    var c=CUSTS[i];
    var v=col==='orders'?String(c.orders||0)+' orders':String(c[col]||'(blank)');
    if(!seen[v]){seen[v]=true;allVals.push(v);}
  }
  allVals.sort();
  var selVals=CUST_F[col]?CUST_F[col].split('\x00'):null;
  var listId='cust-flist-'+col;
  var checkboxes=allVals.map(function(v){
    var chk=(selVals===null||selVals.indexOf(v)>=0)?'checked':'';
    return '<label style="display:flex;align-items:center;gap:.4rem;padding:.25rem .4rem;cursor:pointer;border-radius:4px;font-size:.8rem" onmouseover="this.style.background=\'#fffdf0\'" onmouseout="this.style.background=\'\'"><input type="checkbox" value="'+v.replace(/"/g,'&quot;')+'" '+chk+'><span>'+v+'</span></label>';
  }).join('');
  pop.innerHTML=
    '<div style="padding:.5rem .7rem;background:#f9f4e4;border-bottom:1px solid #e8e0b8;font-size:.72rem;font-weight:700;color:#a07810;text-transform:uppercase">Filter: '+col+'</div>'+
    '<div style="padding:.3rem .4rem;border-bottom:1px solid #f0e8d0;display:flex;gap:.5rem">'+
      '<button style="font-size:.72rem;color:#a07810;background:none;border:none;cursor:pointer" onclick="custFiltAll(\''+listId+'\',true)">All</button>'+
      '<span style="color:#e8e0b8">|</span>'+
      '<button style="font-size:.72rem;color:#a07810;background:none;border:none;cursor:pointer" onclick="custFiltAll(\''+listId+'\',false)">None</button>'+
    '</div>'+
    '<div id="'+listId+'" style="max-height:200px;overflow-y:auto;padding:.2rem .3rem">'+checkboxes+'</div>'+
    '<div style="padding:.5rem .7rem;border-top:1px solid #f0e8d0;display:flex;justify-content:space-between">'+
      '<button style="font-size:.72rem;color:#6b6040;background:none;border:none;cursor:pointer" onclick="this.closest(\'.cust-fp\').remove()">Close</button>'+
      '<button style="font-size:.78rem;background:#d4a017;color:#fff;border:none;border-radius:6px;padding:.3rem .8rem;cursor:pointer;font-weight:600" onclick="custFiltApply(\''+col+'\',this)">Apply</button>'+
    '</div>';
  th.appendChild(pop);
  setTimeout(function(){document.addEventListener('click',function h(ev){if(!pop.contains(ev.target)){pop.remove();document.removeEventListener('click',h);}});},50);
}

function custFiltAll(listId,chk){document.querySelectorAll('#'+listId+' input[type=checkbox]').forEach(function(c){c.checked=chk;});}

function custFiltApply(col,btn){
  var pop=btn.closest('.cust-fp');
  var list=pop?pop.querySelector('[id^="cust-flist-"]'):null;
  if(!list)return;
  var checked=[],all=[];
  list.querySelectorAll('input[type=checkbox]').forEach(function(c){all.push(c.value);if(c.checked)checked.push(c.value);});
  CUST_F[col]=(checked.length===all.length)?'':checked.length===0?'__NONE__':checked.join('\x00');
  pop.remove();
  renderCustsTable(document.getElementById('acnt'));
}

function applyCustomerFilters(){
  var result=CUSTS.filter(function(c){
    function chk(fval,oval){if(!fval)return true;if(fval==='__NONE__')return false;return fval.split('\x00').indexOf(String(oval||'(blank)'))>=0;}
    if(CUST_F.name&&!chk(CUST_F.name,c.name))return false;
    if(CUST_F.em&&!chk(CUST_F.em,c.em))return false;
    if(CUST_F.orders&&!chk(CUST_F.orders,String(c.orders||0)+' orders'))return false;
    return true;
  });
  var sc=CUST_SORT.col,sd=CUST_SORT.dir;
  if(sc)result.sort(function(a,b){
    var av=sc==='orders'?(a.orders||0):String(a[sc]||'');
    var bv=sc==='orders'?(b.orders||0):String(b[sc]||'');
    if(typeof av==='number'&&typeof bv==='number')return sd*(av-bv);
    return sd*String(av).localeCompare(String(bv));
  });
  return result;
}

function buildCustThead(){
  var cols=[{key:'name',label:'Name'},{key:'em',label:'Email'},{key:'ph',label:'Phone'},{key:'joined',label:'Joined'},{key:'orders',label:'Orders'}];
  var s='background:#a07810;color:#fff;padding:0;white-space:nowrap';
  var filterCols=['name','em','orders'];
  var ths=cols.map(function(col){
    var isSort=CUST_SORT.col===col.key;
    var hasF=CUST_F[col.key]&&CUST_F[col.key]!=='';
    var arrow=isSort?(CUST_SORT.dir===1?'▲':'▼'):'▽';
    var canFilter=filterCols.indexOf(col.key)>=0;
    return '<th style="'+s+';position:relative"><div style="display:flex;align-items:center;padding:5px 6px;gap:3px">'+
      '<span style="font-size:.75rem;font-weight:700">'+col.label+'</span>'+
      '<span style="font-size:.65rem;color:'+(isSort?'#ffe082':'rgba(255,255,255,.75)')+';cursor:pointer" onclick="custSort(\''+col.key+'\')" title="Sort">'+arrow+'</span>'+
      (canFilter?'<span style="font-size:.65rem;background:'+(hasF?'#ffe082':'rgba(255,255,255,.2)')+';color:'+(hasF?'#5a3e00':'#fff')+';border-radius:3px;padding:1px 4px;cursor:pointer;line-height:1.4" onclick="custFilt(event,\''+col.key+'\')" title="Filter">▾</span>':'')+
    '</div></th>';
  }).join('');
  return '<thead><tr>'+ths+'</tr></thead>';
}

function renderCustsTable(el){
  var filtered=applyCustomerFilters();
  var rows='';
  for(var i=0;i<filtered.length;i++){
    var c=filtered[i];
    rows+='<tr><td style="font-weight:600">'+c.name+'</td><td>'+c.em+'</td><td>'+(c.ph||'—')+'</td><td>'+(c.joined||'—')+'</td><td><span class="badge bb">'+(c.orders||0)+' orders</span></td></tr>';
  }
  var isFiltered=CUST_F.name||CUST_F.em||CUST_F.orders;
  el.innerHTML=
    '<div style="display:flex;gap:.6rem;margin-bottom:.6rem;align-items:center">'+
      (isFiltered?'<button class="bs" onclick="CUST_F={name:\'\',em:\'\',orders:\'\'};renderCustsTable(document.getElementById(\'acnt\'))" style="color:#c62828">✕ Clear Filters</button>':'')+
      '<span style="font-size:.78rem;color:#6b6040;margin-left:auto">'+filtered.length+' of '+CUSTS.length+' customers</span>'+
    '</div>'+
    '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">'+buildCustThead()+'<tbody>'+(rows||'<tr><td colspan="5" style="text-align:center;padding:1.5rem;color:#6b6040">No customers yet</td></tr>')+'</tbody></table></div>';
}


function rInv(el){
  var total=0,low=0,out=0;for(var i=0;i<PRODS.length;i++){total+=PRODS[i].stock;if(PRODS[i].stock===0)out++;else if(PRODS[i].stock<=3)low++;}
  var sp=[].concat(PRODS).sort(function(a,b){return a.stock-b.stock;}),rows='';
  for(var j=0;j<sp.length;j++){var p=sp[j];var th=firstImg(p);rows+='<tr><td><div style="display:flex;align-items:center;gap:.5rem">'+(th?'<img src="'+th+'" style="width:32px;height:32px;border-radius:5px;object-fit:cover">':'<span>👜</span>')+'<span style="font-weight:600">'+p.name+'</span></div></td><td>'+p.cat+'</td><td>$'+p.price.toFixed(2)+'</td><td style="font-weight:700">'+p.stock+'</td><td><span class="badge '+(p.stock>5?'bg':p.stock>0?'ba':'br')+'">'+(p.stock>5?'In Stock':p.stock>0?'Low':'Out of Stock')+'</span></td><td><button onclick="adjSt(\''+p.id+'\',-1)" style="background:#fdf3d0;border:none;width:22px;height:22px;border-radius:50%;cursor:pointer;font-weight:700;color:#a07810">−</button> <input type="number" value="'+p.stock+'" min="0" style="width:48px;text-align:center;border:1.5px solid #e8e0b8;border-radius:5px;padding:.22rem;font-size:.78rem" onchange="setSt(\''+p.id+'\',this.value)"> <button onclick="adjSt(\''+p.id+'\',1)" style="background:#fdf3d0;border:none;width:22px;height:22px;border-radius:50%;cursor:pointer;font-weight:700;color:#a07810">+</button></td></tr>';}
  el.innerHTML='<div class="stats"><div class="stat"><div class="stl">Total Units</div><div class="stv">'+total+'</div></div><div class="stat"><div class="stl">Low Stock</div><div class="stv" style="color:#e65100">'+low+'</div></div><div class="stat"><div class="stl">Out of Stock</div><div class="stv" style="color:#c0392b">'+out+'</div></div><div class="stat"><div class="stl">SKUs</div><div class="stv">'+PRODS.length+'</div></div></div>'+
    '<table><thead><tr><th>Product</th><th>Cat</th><th>Price</th><th>Stock</th><th>Status</th><th>Adjust</th></tr></thead><tbody>'+rows+'</tbody></table>';
}
function adjSt(id,d){var p=findProd(id);if(p){p.stock=Math.max(0,p.stock+d);
  apiFetch('products.php','POST',p).catch(function(){});
  renderStore();rInv(document.getElementById('acnt'));}}
function setSt(id,v){var p=findProd(id);if(p){p.stock=Math.max(0,parseInt(v)||0);
  apiFetch('products.php','POST',p).catch(function(){});
  renderStore();}}

function rSales(el){
  el.innerHTML='<div style="padding:2rem;text-align:center;color:#6b6040">Loading sales data…</div>';
  apiFetch('orders.php').then(function(d){
    if(d.success)ORDERS=d.orders||[];
    renderSalesTable(el);
  }).catch(function(){renderSalesTable(el);});
}
function renderSalesTable(el){
  var rev=0,totalTax=0,payGroups={},tp={};
  for(var i=0;i<ORDERS.length;i++){
    rev+=ORDERS[i].total;
    totalTax+=(ORDERS[i].tax||0);
    var pm=ORDERS[i].pay||'Unknown';
    if(!payGroups[pm])payGroups[pm]={count:0,total:0};
    payGroups[pm].count++;payGroups[pm].total+=ORDERS[i].total;
    for(var j=0;j<ORDERS[i].items.length;j++){var it=ORDERS[i].items[j];tp[it.name]=(tp[it.name]||0)+it.q;}
  }
  var ts=[];for(var k in tp)ts.push([k,tp[k]]);ts.sort(function(a,b){return b[1]-a[1];});ts=ts.slice(0,5);
  var trows='';for(var q=0;q<ts.length;q++)trows+='<tr><td style="font-weight:600">'+ts[q][0]+'</td><td><span class="badge bg">'+ts[q][1]+' sold</span></td></tr>';
  el.innerHTML='<div class="stats"><div class="stat"><div class="stl">Revenue</div><div class="stv">$'+rev.toFixed(2)+'</div></div><div class="stat"><div class="stl">Orders</div><div class="stv">'+ORDERS.length+'</div></div><div class="stat"><div class="stl">Avg Order</div><div class="stv">$'+(ORDERS.length?(rev/ORDERS.length).toFixed(2):'0.00')+'</div></div><div class="stat"><div class="stl">Square Orders</div><div class="stv">'+(payGroups['Square']?payGroups['Square'].count:0)+'</div></div></div>'+
    '<table><thead><tr><th>Top Product</th><th>Units Sold</th></tr></thead><tbody>'+(trows||'<tr><td colspan="2" style="text-align:center;padding:1.2rem;color:#6b6040">No sales yet</td></tr>')+'</tbody></table>'+
    '<table><thead><tr><th>Payment Method</th><th>Orders</th><th>Revenue</th></tr></thead><tbody>'+
    (Object.keys(payGroups).length?Object.keys(payGroups).map(function(pm){
      return'<tr><td>💳 '+pm+'</td><td>'+payGroups[pm].count+'</td>'
      +'<td style="font-weight:700;color:#a07810">$'+payGroups[pm].total.toFixed(2)+'</td></tr>';
    }).join(''):'<tr><td colspan="3" style="text-align:center;padding:1rem;color:#6b6040">No orders</td></tr>')
    +'</tbody></table>'+
    '<div style="background:#fff;border:1px solid #e8e0b8;border-radius:10px;padding:1.1rem;margin-top:1.2rem">'+
    '<div style="font-weight:700;margin-bottom:.9rem">🧾 Tax Summary</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.8rem;margin-bottom:1rem">'+
      '<div class="stat"><div class="stl">Total Tax Collected</div><div class="stv" style="color:#2e7d32">$'+totalTax.toFixed(2)+'</div></div>'+
      '<div class="stat"><div class="stl">Tax % of Revenue</div><div class="stv">'+(rev>0?(totalTax/rev*100).toFixed(1):'0.0')+'%</div></div>'+
    '</div>'+
    '<button class="bp" style="font-size:.8rem" onclick="exportTaxCSV()">📥 Export Tax Report (CSV)</button>'+
    '</div>'+
    (ORDERS.length?'<div style="margin-top:1.2rem;padding-top:1.2rem;border-top:1px solid #e8e0b8"><div style="font-size:.82rem;color:#6b6040;margin-bottom:.7rem">Use this to clear test orders before going live. This cannot be undone.</div><button class="bd" onclick="deleteAllOrders()" style="font-size:.82rem">🗑 Delete All Orders &amp; Sales Data</button></div>':'');
}

function rAdminFAQs(el){
  apiFetch('faqs.php').then(function(d){
    if(d.success)FAQS=d.faqs||[];
    renderAdminFAQList(el);
  });
}
function renderAdminFAQList(el){
  var rows=FAQS.map(function(f,i){
    return '<div style="background:#fff;border:1px solid #e8e0b8;border-radius:8px;padding:.9rem;margin-bottom:.6rem">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.8rem">'+
        '<div style="flex:1">'+
          '<div style="font-weight:700;font-size:.88rem;color:#2d2220;margin-bottom:.3rem">'+f.question+'</div>'+
          '<div style="font-size:.8rem;color:#6b6040;line-height:1.6">'+f.answer+'</div>'+
        '</div>'+
        '<div style="display:flex;flex-direction:column;gap:.3rem;flex-shrink:0">'+
          '<button class="be" style="font-size:.72rem" onclick="editFAQ('+i+')">Edit</button>'+
          (i>0?'<button class="bs" style="font-size:.68rem;padding:.2rem .5rem" onclick="moveFAQ('+i+',-1)">↑</button>':'')+
          (i<FAQS.length-1?'<button class="bs" style="font-size:.68rem;padding:.2rem .5rem" onclick="moveFAQ('+i+',1)">↓</button>':'')+
          '<button class="bd" style="font-size:.72rem" onclick="deleteFAQ('+f.id+')">Delete</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  }).join('');
  el.innerHTML=
    '<div style="max-width:640px">'+
    '<div style="background:#fff;border:1px solid #e8e0b8;border-radius:10px;padding:1.2rem;margin-bottom:1rem">'+
      '<div style="font-weight:700;margin-bottom:.9rem">➕ Add New FAQ</div>'+
      '<label class="fl">Question</label><input class="afi" id="faq-q" placeholder="What question do customers ask?">'+
      '<label class="fl">Answer</label><textarea class="afi" id="faq-a" rows="3" placeholder="Your answer…" style="resize:vertical"></textarea>'+
      '<div class="aok" id="faq-ok" style="margin:.4rem 0">✓ Saved!</div>'+
      '<button class="bp" onclick="saveFAQ()">💾 Add FAQ</button>'+
    '</div>'+
    '<div style="font-weight:700;font-size:.85rem;text-transform:uppercase;letter-spacing:.06em;color:#a07810;margin-bottom:.7rem">'+FAQS.length+' FAQ'+(FAQS.length!==1?'s':'')+' — drag ↑↓ to reorder</div>'+
    (rows||'<div style="padding:1rem;color:#6b6040;font-size:.85rem">No FAQs yet — add one above.</div>')+
    '</div>';
}
function saveFAQ(id){
  var q=document.getElementById('faq-q').value.trim();
  var a=document.getElementById('faq-a').value.trim();
  if(!q||!a){alert('Please enter both a question and answer.');return;}
  var body=id?{id:id,question:q,answer:a}:{question:q,answer:a,sort_order:FAQS.length};
  apiFetch('faqs.php',id?'PUT':'POST',body).then(function(d){
    if(!d.success){alert(d.error||'Failed');return;}
    var ok=document.getElementById('faq-ok');
    if(ok){ok.style.display='block';setTimeout(function(){ok.style.display='none';},2000);}
    document.getElementById('faq-q').value='';
    document.getElementById('faq-a').value='';
    rAdminFAQs(document.getElementById('acnt'));
  });
}
function editFAQ(i){
  var f=FAQS[i];
  document.getElementById('faq-q').value=f.question;
  document.getElementById('faq-a').value=f.answer;
  var btn=document.querySelector('#acnt .bp');
  if(btn){btn.textContent='💾 Update FAQ';btn.onclick=function(){saveFAQ(f.id);};}
  document.getElementById('faq-q').focus();
}
function deleteFAQ(id){
  if(!confirm('Delete this FAQ?'))return;
  apiFetch('faqs.php','DELETE',{id:id}).then(function(){
    rAdminFAQs(document.getElementById('acnt'));
  });
}
function moveFAQ(idx,dir){
  var newIdx=idx+dir;
  if(newIdx<0||newIdx>=FAQS.length)return;
  var tmp=FAQS[idx];FAQS[idx]=FAQS[newIdx];FAQS[newIdx]=tmp;
  // Save new order
  apiFetch('faqs.php','POST',{action:'reorder',order:FAQS.map(function(f){return f.id;})}).catch(function(){});
  renderAdminFAQList(document.getElementById('acnt'));
}

function rAdminReviews(el){
  el.innerHTML='<div style="padding:2rem;text-align:center;color:#6b6040">Loading reviews…</div>';
  apiFetch('reviews.php?admin=1').then(function(d){
    var all=d.reviews||[];
    var pending=all.filter(function(r){return r.status==='pending';});
    var approved=all.filter(function(r){return r.status==='approved';});
    function reviewRows(list,showActions){
      if(!list.length)return '<div style="padding:1rem;color:#6b6040;font-size:.85rem">None</div>';
      return list.map(function(r){
        var stars='★'.repeat(r.rating)+'☆'.repeat(5-r.rating);
        return '<div style="background:#fff;border:1px solid #e8e0b8;border-radius:8px;padding:.9rem;margin-bottom:.6rem">'+
          '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
            '<div>'+
              '<div style="font-weight:700;font-size:.88rem">'+r.customer_name+'</div>'+
              (r.product_name?'<div style="font-size:.75rem;color:#6b6040">'+r.product_name+'</div>':'')+
              '<div style="color:#d4a017;font-size:.85rem;margin:.2rem 0">'+stars+'</div>'+
              '<div style="font-size:.83rem;color:#2d2220;font-style:italic">“'+r.review_text+'”</div>'+
            '</div>'+
            (showActions?'<div style="display:flex;flex-direction:column;gap:.35rem;margin-left:.8rem">'+
              '<button class="bp" style="font-size:.72rem;padding:.28rem .6rem;white-space:nowrap" onclick="approveReview('+r.id+')">✓ Approve</button>'+
              '<button class="bd" style="font-size:.72rem;padding:.28rem .6rem" onclick="deleteReview('+r.id+')">Delete</button>'+
            '</div>':'<button class="bd" style="font-size:.72rem;padding:.28rem .6rem;margin-left:.8rem" onclick="deleteReview('+r.id+')">Delete</button>')+
          '</div>'+
        '</div>';
      }).join('');
    }
    el.innerHTML=
      '<div style="max-width:620px">'+
      '<div style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:.8rem 1rem;margin-bottom:1rem;display:flex;justify-content:space-between;align-items:center">'+
        '<span style="font-weight:700;color:#e65100">⏳ Pending Approval ('+pending.length+')</span>'+
      '</div>'+
      reviewRows(pending,true)+
      '<div style="background:#e8f5e9;border:1px solid #a5d6a7;border-radius:8px;padding:.8rem 1rem;margin:1rem 0 .8rem;display:flex;justify-content:space-between;align-items:center">'+
        '<span style="font-weight:700;color:#2e7d32">✅ Approved & Live ('+approved.length+')</span>'+
      '</div>'+
      reviewRows(approved,false)+
      '</div>';
  }).catch(function(){el.innerHTML='<div style="padding:2rem;color:#c0392b">Failed to load reviews.</div>';});
}
function approveReview(id){
  apiFetch('reviews.php','PUT',{id:id,status:'approved'}).then(function(){
    rAdminReviews(document.getElementById('acnt'));
    loadReviews();
  });
}
function deleteReview(id){
  if(!confirm('Delete this review?'))return;
  apiFetch('reviews.php','DELETE',{id:id}).then(function(){
    rAdminReviews(document.getElementById('acnt'));
    loadReviews();
  });
}

function rCats(el){
  var listHtml=CATS.map(function(cat,i){
    var count=PRODS.filter(function(p){return p.cat===cat;}).length;
    // Compute prefix and next available SKU for this category
    var prefix=(CAT_PREFIXES&&CAT_PREFIXES[cat])?CAT_PREFIXES[cat]:cat.replace(/[^A-Za-z]/g,'').substring(0,3).toUpperCase();
    var existing=PRODS.filter(function(p){return p.sku&&p.sku.indexOf(prefix)===0;})
      .map(function(p){return parseInt(p.sku.replace(prefix,''))||0;});
    var autoNum=(existing.length>0?Math.max.apply(null,existing):0)+1;
    var overrideNum=(CAT_PREFIXES&&CAT_PREFIXES[cat+'__next']!==undefined)?parseInt(CAT_PREFIXES[cat+'__next']):null;
    var nextNum=(overrideNum!==null)?overrideNum:autoNum;
    var nextSku=prefix+String(nextNum).padStart(3,'0');
    return '<div style="display:flex;align-items:center;gap:.6rem;padding:.55rem .7rem;background:#fff;border:1px solid #e8e0b8;border-radius:8px;margin-bottom:.5rem">'+
      '<span style="flex:1;font-weight:600;font-size:.88rem;color:#2d2220">'+cat+'</span>'+
      '<span class="badge bb" style="font-size:.72rem">'+count+' product'+(count!==1?'s':'')+'</span>'+
      '<span style="font-size:.72rem;font-family:monospace;color:#6b6040;background:#f5f5f5;border:1px solid #ddd;border-radius:4px;padding:1px 6px" title="SKU prefix">'+prefix+'</span>'+
      '<span style="font-size:.72rem;font-family:monospace;color:#a07810;background:#fffdf0;border:1px solid #e8e0b8;border-radius:4px;padding:1px 6px" title="Next available SKU">'+nextSku+'</span>'+
      '<button class="be" style="font-size:.72rem" onclick="editCat('+i+')">✏️ Edit</button>'+
      '<button class="bd" style="font-size:.72rem" onclick="deleteCat('+i+')">Delete</button>'+
    '</div>';
  }).join('');
  el.innerHTML=
    '<div style="max-width:500px">'+
    '<div style="background:#fff;border:1px solid #e8e0b8;border-radius:10px;padding:1.2rem;margin-bottom:1rem">'+
      '<div style="font-weight:700;margin-bottom:.9rem">🏷️ Product Categories</div>'+
      '<div id="cat-list">'+listHtml+'</div>'+
      '<div style="display:flex;gap:.5rem;margin-top:.8rem">'+
        '<input id="new-cat" class="afi" placeholder="New category name" style="margin-bottom:0">'+
        '<button class="bp" style="white-space:nowrap" onclick="addCat()">+ Add</button>'+
      '</div>'+
      '<div class="aok" id="cat-ok" style="margin-top:.6rem">✓ Categories updated!</div>'+
    '</div>'+
    '<div style="background:#fffdf0;border:1px solid #e8e0b8;border-radius:8px;padding:.75rem 1rem;font-size:.8rem;color:#6b6040;line-height:1.6">'+
    'Category changes apply immediately to the shop filter bar and product form dropdown.'+
    '</div></div>';
}
function addCat(){
  var inp=document.getElementById('new-cat');
  var name=inp.value.trim();
  if(!name){alert('Enter a category name.');return;}
  if(CATS.indexOf(name)>=0){alert('Category already exists.');return;}
  CATS.push(name);
  inp.value='';
  if(CAT_PREFIXES){var ap=name.replace(/[^A-Za-z]/g,'').substring(0,3).toUpperCase();CAT_PREFIXES[name]=ap;}
  apiFetch('admin.php','POST',{action:'save_setting',key:'product_categories',value:JSON.stringify(CATS)}).catch(function(){});
  apiFetch('admin.php','POST',{action:'save_setting',key:'cat_prefixes',value:JSON.stringify(CAT_PREFIXES)}).catch(function(){});
  rCats(document.getElementById('acnt'));
  renderCatFilter();
  showCatOk();
}
function editCat(idx){
  var cat=CATS[idx];
  var prefix=(CAT_PREFIXES&&CAT_PREFIXES[cat])?CAT_PREFIXES[cat]:cat.replace(/[^A-Za-z]/g,'').substring(0,3).toUpperCase();
  // Compute current next SKU number
  var existing=PRODS.filter(function(p){return p.sku&&p.sku.indexOf(prefix)===0;})
    .map(function(p){return parseInt(p.sku.replace(prefix,''))||0;});
  var autoNext=(existing.length>0?Math.max.apply(null,existing):0)+1;
  var overrideNum=(CAT_PREFIXES&&CAT_PREFIXES[cat+'__next']!==undefined)?CAT_PREFIXES[cat+'__next']:null;
  var nextVal=(overrideNum!==null)?overrideNum:autoNext;
  // Remove any existing edit form
  var old=document.getElementById('cat-edit-row');if(old)old.remove();
  var div=document.createElement('div');
  div.id='cat-edit-row';
  div.style.cssText='background:#fffdf0;border:1.5px solid #a07810;border-radius:8px;padding:.8rem;margin-bottom:.5rem';
  div.innerHTML=
    '<div style="font-size:.75rem;font-weight:700;color:#a07810;margin-bottom:.6rem">Edit Category</div>'+
    '<div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:flex-end">'+
      '<div><label style="font-size:.72rem;color:#6b6040;display:block;margin-bottom:2px">Name</label>'+
      '<input id="cat-edit-name" class="afi" value="'+cat+'" style="margin:0;width:160px"></div>'+
      '<div><label style="font-size:.72rem;color:#6b6040;display:block;margin-bottom:2px">SKU Prefix</label>'+
      '<input id="cat-edit-sku" class="afi" value="'+prefix+'" maxlength="4" placeholder="TOT" style="margin:0;width:70px;font-family:monospace;text-transform:uppercase"></div>'+
      '<div><label style="font-size:.72rem;color:#6b6040;display:block;margin-bottom:2px">Next # <span style="font-weight:400;color:#aaa">(auto: '+autoNext+')</span></label>'+
      '<input id="cat-edit-next" class="afi" type="number" min="1" value="'+nextVal+'" style="margin:0;width:70px"></div>'+
      '<div style="display:flex;gap:.4rem;align-self:flex-end">'+
        '<button class="bp" style="font-size:.78rem" onclick="saveCatEdit('+idx+')">💾 Save</button>'+
        '<button class="bs" style="font-size:.78rem" onclick="document.getElementById(\'cat-edit-row\').remove()">Cancel</button>'+
      '</div>'+
    '</div>';
  var list=document.getElementById('cat-list');
  list.insertBefore(div, list.children[idx]||null);
  document.getElementById('cat-edit-name').focus();
}
function saveCatEdit(idx){
  var oldName  = CATS[idx];
  var newName  = document.getElementById('cat-edit-name').value.trim();
  var newPrefix= document.getElementById('cat-edit-sku').value.trim().toUpperCase().replace(/[^A-Z]/g,'').substring(0,4);
  if(!newName){alert('Name cannot be empty.');return;}
  if(newName!==oldName&&CATS.indexOf(newName)>=0){alert('Category already exists.');return;}
  var oldPrefix=(CAT_PREFIXES&&CAT_PREFIXES[oldName])?CAT_PREFIXES[oldName]:oldName.replace(/[^A-Za-z]/g,'').substring(0,3).toUpperCase();
  CATS[idx]=newName;
  // Update CAT_PREFIXES including next number override
  var nextNum=parseInt(document.getElementById('cat-edit-next').value)||0;
  if(CAT_PREFIXES){
    delete CAT_PREFIXES[oldName];
    delete CAT_PREFIXES[oldName+'__next'];
    CAT_PREFIXES[newName]=newPrefix||oldPrefix;
    if(nextNum>=1)CAT_PREFIXES[newName+'__next']=nextNum;
  }
  var saves=[];
  for(var i=0;i<PRODS.length;i++){
    if(PRODS[i].cat===oldName){
      PRODS[i].cat=newName;
      // Update SKU prefix on products that used the old prefix
      if(newPrefix&&newPrefix!==oldPrefix&&PRODS[i].sku&&PRODS[i].sku.indexOf(oldPrefix)===0){
        PRODS[i].sku=newPrefix+PRODS[i].sku.slice(oldPrefix.length);
      }
      saves.push(apiFetch('products.php','POST',PRODS[i]));
    }
  }
  // Persist both CATS and CAT_PREFIXES to settings
  saves.push(apiFetch('admin.php','POST',{action:'save_setting',key:'product_categories',value:JSON.stringify(CATS)}));
  saves.push(apiFetch('admin.php','POST',{action:'save_setting',key:'cat_prefixes',value:JSON.stringify(CAT_PREFIXES)}));
  Promise.all(saves).then(function(){
    renderStore();
    rCats(document.getElementById('acnt'));
    renderCatFilter();
    showCatOk();
  }).catch(function(){
    rCats(document.getElementById('acnt'));
    renderCatFilter();
    showCatOk();
  });
}
function deleteCat(idx){
  var name=CATS[idx];
  var count=PRODS.filter(function(p){return p.cat===name;}).length;
  if(count>0&&!confirm('Delete category "'+name+'"? '+count+' product(s) will have no category.'))return;
  CATS.splice(idx,1);
  if(ACTIVE_CAT===name){ACTIVE_CAT='All';}
  if(CAT_PREFIXES){delete CAT_PREFIXES[name];}
  apiFetch('admin.php','POST',{action:'save_setting',key:'product_categories',value:JSON.stringify(CATS)}).catch(function(){});
  apiFetch('admin.php','POST',{action:'save_setting',key:'cat_prefixes',value:JSON.stringify(CAT_PREFIXES)}).catch(function(){});
  rCats(document.getElementById('acnt'));
  renderCatFilter();
  showCatOk();
}
function showCatOk(){
  var ok=document.getElementById('cat-ok');
  if(ok){ok.style.display='block';setTimeout(function(){ok.style.display='none';},2000);}
}

function rShipping(el){
  // Always fetch fresh config from DB first
  apiFetch('admin.php','POST',{action:'get_setting',key:'shipping_config'}).then(function(d){
    if(d.success&&d.value){try{applyShippingConfig(JSON.parse(d.value));}catch(e){}}
    _rShippingRender(el);
  }).catch(function(){_rShippingRender(el);});
}
function _rShippingRender(el){
  // Pull current zone config from SHIP_ZONES and ZONE_RATES
  var zoneNames=['','Tennessee','South','East Coast','Midwest','West'];
  var zoneColors=['','#e8f5e9','#e3f2fd','#fff8e1','#f3e5f5','#fce4ec'];

  // Build zones display - group states by zone
  var zoneStates=[[],[],[],[],[],[]];
  Object.keys(SHIP_ZONES).forEach(function(st){zoneStates[SHIP_ZONES[st]].push(st);});
  for(var z=1;z<=5;z++)zoneStates[z].sort();

  var zonesHtml='';
  for(var z=1;z<=5;z++){
    zonesHtml+=
      '<div style="background:#fff;border:1px solid #e8e0b8;border-radius:10px;padding:1.1rem;margin-bottom:.9rem">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.8rem">'+
        '<div style="font-weight:700;font-size:.95rem;color:#2d2220">Zone '+z+' &mdash; '+zoneNames[z]+'</div>'+
        '<div style="display:flex;align-items:center;gap:.5rem">'+
          '<span style="font-size:.78rem;color:#6b6040">Rate:</span>'+
          '<input id="zrate-'+z+'" type="number" step="0.01" min="0" value="'+ZONE_RATES[z]+'" '+
          'style="width:70px;padding:.3rem .5rem;border:1.5px solid #e8e0b8;border-radius:6px;font-size:.85rem;text-align:center">'+
        '</div>'+
      '</div>'+
      '<div style="font-size:.78rem;font-weight:600;color:#6b6040;margin-bottom:.4rem">States:</div>'+
      '<div id="zone-states-'+z+'" style="display:flex;flex-wrap:wrap;gap:.3rem;margin-bottom:.7rem">'+
        zoneStates[z].map(function(st){
          return '<span style="background:#fffdf0;border:1px solid #e8e0b8;border-radius:4px;padding:.15rem .45rem;font-size:.75rem;font-family:monospace">'+st+
            '<button onclick="removeState(\''+st+'\','+z+')" style="background:none;border:none;cursor:pointer;color:#c0392b;font-size:.75rem;margin-left:3px;padding:0;line-height:1">&times;</button></span>';
        }).join('')+
      '</div>'+
      '<div style="display:flex;gap:.4rem">'+
        '<input id="zadd-'+z+'" type="text" maxlength="2" placeholder="ST" '+
        'style="width:55px;padding:.32rem .5rem;border:1.5px solid #e8e0b8;border-radius:6px;font-size:.82rem;text-transform:uppercase;text-align:center">'+
        '<button class="bp" style="font-size:.75rem;padding:.32rem .7rem" onclick="addState('+z+')">+ Add State</button>'+
      '</div>'+
    '</div>';
  }

  el.innerHTML=
    '<div style="max-width:700px">'+
    '<div style="background:#fffdf0;border:1px solid #e8e0b8;border-radius:8px;padding:.8rem 1rem;font-size:.82rem;color:#6b6040;margin-bottom:1.2rem;line-height:1.6">'+
    'Changes here update shipping rates immediately. Click <strong>Save Changes</strong> to make them permanent.</div>'+

    '<div style="background:#fff;border:1px solid #e8e0b8;border-radius:10px;padding:1.1rem;margin-bottom:.9rem">'+
      '<div style="font-weight:700;margin-bottom:.7rem">Free Shipping Threshold</div>'+
      '<div style="display:flex;align-items:center;gap:.6rem;font-size:.88rem">'+
        '<span style="color:#6b6040">Orders over</span>'+
        '<input id="free-thresh" type="number" step="1" min="0" value="'+FREE_THRESHOLD+'" '+
        'style="width:75px;padding:.38rem .6rem;border:1.5px solid #e8e0b8;border-radius:6px;font-size:.88rem;text-align:center">'+
        '<span style="color:#6b6040">get free shipping</span>'+
      '</div>'+
    '</div>'+

    '<div style="font-weight:700;margin-bottom:.7rem;font-size:.88rem;text-transform:uppercase;letter-spacing:.06em;color:#a07810">Shipping Charges by Zone</div>'+
    zonesHtml+

    '<div style="background:#fff;border:1px solid #e8e0b8;border-radius:10px;padding:1.1rem;margin-bottom:.9rem">'+
      '<div style="font-weight:700;margin-bottom:.3rem">Weight Surcharges</div>'+
      '<div style="font-size:.78rem;color:#6b6040;margin-bottom:.8rem">Added on top of the zone rate based on total cart weight.</div>'+
      '<table style="font-size:.83rem;width:100%;border-collapse:collapse">'+
      '<thead><tr>'+
        '<th style="text-align:left;padding:.4rem .6rem;color:#6b6040;border-bottom:1px solid #e8e0b8">Min (lbs)</th>'+
        '<th style="text-align:left;padding:.4rem .6rem;color:#6b6040;border-bottom:1px solid #e8e0b8">Max (lbs)</th>'+
        '<th style="text-align:right;padding:.4rem .6rem;color:#6b6040;border-bottom:1px solid #e8e0b8">Surcharge ($)</th>'+
        '<th style="border-bottom:1px solid #e8e0b8"></th>'+
      '</tr></thead>'+
      '<tbody id="weight-tiers-body">'+
      WEIGHT_TIERS.map(function(t,i){
        return '<tr>'+
          '<td style="padding:.4rem .5rem"><input type="number" step="0.1" min="0" value="'+t.min+'" '+
            'onchange="updateTier('+i+',\'min\',this.value)" '+
            'style="width:65px;padding:.25rem .4rem;border:1.5px solid #e8e0b8;border-radius:5px;font-size:.8rem;text-align:center"></td>'+
          '<td style="padding:.4rem .5rem"><input type="number" step="0.1" min="0" value="'+(t.max===null?'':t.max)+'" placeholder="&infin;" '+
            'onchange="updateTier('+i+',\'max\',this.value)" '+
            'style="width:65px;padding:.25rem .4rem;border:1.5px solid #e8e0b8;border-radius:5px;font-size:.8rem;text-align:center"></td>'+
          '<td style="padding:.4rem .5rem;text-align:right"><input type="number" step="0.01" min="0" value="'+t.charge+'" '+
            'onchange="updateTier('+i+',\'charge\',this.value)" '+
            'style="width:65px;padding:.25rem .4rem;border:1.5px solid #e8e0b8;border-radius:5px;font-size:.8rem;text-align:center"></td>'+
          '<td style="padding:.4rem .5rem;text-align:center">'+
            (WEIGHT_TIERS.length>1?'<button onclick="deleteTier('+i+')" style="background:none;border:none;cursor:pointer;color:#c0392b;font-size:.9rem">🗑</button>':'')+
          '</td>'+
        '</tr>';
      }).join('')+
      '</tbody></table>'+
      '<button class="bs" style="font-size:.76rem;margin-top:.6rem;padding:.3rem .7rem" onclick="addTier()">+ Add Tier</button>'+
    '</div>'+

    '<div style="display:flex;gap:.6rem">'+
      '<button class="bp" onclick="saveShipping()">💾 Save Changes</button>'+
      '<button class="bs" onclick="rShipping(document.getElementById(\'acnt\'))">↺ Reset</button>'+
    '</div>'+
    '<div class="aok" id="ship-ok" style="margin-top:.7rem">✓ Shipping settings saved!</div>'+
    '</div>';
}

function removeState(st,zone){
  if(SHIP_ZONES[st]===zone)delete SHIP_ZONES[st];
  rShipping(document.getElementById('acnt'));
}
function addState(zone){
  var inp=document.getElementById('zadd-'+zone);
  var st=inp.value.trim().toUpperCase();
  if(!st||st.length!==2){alert('Enter a 2-letter state code (e.g. CA)');return;}
  SHIP_ZONES[st]=zone;
  inp.value='';
  rShipping(document.getElementById('acnt'));
}
function updateTier(idx,field,val){
  if(!WEIGHT_TIERS[idx])return;
  if(field==='min'||field==='max'||field==='charge'){
    if(field==='max')WEIGHT_TIERS[idx].max=val===''||val===null?null:parseFloat(val);
    else WEIGHT_TIERS[idx][field]=parseFloat(val)||0;
  }
}
function deleteTier(idx){
  WEIGHT_TIERS.splice(idx,1);
  rShipping(document.getElementById('acnt'));
}
function addTier(){
  WEIGHT_TIERS.push({min:0,max:null,charge:0});
  rShipping(document.getElementById('acnt'));
}
function saveShipping(){
  // Read ALL values directly from DOM — don't trust in-memory arrays
  var zoneRates=[0];
  for(var z=1;z<=5;z++){
    var el=document.getElementById('zrate-'+z);
    zoneRates.push(el?parseFloat(el.value)||0:ZONE_RATES[z]||0);
  }
  var ftEl=document.getElementById('free-thresh');
  var freeThresh=ftEl?parseFloat(ftEl.value)||75:FREE_THRESHOLD;
  var tiers=[];
  var rows=document.querySelectorAll('#weight-tiers-body tr');
  for(var r=0;r<rows.length;r++){
    var inputs=rows[r].querySelectorAll('input');
    if(inputs.length>=3){
      var maxVal=inputs[1].value.trim();
      tiers.push({min:parseFloat(inputs[0].value)||0,max:maxVal===''?null:parseFloat(maxVal),charge:parseFloat(inputs[2].value)||0});
    }
  }
  if(!tiers.length)tiers=WEIGHT_TIERS;
  // Update in-memory vars too
  ZONE_RATES=zoneRates;FREE_THRESHOLD=freeThresh;WEIGHT_TIERS=tiers;
  var config={zone_rates:zoneRates,free_threshold:freeThresh,weight_tiers:tiers};
  var btn=document.querySelector('#acnt button.bp');
  if(btn){btn.textContent='Saving…';btn.disabled=true;}
  apiFetch('admin.php','POST',{action:'save_setting',key:'shipping_config',value:JSON.stringify(config)})
  .then(function(d){
    if(d.message==='Setting saved'||d.success){
      var toast=document.createElement('div');
      toast.textContent='✓ Shipping settings saved!';
      toast.style.cssText='position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);background:#2e7d32;color:#fff;padding:.65rem 1.4rem;border-radius:24px;font-size:.85rem;font-family:sans-serif;font-weight:600;z-index:9999';
      document.body.appendChild(toast);
      setTimeout(function(){toast.remove();},3000);
    } else {
      alert('Save failed: '+(d.error||d.message||'unknown'));
    }
  }).catch(function(e){alert('Network error: '+e);});
}

function logFullScreen(title,text){
  var ov=document.createElement('div');
  ov.id='log-fs-ov';
  ov.style.cssText='position:fixed;inset:0;z-index:9999;background:#1e1e1e;display:flex;flex-direction:column';
  var bar=document.createElement('div');
  bar.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:.6rem 1rem;background:#2d2220;flex-shrink:0';
  var closeBtn=document.createElement('button');
  closeBtn.textContent='X Close';
  closeBtn.style.cssText='background:rgba(255,255,255,.15);border:none;color:#fff;font-size:.82rem;padding:4px 14px;border-radius:5px;cursor:pointer';
  closeBtn.onclick=function(){ov.remove();};
  var titleEl=document.createElement('span');
  titleEl.style.cssText='color:#ffe082;font-weight:700;font-size:.9rem';
  titleEl.textContent=title;
  bar.appendChild(titleEl);
  bar.appendChild(closeBtn);
  var pre=document.createElement('pre');
  pre.style.cssText='flex:1;overflow:auto;margin:0;padding:1.2rem;font-size:.78rem;line-height:1.7;color:#d4d4d4;white-space:pre-wrap;word-break:break-all';
  pre.textContent=text;
  ov.appendChild(bar);
  ov.appendChild(pre);
  document.body.appendChild(ov);
}

function _logPanel(id,title,file,content){
  return '<div style="margin-bottom:1.4rem">'+
    '<div style="font-weight:700;font-size:.85rem;text-transform:uppercase;letter-spacing:.06em;color:#a07810;margin-bottom:.3rem">'+title+'</div>'+
    '<div style="font-size:.72rem;color:#6b6040;margin-bottom:.4rem">Double-click to view full screen</div>'+
    '<pre id="pre-'+id+'" style="background:#1e1e1e;color:#d4d4d4;padding:1rem 1.2rem;border-radius:8px;font-size:.75rem;'+
    'line-height:1.7;overflow-x:auto;max-height:280px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;cursor:pointer" '+
    'title="Double-click to expand">'+escHtml(content)+'</pre>'+
  '</div>';
}

function rLogs(el){
  el.innerHTML='<div style="padding:2rem;text-align:center;color:#6b6040">Loading logs…</div>';
  Promise.all([
    apiFetch('admin.php','POST',{action:'read_log',file:'notify_log.txt'}),
    apiFetch('admin.php','POST',{action:'read_log',file:'webhook_log.txt'}),
    apiFetch('admin.php','POST',{action:'read_log',file:'error_log.txt'})
  ]).then(function(results){
    var notifyLog  = results[0].content||'No entries yet.';
    var webhookLog = results[1].content||'No entries yet.';
    var errorLog   = results[2].content||'No entries yet.';
    window._logNotify  = notifyLog;
    window._logWebhook = webhookLog;
    window._logError   = errorLog;
    el.innerHTML=
      '<div style="max-width:860px">'+
      '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.6rem;flex-wrap:wrap">'+
        '<button class="bs" style="font-size:.78rem" onclick="clearLog(\'notify_log.txt\')">&#x1F5D1; Clear Notify</button>'+
        '<button class="bs" style="font-size:.78rem" onclick="clearLog(\'webhook_log.txt\')">&#x1F5D1; Clear Webhook</button>'+
        '<button class="bs" style="font-size:.78rem" onclick="clearLog(\'error_log.txt\')">&#x1F5D1; Clear Error</button>'+
        '<button class="bp" style="font-size:.78rem" onclick="rLogs(document.getElementById(\'acnt\'))">&#x21BA; Refresh</button>'+
      '</div>'+
      '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:1rem;flex-wrap:wrap;background:#fdfbf0;border:1px solid #e8e0b8;border-radius:8px;padding:.6rem .8rem">'+
        '<select id="log-email-file" style="font-size:.78rem;border:1px solid #e8e0b8;border-radius:5px;padding:.3rem .5rem;background:#fff;color:#2d2220">'+
          '<option value="notify_log.txt">notify_log.txt</option>'+
          '<option value="webhook_log.txt">webhook_log.txt</option>'+
          '<option value="error_log.txt">error_log.txt</option>'+
        '</select>'+
        '<input id="log-email-to" type="email" placeholder="Email address" style="font-size:.78rem;border:1px solid #e8e0b8;border-radius:5px;padding:.3rem .6rem;flex:1;min-width:180px;color:#2d2220">'+
        '<button class="bp" style="font-size:.78rem" onclick="emailLog()">&#x2709; Email Log</button>'+
        '<span id="log-email-msg" style="font-size:.75rem;color:#6b6040"></span>'+
      '</div>'+
      _logPanel('notify', 'Order Notification Log (notify_log.txt)',   'notify_log.txt',  notifyLog)+
      _logPanel('webhook','Square Webhook Log (webhook_log.txt)',       'webhook_log.txt', webhookLog)+
      _logPanel('error',  'Debug Error Log (error_log.txt)',            'error_log.txt',   errorLog)+
      '</div>';
    var pn=document.getElementById('pre-notify');
    var pw=document.getElementById('pre-webhook');
    var pe=document.getElementById('pre-error');
    if(pn)pn.addEventListener('dblclick',function(){logFullScreen('notify_log.txt',notifyLog);});
    if(pw)pw.addEventListener('dblclick',function(){logFullScreen('webhook_log.txt',webhookLog);});
    if(pe)pe.addEventListener('dblclick',function(){logFullScreen('error_log.txt',errorLog);});
  }).catch(function(){
    el.innerHTML='<div style="padding:2rem;color:#c0392b">Failed to load logs.</div>';
  });
}
function escHtml(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function clearLog(file){
  if(!confirm('Clear '+file+'? This cannot be undone.'))return;
  apiFetch('admin.php','POST',{action:'clear_log',file:file}).then(function(){
    rLogs(document.getElementById('acnt'));
  });
}

function emailLog(){
  var file = (document.getElementById('log-email-file')||{}).value;
  var to   = ((document.getElementById('log-email-to')||{}).value||'').trim();
  var msg  = document.getElementById('log-email-msg');
  if(!file){if(msg)msg.textContent='Select a log file.';return;}
  if(!to){if(msg)msg.textContent='Enter an email address.';return;}
  if(msg){msg.style.color='#6b6040';msg.textContent='Sending...';}
  apiFetch('admin.php','POST',{action:'send_log',file:file,to:to}).then(function(d){
    if(msg){
      if(d.success){msg.style.color='#2e7d32';msg.textContent='Sent to '+to;}
      else{msg.style.color='#c62828';msg.textContent='Failed: '+(d.error||'unknown');}
    }
  }).catch(function(e){if(msg){msg.style.color='#c62828';msg.textContent='Error: '+e.message;}});
}







function setSquareMode(mode){
  SQUARE_MODE=mode;
  // Save to DB so all browsers see the same mode
  apiFetch('admin.php','POST',{action:'save_setting',key:'square_mode',value:mode}).catch(function(){});
  // Show banner in admin header if in test mode
  // Toggle test-mode class on apanel for CSS red stripe
  var panel=document.getElementById('apanel');
  if(panel){if(mode==='test')panel.classList.add('test-mode');else panel.classList.remove('test-mode');}
  rSettings(document.getElementById('acnt'));
}
function rSettings(el){
  var modeColor=SQUARE_MODE==='test'?'#fff8e1':'#e8f5e9';
  var modeBorder=SQUARE_MODE==='test'?'#ffe082':'#a5d6a7';
  var modeText=SQUARE_MODE==='test'?'TEST MODE — No real payments':'LIVE MODE — Real payments active';
  var modeTextColor=SQUARE_MODE==='test'?'#e65100':'#2e7d32';
  el.innerHTML='<div style="max-width:420px">'+
  '<div style="background:'+modeColor+';border:2px solid '+modeBorder+';border-radius:10px;padding:1.2rem;margin-bottom:1.2rem">'+
    '<div style="font-weight:700;margin-bottom:.5rem;color:'+modeTextColor+'">'+modeText+'</div>'+
    '<div style="font-size:.8rem;color:#6b6040;margin-bottom:.9rem;line-height:1.6">'+
      (SQUARE_MODE==='test'?'Square sandbox is active. Use test card <strong>4111 1111 1111 1111</strong>, any future date, any CVV.':'Live mode active. Real customer cards will be charged.')+
    '</div>'+
    '<div style="display:flex;gap:.6rem">'+
      '<button class="bp" style="background:'+(SQUARE_MODE==='live'?'#2e7d32':'#d4a017')+';font-size:.82rem" onclick="setSquareMode(\'live\')">Switch to Live</button>'+
      '<button class="bp" style="background:'+(SQUARE_MODE==='test'?'#e65100':'#6b6040')+';font-size:.82rem" onclick="setSquareMode(\'test\')">Switch to Test</button>'+
    '</div>'+
  '</div>'+
  '<div style="background:#fff;border-radius:10px;border:1px solid #e8e0b8;padding:1.2rem;margin-bottom:1.2rem">'+
    '<div style="font-weight:700;margin-bottom:.9rem">Change Admin Password</div>'+
    '<div class="aok" id="pw-ok">Password updated!</div><div class="aerr" id="pw-err"></div>'+
    '<input class="afi" id="pw-c" type="password" placeholder="Current password">'+
    '<input class="afi" id="pw-n" type="password" placeholder="New password">'+
    '<input class="afi" id="pw-cf" type="password" placeholder="Confirm new password">'+
    '<button class="bp" onclick="chPw()">Update Password</button>'+
  '</div>'+
  '<div style="background:#fff;border-radius:10px;border:1px solid #e8e0b8;padding:1.2rem;margin-bottom:1.2rem">'+
    '<div style="font-weight:700;margin-bottom:.9rem">Password Reset — Security Question</div>'+
    (SEC?'<div style="background:#fffdf0;border:1px solid #e8e0b8;border-radius:7px;padding:.65rem;font-size:.8rem;color:#6b6040;margin-bottom:.8rem"><strong style="color:#a07810">Current:</strong> '+SEC.q+'</div>':'<div class="warn">No security question set yet.</div>')+
    '<div class="aok" id="sq-ok">Saved!</div><div class="aerr" id="sq-err"></div>'+
    '<select class="afi" id="sq-q"><option value="">— Choose a question —</option>'+
    ['What is the name of your first pet?','What city were you born in?',"What is your mother\'s maiden name?",'What was the name of your first school?','What was the make of your first car?','What street did you grow up on?'].map(function(q){return'<option'+(SEC&&SEC.q===q?' selected':'')+'>'+q+'</option>';}).join('')+
    '</select>'+
    '<input class="afi" id="sq-a" type="text" placeholder="Your answer (case-insensitive)">'+
    '<input class="afi" id="sq-a2" type="text" placeholder="Confirm answer">'+
    '<button class="bp" onclick="saveSQ()">'+(SEC?'Update':'Save')+' Security Question</button>'+
  '</div>'+
  '<div style="background:#fff;border-radius:10px;border:1px solid #e8e0b8;padding:1.2rem;margin-bottom:1.2rem">'+
    '<div style="font-weight:700;margin-bottom:.4rem">Square Transaction Fees</div>'+
    '<div style="font-size:.8rem;color:#6b6040;margin-bottom:.9rem;line-height:1.6">Used to calculate net revenue in Sales Report after Square fees.</div>'+
    '<div class="aok" id="sqfee-ok" style="display:none">Square fees saved!</div>'+
    '<div class="aerr" id="sqfee-err" style="display:none"></div>'+
    '<label class="fl">Transaction Percentage (%)</label>'+
    '<input class="afi" id="sqfee-pct" type="number" step="0.01" min="0" max="100" value="'+SQ_FEE_PCT+'" placeholder="e.g. 2.6">'+
    '<label class="fl">Per-Transaction Cost ($)</label>'+
    '<input class="afi" id="sqfee-cents" type="number" step="0.01" min="0" value="'+SQ_FEE_CENTS+'" placeholder="e.g. 0.10">'+
    '<div style="background:#fffdf0;border:1px solid #e8e0b8;border-radius:7px;padding:.65rem;font-size:.8rem;color:#6b6040;margin-bottom:.9rem">'+
      'Standard Square rate: <strong>2.6% + $0.10</strong> per online transaction'+
    '</div>'+
    '<button class="bp" onclick="saveSquareFees()">Save Fees</button>'+
  '</div>'+
  '<div style="background:#fff;border-radius:10px;border:1px solid #e8e0b8;padding:1.2rem">'+
    '<div style="font-weight:700;margin-bottom:.7rem">Store Info</div>'+
    '<div style="font-size:.84rem;color:#6b6040;line-height:2.1">'+
      '<div><strong style="color:#2d2220">Store:</strong> Handmade Designs By Suzi</div>'+
      '<div><strong style="color:#2d2220">Products:</strong> '+PRODS.length+'</div>'+
      '<div><strong style="color:#2d2220">Orders:</strong> '+ORDERS.length+'</div>'+
      '<div><strong style="color:#2d2220">Customers:</strong> '+CUSTS.length+'</div>'+
    '</div>'+
  '</div>'+
  '</div>';
}

function buildTaxGrid(){
  var states=Object.keys(TAX_RATES).sort();
  return states.map(function(st){
    return '<div style="display:flex;align-items:center;gap:.25rem">'+
      '<span style="font-size:.72rem;font-weight:700;color:#6b6040;width:26px;flex-shrink:0">'+st+'</span>'+
      '<input type="number" step="0.001" min="0" max="20" value="'+TAX_RATES[st]+'" '+
        'id="tax-'+st+'" '+
        'style="width:100%;padding:.2rem .35rem;border:1px solid #e8e0b8;border-radius:5px;font-size:.72rem;font-family:sans-serif;outline:none">'+
      '%</div>';
  }).join('');
}
function saveSquareFees(){
  var pct=parseFloat(document.getElementById('sqfee-pct').value);
  var cents=parseFloat(document.getElementById('sqfee-cents').value);
  var ok=document.getElementById('sqfee-ok');
  var err=document.getElementById('sqfee-err');
  ok.style.display='none';err.style.display='none';
  if(isNaN(pct)||pct<0||pct>100){err.textContent='Invalid percentage.';err.style.display='block';return;}
  if(isNaN(cents)||cents<0){err.textContent='Invalid per-transaction cost.';err.style.display='block';return;}
  SQ_FEE_PCT=pct;SQ_FEE_CENTS=cents;
  apiFetch('admin.php','POST',{action:'save_setting',key:'square_fees',value:JSON.stringify({pct:pct,cents:cents})})
  .then(function(d){
    if(d.message==='Setting saved'||d.success){ok.style.display='block';setTimeout(function(){ok.style.display='none';},2500);}
    else{err.textContent='Save failed.';err.style.display='block';}
  }).catch(function(){err.textContent='Network error.';err.style.display='block';});
}
function saveTaxRates(){
  var ok=document.getElementById('tax-ok');
  var err=document.getElementById('tax-err');
  ok.style.display='none';err.style.display='none';
  var states=Object.keys(TAX_RATES).sort();
  var newRates={};
  for(var i=0;i<states.length;i++){
    var inp=document.getElementById('tax-'+states[i]);
    if(inp){var v=parseFloat(inp.value);newRates[states[i]]=isNaN(v)?0:v;}
  }
  TAX_RATES=newRates;
  apiFetch('admin.php','POST',{action:'save_setting',key:'tax_rates',value:JSON.stringify(newRates)})
  .then(function(d){
    if(d.message==='Setting saved'||d.success){ok.style.display='block';setTimeout(function(){ok.style.display='none';},2500);}
    else{err.textContent='Save failed.';err.style.display='block';}
  }).catch(function(){err.textContent='Network error.';err.style.display='block';});
}
function resetDefaultTaxRates(){
  if(!confirm('Reset all rates to US state defaults?'))return;
  TAX_RATES={
    'AL':4,'AK':0,'AZ':5.6,'AR':6.5,'CA':7.25,'CO':2.9,'CT':6.35,'DE':0,
    'FL':6,'GA':4,'HI':4,'ID':6,'IL':6.25,'IN':7,'IA':6,'KS':6.5,
    'KY':6,'LA':4.45,'ME':5.5,'MD':6,'MA':6.25,'MI':6,'MN':6.875,'MS':7,
    'MO':4.225,'MT':0,'NE':5.5,'NV':6.85,'NH':0,'NJ':6.625,'NM':5.125,'NY':4,
    'NC':4.75,'ND':5,'OH':5.75,'OK':4.5,'OR':0,'PA':6,'RI':7,'SC':6,
    'SD':4.5,'TN':7,'TX':6.25,'UT':4.85,'VT':6,'VA':4.3,'WA':6.5,'WV':6,
    'WI':5,'WY':4,'DC':6
  };
  var grid=document.getElementById('tax-grid');
  if(grid)grid.innerHTML=buildTaxGrid();
}
function rSqPay(el){
  el.innerHTML='<div style="padding:2rem;text-align:center;color:#6b6040">Loading Square payments…</div>';
  sqPayLoad(el,'','','');
}
function sqPayLoad(el,begin,end,cursor){
  var url='square_payments.php';
  var p=[];
  if(begin) p.push('begin='+encodeURIComponent(begin));
  if(end)   p.push('end='+encodeURIComponent(end));
  if(cursor)p.push('cursor='+encodeURIComponent(cursor));
  if(p.length)url+='?'+p.join('&');
  apiFetch(url).then(function(d){
    if(!d.success){el.innerHTML='<div style="color:#c62828;padding:1rem">'+d.error+'</div>';return;}
    renderSqPayTable(el,d,begin,end);
  }).catch(function(e){
    el.innerHTML='<div style="color:#c62828;padding:1rem">Failed to load Square payments: '+e+'</div>';
  });
}
function renderSqPayTable(el,d,begin,end){
  SQ_PAY_EL=el; SQ_PAY_BEGIN=begin; SQ_PAY_END=end;
  SQ_PAY_DATA=d.payments||[];
  SQ_PAY_F={status:'',note:'',card:'',buyer:'',amount:'',tax:'',fee:'',net:'',created:''};
  var modeTag=d.mode==='test'?'<span style="background:#fff8e1;color:#e65100;font-size:.72rem;border-radius:4px;padding:1px 7px;font-weight:700;border:1px solid #ffe082;margin-left:.5rem">TEST MODE</span>':'';
  var totAmt=0,totFee=0,totTax=0,totNet=0;
  d.payments.forEach(function(p){if(p.status==='COMPLETED'){totAmt+=p.amount;totFee+=p.fee;totTax+=p.tax;totNet+=p.net;}});
  var statsHtml=
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.6rem;margin-bottom:1rem">'+
      '<div style="background:#fffdf0;border:1px solid #e8e0b8;border-radius:8px;padding:.7rem 1rem">'+
        '<div style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:#a07810;margin-bottom:.2rem">Charges'+modeTag+'</div>'+
        '<div style="font-weight:700;font-size:1.05rem;color:#2d2220">$'+totAmt.toFixed(2)+'</div>'+
      '</div>'+
      '<div style="background:#fffdf0;border:1px solid #e8e0b8;border-radius:8px;padding:.7rem 1rem">'+
        '<div style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:#a07810;margin-bottom:.2rem">Square Fees</div>'+
        '<div style="font-weight:700;font-size:1.05rem;color:#c62828">-$'+totFee.toFixed(2)+'</div>'+
      '</div>'+
      '<div style="background:#fffdf0;border:1px solid #e8e0b8;border-radius:8px;padding:.7rem 1rem">'+
        '<div style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:#a07810;margin-bottom:.2rem">Tax Collected</div>'+
        '<div style="font-weight:700;font-size:1.05rem;color:#2d2220">$'+totTax.toFixed(2)+'</div>'+
      '</div>'+
      '<div style="background:#fffdf0;border:1px solid #e8e0b8;border-radius:8px;padding:.7rem 1rem">'+
        '<div style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:#a07810;margin-bottom:.2rem">Net Revenue</div>'+
        '<div style="font-weight:700;font-size:1.05rem;color:#2e7d32">$'+totNet.toFixed(2)+'</div>'+
      '</div>'+
    '</div>';
  var formHtml=
    '<div style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:.7rem;margin-bottom:1rem">'+
      '<div><div style="font-size:.72rem;font-weight:700;color:#a07810;margin-bottom:.2rem;text-transform:uppercase">From</div>'+
        '<input type="date" id="sqp-from" value="'+(begin||'')+'" style="padding:.35rem .6rem;border:1.5px solid #e8e0b8;border-radius:7px;font-size:.83rem"></div>'+
      '<div><div style="font-size:.72rem;font-weight:700;color:#a07810;margin-bottom:.2rem;text-transform:uppercase">To</div>'+
        '<input type="date" id="sqp-to" value="'+(end||'')+'" style="padding:.35rem .6rem;border:1.5px solid #e8e0b8;border-radius:7px;font-size:.83rem"></div>'+
      '<button class="bp" style="font-size:.8rem" onclick="sqPayLoad(document.getElementById(\'acnt\'),document.getElementById(\'sqp-from\').value,document.getElementById(\'sqp-to\').value,\'\')">Search</button>'+
      '<button class="bs" style="font-size:.8rem" onclick="rSqPay(document.getElementById(\'acnt\'))">Reset</button>'+
      '<button class="bs" style="font-size:.8rem" onclick="sqPayExportCsv()">⬇️ Export CSV</button>'+
    '</div>';
  el.innerHTML='<div style="max-width:1100px">'+formHtml+statsHtml+'<div id="sqp-table-wrap"></div></div>';
  sqPayRenderTable();
}
var SQ_PAY_DATA=[];
var SQ_PAY_SORT={col:'created',dir:-1};
var SQ_PAY_F={status:'',note:'',card:'',buyer:'',amount:'',tax:'',fee:'',net:'',created:''};
var SQ_PAY_EL=null;
var SQ_PAY_BEGIN='';
var SQ_PAY_END='';
function sqPayRenderTable(){
  var wrap=document.getElementById('sqp-table-wrap');
  if(!wrap)return;
  var sqFiltVal=function(p,k){
    if(k==='card')return p.card_brand&&p.last4?(p.card_brand+'....'+p.last4):'--';
    if(k==='note')return p.note||'--';
    if(k==='status')return p.status||'--';
    if(k==='buyer')return p.buyer||'--';
    if(k==='amount')return '$'+p.amount.toFixed(2);
    if(k==='tax')return p.tax>0?'$'+p.tax.toFixed(2):'--';
    if(k==='fee')return '-$'+p.fee.toFixed(2);
    if(k==='net')return '$'+p.net.toFixed(2);
    if(k==='created'){var dt=p.created?new Date(p.created):'';return dt?dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'';}  
    return '';
  };
  var filt=SQ_PAY_DATA.filter(function(p){
    var keys=['status','note','card','buyer','amount','tax','fee','net','created'];
    for(var i=0;i<keys.length;i++){
      var k=keys[i];
      if(SQ_PAY_F[k]&&sqFiltVal(p,k)!==SQ_PAY_F[k])return false;
    }
    return true;
  });
  filt.sort(function(a,b){
    var av=a[SQ_PAY_SORT.col]||''; var bv=b[SQ_PAY_SORT.col]||'';
    if(typeof av==='number')return SQ_PAY_SORT.dir*(av-bv);
    return SQ_PAY_SORT.dir*String(av).localeCompare(String(bv));
  });
  var ths=[{k:'created',l:'Date / Time',f:true},{k:'note',l:'Order',f:true},{k:'status',l:'Status',f:true},{k:'amount',l:'Amount',f:true},{k:'tax',l:'Tax',f:true},{k:'fee',l:'Fee',f:true},{k:'net',l:'Net',f:true},{k:'card',l:'Card',f:true},{k:'buyer',l:'Buyer',f:true}];
  var hs=ths.map(function(col){
    var isSort=SQ_PAY_SORT.col===col.k;
    var arrow=isSort?(SQ_PAY_SORT.dir===1?'\u25b2':'\u25bc'):'\u25bf';
    var hasF=col.f&&SQ_PAY_F[col.k];
    return '<th style="background:#a07810;color:#fff;padding:0;white-space:nowrap">'+
      '<div style="display:flex;align-items:center;padding:5px 8px;gap:3px">'+
        '<span style="font-size:.75rem;font-weight:700;text-transform:uppercase">'+col.l+'</span>'+
        '<span style="font-size:.65rem;color:'+(isSort?'#ffe082':'rgba(255,255,255,.7)')+';cursor:pointer" onclick="sqPaySort(\''+col.k+'\')" title="Sort">'+arrow+'</span>'+
        (col.f?'<span style="font-size:.65rem;background:'+(hasF?'#ffe082':'rgba(255,255,255,.2)')+';color:'+(hasF?'#5a3e00':'#fff')+';border-radius:3px;padding:1px 4px;cursor:pointer" onclick="sqPayFilt(\''+col.k+'\')" title="Filter">\u25bc</span>':'')+
      '</div></th>';
  }).join('');
  var rows=filt.map(function(p){
    var dt=p.created?new Date(p.created):'';
    var dtStr=dt?dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+' '+dt.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true}):'--';
    var sc=p.status==='COMPLETED'?'#2e7d32':p.status==='FAILED'?'#c62828':'#6b6040';
    var card=p.card_brand&&p.last4?(p.card_brand+'....'+p.last4):'--';
    return '<tr>'+
      '<td style="padding:6px 10px;border-bottom:1px solid #f0e8d0;font-size:.78rem;color:#6b6040">'+dtStr+'</td>'+
      '<td style="padding:6px 10px;border-bottom:1px solid #f0e8d0;font-size:.75rem;font-family:monospace;color:#a07810">'+(p.note||'--')+'</td>'+
      '<td style="padding:6px 10px;border-bottom:1px solid #f0e8d0;font-size:.75rem;font-weight:600;color:'+sc+'">'+p.status+'</td>'+
      '<td style="padding:6px 10px;border-bottom:1px solid #f0e8d0;text-align:right;font-weight:700;color:#2d2220">$'+p.amount.toFixed(2)+'</td>'+
      '<td style="padding:6px 10px;border-bottom:1px solid #f0e8d0;text-align:right;color:#6b6040">'+(p.tax>0?'$'+p.tax.toFixed(2):'--')+'</td>'+
      '<td style="padding:6px 10px;border-bottom:1px solid #f0e8d0;text-align:right;color:#c62828">'+(p.fee_estimated?'<span title="Est">~</span>':'')+'-$'+p.fee.toFixed(2)+'</td>'+
      '<td style="padding:6px 10px;border-bottom:1px solid #f0e8d0;text-align:right;font-weight:700;color:#2e7d32">'+(p.fee_estimated?'<span title="Est">~</span>':'')+'$'+p.net.toFixed(2)+'</td>'+
      '<td style="padding:6px 10px;border-bottom:1px solid #f0e8d0;font-size:.75rem;color:#6b6040">'+card+'</td>'+
      '<td style="padding:6px 10px;border-bottom:1px solid #f0e8d0;font-size:.75rem;color:#6b6040">'+(p.buyer||'--')+'</td>'+
    '</tr>';
  }).join('');
  wrap.innerHTML=filt.length===0?
    '<div style="text-align:center;padding:2rem;color:#6b6040">No payments found.</div>':
    '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.83rem">'+
    '<thead><tr>'+hs+'</tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<div style="font-size:.78rem;color:#6b6040;margin-top:.5rem">'+filt.length+' of '+SQ_PAY_DATA.length+' payments</div>';
}
function sqPayExportCsv(){
  if(!SQ_PAY_DATA.length){alert('No payments to export.');return;}
  var headers=['Date/Time','Order','Status','Amount','Tax','Fee','Net','Card','Buyer'];
  var rows=[headers.join(',')];
  SQ_PAY_DATA.forEach(function(p){
    var dt=p.created?new Date(p.created):'';
    var dtStr=dt?dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+' '+dt.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true}):'';
    var card=p.card_brand&&p.last4?(p.card_brand+'....'+p.last4):'--';
    rows.push([
      '"'+dtStr+'"',
      '"'+(p.note||'').replace(/"/g,'""')+'"',
      '"'+p.status+'"',
      p.amount.toFixed(2),
      p.tax.toFixed(2),
      (-p.fee).toFixed(2),
      p.net.toFixed(2),
      '"'+card+'"',
      '"'+(p.buyer||'').replace(/"/g,'""')+'"'
    ].join(','));
  });
  var blob=new Blob([rows.join('\n')],{type:'text/csv'});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='square_payments_'+new Date().toISOString().slice(0,10)+'.csv';
  a.click();
}

function sqPaySort(col){
  if(SQ_PAY_SORT.col===col)SQ_PAY_SORT.dir*=-1;
  else{SQ_PAY_SORT.col=col;SQ_PAY_SORT.dir=-1;}
  sqPayRenderTable();
}
function sqPayFilt(col){
  // Build unique values for this column from full dataset
  var getVal=function(p,k){
    if(k==='card')return p.card_brand&&p.last4?(p.card_brand+'....'+p.last4):'--';
    if(k==='note')return p.note||'--';
    if(k==='status')return p.status||'--';
    if(k==='buyer')return p.buyer||'--';
    if(k==='amount')return '$'+p.amount.toFixed(2);
    if(k==='tax')return p.tax>0?'$'+p.tax.toFixed(2):'--';
    if(k==='fee')return '-$'+p.fee.toFixed(2);
    if(k==='net')return '$'+p.net.toFixed(2);
    if(k==='created'){var dt=p.created?new Date(p.created):'';return dt?dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'';}  
    return '';
  };
  var seen={};
  SQ_PAY_DATA.forEach(function(p){var v=getVal(p,col);if(v)seen[v]=true;});
  var vals=Object.keys(seen).sort();
  // Remove existing dropdown
  var existing=document.getElementById('sqp-filt-drop');
  if(existing){existing.parentNode.removeChild(existing);return;}
  // Find the filter button element
  var btn=event.target;
  var rect=btn.getBoundingClientRect();
  var drop=document.createElement('div');
  drop.id='sqp-filt-drop';
  drop.style.cssText='position:fixed;z-index:9999;background:#fff;border:1.5px solid #e8e0b8;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.13);min-width:160px;max-height:280px;overflow-y:auto;top:'+(rect.bottom+4)+'px;left:'+rect.left+'px';
  var opts=['<div style="padding:6px 12px;font-size:.78rem;color:#6b6040;border-bottom:1px solid #f0e8d0;cursor:pointer;font-style:italic" onclick="SQ_PAY_F[\''+col+'\''+']=\'\';document.getElementById(\'sqp-filt-drop\').remove();sqPayRenderTable()">— Show All —</div>'];
  vals.forEach(function(v){
    var active=SQ_PAY_F[col]===v;
    opts.push('<div style="padding:6px 12px;font-size:.78rem;cursor:pointer;background:'+(active?'#fff3cd':'#fff')+';color:#2d2220" '+
      'onmouseover="this.style.background=\'#fffdf0\'" onmouseout="this.style.background=\''+(active?'#fff3cd':'#fff')+'\'' +'" '+
      'onclick="SQ_PAY_F[\''+col+'\''+']=\''+v.replace(/'/g,"\\'")+'\';document.getElementById(\'sqp-filt-drop\').remove();sqPayRenderTable()">'+
      (active?'<b>'+v+'</b>':v)+'</div>');
  });
  drop.innerHTML=opts.join('');
  document.body.appendChild(drop);
  // Close on outside click
  setTimeout(function(){
    document.addEventListener('click',function _c(e){
      if(!drop.contains(e.target)){drop.remove();document.removeEventListener('click',_c);}
    });
  },10);
}
