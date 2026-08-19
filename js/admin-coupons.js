// ── ADMIN: COUPONS ──
// A coupon is a named batch that generates `quantity` distinct, single-use random codes (one
// printed per physical copy) — the batch's own id/name is never itself redeemable.
var COUPON_TEMPLATE=null;
var COUPONS_LIST=[];
var COUPON_EDIT_ID=null; // non-null while #cb-form is in "edit" mode, holds the batch id being edited

// Stored/sorted as ISO (YYYY-MM-DD); displayed as MM/DD/YYYY.
function fmtCouponDate(iso){
  if(!iso)return '';
  var parts=iso.slice(0,10).split('-');
  if(parts.length!==3)return iso;
  return parts[1]+'/'+parts[2]+'/'+parts[0];
}

function rCoupons(el){
  el.innerHTML='<div style="padding:2rem;text-align:center;color:#6b6040">Loading coupons…</div>';
  Promise.all([
    apiFetch('coupons.php','POST',{action:'get_template'}),
    apiFetch('coupons.php','POST',{action:'list'})
  ]).then(function(res){
    COUPON_TEMPLATE=res[0]&&res[0].image;
    COUPONS_LIST=(res[1]&&res[1].coupons)||[];
    renderCouponsScreen(el);
  }).catch(function(){
    el.innerHTML='<p style="color:#c0392b;padding:2rem;text-align:center">Could not load coupons.</p>';
  });
}

function renderCouponsScreen(el){
  var rows=COUPONS_LIST.map(function(c){
    var typeLabel=Number(c.amount)+'% off';
    var expLabel=c.expires_at?fmtCouponDate(c.expires_at):'No expiration';
    var statusBadge=c.active?'<span class="badge bg">Active</span>':'<span class="badge br">Inactive</span>';
    return '<tr><td>'+c.name+'</td><td>'+typeLabel+'</td><td style="text-align:center">'+c.created+'</td><td style="text-align:center">'+c.used+'</td>'+
      '<td>'+expLabel+'</td><td>'+statusBadge+'</td>'+
      '<td style="white-space:nowrap">'+
      '<button class="be" onclick="printCoupon('+c.id+')">Print</button> '+
      '<button class="be" onclick="viewCouponCodes('+c.id+')">View</button> '+
      '<button class="be" onclick="editCouponForm('+c.id+')">Edit</button> '+
      (c.active?'<button class="bd" onclick="deactivateCoupon('+c.id+')">Deactivate</button> ':'')+
      (c.used===0?'<button class="bd" onclick="deleteCouponConfirm('+c.id+')">Delete</button>':'')+
      '</td></tr>';
  }).join('');

  var tplPreview=COUPON_TEMPLATE?'<img src="'+COUPON_TEMPLATE+'" style="max-width:220px;max-height:130px;border-radius:6px;border:1px solid #e8e0b8;display:block;margin-bottom:.5rem">'
    :'<div style="width:220px;height:130px;background:#fdf3d0;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#a07810;font-size:.78rem;margin-bottom:.5rem">No image yet</div>';

  el.innerHTML=
    '<div style="max-width:1000px;margin:0 auto">'+
    '<div class="acct-card" style="margin-bottom:1rem">'+
      '<div class="acct-title">🖼️ Coupon Template</div>'+
      '<p style="font-size:.82rem;color:#6b6040;margin:.2rem 0 .8rem">One background image is used for every coupon. Each generated code and its percent are printed on top at Print time.</p>'+
      tplPreview+
      '<input type="file" accept="image/png,image/jpeg" id="cb-tpl" style="font-size:.78rem" onchange="uploadCouponTemplate(this)">'+
    '</div>'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">'+
      '<div style="font-size:.88rem;color:#6b6040">'+COUPONS_LIST.length+' coupon'+(COUPONS_LIST.length!==1?'s':'')+'</div>'+
      '<button class="bp" onclick="toggleCouponForm()">+ Create Coupon</button>'+
    '</div>'+
    '<div id="cb-form" style="display:none;margin-bottom:1rem"></div>'+
    '<div id="cb-view" style="display:none;margin-bottom:1rem"></div>'+
    '<table class="tablekit"><thead><tr><th>Name</th><th>Type</th><th>Created</th><th>Used</th><th>Expires</th><th>Status</th><th>Actions</th></tr></thead><tbody>'+
    (rows||'<tr><td colspan="7" style="text-align:center;padding:2rem;color:#6b6040">No coupons yet.</td></tr>')+
    '</tbody></table>'+
    '</div>';
  if(typeof TableKit!=='undefined')TableKit.initAll();
  showPageToolbar({title:'Coupons',logoText:(window.BIZ_NAME||'Handmade Designs By Suzi')});
}

