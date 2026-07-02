// ── PRODUCT ADMIN ──
var PROD_SORT={col:'name',dir:1};
var PROD_F={name:'',cat:'',sku:'',size:'',sell:'',status:''};

function prodSort(col){if(PROD_SORT.col===col)PROD_SORT.dir*=-1;else PROD_SORT={col:col,dir:1};rProds(document.getElementById('acnt'));}

function prodFilt(e,col){
  e.stopPropagation();
  document.querySelectorAll('.prod-fp').forEach(function(p){p.remove();});
  var th=e.target.closest('th');th.style.position='relative';
  var pop=document.createElement('div');
  pop.className='prod-fp';
  pop.style.cssText='position:absolute;top:100%;left:0;background:#fff;border:1.5px solid #e8e0b8;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.18);z-index:300;min-width:200px;padding:0;overflow:hidden';
  var allVals=[];var seen={};
  for(var i=0;i<PRODS.length;i++){
    var p=PRODS[i];
    var v=col==='status'?(p.stock>5?'In Stock':p.stock>0?'Low Stock':'Out of Stock'):String(p[col]||'(blank)');
    if(!seen[v]){seen[v]=true;allVals.push(v);}
  }
  allVals.sort();
  var selVals=PROD_F[col]?PROD_F[col].split(' '):null;
  var listId='prod-flist-'+col;
  var checkboxes=allVals.map(function(v){
    var chk=(selVals===null||selVals.indexOf(v)>=0)?'checked':'';
    return '<label style="display:flex;align-items:center;gap:.4rem;padding:.25rem .4rem;cursor:pointer;border-radius:4px;font-size:.8rem;color:#2d2220" onmouseover="this.style.background=\'#fffdf0\'" onmouseout="this.style.background=\'\'"><input type="checkbox" value="'+v.replace(/"/g,'&quot;')+'" '+chk+'><span>'+v+'</span></label>';
  }).join('');
  pop.innerHTML=
    '<div style="padding:.5rem .7rem;background:#f9f4e4;border-bottom:1px solid #e8e0b8;font-size:.72rem;font-weight:700;color:#a07810;text-transform:uppercase">Filter: '+col+'</div>'+
    '<div style="padding:.3rem .4rem;border-bottom:1px solid #f0e8d0;display:flex;gap:.5rem">'+
      '<button style="font-size:.72rem;color:#a07810;background:none;border:none;cursor:pointer" onclick="prodFiltAll(\''+listId+'\',true)">All</button>'+
      '<span style="color:#e8e0b8">|</span>'+
      '<button style="font-size:.72rem;color:#a07810;background:none;border:none;cursor:pointer" onclick="prodFiltAll(\''+listId+'\',false)">None</button>'+
    '</div>'+
    '<div id="'+listId+'" style="max-height:200px;overflow-y:auto;padding:.2rem .3rem">'+checkboxes+'</div>'+
    '<div style="padding:.5rem .7rem;border-top:1px solid #f0e8d0;display:flex;justify-content:space-between">'+
      '<button style="font-size:.72rem;color:#6b6040;background:none;border:none;cursor:pointer" onclick="this.closest(\'.prod-fp\').remove()">Close</button>'+
      '<button style="font-size:.78rem;background:#d4a017;color:#fff;border:none;border-radius:6px;padding:.3rem .8rem;cursor:pointer;font-weight:600" onclick="prodFiltApply(\''+col+'\',this)">Apply</button>'+
    '</div>';
  th.appendChild(pop);
  setTimeout(function(){document.addEventListener('click',function h(ev){if(!pop.contains(ev.target)){pop.remove();document.removeEventListener('click',h);}});},50);
}

function prodFiltAll(listId,chk){document.querySelectorAll('#'+listId+' input[type=checkbox]').forEach(function(c){c.checked=chk;});}

function prodFiltApply(col,btn){
  var pop=btn.closest('.prod-fp');
  var list=pop?pop.querySelector('[id^="prod-flist-"]'):null;
  if(!list)return;
  var checked=[],all=[];
  list.querySelectorAll('input[type=checkbox]').forEach(function(c){all.push(c.value);if(c.checked)checked.push(c.value);});
  PROD_F[col]=(checked.length===all.length)?'':checked.length===0?'__NONE__':checked.join(' ');
  pop.remove();
  rProds(document.getElementById('acnt'));
}

function applyProdFilters(){
  var result=PRODS.filter(function(p){
    function chk(fval,oval){if(!fval)return true;if(fval==='__NONE__')return false;return fval.split(' ').indexOf(String(oval||'(blank)'))>=0;}
    if(PROD_F.name&&!chk(PROD_F.name,p.name))return false;
    if(PROD_F.cat&&!chk(PROD_F.cat,p.cat))return false;
    if(PROD_F.sku&&!chk(PROD_F.sku,p.sku||'(blank)'))return false;
    if(PROD_F.size&&!chk(PROD_F.size,p.size||'(blank)'))return false;
    if(PROD_F.sell&&!chk(PROD_F.sell,p.sell!==0?'For Sale':'Hidden'))return false;
    if(PROD_F.status){var st=p.stock>5?'In Stock':p.stock>0?'Low Stock':'Out of Stock';if(!chk(PROD_F.status,st))return false;}
    return true;
  });
  var sc=PROD_SORT.col,sd=PROD_SORT.dir;
  if(sc)result.sort(function(a,b){
    var av=a[sc]!==undefined?a[sc]:'',bv=b[sc]!==undefined?b[sc]:'';
    if(typeof av==='number'&&typeof bv==='number')return sd*(av-bv);
    return sd*String(av).localeCompare(String(bv));
  });
  return result;
}

function buildProdThead(){
  return '<thead><tr><th>Product</th><th>Cat</th><th>SKU</th><th>Sell</th><th>Price</th><th>Size</th><th>Weight</th><th>Shipping</th><th>Stock</th><th>Description</th><th>Actions</th></tr></thead>';
}

function rProds(el){
  var filtered=applyProdFilters();
  var rows='';
  for(var i=0;i<filtered.length;i++){
    var p=filtered[i];var thumb=firstImg(p);
    rows+='<tr ondblclick="showPF(\''+p.id+'\')" style="cursor:pointer"><td><div style="display:flex;align-items:center;gap:.6rem">'+(thumb?'<img src="'+thumb+'" style="width:36px;height:36px;border-radius:6px;object-fit:cover;flex-shrink:0">':'<span style="font-size:1.3rem">👜</span>')+'<strong>'+p.name+'</strong>'+(p.coming_soon?' <span style="background:#B88A44;color:#fff;font-size:.6rem;padding:1px 6px;border-radius:10px;letter-spacing:.04em;vertical-align:middle">SOON</span>':'')+'</div></td>'+
      '<td>'+parseCats(p.cat).join(', ')+'</td>'+
      '<td style="font-family:monospace;font-size:.78rem;color:#a07810">'+(p.sku||'—')+'</td>'+
      '<td style="text-align:center"><input type="checkbox" '+(p.sell!==0?'checked':'')+' onchange="toggleSell(\''+p.id+'\',this.checked)"></td>'+
      '<td style="font-weight:700">$'+p.price.toFixed(2)+'</td>'+
      '<td style="font-size:.78rem;color:#6b6040">'+(p.size||'—')+'</td>'+
      '<td style="font-size:.78rem;color:#6b6040;text-align:center">'+(p.weight?p.weight+' lbs':'—')+'</td>'+
      '<td style="font-size:.78rem;color:#6b6040;text-align:center">'+(p.ship_mode==='fixed'?'Fixed $'+(parseFloat(p.ship_fixed)||0).toFixed(2):'By weight')+'</td>'+
      '<td style="text-align:center;font-weight:600">'+(p.stock||0)+'</td>'+
      '<td style="font-size:.75rem;color:#6b6040;max-width:220px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis" title="'+(p.desc||'').replace(/"/g,'&quot;')+'">'+(p.desc||'—')+'</td>'+
      '<td><button class="be" onclick="showPF(\''+p.id+'\')">Edit</button> <button class="bd" onclick="delP(\''+p.id+'\')">Delete</button></td></tr>';
  }
  var isFiltered=PROD_F.name||PROD_F.cat||PROD_F.sku||PROD_F.status;
  el.innerHTML=
    '<div style="display:flex;gap:.6rem;margin-bottom:.8rem;flex-wrap:wrap;align-items:center">'+
      '<div id="pf-action-btns"><button class="bp" onclick="showPF(null)">+ Add Product</button></div>'+
      '<button class="bs" onclick="setAllStock1()">📦 Set All Inventory to 1</button>'+
      '<button class="bs" onclick="setAllPrice1()">💲 Set All Prices to $1</button>'+
      '<button class="bs" onclick="autoAssignSkus()" title="Auto-assign SKUs to products missing one">🏷️ Auto-assign SKUs</button>'+
      (isFiltered?'<button class="bs" onclick="PROD_F={name:\'\',cat:\'\',sku:\'\',status:\'\'};rProds(document.getElementById(\'acnt\'))" style="color:#c62828">✕ Clear Filters</button>':'')+
      '<span style="font-size:.78rem;color:#6b6040;margin-left:auto">'+filtered.length+' of '+PRODS.length+' products</span>'+
    '</div>'+
    '<div id="pfc"></div>'+
    '<div style="overflow-x:auto"><table class="tablekit">'+buildProdThead()+'<tbody>'+(rows||'<tr><td colspan="7" style="text-align:center;padding:1.5rem;color:#6b6040">No products</td></tr>')+'</tbody></table></div>';
  if(typeof TableKit!=='undefined')TableKit.initAll();
  // onExport overrides the toolbar's generic table export (which would include the Actions
  // column and no image URLs) with the clean products_csv.php export.
  showPageToolbar({title:'Product Management',logoText:(window.BIZ_NAME||'Handmade Designs By Suzi'),onExport:exportProductsCsv,onImport:showImportCsv});
}

function exportProductsCsv(){
  // products_csv.php requires the X-Admin-Token header, so a plain navigation would 401.
  // Fetch with the token and download the blob. This CSV has NO Actions column and
  // includes the image URLs (img1/img2/img3).
  fetch(API+'/products_csv.php',{headers:{'X-Admin-Token':window._adminToken||''}})
    .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.blob();})
    .then(function(blob){
      var url=URL.createObjectURL(blob);
      var a=document.createElement('a');
      a.href=url;a.download='products_'+new Date().toISOString().slice(0,10)+'.csv';
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(function(){URL.revokeObjectURL(url);},1000);
    })
    .catch(function(e){alert('Export failed: '+e.message);});
}

