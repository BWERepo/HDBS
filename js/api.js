// ── API BASE ──
var API='https://handmadedesignsbysuzi.com/api';

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
    manord:'Manual Order',sqpay:'Square Payments',sweep:'Tax Sweep',
    regtest:'Regression Tests',bizprofile:'Business Profile',
    emaillog:'Email Log',logs:'Error Logs',settings:'Settings',
    tncity:'TN City Sales Taxes'
  };
  _dbgLog('SCREEN','Navigated to '+(labels[sec]||sec)+' (sec='+sec+')');
}

function apiFetch(endpoint,method,body){
  var opts={method:method||'GET',headers:{'Content-Type':'application/json'}};
  if(body)opts.body=JSON.stringify(body);
  _dbgLog('apiFetch',endpoint+' '+(method||'GET'),body||null);
  return fetch(API+'/'+endpoint,opts).then(function(r){
    return r.json().then(function(d){
      if(!d.success&&_dbgEnabled())_dbgLog('apiFetch-ERR',endpoint,{error:d.error,status:r.status});
      return d;
    });
  });
}
