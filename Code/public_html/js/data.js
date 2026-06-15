// ── DATA ──
function findProd(id){for(var i=0;i<PRODS.length;i++)if(PRODS[i].id===id)return PRODS[i];return null;}
function showSkeleton(){
  var g=document.getElementById('pgrid');if(!g)return;
  var h='';
  for(var i=0;i<6;i++){
    h+='<div class="skel-card">'+
      '<div class="skel skel-img"></div>'+
      '<div class="skel skel-line" style="width:80%"></div>'+
      '<div class="skel skel-line short"></div>'+
      '<div class="skel skel-line shorter"></div>'+
    '</div>';
  }
  g.innerHTML=h;
}
function stripImgs(prods){
  // Store products without images to keep cache small and fast
  return prods.map(function(p){
    var s={};
    for(var k in p)if(k!=='imgs')s[k]=p[k];
    s.imgs=['','',''];
    return s;
  });
}