function showImportCsv(){
  var existing=document.getElementById('import-csv-modal');
  if(existing)existing.remove();
  var ov=document.createElement('div');
  ov.id='import-csv-modal';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
  ov.onclick=function(e){if(e.target===ov)ov.remove();};
  ov.innerHTML=
    '<div style="background:#fff;border-radius:12px;padding:1.5rem;width:440px;max-width:100%;box-shadow:0 8px 40px rgba(0,0,0,.3)">'+
      '<div style="font-size:1rem;font-weight:700;color:#2d2220;margin-bottom:1rem">⬆️ Import Products CSV</div>'+
      '<div style="font-size:.8rem;color:#6b6040;margin-bottom:.8rem">CSV must have columns: <code>id, sku, name, description, price, stock, category, badge, weight, size, img1, img2, img3</code></div>'+
      '<div style="margin-bottom:.8rem">'+
        '<label style="font-size:.8rem;font-weight:600;color:#2d2220;display:block;margin-bottom:.3rem">CSV File</label>'+
        '<input type="file" id="import-csv-file" accept=".csv" style="width:100%;font-size:.83rem">'+
      '</div>'+
      '<div style="margin-bottom:1rem">'+
        '<label style="font-size:.8rem;font-weight:600;color:#2d2220;display:block;margin-bottom:.4rem">Import Mode</label>'+
        '<label style="display:flex;align-items:center;gap:.5rem;font-size:.83rem;margin-bottom:.3rem;cursor:pointer">'+
          '<input type="radio" name="import-mode" value="merge" checked> Merge — add/update products, keep existing</label>'+
        '<label style="display:flex;align-items:center;gap:.5rem;font-size:.83rem;cursor:pointer">'+
          '<input type="radio" name="import-mode" value="replace"> Replace — delete ALL products first, then import</label>'+
      '</div>'+
      '<div id="import-csv-msg" style="font-size:.8rem;margin-bottom:.6rem;min-height:1.2em"></div>'+
      '<div style="display:flex;gap:.6rem;justify-content:flex-end">'+
        '<button class="bs" onclick="document.getElementById(\'import-csv-modal\').remove()">Cancel</button>'+
        '<button class="bp" onclick="doImportCsv()">Import</button>'+
      '</div>'+
    '</div>';
  document.body.appendChild(ov);
}