function uploadCouponTemplate(input){
  var file=input.files&&input.files[0];
  if(!file)return;
  var reader=new FileReader();
  reader.onload=function(){
    apiFetch('coupons.php','POST',{action:'upload_template',image:reader.result}).then(function(d){
      if(d&&d.success){COUPON_TEMPLATE=d.path;renderCouponsScreen(document.getElementById('acnt'));}
      else alert((d&&d.error)||'Upload failed.');
    }).catch(function(){alert('Network error uploading image.');});
  };
  reader.readAsDataURL(file);
}

function closeCouponForm(){
  var f=document.getElementById('cb-form');
  if(f){f.style.display='none';f.innerHTML='';}
  COUPON_EDIT_ID=null;
}

function toggleCouponForm(){
  var f=document.getElementById('cb-form');
  if(!f)return;
  if(f.style.display==='block'&&!COUPON_EDIT_ID){closeCouponForm();return;}
  COUPON_EDIT_ID=null;
  hideCouponView();
  f.style.display='block';
  f.innerHTML=
    '<div class="acct-card">'+
    '<div class="acct-title">New Coupon</div>'+
    '<label class="fl">Coupon name (for your own reference — not shown to customers)</label>'+
    '<input class="fi" id="cb-name" placeholder="e.g. Fall Sale Flyer" style="width:100%;margin-bottom:.6rem">'+
    '<label class="fl">Percent off (1-100)</label>'+
    '<input class="fi" id="cb-amount" type="number" min="0.01" step="0.01" style="width:100%;margin-bottom:.6rem">'+
    '<label class="fl">Quantity (how many distinct codes to generate, 1-500)</label>'+
    '<input class="fi" id="cb-quantity" type="number" min="1" max="500" value="1" style="width:100%;margin-bottom:.6rem">'+
    '<label class="fl">Expiration date (optional)</label>'+
    '<input class="fi" id="cb-expires" type="date" style="width:100%;margin-bottom:.8rem">'+
    '<div class="merr" id="cb-err" style="display:none"></div>'+
    '<button class="bp" onclick="submitCoupon()">Create Coupon</button> '+
    '<button class="be" onclick="closeCouponForm()">Cancel</button>'+
    '</div>';
}

function editCouponForm(id){
  var coupon=COUPONS_LIST.filter(function(c){return c.id===id;})[0];
  if(!coupon)return;
  COUPON_EDIT_ID=id;
  hideCouponView();
  var f=document.getElementById('cb-form');
  if(!f)return;
  f.style.display='block';
  f.innerHTML=
    '<div class="acct-card">'+
    '<div class="acct-title">Edit Coupon: '+coupon.name+'</div>'+
    '<p style="font-size:.78rem;color:#6b6040;margin:.2rem 0 .8rem">Name and quantity can\'t be changed once codes have been generated.</p>'+
    '<label class="fl">Percent off (1-100)</label>'+
    '<input class="fi" id="cb-amount" type="number" min="0.01" step="0.01" value="'+coupon.amount+'" style="width:100%;margin-bottom:.6rem">'+
    '<label class="fl">Expiration date (optional)</label>'+
    '<input class="fi" id="cb-expires" type="date" value="'+(coupon.expires_at?coupon.expires_at.slice(0,10):'')+'" style="width:100%;margin-bottom:.8rem">'+
    '<div class="merr" id="cb-err" style="display:none"></div>'+
    '<button class="bp" onclick="submitCoupon()">Save Changes</button> '+
    '<button class="be" onclick="closeCouponForm()">Cancel</button>'+
    '</div>';
}

