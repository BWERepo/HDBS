// ── ADMIN: DESIGN STUDIO ──
// Back-office management for the Design Studio page: commission inquiries, content items
// (services, inspiration gallery, projects, testimonials, FAQs) and page copy overrides.
// Data comes from api/studio.php via loadStudio() in js/studio.js (admin sees inactive items too).
var DS_ADMIN_TAB='inquiries';
var DS_INQUIRIES=[];
var DS_EDIT_IMG='';   // pending item image (dataURL or existing URL)
var DS_COPY_IMG='';   // pending hero image for Page Copy

// Defaults mirror the static copy in index.php's #studio-page — the Page Copy form starts
// from these when no studio_config override has been saved yet.
var DS_DEFAULT_CFG={
  hero:{headline:"Let's create something that's only yours",
    sub:"Custom portraits, logos, photography, jewelry, and one-of-a-kind art — designed with you, made by hand in Knoxville.",
    cta:"Start Your Project",image:""},
  steps:[
    {icon:"💬",title:"Share Your Vision",copy:"Tell Suzi what you're dreaming of — a few sentences is plenty to start."},
    {icon:"🤝",title:"Creative Consultation",copy:"A friendly conversation about ideas, budget, and timeline. No commitment yet."},
    {icon:"✏️",title:"Concept Development",copy:"Suzi sketches and shapes a concept made just for you."},
    {icon:"🔍",title:"Refinement",copy:"You review the work in progress and fine-tune the details together."},
    {icon:"🎁",title:"Final Delivery",copy:"Your finished piece is carefully packed and delivered to your door."}],
  why:[
    {icon:"🤲",title:"Handcrafted",copy:"Every piece is made by hand, start to finish."},
    {icon:"🤝",title:"One-on-one collaboration",copy:"You work directly with the artist — no middlemen."},
    {icon:"🚫",title:"No mass production",copy:"Nothing is batch-made. Your piece exists once."},
    {icon:"🎨",title:"Original artwork",copy:"Designed from scratch around your story."},
    {icon:"🔎",title:"Attention to detail",copy:"The little things are the whole point."},
    {icon:"🌿",title:"Creative flexibility",copy:"Changed your mind mid-project? Let's talk it through."}],
  final:{headline:"Your story, handmade",
    sub:"Every commission starts with a simple hello. Tell Suzi what you're imagining — she'll take it from there.",
    cta:"Begin the collaboration"}
};
var DS_TABS=[['inquiries','📁 Projects'],['service','🎨 Services'],['gallery','🖼️ Inspiration Gallery'],['project','📖 Portfolio'],['testimonial','💬 Testimonials'],['faq','❓ FAQs'],['copy','📝 Page Copy']];
var DS_SECTION_HINTS={
  service:'These cards appear under "What We Create". The starter copy was seeded automatically — please review and personalize it.',
  gallery:'Inspiration photos, grouped into filter pills on the page. Tip: use groups like Portraits, Branding, Jewelry, Photography, Mixed Media, or Corvette Themes. Shoppers can ♥ a photo to attach it to their inquiry.',
  project:'Real finished commissions with their story. The section stays hidden on the page until at least one active project exists.',
  testimonial:'Real customer quotes only. The section stays hidden on the page until at least one active testimonial exists.',
  faq:'Shown in the Design Studio FAQ accordion (separate from the main site FAQs). The starter answers were seeded automatically — please review and personalize them.'
};
var DS_PROJECT_STATUSES=['inquiry','started','in_progress','completed'];
var DS_STATUS_COLORS={inquiry:['#fff8e1','#e65100'],started:['#e3f2fd','#1565c0'],in_progress:['#f3e5f5','#6a1b9a'],completed:['#e8f5e9','#2e7d32']};
function dsStatusStyle(status){
  var c=DS_STATUS_COLORS[status]||DS_STATUS_COLORS.inquiry;
  return 'background:'+c[0]+';color:'+c[1]+';font-weight:600;border:1px solid '+c[1]+';border-radius:6px;padding:.3rem .5rem';
}
var _dsProjectDraft=null;

function rStudio(el){
  el.innerHTML='<div style="padding:2rem;text-align:center;color:#6b6040">Loading Design Studio…</div>';
  loadStudio(function(){renderStudioAdmin(el);});
}
function renderStudioAdmin(el){
  var pills='';
  DS_TABS.forEach(function(t){
    pills+='<button class="bp" style="font-size:.8rem;padding:.4rem .85rem;border-radius:16px;'+(DS_ADMIN_TAB===t[0]?'':'background:#fff;color:#2d2220;border:1px solid #e8e0b8')+'" onclick="dsAdminTab(\''+t[0]+'\')">'+t[1]+'</button>';
  });
  el.innerHTML='<div style="display:flex;gap:.45rem;flex-wrap:wrap;margin-bottom:1rem">'+pills+'</div>'+
    '<div id="ds-admin-body"></div>';
  renderStudioAdminTab();
}
function dsAdminTab(t){DS_ADMIN_TAB=t;renderStudioAdmin(document.getElementById('acnt'));}
function dsAdminItems(section){
  return STUDIO_ITEMS.filter(function(it){return it.section===section;});
}