function doImportCsv(){
  var file=document.getElementById('import-csv-file');
  var msg=document.getElementById('import-csv-msg');
  var modeEl=document.querySelector('input[name="import-mode"]:checked');
  if(!file||!file.files[0]){msg.style.color='#c62828';msg.textContent='Please select a CSV file.';return;}
  var mode=modeEl?modeEl.value:'merge';
  if(mode==='replace'&&!confirm('WARNING: This will DELETE ALL existing products before importing. Continue?'))return;
  msg.style.color='#a07810';msg.textContent='Importing…';
  var fd=new FormData();
  fd.append('csv',file.files[0]);
  fd.append('mode',mode);
  fetch(API+'/products_csv.php',{method:'POST',body:fd,headers:{'X-Admin-Token':window._adminToken||''}})
  .then(function(r){return r.json();})
  .then(function(d){
    if(d.success){
      msg.style.color='#2e7d32';
      msg.textContent='✓ Imported '+d.imported+' products ('+d.mode+' mode)';
      // Reload products and refresh
      apiFetch('products.php').then(function(r){
        if(r.success&&r.products){PRODS=r.products;renderStore();rProds(document.getElementById('acnt'));}
      });
      setTimeout(function(){var m=document.getElementById('import-csv-modal');if(m)m.remove();},2000);
    } else {
      msg.style.color='#c62828';
      msg.textContent='Error: '+(d.error||'Unknown error');
    }
  }).catch(function(e){msg.style.color='#c62828';msg.textContent='Network error: '+e.message;});
}

function toggleSell(id,checked){
  var p=findProd(id);if(!p)return;
  p.sell=checked?1:0;
  var obj=JSON.parse(JSON.stringify(p));
  apiFetch('products.php','POST',obj).catch(function(){});
  renderStore();
}

function autoAssignSkus(){
  var missing=PRODS.filter(function(p){return !p.sku||p.sku.trim()===''});
  if(missing.length===0){alert('All products already have SKUs.');return;}
  if(!confirm('Auto-assign SKUs to '+missing.length+' product(s) missing one?'))return;
  var total=missing.length,done=0;
  missing.forEach(function(p){
    var newSku=pfNextSku(p.cat);
    var obj=JSON.parse(JSON.stringify(p));obj.sku=newSku;
    apiFetch('products.php','POST',obj).then(function(){
      p.sku=newSku;
      if(++done===total){renderStore();rProds(document.getElementById('acnt'));}
    }).catch(function(){done++;});
  });
}

function setAllStock1(){
  if(!confirm('Set inventory to 1 for all '+PRODS.length+' products?'))return;
  var total=PRODS.length,done=0;
  PRODS.forEach(function(p){
    var obj=JSON.parse(JSON.stringify(p));obj.stock=1;
    apiFetch('products.php','POST',obj).then(function(){p.stock=1;if(++done===total){renderStore();rProds(document.getElementById('acnt'));}}).catch(function(){done++;});
  });
}
function setAllPrice1(){
  if(!confirm('Set price to $1.00 for all '+PRODS.length+' products?'))return;
  var total=PRODS.length,done=0;
  PRODS.forEach(function(p){
    var obj=JSON.parse(JSON.stringify(p));obj.price=1;
    apiFetch('products.php','POST',obj).then(function(){p.price=1;if(++done===total){renderStore();rProds(document.getElementById('acnt'));}}).catch(function(){done++;});
  });
}

