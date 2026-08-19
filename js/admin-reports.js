// ── ADMIN: REPORTS ──
// A hub screen (Shop > Reports) linking to individual report screens. Reports are computed
// entirely client-side from data already loaded into the admin panel (PRODS, SQ_FEE_PCT/CENTS) —
// no new API endpoints needed.

// Flat 9.75% — same fallback rate store.js's getStateTaxRate() already uses for TN when no
// specific city/county match is found. These reports assume a single flat rate rather than a
// per-customer shipping-destination lookup, since they're not tied to any particular sale.
var REPORT_TAX_RATE=0.0975;

function rReports(el){
  el.innerHTML=
    '<div style="max-width:700px;margin:0 auto">'+
    '<div class="acct-card" style="cursor:pointer" onclick="rInvReport(document.getElementById(\'acnt\'))">'+
      '<div class="acct-title">📦 Inventory Report</div>'+
      '<p style="font-size:.82rem;color:#6b6040;margin:.2rem 0 0">Every product with its price, sales tax, cash/check price, credit card fee, and credit card total.</p>'+
    '</div>'+
    '<div class="acct-card" style="cursor:pointer" onclick="rReceiptReport(document.getElementById(\'acnt\'))">'+
      '<div class="acct-title">🧾 Receipt Report</div>'+
      '<p style="font-size:.82rem;color:#6b6040;margin:.2rem 0 0">Same data as the Inventory Report, but Print generates one fillable receipt per product for handwriting in a customer\'s name and email.</p>'+
    '</div>'+
    '</div>';
  showPageToolbar({title:'Reports',logoText:(window.BIZ_NAME||'Handmade Designs By Suzi')});
}

// Shared by both reports below — every product's computed pricing, sorted ascending by SKU.
function reportRows(){
  return [].concat(PRODS).sort(function(a,b){
    var au=(a.sku||'').toUpperCase(),bu=(b.sku||'').toUpperCase();
    return au<bu?-1:au>bu?1:0;
  }).map(function(p){
    var price=Number(p.price)||0;
    var tax=Math.round(price*REPORT_TAX_RATE*100)/100;
    var cashPrice=Math.round((price+tax)*100)/100;
    var fee=Math.round((cashPrice*(SQ_FEE_PCT/100)+SQ_FEE_CENTS)*100)/100;
    var cardTotal=Math.round((cashPrice+fee)*100)/100;
    return {sku:p.sku||'',name:p.name,price:price,tax:tax,cashPrice:cashPrice,fee:fee,cardTotal:cardTotal};
  });
}

// Shared table markup for both reports — identical columns/layout. tableId must be unique per
// screen so each report's own scoped alignment <style> (and TableKit init) only targets its own
// table.
function reportTableHtml(tableId,rows){
  var td='padding:3px 8px;font-size:.78rem;white-space:nowrap';
  var body=rows.map(function(r){
    // Inline padding/font-size (not just the scoped <style> below) so density survives the
    // toolbar's own Print feature, which clones these cells into a separate popup with its own
    // hardcoded stylesheet (see toolbar.js's doPrint) — inline styles win over that stylesheet,
    // a scoped <style> block wouldn't (it isn't part of the cloned table).
    return '<tr><td style="'+td+'">'+r.sku+'</td><td style="'+td+'">'+r.name+'</td>'+
      '<td style="'+td+';text-align:right">$'+r.price.toFixed(2)+'</td>'+
      '<td style="'+td+';text-align:right">$'+r.tax.toFixed(2)+'</td>'+
      '<td style="'+td+';text-align:right">$'+r.cashPrice.toFixed(2)+'</td>'+
      '<td style="'+td+';text-align:right">$'+r.fee.toFixed(2)+'</td>'+
      '<td style="'+td+';text-align:right">$'+r.cardTotal.toFixed(2)+'</td></tr>';
  }).join('');
  return '<style>#'+tableId+' td:nth-child(n+3),#'+tableId+' th:nth-child(n+3) .tk-th-inner{justify-content:flex-end}#'+tableId+' td:nth-child(n+3){text-align:right}#'+tableId+' th:nth-child(n+3) .tk-th-label{text-align:right}</style>'+
    '<table id="'+tableId+'" class="tablekit"><thead><tr>'+
    '<th style="padding:3px 8px;font-size:.78rem">SKU</th><th style="padding:3px 8px;font-size:.78rem">Name</th>'+
    '<th style="padding:3px 8px;font-size:.78rem">Price</th><th style="padding:3px 8px;font-size:.78rem">Sales Tax</th>'+
    '<th style="padding:3px 8px;font-size:.78rem">Cash/Check Price</th><th style="padding:3px 8px;font-size:.78rem">Credit Card Fee</th>'+
    '<th style="padding:3px 8px;font-size:.78rem">Credit Card Total</th>'+
    '</tr></thead><tbody>'+
    (body||'<tr><td colspan="7" style="text-align:center;padding:2rem;color:#6b6040">No products yet.</td></tr>')+
    '</tbody></table>';
}