function renderStudioAdminTab(){
  var body=document.getElementById('ds-admin-body');if(!body)return;
  if(DS_ADMIN_TAB==='inquiries')return dsRenderInquiries(body);
  if(DS_ADMIN_TAB==='copy')return dsRenderCopyForm(body);
  dsRenderItemList(body,DS_ADMIN_TAB);
}

// ── Inquiries ──
function dsRenderInquiries(body){
  body.innerHTML='<div style="padding:2rem;text-align:center;color:#6b6040">Loading inquiries…</div>';
  apiFetch('studio.php?action=inquiries').then(function(d){
    DS_INQUIRIES=(d&&d.inquiries)||[];
    var rows='';
    DS_INQUIRIES.forEach(function(q){
      rows+='<tr><td>'+escHtml(q.created_at||'')+'</td>'+
        '<td><input type="date" id="ds-due-'+q.id+'" value="'+escHtml(q.due_date||'')+'" onchange="dsSetDueDate('+q.id+',this.value)" style="padding:.2rem;border-radius:6px;border:1px solid #e8e0b8;font-size:.85rem"> <span id="ds-due-saved-'+q.id+'" style="font-size:.72rem;color:#2e7d32;opacity:0;transition:opacity .3s">✓ Saved</span></td>'+
        '<td>'+escHtml(q.name)+'</td><td>'+escHtml(q.project_type||'—')+'</td><td>'+escHtml(q.budget||'—')+'</td>'+
        '<td><select id="ds-status-'+q.id+'" onchange="dsSetInqStatus('+q.id+',this.value)" style="'+dsStatusStyle(q.status)+'">'+
        DS_PROJECT_STATUSES.map(function(s){return '<option'+(q.status===s?' selected':'')+'>'+s+'</option>';}).join('')+
        '</select> <span id="ds-status-saved-'+q.id+'" style="font-size:.72rem;color:#2e7d32;opacity:0;transition:opacity .3s">✓ Saved</span></td>'+
        '<td><button class="bp" style="font-size:.75rem;padding:.3rem .7rem" onclick="dsViewInquiry('+q.id+')">View</button> '+
        '<button class="bd" style="font-size:.75rem;padding:.3rem .7rem" onclick="dsDeleteProject('+q.id+')">Delete</button></td></tr>';
    });
    body.innerHTML='<div style="font-size:.85rem;color:#6b6040;margin-bottom:.8rem">'+DS_INQUIRIES.length+' project'+(DS_INQUIRIES.length===1?'':'s')+' — new inquiries also arrive by email.</div>'+
      '<table class="tablekit"><thead><tr><th>Received</th><th>Due Date</th><th>Name</th><th>Project</th><th>Budget</th><th>Status</th><th></th></tr></thead><tbody>'+
      (rows||'<tr><td colspan="7" style="text-align:center;padding:2rem;color:#6b6040">No projects yet.<br><span style="font-size:.8rem">Submissions from the Design Studio page will appear here.</span></td></tr>')+
      '</tbody></table>';
    if(typeof TableKit!=='undefined')TableKit.initAll();
  }).catch(function(){body.innerHTML='<div style="padding:2rem;text-align:center;color:#c0392b">Could not load inquiries.</div>';});
}
function dsSetInqStatus(id,status){
  var sel=document.getElementById('ds-status-'+id);
  if(sel)sel.setAttribute('style',dsStatusStyle(status));
  var q=null;DS_INQUIRIES.forEach(function(x){if(x.id===id)q=x;});
  if(q)q.status=status;
  apiFetch('studio.php','POST',{action:'inquiry_status',id:id,status:status}).then(function(d){
    var saved=document.getElementById('ds-status-saved-'+id);
    if(saved&&d&&d.success){
      saved.style.opacity='1';
      setTimeout(function(){saved.style.opacity='0';},1500);
    }
  }).catch(function(){});
}
function dsSetDueDate(id,dueDate){
  var q=null;DS_INQUIRIES.forEach(function(x){if(x.id===id)q=x;});
  if(q)q.due_date=dueDate;
  apiFetch('studio.php','POST',{action:'set_due_date',id:id,due_date:dueDate}).then(function(d){
    var saved=document.getElementById('ds-due-saved-'+id);
    if(saved&&d&&d.success){
      saved.style.opacity='1';
      setTimeout(function(){saved.style.opacity='0';},1500);
    }
  }).catch(function(){});
}
function dsDeleteProject(id){
  if(!confirm('Delete this project and all its notes? This cannot be undone.'))return;
  apiFetch('studio.php','POST',{action:'delete_project',id:id}).then(function(d){
    if(d&&d.success){
      DS_INQUIRIES=DS_INQUIRIES.filter(function(x){return x.id!==id;});
      renderStudioAdminTab();
    } else {alert('Delete failed: '+((d&&d.error)||'unknown'));}
  }).catch(function(){alert('Delete failed — network error.');});
}
function dsViewInquiry(id){
  var q=null;DS_INQUIRIES.forEach(function(x){if(x.id===id)q=x;});
  if(!q)return;
  var body=document.getElementById('ds-admin-body');
  function row(l,v){return v?'<tr><td style="padding:.3rem 0;color:#6b6040;width:130px;vertical-align:top">'+l+'</td><td style="padding:.3rem 0">'+escHtml(v)+'</td></tr>':'';}
  var picks='';
  if(q.inspiration&&q.inspiration.picks&&q.inspiration.picks.length){
    q.inspiration.picks.forEach(function(p){
      picks+='<span style="display:inline-block;margin:.2rem;text-align:center">'+(p.image?'<img src="'+escHtml(p.image)+'" style="width:64px;height:64px;object-fit:cover;border-radius:8px;display:block">':'')+'<span style="font-size:.68rem;color:#6b6040">'+escHtml(p.title||'')+'</span></span>';
    });
  }
  var notes=q.notes||[];
  var notesHtml='';
  notes.forEach(function(n){
    notesHtml+='<div style="display:flex;justify-content:space-between;gap:.6rem;padding:.5rem 0;border-bottom:1px solid #f0ead9">'+
      '<div><div style="font-size:.68rem;color:#a99;margin-bottom:.15rem">'+escHtml(n.created_at||'')+'</div><div style="font-size:.85rem;white-space:pre-wrap">'+escHtml(n.note_text)+'</div></div>'+
      '<button class="bd" style="font-size:.68rem;padding:.2rem .5rem;height:fit-content;flex-shrink:0" onclick="dsDeleteNote('+q.id+','+n.id+')">Delete</button></div>';
  });
  body.innerHTML='<button class="bp" style="font-size:.78rem;padding:.35rem .8rem;margin-bottom:1rem" onclick="renderStudioAdminTab()">← Back to projects</button>'+
    '<div style="background:#fff;border:1px solid #e8e0b8;border-radius:12px;padding:1.5rem;max-width:680px">'+
    '<table style="width:100%;font-size:.88rem;border-collapse:collapse">'+
    row('Received',q.created_at)+row('Name',q.name)+row('Email',q.email)+row('Phone',q.phone)+
    row('Project type',q.project_type)+row('Budget',q.budget)+row('Timeline',q.timeline)+row('Contact via',q.contact_pref)+
    '</table>'+
    '<div style="margin-top:1rem;background:#fdfbf0;border:1px solid #e8e0b8;border-radius:8px;padding:1rem;font-size:.88rem;white-space:pre-wrap">'+escHtml(q.description||'')+'</div>'+
    (picks?'<div style="margin-top:1rem"><div style="font-size:.78rem;color:#6b6040;margin-bottom:.3rem">Inspiration picks</div>'+picks+'</div>':'')+
    (q.inspiration&&q.inspiration.links?'<div style="margin-top:.8rem;font-size:.85rem"><span style="color:#6b6040">Links:</span> '+escHtml(q.inspiration.links)+'</div>':'')+
    '<div style="margin-top:1.2rem;display:flex;gap:.6rem;flex-wrap:wrap"><button class="bp" style="font-size:.8rem;padding:.4rem .9rem" onclick="sendProjectEmail('+q.id+')">📧 Email Customer</button>'+
    '<button class="bd" style="font-size:.8rem;padding:.4rem .9rem" onclick="dsDeleteProject('+q.id+')">🗑️ Delete Project</button></div>'+
    '<h3 style="font-size:.92rem;color:#2d2220;margin:1.4rem 0 .5rem">Notes</h3>'+
    '<div id="ds-notes-list-'+q.id+'">'+(notesHtml||'<div style="font-size:.82rem;color:#6b6040">No notes yet.</div>')+'</div>'+
    '<textarea class="fi" id="ds-note-text-'+q.id+'" rows="2" style="resize:vertical;margin-top:.6rem" placeholder="Add a note about this project…"></textarea>'+
    '<button class="bp" style="font-size:.8rem;padding:.4rem .9rem;margin-top:.4rem" onclick="dsAddNote('+q.id+')">+ Add Note</button>'+
    '</div>';
}
function dsAddNote(projectId){
  var ta=document.getElementById('ds-note-text-'+projectId);
  var text=ta?ta.value.trim():'';
  if(!text)return;
  apiFetch('studio.php','POST',{action:'add_note',project_id:projectId,note_text:text}).then(function(d){
    if(d&&d.success){
      var q=null;DS_INQUIRIES.forEach(function(x){if(x.id===projectId)q=x;});
      if(q){q.notes=q.notes||[];q.notes.unshift(d.note);}
      dsViewInquiry(projectId);
    }
  }).catch(function(){});
}
function dsDeleteNote(projectId,noteId){
  if(!confirm('Delete this note?'))return;
  apiFetch('studio.php','POST',{action:'delete_note',id:noteId}).then(function(){
    var q=null;DS_INQUIRIES.forEach(function(x){if(x.id===projectId)q=x;});
    if(q)q.notes=(q.notes||[]).filter(function(n){return n.id!==noteId;});
    dsViewInquiry(projectId);
  }).catch(function(){});
}