function submitCoupon(){
  var amount=parseFloat(document.getElementById('cb-amount').value);
  var expires=document.getElementById('cb-expires').value||null;
  var err=document.getElementById('cb-err');err.style.display='none';
  if(!(amount>0&&amount<=100)){err.textContent='Please enter a percent between 1 and 100.';err.style.display='block';return;}

  if(COUPON_EDIT_ID){
    apiFetch('coupons.php','POST',{action:'update',id:COUPON_EDIT_ID,amount:amount,expires_at:expires}).then(function(d){
      if(!d||!d.success){err.textContent=(d&&d.error)||'Could not update coupon.';err.style.display='block';return;}
      COUPON_EDIT_ID=null;
      rCoupons(document.getElementById('acnt'));
    }).catch(function(){err.textContent='Network error.';err.style.display='block';});
    return;
  }

  var name=(document.getElementById('cb-name').value||'').trim();
  var quantity=parseInt(document.getElementById('cb-quantity').value,10);
  if(!name){err.textContent='Please enter a name for this coupon.';err.style.display='block';return;}
  if(!(quantity>=1&&quantity<=500)){err.textContent='Please enter a quantity between 1 and 500.';err.style.display='block';return;}
  apiFetch('coupons.php','POST',{action:'create',name:name,amount:amount,quantity:quantity,expires_at:expires}).then(function(d){
    if(!d||!d.success){err.textContent=(d&&d.error)||'Could not create coupon.';err.style.display='block';return;}
    rCoupons(document.getElementById('acnt'));
  }).catch(function(){err.textContent='Network error.';err.style.display='block';});
}

function deactivateCoupon(id){
  if(!confirm('Deactivate this coupon? Any unused codes will stop working.'))return;
  apiFetch('coupons.php','POST',{action:'deactivate',id:id}).then(function(){
    rCoupons(document.getElementById('acnt'));
  }).catch(function(){alert('Network error.');});
}

function deleteCouponConfirm(id){
  if(!confirm('Permanently delete this coupon and all its unused codes? This cannot be undone.'))return;
  apiFetch('coupons.php','POST',{action:'delete',id:id}).then(function(d){
    if(!d||!d.success){alert((d&&d.error)||'Could not delete coupon.');return;}
    rCoupons(document.getElementById('acnt'));
  }).catch(function(){alert('Network error.');});
}

function hideCouponView(){
  var v=document.getElementById('cb-view');
  if(v){v.style.display='none';v.innerHTML='';}
}

