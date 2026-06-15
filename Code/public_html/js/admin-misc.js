// ── Regression test globals ──
var RT_GROUPS={
  'DB Schema':['orders.tax_amount','orders.tax_swept_date','orders.payment_method','orders.customer_email','orders.total','orders.shipping_carrier','orders.tracking_number','orders.square_payment_id','products.sku','products.img1','products.price','products.name','products.stock','products.weight','orders table','products table','order_items table','settings table','tax_sweeps table','settings LONGTEXT','tax_swept removed'],
  'Data Integrity':['products exist','orders exist','settings exist','square_mode set','shipping_config','biz_profile','products have SKUs','no duplicate SKUs','product descriptions updated','hero.jpg exists','shop.css has /hero.jpg','store.js has sold-out diagonal','orders.php decrements stock','send_shipping uses EDT','send_confirm uses EDT'],
  'Required Files':['api/config.php','api/admin.php','api/orders.php','api/products.php','api/tax_sweep.php','api/square_payments.php','api/email_log.php','api/fetch_tax.php','mailer.php','checkout.php','send_confirm.php','send_shipping.php','index.html','css/shop.css','js/api.js','js/config.js','js/store.js','js/admin-orders.js','js/admin-misc.js'],
  'JS Functions':['JS:openCheckout','JS:placeOrder','JS:renderOrdersTable','JS:viewOrder','JS:showManualOrderForm','JS:sendConfirmEmail','JS:rSweep','JS:rSqPay','JS:applyShippingConfig','JS:rBizProfile','JS:buildAdminNav','JS:saveNavOrder','JS:rRegTest','JS:runRegTests','JS:cancelRegTests','JS:SQ_FEE_PCT','JS:TAX_RATES','JS:admin-nav','JS:updCarrier','JS:updTracking','JS:deleteOrder','JS:sendShippingEmail','JS:pfNextSku','JS:pfAutoSku','JS:fetchOrderTax']
};
function rtBuildSkeleton(){
  var html='';
  for(var grp in RT_GROUPS){
    html+='<div style="background:#fff;border:1px solid #e8e0b8;border-radius:10px;margin-bottom:.8rem;overflow:hidden">'+
      '<div style="background:#f9f4e4;padding:.6rem 1rem;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#a07810;border-bottom:1px solid #e8e0b8">'+grp+'</div>';
    RT_GROUPS[grp].forEach(function(t){
      var key=t.replace(/[^a-z0-9]/gi,'_');
      html+='<div id="ico-'+key+'" style="display:flex;align-items:center;gap:.8rem;padding:.45rem 1rem;border-bottom:.5px solid #f5efe0;font-size:.83rem">'+
        '<div class="rt-ico" style="width:18px;height:18px;border-radius:50%;background:#f5f5f5;color:#999;display:flex;align-items:center;justify-content:center;font-size:.75rem;flex-shrink:0;font-weight:700">—</div>'+
        '<span style="flex:1">'+t+'</span>'+
        '<span id="det-'+key+'" style="font-size:.75rem;color:#c62828;font-family:monospace;margin-left:.3rem;font-style:italic"></span>'+
      '</div>';
    });
    html+='</div>';
  }
  return html;
}
function rRegTest(el){
  function applyResult(r){
    var key=r.name.replace(/[^a-z0-9]/gi,'_');
    var ico=document.getElementById('ico-'+key);
    var det=document.getElementById('det-'+key);
    if(!ico)return;
    if(r.ok){
      ico.innerHTML='\u2713';
      ico.style.cssText='width:18px;height:18px;border-radius:50%;background:#e8f5e9;color:#2e7d32;display:flex;align-items:center;justify-content:center;font-size:.75rem;flex-shrink:0;font-weight:700';
    } else {
      ico.innerHTML='\u2717';
      ico.style.cssText='width:18px;height:18px;border-radius:50%;background:#fdecea;color:#c62828;display:flex;align-items:center;justify-content:center;font-size:.75rem;flex-shrink:0;font-weight:700';
      if(det)det.textContent=r.detail||'Check failed — see test name for details';
    }
  }

  el.innerHTML=
    '<div style="display:flex;align-items:center;gap:1rem;margin-bottom:1rem;flex-wrap:wrap">'+
      '<div>'+
        '<div id="rt-pass" style="display:inline-block;background:#e8f5e9;color:#2e7d32;font-weight:700;font-size:.85rem;border-radius:6px;padding:.2rem .7rem;margin-right:.4rem">— passing</div>'+
        '<div id="rt-fail" style="display:inline-block;background:#fdecea;color:#c62828;font-weight:700;font-size:.85rem;border-radius:6px;padding:.2rem .7rem;margin-right:.4rem">— failing</div>'+
        '<div id="rt-pct" style="display:inline-block;background:#fffdf0;color:#a07810;font-weight:700;font-size:.85rem;border-radius:6px;padding:.2rem .7rem;border:1px solid #e8e0b8">—%</div>'+
      '</div>'+
      '<button id="rt-btn" class="bp" onclick="runRegTests()" style="font-size:.82rem">▶ Run Tests</button>'+
      '<button id="rt-cancel" onclick="cancelRegTests()" style="display:none;margin-left:.5rem;background:none;border:1.5px solid #c62828;color:#c62828;border-radius:7px;padding:.3rem .9rem;font-size:.8rem;font-weight:600;cursor:pointer">✕ Cancel</button>'+
    '</div>'+
    '<div style="background:#f5f0e8;border-radius:8px;height:8px;margin-bottom:1rem;overflow:hidden"><div id="rt-bar" style="height:100%;width:0%;background:#2e7d32;border-radius:8px;transition:width .4s"></div></div>'+
    '<div id="rt-sec-banner" style="display:none;background:#fff3cd;border:1.5px solid #ffc107;border-radius:8px;padding:.7rem 1rem;margin-bottom:1rem;font-size:.83rem;color:#664d00">'+
      '<strong>⚠️ Security reminder:</strong> <code>regression_test.php</code> is currently on the server. '+
      'Delete it from <code>public_html</code> after testing to prevent exposing site internals.'+
    '</div>'+
    '<div id="rt-results" style="color:#6b6040;font-size:.85rem;padding:.5rem 0">Click ▶ Run Tests to begin.</div>';
  // Check if regression_test.php is accessible
  fetch('/regression_test.php',{method:'HEAD',cache:'no-store'})
  .then(function(r){
    var banner=document.getElementById('rt-sec-banner');
    if(banner&&r.ok)banner.style.display='block';
  }).catch(function(){});
}