// ── Email customer (mirrors sendGenericEmail/emailPreviewThenSend in admin-orders.js,
// kept separate since those are keyed to order_id and are working order-flow code) ──
function sendProjectEmail(projectId){
  var existing=document.getElementById('generic-email-modal');if(existing)existing.remove();
  var div=document.createElement('div');
  div.id='generic-email-modal';
  div.className='modal-ov on';
  div.style.zIndex='400';
  div.innerHTML=
    '<div class="modal-box" style="max-width:520px;width:95%;padding:1.4rem">'+
      '<div style="font-weight:700;font-size:1rem;margin-bottom:1rem;color:#2d2220">📧 Email Project Customer</div>'+
      '<div class="merr" id="ge-err" style="display:none;background:#fdecea;color:#c0392b;padding:.5rem .8rem;border-radius:6px;font-size:.82rem;margin-bottom:.7rem"></div>'+
      '<label class="fl">Subject *</label>'+
      '<input class="afi" id="ge-subject" placeholder="e.g. Update on your project">'+
      '<label class="fl">Message *</label>'+
      '<textarea class="afi" id="ge-message" rows="6" placeholder="Type your message to the customer…"></textarea>'+
      '<div style="display:flex;gap:.6rem;margin-top:1rem">'+
        '<button class="bp" onclick="previewProjectEmail('+projectId+')">Preview</button>'+
        '<button class="bs" onclick="document.getElementById(\'generic-email-modal\').remove()">Cancel</button>'+
      '</div>'+
    '</div>';
  document.body.appendChild(div);
}
function previewProjectEmail(projectId){
  var subjEl=document.getElementById('ge-subject'), msgInputEl=document.getElementById('ge-message');
  var subject=subjEl?subjEl.value.trim():'', message=msgInputEl?msgInputEl.value.trim():'';
  var errEl=document.getElementById('ge-err');
  if(!subject||!message){
    if(errEl){errEl.style.display='block';errEl.textContent='Subject and message are both required.';}
    return;
  }
  _dsProjectDraft={subject:subject,message:message};
  fetch(SITE_ORIGIN+'/send_studio_project.php',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Token':(window._adminToken||'')},
    body:JSON.stringify({project_id:projectId,subject:subject,message:message,preview:true})})
  .then(function(r){return r.json();})
  .then(function(d){
    if(!d||!d.success||!d.html){
      if(errEl){errEl.style.display='block';errEl.textContent='Could not load preview: '+((d&&d.error)||'unknown');}
      return;
    }
    var modal=document.getElementById('generic-email-modal');if(modal)modal.remove();
    showProjectEmailPreview(projectId,d);
  }).catch(function(e){
    if(errEl){errEl.style.display='block';errEl.textContent='Network error: '+e;}
  });
}
function showProjectEmailPreview(projectId,d){
  var esc=function(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');};
  var existing=document.getElementById('email-preview-modal');if(existing)existing.remove();
  var div=document.createElement('div');
  div.id='email-preview-modal';
  div.className='modal-ov on';
  div.style.zIndex='400';
  div.innerHTML=
    '<div class="modal-box" style="max-width:640px;width:95%;padding:0;overflow:hidden;display:flex;flex-direction:column;max-height:90vh">'+
      '<div style="padding:1rem 1.4rem;border-bottom:1px solid #e8e0b8;display:flex;justify-content:space-between;align-items:center">'+
        '<div style="font-weight:700;color:#2d2220">Preview: Project Update</div>'+
        '<button onclick="document.getElementById(\'email-preview-modal\').remove()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:#6b6040;line-height:1">×</button>'+
      '</div>'+
      '<div style="padding:.7rem 1.4rem;background:#fffdf0;border-bottom:1px solid #e8e0b8;font-size:.82rem;color:#6b6040">'+
        '<div><strong>To:</strong> '+esc(d.to)+'</div>'+
        '<div><strong>Subject:</strong> '+esc(d.subject)+'</div>'+
      '</div>'+
      '<iframe id="email-preview-frame" style="flex:1;width:100%;min-height:360px;border:0;background:#fff"></iframe>'+
      '<div style="padding:.9rem 1.4rem;border-top:1px solid #e8e0b8;display:flex;justify-content:flex-end;gap:.6rem">'+
        '<button class="bs" onclick="document.getElementById(\'email-preview-modal\').remove()">Cancel</button>'+
        '<button class="bp" id="email-preview-send">Send Email</button>'+
      '</div>'+
    '</div>';
  document.body.appendChild(div);
  var frame=document.getElementById('email-preview-frame');
  if(frame)frame.srcdoc=d.html;
  var sendBtn=document.getElementById('email-preview-send');
  if(sendBtn)sendBtn.onclick=function(){projectEmailSendNow(projectId,sendBtn);};
}
function projectEmailSendNow(projectId,btn){
  if(btn){btn.disabled=true;btn.textContent='Sending…';}
  var payload={project_id:projectId};
  if(_dsProjectDraft){payload.subject=_dsProjectDraft.subject;payload.message=_dsProjectDraft.message;}
  fetch(SITE_ORIGIN+'/send_studio_project.php',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Token':(window._adminToken||'')},
    body:JSON.stringify(payload)})
  .then(function(r){return r.json();})
  .then(function(d){
    var modal=document.getElementById('email-preview-modal');if(modal)modal.remove();
    _dsProjectDraft=null;
    if(d&&d.success){alert('✓ Email sent to '+(d.to||'customer')+'!');}
    else{alert('Email failed: '+((d&&d.error)||'unknown'));}
  }).catch(function(e){
    var modal=document.getElementById('email-preview-modal');if(modal)modal.remove();
    alert('Network error: '+e);
  });
}