function rInvReport(el){
  var rows=reportRows();
  el.innerHTML=
    '<div style="max-width:1150px;margin:0 auto">'+
    '<div style="margin-bottom:1rem">'+
    '<button class="be" onclick="rReports(document.getElementById(\'acnt\'))">← Back to Reports</button>'+
    '</div>'+
    '<p style="font-size:.78rem;color:#6b6040;margin:0 0 .8rem">Sales tax assumes a flat '+(REPORT_TAX_RATE*100).toFixed(2)+'%. Credit card fee assumes '+SQ_FEE_PCT+'% + $'+SQ_FEE_CENTS.toFixed(2)+' (Settings → Square Fees).</p>'+
    reportTableHtml('inv-report-tbl',rows)+
    '</div>';
  if(typeof TableKit!=='undefined')TableKit.initAll();
  showPageToolbar({title:'Inventory Report',logoText:(window.BIZ_NAME||'Handmade Designs By Suzi')});
}

var RECEIPT_ROWS=[];

function rReceiptReport(el){
  RECEIPT_ROWS=reportRows();
  var td='padding:3px 8px;font-size:.78rem;white-space:nowrap';
  var body=RECEIPT_ROWS.map(function(r,i){
    return '<tr><td style="'+td+'"><input type="checkbox" class="receipt-cb" data-idx="'+i+'" checked onchange="updReceiptSelectAll()"></td>'+
      '<td style="'+td+'">'+r.sku+'</td><td style="'+td+'">'+r.name+'</td>'+
      '<td style="'+td+';text-align:right">$'+r.price.toFixed(2)+'</td>'+
      '<td style="'+td+';text-align:right">$'+r.tax.toFixed(2)+'</td>'+
      '<td style="'+td+';text-align:right">$'+r.cashPrice.toFixed(2)+'</td>'+
      '<td style="'+td+';text-align:right">$'+r.fee.toFixed(2)+'</td>'+
      '<td style="'+td+';text-align:right">$'+r.cardTotal.toFixed(2)+'</td></tr>';
  }).join('');

  el.innerHTML=
    '<div style="max-width:1150px;margin:0 auto">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:.5rem">'+
    '<button class="be" onclick="rReports(document.getElementById(\'acnt\'))">← Back to Reports</button>'+
    '<div><button class="be" onclick="setAllReceiptChecks(true)">Check All</button> <button class="be" onclick="setAllReceiptChecks(false)">Clear</button></div>'+
    '</div>'+
    '<p style="font-size:.78rem;color:#6b6040;margin:0 0 .8rem">Sales tax assumes a flat '+(REPORT_TAX_RATE*100).toFixed(2)+'%. Credit card fee assumes '+SQ_FEE_PCT+'% + $'+SQ_FEE_CENTS.toFixed(2)+' (Settings → Square Fees). Print generates one fillable receipt per checked product.</p>'+
    '<style>#receipt-report-tbl td:nth-child(n+4),#receipt-report-tbl th:nth-child(n+4) .tk-th-inner{justify-content:flex-end}#receipt-report-tbl td:nth-child(n+4){text-align:right}#receipt-report-tbl th:nth-child(n+4) .tk-th-label{text-align:right}</style>'+
    '<table id="receipt-report-tbl" class="tablekit" data-tk-sort="false" data-tk-filter="false"><thead><tr>'+
    '<th style="padding:3px 8px;font-size:.78rem"><input type="checkbox" id="receipt-select-all" checked onchange="setAllReceiptChecks(this.checked)"></th>'+
    '<th style="padding:3px 8px;font-size:.78rem">SKU</th><th style="padding:3px 8px;font-size:.78rem">Name</th>'+
    '<th style="padding:3px 8px;font-size:.78rem">Price</th><th style="padding:3px 8px;font-size:.78rem">Sales Tax</th>'+
    '<th style="padding:3px 8px;font-size:.78rem">Cash/Check Price</th><th style="padding:3px 8px;font-size:.78rem">Credit Card Fee</th>'+
    '<th style="padding:3px 8px;font-size:.78rem">Credit Card Total</th>'+
    '</tr></thead><tbody>'+
    (body||'<tr><td colspan="8" style="text-align:center;padding:2rem;color:#6b6040">No products yet.</td></tr>')+
    '</tbody></table>'+
    '</div>';
  // Sort/filter deliberately disabled on this table (data-tk-sort/data-tk-filter above) — a
  // checkbox's meaning is tied to its row's data-idx, and TableKit reorders/hides <tr> elements
  // directly rather than the underlying data, which would desync the displayed check state from
  // which product it actually belongs to.
  if(typeof TableKit!=='undefined')TableKit.initAll();
  showPageToolbar({title:'Receipt Report',logoText:(window.BIZ_NAME||'Handmade Designs By Suzi')});
  // Swap the toolbar's built-in Print (which would just print the plain table, same as the
  // Inventory Report) for the 3-receipts-per-product layout below. Same clone-to-replace pattern
  // admin-nav.js's showPageToolbar already uses for its Export/Import overrides — toolbar.js
  // itself is never modified.
  var pbtns=document.querySelectorAll('#page-toolbar .tk-toolbar-actions .tk-btn');
  for(var pi=0;pi<pbtns.length;pi++){
    if(pbtns[pi].textContent.trim()==='Print'){
      var fresh=pbtns[pi].cloneNode(true);
      pbtns[pi].parentNode.replaceChild(fresh,pbtns[pi]);
      fresh.addEventListener('click',function(){
        var checked=[];
        document.querySelectorAll('.receipt-cb:checked').forEach(function(cb){checked.push(RECEIPT_ROWS[Number(cb.dataset.idx)]);});
        printReceipts(checked);
      });
      break;
    }
  }
}

