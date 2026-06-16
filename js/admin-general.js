// ── EMAIL BLAST ──
var BLAST_TARGET='subs';

function rBlast(el){
  var subCt=SUBS.length;
  var custEmails=[];
  for(var i=0;i<CUSTS.length;i++)if(CUSTS[i].em)custEmails.push(CUSTS[i].em);
  var custCt=custEmails.length;
  var bothSet={};
  for(var s=0;s<SUBS.length;s++)bothSet[SUBS[s].email]=1;
  for(var c=0;c<custEmails.length;c++)bothSet[custEmails[c]]=1;
  var bothCt=Object.keys(bothSet).length;

  el.innerHTML=
    '<div class="blast-card">'+
    '<div class="blast-title">📣 Email List Generator</div>'+
    '<div class="blast-sub">Select a group to generate their email list. Copy the list and paste it into your preferred email program (Gmail, Outlook, Mailchimp, etc.).</div>'+

    '<div class="blast-targets">'+
      '<div class="blast-target on" id="bt-subs" onclick="blastTarget(\'subs\')">'+
        '<div class="blast-target-ic">✉️</div>'+
        '<div class="blast-target-lb">Newsletter Subscribers</div>'+
        '<div class="blast-target-ct">'+subCt+' email'+(subCt!==1?'s':'')+'</div>'+
      '</div>'+
      '<div class="blast-target" id="bt-custs" onclick="blastTarget(\'custs\')">'+
        '<div class="blast-target-ic">👥</div>'+
        '<div class="blast-target-lb">All Customers</div>'+
        '<div class="blast-target-ct">'+custCt+' email'+(custCt!==1?'s':'')+'</div>'+
      '</div>'+
      '<div class="blast-target" id="bt-both" onclick="blastTarget(\'both\')">'+
        '<div class="blast-target-ic">🌐</div>'+
        '<div class="blast-target-lb">Everyone</div>'+
        '<div class="blast-target-ct">'+bothCt+' unique email'+(bothCt!==1?'s':'')+'</div>'+
      '</div>'+
    '</div>'+

    '<div id="bl-result"></div>'+
    '</div>';

  BLAST_TARGET='subs';
  showEmailList();
}

function blastTarget(t){
  BLAST_TARGET=t;
  ['subs','custs','both'].forEach(function(k){
    var el=document.getElementById('bt-'+k);
    if(el)el.classList.toggle('on',k===t);
  });
  showEmailList();
}

function getBlastEmails(){
  var set={};
  if(BLAST_TARGET==='subs'||BLAST_TARGET==='both'){
    for(var i=0;i<SUBS.length;i++)if(SUBS[i].email)set[SUBS[i].email]=1;
  }
  if(BLAST_TARGET==='custs'||BLAST_TARGET==='both'){
    for(var j=0;j<CUSTS.length;j++)if(CUSTS[j].em)set[CUSTS[j].em]=1;
  }
  return Object.keys(set);
}

function showEmailList(){
  var emails=getBlastEmails();
  var result=document.getElementById('bl-result');
  if(!result)return;

  if(!emails.length){
    result.innerHTML=
      '<div style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:.85rem 1rem;font-size:.83rem;color:#e65100;margin-top:1rem">'+
      'No emails found for this group yet.</div>';
    return;
  }

  var label=BLAST_TARGET==='subs'?'Newsletter Subscribers':BLAST_TARGET==='custs'?'Customers':'Everyone';
  var comma=emails.join(', ');
  var newline=emails.join('\n');
  var csv='Email\n'+emails.join('\n');

  result.innerHTML=
    '<div style="margin-top:1.1rem">'+
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.6rem;flex-wrap:wrap;gap:.5rem">'+
      '<div style="font-size:.85rem;font-weight:600;color:#2d2220">'+emails.length+' email address'+(emails.length!==1?'es':'')+' — '+label+'</div>'+
      '<div style="display:flex;gap:.5rem;flex-wrap:wrap">'+
        '<button class="bp" style="font-size:.76rem;padding:.32rem .72rem" onclick="copyEmails(\'comma\')">📋 Copy Comma-Separated</button>'+
        '<button class="bs" style="font-size:.76rem;padding:.32rem .72rem" onclick="copyEmails(\'newline\')">📋 Copy One Per Line</button>'+
        '<button class="bs" style="font-size:.76rem;padding:.32rem .72rem" onclick="downloadEmails()">⬇ Download CSV</button>'+
      '</div>'+
    '</div>'+
    '<textarea id="bl-emailbox" readonly style="width:100%;height:160px;padding:.75rem 1rem;border:1.5px solid #e8e0b8;border-radius:8px;font-family:monospace;font-size:.82rem;color:#2d2220;background:#fdfbf0;resize:vertical;line-height:1.7">'+newline+'</textarea>'+
    '<div id="bl-copied" style="font-size:.8rem;color:#2e7d32;margin-top:.4rem;display:none">✓ Copied to clipboard!</div>'+
    '<div style="font-size:.78rem;color:#6b6040;margin-top:.6rem;line-height:1.6">'+
      'Paste the comma-separated list into the BCC field of Gmail, Outlook, or any email client. '+
      'Or import the CSV into Mailchimp, Constant Contact, or your email marketing platform.'+
    '</div>'+
    '</div>';

  // store for copy functions
  window._blastComma=comma;
  window._blastNewline=newline;
  window._blastCsv=csv;
  window._blastLabel=label;
}

function copyEmails(fmt){
  var text=fmt==='comma'?window._blastComma:window._blastNewline;
  if(!text)return;
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(function(){showCopied();}).catch(function(){fallbackCopy(text);});
  } else {fallbackCopy(text);}
}
function fallbackCopy(text){
  var ta=document.getElementById('bl-emailbox');
  if(!ta)return;
  ta.value=text;ta.select();
  try{document.execCommand('copy');showCopied();}catch(e){}
}
function showCopied(){
  var el=document.getElementById('bl-copied');
  if(!el)return;
  el.style.display='block';
  setTimeout(function(){el.style.display='none';},2500);
}
function downloadEmails(){
  if(!window._blastCsv)return;
  var a=document.createElement('a');
  var fname='suzi_emails_'+(window._blastLabel||'list').toLowerCase().replace(/\s+/g,'_')+'.csv';
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(window._blastCsv);
  a.download=fname;a.click();
}