// ── Content item lists ──
function dsRenderItemList(body,section){
  var items=dsAdminItems(section);
  var isFaq=section==='faq';
  var rows='';
  items.forEach(function(it){
    var d=it.data||{};
    var extra=section==='gallery'?escHtml(d.group||'—'):(section==='faq'?escHtml((d.answer||'').substring(0,70))+((d.answer||'').length>70?'…':''):(section==='service'?escHtml((d.desc||'').substring(0,70)):(section==='project'?escHtml((d.problem||'').substring(0,70)):escHtml((d.quote||'').substring(0,70)))));
    rows+='<tr>'+
      (isFaq?'':'<td>'+(it.image?'<img src="'+escHtml(it.image)+'" style="width:44px;height:44px;object-fit:cover;border-radius:6px">':'—')+'</td>')+
      '<td>'+escHtml(it.title)+'</td><td>'+extra+'</td><td>'+it.sort_order+'</td>'+
      '<td><button class="bp" style="font-size:.72rem;padding:.25rem .6rem;'+(it.active==1?'':'background:#aaa')+'" onclick="dsToggleActive('+it.id+')">'+(it.active==1?'Active':'Hidden')+'</button></td>'+
      '<td><button class="bp" style="font-size:.72rem;padding:.25rem .6rem" onclick="dsShowForm(\''+section+'\','+it.id+')">Edit</button> '+
      '<button class="bd" style="font-size:.72rem;padding:.25rem .6rem" onclick="dsDeleteItem('+it.id+')">Delete</button></td></tr>';
  });
  body.innerHTML='<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;margin-bottom:.8rem">'+
    '<div style="font-size:.82rem;color:#6b6040;max-width:640px;line-height:1.6">'+(DS_SECTION_HINTS[section]||'')+'</div>'+
    '<button class="bp" style="font-size:.8rem;padding:.4rem .9rem;white-space:nowrap" onclick="dsShowForm(\''+section+'\',0)">+ Add</button></div>'+
    '<table class="tablekit"><thead><tr>'+(isFaq?'':'<th>Image</th>')+'<th>'+(section==='testimonial'?'Name':(isFaq?'Question':'Title'))+'</th><th>Details</th><th>Sort</th><th>Visible</th><th>Actions</th></tr></thead><tbody>'+
    (rows||'<tr><td colspan="6" style="text-align:center;padding:2rem;color:#6b6040">Nothing here yet — click + Add to create the first one.</td></tr>')+
    '</tbody></table>';
  if(typeof TableKit!=='undefined')TableKit.initAll();
}
function dsToggleActive(id){
  var it=null;STUDIO_ITEMS.forEach(function(x){if(x.id===id)it=x;});
  if(!it)return;
  it.active=it.active==1?0:1;
  apiFetch('studio.php','POST',{action:'save_item',id:it.id,section:it.section,title:it.title,data:it.data,image:it.image,sort_order:it.sort_order,active:it.active})
    .then(function(){renderStudioAdminTab();}).catch(function(){});
  renderStudioAdminTab();
}
function dsDeleteItem(id){
  if(!confirm('Delete this item? This cannot be undone.'))return;
  apiFetch('studio.php','POST',{action:'delete_item',id:id}).then(function(){
    STUDIO_ITEMS=STUDIO_ITEMS.filter(function(x){return x.id!==id;});
    renderStudioAdminTab();
  }).catch(function(){alert('Delete failed.');});
}

