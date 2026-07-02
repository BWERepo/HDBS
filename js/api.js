// ── API BASE ──
// Always talk to the API on the SAME origin as the page, so the site works on
// www and non-www alike (a hardcoded host made www visitors fail CORS → no products).
var SITE_ORIGIN=location.origin;
var API=SITE_ORIGIN+'/api';

// ── Debug ──
function _dbgEnabled(){return localStorage.getItem('hdbs_debug')==='1';}

function _dbgLog(ctx,msg,data){
  if(!_dbgEnabled())return;
  var line='[DEBUG] '+ctx+' | '+msg+(data?' | '+JSON.stringify(data).slice(0,300):'');
  console.log(line);
  var payload={ctx:ctx,msg:msg};
  if(data)payload.data=typeof data==='object'?JSON.stringify(data).slice(0,500):String(data);
  fetch(API+'/admin.php',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'js_debug_log',ctx:payload.ctx,msg:payload.msg,data:payload.data||''})
  }).catch(function(){});
}

// ── Screen navigation logging ──
// Called from aNavById whenever a section is rendered
function _dbgScreen(sec){
  if(!_dbgEnabled())return;
  var labels={
    dash:'Dashboard',prods:'Product Management',orders:'Orders',custs:'Customers',
    inv:'Inventory',sales:'Sales Report',subs:'Subscribers',blast:'Email Blast',
    faqs:'FAQs',reviews:'Reviews',cats:'Categories',shipping:'Shipping',
    sqpay:'Square Payments',sweep:'Tax Sweep',
    regtest:'Regression Tests',bizprofile:'Profile',bizdocs:'Documents',
    bizinv:'Business Inventory',bizreports:'Business Reports',bizequip:'Capital Equipment',
    emaillog:'Email Log',logs:'Error Logs',settings:'Settings',
    tncity:'TN City Sales Taxes'
  };
  _dbgLog('SCREEN','Navigated to '+(labels[sec]||sec)+' (sec='+sec+')');
}

function apiFetch(endpoint,method,body){
  var hdrs={'Content-Type':'application/json'};
  if(window._adminToken)hdrs['X-Admin-Token']=window._adminToken;
  var opts={method:method||'GET',headers:hdrs};
  if(body)opts.body=JSON.stringify(body);
  var hadToken=!!window._adminToken;   // was this an authenticated admin request?
  _dbgLog('apiFetch',endpoint+' '+(method||'GET'),body||null);
  return fetch(API+'/'+endpoint,opts).then(function(r){
    return r.json().then(function(d){
      if(!d.success&&_dbgEnabled())_dbgLog('apiFetch-ERR',endpoint,{error:d.error,status:r.status});
      // Expired admin session: server rejects an authenticated call with 401.
      // Bounce the user to the login screen instead of showing a raw error on whatever screen they're on.
      if(hadToken&&r.status===401&&d&&d.error&&/session expired|unauthorized/i.test(d.error)&&typeof handleSessionExpired==='function'){
        handleSessionExpired();
      }
      return d;
    });
  });
}