// ── VIEW: every generated code, used and unused; for used codes, which sale it went to ──
function viewCouponCodes(id){
  closeCouponForm();
  var coupon=COUPONS_LIST.filter(function(c){return c.id===id;})[0];
  var v=document.getElementById('cb-view');
  if(!v)return;
  v.style.display='block';
  v.innerHTML='<div class="acct-card"><div class="acct-title">Codes: '+(coupon?coupon.name:'')+'</div>'+
    '<div style="padding:1rem;text-align:center;color:#6b6040">Loading…</div></div>';
  apiFetch('coupons.php','POST',{action:'codes',id:id}).then(function(d){
    var codes=(d&&d.codes)||[];
    var rows=codes.map(function(c){
      var statusBadge=c.used?'<span class="badge br">Used</span>':'<span class="badge bg">Unused</span>';
      var orderCell=c.order_id?'<code style="color:#a07810;cursor:pointer;text-decoration:underline" onclick="viewOrder(\''+c.order_id+'\')" title="View order">'+c.order_id+'</code>':'';
      return '<tr><td><code style="color:#a07810">'+c.code+'</code></td><td>'+statusBadge+'</td>'+
        '<td>'+orderCell+'</td><td>'+(c.email||(c.used?'Guest':''))+'</td>'+
        '<td style="text-align:right">'+(c.discount!==null?'$'+Number(c.discount).toFixed(2):'')+'</td>'+
        '<td>'+fmtMDYT(c.date)+'</td></tr>';
    }).join('');
    v.innerHTML='<div class="acct-card">'+
      '<div class="acct-title">Codes: '+(coupon?coupon.name:'')+'</div>'+
      (codes.length?
        '<table class="tablekit"><thead><tr><th>Code</th><th>Status</th><th>Order</th><th>Customer</th><th>Discount</th><th>Date Used</th></tr></thead><tbody>'+rows+'</tbody></table>'
        :'<p style="color:#6b6040;padding:1rem 0">No codes found.</p>')+
      '<button class="be" style="margin-top:.8rem" onclick="hideCouponView()">Close</button>'+
      '</div>';
    if(typeof TableKit!=='undefined')TableKit.initAll();
  }).catch(function(){
    v.innerHTML='<div class="acct-card"><p style="color:#c0392b">Could not load codes.</p><button class="be" onclick="hideCouponView()">Close</button></div>';
  });
}

// ── PRINT: one physical coupon per generated code, each with its own unique code + percent
// overlaid on the shared template image, laid out in a new print window. ──
function printCoupon(id){
  var coupon=COUPONS_LIST.filter(function(c){return c.id===id;})[0];
  if(!coupon)return;
  if(!COUPON_TEMPLATE){alert('Please upload a coupon template image first.');return;}

  apiFetch('coupons.php','POST',{action:'codes',id:id}).then(function(d){
    var codes=((d&&d.codes)||[]).map(function(c){return c.code;});
    if(!codes.length){alert('No codes found for this coupon.');return;}
    var img=new Image();
    img.crossOrigin='anonymous';
    img.onload=function(){renderPrintableCoupons(img,coupon,codes);};
    img.onerror=function(){alert('Could not load the coupon template image.');};
    img.src=COUPON_TEMPLATE;
  }).catch(function(){alert('Could not load this coupon\'s codes.');});
}

function renderPrintableCoupons(img,coupon,codes){
  // The template's own artwork has two blank fields: "____ off the merchandise total" (percent)
  // and "COUPON CODE:____" (code) — both filled in here, one distinct code per copy.
  var imgs=codes.map(function(code){
    var canvas=document.createElement('canvas');
    canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
    var ctx=canvas.getContext('2d');
    ctx.drawImage(img,0,0);
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.font='bold '+Math.round(canvas.height*0.045)+'px Arial, sans-serif';
    ctx.fillStyle='#2d2220';
    ctx.fillText(Number(coupon.amount)+'%',canvas.width*0.195,canvas.height*0.605);
    ctx.font='bold '+Math.round(canvas.height*0.035)+'px monospace';
    ctx.fillText(code,canvas.width*0.195,canvas.height*0.755);
    return '<img src="'+canvas.toDataURL('image/png')+'" style="width:3.5in;margin:.15in;display:inline-block">';
  });

  var win=window.open('','_blank');
  if(!win){alert('Please allow pop-ups to print coupons.');return;}
  win.document.write('<!DOCTYPE html><html><head><title>Print Coupon: '+coupon.name+'</title><style>body{margin:0;padding:.25in;text-align:center}</style></head><body>'+imgs.join('')+'</body></html>');
  win.document.close();
  win.onload=function(){
    win.focus();
    win.onafterprint=function(){win.close();};
    win.print();
  };
}
