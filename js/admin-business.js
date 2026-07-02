// ── BUSINESS: Profile, Documents, Inventory, Reports ──

// -- Profile --
function rBizProfile(el){
  el.innerHTML='<div style="padding:2rem;text-align:center;color:#6b6040">Loading…</div>';
  apiFetch('admin.php','POST',{action:'get_setting',key:'biz_profile'}).then(function(d){
    var p={};
    try{if(d.success&&d.value)p=JSON.parse(d.value);}catch(e){}
    el.innerHTML=
      '<div style="max-width:660px">'+
      '<div class="aok" id="bp-ok" style="display:none">✓ Business profile saved!</div>'+
      '<div class="aerr" id="bp-err" style="display:none"></div>'+
      '<div style="background:#fff;border:1px solid #e8e0b8;border-radius:10px;padding:1.4rem;margin-bottom:1rem">'+
        '<div style="font-weight:700;font-size:.88rem;text-transform:uppercase;letter-spacing:.06em;color:#a07810;margin-bottom:.9rem">🏢 Business Identity</div>'+
        '<label class="fl">Business Name</label>'+
        '<input class="afi" id="bp-name" value="'+(p.name||'Handmade Designs By Suzi')+'">'+
        '<label class="fl">Short Name</label>'+
        '<input class="afi" id="bp-short-name" value="'+(p.short_name||'')+'" placeholder="e.g. HDBS">'+
      '</div>'+
      '<div style="background:#fff;border:1px solid #e8e0b8;border-radius:10px;padding:1.4rem;margin-bottom:1rem">'+
        '<div style="font-weight:700;font-size:.88rem;text-transform:uppercase;letter-spacing:.06em;color:#a07810;margin-bottom:.9rem">📍 Contact Info</div>'+
        '<label class="fl">Address</label>'+
        '<input class="afi" id="bp-address" value="'+(p.address||'')+'" placeholder="123 Main St, Knoxville TN 37918">'+
        '<label class="fl">Phone</label>'+
        '<input class="afi" id="bp-phone" value="'+(p.phone||'')+'" placeholder="(865) 555-0100">'+
        '<label class="fl">Email</label>'+
        '<input class="afi" id="bp-email" value="'+(p.email||'')+'" placeholder="handmadedesignsbysuzi@yahoo.com">'+
      '</div>'+
      '<div style="background:#fff;border:1px solid #e8e0b8;border-radius:10px;padding:1.4rem;margin-bottom:1rem">'+
        '<div style="font-weight:700;font-size:.88rem;text-transform:uppercase;letter-spacing:.06em;color:#a07810;margin-bottom:.9rem">🖼️ Logo</div>'+
        (p.logo
          ? '<div style="margin-bottom:.8rem">'+
            '<img id="bp-logo-preview" src="'+p.logo+'" onclick="bizLogoZoom(this)" style="max-width:220px;max-height:160px;border-radius:8px;border:1px solid #e8e0b8;display:block;cursor:zoom-in" title="Click to enlarge">'+
            '<div style="display:flex;align-items:center;gap:.6rem;margin-top:.5rem">'+
              '<span style="font-size:.72rem;color:#6b6040">Click image to enlarge</span>'+
              '<button class="bd" style="font-size:.72rem;padding:.2rem .6rem" onclick="clearBizLogo()">✕ Clear Logo</button>'+
            '</div>'+
          '</div>'
          : '<div style="background:#fffdf0;border:1px dashed #e8e0b8;border-radius:8px;padding:1.2rem;text-align:center;color:#6b6040;font-size:.85rem;margin-bottom:.8rem">No logo uploaded</div>')+
        '<label class="fl">Upload Logo (JPG/PNG)</label>'+
        '<input type="file" id="bp-logo-file" accept="image/jpeg,image/png,image/gif,image/webp" style="margin-bottom:.8rem;font-size:.83rem" onchange="bizPreviewLogo(this)">'+
        '<div id="bp-logo-new" style="display:none;margin-bottom:.8rem">'+
          '<div style="font-size:.72rem;color:#a07810;font-weight:600;margin-bottom:.3rem">New logo (not yet saved):</div>'+
          '<img id="bp-logo-new-src" style="max-width:220px;max-height:160px;border-radius:8px;border:2px dashed #d4a017;display:block;cursor:zoom-in" onclick="bizLogoZoom(this)">'+
        '</div>'+
      '</div>'+
      '<button class="bp" onclick="saveBizProfile()">💾 Save Business Profile</button>'+
      '</div>';
  }).catch(function(){
    el.innerHTML='<div style="color:#c62828;padding:1rem">Failed to load business profile.</div>';
  });
}
function saveBizProfile(){
  var ok=document.getElementById('bp-ok');
  var err=document.getElementById('bp-err');
  ok.style.display='none';err.style.display='none';

  var name=document.getElementById('bp-name').value.trim();
  var short_name=document.getElementById('bp-short-name').value.trim();
  var address=document.getElementById('bp-address').value.trim();
  var phone=document.getElementById('bp-phone').value.trim();
  var email=document.getElementById('bp-email').value.trim();
  var fileInput=document.getElementById('bp-logo-file');

  function doSave(imgData){
    if(!imgData){
      var existing=document.getElementById('bp-logo-preview');
      imgData=existing?existing.src:'';
    }
    var profile={name:name,short_name:short_name,address:address,phone:phone,email:email,logo:imgData};
    apiFetch('admin.php','POST',{action:'save_setting',key:'biz_profile',value:JSON.stringify(profile)})
    .then(function(d){
      if(d.message==='Setting saved'||d.success){
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

  if(fileInput&&fileInput.files&&fileInput.files[0]){
    var file=fileInput.files[0];
    if(file.size>2*1024*1024){
      err.textContent='Logo image must be under 2MB.';err.style.display='block';return;
    }
    var reader=new FileReader();
    reader.onload=function(e){doSave(e.target.result);};
    reader.readAsDataURL(file);
  } else {
    doSave(null);
  }
}
function clearBizLogo(){
  if(!confirm('Remove the business logo?'))return;
  var name=document.getElementById('bp-name').value.trim();
  var short_name=document.getElementById('bp-short-name').value.trim();
  var address=document.getElementById('bp-address').value.trim();
  var phone=document.getElementById('bp-phone').value.trim();
  var email=document.getElementById('bp-email').value.trim();
  var profile={name:name,short_name:short_name,address:address,phone:phone,email:email,logo:''};
  apiFetch('admin.php','POST',{action:'save_setting',key:'biz_profile',value:JSON.stringify(profile)})
  .then(function(d){
    if(d.message==='Setting saved'||d.success)rBizProfile(document.getElementById('acnt'));
  }).catch(function(){alert('Network error.');});
}
function bizPreviewLogo(input){
  if(!input.files||!input.files[0])return;
  var reader=new FileReader();
  reader.onload=function(e){
    var div=document.getElementById('bp-logo-new');
    var img=document.getElementById('bp-logo-new-src');
    if(div&&img){img.src=e.target.result;div.style.display='block';}
  };
  reader.readAsDataURL(input.files[0]);
}
function bizLogoZoom(img){
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

// -- Documents --
var BIZ_DOC_TYPES=[
  {key:'resale_cert',label:'Sales Tax Resale Certificate',icon:'🧾'},
  {key:'business_license',label:'Business License',icon:'📜'}
];
function rBizDocs(el){
  el.innerHTML='<div style="padding:2rem;text-align:center;color:#6b6040">Loading…</div>';
  apiFetch('business_docs.php','POST',{action:'list'}).then(function(d){
    var docs=(d.success&&d.documents)?d.documents:{};
    var html='<div style="max-width:660px">';
    BIZ_DOC_TYPES.forEach(function(t){
      var doc=docs[t.key];
      html+='<div style="background:#fff;border:1px solid #e8e0b8;border-radius:10px;padding:1.4rem;margin-bottom:1rem">'+
        '<div style="font-weight:700;font-size:.88rem;text-transform:uppercase;letter-spacing:.06em;color:#a07810;margin-bottom:.9rem">'+t.icon+' '+t.label+'</div>'+
        (doc
          ? '<div style="background:#fffdf0;border:1px solid #e8e0b8;border-radius:8px;padding:.9rem 1rem;margin-bottom:.9rem;display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap">'+
              '<div><div style="font-weight:600;font-size:.85rem;color:#2d2220">'+doc.orig_name+'</div>'+
              '<div style="font-size:.72rem;color:#6b6040">Uploaded '+doc.uploaded_at+' · '+Math.round(doc.size/1024)+' KB</div></div>'+
              '<div style="display:flex;gap:.5rem;flex-shrink:0">'+
                '<button class="bs" style="font-size:.75rem;padding:.32rem .7rem" onclick="bizDocDownload(\''+t.key+'\')">⬇ Download</button>'+
                '<button class="bd" style="font-size:.75rem;padding:.32rem .7rem" onclick="bizDocDelete(\''+t.key+'\')">✕ Delete</button>'+
              '</div>'+
            '</div>'
          : '<div style="background:#fffdf0;border:1px dashed #e8e0b8;border-radius:8px;padding:1.2rem;text-align:center;color:#6b6040;font-size:.85rem;margin-bottom:.9rem">No file uploaded</div>')+
        '<label class="fl">Upload '+t.label+' (PDF, JPG, or PNG — max 5MB)</label>'+
        '<input type="file" accept="application/pdf,image/jpeg,image/png" style="font-size:.83rem" onchange="bizDocUpload(\''+t.key+'\',this)">'+
        '<div id="bd-status-'+t.key+'" style="font-size:.78rem;margin-top:.5rem"></div>'+
      '</div>';
    });
    html+='</div>';
    el.innerHTML=html;
  }).catch(function(){
    el.innerHTML='<div style="color:#c62828;padding:1rem">Failed to load documents.</div>';
  });
}
function bizDocUpload(type,input){
  if(!input.files||!input.files[0])return;
  var file=input.files[0];
  var status=document.getElementById('bd-status-'+type);
  if(file.size>5*1024*1024){
    if(status){status.style.color='#c62828';status.textContent='File must be under 5MB.';}
    input.value='';
    return;
  }
  if(status){status.style.color='#6b6040';status.textContent='Uploading…';}
  var reader=new FileReader();
  reader.onload=function(e){
    apiFetch('business_docs.php','POST',{action:'upload',doc_type:type,filename:file.name,data:e.target.result})
    .then(function(d){
      if(d.success){
        rBizDocs(document.getElementById('acnt'));
      } else if(status){
        status.style.color='#c62828';status.textContent='Upload failed: '+(d.error||'unknown');
      }
    }).catch(function(){if(status){status.style.color='#c62828';status.textContent='Network error.';}});
  };
  reader.readAsDataURL(file);
}
function bizDocDelete(type){
  if(!confirm('Delete this document? This cannot be undone.'))return;
  apiFetch('business_docs.php','POST',{action:'delete',doc_type:type}).then(function(){
    rBizDocs(document.getElementById('acnt'));
  }).catch(function(){alert('Network error.');});
}
function bizDocDownload(type){
  fetch(API+'/business_docs.php',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Token':window._adminToken||''},body:JSON.stringify({action:'download',doc_type:type})})
    .then(function(r){
      if(!r.ok)throw new Error('HTTP '+r.status);
      var disposition=r.headers.get('Content-Disposition')||'';
      var m=/filename="([^"]+)"/.exec(disposition);
      var filename=m?m[1]:type;
      return r.blob().then(function(blob){return {blob:blob,filename:filename};});
    })
    .then(function(res){
      var url=URL.createObjectURL(res.blob);
      var a=document.createElement('a');
      a.href=url;a.download=res.filename;
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(function(){URL.revokeObjectURL(url);},1000);
    })
    .catch(function(e){alert('Download failed: '+e.message);});
}

// -- Inventory (business-level: value by category + low/out-of-stock) --
function rBizInv(el){
  var total=0,low=0,out=0,value=0,catTotals={};
  for(var i=0;i<PRODS.length;i++){
    var p=PRODS[i];
    total+=p.stock;
    value+=p.stock*p.price;
    if(p.stock===0)out++;else if(p.stock<=3)low++;
    var c=p.cat||'Uncategorized';
    if(!catTotals[c])catTotals[c]={units:0,value:0};
    catTotals[c].units+=p.stock;
    catTotals[c].value+=p.stock*p.price;
  }
  var catRows='';
  Object.keys(catTotals).sort().forEach(function(c){
    catRows+='<tr><td>'+c+'</td><td>'+catTotals[c].units+'</td><td>$'+catTotals[c].value.toFixed(2)+'</td></tr>';
  });
  var lowList=PRODS.filter(function(p){return p.stock<=3;}).sort(function(a,b){return a.stock-b.stock;});
  var lowRows=lowList.map(function(p){
    return '<tr><td>'+p.name+'</td><td>'+p.cat+'</td><td style="font-weight:700;color:'+(p.stock===0?'#c0392b':'#e65100')+'">'+p.stock+'</td></tr>';
  }).join('');
  el.innerHTML='<div class="stats"><div class="stat"><div class="stl">Inventory Value</div><div class="stv">$'+value.toFixed(2)+'</div></div>'+
    '<div class="stat"><div class="stl">Total Units</div><div class="stv">'+total+'</div></div>'+
    '<div class="stat"><div class="stl">Low Stock</div><div class="stv" style="color:#e65100">'+low+'</div></div>'+
    '<div class="stat"><div class="stl">Out of Stock</div><div class="stv" style="color:#c0392b">'+out+'</div></div></div>'+
    '<div style="font-weight:700;color:#2d2220;margin:1.2rem 0 .6rem">Inventory Value by Category</div>'+
    '<table class="tablekit"><thead><tr><th>Category</th><th>Units</th><th>Value</th></tr></thead><tbody>'+(catRows||'<tr><td colspan="3" style="text-align:center;padding:1.2rem;color:#6b6040">No products yet</td></tr>')+'</tbody></table>'+
    '<div style="font-weight:700;color:#2d2220;margin:1.2rem 0 .6rem">Low &amp; Out-of-Stock Items</div>'+
    '<table class="tablekit"><thead><tr><th>Product</th><th>Category</th><th>Stock</th></tr></thead><tbody>'+(lowRows||'<tr><td colspan="3" style="text-align:center;padding:1.2rem;color:#6b6040">Nothing low on stock</td></tr>')+'</tbody></table>';
  if(typeof TableKit!=='undefined')TableKit.initAll();
  showPageToolbar({title:'Business Inventory',logoText:(window.BIZ_NAME||'Handmade Designs By Suzi')});
}

// -- Capital Equipment (date purchased, purchase price, description) --
var CAPEQUIP=[];
function rBizEquip(el){
  el.innerHTML='<div style="padding:2rem;text-align:center;color:#6b6040">Loading…</div>';
  apiFetch('capital_equipment.php').then(function(d){
    CAPEQUIP=(d.success&&d.items)?d.items:[];
    renderBizEquip(el);
  }).catch(function(){
    el.innerHTML='<div style="color:#c62828;padding:1rem">Failed to load capital equipment.</div>';
  });
}
function ceEsc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function renderBizEquip(el){
  var total=CAPEQUIP.reduce(function(s,i){return s+i.purchase_price;},0);
  var rows=CAPEQUIP.map(function(i){
    return '<tr>'+
      '<td>'+i.purchase_date+'</td>'+
      '<td>'+ceEsc(i.description)+'</td>'+
      '<td style="font-weight:700;color:#a07810">$'+i.purchase_price.toFixed(2)+'</td>'+
      '<td>'+(i.has_receipt
        ? '<button class="bs" style="font-size:.72rem" onclick="viewEquipReceipt('+i.id+')" title="'+ceEsc(i.receipt_orig_name)+'">📎 View</button> '+
          '<button class="bd" style="font-size:.72rem" onclick="deleteEquipReceipt('+i.id+')">✕</button>'
        : '<span style="color:#6b6040;font-size:.8rem">—</span>')+
      '</td>'+
      '<td><button class="be" style="font-size:.75rem" onclick="editBizEquip('+i.id+')">Edit</button> '+
        '<button class="bd" style="font-size:.75rem" onclick="deleteBizEquip('+i.id+')">Delete</button></td>'+
    '</tr>';
  }).join('');
  el.innerHTML=
    '<div class="stats"><div class="stat"><div class="stl">Total Items</div><div class="stv">'+CAPEQUIP.length+'</div></div>'+
    '<div class="stat"><div class="stl">Total Invested</div><div class="stv">$'+total.toFixed(2)+'</div></div></div>'+
    '<div style="background:#fff;border:1px solid #e8e0b8;border-radius:10px;padding:1.2rem;margin:1.2rem 0;max-width:640px" id="ce-form">'+
      '<div style="font-weight:700;margin-bottom:.9rem" id="ce-form-title">➕ Add Equipment</div>'+
      '<input type="hidden" id="ce-id">'+
      '<div class="g2">'+
        '<div><label class="fl">Date Purchased</label><input class="afi" id="ce-date" type="date"></div>'+
        '<div><label class="fl">Purchase Price ($)</label><input class="afi" id="ce-price" type="number" step="0.01" min="0.01" placeholder="0.00"></div>'+
      '</div>'+
      '<label class="fl">Description</label><textarea class="afi" id="ce-desc" rows="2" placeholder="e.g. Brother PE800 embroidery machine" style="resize:vertical"></textarea>'+
      '<label class="fl">Receipt (optional)</label>'+
      '<div id="ce-receipt-current" style="display:none;background:#fffdf0;border:1px solid #e8e0b8;border-radius:7px;padding:.5rem .8rem;margin-bottom:.5rem;font-size:.82rem;color:#2d2220"></div>'+
      '<input type="file" id="ce-receipt-file" accept="application/pdf,image/jpeg,image/png" style="font-size:.83rem">'+
      '<div style="font-size:.72rem;color:#6b6040;margin-top:.3rem">PDF, JPG, or PNG — max 5MB'+
        '<span id="ce-receipt-replace-note" style="display:none"> (choosing a file replaces the current receipt)</span></div>'+
      '<div class="aerr" id="ce-err" style="display:none;margin-top:.6rem"></div>'+
      '<div class="aok" id="ce-ok" style="display:none">✓ Saved!</div>'+
      '<div style="display:flex;gap:.6rem;margin-top:.7rem">'+
        '<button class="bp" id="ce-save-btn" onclick="saveBizEquip()">💾 Add Item</button>'+
        '<button class="bs" id="ce-cancel-btn" style="display:none" onclick="cancelBizEquipEdit()">Cancel</button>'+
      '</div>'+
    '</div>'+
    '<table class="tablekit"><thead><tr><th>Date Purchased</th><th>Description</th><th>Purchase Price</th><th>Receipt</th><th>Actions</th></tr></thead>'+
    '<tbody>'+(rows||'<tr><td colspan="5" style="text-align:center;padding:1.5rem;color:#6b6040">No capital equipment recorded yet</td></tr>')+'</tbody>'+
    '</table>';
  if(typeof TableKit!=='undefined')TableKit.initAll();
  showPageToolbar({title:'Capital Equipment',logoText:(window.BIZ_NAME||'Handmade Designs By Suzi')});
}
function saveBizEquip(){
  var id=document.getElementById('ce-id').value;
  var date=document.getElementById('ce-date').value;
  var price=parseFloat(document.getElementById('ce-price').value);
  var desc=document.getElementById('ce-desc').value.trim();
  var receiptInput=document.getElementById('ce-receipt-file');
  var receiptFile=(receiptInput&&receiptInput.files&&receiptInput.files[0])?receiptInput.files[0]:null;
  var err=document.getElementById('ce-err');
  err.style.display='none';
  if(!date){err.textContent='Please enter the purchase date.';err.style.display='block';return;}
  if(!price||price<=0){err.textContent='Please enter a valid purchase price.';err.style.display='block';return;}
  if(!desc){err.textContent='Please enter a description.';err.style.display='block';return;}
  if(receiptFile&&receiptFile.size>5*1024*1024){err.textContent='Receipt file must be under 5MB.';err.style.display='block';return;}
  var body={description:desc,purchase_date:date,purchase_price:price};
  if(id)body.id=parseInt(id,10);
  var btn=document.getElementById('ce-save-btn');
  if(btn)btn.disabled=true;
  apiFetch('capital_equipment.php',id?'PUT':'POST',body).then(function(d){
    if(!d.success){
      err.textContent=d.error||'Save failed.';err.style.display='block';
      if(btn)btn.disabled=false;
      return;
    }
    var itemId=id?parseInt(id,10):d.id;
    if(receiptFile&&itemId){
      var reader=new FileReader();
      reader.onload=function(e){
        apiFetch('capital_equipment.php','POST',{action:'upload_receipt',id:itemId,filename:receiptFile.name,data:e.target.result})
        .then(function(){rBizEquip(document.getElementById('acnt'));})
        .catch(function(){rBizEquip(document.getElementById('acnt'));});
      };
      reader.readAsDataURL(receiptFile);
    } else {
      rBizEquip(document.getElementById('acnt'));
    }
  }).catch(function(){
    err.textContent='Network error.';err.style.display='block';
    if(btn)btn.disabled=false;
  });
}
function editBizEquip(id){
  var item=CAPEQUIP.find(function(i){return i.id===id;});
  if(!item)return;
  document.getElementById('ce-id').value=item.id;
  document.getElementById('ce-date').value=item.purchase_date;
  document.getElementById('ce-price').value=item.purchase_price.toFixed(2);
  document.getElementById('ce-desc').value=item.description;
  document.getElementById('ce-form-title').textContent='✏️ Edit Equipment';
  document.getElementById('ce-save-btn').textContent='💾 Save Changes';
  document.getElementById('ce-cancel-btn').style.display='inline-block';
  var cur=document.getElementById('ce-receipt-current');
  var note=document.getElementById('ce-receipt-replace-note');
  if(item.has_receipt){
    cur.style.display='block';
    cur.innerHTML='📎 Current receipt: '+ceEsc(item.receipt_orig_name||'file')+' — <a href="#" onclick="viewEquipReceipt('+item.id+');return false;" style="color:#a07810">View</a>';
    if(note)note.style.display='inline';
  } else {
    cur.style.display='none';cur.innerHTML='';
    if(note)note.style.display='none';
  }
  document.getElementById('ce-form').scrollIntoView({behavior:'smooth',block:'center'});
}
function cancelBizEquipEdit(){
  document.getElementById('ce-id').value='';
  document.getElementById('ce-date').value='';
  document.getElementById('ce-price').value='';
  document.getElementById('ce-desc').value='';
  var receiptInput=document.getElementById('ce-receipt-file');if(receiptInput)receiptInput.value='';
  var cur=document.getElementById('ce-receipt-current');if(cur){cur.style.display='none';cur.innerHTML='';}
  var note=document.getElementById('ce-receipt-replace-note');if(note)note.style.display='none';
  document.getElementById('ce-form-title').textContent='➕ Add Equipment';
  document.getElementById('ce-save-btn').textContent='💾 Add Item';
  document.getElementById('ce-cancel-btn').style.display='none';
}
function deleteBizEquip(id){
  if(!confirm('Delete this equipment record? This cannot be undone.'))return;
  apiFetch('capital_equipment.php','DELETE',{id:id}).then(function(){
    rBizEquip(document.getElementById('acnt'));
  }).catch(function(){alert('Network error.');});
}
// Displays the receipt inline — an image opens in a lightbox, a PDF opens in a new tab
// (via the browser's native viewer) instead of forcing a download.
function viewEquipReceipt(id){
  fetch(API+'/capital_equipment.php',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Token':window._adminToken||''},body:JSON.stringify({action:'download_receipt',id:id})})
    .then(function(r){
      if(!r.ok)throw new Error('HTTP '+r.status);
      var ctype=r.headers.get('Content-Type')||'';
      return r.blob().then(function(blob){return {blob:blob,ctype:ctype};});
    })
    .then(function(res){
      var url=URL.createObjectURL(res.blob);
      if(res.ctype.indexOf('image/')===0){
        showReceiptImageModal(url);
      } else {
        window.open(url,'_blank');
        setTimeout(function(){URL.revokeObjectURL(url);},10000);
      }
    })
    .catch(function(e){alert('Could not load receipt: '+e.message);});
}
function showReceiptImageModal(imgUrl){
  var existing=document.getElementById('receipt-img-modal');if(existing)existing.remove();
  var ov=document.createElement('div');
  ov.id='receipt-img-modal';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
  var im=document.createElement('img');
  im.src=imgUrl;
  im.style.cssText='max-width:92vw;max-height:92vh;border-radius:10px;box-shadow:0 8px 40px rgba(0,0,0,.5)';
  var cls=document.createElement('div');
  cls.textContent='×';
  cls.style.cssText='position:absolute;top:1.2rem;right:1.5rem;color:#fff;font-size:2rem;cursor:pointer;line-height:1;font-weight:300';
  ov.appendChild(im);ov.appendChild(cls);
  ov.onclick=function(){URL.revokeObjectURL(imgUrl);ov.remove();};
  document.body.appendChild(ov);
}
function deleteEquipReceipt(id){
  if(!confirm('Remove this receipt?'))return;
  apiFetch('capital_equipment.php','POST',{action:'delete_receipt',id:id}).then(function(d){
    if(!d.success){alert('Failed to remove receipt.');return;}
    rBizEquip(document.getElementById('acnt'));
  }).catch(function(){alert('Network error.');});
}

// -- Reports (business-level: revenue by month, status breakdown, top products) --
function rBizReports(el){
  el.innerHTML='<div style="padding:2rem;text-align:center;color:#6b6040">Loading report data…</div>';
  apiFetch('orders.php').then(function(d){
    if(d.success)ORDERS=d.orders||[];
    renderBizReports(el);
  }).catch(function(){renderBizReports(el);});
}
function renderBizReports(el){
  var rev=0,byMonth={},byStatus={},tp={};
  for(var i=0;i<ORDERS.length;i++){
    var o=ORDERS[i];
    rev+=o.total;
    var norm=(typeof ordNormDate==='function')?ordNormDate(o):(o.date||'');
    var mk=norm.slice(0,7)||'Unknown';
    if(!byMonth[mk])byMonth[mk]={count:0,total:0};
    byMonth[mk].count++;byMonth[mk].total+=o.total;
    var st=o.status||'Unknown';
    byStatus[st]=(byStatus[st]||0)+1;
    for(var j=0;j<(o.items||[]).length;j++){var it=o.items[j];tp[it.name]=(tp[it.name]||0)+it.q;}
  }
  var months=Object.keys(byMonth).sort().reverse().slice(0,6);
  var monthRows=months.map(function(mk){
    return '<tr><td>'+mk+'</td><td>'+byMonth[mk].count+'</td><td>$'+byMonth[mk].total.toFixed(2)+'</td></tr>';
  }).join('');
  var statusRows=Object.keys(byStatus).sort().map(function(st){
    return '<tr><td>'+st+'</td><td>'+byStatus[st]+'</td></tr>';
  }).join('');
  var ts=[];for(var k in tp)ts.push([k,tp[k]]);ts.sort(function(a,b){return b[1]-a[1];});ts=ts.slice(0,5);
  var topRows=ts.map(function(t){return '<tr><td style="font-weight:600">'+t[0]+'</td><td><span class="badge bg">'+t[1]+' sold</span></td></tr>';}).join('');
  el.innerHTML='<div class="stats"><div class="stat"><div class="stl">Total Revenue</div><div class="stv">$'+rev.toFixed(2)+'</div></div>'+
    '<div class="stat"><div class="stl">Total Orders</div><div class="stv">'+ORDERS.length+'</div></div>'+
    '<div class="stat"><div class="stl">Avg Order</div><div class="stv">$'+(ORDERS.length?(rev/ORDERS.length).toFixed(2):'0.00')+'</div></div></div>'+
    '<div style="font-weight:700;color:#2d2220;margin:1.2rem 0 .6rem">Revenue by Month (last 6)</div>'+
    '<table class="tablekit"><thead><tr><th>Month</th><th>Orders</th><th>Revenue</th></tr></thead><tbody>'+(monthRows||'<tr><td colspan="3" style="text-align:center;padding:1.2rem;color:#6b6040">No orders yet</td></tr>')+'</tbody></table>'+
    '<div style="font-weight:700;color:#2d2220;margin:1.2rem 0 .6rem">Orders by Status</div>'+
    '<table class="tablekit"><thead><tr><th>Status</th><th>Orders</th></tr></thead><tbody>'+(statusRows||'<tr><td colspan="2" style="text-align:center;padding:1.2rem;color:#6b6040">No orders yet</td></tr>')+'</tbody></table>'+
    '<div style="font-weight:700;color:#2d2220;margin:1.2rem 0 .6rem">Top Products</div>'+
    '<table class="tablekit"><thead><tr><th>Product</th><th>Units Sold</th></tr></thead><tbody>'+(topRows||'<tr><td colspan="2" style="text-align:center;padding:1.2rem;color:#6b6040">No sales yet</td></tr>')+'</tbody></table>';
  if(typeof TableKit!=='undefined')TableKit.initAll();
  showPageToolbar({title:'Business Reports',logoText:(window.BIZ_NAME||'Handmade Designs By Suzi')});
}
