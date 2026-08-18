// ── ADMIN: COUPONS ──
var COUPON_TEMPLATE=null;
var COUPONS_LIST=[];

// Stored/sorted as ISO (YYYY-MM-DD); displayed as MM/DD/YYYY.
function fmtCouponDate(iso){
  if(!iso)return '';
  var parts=iso.split('-');
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
    return '<tr><td><code style="color:#a07810">'+c.code+'</code></td><td>'+typeLabel+'</td><td style="text-align:center">'+c.created+'</td><td style="text-align:center">'+c.used+'</td>'+
      '<td>'+expLabel+'</td><td>'+statusBadge+'</td>'+
      '<td><button class="be" onclick="printCoupon(\''+c.code+'\')">Print</button> '+
      (c.active?'<button class="bd" onclick="deactivateCoupon(\''+c.code+'\')">Deactivate</button>':'')+
      '</td></tr>';
  }).join('');

  var tplPreview=COUPON_TEMPLATE?'<img src="'+COUPON_TEMPLATE+'" style="max-width:220px;max-height:130px;border-radius:6px;border:1px solid #e8e0b8;display:block;margin-bottom:.5rem">'
    :'<div style="width:220px;height:130px;background:#fdf3d0;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#a07810;font-size:.78rem;margin-bottom:.5rem">No image yet</div>';

  el.innerHTML=
    '<div style="max-width:1000px;margin:0 auto">'+
    '<div class="acct-card" style="margin-bottom:1rem">'+
      '<div class="acct-title">🖼️ Coupon Template</div>'+
      '<p style="font-size:.82rem;color:#6b6040;margin:.2rem 0 .8rem">One background image is used for every coupon. The amount/percent and code are printed on top at Print time.</p>'+
      tplPreview+
      '<input type="file" accept="image/png,image/jpeg" id="cb-tpl" style="font-size:.78rem" onchange="uploadCouponTemplate(this)">'+
    '</div>'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">'+
      '<div style="font-size:.88rem;color:#6b6040">'+COUPONS_LIST.length+' coupon'+(COUPONS_LIST.length!==1?'s':'')+'</div>'+
      '<button class="bp" onclick="toggleCouponForm()">+ Create Coupon</button>'+
    '</div>'+
    '<div id="cb-form" style="display:none;margin-bottom:1rem"></div>'+
    '<table class="tablekit"><thead><tr><th>Code</th><th>Type</th><th>Created</th><th>Used</th><th>Expires</th><th>Status</th><th>Actions</th></tr></thead><tbody>'+
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

function toggleCouponForm(){
  var f=document.getElementById('cb-form');
  if(!f)return;
  if(f.style.display==='block'){f.style.display='none';return;}
  f.style.display='block';
  f.innerHTML=
    '<div class="acct-card">'+
    '<div class="acct-title">New Coupon</div>'+
    '<label class="fl">Code (optional — leave blank to auto-generate)</label>'+
    '<input class="fi" id="cb-code" placeholder="e.g. SUMMER25" style="width:100%;text-transform:uppercase;margin-bottom:.6rem">'+
    '<label class="fl">Percent off (1-100)</label>'+
    '<input class="fi" id="cb-amount" type="number" min="0.01" step="0.01" style="width:100%;margin-bottom:.6rem">'+
    '<label class="fl">Quantity (max number of times this code can be used)</label>'+
    '<input class="fi" id="cb-quantity" type="number" min="1" value="1" style="width:100%;margin-bottom:.6rem">'+
    '<label class="fl">Expiration date (optional)</label>'+
    '<input class="fi" id="cb-expires" type="date" style="width:100%;margin-bottom:.8rem">'+
    '<div class="merr" id="cb-err" style="display:none"></div>'+
    '<button class="bp" onclick="submitCoupon()">Create Coupon</button> '+
    '<button class="be" onclick="toggleCouponForm()">Cancel</button>'+
    '</div>';
}

function submitCoupon(){
  var code=(document.getElementById('cb-code').value||'').trim().toUpperCase();
  var amount=parseFloat(document.getElementById('cb-amount').value);
  var quantity=parseInt(document.getElementById('cb-quantity').value,10);
  var expires=document.getElementById('cb-expires').value||null;
  var err=document.getElementById('cb-err');err.style.display='none';
  if(!(amount>0&&amount<=100)){err.textContent='Please enter a percent between 1 and 100.';err.style.display='block';return;}
  if(!(quantity>=1)){err.textContent='Please enter a quantity of at least 1.';err.style.display='block';return;}
  apiFetch('coupons.php','POST',{action:'create',code:code||undefined,coupon_type:'percent',amount:amount,quantity:quantity,expires_at:expires}).then(function(d){
    if(!d||!d.success){err.textContent=(d&&d.error)||'Could not create coupon.';err.style.display='block';return;}
    rCoupons(document.getElementById('acnt'));
  }).catch(function(){err.textContent='Network error.';err.style.display='block';});
}

function deactivateCoupon(code){
  if(!confirm('Deactivate coupon "'+code+'"? Any remaining balance/uses will stop working.'))return;
  apiFetch('coupons.php','POST',{action:'deactivate',code:code}).then(function(){
    rCoupons(document.getElementById('acnt'));
  }).catch(function(){alert('Network error.');});
}

// ── PRINT: overlay the amount/percent + code onto the shared template image, `quantity` copies
// (one code, printed as many times as it's allowed to be used), laid out in a new print window. ──
function printCoupon(code){
  var coupon=COUPONS_LIST.filter(function(c){return c.code===code;})[0];
  if(!coupon)return;
  if(!COUPON_TEMPLATE){alert('Please upload a coupon template image first.');return;}

  var img=new Image();
  img.crossOrigin='anonymous';
  img.onload=function(){renderPrintableCoupons(img,coupon);};
  img.onerror=function(){alert('Could not load the coupon template image.');};
  img.src=COUPON_TEMPLATE;
}

function renderPrintableCoupons(img,coupon){
  var label=Number(coupon.amount)+'% OFF';
  var canvas=document.createElement('canvas');
  canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
  var ctx=canvas.getContext('2d');
  ctx.drawImage(img,0,0);
  var fontSize=Math.round(canvas.height*0.16);
  ctx.font='bold '+fontSize+'px Arial, sans-serif';
  ctx.fillStyle='#a07810';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(label,canvas.width/2,canvas.height*0.42);
  var codeFontSize=Math.round(canvas.height*0.08);
  ctx.font='bold '+codeFontSize+'px monospace';
  ctx.fillStyle='#2d2220';
  ctx.fillText(coupon.code,canvas.width/2,canvas.height*0.68);
  var src=canvas.toDataURL('image/png');

  var copies=Math.max(1,Math.min(Number(coupon.created)||1,500));
  var imgs=[];for(var i=0;i<copies;i++)imgs.push('<img src="'+src+'" style="width:3.5in;margin:.15in;display:inline-block">');

  var win=window.open('','_blank');
  if(!win){alert('Please allow pop-ups to print coupons.');return;}
  win.document.write('<!DOCTYPE html><html><head><title>Print Coupon '+coupon.code+'</title><style>body{margin:0;padding:.25in;text-align:center}</style></head><body>'+imgs.join('')+'</body></html>');
  win.document.close();
  win.onload=function(){win.focus();win.print();};
}
