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
      '<p style="font-size:.82rem;color:#6b6040;margin:.2rem 0 0">Every product with its price, sales tax, cash/check price, Square transaction fee, and credit card total.</p>'+
    '</div>'+
    '</div>';
  showPageToolbar({title:'Reports',logoText:(window.BIZ_NAME||'Handmade Designs By Suzi')});
}

function rInvReport(el){
  var rows=[].concat(PRODS).sort(function(a,b){
    var au=(a.sku||'').toUpperCase(),bu=(b.sku||'').toUpperCase();
    return au<bu?-1:au>bu?1:0;
  }).map(function(p){
    var price=Number(p.price)||0;
    var tax=Math.round(price*REPORT_TAX_RATE*100)/100;
    var cashPrice=Math.round((price+tax)*100)/100;
    var fee=Math.round((cashPrice*(SQ_FEE_PCT/100)+SQ_FEE_CENTS)*100)/100;
    var cardTotal=Math.round((cashPrice+fee)*100)/100;
    // Inline padding/font-size (not just the scoped <style> below) so density survives the
    // toolbar's own Print feature, which clones these cells into a separate popup with its own
    // hardcoded stylesheet (see toolbar.js's doPrint) — inline styles win over that stylesheet,
    // a scoped <style> block wouldn't (it isn't part of the cloned table).
    var td='padding:3px 8px;font-size:.78rem;white-space:nowrap';
    return '<tr><td style="'+td+'">'+(p.sku||'')+'</td><td style="'+td+'">'+p.name+'</td>'+
      '<td style="'+td+';text-align:right">$'+price.toFixed(2)+'</td>'+
      '<td style="'+td+';text-align:right">$'+tax.toFixed(2)+'</td>'+
      '<td style="'+td+';text-align:right">$'+cashPrice.toFixed(2)+'</td>'+
      '<td style="'+td+';text-align:right">$'+fee.toFixed(2)+'</td>'+
      '<td style="'+td+';text-align:right">$'+cardTotal.toFixed(2)+'</td></tr>';
  }).join('');

  el.innerHTML=
    '<div style="max-width:1150px;margin:0 auto">'+
    '<div style="margin-bottom:1rem">'+
    '<button class="be" onclick="rReports(document.getElementById(\'acnt\'))">← Back to Reports</button>'+
    '</div>'+
    '<p style="font-size:.78rem;color:#6b6040;margin:0 0 .8rem">Sales tax assumes a flat '+(REPORT_TAX_RATE*100).toFixed(2)+'%. Credit card fee assumes '+SQ_FEE_PCT+'% + $'+SQ_FEE_CENTS.toFixed(2)+' (Settings → Square Fees).</p>'+
    '<style>#inv-report-tbl td:nth-child(n+3),#inv-report-tbl th:nth-child(n+3) .tk-th-inner{justify-content:flex-end}#inv-report-tbl td:nth-child(n+3){text-align:right}#inv-report-tbl th:nth-child(n+3) .tk-th-label{text-align:right}</style>'+
    '<table id="inv-report-tbl" class="tablekit"><thead><tr>'+
    '<th style="padding:3px 8px;font-size:.78rem">SKU</th><th style="padding:3px 8px;font-size:.78rem">Name</th>'+
    '<th style="padding:3px 8px;font-size:.78rem">Price</th><th style="padding:3px 8px;font-size:.78rem">Sales Tax</th>'+
    '<th style="padding:3px 8px;font-size:.78rem">Cash/Check Price</th><th style="padding:3px 8px;font-size:.78rem">Credit Card Fee</th>'+
    '<th style="padding:3px 8px;font-size:.78rem">Credit Card Total</th>'+
    '</tr></thead><tbody>'+
    (rows||'<tr><td colspan="7" style="text-align:center;padding:2rem;color:#6b6040">No products yet.</td></tr>')+
    '</tbody></table>'+
    '</div>';
  if(typeof TableKit!=='undefined')TableKit.initAll();
  showPageToolbar({title:'Inventory Report',logoText:(window.BIZ_NAME||'Handmade Designs By Suzi')});
}