function setAllReceiptChecks(checked){
  document.querySelectorAll('.receipt-cb').forEach(function(cb){cb.checked=checked;});
  var all=document.getElementById('receipt-select-all');
  if(all)all.checked=checked;
}
function updReceiptSelectAll(){
  var boxes=document.querySelectorAll('.receipt-cb');
  var allChecked=true;
  boxes.forEach(function(cb){if(!cb.checked)allChecked=false;});
  var all=document.getElementById('receipt-select-all');
  if(all)all.checked=allChecked;
}

// ── PRINT: one fillable receipt per product, styled with a navy accent (badges, dotted price
// leaders, a highlighted total bar), 2 per printed page. ──
function printReceipts(rows){
  if(!rows.length){alert('No products to print receipts for.');return;}
  var bizName=window.BIZ_NAME||'Handmade Designs By Suzi';
  var priceLine=function(label,val,bold){
    return '<div class="rprice'+(bold?' rprice-b':'')+'"><span>'+label+'</span><span class="rdots"></span><span>$'+val.toFixed(2)+'</span></div>';
  };
  var boxes=rows.map(function(r){
    return '<div class="receipt-box">'+
      '<div class="rhead"><span class="badge">SKU: '+r.sku+'</span><span class="pname">'+r.name+'</span></div>'+
      '<div class="rtop">'+
      '<div class="rfield rfield-full"><span class="ricon">👤</span><span class="rk2">Customer Name:</span><span class="rblank2"></span></div>'+
      '<div class="rfield rfield-full"><span class="ricon">✉️</span><span class="rk2">Email:</span><span class="rblank2"></span></div>'+
      '</div>'+
      '<div class="rbody">'+
      '<div class="rright">'+
      priceLine('Price',r.price,false)+
      priceLine('Sales Tax',r.tax,false)+
      priceLine('Cash/Check Price',r.cashPrice,true)+
      priceLine('Credit Card Fee',r.fee,false)+
      '<div class="rtotalbar"><span>Credit Card Total</span><span>$'+r.cardTotal.toFixed(2)+'</span></div>'+
      '</div>'+
      '</div>'+
      '<div class="rpay">'+
      '<span class="badge2">PAYMENT</span>'+
      '<span class="pfield"><span class="ricon">📅</span><span class="rk2">Date:</span><span class="rblank3"></span></span>'+
      '<span class="pfield">Paid By: <label>☐ Cash</label> <label>☐ Check</label> <label>☐ Credit Card</label></span>'+
      '<span class="pfield"><span class="rk2">Check #:</span><span class="rblank3"></span></span>'+
      '<span class="pfield"><span class="rk2">Receipt #:</span><span class="rblank3"></span></span>'+
      '<span class="pfield"><span class="rk2">Amount Paid:</span><span class="rblank3"></span></span>'+
      '</div>'+
      '</div>';
  });
  var footer='<div class="rfooter"><span class="script">Thank you for your purchase!</span> <span class="heart">♥</span> <span class="bizname">'+bizName+'</span></div>';

  var win=window.open('','_blank');
  if(!win){alert('Please allow pop-ups to print receipts.');return;}
  win.document.write('<!DOCTYPE html><html><head><title>Receipts</title><style>'+
    'body{margin:0;padding:.2in;font-family:Arial,sans-serif;color:#000;font-weight:700}'+
    '.receipt-box{width:100%;border:1.5px solid #000;border-radius:8px;padding:.14in .18in;box-sizing:border-box;margin-bottom:.1in;page-break-inside:avoid;break-inside:avoid;overflow:hidden}'+
    '.receipt-box:nth-child(2n){page-break-after:always;break-after:page;margin-bottom:0}'+
    '.rhead{display:flex;align-items:center;gap:.15in;margin-bottom:.1in}'+
    '.badge{color:#000;font-weight:700;font-size:.78rem;white-space:nowrap}'+
    '.pname{font-size:1rem;font-weight:700;color:#000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
    '.rtop{margin-bottom:.06in}'+
    '.rfield-full{width:100%}'+
    '.rbody{display:flex;border-top:1px solid #000;padding-top:.08in}'+
    '.rright{flex:1;min-width:0}'+
    '.rfield{display:flex;align-items:center;gap:.06in;font-size:.74rem;margin-bottom:.1in;white-space:nowrap}'+
    '.ricon{font-size:.8rem}'+
    '.rk2{font-weight:700;color:#000}'+
    '.rblank2{flex:1;border-bottom:1px solid #000;height:1em}'+
    '.rprice{display:flex;align-items:baseline;font-size:.74rem;margin-bottom:.05in;white-space:nowrap}'+
    '.rprice span:first-child{flex-shrink:0}'+
    '.rdots{flex:1;height:1em;margin:0 .06in;background-image:radial-gradient(circle,#000 1px,transparent 1.3px);background-size:5px 5px;background-position:bottom 2px left 0;background-repeat:repeat-x}'+
    '.rprice span:last-child{flex-shrink:0;font-weight:700}'+
    '.rprice-b span{font-weight:700;color:#000}'+
    '.rtotalbar{display:flex;justify-content:space-between;color:#000;font-weight:700;font-size:.82rem;margin-top:.05in;white-space:nowrap}'+
    '.rpay{display:flex;align-items:center;flex-wrap:wrap;gap:.18in;border:1px solid #000;border-radius:6px;padding:.08in .12in;margin-top:.1in}'+
    '.badge2{color:#000;font-weight:700;font-size:.72rem;white-space:nowrap}'+
    '.pfield{display:flex;align-items:center;gap:.05in;font-size:.7rem;white-space:nowrap}'+
    '.pfield label{margin-right:.08in}'+
    '.rblank3{display:inline-block;width:.9in;height:1em;vertical-align:bottom;background-image:radial-gradient(circle,#000 1px,transparent 1.3px);background-size:5px 5px;background-position:bottom left;background-repeat:repeat-x}'+
    '.rfooter{text-align:center;margin-top:.15in}'+
    '.script{font-family:"Brush Script MT",cursive;font-size:1.1rem;color:#000;font-weight:700}'+
    '.heart{color:#000}'+
    '.bizname{font-weight:700;color:#000;font-size:.85rem}'+
    '@media print{body{padding:.15in}}'+
    '</style></head><body>'+
    boxes.join('')+footer+
    '<script>window.onload=function(){window.focus();window.onafterprint=function(){window.close();};window.print();};<\/script>'+
    '</body></html>');
  win.document.close();
}