function cancelRegTests(){
  if(window._rtCtrl)window._rtCtrl.abort();
  document.querySelectorAll('.rt-ico').forEach(function(i){i.className='rt-ico';i.style.cssText='width:18px;height:18px;border-radius:50%;background:#f0f0f0;color:#999;display:flex;align-items:center;justify-content:center;font-size:.75rem;flex-shrink:0;font-weight:700';i.textContent='—';});
  var btn=document.getElementById('rt-btn');
  var cc=document.getElementById('rt-cancel');
  if(btn){btn.disabled=false;btn.textContent='▶ Run Tests';}
  if(cc)cc.style.display='none';
}
function runRegTests(){
  var btn=document.getElementById('rt-btn');
  var cc=document.getElementById('rt-cancel');
  if(btn){btn.disabled=true;btn.textContent='Running…';}
  if(cc)cc.style.display='inline-block';
  // Build skeleton NOW (only when run is clicked)
  var res=document.getElementById('rt-results');
  if(res){res.innerHTML=rtBuildSkeleton();}
  window._rtCtrl=new AbortController();
  fetch('/regression_test.php',{cache:'no-store',signal:window._rtCtrl.signal})
  .then(function(r){return r.json();})
  .then(function(d){
    var orphans=[];
    d.results.forEach(function(r){
      var key=r.name.replace(/[^a-z0-9]/gi,'_');
      var row=document.getElementById('ico-'+key);
      var det=document.getElementById('det-'+key);
      if(!row){
        if(!r.ok)orphans.push(r);
        return;
      }
      var ico=row.querySelector('.rt-ico');
      if(!ico)return;
      if(r.ok){
        ico.textContent='\u2713';
        ico.style.cssText='width:18px;height:18px;border-radius:50%;background:#e8f5e9;color:#2e7d32;display:flex;align-items:center;justify-content:center;font-size:.75rem;flex-shrink:0;font-weight:700';
      } else {
        ico.textContent='\u2717';
        ico.style.cssText='width:18px;height:18px;border-radius:50%;background:#fdecea;color:#c62828;display:flex;align-items:center;justify-content:center;font-size:.75rem;flex-shrink:0;font-weight:700';
        if(det)det.textContent=r.detail||'Check failed — see test name for details';
      }
    });
    var pass=document.getElementById('rt-pass');
    var fail=document.getElementById('rt-fail');
    var pct=document.getElementById('rt-pct');
    var bar=document.getElementById('rt-bar');
    // Show any orphaned failures (tests not in skeleton)
    if(orphans.length){
      var res2=document.getElementById('rt-results');
      var orphanDiv=document.createElement('div');
      orphanDiv.style.cssText='margin-top:.8rem;background:#fdecea;border-radius:8px;padding:.7rem 1rem;font-size:.82rem;color:#c62828';
      orphanDiv.innerHTML='<strong>'+orphans.length+' failing test(s) not shown above:</strong><br>'+
        orphans.map(function(r){return '✗ '+r.name+(r.detail?' — '+r.detail:'');}).join('<br>');
      if(res2)res2.appendChild(orphanDiv);
    }
    if(pass)pass.textContent=d.pass+' passing';
    if(fail)fail.textContent=d.fail+' failing';
    if(pct)pct.textContent=d.pct+'%';
    if(bar){bar.style.width=d.pct+'%';if(d.pct<100)bar.style.background='#a07810';}
    if(btn){btn.disabled=false;btn.textContent=d.fail===0?'\u2713 All Passed \u2014 Run Again':'\u2717 '+d.fail+' Failed \u2014 Run Again';}
  }).catch(function(e){
    if(btn){btn.disabled=false;btn.textContent='Error \u2014 Try Again';}
    alert('Test error: '+e.message+'\n\nMake sure regression_test.php is uploaded to public_html.');
  });
}
function fmtSweepDt(dt){
  if(!dt)return '—';
  var d=new Date(dt.replace(' ','T'));
  if(isNaN(d))return dt;
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+
    ' '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
}
function rSweep(el){
  el.innerHTML='<div style="padding:2rem;text-align:center;color:#6b6040">Checking for unswept tax orders…</div>';
  apiFetch('tax_sweep.php').then(function(d){
    renderSweepPanel(el, d);
  }).catch(function(e){
    el.innerHTML='<div style="color:#c62828;padding:1rem">Failed to load tax sweep data. Check that tax_sweep.php is uploaded to public_html/api/ and that the tax_sweeps table has been created. Error: '+e+'</div>';
  });
}
function renderSweepPanel(el, d){
  var histHtml='';
  apiFetch('tax_sweep.php?action=history').then(function(h){
    var rows=h.sweeps||[];
    if(rows.length){
      histHtml='<div style="margin-top:1.5rem">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.7rem">'+
          '<div style="font-weight:700;font-size:.88rem;text-transform:uppercase;letter-spacing:.06em;color:#a07810">Sweep History</div>'+
          '<button class="bp" style="font-size:.78rem" onclick="showAddSweepForm()">+ Add Sweep Record</button>'+
        '</div>'+
        '<table style="width:100%;min-width:680px;border-collapse:collapse;font-size:.83rem">'+
        '<thead><tr style="background:#a07810;color:#fff;white-space:nowrap">'+
          '<th style="padding:5px 10px;font-size:.75rem;font-weight:700;text-transform:uppercase;text-align:left">Sweep Date</th>'+
          '<th style="padding:5px 10px;font-size:.75rem;font-weight:700;text-transform:uppercase;text-align:left">Period From</th>'+
          '<th style="padding:5px 10px;font-size:.75rem;font-weight:700;text-transform:uppercase;text-align:left">Period To</th>'+
          '<th style="padding:5px 10px;font-size:.75rem;font-weight:700;text-transform:uppercase;text-align:center">Count</th>'+
          '<th style="padding:5px 10px;font-size:.75rem;font-weight:700;text-transform:uppercase;text-align:right">Total Tax</th>'+
          '<th style="padding:5px 10px;font-size:.75rem;font-weight:700;text-transform:uppercase;text-align:left;min-width:280px">Orders Swept</th>'+
          '<th style="padding:6px 10px;text-align:left">Actions</th>'+
        '</tr></thead><tbody>'+
        rows.map(function(r,i){
          var oids=[];
          try{oids=r.order_ids?JSON.parse(r.order_ids):[];}catch(e){}
          // Try to get per-order tax from order_details if stored
          var details=[];
          try{details=r.order_details?JSON.parse(r.order_details):[];}catch(e){}
          var detailMap={};
          details.forEach(function(d){detailMap[d.id]=d.tax;});
          var oidsHtml=oids.length
            ? oids.map(function(id){
                var tax=detailMap[id]!==undefined?(' — <strong style="color:#2e7d32">$'+parseFloat(detailMap[id]).toFixed(2)+'</strong>'):''; 
                return '<div style="white-space:nowrap"><span style="font-size:.72rem;font-family:monospace;color:#a07810;cursor:pointer;text-decoration:underline" onclick="viewOrder(\''+id+'\')" title="View order">'+id+'</span>'+tax+'</div>';
              }).join('')
            : '<span style="font-size:.72rem;color:#6b6040;font-style:italic">Not recorded</span>';
          return '<tr style="background:'+(i%2===0?'#fff':'#fffdf0')+'">'+
            '<td style="padding:6px 10px;border-bottom:1px solid #f0e8d0;font-weight:600;white-space:nowrap">'+r.sweep_date+'</td>'+
            '<td style="padding:6px 10px;border-bottom:1px solid #f0e8d0;color:#6b6040;white-space:nowrap">'+fmtSweepDt(r.period_from)+'</td>'+
            '<td style="padding:6px 10px;border-bottom:1px solid #f0e8d0;color:#6b6040;white-space:nowrap">'+fmtSweepDt(r.period_to)+'</td>'+
            '<td style="padding:6px 10px;border-bottom:1px solid #f0e8d0;text-align:center">'+r.order_count+'</td>'+
            '<td style="padding:6px 10px;border-bottom:1px solid #f0e8d0;text-align:right;font-weight:700;color:#2e7d32">$'+parseFloat(r.total_tax).toFixed(2)+'</td>'+
            '<td style="padding:6px 10px;border-bottom:1px solid #f0e8d0;line-height:2">'+oidsHtml+'</td>'+
            '<td style="padding:6px 10px;border-bottom:1px solid #f0e8d0;white-space:nowrap">'+
              '<button class="be" style="font-size:.7rem;padding:.2rem .55rem;margin-right:.3rem" onclick="editSweepRow('+r.id+',this.closest(\'tr\'))">Edit</button>'+
              '<button class="bd" style="font-size:.7rem;padding:.2rem .55rem" onclick="deleteSweepRow('+r.id+')">Delete</button>'+
            '</td>'+
          '</tr>';
        }).join('')+
        '</tbody></table></div>';
    }

    var pendingHtml='';
    if(!d.pending){
      pendingHtml=
        '<div style="background:#e8f5e9;border:1.5px solid #a5d6a7;border-radius:10px;padding:1.5rem;text-align:center">'+
          '<div style="font-size:1.8rem;margin-bottom:.5rem">✅</div>'+
          '<div style="font-weight:700;font-size:1rem;color:#2e7d32">All caught up!</div>'+
          '<div style="font-size:.85rem;color:#6b6040;margin-top:.3rem">No unswept tax orders found.</div>'+
        '</div>';
    } else {
      var today=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
      // Store sweep data globally so OK button can access it safely
      window._pendingSweep={count:d.count,total_tax:d.total_tax,date_from:d.date_from,date_to:d.date_to,order_ids:d.order_ids,order_details:d.order_details||[]};
      pendingHtml=
        '<div style="background:#fff;border:1.5px solid #e8e0b8;border-radius:10px;padding:1.5rem">'+
          '<div style="font-weight:700;font-size:1rem;color:#2d2220;margin-bottom:1rem">🧾 Pending Tax Sweep</div>'+
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem 1.2rem;font-size:.85rem;margin-bottom:1.2rem">'+
            '<div style="background:#fffdf0;border:1px solid #e8e0b8;border-radius:8px;padding:.8rem">'+
              '<div style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:#a07810;margin-bottom:.2rem">Oldest Order</div>'+
              '<div style="font-weight:600;color:#2d2220">'+fmtSweepDt(d.date_from)+'</div>'+
            '</div>'+
            '<div style="background:#fffdf0;border:1px solid #e8e0b8;border-radius:8px;padding:.8rem">'+
              '<div style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:#a07810;margin-bottom:.2rem">Newest Order</div>'+
              '<div style="font-weight:600;color:#2d2220">'+fmtSweepDt(d.date_to)+'</div>'+
            '</div>'+
            '<div style="background:#fffdf0;border:1px solid #e8e0b8;border-radius:8px;padding:.8rem">'+
              '<div style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:#a07810;margin-bottom:.2rem">Orders</div>'+
              '<div style="font-weight:700;font-size:1.1rem;color:#2d2220">'+d.count+'</div>'+
            '</div>'+
            '<div style="background:#fffdf0;border:1px solid #e8e0b8;border-radius:8px;padding:.8rem">'+
              '<div style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:#a07810;margin-bottom:.2rem">Total Tax to Sweep</div>'+
              '<div style="font-weight:700;font-size:1.1rem;color:#2e7d32">$'+d.total_tax.toFixed(2)+'</div>'+
            '</div>'+
          '</div>'+
          '<div style="margin-bottom:1rem;border:1px solid #e8e0b8;border-radius:8px;overflow:hidden">'+
            '<div style="padding:.5rem .8rem;background:#f9f4e4;font-size:.72rem;font-weight:700;text-transform:uppercase;color:#a07810">Orders to Sweep</div>'+
            '<table style="width:100%;border-collapse:collapse;font-size:.8rem">'+
            '<thead><tr style="background:#fffdf0">'+
              '<th style="padding:5px 10px;text-align:left;color:#6b6040;font-weight:700;border-bottom:1px solid #e8e0b8">Order ID</th>'+
              '<th style="padding:5px 10px;text-align:left;color:#6b6040;font-weight:700;border-bottom:1px solid #e8e0b8">Date</th>'+
              '<th style="padding:5px 10px;text-align:right;color:#6b6040;font-weight:700;border-bottom:1px solid #e8e0b8">Tax</th>'+
            '</tr></thead>'+
            '<tbody>'+
            (d.order_details||[]).map(function(o,i){
              return '<tr style="background:'+(i%2===0?'#fff':'#fffdf0')+'">'+
                '<td style="padding:5px 10px;border-bottom:1px solid #f5efe0;font-family:monospace;font-size:.75rem;color:#a07810;cursor:pointer;text-decoration:underline" onclick="viewOrder(\''+o.id+'\')" title="View order">'+o.id+'</td>'+
                '<td style="padding:5px 10px;border-bottom:1px solid #f5efe0;color:#6b6040">'+fmtSweepDt(o.date)+'</td>'+
                '<td style="padding:5px 10px;border-bottom:1px solid #f5efe0;text-align:right;font-weight:600;color:#2e7d32">$'+o.tax.toFixed(2)+'</td>'+
              '</tr>';
            }).join('')+
            '</tbody>'+
            '<tfoot><tr style="background:#f9f4e4;font-weight:700">'+
              '<td colspan="2" style="padding:5px 10px;color:#2d2220">Total</td>'+
              '<td style="padding:5px 10px;text-align:right;color:#2e7d32">$'+d.total_tax.toFixed(2)+'</td>'+
            '</tr></tfoot>'+
            '</table>'+
          '</div>'+
          '<div style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:.75rem 1rem;font-size:.82rem;color:#5a3e00;margin-bottom:1rem">'+
            '⚠️ Clicking <strong>OK — Record Sweep</strong> will mark all '+d.count+' order'+
            (d.count!==1?'s':'')+' as swept with today\'s date ('+today+') and create a permanent sweep record.'+
          '</div>'+
          '<div style="display:flex;gap:.6rem">'+
            '<button class="bp" style="background:#2e7d32" onclick="doTaxSweep()">✅ OK — Record Sweep</button>'+
            '<button class="bs" onclick="rSweep(document.getElementById(\'acnt\'))">↺ Refresh</button>'+
          '</div>'+
        '</div>';
    }

    el.innerHTML='<div style="max-width:700px">'+pendingHtml+histHtml+'</div>';
  }).catch(function(){
    el.innerHTML='<div style="color:#c62828;padding:1rem">Failed to load sweep history.</div>';
  });
}
function showAddSweepForm(){
  var today=new Date().toISOString().slice(0,10);
  var html=
    '<div style="background:#fff;border:1.5px solid #e8e0b8;border-radius:10px;padding:1.5rem;max-width:500px;margin-bottom:1.5rem" id="add-sweep-form">'+
      '<div style="font-weight:700;font-size:.95rem;color:#2d2220;margin-bottom:1rem">+ Add Sweep Record</div>'+
      '<div class="g2" style="margin-bottom:.7rem">'+
        '<div><label class="fl">Sweep Date</label><input class="afi" id="asf-date" type="date" value="'+today+'"></div>'+
        '<div><label class="fl">Total Tax ($)</label><input class="afi" id="asf-tax" type="number" step="0.01" min="0" placeholder="0.00"></div>'+
      '</div>'+
      '<div class="g2" style="margin-bottom:.7rem">'+
        '<div><label class="fl">Period From</label><input class="afi" id="asf-from" type="date"></div>'+
        '<div><label class="fl">Period To</label><input class="afi" id="asf-to" type="date"></div>'+
      '</div>'+
      '<div style="margin-bottom:.7rem"><label class="fl">Order IDs (one per line)</label>'+
        '<textarea class="afi" id="asf-orders" rows="4" placeholder="ORD-XXXXXXXX"></textarea></div>'+
      '<div style="display:flex;gap:.6rem">'+
        '<button class="bp" onclick="saveAddSweepForm()">💾 Save</button>'+
        '<button class="bs" onclick="document.getElementById(\'add-sweep-form\').remove()">Cancel</button>'+
      '</div>'+
    '</div>';
  var el=document.getElementById('acnt');
  var wrap=el.querySelector('div');
  if(wrap)wrap.insertAdjacentHTML('afterbegin',html);
}