function showPF(id){
  if(typeof _dbgLog==='function')_dbgLog('SCREEN', id ? 'Edit Product id='+id : 'Add Product form opened');
  var p=null;if(id)p=findProd(id);EDITID=id;
  // init edit photos
  if(p&&p.imgs)EDIT_PHOTOS=[p.imgs[0]||'',p.imgs[1]||'',p.imgs[2]||''];
  else if(p&&p.img)EDIT_PHOTOS=[p.img||'','',''];
  else EDIT_PHOTOS=['','',''];
  // Compute next sequence number for new products
  var nextSeq='';
  if(!p){
    var maxSeq=0;
    for(var s=0;s<PRODS.length;s++){var nm=parseInt(PRODS[s].name);if(!isNaN(nm)&&nm>maxSeq)maxSeq=nm;}
    nextSeq=String(maxSeq+1);
  }
  var pCats=parseCats(p?p.cat:'');
  var catChecks='';
  for(var j=0;j<CATS.length;j++)catChecks+='<label style="display:flex;align-items:center;gap:.4rem;font-size:.83rem;cursor:pointer;padding:.15rem 0"><input type="checkbox" id="pf-c-'+j+'" value="'+CATS[j]+'"'+(pCats.indexOf(CATS[j])>=0?' checked':'')+' onchange="pfAutoSku()"> '+CATS[j]+'</label>';
  document.getElementById('pfc').innerHTML=
    '<div class="pform"><div style="font-weight:700;margin-bottom:.9rem;font-size:1rem">'+(p?'Edit Product':'Add New Product')+'</div>'+
    '<div class="g2">'+
    '<div><label class="fl">Name *</label><input class="afi" id="pf-n" value="'+(p?p.name:nextSeq)+'" placeholder="Product name"></div>'+
    '<div><label class="fl">Category</label><div id="pf-cats" style="border:1px solid #d4c8a0;border-radius:6px;padding:.45rem .7rem;background:#fffdf0">'+catChecks+'</div></div>'+
    '<div><label class="fl">SKU</label>'+
      '<div style="display:flex;gap:.4rem;align-items:center">'+
        '<input class="afi" id="pf-sku" value="'+(p&&p.sku?p.sku:'')+'" placeholder="Auto-filled from category" style="margin:0;font-family:monospace">'+
        '<button class="bs" style="font-size:.75rem;padding:.25rem .6rem;white-space:nowrap" onclick="pfAutoSku()">Auto</button>'+
      '</div>'+
    '</div>'+
    '<div><label class="fl">Price ($) *</label><input class="afi" id="pf-p" type="number" step="0.01" value="'+(p?p.price:'1')+'"></div>'+
    '<div><label class="fl">Size / Dimensions</label><input class="afi" id="pf-sz" value="'+(p&&p.size?p.size:'')+'" placeholder="e.g. 14&quot; W x 16&quot; H x 4&quot; D"></div>'+
    '<div><label class="fl">Stock *</label><input class="afi" id="pf-s" type="number" value="'+(p?p.stock:'1')+'"></div>'+
    '<div><label class="fl">Badge</label><input class="afi" id="pf-b" value="'+(p?p.badge:'')+'" placeholder="e.g. New"></div>'+
    '<div><label class="fl">Weight (lbs)</label><input class="afi" id="pf-w" type="number" step="0.1" min="0" value="'+(p&&p.weight?p.weight:'')+'" placeholder="e.g. 1.5"></div>'+
    '<div><label class="fl">Shipping</label><select class="afi" id="pf-shipmode" onchange="pfToggleShipFixed()">'+
      '<option value="weight"'+(!p||p.ship_mode!=='fixed'?' selected':'')+'>By weight (zone + weight)</option>'+
      '<option value="fixed"'+(p&&p.ship_mode==='fixed'?' selected':'')+'>Fixed amount per item</option>'+
    '</select></div>'+
    '<div id="pf-shipfixed-wrap" style="display:'+(p&&p.ship_mode==='fixed'?'block':'none')+'"><label class="fl">Fixed shipping per unit</label>'+
      '<div style="display:flex;align-items:center;gap:.35rem">'+
        '<span style="font-weight:600;color:#6b6040">$</span>'+
        '<input class="afi" id="pf-shipfixed" type="number" step="0.01" min="0" style="margin:0" value="'+(p&&p.ship_fixed?(parseFloat(p.ship_fixed)||0).toFixed(2):'')+'" placeholder="0.00" onblur="if(this.value!==\'\')this.value=(parseFloat(this.value)||0).toFixed(2)">'+
      '</div>'+
    '</div>'+
    '<div style="display:flex;align-items:center;gap:.5rem;padding:.4rem 0">'+
      '<input type="checkbox" id="pf-sell" '+(p&&p.sell!==0?'checked':'')+'>'+
      '<label for="pf-sell" style="font-size:.83rem;color:#2d2220;cursor:pointer">List for sale on home page</label>'+
    '</div>'+
    '<div style="display:flex;align-items:center;gap:.5rem;padding:.4rem 0">'+
      '<input type="checkbox" id="pf-coming" '+(p&&p.coming_soon?'checked':'')+'>'+
      '<label for="pf-coming" style="font-size:.83rem;color:#2d2220;cursor:pointer">Coming Soon — tease on home page, not yet for sale</label>'+
    '</div>'+
    '</div>'+

    '<label class="fl">Description</label><textarea class="afi" id="pf-d" rows="3">'+(p?p.desc:'')+'</textarea>'+
    '<div style="margin-bottom:.5rem"><label class="fl">Product Photos (up to 3) — click a slot to add or change</label></div>'+
    '<div class="photo-slots" id="photo-slots">'+buildSlots()+'</div>'+
    '<div class="cam-wrap" id="cam-wrap">'+
      '<video id="camvid" style="width:100%;max-height:180px;border-radius:7px;display:block" autoplay playsinline></video>'+
      '<div style="display:flex;gap:.5rem;justify-content:center;margin-top:.7rem">'+
      '<button class="bp" style="font-size:.78rem;padding:.3rem .7rem" onclick="capPhoto()">📸 Capture</button>'+
      '<button class="bs" style="font-size:.78rem;padding:.3rem .7rem" onclick="stopCam()">✕ Stop Camera</button>'+
      '</div>'+
    '</div>'+
    '<div style="display:flex;gap:.6rem;margin-top:1rem">'+
      '<button class="bp" onclick="saveP()">💾 Save</button>'+
      '<button class="bs" onclick="cancelPF()">Cancel</button>'+
    '</div>'+
    '</div>';
  pfSetActionBtns(!!p);
  document.getElementById('pfc').scrollIntoView({behavior:'smooth',block:'start'});
  if(!id) setTimeout(pfAutoSku, 50);
  setTimeout(function(){var f=document.getElementById('pf-n');if(f)f.focus();},80);
}
function pfSetActionBtns(isEdit){
  var c=document.getElementById('pf-action-btns');
  if(!c)return;
  c.innerHTML='<button class="bp" onclick="saveP()">💾 Save</button> <button class="bs" onclick="cancelPF()">Cancel</button>';
}

function pfNextSku(cat){
  if(!cat)return'';
  var prefix=(CAT_PREFIXES&&CAT_PREFIXES[cat])?CAT_PREFIXES[cat]:cat.replace(/[^A-Za-z]/g,'').substring(0,3).toUpperCase();
  var existing=PRODS.filter(function(p){return p.sku&&p.sku.indexOf(prefix)===0;})
    .map(function(p){return parseInt(p.sku.replace(prefix,''))||0;});
  var autoNext=(existing.length>0?Math.max.apply(null,existing):0)+1;
  var overrideNum=(CAT_PREFIXES&&CAT_PREFIXES[cat+'__next']!==undefined)?parseInt(CAT_PREFIXES[cat+'__next']):null;
  var next=(overrideNum!==null)?overrideNum:autoNext;
  return prefix+String(next).padStart(3,'0');
}
function pfGetCats(){
  var result=[];
  for(var j=0;j<CATS.length;j++){var el=document.getElementById('pf-c-'+j);if(el&&el.checked)result.push(CATS[j]);}
  return result;
}
function pfToggleShipFixed(){var m=document.getElementById('pf-shipmode');var w=document.getElementById('pf-shipfixed-wrap');if(w)w.style.display=(m&&m.value==='fixed')?'block':'none';}
function pfAutoSku(){
  if(EDITID)return; // don't overwrite SKU on edit
  var cats=pfGetCats();
  var skuEl=document.getElementById('pf-sku');
  if(!skuEl)return;
  skuEl.value=cats.length?pfNextSku(cats[0]):'';
}
function buildSlots(){
  var h='';
  var labels=['Photo 1 (Main)','Photo 2','Photo 3'];
  for(var i=0;i<3;i++){
    var img=EDIT_PHOTOS[i];
    if(img){
      h+='<div class="photo-slot has-img" id="slot-'+i+'">'+
        '<span class="slot-label">'+(i===0?'Main':'#'+(i+1))+'</span>'+
        '<img src="'+img+'" alt="Photo '+(i+1)+'">'+
        '<div class="photo-slot-actions">'+
        '<button class="psa-btn" onclick="slotAction('+i+',\'cam\')">📷 Camera</button>'+
        '<button class="psa-btn" onclick="slotAction('+i+',\'upload\')">🖼 Upload</button>'+
        '<button class="psa-btn del" onclick="slotAction('+i+',\'del\')">🗑 Remove</button>'+
        '</div></div>';
    } else {
      h+='<div class="photo-slot" id="slot-'+i+'" onclick="slotAction('+i+',\'upload\')">'+
        '<span class="slot-label">'+(i===0?'Main':'#'+(i+1))+'</span>'+
        '<div class="photo-slot-empty"><span>+</span>'+labels[i]+'</div>'+
        '</div>';
    }
  }
  return h;
}