// ── Item add/edit form ──
function dsShowForm(section,id){
  var it=null;if(id){STUDIO_ITEMS.forEach(function(x){if(x.id===id)it=x;});}
  var d=(it&&it.data)||{};
  DS_EDIT_IMG=(it&&it.image)||'';
  var body=document.getElementById('ds-admin-body');
  function fld(label,fid,val,ph){return '<label class="fl">'+label+'</label><input class="fi" id="'+fid+'" value="'+escHtml(val||'').replace(/"/g,'&quot;')+'" placeholder="'+(ph||'')+'">';}
  function area(label,fid,val,rows){return '<label class="fl">'+label+'</label><textarea class="fi" id="'+fid+'" rows="'+(rows||3)+'" style="resize:vertical">'+escHtml(val||'')+'</textarea>';}
  var titleLabel={service:'Service name',gallery:'Photo title',project:'Project title',testimonial:'Customer name',faq:'Question'}[section];
  var h='<button class="bp" style="font-size:.78rem;padding:.35rem .8rem;margin-bottom:1rem" onclick="renderStudioAdminTab()">← Cancel</button>'+
    '<div style="background:#fff;border:1px solid #e8e0b8;border-radius:12px;padding:1.5rem;max-width:640px">'+
    fld(titleLabel,'dsf-title',(it&&it.title)||'');
  if(section==='service'){
    h+=area('Short description','dsf-desc',d.desc)+
       fld('Ideal customer','dsf-ideal',d.ideal,'e.g. gifts, small businesses…')+
       fld('Example project','dsf-example',d.example,'e.g. a graphite portrait from your favorite photo');
  } else if(section==='gallery'){
    h+=fld('Group','dsf-group',d.group,'Portraits, Branding, Jewelry, Corvette Themes…')+
       fld('Image alt text (describes the photo for screen readers)','dsf-alt',d.alt);
  } else if(section==='project'){
    h+=area('The idea / problem','dsf-problem',d.problem)+
       area('Creative approach','dsf-approach',d.approach)+
       area('Finished result','dsf-result',d.result)+
       area('Customer quote (optional)','dsf-quote',d.quote,2)+
       fld('Quote — customer name','dsf-quote-name',d.quote_name);
  } else if(section==='testimonial'){
    h+=area('Quote','dsf-quote',d.quote)+
       fld('Context (optional)','dsf-context',d.context,'e.g. custom pet portrait, logo design…');
  } else if(section==='faq'){
    h+=area('Answer','dsf-answer',d.answer,4);
  }
  if(section!=='faq'){
    h+='<label class="fl">Image (JPEG/PNG, max 4MB)</label>'+
       '<div id="dsf-img-preview" style="margin-bottom:.5rem">'+(DS_EDIT_IMG?'<img src="'+escHtml(DS_EDIT_IMG)+'" style="width:110px;height:110px;object-fit:cover;border-radius:8px">':'<span style="font-size:.8rem;color:#6b6040">No image yet</span>')+'</div>'+
       '<input type="file" id="dsf-img-file" accept="image/jpeg,image/png" style="display:none" onchange="dsFileChosen(this)">'+
       '<button class="bp" style="font-size:.78rem;padding:.35rem .9rem" onclick="document.getElementById(\'dsf-img-file\').click()">📷 '+(DS_EDIT_IMG?'Replace image':'Upload image')+'</button>'+
       (DS_EDIT_IMG?' <button class="bd" style="font-size:.78rem;padding:.35rem .9rem" onclick="dsClearImg()">Remove</button>':'')+
       '<div style="height:.8rem"></div>';
  }
  h+='<div style="display:flex;gap:1rem;align-items:center;margin-top:.4rem">'+
     '<div style="flex:0 0 110px">'+fld('Sort order','dsf-sort',String(it?it.sort_order:dsAdminItems(section).length))+'</div>'+
     '<label style="font-size:.85rem;color:#2d2220;display:flex;align-items:center;gap:.4rem;margin-top:.8rem"><input type="checkbox" id="dsf-active"'+((!it||it.active==1)?' checked':'')+'> Visible on the page</label></div>'+
     '<div class="merr" id="dsf-err"></div>'+
     '<button class="mbtn" style="max-width:220px" onclick="dsSaveItem(\''+section+'\','+(id||0)+')">Save</button>'+
     '</div>';
  body.innerHTML=h;
}
function dsFileChosen(inp){
  var f=inp.files&&inp.files[0];if(!f)return;
  if(f.size>4*1024*1024){alert('Image is larger than 4MB — please resize it first.');inp.value='';return;}
  var r=new FileReader();
  r.onload=function(){DS_EDIT_IMG=r.result;
    var pv=document.getElementById('dsf-img-preview');
    if(pv)pv.innerHTML='<img src="'+DS_EDIT_IMG+'" style="width:110px;height:110px;object-fit:cover;border-radius:8px">';
  };
  r.readAsDataURL(f);
}
function dsClearImg(){DS_EDIT_IMG='';var pv=document.getElementById('dsf-img-preview');if(pv)pv.innerHTML='<span style="font-size:.8rem;color:#6b6040">No image</span>';}
function dsSaveItem(section,id){
  function v(fid){var el=document.getElementById(fid);return el?el.value.trim():'';}
  var title=v('dsf-title');
  var err=document.getElementById('dsf-err');
  if(!title){err.textContent='Please enter a '+(section==='faq'?'question':(section==='testimonial'?'name':'title'))+'.';err.style.display='block';return;}
  var data={};
  if(section==='service')data={desc:v('dsf-desc'),ideal:v('dsf-ideal'),example:v('dsf-example')};
  else if(section==='gallery')data={group:v('dsf-group')||'More',alt:v('dsf-alt')};
  else if(section==='project')data={problem:v('dsf-problem'),approach:v('dsf-approach'),result:v('dsf-result'),quote:v('dsf-quote'),quote_name:v('dsf-quote-name')};
  else if(section==='testimonial')data={quote:v('dsf-quote'),context:v('dsf-context')};
  else if(section==='faq')data={answer:v('dsf-answer')};
  apiFetch('studio.php','POST',{
    action:'save_item',id:id,section:section,title:title,data:data,image:DS_EDIT_IMG,
    sort_order:parseInt(v('dsf-sort'),10)||0,
    active:document.getElementById('dsf-active').checked?1:0
  }).then(function(d){
    if(d&&d.success){loadStudio(function(){renderStudioAdminTab();});}
    else{err.textContent=(d&&d.error)||'Save failed.';err.style.display='block';}
  }).catch(function(){err.textContent='Network error — not saved.';err.style.display='block';});
}

// ── Page Copy form ──
function dsRenderCopyForm(body){
  var c=STUDIO_CFG||DS_DEFAULT_CFG;
  function get(path,dflt){try{var parts=path.split('.');var v=c;for(var i=0;i<parts.length;i++)v=v[parts[i]];return (v==null||v==='')?dflt:v;}catch(e){return dflt;}}
  DS_COPY_IMG=get('hero.image','');
  function fld(label,fid,val,small){return '<label class="fl">'+label+'</label><input class="fi" id="'+fid+'" value="'+escHtml(val||'').replace(/"/g,'&quot;')+'"'+(small?' style="max-width:90px"':'')+'>';}
  var h='<div style="background:#fff;border:1px solid #e8e0b8;border-radius:12px;padding:1.5rem;max-width:760px">'+
    '<div style="font-size:.82rem;color:#6b6040;margin-bottom:1rem;line-height:1.6">Edits here override the page\'s built-in wording. Leave a field as-is to keep the current text.</div>'+
    '<h3 style="font-size:1rem;color:#2d2220;margin-bottom:.6rem">Hero</h3>'+
    fld('Headline','dsc-hero-h',get('hero.headline',DS_DEFAULT_CFG.hero.headline))+
    fld('Supporting line','dsc-hero-s',get('hero.sub',DS_DEFAULT_CFG.hero.sub))+
    fld('Button label','dsc-hero-c',get('hero.cta',DS_DEFAULT_CFG.hero.cta))+
    '<label class="fl">Hero background photo (JPEG/PNG, max 4MB — a wide studio/workspace shot works best)</label>'+
    '<div id="dsc-img-preview" style="margin-bottom:.5rem">'+(DS_COPY_IMG?'<img src="'+escHtml(DS_COPY_IMG)+'" style="width:180px;height:90px;object-fit:cover;border-radius:8px">':'<span style="font-size:.8rem;color:#6b6040">No photo yet — the page shows a warm gradient until one is added.</span>')+'</div>'+
    '<input type="file" id="dsc-img-file" accept="image/jpeg,image/png" style="display:none" onchange="dsCopyFileChosen(this)">'+
    '<button class="bp" style="font-size:.78rem;padding:.35rem .9rem" onclick="document.getElementById(\'dsc-img-file\').click()">📷 '+(DS_COPY_IMG?'Replace photo':'Upload photo')+'</button>'+
    '<h3 style="font-size:1rem;color:#2d2220;margin:1.4rem 0 .6rem">How the Design Studio Works — 5 steps</h3>';
  for(var i=0;i<5;i++){
    var s=get('steps',DS_DEFAULT_CFG.steps)[i]||DS_DEFAULT_CFG.steps[i];
    h+='<div style="display:flex;gap:.6rem"><div style="flex:0 0 70px">'+fld('Icon','dsc-st-i-'+i,s.icon,true)+'</div>'+
       '<div style="flex:1">'+fld('Step '+(i+1)+' title','dsc-st-t-'+i,s.title)+'</div></div>'+
       fld('Step '+(i+1)+' text','dsc-st-c-'+i,s.copy);
  }
  h+='<h3 style="font-size:1rem;color:#2d2220;margin:1.4rem 0 .6rem">Why Work With Suzi — 6 points</h3>';
  for(var j=0;j<6;j++){
    var w=get('why',DS_DEFAULT_CFG.why)[j]||DS_DEFAULT_CFG.why[j];
    h+='<div style="display:flex;gap:.6rem"><div style="flex:0 0 70px">'+fld('Icon','dsc-w-i-'+j,w.icon,true)+'</div>'+
       '<div style="flex:1">'+fld('Point '+(j+1)+' title','dsc-w-t-'+j,w.title)+'</div></div>'+
       fld('Point '+(j+1)+' text','dsc-w-c-'+j,w.copy);
  }
  h+='<h3 style="font-size:1rem;color:#2d2220;margin:1.4rem 0 .6rem">Closing section</h3>'+
    fld('Headline','dsc-fin-h',get('final.headline',DS_DEFAULT_CFG.final.headline))+
    fld('Supporting line','dsc-fin-s',get('final.sub',DS_DEFAULT_CFG.final.sub))+
    fld('Button label','dsc-fin-c',get('final.cta',DS_DEFAULT_CFG.final.cta))+
    '<div class="merr" id="dsc-err"></div>'+
    '<div id="dsc-ok" style="display:none;padding:.6rem;background:#e8f5e9;color:#2e7d32;border-radius:8px;font-size:.85rem;margin-top:.5rem">✓ Saved — the Design Studio page now shows this wording.</div>'+
    '<button class="mbtn" style="max-width:220px" onclick="dsSaveConfig()">Save Page Copy</button>'+
    '</div>';
  body.innerHTML=h;
}
function dsCopyFileChosen(inp){
  var f=inp.files&&inp.files[0];if(!f)return;
  if(f.size>4*1024*1024){alert('Image is larger than 4MB — please resize it first.');inp.value='';return;}
  var r=new FileReader();
  r.onload=function(){DS_COPY_IMG=r.result;
    var pv=document.getElementById('dsc-img-preview');
    if(pv)pv.innerHTML='<img src="'+DS_COPY_IMG+'" style="width:180px;height:90px;object-fit:cover;border-radius:8px">';
  };
  r.readAsDataURL(f);
}
function dsSaveConfig(){
  function v(fid){var el=document.getElementById(fid);return el?el.value.trim():'';}
  var cfg={
    hero:{headline:v('dsc-hero-h'),sub:v('dsc-hero-s'),cta:v('dsc-hero-c'),image:DS_COPY_IMG},
    steps:[],why:[],
    final:{headline:v('dsc-fin-h'),sub:v('dsc-fin-s'),cta:v('dsc-fin-c')}
  };
  for(var i=0;i<5;i++)cfg.steps.push({icon:v('dsc-st-i-'+i),title:v('dsc-st-t-'+i),copy:v('dsc-st-c-'+i)});
  for(var j=0;j<6;j++)cfg.why.push({icon:v('dsc-w-i-'+j),title:v('dsc-w-t-'+j),copy:v('dsc-w-c-'+j)});
  var err=document.getElementById('dsc-err'),okEl=document.getElementById('dsc-ok');
  apiFetch('studio.php','POST',{action:'save_config',config:cfg}).then(function(d){
    if(d&&d.success){
      okEl.style.display='block';err.style.display='none';
      loadStudio(function(){}); // refresh cached config so the storefront page picks it up
      setTimeout(function(){if(okEl)okEl.style.display='none';},4000);
    } else {err.textContent=(d&&d.error)||'Save failed.';err.style.display='block';}
  }).catch(function(){err.textContent='Network error — not saved.';err.style.display='block';});
}