function saveAddSweepForm(){
  var date=document.getElementById('asf-date').value;
  var tax=parseFloat(document.getElementById('asf-tax').value)||0;
  var from=document.getElementById('asf-from').value;
  var to=document.getElementById('asf-to').value;
  var raw=document.getElementById('asf-orders').value;
  var ids=raw.split('\n').map(function(s){return s.trim();}).filter(Boolean);
  if(!date){alert('Please enter a sweep date.');return;}
  apiFetch('tax_sweep.php','POST',{sweep_date:date,total_tax:tax,period_from:from,period_to:to,date_from:from,date_to:to,order_ids:ids,count:ids.length,order_details:ids.map(function(id){return{id:id,tax:0};})})
    .then(function(d){
      if(!d.success){alert('Error: '+(d.error||'Unknown'));return;}
      rSweep(document.getElementById('acnt'));
    }).catch(function(){alert('Network error.');});
}

function deleteSweepRow(id){
  if(!confirm('Delete this sweep record? This cannot be undone.'))return;
  apiFetch('tax_sweep.php','DELETE',{id:id})
    .then(function(d){
      if(!d.success){alert('Error: '+(d.error||'Unknown'));return;}
      rSweep(document.getElementById('acnt'));
    }).catch(function(){alert('Network error.');});
}

function editSweepRow(id,tr){
  // Toggle: remove if already open
  var existing=document.getElementById('sweep-edit-'+id);
  if(existing){existing.remove();return;}
  var sweepDate=tr.cells[0].textContent.trim();
  var taxVal=tr.cells[4].textContent.trim().replace('$','');
  // Insert a new row after tr
  var editRow=document.createElement('tr');
  editRow.id='sweep-edit-'+id;
  editRow.style.background='#fffbe6';
  editRow.innerHTML=
    '<td colspan="7" style="padding:.7rem 1rem">'+
      '<div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap">'+
        '<label style="font-size:.8rem;color:#6b6040">Sweep Date:</label>'+
        '<input id="se-date-'+id+'" class="afi" type="date" value="'+sweepDate+'" style="width:140px">'+
        '<label style="font-size:.8rem;color:#6b6040">Total Tax:</label>'+
        '<input id="se-tax-'+id+'" class="afi" type="number" step="0.01" value="'+taxVal+'" style="width:100px">'+
        '<button class="bp" style="font-size:.78rem" onclick="saveSweepEdit('+id+')">Save</button>'+
        '<button class="bs" style="font-size:.78rem" onclick="document.getElementById(\'sweep-edit-'+id+'\').remove()">Cancel</button>'+
      '</div>'+
    '</td>';
  tr.parentNode.insertBefore(editRow, tr.nextSibling);
}

function saveSweepEdit(id){
  var date=document.getElementById('se-date-'+id).value;
  var tax=parseFloat(document.getElementById('se-tax-'+id).value)||0;
  if(!date){alert('Please enter a date.');return;}
  apiFetch('tax_sweep.php','PUT',{id:id,sweep_date:date,total_tax:tax})
    .then(function(d){
      if(!d.success){alert('Error: '+(d.error||'Unknown'));return;}
      rSweep(document.getElementById('acnt'));
    }).catch(function(){alert('Network error.');});
}