function refreshSlots(){document.getElementById('photo-slots').innerHTML=buildSlots();}

function slotAction(idx,action){
  ACTIVE_SLOT=idx;
  if(action==='del'){EDIT_PHOTOS[idx]='';stopCam();refreshSlots();return;}
  if(action==='cam'){startCam();return;}
  if(action==='upload'){
    var fi=document.getElementById('slot-file-input');
    fi.value='';fi.onchange=function(e){
      var f=e.target.files[0];if(!f)return;
      var r=new FileReader();r.onload=function(ev){EDIT_PHOTOS[ACTIVE_SLOT]=ev.target.result;refreshSlots();};r.readAsDataURL(f);
    };fi.click();
  }
}

function startCam(){
  var wrap=document.getElementById('cam-wrap');if(!wrap)return;
  wrap.classList.add('on');
  navigator.mediaDevices.getUserMedia({video:true}).then(function(s){
    CAMSTREAM=s;var v=document.getElementById('camvid');v.srcObject=s;
  }).catch(function(){alert('Camera unavailable. Please use upload.');wrap.classList.remove('on');});
}
function stopCam(){
  if(CAMSTREAM){CAMSTREAM.getTracks().forEach(function(t){t.stop();});CAMSTREAM=null;}
  var v=document.getElementById('camvid');if(v){v.srcObject=null;}
  var wrap=document.getElementById('cam-wrap');if(wrap)wrap.classList.remove('on');
}
function capPhoto(){
  var v=document.getElementById('camvid');if(!v||!v.srcObject)return;
  var c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);
  EDIT_PHOTOS[ACTIVE_SLOT]=c.toDataURL('image/jpeg',.82);
  stopCam();refreshSlots();
}

function cancelPF(){stopCam();EDITID=null;EDIT_PHOTOS=['','',''];document.getElementById('pfc').innerHTML='';var c=document.getElementById('pf-action-btns');if(c)c.innerHTML='<button class="bp" onclick="showPF(null)">+ Add Product</button>';}

function saveP(){
  var n=document.getElementById('pf-n').value.trim(),pr=parseFloat(document.getElementById('pf-p').value),st=parseInt(document.getElementById('pf-s').value);
  if(!n||isNaN(pr)||isNaN(st)){alert('Please fill in name, price, and stock.');return;}
  var wt=parseFloat(document.getElementById('pf-w').value)||0;
  var sz=document.getElementById('pf-sz').value.trim();
  var pfSku=document.getElementById('pf-sku');
  var skuVal=pfSku?pfSku.value.trim():'';
  var shipMode=document.getElementById('pf-shipmode')&&document.getElementById('pf-shipmode').value==='fixed'?'fixed':'weight';
  var shipFixed=document.getElementById('pf-shipfixed')?(parseFloat(document.getElementById('pf-shipfixed').value)||0):0;
  var obj={id:EDITID||('p'+Date.now()),name:n,price:pr,stock:st,cat:JSON.stringify(pfGetCats()),
    desc:document.getElementById('pf-d').value.trim(),badge:document.getElementById('pf-b').value.trim(),
    sku:skuVal,weight:wt,size:sz,sell:document.getElementById('pf-sell').checked?1:0,
    coming_soon:document.getElementById('pf-coming')&&document.getElementById('pf-coming').checked?1:0,
    ship_mode:shipMode,ship_fixed:shipFixed,imgs:[EDIT_PHOTOS[0],EDIT_PHOTOS[1],EDIT_PHOTOS[2]]};
  // Disable save buttons while saving
  document.querySelectorAll('#pfc button.bp').forEach(function(b){b.disabled=true;b.textContent='Saving…';});
  apiFetch('products.php','POST',obj).then(function(d){
    if(!d||!d.success){
      alert('Save failed: '+(d&&d.error?d.error:'Unknown error'));
      document.querySelectorAll('#pfc button.bp').forEach(function(b){b.disabled=false;b.textContent='💾 Save';});
      return;
    }
    if(EDITID){for(var i=0;i<PRODS.length;i++)if(PRODS[i].id===EDITID){PRODS[i]=obj;break;}}
    else PRODS.push(obj);
    EDIT_PHOTOS=['','',''];EDITID=null;stopCam();
    try{localStorage.removeItem('suzi_products_cache');}catch(e){}
    renderStore();cancelPF();rProds(document.getElementById('acnt'));
  }).catch(function(e){
    alert('Save failed: '+(e&&e.message?e.message:'Network error'));
    document.querySelectorAll('#pfc button.bp').forEach(function(b){b.disabled=false;b.textContent='💾 Save';});
  });
}
function delP(id){if(!confirm('Delete this product?'))return;
  PRODS=PRODS.filter(function(p){return p.id!==id;});
  apiFetch('products.php','DELETE',{id:id}).catch(function(){});
  try{localStorage.removeItem('suzi_products_cache');}catch(e){}
  renderStore();rProds(document.getElementById('acnt'));}

