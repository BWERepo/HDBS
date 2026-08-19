// ── ADMIN: DONATIONS ──
// A log of products given away rather than sold (date, recipient, which product) — separate from
// a product's own "Donated" checkbox (js/admin-products.js's pf-donated), which just marks that
// one product as no longer for sale. Logging a donation here does not, by itself, flip that
// checkbox — the "Also mark product Donated" box in the form below does that as a convenience,
// but the log entry and the product flag are otherwise independent records.
var DONATIONS_LIST=[];

function rDonations(el){
  el.innerHTML='<div style="padding:2rem;text-align:center;color:#6b6040">Loading donations…</div>';
  apiFetch('donations.php','POST',{action:'list'}).then(function(d){
    DONATIONS_LIST=(d&&d.donations)||[];
    renderDonationsScreen(el);
  }).catch(function(){
    el.innerHTML='<p style="color:#c0392b;padding:2rem;text-align:center">Could not load donations.</p>';
  });
}

function donationProductLabel(id){
  var p=findProd(id);
  if(!p)return id;
  return (p.sku?p.sku+' — ':'')+p.name;
}

function renderDonationsScreen(el){
  var rows=DONATIONS_LIST.map(function(don){
    return '<tr><td>'+fmtMDY(don.date)+'</td><td>'+don.recipient+'</td>'+
      '<td><span style="color:#a07810;cursor:pointer;text-decoration:underline" onclick="showPF(\''+don.product_id+'\')" title="View product">'+donationProductLabel(don.product_id)+'</span></td>'+
      '<td><button class="bd" style="font-size:.75rem" onclick="deleteDonationRow('+don.id+')">Delete</button></td></tr>';
  }).join('');

  el.innerHTML=
    '<div style="max-width:900px;margin:0 auto">'+
    '<div class="acct-card" style="margin-bottom:1rem">'+
      '<div class="acct-title">💝 Log a Donation</div>'+
      '<label class="fl">Product</label>'+
      '<select class="fi" id="don-product" style="width:100%;margin-bottom:.6rem">'+
        '<option value="">— Select a product —</option>'+
        [].concat(PRODS).sort(function(a,b){return (a.sku||'').localeCompare(b.sku||'');}).map(function(p){
          return '<option value="'+p.id+'">'+(p.sku?p.sku+' — ':'')+p.name+'</option>';
        }).join('')+
      '</select>'+
      '<label class="fl">Date</label>'+
      '<input class="fi" id="don-date" type="date" value="'+new Date().toISOString().slice(0,10)+'" style="width:100%;margin-bottom:.6rem">'+
      '<label class="fl">Donated To</label>'+
      '<input class="fi" id="don-recipient" placeholder="e.g. Local Animal Shelter" style="width:100%;margin-bottom:.6rem">'+
      '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.8rem">'+
        '<input type="checkbox" id="don-mark" checked>'+
        '<label for="don-mark" style="font-size:.83rem;color:#2d2220;cursor:pointer">Also mark this product Donated (unchecks Sell)</label>'+
      '</div>'+
      '<div class="merr" id="don-err" style="display:none"></div>'+
      '<button class="bp" onclick="submitDonation()">Log Donation</button>'+
    '</div>'+
    '<div style="font-size:.88rem;color:#6b6040;margin-bottom:.6rem">'+DONATIONS_LIST.length+' donation'+(DONATIONS_LIST.length!==1?'s':'')+'</div>'+
    '<table class="tablekit"><thead><tr><th>Date</th><th>Donated To</th><th>Product</th><th>Actions</th></tr></thead><tbody>'+
    (rows||'<tr><td colspan="4" style="text-align:center;padding:2rem;color:#6b6040">No donations logged yet.</td></tr>')+
    '</tbody></table>'+
    '</div>';
  if(typeof TableKit!=='undefined')TableKit.initAll();
  showPageToolbar({title:'Donations',logoText:(window.BIZ_NAME||'Handmade Designs By Suzi')});
}

function submitDonation(){
  var productId=document.getElementById('don-product').value;
  var date=document.getElementById('don-date').value;
  var recipient=document.getElementById('don-recipient').value.trim();
  var mark=document.getElementById('don-mark').checked;
  var err=document.getElementById('don-err');err.style.display='none';
  if(!productId){err.textContent='Please select a product.';err.style.display='block';return;}
  if(!date){err.textContent='Please enter a date.';err.style.display='block';return;}
  if(!recipient){err.textContent='Please enter who this was donated to.';err.style.display='block';return;}

  apiFetch('donations.php','POST',{action:'create',product_id:productId,date:date,recipient:recipient}).then(function(d){
    if(!d||!d.success){err.textContent=(d&&d.error)||'Could not log donation.';err.style.display='block';return;}
    if(mark){
      var p=findProd(productId);
      if(p){
        p.donated=1;p.sell=0;
        apiFetch('products.php','POST',p).then(function(){
          try{localStorage.removeItem('suzi_products_cache');}catch(e){}
          renderStore();
        }).catch(function(){});
      }
    }
    rDonations(document.getElementById('acnt'));
  }).catch(function(){err.textContent='Network error.';err.style.display='block';});
}

function deleteDonationRow(id){
  if(!confirm('Delete this donation record? This does not change the product\'s Donated/Sell status.'))return;
  apiFetch('donations.php','POST',{action:'delete',id:id}).then(function(d){
    if(!d||!d.success){alert((d&&d.error)||'Could not delete donation.');return;}
    rDonations(document.getElementById('acnt'));
  }).catch(function(){alert('Network error.');});
}