function doTaxSweep(){
  var data=window._pendingSweep;
  if(!data){alert('No pending sweep data.');return;}
  if(!confirm('Record tax sweep of $'+data.total_tax.toFixed(2)+' for '+data.count+' order'+(data.count!==1?'s':'')+' — this cannot be undone.\n\nContinue?'))return;
  apiFetch('tax_sweep.php','POST',data).then(function(d){
    if(!d.success){alert('Sweep failed: '+(d.error||'unknown'));return;}
    // Update local ORDERS array swept dates
    var today=new Date().toISOString().slice(0,10);
    data.order_ids.forEach(function(oid){
      for(var i=0;i<ORDERS.length;i++){
        if(ORDERS[i].id===oid){ORDERS[i].swept=1;ORDERS[i].swept_date=today;break;}
      }
    });
    var toast=document.createElement('div');
    toast.textContent='\u2713 Tax sweep recorded — '+data.count+' order'+(data.count!==1?'s':'')+', $'+data.total_tax.toFixed(2);
    toast.style.cssText='position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);background:#2e7d32;color:#fff;padding:.65rem 1.4rem;border-radius:24px;font-size:.85rem;font-family:sans-serif;font-weight:600;z-index:9999';
    document.body.appendChild(toast);
    setTimeout(function(){toast.remove();},4000);
    rSweep(document.getElementById('acnt'));
  }).catch(function(){alert('Network error during sweep.');});
}

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
  {sec:'tncity',  label:'🏙️ TN City Sales Taxes'},
  {sec:'reviews', label:'⭐ Reviews'},
  {sec:'cats',    label:'🏷️ Categories'},
  {sec:'shipping',label:'🚚 Shipping Charges'},
  {sec:'sqpay',   label:'💳 Square Payments'},
  {sec:'sweep',   label:'🧾 Tax Sweep'},
  {sec:'regtest', label:'🧪 Regression Tests'},
  {sec:'emaillog',label:'📧 Email Log'},
  {sec:'logs',    label:'📋 Error Logs'},
  {sec:'bizprofile',label:'🏢 Business Profile'},
  {sec:'settings',label:'⚙️ Settings'}
];
function loadNavOrder(callback){
  var defaults=ADMIN_NAV_DEFAULT.map(function(n){return n.sec;});
  try{
    apiFetch('admin.php','POST',{action:'get_setting',key:'nav_order'}).then(function(d){
      if(d&&d.success&&d.value){
        try{
          var parsed=JSON.parse(d.value);
          if(Array.isArray(parsed)&&parsed.length>0){callback(parsed);return;}
        }catch(e){}
      }
      callback(defaults);
    }).catch(function(){callback(defaults);});
  }catch(e){callback(defaults);}
}
function saveNavOrder(){
  var order=[];
  document.querySelectorAll('#admin-nav .sitem').forEach(function(el){order.push(el.dataset.sec);});
  apiFetch('admin.php','POST',{action:'save_setting',key:'nav_order',value:JSON.stringify(order)}).catch(function(){});
}
function buildAdminNav(){
  var container=document.getElementById('admin-nav');
  if(!container)return;
  container.innerHTML='<div style="padding:.5rem 1.2rem;font-size:.72rem;color:rgba(255,255,255,.3)">Loading…</div>';
  loadNavOrder(function(order){
    var map={};
    ADMIN_NAV_DEFAULT.forEach(function(n){map[n.sec]=n.label;});
    container.innerHTML='';
    ADMIN_NAV_DEFAULT.forEach(function(n){if(order.indexOf(n.sec)<0)order.push(n.sec);});
    order.forEach(function(sec){
      if(!map[sec])return;
      var div=document.createElement('div');
      div.className='sitem';
      div.dataset.sec=sec;
      div.setAttribute('draggable','true');
      div.innerHTML='<span class="sitem-drag" title="Drag to reorder">⠿</span><span onclick="aNavEl(this.parentNode,\''+sec+'\')">'+map[sec]+'</span>';
      div.addEventListener('dragstart',function(e){
        e.dataTransfer.effectAllowed='move';
        e.dataTransfer.setData('text/plain',sec);
        setTimeout(function(){div.classList.add('dragging');},0);
      });
      div.addEventListener('dragend',function(){
        div.classList.remove('dragging');
        document.querySelectorAll('.sitem').forEach(function(el){el.classList.remove('drag-over');});
        saveNavOrder();
      });
      div.addEventListener('dragover',function(e){
        e.preventDefault();
        e.dataTransfer.dropEffect='move';
        document.querySelectorAll('.sitem').forEach(function(el){el.classList.remove('drag-over');});
        div.classList.add('drag-over');
      });
      div.addEventListener('drop',function(e){
        e.preventDefault();
        var fromSec=e.dataTransfer.getData('text/plain');
        var fromEl=container.querySelector('[data-sec="'+fromSec+'"]');
        if(fromEl&&fromEl!==div)container.insertBefore(fromEl,div);
        div.classList.remove('drag-over');
        saveNavOrder();
      });
      container.appendChild(div);
    });
  });
}
function aNavEl(el,sec){aNav(el,sec);}
function rBizProfile(el){
  el.innerHTML='<div style="padding:2rem;text-align:center;color:#6b6040">Loading…</div>';
  apiFetch('admin.php','POST',{action:'get_setting',key:'biz_profile'}).then(function(d){
    var p={};
    try{if(d.success&&d.value)p=JSON.parse(d.value);}catch(e){}
    el.innerHTML=
      '<div style="max-width:660px">'+
      '<div class="aok" id="bp-ok" style="display:none">\u2713 Business profile saved!</div>'+
      '<div class="aerr" id="bp-err" style="display:none"></div>'+
      '<div style="background:#fff;border:1px solid #e8e0b8;border-radius:10px;padding:1.4rem;margin-bottom:1rem">'+
        '<div style="font-weight:700;font-size:.88rem;text-transform:uppercase;letter-spacing:.06em;color:#a07810;margin-bottom:.9rem">🌐 Website & Contact</div>'+
        '<label class="fl">Website URL</label>'+
        '<input class="afi" id="bp-website-url" value="'+(p.website_url||'https://handmadedesignsbysuzi.com')+'">'+
        '<label class="fl">Website Email</label>'+
        '<input class="afi" id="bp-website-email" value="'+(p.website_email||'handmadedesignsbysuzi@yahoo.com')+'">'+
      '</div>'+
      '<div style="background:#fff;border:1px solid #e8e0b8;border-radius:10px;padding:1.4rem;margin-bottom:1rem">'+
        '<div style="font-weight:700;font-size:.88rem;text-transform:uppercase;letter-spacing:.06em;color:#a07810;margin-bottom:.9rem">\ud83c\udfe2 Legal Information</div>'+
        '<label class="fl">Business Legal Name</label>'+
        '<input class="afi" id="bp-legal-name" value="'+(p.legal_name||'')+'" placeholder="e.g. Handmade Designs By Suzi LLC">'+
        '<label class="fl">Business Legal Address</label>'+
        '<input class="afi" id="bp-legal-addr" value="'+(p.legal_addr||'')+'" placeholder="123 Main St, Knoxville TN 37918">'+
        '<label class="fl">Business License Number</label>'+
        '<input class="afi" id="bp-license-num" value="'+(p.license_num||'')+'" placeholder="e.g. TN-BUS-12345">'+
      '</div>'+
      '<div style="background:#fff;border:1px solid #e8e0b8;border-radius:10px;padding:1.4rem;margin-bottom:1rem">'+
        '<div style="font-weight:700;font-size:.88rem;text-transform:uppercase;letter-spacing:.06em;color:#a07810;margin-bottom:.9rem">\ud83d\udce6 Shipping Address</div>'+
        '<div style="font-size:.8rem;color:#6b6040;margin-bottom:.7rem">Address used as the from-address on shipments (if different from legal address)</div>'+
        '<label class="fl">Shipping Address</label>'+
        '<input class="afi" id="bp-ship-addr" value="'+(p.ship_addr||'')+'" placeholder="123 Main St, Knoxville TN 37918">'+
      '</div>'+
      '<div style="background:#fff;border:1px solid #e8e0b8;border-radius:10px;padding:1.4rem;margin-bottom:1rem">'+
        '<div style="font-weight:700;font-size:.88rem;text-transform:uppercase;letter-spacing:.06em;color:#a07810;margin-bottom:.9rem">\ud83d\udcf7 Business License Image</div>'+
        (p.license_img
          ? '<div style="margin-bottom:.8rem">'+
            '<img id="bp-img-preview" src="'+p.license_img+'" onclick="bzImgZoom(this)" style="max-width:100%;max-height:200px;border-radius:8px;border:1px solid #e8e0b8;display:block;cursor:zoom-in" title="Click to enlarge">'+
            '<div style="display:flex;align-items:center;gap:.6rem;margin-top:.5rem">'+
              '<span style="font-size:.72rem;color:#6b6040">Click image to enlarge</span>'+
              '<button class="bd" style="font-size:.72rem;padding:.2rem .6rem" onclick="clearBizImage()">✕ Clear Image</button>'+
            '</div>'+
          '</div>'
          : '<div style="background:#fffdf0;border:1px dashed #e8e0b8;border-radius:8px;padding:1.2rem;text-align:center;color:#6b6040;font-size:.85rem;margin-bottom:.8rem">No license image uploaded</div>')+
        '<label class="fl">Upload License Image (JPG/PNG)</label>'+
        '<input type="file" id="bp-license-img" accept="image/jpeg,image/png,image/gif,image/webp" style="margin-bottom:.8rem;font-size:.83rem" onchange="bzPreviewImg(this)">'+
        '<div id="bp-img-new" style="display:none;margin-bottom:.8rem">'+
          '<div style="font-size:.72rem;color:#a07810;font-weight:600;margin-bottom:.3rem">New image (not yet saved):</div>'+
          '<img id="bp-img-new-src" style="max-width:100%;max-height:200px;border-radius:8px;border:2px dashed #d4a017;display:block;cursor:zoom-in" onclick="bzImgZoom(this)">'+
        '</div>'+
        (p.license_img?'<div style="font-size:.75rem;color:#2e7d32;margin-bottom:.5rem">\u2713 Image on file</div>':'')+
      '</div>'+
      '<button class="bp" onclick="saveBizProfile()">\ud83d\udcbe Save Business Profile</button>'+
      '</div>';
  }).catch(function(){
    el.innerHTML='<div style="color:#c62828;padding:1rem">Failed to load business profile.</div>';
  });
}
function saveBizProfile(){
  var ok=document.getElementById('bp-ok');
  var err=document.getElementById('bp-err');
  ok.style.display='none';err.style.display='none';

  var website_url=document.getElementById('bp-website-url').value.trim();
  var website_email=document.getElementById('bp-website-email').value.trim();
  var legal_name=document.getElementById('bp-legal-name').value.trim();
  var legal_addr=document.getElementById('bp-legal-addr').value.trim();
  var ship_addr=document.getElementById('bp-ship-addr').value.trim();
  var license_num=document.getElementById('bp-license-num').value.trim();
  var fileInput=document.getElementById('bp-license-img');

  // Keep existing image if no new one uploaded — read from current DOM img
  function doSave(imgData){
    // If no new image, keep whatever is currently displayed
    if(!imgData){
      var existing=document.querySelector('#acnt img[src^="data:"]')||document.querySelector('#acnt img[src^="http"]');
      imgData=existing?existing.src:'';
    }
    var profile={
      website_url:website_url,
      website_email:website_email,
      legal_name:legal_name,
      legal_addr:legal_addr,
      ship_addr:ship_addr,
      license_num:license_num,
      license_img:imgData
    };
    apiFetch('admin.php','POST',{action:'save_setting',key:'biz_profile',value:JSON.stringify(profile)})
    .then(function(d){
      if(d.message==='Setting saved'||d.success){
        // Reload the page to show updated image
        rBizProfile(document.getElementById('acnt'));
        var toast=document.createElement('div');
        toast.textContent='✓ Business profile saved!';
        toast.style.cssText='position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);background:#2e7d32;color:#fff;padding:.65rem 1.4rem;border-radius:24px;font-size:.85rem;font-family:sans-serif;font-weight:600;z-index:9999';
        document.body.appendChild(toast);
        setTimeout(function(){toast.remove();},3000);
      } else {
        err.textContent='Save failed: '+(d.error||'unknown');err.style.display='block';
      }
    }).catch(function(){err.textContent='Network error.';err.style.display='block';});
  }

  // If image selected, convert to base64 and save
  if(fileInput&&fileInput.files&&fileInput.files[0]){
    var file=fileInput.files[0];
    if(file.size>2*1024*1024){
      err.textContent='Image must be under 2MB.';err.style.display='block';return;
    }
    var reader=new FileReader();
    reader.onload=function(e){doSave(e.target.result);};
    reader.readAsDataURL(file);
  } else {
    doSave(null);
  }
}
function clearBizImage(){
  if(!confirm('Remove the license image?'))return;
  var legal_name=document.getElementById('bp-legal-name').value.trim();
  var legal_addr=document.getElementById('bp-legal-addr').value.trim();
  var ship_addr=document.getElementById('bp-ship-addr').value.trim();
  var license_num=document.getElementById('bp-license-num').value.trim();
  var profile={legal_name:legal_name,legal_addr:legal_addr,ship_addr:ship_addr,license_num:license_num,license_img:''};
  apiFetch('admin.php','POST',{action:'save_setting',key:'biz_profile',value:JSON.stringify(profile)})
  .then(function(d){
    if(d.message==='Setting saved'||d.success){
      rBizProfile(document.getElementById('acnt'));
    }
  }).catch(function(){alert('Network error.');});
}
function bzPreviewImg(input){
  if(!input.files||!input.files[0])return;
  var reader=new FileReader();
  reader.onload=function(e){
    var div=document.getElementById('bp-img-new');
    var img=document.getElementById('bp-img-new-src');
    if(div&&img){img.src=e.target.result;div.style.display='block';}
  };
  reader.readAsDataURL(input.files[0]);
}
function bzImgZoom(img){
  var ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
  var im=document.createElement('img');
  im.src=img.src;
  im.style.cssText='max-width:92vw;max-height:92vh;border-radius:10px;box-shadow:0 8px 40px rgba(0,0,0,.5)';
  var cls=document.createElement('div');
  cls.textContent='×';
  cls.style.cssText='position:absolute;top:1.2rem;right:1.5rem;color:#fff;font-size:2rem;cursor:pointer;line-height:1;font-weight:300';
  ov.appendChild(im);
  ov.appendChild(cls);
  ov.onclick=function(){ov.remove();};
  document.body.appendChild(ov);
}
function chPw(){
  var c=document.getElementById('pw-c').value,n=document.getElementById('pw-n').value,cf=document.getElementById('pw-cf').value;
  var ok=document.getElementById('pw-ok'),err=document.getElementById('pw-err');ok.style.display='none';err.style.display='none';
  if(c!==PW){err.textContent='Current password incorrect.';err.style.display='block';return;}
  if(!n){err.textContent='Cannot be empty.';err.style.display='block';return;}
  if(n!==cf){err.textContent='Passwords do not match.';err.style.display='block';return;}
  apiFetch('admin.php','POST',{action:'change_password',current:c,new:n,confirm:cf}).then(function(d){
    if(!d.success){err.textContent=d.error||'Failed.';err.style.display='block';return;}
    document.getElementById('pw-c').value='';document.getElementById('pw-n').value='';document.getElementById('pw-cf').value='';
    ok.style.display='block';
  }).catch(function(){err.textContent='Network error.';err.style.display='block';});
}
function saveSQ(){
  var q=document.getElementById('sq-q').value,a=document.getElementById('sq-a').value.trim(),a2=document.getElementById('sq-a2').value.trim();
  var ok=document.getElementById('sq-ok'),err=document.getElementById('sq-err');ok.style.display='none';err.style.display='none';
  if(!q){err.textContent='Please select a question.';err.style.display='block';return;}
  if(!a){err.textContent='Please enter your answer.';err.style.display='block';return;}
  if(a.toLowerCase()!==a2.toLowerCase()){err.textContent='Answers do not match.';err.style.display='block';return;}
  apiFetch('admin.php','POST',{action:'save_sec_question',question:q,answer:a,answer2:a2}).then(function(d){
    if(!d.success){err.textContent=d.error||'Failed.';err.style.display='block';return;}
    SEC={q:q,a:a.toLowerCase().trim()};
    document.getElementById('sq-a').value='';document.getElementById('sq-a2').value='';
    ok.style.display='block';
  }).catch(function(){err.textContent='Network error.';err.style.display='block';});
}