function viewOrder(oid){
  var order=ORDERS.find(function(o){return o.id===oid;});
  if(!order){alert('Order not found.');return;}
  var el=document.getElementById('acnt');
  el.innerHTML='<div style="padding:1rem;text-align:center;color:#6b6040">Loading order…</div>';
  // Fetch fresh order data so tax/status/confirm flags reflect latest DB state
  apiFetch('orders.php').then(function(d){
    if(d&&d.orders){
      ORDERS=d.orders;
      var fresh=ORDERS.find(function(o){return o.id===oid;});
      if(fresh)order=fresh;
    }
    var _voOrder=ORDERS.find(function(o){return o.id===oid;});
    return {items:_voOrder&&_voOrder.items?_voOrder.items:[]};
  }).catch(function(){
    var _voOrder=ORDERS.find(function(o){return o.id===oid;});
    return {items:_voOrder&&_voOrder.items?_voOrder.items:[]};
  }).then(function(d){
    var items=d.items||[];
    // Separate shipping item from product items
    // orders.php returns product_id as 'id' field
    var prodItems=items.filter(function(it){return it.id!=='_ship'&&it.product_id!=='_ship';});
    var shipCost=order.shipping>0?order.shipping:(items.filter(function(it){return it.id==='_ship'||it.product_id==='_ship';}).map(function(it){return parseFloat(it.price)||0;})[0]||0);
    var iRows=prodItems.map(function(it){
      var lt=((parseFloat(it.price)||0)*(parseInt(it.qty||it.q)||1)).toFixed(2);
      return '<tr>'+
        '<td style="padding:10px 14px;border-bottom:1px solid #f0e8d0;vertical-align:middle">'+
          (it.img?'<img src="'+it.img+'" style="width:48px;height:48px;object-fit:cover;border-radius:6px;vertical-align:middle;margin-right:10px;border:1px solid #e8e0b8">':
           '<div style="display:inline-block;width:48px;height:48px;background:#fdf3d0;border-radius:6px;text-align:center;line-height:48px;font-size:1.4rem;vertical-align:middle;margin-right:10px">&#128092;</div>')+
          '<div style="display:inline-block;vertical-align:middle">'+
            '<div style="font-weight:600;color:#2d2220">'+(it.name||'Item')+'</div>'+
            (it.sku?'<div style="font-size:.75rem;font-family:monospace;color:#a07810">'+it.sku+'</div>':'')+
          '</div>'+
        '</td>'+
        '<td style="padding:10px 14px;border-bottom:1px solid #f0e8d0;text-align:center;color:#2d2220">'+(it.qty||it.q||1)+'</td>'+
        '<td style="padding:10px 14px;border-bottom:1px solid #f0e8d0;text-align:right;color:#2d2220">$'+(parseFloat(it.price)||0).toFixed(2)+'</td>'+
        '<td style="padding:10px 14px;border-bottom:1px solid #f0e8d0;text-align:right;font-weight:700;color:#a07810">$'+lt+'</td>'+
      '</tr>';
    }).join('');
    var sb='<span class="badge '+(order.status==='Delivered'||order.status==='Paid'?'bg':order.status==='Shipped'?'bb':order.status==='Cancelled'||order.status==='Refunded'?'br':order.status==='Awaiting Payment'?'bw':'ba')+'">'+order.status+'</span>';
    el.innerHTML=
      '<div style="max-width:800px;margin:0 auto">'+
      // Back button + header
      '<div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem">'+
        '<button class="bs" onclick="rOrders(document.getElementById(\'acnt\'))" style="font-size:.82rem">← Back to Orders</button>'+
        '<div>'+
          '<div style="font-size:1.1rem;font-weight:700;color:#2d2220">Order Details</div>'+
          '<code style="font-size:.82rem;color:#a07810">'+oid+'</code>'+
        '</div>'+
        '<div style="margin-left:auto">'+sb+'</div>'+
      '</div>'+
      // Info grid
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.8rem;margin-bottom:1.5rem">'+
        '<div style="background:#fff;border:1px solid #e8e0b8;border-radius:10px;padding:1rem">'+
          '<div style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:#a07810;margin-bottom:.6rem">Customer</div>'+
          '<div style="font-size:.9rem;font-weight:600;color:#2d2220;margin-bottom:.3rem">'+order.cust+'</div>'+
          (order.email?'<div style="font-size:.83rem;color:#6b6040"><a href="mailto:'+order.email+'" style="color:#a07810;text-decoration:none">'+order.email+'</a></div>':'<div style="font-size:.83rem;color:#bbb;font-style:italic">No email on file</div>')+
          (order.phone?'<div style="font-size:.83rem;color:#6b6040">'+order.phone+'</div>':'')+
        '</div>'+
        '<div style="background:#fff;border:1px solid #e8e0b8;border-radius:10px;padding:1rem">'+
          '<div style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:#a07810;margin-bottom:.6rem">Order Info</div>'+
          '<div style="font-size:.83rem;color:#6b6040;margin-bottom:.2rem">Date: <strong style="color:#2d2220">'+(order.dispDate||order.date)+' '+(order.time||'')+'</strong></div>'+
          '<div style="font-size:.83rem;color:#6b6040;margin-bottom:.2rem">Payment: <strong style="color:#2d2220">'+(order.pay||'—')+'</strong></div>'+
          '<div style="font-size:.83rem;color:#6b6040">Order Type: <strong style="color:#2d2220">'+(order.order_type||'Online')+'</strong></div>'+
          '<div style="font-size:.83rem;color:#6b6040">Tax Swept: <strong style="color:'+(order.swept_date?'#2e7d32':'#c62828')+'">'+(order.swept_date||'Not swept')+'</strong></div>'+
          (order.carrier?'<div style="font-size:.83rem;color:#6b6040">Carrier: <strong style="color:#2d2220">'+(order.carrier||'USPS')+'</strong></div>':'')+
          (order.tracking?'<div style="font-size:.83rem;color:#6b6040">Tracking: <code style="color:#a07810;font-size:.8rem">'+order.tracking+'</code></div>':'')+
        '</div>'+
        (order.addr?
          '<div style="background:#fff;border:1px solid #e8e0b8;border-radius:10px;padding:1rem;grid-column:1/-1">'+
            '<div style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:#a07810;margin-bottom:.4rem">Shipping Address</div>'+
            '<div style="font-size:.88rem;color:#2d2220">'+order.addr+'</div>'+
          '</div>':'')+
      '</div>'+
      // Items table
      '<div style="background:#fff;border:1px solid #e8e0b8;border-radius:10px;overflow:hidden;margin-bottom:1.5rem">'+
        '<div style="padding:.8rem 1rem;background:#fffdf0;border-bottom:1px solid #e8e0b8;font-size:.78rem;font-weight:700;text-transform:uppercase;color:#a07810">Items Ordered</div>'+
        (iRows&&iRows.length?
          '<table class="tablekit">'+
          '<thead><tr style="background:#f9f4e4">'+
            '<th style="padding:8px 14px;text-align:left;font-size:.78rem;color:#a07810;border-bottom:1px solid #e8e0b8">Product</th>'+
            '<th style="padding:8px 14px;text-align:center;font-size:.78rem;color:#a07810;border-bottom:1px solid #e8e0b8">Qty</th>'+
            '<th style="padding:8px 14px;text-align:right;font-size:.78rem;color:#a07810;border-bottom:1px solid #e8e0b8">Price</th>'+
            '<th style="padding:8px 14px;text-align:right;font-size:.78rem;color:#a07810;border-bottom:1px solid #e8e0b8">Subtotal</th>'+
          '</tr></thead><tbody>'+iRows+'</tbody>'+
          '</table>':
          '<div style="padding:1.5rem;text-align:center;color:#6b6040;font-size:.85rem">No item details available.</div>')+
      '</div>'+
      // Totals — calculate from components
      (function(){
        var itemSubtotal=prodItems.reduce(function(s,it){return s+(parseFloat(it.price)||0)*(parseInt(it.qty||it.q)||1);},0);
        var tax=order.tax||0;
        var fee=order.total>0?Math.round((order.total*0.026+0.10)*100)/100:0;
        var feeStr='~$'+fee.toFixed(2);
        function trow(label,val,cls,note){
          return '<div style="display:flex;justify-content:space-between;padding:.35rem 0;font-size:.88rem;border-bottom:1px solid #f0e8d0">'+
            '<span style="color:#6b6040">'+label+(note?'<span style="font-size:.72rem;color:#999;margin-left:.3rem">'+note+'</span>':'')+'</span>'+
            '<span style="'+(cls||'color:#2d2220')+'">'+val+'</span></div>';
        }
        return '<div style="background:#fff;border:1px solid #e8e0b8;border-radius:10px;padding:1rem;max-width:320px;margin-left:auto">'+
          trow('Subtotal','$'+itemSubtotal.toFixed(2))+
          (shipCost>0?trow('Shipping','$'+shipCost.toFixed(2)):trow('Shipping','Free','color:#2e7d32'))+
          (tax>0?trow('Sales Tax','$'+tax.toFixed(2)):'')+
          ((order.pay==='Credit Card'||order.pay==='Square')?trow('Transaction Fee','$'+(order.fee||0).toFixed(2),'color:#c62828'):'')+ 
          '<div style="display:flex;justify-content:space-between;padding:.5rem 0;font-size:1rem;font-weight:700;color:#2d2220;border-top:2px solid #e8e0b8;margin-top:.2rem">'+
            '<span>Total</span><span style="color:#a07810">$'+order.total.toFixed(2)+'</span>'+
          '</div>'+
        '</div>';
      }())+
      // Update controls
      '<div style="background:#fff;border:1px solid #e8e0b8;border-radius:10px;padding:1rem;margin-top:1rem">'+
        '<div style="font-size:.78rem;font-weight:700;text-transform:uppercase;color:#a07810;margin-bottom:.7rem">Actions</div>'+
        '<div style="display:flex;flex-wrap:wrap;gap:.6rem">'+
          '<button class="bp" style="font-size:.82rem" onclick="editOrderDetail(\''+oid+'\')">✏️ Edit Order</button>'+
          '<button class="bs" style="font-size:.82rem" onclick="sendConfirmEmail(\''+oid+'\')">&#x1F4E7; Send Confirmation</button>'+
          '<button class="bs" style="font-size:.82rem" onclick="sendShippingEmail(\''+oid+'\')">&#x1F69A; Send Shipping</button>'+
          (refundRemaining(order)>0.004?'<button class="bs" style="font-size:.82rem" onclick="showRefundFormFor(\''+oid+'\')">↩ '+((order.refunded_amount||0)>0?'Refund More':'Refund Order')+'</button>':'')+
                    '<button class="bd" style="font-size:.82rem;margin-left:auto" onclick="deleteOrder(\''+oid+'\')">&#x1F5D1; Delete Order</button>'+
        '</div>'+
        ((order.refunded_amount||0)>0?'<div style="margin-top:.6rem;font-size:.83rem;color:#c0392b">Refunded: $'+order.refunded_amount.toFixed(2)+' of $'+order.total.toFixed(2)+'</div>':'')+
        '<div id="vo-msg-'+oid+'" style="margin-top:.7rem;font-size:.83rem"></div>'+
      '</div>'+
      '</div>';
  }).catch(function(){
    el.innerHTML='<div style="color:#c62828;padding:1rem">Could not load order details.</div>';
  });
}