// ── EMAIL LOG ──
var ELOGS=[], EL_SORT={col:'sent_at',dir:-1}, EL_F={sent_at:'',email_type:'',sent_to:'',order_id:'',status:''};

function elSort(col){if(EL_SORT.col===col)EL_SORT.dir*=-1;else EL_SORT={col:col,dir:1};rEmailLog(document.getElementById('acnt'));}

function elFilt(e,col){
  e.stopPropagation();
  document.querySelectorAll('.el-fp').forEach(function(p){p.remove();});
  var th=e.target.closest('th');th.style.position='relative';
  var pop=document.createElement('div');
  pop.className='el-fp';
  pop.style.cssText='position:absolute;top:100%;left:0;background:#fff;border:1.5px solid #e8e0b8;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.18);z-index:300;min-width:200px;padding:0;overflow:hidden';
  var allVals=[];var seen={};
  for(var i=0;i<ELOGS.length;i++){
    var v=String(ELOGS[i][col]||'(blank)');
    if(!seen[v]){seen[v]=true;allVals.push(v);}
  }
  allVals.sort();
  var selVals=EL_F[col]?EL_F[col].split('\x00'):null;
  var listId='el-flist-'+col;
  var checkboxes=allVals.map(function(v){
    var chk=(selVals===null||selVals.indexOf(v)>=0)?'checked':'';
    return '<label style="display:flex;align-items:center;gap:.4rem;padding:.25rem .4rem;cursor:pointer;border-radius:4px;font-size:.8rem;color:#2d2220" onmouseover="this.style.background=\'#fffdf0\'" onmouseout="this.style.background=\'\'"><input type="checkbox" value="'+v.replace(/"/g,'&quot;')+'" '+chk+'><span>'+v+'</span></label>';
  }).join('');
  pop.innerHTML=
    '<div style="padding:.5rem .7rem;background:#f9f4e4;border-bottom:1px solid #e8e0b8;font-size:.72rem;font-weight:700;color:#a07810;text-transform:uppercase">Filter: '+col+'</div>'+
    '<div style="padding:.3rem .4rem;border-bottom:1px solid #f0e8d0;display:flex;gap:.5rem">'+
      '<button style="font-size:.72rem;color:#a07810;background:none;border:none;cursor:pointer" onclick="elFiltAll(\''+listId+'\',true)">All</button>'+
      '<span style="color:#e8e0b8">|</span>'+
      '<button style="font-size:.72rem;color:#a07810;background:none;border:none;cursor:pointer" onclick="elFiltAll(\''+listId+'\',false)">None</button>'+
    '</div>'+
    '<div id="'+listId+'" style="max-height:200px;overflow-y:auto;padding:.2rem .3rem">'+checkboxes+'</div>'+
    '<div style="padding:.5rem .7rem;border-top:1px solid #f0e8d0;display:flex;justify-content:space-between">'+
      '<button style="font-size:.72rem;color:#6b6040;background:none;border:none;cursor:pointer" onclick="this.closest(\'.el-fp\').remove()">Close</button>'+
      '<button style="font-size:.78rem;background:#d4a017;color:#fff;border:none;border-radius:6px;padding:.3rem .8rem;cursor:pointer;font-weight:600" onclick="elFiltApply(\''+col+'\',this)">Apply</button>'+
    '</div>';
  th.appendChild(pop);
  setTimeout(function(){document.addEventListener('click',function h(ev){if(!pop.contains(ev.target)){pop.remove();document.removeEventListener('click',h);}});},50);
}

function elFiltAll(listId,chk){document.querySelectorAll('#'+listId+' input[type=checkbox]').forEach(function(c){c.checked=chk;});}

function elFiltApply(col,btn){
  var pop=btn.closest('.el-fp');
  var list=pop?pop.querySelector('[id^="el-flist-"]'):null;
  if(!list)return;
  var checked=[],all=[];
  list.querySelectorAll('input[type=checkbox]').forEach(function(c){all.push(c.value);if(c.checked)checked.push(c.value);});
  EL_F[col]=(checked.length===all.length)?'':checked.length===0?'__NONE__':checked.join('\x00');
  pop.remove();
  rEmailLog(document.getElementById('acnt'));
}

function applyElFilters(){
  function chk(fval,oval){if(!fval)return true;if(fval==='__NONE__')return false;return fval.split('\x00').indexOf(String(oval||'(blank)'))>=0;}
  var result=ELOGS.filter(function(l){
    if(!chk(EL_F.sent_at,l.sent_at))return false;
    if(!chk(EL_F.email_type,l.email_type))return false;
    if(!chk(EL_F.sent_to,l.sent_to))return false;
    if(!chk(EL_F.order_id,l.order_id))return false;
    if(!chk(EL_F.status,l.status))return false;
    return true;
  });
  var sc=EL_SORT.col,sd=EL_SORT.dir;
  result.sort(function(a,b){
    var av=a[sc]!==undefined?a[sc]:'',bv=b[sc]!==undefined?b[sc]:'';
    return sd*String(av).localeCompare(String(bv));
  });
  return result;
}

function buildElThead(){
  var cols=[
    {key:'sent_at',   label:'Date & Time'},
    {key:'email_type',label:'Type'},
    {key:'sent_to',   label:'Sent To'},
    {key:'order_id',  label:'Order ID'},
    {key:'status',    label:'Status'}
  ];
  var s='background:#a07810;color:#fff;padding:0;white-space:nowrap';
  var ths=cols.map(function(col){
    var isSort=EL_SORT.col===col.key;
    var hasF=EL_F[col.key]&&EL_F[col.key]!=='';
    var arrow=isSort?(EL_SORT.dir===1?'▲':'▼'):'▽';
    return '<th style="'+s+';position:relative"><div style="display:flex;align-items:center;padding:5px 6px;gap:3px">'+
      '<span style="font-size:.75rem;font-weight:700">'+col.label+'</span>'+
      '<span style="font-size:.65rem;color:'+(isSort?'#ffe082':'rgba(255,255,255,.75)')+';cursor:pointer" onclick="elSort(\''+col.key+'\')" title="Sort">'+arrow+'</span>'+
      '<span style="font-size:.65rem;background:'+(hasF?'#ffe082':'rgba(255,255,255,.2)')+';color:'+(hasF?'#5a3e00':'#fff')+';border-radius:3px;padding:1px 4px;cursor:pointer;line-height:1.4" onclick="elFilt(event,\''+col.key+'\')" title="Filter">▾</span>'+
    '</div></th>';
  }).join('');
  return '<thead><tr>'+ths+'<th style="'+s+'"><div style="padding:5px 6px;font-size:.75rem;font-weight:700">Preview</div></th></tr></thead>';
}

function elFmtDate(dtStr){
  if(!dtStr)return'';
  var p=String(dtStr).replace('T',' ').split(/[- :]/);
  if(p.length<5)return dtStr;
  var mo=parseInt(p[1]),dy=parseInt(p[2]),h=parseInt(p[3]),mi=parseInt(p[4]);
  var ampm=h<12?'AM':'PM';h=h%12||12;
  return mo+'/'+dy+'/'+p[0]+' '+h+':'+String(mi).padStart(2,'0')+' '+ampm+' EDT';
}

function elPreview(html){
  var existing=document.getElementById('el-preview-modal');
  if(existing)existing.remove();
  var ov=document.createElement('div');
  ov.id='el-preview-modal';
  ov.style.cssText='position:fixed;inset:0;z-index:9999;background:#fff;display:flex;flex-direction:column';
  var bar=document.createElement('div');
  bar.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:.6rem 1rem;background:#2d2220;flex-shrink:0';
  bar.innerHTML='<span style="color:#fff;font-size:.88rem;font-weight:600">Email Preview</span>'+
    '<button onclick="document.getElementById(\'el-preview-modal\').remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;font-size:.82rem;padding:4px 12px;border-radius:5px;cursor:pointer">✕ Close</button>';
  var iframe=document.createElement('iframe');
  iframe.style.cssText='flex:1;border:none;width:100%;height:100%';
  iframe.setAttribute('sandbox','allow-same-origin allow-popups');
  ov.appendChild(bar);
  ov.appendChild(iframe);
  document.body.appendChild(ov);
  var doc=iframe.contentDocument||iframe.contentWindow.document;
  doc.open();doc.write(html);doc.close();
}

function elRefresh(){
  ELOGS=[];
  var el=document.getElementById('acnt');
  if(el)el.innerHTML='';
  rEmailLog(document.getElementById('acnt'));
}

function clearEmailLog(){
  if(!confirm('Delete all email log entries? This cannot be undone.'))return;
  apiFetch('email_log.php','DELETE').then(function(d){
    if(d.success){ELOGS=[];rEmailLog(document.getElementById('acnt'));}
    else alert('Error: '+(d.error||'Could not clear log'));
  }).catch(function(e){alert('Error: '+e.message);});
}

function rEmailLog(el){
  if(!ELOGS.length&&!el.querySelector('#el-table')){
    el.innerHTML='<div style="padding:2rem;text-align:center;color:#6b6040">Loading email log\u2026</div>';
    apiFetch('email_log.php').then(function(d){
      ELOGS=(d.logs||[]).filter(function(l){return l.email_type!=='Order Placed';});
      EL_SORT={col:'sent_at',dir:-1};EL_F={sent_at:'',email_type:'',sent_to:'',order_id:'',status:''};
      rEmailLog(el);
    }).catch(function(e){el.innerHTML='<div style="color:#c62828;padding:1rem">Could not load: '+e+'</div>';});
    return;
  }
  var filtered=applyElFilters();
  var typeColors={'Order Confirmation':'#1565c0','Shipping Notification':'#2e7d32'};
  window._elBodies=[];
  var rows='';
  for(var i=0;i<filtered.length;i++){
    var l=filtered[i];
    var color=typeColors[l.email_type]||'#6b6040';
    var badge='<span style="background:'+color+'22;color:'+color+';font-size:.7rem;font-weight:700;padding:2px 8px;border-radius:4px;white-space:nowrap">'+l.email_type+'</span>';
    var statusEl=l.status==='sent'?'<span style="color:#2e7d32;font-size:.78rem">\u2713 Sent</span>':'<span style="color:#c62828;font-size:.78rem">\u2717 Failed</span>';
    var thumb='';
    if(l.email_body){window._elBodies.push(l.email_body);var bi=window._elBodies.length-1;thumb='<span title="Preview email" style="cursor:pointer;font-size:1rem" onclick="elPreview(window._elBodies['+bi+'])">&#128231;</span>';}
    rows+='<tr>'+
      '<td style="padding:.45rem .7rem;font-size:.78rem;color:#6b6040;white-space:nowrap">'+elFmtDate(l.sent_at)+'</td>'+
      '<td style="padding:.45rem .7rem">'+badge+'</td>'+
      '<td style="padding:.45rem .7rem;font-size:.82rem;color:#2d2220">'+l.sent_to+'</td>'+
      '<td style="padding:.45rem .7rem;font-family:monospace;font-size:.78rem;color:#a07810"><span style="cursor:pointer" onclick="viewOrder(\''+l.order_id+'\')" title="View order">'+l.order_id+'</span></td>'+
      '<td style="padding:.45rem .7rem">'+statusEl+'</td>'+
      '<td style="padding:.45rem .7rem;text-align:center">'+thumb+'</td>'+
    '</tr>';
  }
  var isFiltered=EL_F.sent_at||EL_F.email_type||EL_F.sent_to||EL_F.order_id||EL_F.status;
  el.innerHTML=
    '<div style="display:flex;gap:.6rem;margin-bottom:.8rem;flex-wrap:wrap;align-items:center">'+
      '<button class="bs" style="color:#c62828" onclick="clearEmailLog()">&#128465; Clear Log</button>'+
      (isFiltered?'<button class="bs" onclick="EL_F={sent_at:\'\',email_type:\'\',sent_to:\'\',order_id:\'\',status:\'\'};rEmailLog(document.getElementById(\'acnt\'))" style="color:#c62828">&#x2715; Clear Filters</button>':'')+
      '<button class="bp" style="font-size:.75rem" onclick="elRefresh()">&#x21BA; Refresh</button>'+
      '<span style="font-size:.78rem;color:#6b6040;margin-left:auto">'+filtered.length+' of '+ELOGS.length+' emails</span>'+
    '</div>'+
    '<div id="el-table" style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">'+buildElThead()+'<tbody>'+(rows||'<tr><td colspan="6" style="text-align:center;padding:1.5rem;color:#6b6040">No emails logged.</td></tr>')+'</tbody></table></div>';
}

// ── TN CITY TAX ──
function rTnCity(el){
  el.innerHTML='<div style="padding:1rem;color:#6b6040">Loading…</div>';
  apiFetch('tn_city_tax.php').then(function(d){
    if(!d.success){el.innerHTML='<div style="color:#c62828;padding:1rem">Error: '+d.error+'</div>';return;}
    var cities=d.cities||[];
    var rows=cities.map(function(c){
      return '<tr style="border-bottom:.5px solid #f0e8d0">'+
        '<td style="padding:.4rem .7rem;font-size:.83rem">'+c.city+'</td>'+
        '<td style="padding:.4rem .7rem;font-size:.83rem;color:#6b6040">'+c.county+'</td>'+
        '<td style="padding:.4rem .7rem">'+
          '<input type="number" step="0.0001" min="0" max="0.2" value="'+c.tax_rate+'" style="width:80px;padding:.2rem .4rem;border:1px solid #e8e0b8;border-radius:4px;font-family:monospace;font-size:.82rem" '+
          'onchange="saveTnCity('+c.id+',\''+c.city+'\',\''+c.county+'\',this.value,this)">'+
        '</td>'+
        '<td style="padding:.4rem .7rem;font-size:.8rem;color:#6b6040">'+(parseFloat(c.tax_rate)*100).toFixed(2)+'%</td>'+
        '<td style="padding:.4rem .7rem"><button class="bd" style="font-size:.72rem;padding:.2rem .6rem" onclick="deleteTnCity('+c.id+',\''+c.city+'\')" title="Remove">✕</button></td>'+
      '</tr>';
    }).join('');
    el.innerHTML=
      '<div style="font-size:.82rem;color:#6b6040;margin-bottom:.5rem">'+cities.length+' cities — rates sourced from TN Dept. of Revenue</div>'+
      '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.8rem;flex-wrap:wrap">'+
        '<button class="bp" style="font-size:.78rem" onclick="showAddTnCity()">+ Add City</button>'+
        '<a href="https://www.tn.gov/revenue/taxes/sales-and-use-tax/local-sales-tax-and-single-article.html" target="_blank" class="bs" style="font-size:.78rem;text-decoration:none;padding:.35rem .8rem;border-radius:7px;display:inline-block">🔗 TN Official Rate Source</a>'+
        '<a href="https://www.tn.gov/revenue/taxes/sales-and-use-tax/local-sales-tax/local-sales-tax-rates-map.html" target="_blank" class="bs" style="font-size:.78rem;text-decoration:none;padding:.35rem .8rem;border-radius:7px;display:inline-block">🗺️ TN Rate Lookup Map</a>'+
      '</div>'+
      '<div id="add-tncity-form" style="display:none;background:#fffdf0;border:1px solid #e8e0b8;border-radius:8px;padding:.8rem;margin-bottom:.8rem">'+
        '<div style="display:flex;gap:.5rem;align-items:flex-end;flex-wrap:wrap">'+
          '<div><label style="font-size:.75rem;color:#6b6040;display:block;margin-bottom:2px">City</label><input class="afi" id="tncity-city" placeholder="e.g. Knoxville" style="margin:0;width:150px"></div>'+
          '<div><label style="font-size:.75rem;color:#6b6040;display:block;margin-bottom:2px">County</label><input class="afi" id="tncity-county" placeholder="e.g. Knox" style="margin:0;width:130px"></div>'+
          '<div><label style="font-size:.75rem;color:#6b6040;display:block;margin-bottom:2px">Rate (decimal)</label><input class="afi" id="tncity-rate" type="number" step="0.0001" placeholder="0.0975" style="margin:0;width:100px"></div>'+
          '<button class="bp" style="font-size:.78rem" onclick="addTnCity()">Save</button>'+
          '<button class="bs" style="font-size:.78rem" onclick="document.getElementById(\'add-tncity-form\').style.display=\'none\'">Cancel</button>'+
        '</div>'+
      '</div>'+
      '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;overflow:visible;border-radius:0">'+
        '<thead><tr style="background:#a07810;color:#fff">'+
          '<th style="padding:.4rem .7rem;text-align:left;font-size:.75rem">City</th>'+
          '<th style="padding:.4rem .7rem;text-align:left;font-size:.75rem">County</th>'+
          '<th style="padding:.4rem .7rem;text-align:left;font-size:.75rem">Rate (decimal)</th>'+
          '<th style="padding:.4rem .7rem;text-align:left;font-size:.75rem">Rate (%)</th>'+
          '<th style="padding:.4rem .7rem"></th>'+
        '</tr></thead>'+
        '<tbody>'+rows+'</tbody>'+
      '</table></div>';
  }).catch(function(){el.innerHTML='<div style="color:#c62828;padding:1rem">Could not load TN city tax table</div>';});
}
function showAddTnCity(){var f=document.getElementById('add-tncity-form');if(f){f.style.display='block';document.getElementById('tncity-city').focus();}}
function addTnCity(){
  var city=document.getElementById('tncity-city').value.trim();
  var county=document.getElementById('tncity-county').value.trim();
  var rate=parseFloat(document.getElementById('tncity-rate').value);
  if(!city||!county||isNaN(rate)){alert('Enter city, county, and rate (e.g. 0.0975)');return;}
  apiFetch('tn_city_tax.php','POST',{city:city,county:county,tax_rate:rate}).then(function(d){
    if(d.success)rTnCity(document.getElementById('acnt'));
    else alert('Error: '+d.error);
  });
}
function saveTnCity(id,city,county,val,input){
  var rate=parseFloat(val);
  if(isNaN(rate)||rate<=0||rate>0.2){input.style.borderColor='#c62828';return;}
  input.style.borderColor='#e8e0b8';
  apiFetch('tn_city_tax.php','POST',{city:city,county:county,tax_rate:rate}).then(function(d){
    if(d.success){input.style.borderColor='#2e7d32';setTimeout(function(){input.style.borderColor='#e8e0b8';},1500);}
  });
}
function deleteTnCity(id,city){
  if(!confirm('Remove '+city+'?'))return;
  apiFetch('tn_city_tax.php','DELETE',{id:id}).then(function(d){
    if(d.success)rTnCity(document.getElementById('acnt'));
  });
}

// ── FAQS ──
var FAQS=[];

function loadFAQs(){
  apiFetch('faqs.php').then(function(d){
    if(d.success)FAQS=d.faqs||[];
    renderFAQs();
  }).catch(function(){renderFAQs();});
}

function renderFAQs(){
  var el=document.getElementById('faq-list');if(!el)return;
  if(!FAQS.length){
    el.innerHTML='<div style="text-align:center;padding:3rem;color:#6b6040">No FAQs yet — check back soon!</div>';
    return;
  }
  el.innerHTML=FAQS.map(function(f,i){
    return '<div style="border:1px solid #e8e0b8;border-radius:12px;overflow:hidden;margin-bottom:.8rem;background:#fff">'+
      '<button onclick="toggleFAQ('+i+')" style="width:100%;text-align:left;padding:1rem 1.2rem;background:none;border:none;cursor:pointer;'+
        'display:flex;justify-content:space-between;align-items:center;font-family:sans-serif">'+
        '<span style="font-weight:700;font-size:.92rem;color:#2d2220">'+f.question+'</span>'+
        '<span id="faq-icon-'+i+'" style="color:#d4a017;font-size:1.2rem;transition:transform .2s">＋</span>'+
      '</button>'+
      '<div id="faq-ans-'+i+'" style="display:none;padding:0 1.2rem 1rem;font-size:.88rem;color:#4a3f35;line-height:1.8;border-top:1px solid #f0e8d0">'+
        '<div style="padding-top:.8rem">'+f.answer+'</div>'+
      '</div>'+
    '</div>';
  }).join('');
}

function toggleFAQ(i){
  var ans=document.getElementById('faq-ans-'+i);
  var icon=document.getElementById('faq-icon-'+i);
  var open=ans.style.display!=='none';
  ans.style.display=open?'none':'block';
  icon.textContent=open?'＋':'−';
  icon.style.transform=open?'':'rotate(180deg)';
}

// ── REVIEWS ──
var REVIEWS=[];
var SELECTED_STARS=5;

function loadReviews(){
  apiFetch('reviews.php').then(function(d){
    if(d.success)REVIEWS=d.reviews||[];
    renderReviews();
  }).catch(function(){renderReviews();});
}

function renderReviews(){
  var g=document.getElementById('reviews-grid');if(!g)return;
  if(!REVIEWS.length){
    g.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:2rem;color:#6b6040;font-size:.88rem">Be the first to leave a review! 🌸</div>';
    return;
  }
  var h='';
  for(var i=0;i<REVIEWS.length;i++){
    var r=REVIEWS[i];
    var stars='';
    for(var s=1;s<=5;s++)stars+='<span style="opacity:'+(s<=r.rating?'1':'.2')+'">★</span>';
    h+='<div class="review-card">'+
      '<div class="review-stars">'+stars+'</div>'+
      '<div class="review-text">“'+r.review_text+'”</div>'+
      '<div class="review-author">— '+r.customer_name+'</div>'+
      (r.product_name?'<div class="review-product">'+r.product_name+'</div>':'')+
    '</div>';
  }
  g.innerHTML=h;
}

function toggleReviewForm(){
  var f=document.getElementById('review-form-wrap');
  f.classList.toggle('on');
  if(f.classList.contains('on'))f.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function setStars(n){
  SELECTED_STARS=n;
  var btns=document.querySelectorAll('#star-pick button');
  for(var i=0;i<btns.length;i++)btns[i].classList.toggle('on',i<n);
}

function submitReview(){
  var name=document.getElementById('rv-name').value.trim();
  var prod=document.getElementById('rv-prod').value.trim();
  var text=document.getElementById('rv-text').value.trim();
  var err=document.getElementById('rv-err');
  err.style.display='none';
  if(!name||!text){err.textContent='Please fill in your name and review.';err.style.display='block';return;}
  apiFetch('reviews.php','POST',{customer_name:name,product_name:prod,rating:SELECTED_STARS,review_text:text})
  .then(function(d){
    if(d.success){
      document.getElementById('review-form-wrap').classList.remove('on');
      document.getElementById('rv-name').value='';
      document.getElementById('rv-prod').value='';
      document.getElementById('rv-text').value='';
      setStars(5);
      alert('✅ Thank you! Your review will appear after approval.');
    } else {
      err.textContent=d.error||'Failed to submit. Please try again.';
      err.style.display='block';
    }
  }).catch(function(){err.textContent='Network error.';err.style.display='block';});
}

// ── CUSTOMER FORGOT PASSWORD ──
var CFP_USER=null; // the customer being reset

function cfpStep1(){
  var em=document.getElementById('cfp-em').value.trim();
  var err=document.getElementById('cfp-err1');
  err.style.display='none';
  if(!em){err.textContent='Please enter your email address.';err.style.display='block';return;}
  // find customer
  apiFetch('customers.php','POST',{action:'get_sec_question',em:em}).then(function(d){
    if(!d.success){err.textContent=d.error||'No account found.';err.style.display='block';return;}
    CFP_USER={em:em};
    document.getElementById('cfp-question').textContent=d.question;
    document.getElementById('cfp-s1').style.display='none';
    document.getElementById('cfp-s2').style.display='block';
    document.getElementById('cfp-ans').focus();
  }).catch(function(){err.textContent='Network error.';err.style.display='block';});
}

function cfpBack1(){
  document.getElementById('cfp-s2').style.display='none';
  document.getElementById('cfp-s1').style.display='block';
  document.getElementById('cfp-ans').value='';
  document.getElementById('cfp-err2').style.display='none';
  CFP_USER=null;
}

function cfpStep2(){
  var ans=document.getElementById('cfp-ans').value.trim().toLowerCase();
  var err=document.getElementById('cfp-err2');
  err.style.display='none';
  if(!ans){err.textContent='Please enter your answer.';err.style.display='block';return;}
  if(ans!==CFP_USER.secA){err.textContent='Incorrect answer. Please try again.';err.style.display='block';return;}
  document.getElementById('cfp-s2').style.display='none';
  document.getElementById('cfp-s3').style.display='block';
  document.getElementById('cfp-pw1').focus();
}

function cfpStep3(){
  var pw=document.getElementById('cfp-pw1').value;
  var pw2=document.getElementById('cfp-pw2').value;
  var err=document.getElementById('cfp-err3');
  err.style.display='none';
  if(!pw||pw.length<6){err.textContent='Password must be at least 6 characters.';err.style.display='block';return;}
  if(pw!==pw2){err.textContent='Passwords do not match.';err.style.display='block';return;}
  apiFetch('customers.php','POST',{action:'reset_password',em:CFP_USER.em,answer:document.getElementById('cfp-ans').value.trim(),new_pw:pw}).then(function(d){
    if(!d.success){err.textContent=d.error||'Reset failed.';err.style.display='block';return;}
    CFP_USER=null;
    switchTab('si');
    var errEl=document.getElementById('si-err');
    errEl.style.background='#e8f5e9';errEl.style.color='#2e7d32';
    errEl.textContent='✓ Password reset! Please sign in with your new password.';
    errEl.style.display='block';
  }).catch(function(){err.textContent='Network error.';err.style.display='block';});
}

// ── FORGOT PASSWORD ──
function showForgot(){
  apiFetch('admin.php','POST',{action:'get_sec_question'}).then(function(d){
    if(!d.success){alert('No security question set.\nLog in and go to Settings → Security Question to set one first.');return;}
    SEC={q:d.question};
    document.getElementById('fp-question').textContent=d.question;
  document.getElementById('fp-answer').value='';
  document.getElementById('fp-err1').style.display='none';
  document.getElementById('fp-err2').style.display='none';
    document.getElementById('fp-step1').style.display='block';
    document.getElementById('fp-step2').style.display='none';
    document.getElementById('fp-answer').focus();
  }).catch(function(){alert('Network error.');});
}
function hideForgot(){
  document.getElementById('fp-step1').style.display='none';
  document.getElementById('fp-step2').style.display='none';
  document.getElementById('fp-answer').value='';
  document.getElementById('fp-new').value='';
  document.getElementById('fp-new2').value='';
}
function checkSecAnswer(){
  var ans=document.getElementById('fp-answer').value.trim().toLowerCase();
  var err=document.getElementById('fp-err1');
  if(!ans){err.textContent='Please enter your answer.';err.style.display='block';return;}
  if(ans!==SEC.a){err.style.display='block';return;}
  // Correct — move to step 2
  err.style.display='none';
  document.getElementById('fp-step1').style.display='none';
  document.getElementById('fp-step2').style.display='block';
  document.getElementById('fp-new').focus();
}
function doResetPw(){
  var n=document.getElementById('fp-new').value;
  var n2=document.getElementById('fp-new2').value;
  var err=document.getElementById('fp-err2');
  err.style.display='none';
  if(!n||n.length<4){err.textContent='Password must be at least 4 characters.';err.style.display='block';return;}
  if(n!==n2){err.textContent='Passwords do not match.';err.style.display='block';return;}
  var ans=document.getElementById('fp-answer').value.trim();
  apiFetch('admin.php','POST',{action:'reset_password',answer:ans,new:n}).then(function(d){
    if(!d.success){document.getElementById('fp-err2').textContent=d.error||'Failed.';document.getElementById('fp-err2').style.display='block';return;}
    hideForgot();
    document.getElementById('lerr').style.display='none';
    alert('✅ Password reset successfully! Please log in with your new password.');
  }).catch(function(){document.getElementById('fp-err2').textContent='Network error.';document.getElementById('fp-err2').style.display='block';});
}

tryLoad();


// ── DEBUG SETTINGS ──
// Wraps rSettings after all scripts load to inject the debug card at the top.
// Always reads from DB; never uses localStorage for persistence.
window.addEventListener('load', function(){
  var _orig = window.rSettings;
  window.rSettings = function(el){
    if(_orig) _orig(el);
    var existing = document.getElementById('dbg-card');
    if(existing) existing.remove();
    var card = document.createElement('div');
    card.id = 'dbg-card';
    card.style.cssText = 'background:#fff;border-radius:10px;border:1px solid #e8e0b8;padding:1.2rem;margin-bottom:1.2rem;max-width:420px';
    card.innerHTML =
      '<div style="font-weight:700;margin-bottom:.5rem">&#x1F41B; Debug Mode</div>'+
      '<div style="font-size:.8rem;color:#6b6040;margin-bottom:.9rem;line-height:1.6">When enabled, all PHP files write detailed logs to <code>error_log.txt</code> in the site root. Disable in production.</div>'+
      '<label style="display:flex;align-items:center;gap:.5rem;font-size:.88rem;cursor:pointer">'+
        '<input type="checkbox" id="dbg-toggle" onchange="setDebugMode(this.checked)">'+
        '<span id="dbg-label">Loading...</span>'+
      '</label>';
    if(el.firstChild) el.insertBefore(card, el.firstChild);
    else el.appendChild(card);
    // Always fetch from DB — settings screen always shows current persisted value
    apiFetch('admin.php','POST',{action:'get_setting',key:'debug_mode'}).then(function(d){
      // Default is false if key not yet in DB
      var on = d && d.value === '1';
      var tog = document.getElementById('dbg-toggle');
      var lbl = document.getElementById('dbg-label');
      if(tog) tog.checked = on;
      if(lbl) lbl.innerHTML = on ? '<strong style="color:#c62828">ON — writing to error_log.txt</strong>' : 'OFF';
      // Also keep localStorage in sync for PHP-less reads
      localStorage.setItem('hdbs_debug', on ? '1' : '0');
    }).catch(function(e){ 
      var lbl = document.getElementById('dbg-label');
      if(lbl) lbl.textContent = 'Error loading setting';
      console.error('debug get_setting failed:', e);
    });
  };
});

function setDebugMode(on){
  var lbl = document.getElementById('dbg-label');
  if(lbl) lbl.textContent = 'Saving...';
  // Write to DB
  apiFetch('admin.php','POST',{action:'set_setting',key:'debug_mode',value:on?'1':'0'}).then(function(d){
    if(d && d.success){
      localStorage.setItem('hdbs_debug', on ? '1' : '0');
      if(lbl) lbl.innerHTML = on ? '<strong style="color:#c62828">ON — writing to error_log.txt</strong>' : 'OFF';
    } else {
      if(lbl) lbl.textContent = 'Save failed';
      console.error('setDebugMode failed:', d);
    }
  }).catch(function(e){
    if(lbl) lbl.textContent = 'Save failed';
    console.error('setDebugMode error:', e);
  });
}