function fetchOrderTax(oid){
  var msg=document.getElementById('vo-msg-'+oid);
  if(msg)msg.innerHTML='<span style="color:#a07810">Fetching tax from Square…</span>';
  // Use stored square_payment_id to call fetch_tax.php directly
  var order=ORDERS.find(function(o){return o.id===oid;});
  var sqPayId=order&&order.square_payment_id?order.square_payment_id:'';
  apiFetch('fetch_tax.php','POST',{order_id:oid,sq_payment_id:sqPayId}).then(function(d){
    if(!d.success||!(d.tax>0)){
      if(msg)msg.innerHTML='<span style="color:#c62828">'+(d.error||'No tax found for this order.')+'</span>';
      return;
    }
    if(order){order.tax=d.tax;if(d.total)order.total=d.total;}
    if(msg)msg.innerHTML='<span style="color:#2e7d32">✓ Tax $'+d.tax.toFixed(2)+' saved, total now $'+(d.total||0).toFixed(2)+'</span>';
    setTimeout(function(){viewOrder(oid);},1400);
  }).catch(function(){
    if(msg)msg.innerHTML='<span style="color:#c62828">Error fetching from Square.</span>';
  });
}

function deleteOrder(oid){
  if(!confirm('Delete order '+oid+'?\nThis cannot be undone.'))return;
  apiFetch('orders.php','DELETE',{id:oid})
  .then(function(d){
    if(d.success||d.message){
      // Remove from local ORDERS array
      for(var i=0;i<ORDERS.length;i++){if(ORDERS[i].id===oid){ORDERS.splice(i,1);break;}}
      var toast=document.createElement('div');
      toast.textContent='\u2713 Order '+oid+' deleted.';
      toast.style.cssText='position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);background:#c62828;color:#fff;padding:.65rem 1.4rem;border-radius:24px;font-size:.85rem;font-family:sans-serif;font-weight:600;z-index:9999';
      document.body.appendChild(toast);
      setTimeout(function(){toast.remove();},2500);
      rOrders(document.getElementById('acnt'));
    } else {
      alert('Delete failed: '+(d.error||'unknown'));
    }
  }).catch(function(){alert('Network error.');});
}
function showRefundFormFor(oid){
  var order=ORDERS.find(function(o){return o.id===oid;});
  if(!order){alert('Order not found.');return;}
  var remaining=refundRemaining(order);
  if(remaining<=0.004){alert('This order has already been fully refunded.');return;}
  var methodNote=(order.pay==='Credit Card'||order.pay==='Square')?'Card order — Square will refund the customer\'s card directly.':'Cash/Check order — this only records the refund; return the money to the customer yourself.';
  var panel=document.createElement('div');
  panel.id='refund-panel';
  panel.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,.2);padding:1.8rem;z-index:500;width:420px;max-width:95vw';
  panel.innerHTML=
    '<div style="font-weight:700;font-size:1rem;margin-bottom:1.1rem;color:#2d2220">↩ Refund Order — '+oid+'</div>'+
    '<div class="merr" id="ref-err" style="display:none;background:#fdecea;color:#c0392b;padding:.5rem .8rem;border-radius:6px;font-size:.82rem;margin-bottom:.7rem"></div>'+
    '<div style="background:#fffdf0;border:1px solid #e8e0b8;border-radius:7px;padding:.6rem .9rem;font-size:.83rem;margin-bottom:.4rem">'+
      '<strong>'+order.cust+'</strong> — Refundable: <strong>$'+remaining.toFixed(2)+'</strong>'+
    '</div>'+
    '<div style="font-size:.78rem;color:#6b6040;margin-bottom:.6rem">'+methodNote+'</div>'+
    '<label class="fl">Refund Type *</label>'+
    '<div style="display:flex;gap:.6rem;margin-bottom:.8rem">'+
      '<label style="display:flex;align-items:center;gap:.35rem;font-size:.85rem;cursor:pointer"><input type="radio" name="ref-type" value="full" checked onchange="updateRefundAmountFor('+remaining+')"> Full Refund</label>'+
      '<label style="display:flex;align-items:center;gap:.35rem;font-size:.85rem;cursor:pointer"><input type="radio" name="ref-type" value="partial" onchange="updateRefundAmountFor(null)"> Partial Refund</label>'+
    '</div>'+
    '<label class="fl">Refund Amount *</label>'+
    '<input class="afi" id="ref-amount" type="number" step="0.01" min="0.01" value="'+remaining.toFixed(2)+'">'+
    '<label class="fl">Reason *</label>'+
    '<input class="afi" id="ref-reason" placeholder="e.g. Customer returned item">'+
    '<div style="display:flex;gap:.6rem;margin-top:.5rem">'+
      '<button class="bp" id="ref-save-btn" onclick="saveRefundFor(\''+oid+'\')">↩ Process Refund</button>'+
      '<button class="bs" onclick="document.getElementById(\'refund-panel\').remove();document.getElementById(\'refund-overlay\').remove()">Cancel</button>'+
    '</div>';
  var ov=document.createElement('div');
  ov.id='refund-overlay';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:499';
  ov.onclick=function(){panel.remove();ov.remove();};
  document.body.appendChild(ov);
  document.body.appendChild(panel);
}
function updateRefundAmountFor(remaining){
  var inp=document.getElementById('ref-amount');
  var typeEl=document.querySelector('input[name="ref-type"]:checked');
  if(!inp||!typeEl)return;
  if(typeEl.value==='full'&&remaining!=null){
    inp.value=parseFloat(remaining).toFixed(2);
    inp.readOnly=true;inp.style.background='#f5f5f5';
  } else {
    inp.readOnly=false;inp.style.background='';inp.value='';
  }
}
function saveRefundFor(oid){
  var order=ORDERS.find(function(o){return o.id===oid;});
  var amt=parseFloat(document.getElementById('ref-amount').value);
  var reason=document.getElementById('ref-reason').value.trim();
  var err=document.getElementById('ref-err');
  err.style.display='none';
  if(!amt||amt<=0){err.textContent='Please enter a valid refund amount.';err.style.display='block';return;}
  if(!reason){err.textContent='A reason is required.';err.style.display='block';return;}
  var remaining=order?refundRemaining(order):amt;
  if(amt>remaining+0.004){err.textContent='Refund cannot exceed remaining refundable balance ($'+remaining.toFixed(2)+').';err.style.display='block';return;}
  var btn=document.getElementById('ref-save-btn');
  if(btn){btn.disabled=true;btn.textContent='Processing\u2026';}
  apiFetch('refund.php','POST',{order_id:oid,amount:amt,reason:reason}).then(function(d){
    if(!d||!d.success){
      err.textContent=(d&&d.error)||'Failed to process refund.';err.style.display='block';
      if(btn){btn.disabled=false;btn.textContent='\u21a9 Process Refund';}
      return;
    }
    if(order){order.refunded_amount=d.refunded_amount;order.status=d.status;}
    document.getElementById('refund-panel').remove();
    document.getElementById('refund-overlay').remove();
    var msgEl=document.getElementById('vo-msg-'+oid);
    if(msgEl){msgEl.style.color='#2e7d32';msgEl.textContent='\u2713 Refund processed: $'+amt.toFixed(2)+(d.square_refund_id?' (Square refund '+d.square_refund_id+')':'')+(d.email_sent?' \u2014 email sent to customer':' \u2014 could not email customer');}
    setTimeout(function(){viewOrder(oid);},1200);
  }).catch(function(){
    err.textContent='Network error \u2014 refund not processed.';err.style.display='block';
    if(btn){btn.disabled=false;btn.textContent='\u21a9 Process Refund';}
  });
}
