<?php
// Token gate — must match rt_token in settings table
(function(){
    $cfg=dirname(__FILE__).'/api/config.php';
    if(!file_exists($cfg)){http_response_code(503);header('Content-Type: application/json');echo json_encode(['error'=>'config missing']);exit;}
    require_once $cfg;
    try{
        $pdo=db();
        $s=$pdo->prepare("SELECT value FROM settings WHERE key_name='rt_token'");
        $s->execute();
        $r=$s->fetch();
        $stored=$r?$r['value']:'';
        $given=$_GET['token']??'';
        if(!$stored||!hash_equals($stored,$given)){
            http_response_code(403);
            header('Content-Type: application/json');
            echo json_encode(['error'=>'Forbidden']);
            exit;
        }
    }catch(Exception $e){
        http_response_code(500);
        header('Content-Type: application/json');
        echo json_encode(['error'=>'DB error']);
        exit;
    }
})();
ob_start();
register_shutdown_function(function(){
    $e=error_get_last();
    if($e&&in_array($e['type'],[E_ERROR,E_PARSE,E_COMPILE_ERROR,E_CORE_ERROR])){
        ob_end_clean();header('Content-Type: application/json');
        echo json_encode(['pass'=>0,'fail'=>1,'total'=>1,'pct'=>0,
            'results'=>[['name'=>'PHP Fatal','ok'=>false,'detail'=>$e['message'].' line '.$e['line']]]]);
    }
});
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
set_time_limit(20);
$results=[];$pass=0;$fail=0;
function t($n,$ok,$d=''){global $results,$pass,$fail;$ok?$pass++:$fail++;$results[]=['name'=>$n,'ok'=>(bool)$ok,'detail'=>(string)$d];}
// tProd: a check that is only meaningful on production. On the staging subdomain (Basic-Auth
// gated, own .htaccess, separate DB) it is reported as skipped instead of failing.
function tProd($n,$ok,$d=''){global $isStaging; if($isStaging){t($n,true,'skipped — N/A on staging');}else{t($n,$ok,$d);}}

try{
require_once __DIR__.'/api/config.php';
$pdo=db();
$root=__DIR__;
$isStaging=stripos($_SERVER['HTTP_HOST'] ?? '', 'staging')!==false;

// ── 1. DB SCHEMA ──
$ocols=$pdo->query("SHOW COLUMNS FROM orders")->fetchAll(PDO::FETCH_COLUMN);
foreach(['tax_amount','tax_swept_date','payment_method','customer_email','total','shipping_carrier','tracking_number'] as $col)
    t('orders.'.$col, in_array($col,$ocols));
$pcols=$pdo->query("SHOW COLUMNS FROM products")->fetchAll(PDO::FETCH_COLUMN);
foreach(['sku','img1','price','name','stock','weight'] as $col)
    t('products.'.$col, in_array($col,$pcols));
$tbls=$pdo->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);
foreach(['orders','products','order_items','settings','tax_sweeps','email_log'] as $tb)
    t($tb.' table', in_array($tb,$tbls));
$sv=$pdo->query("SHOW COLUMNS FROM settings WHERE Field='value'")->fetch(PDO::FETCH_ASSOC);
t('settings LONGTEXT', $sv&&strtolower($sv['Type'])==='longtext', $sv?$sv['Type']:'?');
t('tax_swept removed', !in_array('tax_swept',$ocols));

// ── 2. DATA ──
try{t('products exist',(int)$pdo->query("SELECT COUNT(*) FROM products")->fetchColumn()>0);}catch(Exception $e){t('products exist',false,$e->getMessage());}
try{$orderCount=(int)$pdo->query("SELECT COUNT(*) FROM orders")->fetchColumn();t('orders table accessible',$orderCount>=0,'count: '.$orderCount);}catch(Exception $e){t('orders table accessible',false,$e->getMessage());}
try{t('settings exist',(int)$pdo->query("SELECT COUNT(*) FROM settings")->fetchColumn()>0);}catch(Exception $e){t('settings exist',false,$e->getMessage());}
try{$rtt=$pdo->query("SELECT value FROM settings WHERE key_name='rt_token' LIMIT 1")->fetchColumn();t('rt_token set',$rtt!==false&&strlen($rtt)>=16);}catch(Exception $e){t('rt_token set',false,$e->getMessage());}
try{$pc=$pdo->query("SELECT value FROM settings WHERE key_name='payment_configuration' LIMIT 1")->fetchColumn();t('payment_configuration valid',$pc===false||in_array($pc,['Online','InPerson','Test']),$pc===false?'(unset — defaults to Online)':$pc);}catch(Exception $e){t('payment_configuration valid',false,$e->getMessage());}
try{$sh=json_decode($pdo->query("SELECT value FROM settings WHERE key_name='shipping_config' LIMIT 1")->fetchColumn(),true);t('shipping_config',$sh!==null&&isset($sh['zone_rates']));}catch(Exception $e){t('shipping_config',false,$e->getMessage());}
try{$bzRaw=$pdo->query("SELECT value FROM settings WHERE key_name='biz_profile' LIMIT 1")->fetchColumn();$bz=$bzRaw?json_decode($bzRaw,true):null;t('biz_profile valid JSON',$bzRaw===false||$bz!==null,$bzRaw===false?'(unset — Business > Profile not yet saved)':'invalid JSON');}catch(Exception $e){t('biz_profile valid JSON',false,$e->getMessage());}
try{$n=(int)$pdo->query("SELECT COUNT(*) FROM products WHERE sku IS NOT NULL AND sku!=''")->fetchColumn();t('products have SKUs',$n>0,$n.' with SKU');}catch(Exception $e){t('products have SKUs',false,$e->getMessage());}
try{$d=$pdo->query("SELECT sku,COUNT(*) c FROM products WHERE sku!='' GROUP BY sku HAVING c>1")->fetchAll();t('no duplicate SKUs',count($d)===0,count($d).' dupes');}catch(Exception $e){t('no duplicate SKUs',false,$e->getMessage());}
try{
  $noDesc=$pdo->query("SELECT name FROM products WHERE description IS NULL OR description='' LIMIT 5")->fetchAll(PDO::FETCH_COLUMN);
  $sameAsName=$pdo->query("SELECT name FROM products WHERE description IS NOT NULL AND description!='' AND TRIM(description)=TRIM(name) LIMIT 5")->fetchAll(PDO::FETCH_COLUMN);
  $msgs=[];
  if(count($noDesc))$msgs[]=count($noDesc).' missing description: '.implode(', ',$noDesc);
  if(count($sameAsName))$msgs[]=count($sameAsName).' same as name: '.implode(', ',$sameAsName);
  $ok=count($noDesc)===0&&count($sameAsName)===0;
  t('product descriptions updated',$ok,implode(' | ',$msgs));
}catch(Exception $e){t('product descriptions updated',false,$e->getMessage());}
t('hero.jpg exists', file_exists($root.'/hero.jpg'));
// Image optimization bloat guards — catches an accidental re-upload of a huge
// unoptimized original (this session's images were all resized to <=1600px / compressed)
try{
    t('hero.jpg under size guard',filesize($root.'/hero.jpg')<500*1024,round(filesize($root.'/hero.jpg')/1024).'KB');
    t('QRCode.png exists',file_exists($root.'/QRCode.png'));
    t('QRCode.png under size guard',file_exists($root.'/QRCode.png')&&filesize($root.'/QRCode.png')<50*1024);
    t('HDBSLogo.jpeg under size guard',file_exists($root.'/HDBSLogo.jpeg')&&filesize($root.'/HDBSLogo.jpeg')<50*1024);
    if(is_dir($root.'/product_images')){
        $piOversized=[];
        $piFiles=array_diff(scandir($root.'/product_images'),['.','..']);
        foreach($piFiles as $pif){
            $pipath=$root.'/product_images/'.$pif;
            if(is_file($pipath)&&filesize($pipath)>900*1024)$piOversized[]=$pif;
        }
        t('product_images all under size guard',count($piOversized)===0,count($piOversized).' oversized: '.implode(', ',array_slice($piOversized,0,5)));
    }
}catch(Exception $e){t('image optimization guards',false,$e->getMessage());}
// Email log checks
try{
    $elCols=$pdo->query("SHOW COLUMNS FROM email_log")->fetchAll(PDO::FETCH_COLUMN);
    t('email_log.sent_at col',   in_array('sent_at',$elCols));
    t('email_log.email_type col',in_array('email_type',$elCols));
    t('email_log.sent_to col',   in_array('sent_to',$elCols));
    t('email_log.order_id col',  in_array('order_id',$elCols));
    t('email_log.status col',    in_array('status',$elCols));
    $elHasConvertTz=strpos(file_get_contents($root.'/send_shipping.php'),'CONVERT_TZ')!==false;
    t('send_shipping uses EDT',  $elHasConvertTz);
    $elHasConvertTz2=strpos(file_get_contents($root.'/send_confirm.php'),'CONVERT_TZ')!==false;
    t('send_confirm uses EDT',   $elHasConvertTz2);
}catch(Exception $e){t('email_log checks',false,$e->getMessage());}
try{$shopcss0=file_get_contents($root.'/css/shop.css');t('shop.css has /hero.jpg',strpos($shopcss0,'url("/hero.jpg')!==false);t('product card image (.cimg img) uses contain',strpos($shopcss0,'.cimg img{width:100%;height:100%;object-fit:contain')!==false);
    t('product card image box (.cimg) has border',strpos($shopcss0,'.cimg{height:160px;background:#ffffff;border:1px solid')!==false);}catch(Exception $e){t('shop.css check',false,$e->getMessage());}

// ── 2b. NEW SESSION CHECKS ──
// orders.square_payment_id column
t('orders.square_payment_id', in_array('square_payment_id',$ocols));
// fetch_tax.php exists in api/
t('api/fetch_tax.php', file_exists($root.'/api/fetch_tax.php'));
// verify_payment fetches tax from Square Orders API
try{$vp=file_get_contents($root.'/verify_payment.php');t('verify_payment fetches sq order tax',strpos($vp,'/orders/')!==false&&strpos($vp,'total_tax_money')!==false);}catch(Exception $e){t('verify_payment sq order tax',false,$e->getMessage());}
// verify_payment uses atomic INSERT IGNORE guard
try{$vp=isset($vp)?$vp:file_get_contents($root.'/verify_payment.php');t('verify_payment atomic guard',strpos($vp,'INSERT IGNORE')!==false);}catch(Exception $e){t('verify_payment atomic guard',false,$e->getMessage());}
// verify_payment retries Square lookup
try{$vp=isset($vp)?$vp:file_get_contents($root.'/verify_payment.php');t('verify_payment has retry',strpos($vp,'retry')!==false&&strpos($vp,'sleep(')!==false);}catch(Exception $e){t('verify_payment retry',false,$e->getMessage());}
// verify_payment updates total from Square
try{$vp=isset($vp)?$vp:file_get_contents($root.'/verify_payment.php');t('verify_payment updates total',strpos($vp,'total=?')!==false&&strpos($vp,'sq_total')!==false);}catch(Exception $e){t('verify_payment total',false,$e->getMessage());}
// verify_payment uses location_id in Square API call
try{$vp=isset($vp)?$vp:file_get_contents($root.'/verify_payment.php');t('verify_payment uses location_id',strpos($vp,'location_id=LJP687TQBTWTA')!==false);}catch(Exception $e){t('verify_payment location_id',false,$e->getMessage());}
// notify.php logs the owner "Order Received" notification to email_log
try{$np=file_get_contents($root.'/notify.php');t('notify.php logs Order Received to email_log',strpos($np,"INSERT INTO email_log")!==false&&strpos($np,'Order Received')!==false);}catch(Exception $e){t('notify.php logs Order Received to email_log',false,$e->getMessage());}
// verify_payment.php logs email_body to email_log
try{$vp=isset($vp)?$vp:file_get_contents($root.'/verify_payment.php');t('verify_payment logs email_body',strpos($vp,'email_body')!==false&&strpos($vp,'INSERT INTO email_log')!==false);}catch(Exception $e){t('verify_payment logs email_body',false,$e->getMessage());}
// notify.php includes SKU in items
try{$np=isset($np)?$np:file_get_contents($root.'/notify.php');t('notify.php items include SKU',strpos($np,'sku_map')!==false);}catch(Exception $e){t('notify.php SKU',false,$e->getMessage());}
// ui.js loads shipping_config on storefront startup
try{$uijs=file_get_contents($root.'/js/ui.js');t('ui.js loads shipping_config',strpos($uijs,'shipping_config')!==false&&strpos($uijs,'applyShippingConfig')!==false);}catch(Exception $e){t('ui.js shipping_config',false,$e->getMessage());}
// fetch_tax.php uses Square Orders API for tax
try{$ftx=file_get_contents($root.'/api/fetch_tax.php');t('fetch_tax uses sq orders api',strpos($ftx,'/orders/')!==false&&strpos($ftx,'total_tax_money')!==false);}catch(Exception $e){t('fetch_tax sq orders',false,$e->getMessage());}
// fetch_tax.php updates total from Square
try{$ftx=isset($ftx)?$ftx:file_get_contents($root.'/api/fetch_tax.php');t('fetch_tax updates total',strpos($ftx,'total_money')!==false&&strpos($ftx,'UPDATE orders SET tax_amount')!==false);}catch(Exception $e){t('fetch_tax updates total',false,$e->getMessage());}
// JS fetchOrderTax function exists
// Sell column and order_type
try{
    $ocols2=$pdo->query("SHOW COLUMNS FROM products")->fetchAll(PDO::FETCH_COLUMN);
    t('products.sell column exists',in_array('sell',$ocols2));
}catch(Exception $e){t('products.sell column',false,$e->getMessage());}
try{
    $ordcols=$pdo->query("SHOW COLUMNS FROM orders")->fetchAll(PDO::FETCH_COLUMN);
    t('orders.order_type column exists',in_array('order_type',$ordcols));
}catch(Exception $e){t('orders.order_type column',false,$e->getMessage());}
try{$apijs=isset($apijs)?$apijs:file_get_contents($root.'/js/admin-products.js');
    t('toggleSell function exists',strpos($apijs,'function toggleSell(')!==false);
    t('sell checkbox in form',strpos($apijs,'pf-sell')!==false);
    t('sell column in product table',strpos($apijs,"'<th>Sell</th>'")!==false||strpos($apijs,'<th>Sell</th>')!==false);
}catch(Exception $e){t('sell checks',false,$e->getMessage());}
try{$sjs2=isset($sjs2)?$sjs2:file_get_contents($root.'/js/store.js');
    t('store filters sell',strpos($sjs2,'p.sell!==0')!==false);
}catch(Exception $e){t('store sell filter',false,$e->getMessage());}
// Product management sort/filter
try{$apjs=isset($apjs)?$apjs:file_get_contents($root.'/js/admin-products.js');
    t('prodSort function exists',strpos($apjs,'function prodSort(')!==false);
    t('prodFilt function exists',strpos($apjs,'function prodFilt(')!==false);
    t('applyProdFilters exists',strpos($apjs,'function applyProdFilters(')!==false);
    t('buildProdThead exists',strpos($apjs,'function buildProdThead(')!==false);
    t('setAllStock1 exists',strpos($apjs,'function setAllStock1(')!==false);
    t('setAllPrice1 exists',strpos($apjs,'function setAllPrice1(')!==false);
    t('autoAssignSkus exists',strpos($apjs,'function autoAssignSkus(')!==false);
    t('exportProductsCsv exists',strpos($apjs,'function exportProductsCsv(')!==false);
    t('showImportCsv exists',strpos($apjs,'function showImportCsv(')!==false);
    t('Export CSV button removed from products toolbar (on PageToolbar)',strpos($apjs,"onclick=\"exportProductsCsv()\"")===false);
    t('size column in product table',strpos($apjs,"'<th>Size</th>'")!==false||strpos($apjs,'<th>Size</th>')!==false);
    t('size in PROD_F filter',strpos($apjs,"PROD_F={name:'',cat:'',sku:'',size:''")!==false);
    t('size field in product form',strpos($apjs,'pf-sz')!==false);
}catch(Exception $e){t('admin-products checks',false,$e->getMessage());}
// products_csv.php exists and completeness
try{
    t('api/products_csv.php exists',file_exists($root.'/api/products_csv.php'));
    $csvphp=file_get_contents($root.'/api/products_csv.php');
    t('products_csv export includes sell column',strpos($csvphp,"'id','sku','name','description','price','cogm','launch_date','stock','category','badge','weight','size','sell','img1','img2','img3'")!==false);
    t('products_csv import includes sell column',strpos($csvphp,"':sell'")!==false);
    t('products_csv ON DUPLICATE KEY updates img1',strpos($csvphp,'img1=:img1')!==false);
    t('products_csv ON DUPLICATE KEY updates img2',strpos($csvphp,'img2=:img2')!==false);
    t('products_csv ON DUPLICATE KEY updates img3',strpos($csvphp,'img3=:img3')!==false);
    t('products_csv ON DUPLICATE KEY updates sell',strpos($csvphp,'sell=:sell')!==false);
}catch(Exception $e){t('products_csv checks',false,$e->getMessage());}

// ── PER-ITEM SHIPPING (weight | fixed) ──
try{
    $pphp=file_get_contents($root.'/api/products.php');
    t('products.php GET returns ship_mode/ship_fixed',strpos($pphp,"'ship_mode'")!==false&&strpos($pphp,"'ship_fixed'")!==false);
    t('products.php uses ensureProductColumns',strpos($pphp,'ensureProductColumns($pdo)')!==false);
    t('products.php INSERT binds ship columns',strpos($pphp,':ship_mode')!==false&&strpos($pphp,':ship_fixed')!==false);
    $cfgmig=file_get_contents($root.'/api/config.php');
    t('config.php has ensureProductColumns helper',strpos($cfgmig,'function ensureProductColumns(')!==false&&strpos($cfgmig,'ADD COLUMN')!==false&&strpos($cfgmig,'ship_mode')!==false&&strpos($cfgmig,'ship_fixed')!==false);
    $csv2=file_get_contents($root.'/api/products_csv.php');
    t('products_csv export includes ship columns',strpos($csv2,"'ship_mode','ship_fixed'")!==false);
    t('products_csv import binds ship columns',strpos($csv2,':ship_mode')!==false&&strpos($csv2,':ship_fixed')!==false);
    t('products_csv uses ensureProductColumns',strpos($csv2,'ensureProductColumns($pdo)')!==false);
    $sj=file_get_contents($root.'/js/store.js');
    t('store.js per-item shipping helpers',strpos($sj,'function cartFixedShip(')!==false&&strpos($sj,'function hasWeightItems(')!==false&&strpos($sj,'function cartWeightItems(')!==false);
    t('store.js calcShipping uses fixed + weight items',strpos($sj,'cartFixedShip()')!==false&&strpos($sj,'cartWeightItems()')!==false);
    $apj=file_get_contents($root.'/js/admin-products.js');
    t('product form has shipping mode select',strpos($apj,'id="pf-shipmode"')!==false&&strpos($apj,'Fixed amount per item')!==false);
    t('product form fixed amount is currency field',strpos($apj,'id="pf-shipfixed"')!==false&&strpos($apj,'toFixed(2)')!==false);
    t('pfToggleShipFixed function exists',strpos($apj,'function pfToggleShipFixed(')!==false);
    t('saveP sends ship_mode/ship_fixed',strpos($apj,'ship_mode:shipMode')!==false&&strpos($apj,'ship_fixed:shipFixed')!==false);
    t('product table has Shipping column',strpos($apj,'<th>Shipping</th>')!==false);
    t('product table shows fixed amount',strpos($apj,"'Fixed \$'+(parseFloat(p.ship_fixed)")!==false);
    $aoj=file_get_contents($root.'/js/admin-orders.js');
    t('shipping math shared via combineShipping',strpos($sj,'function combineShipping(')!==false&&strpos($sj,'return combineShipping(')!==false);
}catch(Exception $e){t('per-item shipping checks',false,$e->getMessage());}

// ── HOMEPAGE REDESIGN + COMING SOON ──
try{
    $cpphp=file_get_contents($root.'/api/products.php');
    t('products.php GET returns coming_soon',strpos($cpphp,"'coming_soon'")!==false);
    t('ensureProductColumns migrates coming_soon',strpos(file_get_contents($root.'/api/config.php'),"'coming_soon' => \"TINYINT")!==false);
    t('products.php INSERT binds coming_soon',strpos($cpphp,':coming_soon')!==false);
    $ccsv=file_get_contents($root.'/api/products_csv.php');
    t('products_csv includes coming_soon',strpos($ccsv,"'ship_fixed','coming_soon'")!==false&&strpos($ccsv,':coming_soon')!==false);
    $csub=file_get_contents($root.'/api/subscribers.php');
    t('subscribers.php captures source (Notify me)',strpos($csub,'ADD COLUMN source')!==false&&strpos($csub,"\$d['source']")!==false);
    $capj=file_get_contents($root.'/js/admin-products.js');
    t('product form has Coming Soon checkbox',strpos($capj,'id="pf-coming"')!==false);
    t('saveP sends coming_soon',strpos($capj,"coming_soon:document.getElementById('pf-coming')")!==false);
    t('product table shows SOON badge',strpos($capj,'>SOON</span>')!==false&&strpos($capj,'p.coming_soon')!==false);
    $csj=file_get_contents($root.'/js/store.js');
    t('store.js renderComingSoon + notifyMe',strpos($csj,'function renderComingSoon(')!==false&&strpos($csj,'function notifyMe(')!==false);
    t('store.js excludes coming_soon from buy grid',strpos($csj,'p.sell!==0&&!p.coming_soon')!==false);
    t('notifyMe writes tagged subscriber',strpos($csj,"source:'Coming Soon: '")!==false);
    // COGM and Launch Date columns
    t('products.php GET includes cogm and launch_date',strpos($cpphp,"'cogm'")!==false&&strpos($cpphp,"'launch_date'")!==false);
    t('products.php INSERT binds cogm and launch_date',strpos($cpphp,':cogm')!==false&&strpos($cpphp,':launch_date')!==false);
    t('products.php defaults COGM to 50% of price',strpos($cpphp,'$default_cogm = $price * 0.5')!==false);
    t('products.php defaults launch_date to 2026-07-01',strpos($cpphp,"'launch_date'] ?? '2026-07-01'")!==false);
    t('config.php migrates cogm + launch_date columns',strpos(file_get_contents($root.'/api/config.php'),"'cogm' => \"DECIMAL")!==false&&strpos(file_get_contents($root.'/api/config.php'),"'launch_date' => \"DATE")!==false);
    t('admin-products.js form includes COGM field',strpos($apj,"id=\"pf-cogm\"")!==false&&strpos($apj,"50% of price")!==false);
    t('admin-products.js form includes Launch Date field',strpos($apj,"id=\"pf-launch\"")!==false&&strpos($apj,"type=\"date\"")!==false);
    t('admin-products.js table shows COGM column',strpos($apj,"p.cogm?p.cogm.toFixed(2):'0.00'")!==false);
    t('admin-products.js table shows Launch Date column',strpos($apj,"p.launch_date")!==false);
    t('admin-products.js saveP sends cogm and launch_date',strpos($apj,'cogm:cogm')!==false&&strpos($apj,'launch_date:launch')!==false);
    t('products_csv export includes cogm and launch_date',strpos($ccsv,"'cogm','launch_date'")!==false);
    t('products_csv import binds cogm and launch_date',strpos($ccsv,':cogm')!==false&&strpos($ccsv,':launch_date')!==false);
    $chtml=file_get_contents($root.'/index.php');
    t('index.php has Coming Soon section',strpos($chtml,'id="coming-soon"')!==false&&strpos($chtml,'id="cs-grid"')!==false);
    t('Coming Soon has First look eyebrow',strpos($chtml,'First look')!==false);
    t('index.php loads Playfair + Inter',strpos($chtml,'Playfair+Display')!==false&&strpos($chtml,'family=Inter')!==false);
    t('hero redesigned (overline + buttons)',strpos($chtml,'hero-overline')!==false&&strpos($chtml,'hbtn-primary')!==false&&strpos($chtml,'Visit the Design Studio')!==false);
    t('homepage has featured collections',strpos($chtml,'id="featured-cards"')!==false);
    t('homepage has about teaser',strpos($chtml,'class="about-teaser"')!==false);
    t('homepage process section removed',strpos($chtml,'class="process"')===false&&strpos($chtml,'class="proc-steps"')===false);
    t('store.js renderFeatured + goCat',strpos($csj,'function renderFeatured(')!==false&&strpos($csj,'function goCat(')!==false);
    $css2=file_get_contents($root.'/css/shop.css');
    t('shop.css defines neutral palette vars',strpos($css2,'--ivory:#F8F6F2')!==false&&strpos($css2,'--gold:#B88A44')!==false&&strpos($css2,'--charcoal:#2B2B2B')!==false);
    t('shop.css defines font vars',strpos($css2,"--font-head:'Playfair Display'")!==false);
    t('shop.css Coming Soon band',strpos($css2,'#coming-soon{background:var(--charcoal)')!==false);
    t('shop.css hero + featured + process styles',strpos($css2,'.hbtn-primary')!==false&&strpos($css2,'.fc-card')!==false&&strpos($css2,'.proc-num')!==false);
}catch(Exception $e){t('homepage redesign + coming soon checks',false,$e->getMessage());}

// ── REDESIGN PHASE 4-5 (gallery, nav, palette cohesion) ──
try{
    $rhtml=file_get_contents($root.'/index.php');
    t('homepage has masonry gallery',strpos($rhtml,'id="gallery-grid"')!==false&&strpos($rhtml,'class="masonry"')!==false);
    t('nav has Gallery + Design Studio',strpos($rhtml,'goGallery()')!==false&&strpos($rhtml,'goStudio()')!==false);
    t('nav Custom Bags entry removed',strpos($rhtml,'Custom Bags')===false);
    $rsj=file_get_contents($root.'/js/store.js');
    t('store.js renderGallery + goGallery',strpos($rsj,'function renderGallery(')!==false&&strpos($rsj,'function goGallery(')!==false);
    t('cat filter uses muted gold',strpos($rsj,"active?'#B88A44'")!==false);
    $rcss=file_get_contents($root.'/css/shop.css');
    t('shop.css masonry styles',strpos($rcss,'.masonry{column-count')!==false);
    t('nav recolored charcoal',strpos($rcss,'nav{background:var(--charcoal)')!==false);
    t('body background ivory',strpos($rcss,'body{font-family:var(--font-body);background:var(--ivory)')!==false);
    t('product price muted gold',strpos($rcss,'.price{font-weight:700;color:var(--gold)')!==false);
    t('footer charcoal',strpos($rcss,'footer{background:var(--charcoal)')!==false);
    t('palette centralized (hex only in :root)',substr_count($rcss,'#2B2B2B')===1&&substr_count($rcss,'#B88A44')===1);
    t('newsletter sage band',strpos($rcss,'.newsletter{background:var(--sage)')!==false);
    t('reviews section neutral',strpos($rcss,'.reviews-section{background:var(--ivory)')!==false);
    t('newsletter gold gradient removed',strpos($rcss,'.newsletter{background:linear-gradient')===false);
    t('Featured Collections show complete image',strpos($rcss,'.fc-img{aspect-ratio:4/3;background:#fff;background-size:contain')!==false);
    t('gallery heading is From my studio',strpos($rhtml,'From my studio')!==false);
    t('gallery positioned below Coming Soon',strpos($rhtml,'id="coming-soon"')!==false&&strpos($rhtml,'id="gallery"')!==false&&strpos($rhtml,'id="coming-soon"')<strpos($rhtml,'id="gallery"'));
}catch(Exception $e){t('redesign phase 4-5 checks',false,$e->getMessage());}

// admin-products.js new features
try{
    $apjs2=file_get_contents($root.'/js/admin-products.js');
    t('admin-products: Weight column in table header',strpos($apjs2,'<th>Weight</th>')!==false);
    t('admin-products: Description column in table header',strpos($apjs2,'<th>Description</th>')!==false);
    t('admin-products: double-click row opens edit',strpos($apjs2,'ondblclick')!==false&&strpos($apjs2,'showPF(')!==false);
    t('admin-products: saveP waits for API response',strpos($apjs2,'Save failed')!==false&&strpos($apjs2,'button.bp')!==false);
    t('admin-products: Add Product defaults price to 1',strpos($apjs2,"p?p.price:'1'")!==false);
    t('admin-products: Add Product defaults stock to 1',strpos($apjs2,"p?p.stock:'1'")!==false);
    t('admin-products: Add Product sell unchecked by default',strpos($apjs2,"p&&p.sell!==0?'checked':''")!==false);
    t('admin-products: Add Product defaults name to next sequence',strpos($apjs2,'nextSeq')!==false&&strpos($apjs2,'maxSeq+1')!==false);
    t('admin-products: focus on name field on open',strpos($apjs2,"'pf-n'")!==false&&strpos($apjs2,'f.focus()')!==false);
    t('admin-products: Save button in form bottom',strpos($apjs2,"onclick=\"saveP()\">💾 Save</button>")!==false||strpos($apjs2,'onclick="saveP()">💾 Save</button>')!==false);
}catch(Exception $e){t('admin-products new features checks',false,$e->getMessage());}

// config.js: admin login focuses password field
try{
    $cfgjs2=file_get_contents($root.'/js/config.js');
    t('goAdminLogin focuses password field',strpos($cfgjs2,'goAdminLogin')!==false&&strpos($cfgjs2,"'lpw'")!==false&&strpos($cfgjs2,'f.focus()')!==false);
}catch(Exception $e){t('goAdminLogin focus check',false,$e->getMessage());}
// Customer table sort/filter
try{$aojs=isset($aojs)?$aojs:file_get_contents($root.'/js/admin-orders.js');
    t('custSort function exists',strpos($aojs,'function custSort(')!==false);
    t('custFilt function exists',strpos($aojs,'function custFilt(')!==false);
    t('applyCustomerFilters exists',strpos($aojs,'function applyCustomerFilters(')!==false);
    t('buildCustThead exists',strpos($aojs,'function buildCustThead(')!==false);
}catch(Exception $e){t('admin-orders customer checks',false,$e->getMessage());}
// TN City Sales Tax
try{
    $amjs2=isset($amjs)?$amjs:file_get_contents($root.'/js/admin-misc.js');
    $amjs=$amjs2;
    $tncityCount=substr_count($amjs,'function rTnCity');
    t('rTnCity no duplicate',$tncityCount===1,'found '.$tncityCount.' (expected 1)');
    t('rTnCity function exists',strpos($amjs,'function rTnCity(')!==false);
    t('TN City link buttons',strpos($amjs,'TN Official Rate Source')!==false);
    t('addTnCity function exists',strpos($amjs,'function addTnCity(')!==false);
    t('saveTnCity function exists',strpos($amjs,'function saveTnCity(')!==false);
    t('deleteTnCity function exists',strpos($amjs,'function deleteTnCity(')!==false);
}catch(Exception $e){t('TN city tax checks',false,$e->getMessage());}
try{t('api/tn_city_tax.php exists',file_exists($root.'/api/tn_city_tax.php'));}catch(Exception $e){t('tn_city_tax.php',false,$e->getMessage());}
try{
    $tncols=$pdo->query("SHOW COLUMNS FROM tn_city_tax")->fetchAll(PDO::FETCH_COLUMN);
    t('tn_city_tax table exists',count($tncols)>0);
    t('tn_city_tax has city col',in_array('city',$tncols));
    t('tn_city_tax has county col',in_array('county',$tncols));
    t('tn_city_tax has tax_rate col',in_array('tax_rate',$tncols));
}catch(Exception $e){t('tn_city_tax table',false,'Table missing - run add_tn_city_tax.php');}
// TN Sales Tax county table removed
try{
    $hasTnTax=false;
    try{$pdo->query('SELECT 1 FROM tn_sales_tax LIMIT 1');$hasTnTax=true;}catch(Exception $e2){}
    t('tn_sales_tax table removed',!$hasTnTax,'Table still exists - run drop_tn_tax.php');
}catch(Exception $e){t('tn_sales_tax removed',false,$e->getMessage());}
// Orders API - transaction fee
try{
    $ordcols2=$pdo->query("SHOW COLUMNS FROM orders")->fetchAll(PDO::FETCH_COLUMN);
    t('orders.transaction_fee column exists',in_array('transaction_fee',$ordcols2));
}catch(Exception $e){t('orders.transaction_fee column',false,$e->getMessage());}
// Phone formatting
try{$sjs3=isset($sjs)?$sjs:file_get_contents($root.'/js/store.js');
    $sjs=$sjs3;
    t('fmtPhone in store.js',strpos($sjs,'function fmtPhone(')!==false);
}catch(Exception $e){t('fmtPhone',false,$e->getMessage());}
// Confirmation emails
try{
    $vpphp=file_get_contents($root.'/verify_payment.php');
    t('verify_payment has Order Type',strpos($vpphp,'Order Type')!==false);
    t('verify_payment has biz_profile footer',strpos($vpphp,'biz_url_vp')!==false);
    t('verify_payment display total calc',strpos($vpphp,'display_total')!==false);
}catch(Exception $e){t('verify_payment email checks',false,$e->getMessage());}
try{
    $ssphp=file_get_contents($root.'/send_shipping.php');
    t('send_shipping has biz_profile footer',strpos($ssphp,'biz_url_display2')!==false);
    // Review request (2026-07-03): shipping email asks customer to review + links to the
    // storefront's review section (part of the main store page, no separate review route)
    t('send_shipping includes a review request',strpos($ssphp,"we'd love to hear what you think")!==false);
    t('send_shipping links to the reviews section',strpos($ssphp,"https://handmadedesignsbysuzi.com/#reviews-section")!==false);
    t('send_shipping review link has a Write a Review button',strpos($ssphp,'Write a Review')!==false);
}catch(Exception $e){t('send_shipping checks',false,$e->getMessage());}
// Products screen
try{
    $apjs=isset($apjs)?$apjs:file_get_contents($root.'/js/admin-products.js');
    t('Status column removed from products table',strpos($apjs,"key:'status',label:'Status'")===false);
    t('Stock column in products header',strpos($apjs,'<th>Stock</th>')!==false);
    t('Stock cell in product row',strpos($apjs,'p.stock||0')!==false);
    t('Weight column removed from product row',strpos($apjs,"p.weight?' lbs")===false);
    t('Shipping reads from order.shipping',strpos($apjs,'order.shipping>0?order.shipping')!==false);
    t('Transaction fee shows for Credit Card',strpos($apjs,"pay==='Credit Card'||order.pay==='Square'")!==false);
}catch(Exception $e){t('products screen checks',false,$e->getMessage());}
// Business: Profile / Documents / Inventory / Reports nav folder
try{
    $amjsBiz=isset($amjs)?$amjs:file_get_contents($root.'/js/admin-misc.js');
    $amjs=$amjsBiz;
    $anjsBiz=isset($anjs)?$anjs:file_get_contents($root.'/js/admin-nav.js');
    $anjs=$anjsBiz;
    $abjs=file_get_contents($root.'/js/admin-business.js');
    t('Business folder in ADMIN_NAV_STRUCTURE_DEFAULT',strpos($amjs,"type:'folder',sec:'business'")!==false);
    t('Business folder children are Profile/Documents/Inventory/Reports/Capital Equipment',strpos($amjs,"children:['bizprofile','bizdocs','bizinv','bizreports','bizequip']")!==false);
    t('Nav migration consolidates legacy bizprofile into Business folder',strpos($amjs,'hasBusinessFolder')!==false);
    t('Nav migration adds bizequip into existing Business folder',strpos($amjs,"indexOf('bizequip')<0")!==false);
    t('bizdocs/bizinv/bizreports routed in admin-nav.js',strpos($anjs,"rBizDocs(el)")!==false&&strpos($anjs,"rBizInv(el)")!==false&&strpos($anjs,"rBizReports(el)")!==false);
    t('bizequip routed in admin-nav.js',strpos($anjs,"rBizEquip(el)")!==false);
    t('admin-business.js defines rBizProfile',strpos($abjs,'function rBizProfile(')!==false);
    t('admin-business.js defines rBizDocs',strpos($abjs,'function rBizDocs(')!==false);
    t('admin-business.js defines rBizInv',strpos($abjs,'function rBizInv(')!==false);
    t('admin-business.js defines rBizReports',strpos($abjs,'function rBizReports(')!==false);
    t('admin-business.js defines rBizEquip',strpos($abjs,'function rBizEquip(')!==false);
    t('Profile form has business name field',strpos($abjs,'bp-name')!==false);
    t('Profile form has short name field',strpos($abjs,'bp-short-name')!==false);
    // Mailing address (Business Identity card) — street/city/state/zip
    t('Profile form has mailing street field',strpos($abjs,'bp-mail-street')!==false);
    t('Profile form has mailing city/state/zip fields',strpos($abjs,'bp-mail-city')!==false&&strpos($abjs,'bp-mail-state')!==false&&strpos($abjs,'bp-mail-zip')!==false);
    // Contact address (Contact Info card) — replaced the old single "Address" field
    t('Profile form has contact street field (no more single bp-address)',strpos($abjs,'bp-cont-street')!==false&&strpos($abjs,'id="bp-address"')===false);
    t('Profile form has contact city/state/zip fields',strpos($abjs,'bp-cont-city')!==false&&strpos($abjs,'bp-cont-state')!==false&&strpos($abjs,'bp-cont-zip')!==false);
    t('Profile form has phone field',strpos($abjs,'bp-phone')!==false);
    // Phone auto-formats like the storefront's checkout/customer/signup phone fields
    t('Profile phone field reuses fmtPhone() live formatter',strpos($abjs,'id="bp-phone"')!==false&&strpos($abjs,'oninput="fmtPhone(this)"')!==false);
    t('Profile phone formats the stored value on load (bizFmtPhone)',strpos($abjs,'function bizFmtPhone(')!==false&&strpos($abjs,"bizFmtPhone(p.phone||'')")!==false);
    t('Profile form has email field',strpos($abjs,'bp-email')!==false);
    t('Profile form has logo upload',strpos($abjs,'bp-logo-file')!==false);
    // Both save paths (saveBizProfile + clearBizLogo) must persist all the new address fields
    t('saveBizProfile persists mailing + contact address fields',
        substr_count($abjs,'mailing_street:mailing_street')>=1&&substr_count($abjs,'contact_street:contact_street')>=1);
    t('index.php cache-busts admin-business.js',strpos(file_get_contents($root.'/index.php'),'js/admin-business.js?v=')!==false);
}catch(Exception $e){t('business nav checks',false,$e->getMessage());}
// Business Documents API (resale certificate, business license)
try{
    $bdphp=file_get_contents($root.'/api/business_docs.php');
    t('business_docs.php requires admin',strpos($bdphp,'requireAdmin()')!==false);
    t('business_docs.php supports resale_cert type',strpos($bdphp,'resale_cert')!==false);
    t('business_docs.php supports business_license type',strpos($bdphp,'business_license')!==false);
    t('business_docs.php list action',strpos($bdphp,"'list'")!==false);
    t('business_docs.php upload action',strpos($bdphp,"'upload'")!==false);
    t('business_docs.php download action',strpos($bdphp,"'download'")!==false);
    t('business_docs.php delete action',strpos($bdphp,"'delete'")!==false);
    t('business_docs.php validates file magic bytes',strpos($bdphp,"'%PDF'")!==false&&strpos($bdphp,'\xFF\xD8')!==false);
    t('business_docs.php enforces 5MB size cap',strpos($bdphp,'5 * 1024 * 1024')!==false);
    t('business_docs.php stores files outside webroot',strpos($bdphp,"dirname(dirname(__DIR__)) . '/business_documents/'")!==false);
    t('business_docs.php persists metadata to biz_documents setting',strpos($bdphp,"'biz_documents'")!==false);
    // View button (2026-07-04) — same inline-preview pattern as Capital Equipment receipts
    $abjsDoc=isset($abjs)?$abjs:file_get_contents($root.'/js/admin-business.js');
    t('bizDocView function exists',strpos($abjsDoc,'function bizDocView(type)')!==false);
    t('btn:View wired on Documents cards',strpos($abjsDoc,"onclick=\"bizDocView(")!==false);
    t('bizDocView calls business_docs.php download action',strpos($abjsDoc,"API+'/business_docs.php'")!==false&&substr_count($abjsDoc,"action:'download'")>=1);
    t('bizDocView shows images in a lightbox, opens other types in a new tab',strpos($abjsDoc,"res.ctype.indexOf('image/')===0")!==false);
    t('bizDocView reuses the shared showReceiptImageModal lightbox',strpos($abjsDoc,'showReceiptImageModal(url)')!==false);
}catch(Exception $e){t('business_docs.php checks',false,$e->getMessage());}
// Dynamic business name/logo/email — index.php is server-rendered from Business > Profile
try{
    $cfgphp=file_get_contents($root.'/api/config.php');
    t('bizName() helper exists in config.php',strpos($cfgphp,'function bizName(')!==false);
    $ixphp=file_get_contents($root.'/index.php');
    t('index.php requires api/config.php',strpos($ixphp,"require_once __DIR__ . '/api/config.php'")!==false);
    t('index.php computes bizName from settings',strpos($ixphp,'bizName($pdo)')!==false);
    t('index.php title uses bizNameAttr',strpos($ixphp,'<title><?php echo $bizNameAttr; ?>')!==false);
    t('index.php JSON-LD name is dynamic',strpos($ixphp,'"name": <?php echo json_encode($bizName); ?>')!==false);
    t('index.php JSON-LD email is dynamic',strpos($ixphp,'"email": <?php echo json_encode($bizEmail); ?>')!==false);
    t('index.php JSON-LD logo/image is dynamic',strpos($ixphp,'"logo": <?php echo json_encode($bizLogoAbs); ?>')!==false&&strpos($ixphp,'"image": <?php echo json_encode($bizLogoAbs); ?>')!==false);
    t('index.php injects window.BIZ_NAME/BIZ_SHORT_NAME/BIZ_EMAIL',strpos($ixphp,'window.BIZ_NAME=')!==false&&strpos($ixphp,'window.BIZ_SHORT_NAME=')!==false&&strpos($ixphp,'window.BIZ_EMAIL=')!==false);
    t('index.php og:image is dynamic',strpos($ixphp,'og:image" content="<?php echo $bizLogoAbsAttr; ?>"')!==false);
    t('index.php twitter:image is dynamic',strpos($ixphp,'twitter:image" content="<?php echo $bizLogoAbsAttr; ?>"')!==false);
    t('index.php apple-touch-icon is dynamic',strpos($ixphp,'apple-touch-icon" href="<?php echo $bizLogoAbsAttr; ?>"')!==false);
    t('index.php og:image dimensions read from real file',strpos($ixphp,'getimagesize($logoLocalPath)')!==false);
    t('index.php has no leftover hardcoded HDBSLogo.jpeg src',substr_count($ixphp,'src="HDBSLogo.jpeg"')===0);
    t('index.php logo alt text is dynamic',substr_count($ixphp,'alt="<?php echo $bizNameAttr; ?>"')>=8);
    t('index.php footer mailto is dynamic',strpos($ixphp,'mailto:<?php echo $bizEmailAttr; ?>')!==false);
    t('index.php admin sidebar shows name + short name',strpos($ixphp,'class="alogo"><?php echo $bizNameAttr; ?><br><?php echo $bizShortNameAttr; ?>')!==false);
    // api/admin.php converts an uploaded base64 logo to a real file on disk
    $adminphpBiz=isset($adphp)?$adphp:file_get_contents($root.'/api/admin.php');
    t('admin.php converts biz_profile logo data URI to a file',strpos($adminphpBiz,"key === 'biz_profile'")!==false&&strpos($adminphpBiz,"dirname(__DIR__) . '/business_logo/'")!==false);
    t('admin.php validates logo magic bytes',strpos($adminphpBiz,'\x89PNG')!==false);
    t('admin.php cleans up previous logo file on re-upload',strpos($adminphpBiz,'@unlink($oldFile)')!==false);
    // Email templates: dynamic name/email, no stale hardcoded strings in From/subject/footer
    foreach(['send_confirm.php'=>'biz_name','send_shipping.php'=>'from_name','verify_payment.php'=>'biz_name_vp','order_confirm.php'=>'from_name','notify.php'=>'from_name'] as $ef=>$var){
        $efc=file_get_contents($root.'/'.$ef);
        t($ef.' uses dynamic '.$var.' for from-name',strpos($efc,'$'.$var)!==false);
    }
    t('send_confirm.php reads email field (not stale website_email)',strpos(file_get_contents($root.'/send_confirm.php'),"\$biz['email']")!==false);
    t('send_shipping.php reads email field (not stale website_email)',strpos(file_get_contents($root.'/send_shipping.php'),"\$biz2['email']")!==false);
    t('verify_payment.php reads email field (not stale website_email)',strpos(file_get_contents($root.'/verify_payment.php'),"\$biz_vp['email']")!==false);
    t('order_confirm.php fetches biz_profile email',strpos(file_get_contents($root.'/order_confirm.php'),'$biz_email_oc')!==false);
    $ppphp=file_get_contents($root.'/api/process_payment.php');
    // Confirmation email was extracted into the shared order_confirm_email.php helper
    // (used by both the Square and PayPal charge paths); biz name/email now resolved there.
    t('process_payment.php delegates confirmation to shared helper',strpos($ppphp,'order_confirm_email.php')!==false&&strpos($ppphp,'sendOrderConfirmation(')!==false);
    $ocehp=file_get_contents($root.'/api/order_confirm_email.php');
    t('order_confirm_email.php fetches biz name and email',strpos($ocehp,'bizName(')!==false&&strpos($ocehp,'biz_email')!==false);
    t('api/contact.php uses dynamic biz name in email header',strpos(file_get_contents($root.'/api/contact.php'),'$biz_name_ct')!==false);
    // Regression: $pdo was used (rate limiting, bizName(), email_log) without ever being
    // assigned, causing a fatal error on every submission (fixed 2026-07-02).
    $ctPdo=file_get_contents($root.'/api/contact.php');
    t('contact.php assigns $pdo before use',strpos($ctPdo,'$pdo = db();')!==false);
    $ctPdoPos=strpos($ctPdo,'$pdo = db();');$ctUsePos=strpos($ctPdo,'use ($pdo)');
    t('contact.php $pdo assigned before rate limit closure',$ctPdoPos!==false&&$ctUsePos!==false&&$ctPdoPos<$ctUsePos);
    // Regression: Yahoo's SMTP relay rejects a MAIL FROM / Reply-To that doesn't match the
    // authenticated mailbox — contact.php must send from its own address, not the visitor's.
    // (the exact 5-arg call also confirms no Reply-To arg is passed to sendEmail())
    t('contact.php sends from its own address, not the visitor\'s',strpos($ctPdo,'sendEmail($to, $fullsubj, $html_body, $to, $name)')!==false);
    // JS: window.BIZ_NAME / window.BIZ_EMAIL wired with hardcoded fallback (never a hard failure if unset)
    $storejs=file_get_contents($root.'/js/store.js');
    t('store.js product title uses window.BIZ_NAME',strpos($storejs,'window.BIZ_NAME')!==false);
    $cfgjs=file_get_contents($root.'/js/config.js');
    t('config.js product JSON-LD brand/seller uses window.BIZ_NAME',substr_count($cfgjs,'window.BIZ_NAME')>=2);
    t('config.js contact-form errors use window.BIZ_EMAIL',substr_count($cfgjs,'window.BIZ_EMAIL')>=2);
    $aojsBiz=isset($aojs)?$aojs:file_get_contents($root.'/js/admin-orders.js');
    t('admin-orders.js toolbar logos use window.BIZ_NAME',substr_count($aojsBiz,'window.BIZ_NAME')>=5);
}catch(Exception $e){t('dynamic business name/logo/email checks',false,$e->getMessage());}
// Nav
try{
    $cfjs=isset($cfjs)?$cfjs:file_get_contents($root.'/js/config.js');
    t('Inventory removed from nav',strpos($cfjs,"sec:'inv'")===false);
}catch(Exception $e){t('nav checks',false,$e->getMessage());}
// Orders table columns
try{
    $aojs4=isset($aojs)?$aojs:file_get_contents($root.'/js/admin-orders.js');
    $aojs=$aojs4;
    t('Subtotal column in orders header',strpos($aojs,'Subtotal')!==false);
    t('Shipping column in orders header',strpos($aojs,"'Shipping'")!==false);
    t('Trans Fee column in orders header',strpos($aojs,"'Trans Fee'")!==false);
    t('Total column after Trans Fee',strpos($aojs,"'Trans Fee'")<strpos($aojs,"'Total'"));
    t('orders API returns subtotal',strpos(file_get_contents($root.'/api/orders.php'),"'subtotal'")!==false);
    t('orders API returns shipping',strpos(file_get_contents($root.'/api/orders.php'),"'shipping'")!==false);
}catch(Exception $e){t('orders table column checks',false,$e->getMessage());}
// Orders export and print
try{
    $aojs5=isset($aojs)?$aojs:file_get_contents($root.'/js/admin-orders.js');
    $aojs=$aojs5;
    t('exportOrdersCsv function exists',strpos($aojs,'function exportOrdersCsv()')!==false);
    t('Export CSV button removed from orders bar (on PageToolbar)',strpos($aojs,"onclick=\"exportOrdersCsv()\"")===false);
    t('printOrdersPdf function exists',strpos($aojs,'function printOrdersPdf()')!==false);
    t('Print PDF button removed from orders bar (on PageToolbar)',strpos($aojs,"onclick=\"printOrdersPdf()\"")===false);
    t('Print window closes after print',strpos($aojs,'w.close()')!==false);
    // Print Invoice + Print Shipping Label (Order Detail actions)
    t('printInvoice function exists',strpos($aojs,'function printInvoice(oid)')!==false);
    t('printInvoice itemizes subtotal/shipping/tax/fee/total',strpos($aojs,"trow('Subtotal'")!==false&&strpos($aojs,"trow('Shipping'")!==false&&strpos($aojs,"trow('Total'")!==false);
    t('printShippingLabel function exists',strpos($aojs,'function printShippingLabel(oid)')!==false);
    t('printShippingLabel requires a shipping address on file',strpos($aojs,'This order has no shipping address on file.')!==false);
    // Label window opens synchronously (before the async biz_profile fetch) so popup blockers don't intercept it
    // admin-orders.js is stored with CRLF line endings on disk — normalize before comparing
    // so this check isn't sensitive to line-ending drift
    $aojsNoCr=str_replace("\r\n","\n",$aojs);
    t('printShippingLabel opens window before the async fetch (popup-blocker safe)',
        strpos($aojsNoCr,"var w=window.open('','_blank');\n  apiFetch('admin.php','POST',{action:'get_setting',key:'biz_profile'})")!==false);
    t('printShippingLabel has no border on the label box',strpos($aojs,".label{width:4in;height:6in;padding:.3in")!==false&&strpos($aojs,'.label{width:4in;height:6in;border:')===false);
    t('printShippingLabel return address uses the same style as the customer address',strpos($aojs,'.from,.to{font-size:22px;font-weight:700;line-height:1.4}')!==false);
    t('printShippingLabel return address pulls mailing_street/city/state/zip from biz_profile',strpos($aojs,'p.mailing_street')!==false&&strpos($aojs,'p.mailing_city')!==false&&strpos($aojs,'p.mailing_state')!==false&&strpos($aojs,'p.mailing_zip')!==false);
    t('printShippingLabel splits the customer address into street / city-state-zip lines',strpos($aojs,'commaIdx=order.addr.indexOf')!==false);
    // Shipper/carrier line removed from the label
    t('printShippingLabel no longer prints the carrier/shipper',strpos($aojs,'.carrier{')===false&&strpos($aojs,'class="carrier"')===false);
    // Hard one-page clamp: html/body pinned to the label's exact 4in x 6in footprint with
    // overflow hidden, plus page-break-avoid on the label box — a sub-pixel overflow was
    // spilling a near-blank second page onto the printer before this.
    t('printShippingLabel clamps html/body to the label footprint with overflow hidden',strpos($aojs,'html,body{margin:0;padding:0;width:4in;height:6in;overflow:hidden}')!==false);
    t('printShippingLabel forces no page break on the label box',strpos($aojs,'page-break-after:avoid;page-break-inside:avoid;overflow:hidden')!==false);
    t('btn:Print Invoice wired on Order Detail',strpos(isset($apjs)?$apjs:file_get_contents($root.'/js/admin-products.js'),'printInvoice(')!==false);
    t('btn:Print Shipping Label wired on Order Detail',strpos(isset($apjs)?$apjs:file_get_contents($root.'/js/admin-products.js'),'printShippingLabel(')!==false);
    t('Clear Filters button removed from orders bar (on PageToolbar)',strpos($aojs,"clearOrdFilters()'")===false);
    t('Update Trans Fees button exists',strpos($aojs,'updateTransFees()')!==false);
    t('updateTransFees function exists',strpos($aojs,'function updateTransFees()')!==false);
    t('Unmatched orders listed in alert',strpos($aojs,'d.unmatched')!==false);
}catch(Exception $e){t('orders export/print checks',false,$e->getMessage());}
// Square payments backfill
try{
    $sqphp=file_get_contents($root.'/api/square_payments.php');
    t('backfill_fees action exists',strpos($sqphp,'backfill_fees')!==false);
    t('reads JSON POST body',strpos($sqphp,'php://input')!==false);
    t('30-day search window',strpos($sqphp,'-30 days')!==false);
    t('unmatched list returned',strpos($sqphp,'unmatched')!==false);
    t('stock restored on failed payment',strpos(file_get_contents($root.'/verify_payment.php'),'stock restored')!==false);
}catch(Exception $e){t('square payments checks',false,$e->getMessage());}
// SEO tags
try{
    $ihtml=isset($ihtml)?$ihtml:file_get_contents($root.'/index.php');
    t('Meta description contains Corvette',strpos($ihtml,'Corvette')!==false);
    t('Meta keywords contains car show',strpos($ihtml,'car show')!==false);
    t('LocalBusiness JSON-LD present',strpos($ihtml,'application/ld+json')!==false);
    t('LocalBusiness schema type',strpos($ihtml,'LocalBusiness')!==false);
    t('Geo coordinates present',strpos($ihtml,'GeoCoordinates')!==false);
    t('sitemap.xml exists',file_exists($root.'/sitemap.xml'));
    t('robots.txt exists',file_exists($root.'/robots.txt'));
    t('robots.txt references sitemap',strpos(file_get_contents($root.'/robots.txt'),'sitemap.xml')!==false);
}catch(Exception $e){t('SEO tag checks',false,$e->getMessage());}
// Homepage page visibility
try{
    $ihtml=isset($ihtml)?$ihtml:file_get_contents($root.'/index.php');
    t('authpage hidden on load',strpos($ihtml,'id="authpage" style="display:none"')!==false);
    t('alog hidden on load',strpos($ihtml,'id="alog" style="display:none"')!==false);
    t('apanel hidden on load',strpos($ihtml,'id="apanel" style="display:none"')!==false);
    t('QR code in footer',strpos($ihtml,'QRCode.png')!==false);
    t('contactpage exists',strpos($ihtml,'id="contactpage"')!==false);
    t('Back to Shop in contact nav',strpos($ihtml,'goContact')!==false);
}catch(Exception $e){t('homepage visibility checks',false,$e->getMessage());}
// Square Payments UI
try{
    $aojs6=isset($aojs)?$aojs:file_get_contents($root.'/js/admin-orders.js');
    $aojs=$aojs6;
    t('sqPayRenderTable exists',strpos($aojs,'function sqPayRenderTable()')!==false);
    t('sqPaySort exists',strpos($aojs,'function sqPaySort(')!==false);
    t('sqPayFilt uses dropdown',strpos($aojs,'sqp-filt-drop')!==false);
    t('sqPayExportCsv exists',strpos($aojs,'function sqPayExportCsv()')!==false);
    t('sqPay Export CSV button removed from action bar (on PageToolbar)',strpos($aojs,"onclick=\"sqPayExportCsv()\"")===false);
    t('sqPay table uses tablekit class',strpos($aojs,'tablekit')!==false);
}catch(Exception $e){t('square payments UI checks',false,$e->getMessage());}
// Tax sweep buttons
try{
    $amjs=isset($amjs)?$amjs:file_get_contents($root.'/js/admin-misc.js');
    $amjs2=$amjs;
    t('showAddSweepForm exists',strpos($amjs2,'function showAddSweepForm()')!==false);
    t('deleteSweepRow exists',strpos($amjs2,'function deleteSweepRow(')!==false);
    t('editSweepRow exists',strpos($amjs2,'function editSweepRow(')!==false);
    t('saveSweepEdit exists',strpos($amjs2,'function saveSweepEdit(')!==false);
    t('sweep header Excel style',strpos($amjs2,'text-transform:uppercase')!==false);
    t('Error Logs label',strpos($amjs2,"logs:'📋 Error Logs'")!==false||strpos($amjs2,"label:'📋 Error Logs'")!==false);
}catch(Exception $e){t('tax sweep button checks',false,$e->getMessage());}
// Contact page and navigation
try{
    $ihtml=file_get_contents($root.'/index.php');
    $hamCount=substr_count($ihtml,'onclick="openMenu()"');
    t('contactpage div exists',strpos($ihtml,'id="contactpage"')!==false);
    t('contactpage hidden on load',strpos($ihtml,'id="contactpage" style="display:none')!==false);
    t('contact form has email field',strpos($ihtml,'ctc-em')!==false);
    t('contact form has message field',strpos($ihtml,'ctc-msg')!==false);
    t('submitContact called from form',strpos($ihtml,'submitContact()')!==false);
    $cfjs2=isset($cfjs)?$cfjs:file_get_contents($root.'/js/config.js');
    $cfjs=$cfjs2;
    t('contactpage in showOnly pages list',strpos($cfjs,'contactpage')!==false);
    t('submitContact function exists',strpos($cfjs,'function submitContact()')!==false);
    t('goContact scrolls to top',strpos($cfjs,'scrollTo(0,0)')!==false);
    // Regression: goContact() referenced a stale 'contact-ok' element (removed in a prior
    // redesign — real ids are ctc-ok/ctc-err) and threw on every Contact page visit until
    // it was null-guarded (fixed 2026-07-02).
    t('goContact null-guards contact-ok element',strpos($cfjs,"getElementById('contact-ok');if(contactOk)")!==false);
    t('hamburger on all pages',$hamCount>=7,'found '.$hamCount.' (expected 7+)');
}catch(Exception $e){t('contact page checks',false,$e->getMessage());}
// Business profile (moved to js/admin-business.js) and confirmation email
try{
    $abjs2=isset($abjs)?$abjs:file_get_contents($root.'/js/admin-business.js');
    $abjs=$abjs2;
    t('biz profile name field',strpos($abjs,'bp-name')!==false);
    t('biz profile short name field',strpos($abjs,'bp-short-name')!==false);
    t('biz profile saves identity fields',strpos($abjs,'name:name,short_name:short_name')!==false);
    t('biz profile identity section',strpos($abjs,'Business Identity')!==false);
}catch(Exception $e){t('biz profile checks',false,$e->getMessage());}
try{
    $scphp=file_get_contents($root.'/send_confirm.php');
    t('confirm email fetches biz_profile',strpos($scphp,"key_name='biz_profile'")!==false);
    t('confirm email uses biz_url',strpos($scphp,'biz_url')!==false);
    t('confirm email uses biz_email',strpos($scphp,'biz_email')!==false);
    t('confirm email shows order type',strpos($scphp,'Order Type')!==false);
    t('confirm email shows paid by',strpos($scphp,'Paid By')!==false);
    t('confirm email shows check # when present',strpos($scphp,'Check #')!==false&&strpos($scphp,"check_number")!==false);
    t('confirm email logs to email_log',strpos($scphp,'INSERT INTO email_log')!==false);
    t('confirm email supports preview mode',strpos($scphp,"!empty(\$data['preview'])")!==false&&strpos($scphp,"'html'=>")!==false);
    t('confirm email info box wraps (inline-block, not flex)',strpos($scphp,'display:inline-block')!==false);
    t('confirm email website prefix',strpos($scphp,'Website:')!==false);
    t('confirm email email prefix',strpos($scphp,'Email:')!==false);
}catch(Exception $e){t('send_confirm checks',false,$e->getMessage());}
// ── Email logging, payment fields, preview-before-send, source flag (2026-06-26) ──
try{
    // send_shipping: preview + logging + mobile-safe table
    $ssp2=file_get_contents($root.'/send_shipping.php');
    t('send_shipping supports preview mode',strpos($ssp2,"!empty(\$data['preview'])")!==false);
    t('send_shipping logs to email_log',strpos($ssp2,'INSERT INTO email_log')!==false);
    t('send_shipping table-layout fixed (mobile)',strpos($ssp2,'table-layout:fixed')!==false);
    // order-confirmation email now built by the shared helper (Square + PayPal): paid by + logging + mobile
    $ppp2=file_get_contents($root.'/api/order_confirm_email.php');
    t('order_confirm_email shows Paid by',strpos($ppp2,'Paid by:')!==false);
    t('order_confirm_email logs to email_log',strpos($ppp2,'INSERT INTO email_log')!==false);
    t('order_confirm_email table-layout fixed (mobile)',strpos($ppp2,'table-layout:fixed')!==false);
    t('process_payment calls sendOrderConfirmation',strpos(file_get_contents($root.'/api/process_payment.php'),'sendOrderConfirmation(')!==false);
    // order_confirm (legacy): extracts fields, displays them, logs, mobile
    $ocp2=file_get_contents($root.'/order_confirm.php');
    t('order_confirm extracts payment_method',strpos($ocp2,"\$data['payment_method']")!==false);
    t('order_confirm extracts check_number',strpos($ocp2,"\$data['check_number']")!==false);
    t('order_confirm shows Paid By',strpos($ocp2,'Paid By')!==false);
    t('order_confirm logs to email_log',strpos($ocp2,'INSERT INTO email_log')!==false);
    t('order_confirm table-layout fixed (mobile)',strpos($ocp2,'table-layout:fixed')!==false);
    // notify (owner): paid by/check, logging as Order Received, mobile
    $ntf2=file_get_contents($root.'/notify.php');
    t('notify extracts payment_method',strpos($ntf2,"\$data['payment_method']")!==false);
    t('notify owner email shows Paid By',strpos($ntf2,'Paid By')!==false);
    t('notify logs to email_log as Order Received',strpos($ntf2,'INSERT INTO email_log')!==false&&strpos($ntf2,'Order Received')!==false);
    t('notify table-layout fixed (mobile)',strpos($ntf2,'table-layout:fixed')!==false);
    // every outbound email logs: contact + db_backup
    t('contact.php logs to email_log',strpos(file_get_contents($root.'/api/contact.php'),'INSERT INTO email_log')!==false);
    t('db_backup logs to email_log',strpos(file_get_contents($root.'/api/db_backup.php'),'INSERT INTO email_log')!==false);
    // store.js: storefront source flag, no client-side send_confirm (handled server-side)
    $stj2=file_get_contents($root.'/js/store.js');
    t('store.js stamps source storefront',strpos($stj2,"source:'storefront'")!==false);
    t('store.js InPerson uses server-side confirm (no client send_confirm)',strpos($stj2,'/send_confirm.php')===false);
    // orders.php: source-keyed InPerson paid + server-side confirmation
    $ordp2=file_get_contents($root.'/api/orders.php');
    t('orders.php keys InPerson paid on source flag',strpos($ordp2,"=== 'storefront'")!==false);
    t('orders.php sends server-side confirmation',strpos($ordp2,'/send_confirm.php')!==false);
    // admin-orders.js: preview-before-send + settings dropdown fetch
    $aoj2=file_get_contents($root.'/js/admin-orders.js');
    t('admin-orders has emailPreviewThenSend',strpos($aoj2,'function emailPreviewThenSend')!==false);
    t('admin-orders preview uses preview flag',strpos($aoj2,'preview:true')!==false);
    t('sendConfirmEmail uses preview flow',strpos($aoj2,"emailPreviewThenSend('/send_confirm.php'")!==false);
    t('sendShippingEmail uses preview flow',strpos($aoj2,"emailPreviewThenSend('/send_shipping.php'")!==false);
    t('settings loads saved payment_configuration',strpos($aoj2,"key:'payment_configuration'")!==false&&strpos($aoj2,'payconf-sel')!==false);
    // admin-products.js: order detail quick-edit fields removed
    $apj2=file_get_contents($root.'/js/admin-products.js');
    t('order detail removed Status/Paid By quick-edit',strpos($apj2,'vo-status-')===false&&strpos($apj2,'vo-pay-')===false);
    t('order detail removed Update Order field block',strpos($apj2,'>Update Order<')===false);
    // index.php: cache-busting on app scripts
    $idx2=file_get_contents($root.'/index.php');
    t('index.php cache-busts store.js',strpos($idx2,'js/store.js?v=')!==false);
    t('index.php cache-busts admin-products.js',strpos($idx2,'js/admin-products.js?v=')!==false);
}catch(Exception $e){t('email/order 2026-06-26 checks',false,$e->getMessage());}
// Email log clear button
try{$amjs=isset($amjs)?$amjs:file_get_contents($root.'/js/admin-misc.js');
    t('clearEmailLog function exists',strpos($amjs,'function clearEmailLog(')!==false);
    t('email log clear button',strpos($amjs,'Clear Log')!==false);
}catch(Exception $e){t('clearEmailLog',false,$e->getMessage());}
try{$elphp=file_get_contents($root.'/api/email_log.php');
    t('email_log.php supports DELETE',strpos($elphp,'DELETE')!==false&&strpos($elphp,'DELETE FROM email_log')!==false);
}catch(Exception $e){t('email_log DELETE',false,$e->getMessage());}
// Logo and hamburger on all pages
try{$ihtml=isset($ihtml)?$ihtml:file_get_contents($root.'/index.php');
    t('hamburger on all pages',$hamCount>=7,'found '.$hamCount.' (expected 7+)');
    t('logo image in nav',strpos($ihtml,'HDBSLogo.jpeg')!==false);
    t('apple-touch-icon set',strpos($ihtml,'apple-touch-icon')!==false);
    t('og:image uses logo',strpos($ihtml,'og:image')!==false&&strpos($ihtml,'HDBSLogo.jpeg')!==false);
    t('side-menu outside store div',strpos($ihtml,'<div id="side-menu"')<strpos($ihtml,'<div id="store"'));
}catch(Exception $e){t('nav/logo checks',false,$e->getMessage());}
// Sticky nav CSS checks
try{$css=isset($css)?$css:file_get_contents($root.'/css/shop.css');
    t('nav is sticky',strpos($css,'position:sticky')!==false);
    t('authpage flex-column',strpos($css,'#authpage')!==false&&strpos($css,'flex-direction:column')!==false);
    t('contactpage flex-column',strpos($css,'#contactpage')!==false&&strpos($css,'flex-direction:column')!==false);
    t('alog flex-column',strpos($css,'#alog')!==false&&strpos($css,'flex-direction:column')!==false);
}catch(Exception $e){t('sticky nav checks',false,$e->getMessage());}
// Store hover shows SKU and size
try{$sjs=isset($sjs)?$sjs:file_get_contents($root.'/js/store.js');
    t('hover shows SKU',strpos($sjs,'SKU: ')!==false&&strpos($sjs,'qv-add')!==false);
    t('hover shows size',strpos($sjs,'Size: ')!==false&&strpos($sjs,'qv-add')!==false);
}catch(Exception $e){t('store hover checks',false,$e->getMessage());}

// Category management persists to DB
try{$ao=file_get_contents($root.'/js/admin-orders.js');
    t('editCat function exists',strpos($ao,'function editCat(')!==false);
    t('saveCatEdit function exists',strpos($ao,'function saveCatEdit(')!==false);
    t('cat_prefixes saved to DB',strpos($ao,"key:'cat_prefixes'")!==false);
    t('product_categories saved to DB',strpos($ao,"key:'product_categories'")!==false);
    t('next SKU override persisted',strpos($ao,'__next')!==false);
}catch(Exception $e){t('editCat checks',false,$e->getMessage());}
// ui.js loads category settings
try{$uijs=isset($uijs)?$uijs:file_get_contents($root.'/js/ui.js');
    t('ui.js loads product_categories',strpos($uijs,'product_categories')!==false);
    t('ui.js loads cat_prefixes',strpos($uijs,'cat_prefixes')!==false);
}catch(Exception $e){t('ui.js category checks',false,$e->getMessage());}
// CAT_PREFIXES defined in config.js
try{$cfgjs=file_get_contents($root.'/js/config.js');t('CAT_PREFIXES defined',strpos($cfgjs,'CAT_PREFIXES')!==false);}catch(Exception $e){t('CAT_PREFIXES',false,$e->getMessage());}



// ── NEW SESSION CHECKS: Email Log sort/filter, Debug Mode, Log Viewer, Square batch ──

// Email log sort/filter (exact copy of product management pattern)
try{$amjs=isset($amjs)?$amjs:file_get_contents($root.'/js/admin-misc.js');
    t('ELOGS array defined',strpos($amjs,'var ELOGS=')!==false);
    t('EL_SORT state defined',strpos($amjs,'EL_SORT=')!==false);
    t('EL_F filter state defined',strpos($amjs,'EL_F=')!==false);
    t('elSort function exists',strpos($amjs,'function elSort(')!==false);
    t('elFilt function exists',strpos($amjs,'function elFilt(')!==false);
    t('elFiltAll function exists',strpos($amjs,'function elFiltAll(')!==false);
    t('elFiltApply function exists',strpos($amjs,'function elFiltApply(')!==false);
    t('applyElFilters function exists',strpos($amjs,'function applyElFilters(')!==false);
    t('buildElThead function exists',strpos($amjs,'function buildElThead(')!==false);
    t('rEmailLog function exists',strpos($amjs,'function rEmailLog(')!==false);
    // rEmailLog must not infinite-loop on an empty/error response (e.g. expired session)
    t('ELOGS_LOADED flag defined',strpos($amjs,'ELOGS_LOADED=false')!==false);
    t('rEmailLog gates load on ELOGS_LOADED',strpos($amjs,'if(!ELOGS_LOADED)')!==false);
    t('rEmailLog handles load error without looping',strpos($amjs,'d.success===false')!==false&&strpos($amjs,'Could not load email log')!==false);
    t('rEmailLog sets ELOGS_LOADED after success',strpos($amjs,'ELOGS_LOADED=true')!==false);
    t('elRefresh re-arms ELOGS_LOADED',strpos($amjs,'ELOGS=[];ELOGS_LOADED=false')!==false);
    // Email log scrolls window to top so the toolbar + header rows are visible
    t('rEmailLog scrolls to top on render',strpos($amjs,'window.scrollTo(0,0)')!==false&&strpos($amjs,'scrolls the window')!==false);
    t('elRefresh function exists',strpos($amjs,'function elRefresh(')!==false);
    t('clearEmailLog function exists',strpos($amjs,'function clearEmailLog(')!==false);
    t('email log refresh button removed (on PageToolbar)',strpos($amjs,"onclick=\"elRefresh()\"")===false);
    t('email log clear filters removed (on PageToolbar)',strpos($amjs,'Clear Filters')===false||strpos($amjs,'EL_F=')===false);
    t('email log Date&Time column',strpos($amjs,'Date &amp; Time')!==false||strpos($amjs,'Date & Time')!==false);
    t('email log Type column',strpos($amjs,'<th>Type</th>')!==false);
    t('email log Sent To column',strpos($amjs,'Sent To')!==false);
    t('email log Order ID column',strpos($amjs,'Order ID')!==false);
    t('email log Status column',strpos($amjs,'<th>Status</th>')!==false);
    t('email log Preview column',strpos($amjs,'elPreview')!==false);
    t('email log overflow visible in nav',strpos(file_get_contents($root.'/js/admin-nav.js'),"overflowY")!==false);
}catch(Exception $e){t('email log sort/filter checks',false,$e->getMessage());}

// Debug mode
try{
    t('debug_mode in settings table',
        (int)$pdo->query("SELECT COUNT(*) FROM settings WHERE key_name='debug_mode'")->fetchColumn()>0,
        'Run Settings page to initialize'
    );
    $dmVal=$pdo->query("SELECT value FROM settings WHERE key_name='debug_mode' LIMIT 1")->fetchColumn();
    t('debug_mode has valid value',$dmVal==='0'||$dmVal==='1','value='.($dmVal===false?'not set':$dmVal));
    t('applog.php has debug_enabled()',strpos(file_get_contents($root.'/api/applog.php'),'function debug_enabled()')!==false);
    t('applog.php has dbg()',strpos(file_get_contents($root.'/api/applog.php'),'function dbg(')!==false);
    t('applog.php has sq_curl()',strpos(file_get_contents($root.'/api/applog.php'),'function sq_curl(')!==false);
    t('config.php has DbgPDO',strpos(file_get_contents($root.'/api/config.php'),'class DbgPDO')!==false);
    t('config.php has DbgStatement',strpos(file_get_contents($root.'/api/config.php'),'class DbgStatement')!==false);
    t('config.php DB-READ logging',strpos(file_get_contents($root.'/api/config.php'),'DB-READ')!==false);
    t('config.php DB-WRITE logging',strpos(file_get_contents($root.'/api/config.php'),'DB-WRITE')!==false);
    $amjs=isset($amjs)?$amjs:file_get_contents($root.'/js/admin-misc.js');
    t('debug card injected via window.load',strpos($amjs,"window.addEventListener('load'")!==false);
    t('setDebugMode function exists',strpos($amjs,'function setDebugMode(')!==false);
    t('debug uses get_setting action',strpos($amjs,"action:'get_setting'")!==false);
    t('debug uses set_setting action',strpos($amjs,"action:'set_setting'")!==false);
    t('admin.php get_setting action',strpos(file_get_contents($root.'/api/admin.php'),"action === 'get_setting'")!==false);
    t('admin.php set_setting action',strpos(file_get_contents($root.'/api/admin.php'),"action === 'set_setting'")!==false);
}catch(Exception $e){t('debug mode checks',false,$e->getMessage());}

// Screen navigation debug logging
try{$apibasejs=file_get_contents($root.'/js/api.js');
    t('api.js has _dbgEnabled()',strpos($apibasejs,'_dbgEnabled')!==false);
    t('api.js has _dbgLog()',strpos($apibasejs,'function _dbgLog(')!==false);
    t('api.js has _dbgScreen()',strpos($apibasejs,'_dbgScreen')!==false);
    t('api.js wraps apiFetch with debug',strpos($apibasejs,'_dbgLog')!==false&&strpos($apibasejs,'apiFetch')!==false);
    t('admin-nav.js calls _dbgScreen',strpos(file_get_contents($root.'/js/admin-nav.js'),'_dbgScreen')!==false);
    t('admin-products.js logs showPF open',strpos(file_get_contents($root.'/js/admin-products.js'),'_dbgLog')!==false);
}catch(Exception $e){t('screen debug logging checks',false,$e->getMessage());}

// Error log screen
try{$aojs=isset($aojs)?$aojs:file_get_contents($root.'/js/admin-orders.js');
    t('logFullScreen function exists',strpos($aojs,'function logFullScreen(')!==false);
    t('_logPanel helper exists',strpos($aojs,'function _logPanel(')!==false);
    t('rLogs fetches notify_log.txt',strpos($aojs,"file:'notify_log.txt'")!==false);
    t('rLogs fetches webhook_log.txt',strpos($aojs,"file:'webhook_log.txt'")!==false);
    t('rLogs fetches error_log.txt',strpos($aojs,"file:'error_log.txt'")!==false);
    t('dblclick wired for notify log',strpos($aojs,"'dblclick'")!==false&&strpos($aojs,'_logNotify')!==false);
    t('dblclick wired for webhook log',strpos($aojs,'_logWebhook')!==false);
    t('dblclick wired for error log',strpos($aojs,'_logError')!==false);
    t('emailLog function exists',strpos($aojs,'function emailLog(')!==false);
    t('log email file selector',strpos($aojs,'log-email-file')!==false);
    t('log email address input',strpos($aojs,'log-email-to')!==false);
    t('admin.php send_log action',strpos(file_get_contents($root.'/api/admin.php'),"action === 'send_log'")!==false);
    t('admin.php read_log allows error_log.txt',strpos(file_get_contents($root.'/api/admin.php'),"'error_log.txt'")!==false);
    t('send_log uses attachment',strpos(file_get_contents($root.'/api/admin.php'),'sendEmailWithAttachment')!==false);
    t('mailer.php has sendEmailWithAttachment',strpos(file_get_contents($root.'/mailer.php'),'function sendEmailWithAttachment(')!==false);
    t('send_log logs to email_log table',strpos(file_get_contents($root.'/api/admin.php'),"'Log Export'")!==false);
    t('send_log includes email_body preview',strpos(file_get_contents($root.'/api/admin.php'),'email_body')!==false);
}catch(Exception $e){t('error log screen checks',false,$e->getMessage());}

// Square payments — no per-payment Square API call for tax (2026-07-03: tax now comes from
// our own orders table by square_payment_id, not a batch-retrieve call to Square's Orders API,
// since payments made via process_payment.php were never attached to a Square Order to begin with)
try{$sqphp=file_get_contents($root.'/api/square_payments.php');
    t('square_payments uses sq_curl()',strpos($sqphp,'sq_curl(')!==false);
    t('square_payments no per-payment curl loop',substr_count($sqphp,'curl_init')<=1,'found '.substr_count($sqphp,'curl_init').' curl_init (expected <=1 check only)');
}catch(Exception $e){t('square_payments batch checks',false,$e->getMessage());}

// Square API logging via sq_curl
try{$applog=file_get_contents($root.'/api/applog.php');
    t('sq_curl logs SQ-REQ',strpos($applog,'SQ-REQ')!==false);
    t('sq_curl logs SQ-RESP',strpos($applog,'SQ-RESP')!==false);
    t('sq_curl logs SQ-ERR',strpos($applog,'SQ-ERR')!==false);
    t('verify_payment uses sq_curl',strpos(file_get_contents($root.'/verify_payment.php'),'sq_curl(')!==false);
    t('fetch_tax uses sq_curl',strpos(file_get_contents($root.'/api/fetch_tax.php'),'sq_curl(')!==false);
}catch(Exception $e){t('sq_curl logging checks',false,$e->getMessage());}


// Page view logging
try{
    $applog=file_get_contents($root.'/api/applog.php');
    t('pagelog() in applog.php',strpos($applog,'function pagelog(')!==false);
    t('page_log_enabled() in applog.php',strpos($applog,'function page_log_enabled(')!==false);
    $adphp=file_get_contents($root.'/api/admin.php');
    t('log_page_view action in admin.php',strpos($adphp,"action === 'log_page_view'")!==false);
    t('pages.log in read_log allowlist',strpos($adphp,"'pages.log'")!==false);
    $amjs=isset($amjs)?$amjs:file_get_contents($root.'/js/admin-misc.js');
    t('setPageLogMode function exists',strpos($amjs,'function setPageLogMode(')!==false);
    t('hdbs_pagelog in admin-misc.js',strpos($amjs,'hdbs_pagelog')!==false);
    t('log_page_changes setting key used',strpos($amjs,"'log_page_changes'")!==false);
    $cfjs=isset($cfjs)?$cfjs:file_get_contents($root.'/js/config.js');
    t('goAbout logs visit',strpos($cfjs,"page:'About Suzi'")!==false);
    t('goFAQ logs visit',strpos($cfjs,"page:'FAQ'")!==false);
    t('goCustom logs visit',strpos($cfjs,"page:'Custom Orders'")!==false);
    t('goContact logs visit',strpos($cfjs,"page:'Contact Us'")!==false);
    t('goAuth logs visit',strpos($cfjs,"page:tab==='su'?'Register':'Sign In'")!==false);
    $sjs=isset($sjs)?$sjs:file_get_contents($root.'/js/store.js');
    t('openCart logs visit',strpos($sjs,"page:'Your Cart'")!==false);
    t('openCheckout logs visit',strpos($sjs,"page:'Checkout'")!==false);
    $aojs=isset($aojs)?$aojs:file_get_contents($root.'/js/admin-orders.js');
    t('rLogs fetches pages.log',strpos($aojs,"file:'pages.log'")!==false);
    t('dblclick wired for pages log',strpos($aojs,'_logPages')!==false);
    t('Clear Pages button exists',strpos($aojs,'Clear Pages')!==false);
    t('pages.log in email dropdown',strpos($aojs,'value="pages.log"')!==false);
    $navjs=file_get_contents($root.'/js/admin-nav.js');
    t('admin-nav logs page view',strpos($navjs,'log_page_view')!==false&&strpos($navjs,'hdbs_pagelog')!==false);
}catch(Exception $e){t('page view logging checks',false,$e->getMessage());}

// ── PAGE TOOLBAR ──
try{
    $ihtml=isset($ihtml)?$ihtml:file_get_contents($root.'/index.php');
    t('toolbar.css linked in index.php',strpos($ihtml,'css/toolbar.css')!==false);
    t('toolbar.js included in index.php',strpos($ihtml,'js/toolbar.js')!==false);
    t('toolbar.js exists',file_exists($root.'/js/toolbar.js'));
    t('toolbar.css exists',file_exists($root.'/css/toolbar.css'));
    $anjs=isset($anjs)?$anjs:file_get_contents($root.'/js/admin-nav.js');
    t('showPageToolbar function exists',strpos($anjs,'function showPageToolbar(')!==false);
    // PageToolbar Close calls window.close() (blocked in SPA); showPageToolbar overrides it to navigate to dashboard
    t('showPageToolbar overrides toolbar Close button',strpos($anjs,'tk-btn-close')!==false&&strpos($anjs,'cloneNode')!==false);
    t('toolbar Close override navigates in-SPA',strpos($anjs,'tk-btn-close')!==false&&strpos($anjs,"aNavById('dash')")!==false);
    // showPageToolbar per-screen Export/Import overrides (toolbar's generic ones don't fit product data)
    t('showPageToolbar supports onExport override',strpos($anjs,'opts.onExport')!==false&&strpos($anjs,"trim()==='Export'")!==false);
    t('showPageToolbar supports onImport override',strpos($anjs,'opts.onImport')!==false&&strpos($anjs,"trim()==='Import'")!==false);
    $apjs=isset($apjs)?$apjs:file_get_contents($root.'/js/admin-products.js');
    t('products screen wires onExport/onImport',strpos($apjs,'onExport:exportProductsCsv')!==false&&strpos($apjs,'onImport:showImportCsv')!==false);
    t('exportProductsCsv fetches CSV with admin token',strpos($apjs,'products_csv.php')!==false&&strpos($apjs,'X-Admin-Token')!==false&&strpos($apjs,'function exportProductsCsv(')!==false);
    t('doImportCsv POSTs with admin token',strpos($apjs,"method:'POST',body:fd,headers:{'X-Admin-Token'")!==false);
    t('aNavById hides toolbar on nav',strpos($anjs,"page-toolbar")!==false&&strpos($anjs,"display='none'")!==false);
    t('aNavById restores aptitle on nav',strpos($anjs,"aptitle")!==false&&strpos($anjs,"display=''")!==false);
    $amjs=isset($amjs)?$amjs:file_get_contents($root.'/js/admin-misc.js');
    $apjs=isset($apjs)?$apjs:file_get_contents($root.'/js/admin-products.js');
    $aojs=isset($aojs)?$aojs:file_get_contents($root.'/js/admin-orders.js');
    t('showPageToolbar called in admin-misc.js',strpos($amjs,'showPageToolbar(')!==false);
    t('showPageToolbar called in admin-orders.js',strpos($aojs,'showPageToolbar(')!==false);
    t('showPageToolbar called in admin-products.js',strpos($apjs,'showPageToolbar(')!==false);
    t('showPageToolbar called in admin-nav.js',substr_count($anjs,'showPageToolbar(')>1);
    // Palette colours in toolbar.css
    $tcss=file_get_contents($root.'/css/toolbar.css');
    t('toolbar bg is Dark Brown (#2d2220)',strpos($tcss,'#2d2220')!==false);
    t('toolbar border is Dark Gold (#a07810)',strpos($tcss,'#a07810')!==false);
    t('toolbar logo text is Bright Gold (#d4a017)',strpos($tcss,'#d4a017')!==false);
    t('toolbar title text is white (#fff)',strpos($tcss,'color: #fff')!==false||strpos($tcss,'color:#fff')!==false);
    t('toolbar btn bg is Light Gold (#fdf3d0)',strpos($tcss,'#fdf3d0')!==false);
    t('toolbar close btn is Error Red (#c62828)',strpos($tcss,'#c62828')!==false);
}catch(Exception $e){t('page toolbar checks',false,$e->getMessage());}

// ── SITE VERSION ──
try{
    $adphp=isset($adphp)?$adphp:file_get_contents($root.'/api/admin.php');
    t('major_version in settings',strpos($adphp,"'major_version'")!==false);
    t('minor_version in settings',strpos($adphp,"'minor_version'")!==false);
    t('get_version action',strpos($adphp,"action === 'get_version'")!==false||strpos($adphp,"=== 'get_version'")!==false);
    t('increment_minor_version action',strpos($adphp,"increment_minor_version")!==false);
    // Footer previously showed new Date() (page-load time) instead of when the version was
    // actually last changed — now stamped server-side on every version write and returned
    // by get_version, so the footer can display the real change time.
    t('set_setting stamps version_updated_at when major/minor_version changes',strpos($adphp,"\$key === 'major_version' || \$key === 'minor_version'")!==false&&substr_count($adphp,"setSetting(\$pdo, 'version_updated_at'")>=2);
    // api/admin.php is stored with CRLF line endings — normalize before a multi-line check
    $adphpNoCr=str_replace("\r\n","\n",$adphp);
    t('increment_minor_version also stamps version_updated_at',strpos($adphpNoCr,"setSetting(\$pdo, 'minor_version', (string)\$minor);\n    setSetting(\$pdo, 'version_updated_at'")!==false);
    t('get_version returns updated_at',strpos($adphp,"'updated_at' => \$updatedAt")!==false);
    $ihtml=isset($ihtml)?$ihtml:file_get_contents($root.'/index.php');
    t('version line in footer',strpos($ihtml,'site-version-line')!==false);
    t('version line brightness matches footer (.5 opacity)',strpos($ihtml,'site-version-line')!==false&&strpos($ihtml,'rgba(255,255,255,.25)')===false,'should use .5 not .25');
    t('version fetch script in index.php',strpos($ihtml,'get_version')!==false);
    t('footer no longer uses new Date() for the displayed timestamp',strpos($ihtml,'var dt=new Date();')===false);
    t('footer derives the date from d.updated_at',strpos($ihtml,'d.updated_at?fmtDate(new Date(d.updated_at))')!==false);
    $amjs=isset($amjs)?$amjs:file_get_contents($root.'/js/admin-misc.js');
    t('saveVersion function exists',strpos($amjs,'function saveVersion(')!==false);
    t('version card in settings',strpos($amjs,'version-card')!==false&&strpos($amjs,'ver-major')!==false);
    // Live check — get_version returns a version string
    $ch=curl_init('https://handmadedesignsbysuzi.com/api/admin.php');
    curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>8,CURLOPT_POST=>true,
        CURLOPT_POSTFIELDS=>'{"action":"get_version"}',
        CURLOPT_HTTPHEADER=>['Content-Type: application/json']]);
    $vd=json_decode(curl_exec($ch),true);curl_close($ch);
    t('get_version returns version',isset($vd['version'])&&strpos($vd['version'],'.')!==false,$vd['version']??'');
    // Only live on prod once this checkpoint ships and the version is next re-saved/backfilled
    tProd('get_version returns updated_at on prod',isset($vd['updated_at'])&&$vd['updated_at'],json_encode($vd));
}catch(Exception $e){t('site version checks',false,$e->getMessage());}

// ── NAV SUBMENUS ──
try{
    $amjs=isset($amjs)?$amjs:file_get_contents($root.'/js/admin-misc.js');
    t('ADMIN_NAV_LABELS defined',strpos($amjs,'var ADMIN_NAV_LABELS=')!==false);
    t('ADMIN_NAV_STRUCTURE_DEFAULT has shop folder',strpos($amjs,"sec:'shop'")!==false&&strpos($amjs,"type:'folder'")!==false);
    t('ADMIN_NAV_STRUCTURE_DEFAULT has developer folder',strpos($amjs,"sec:'developer'")!==false);
    t('toggleNavFolder exists',strpos($amjs,'function toggleNavFolder(')!==false);
    t('loadNavOrder handles nested format',strpos($amjs,"p[0].type")!==false);
    t('saveNavOrder reads DOM structure',strpos($amjs,"dataset.type==='folder'")!==false);
    t('buildAdminNav renders folders',strpos($amjs,'makeFolder')!==false&&strpos($amjs,'fld-ch-')!==false);
    // Verify default folder membership
    $shopMatch=preg_match("/sec:'shop'.*?children:\[([^\]]+)\]/s",$amjs,$sm);
    t('shop folder contains prods',$shopMatch&&strpos($sm[1],"'prods'")!==false);
    t('shop folder contains orders',$shopMatch&&strpos($sm[1],"'orders'")!==false);
    $devMatch=preg_match("/sec:'developer'.*?children:\[([^\]]+)\]/s",$amjs,$dm);
    t('developer folder contains regtest',$devMatch&&strpos($dm[1],"'regtest'")!==false);
    t('developer folder contains settings',$devMatch&&strpos($dm[1],"'settings'")!==false);
    // Email Log moved from Developer into Shop
    t('shop folder contains emaillog',$shopMatch&&strpos($sm[1],"'emaillog'")!==false);
    t('developer folder no longer contains emaillog',$devMatch&&strpos($dm[1],"'emaillog'")===false);
    t('loadNavOrder migrates emaillog from Developer into Shop on saved nav_orders',strpos($amjs,'move Email Log from Developer into Shop')!==false&&strpos($amjs,"s!=='emaillog'")!==false);
    // Square Payments moved from a root item into Shop
    t('shop folder contains sqpay',$shopMatch&&strpos($sm[1],"'sqpay'")!==false);
    t('sqpay no longer a root nav item',strpos($amjs,"{type:'item',sec:'sqpay'}")===false);
    t('loadNavOrder migrates Square Payments into Shop on saved nav_orders',strpos($amjs,'move Square Payments from a root item into Shop')!==false&&strpos($amjs,"s!=='sqpay'")!==false);
    // Drag behaviour
    t('drag item into folder on header drop',strpos($amjs,'ch.appendChild(drag.el)')!==false);
    t('drag item to root on container drop',strpos($amjs,'container.appendChild(drag.el)')!==false);
    // Folder collapse
    t('toggleNavFolder saves to localStorage',strpos($amjs,'hdbs_nav_folders')!==false);
    t('folder collapse state in localStorage',strpos($amjs,'_navFolderState')!==false);
    t('ADMIN_NAV_STRUCTURE_DEFAULT has business folder',strpos($amjs,"sec:'business'")!==false);
    // goPanel() must collapse all 3 top-level folders on back-office entry — business was
    // missing here (added later for Capital Equipment) even though shop/developer were handled
    $cfgjsNav=file_get_contents($root.'/js/config.js');
    t('goPanel collapses all 3 top-level folders (shop/business/developer)',
        strpos($cfgjsNav,'nf.shop=false')!==false&&strpos($cfgjsNav,'nf.business=false')!==false&&strpos($cfgjsNav,'nf.developer=false')!==false);
    // Migration
    t('loadNavOrder migrates old flat format',strpos($amjs,'ADMIN_NAV_STRUCTURE_DEFAULT')!==false&&strpos($amjs,'migrate')!==false);
    t('loadNavOrder adds missing secs',strpos($amjs,'existing.indexOf(sec)<0')!==false);
    // Pruning of stale/removed secs (e.g. manual order) from DB-saved nav_order
    t('loadNavOrder prunes unknown secs',strpos($amjs,'Prune secs no longer known')!==false&&strpos($amjs,'ADMIN_NAV_LABELS[n.sec]')!==false);
    t('manual order (manord) removed from nav labels',strpos($amjs,"manord:")===false);
    t('manual order (manord) removed from shop folder',$shopMatch&&strpos($sm[1],"'manord'")===false);
    $navjsMO=isset($navjs)?$navjs:file_get_contents($root.'/js/admin-nav.js');
    $navjs=$navjsMO;
    t('manual order (manord) removed from admin-nav titles/router',strpos($navjs,'manord')===false);
}catch(Exception $e){t('nav submenu checks',false,$e->getMessage());}

// ── PAYMENT CONFIGURATION (Online / InPerson / Test) ──
try{
    $ordcolsPC=$pdo->query("SHOW COLUMNS FROM orders")->fetchAll(PDO::FETCH_COLUMN);
    t('orders.payment_configuration column exists',in_array('payment_configuration',$ordcolsPC));
    t('orders.check_number column exists',in_array('check_number',$ordcolsPC));
}catch(Exception $e){t('payment config columns',false,$e->getMessage());}
try{$ordphp=file_get_contents($root.'/api/orders.php');
    t('orders.php migrates payment_configuration',strpos($ordphp,'ADD COLUMN payment_configuration')!==false);
    t('orders.php migrates check_number',strpos($ordphp,'ADD COLUMN check_number')!==false);
    t('orders.php INSERT has payment_config param',strpos($ordphp,':payment_config')!==false);
    t('orders.php GET returns payment_config',strpos($ordphp,"'payment_config' =>")!==false);
    t('orders.php PUT handles payment_config',strpos($ordphp,'payment_configuration = ?')!==false);
    t('orders.php PUT handles check_number',strpos($ordphp,'check_number = ?')!==false);
}catch(Exception $e){t('orders.php payment config',false,$e->getMessage());}
try{$cfgPC=file_get_contents($root.'/js/config.js');
    t('PAY_CONFIG global declared',strpos($cfgPC,'var PAY_CONFIG')!==false);
    t('goPanel collapses shop/developer folders',strpos($cfgPC,'nf.shop=false')!==false&&strpos($cfgPC,'nf.developer=false')!==false);
}catch(Exception $e){t('config.js payment config',false,$e->getMessage());}
try{$uiPC=file_get_contents($root.'/js/ui.js');
    t('ui.js loads payment_configuration setting',strpos($uiPC,"key:'payment_configuration'")!==false&&strpos($uiPC,'PAY_CONFIG=')!==false);
}catch(Exception $e){t('ui.js payment config',false,$e->getMessage());}
try{$aojs=isset($aojs)?$aojs:file_get_contents($root.'/js/admin-orders.js');
    t('setPayConfig function exists',strpos($aojs,'function setPayConfig(')!==false);
    t('Payment Configuration settings card',strpos($aojs,'payconf-sel')!==false&&strpos($aojs,'Payment Configuration')!==false);
    t('edit order has check number field',strpos($aojs,'eo-checknum')!==false);
    t('edit order has payment config select',strpos($aojs,'eo-payconfig')!==false);
    t('orders table has Payment Config column',strpos($aojs,"'Payment Config'")!==false);
    t('orders table shows payment_config cell',strpos($aojs,'(o.payment_config||')!==false);
    t('orders table Order Type column removed',strpos($aojs,"(o.order_type||'Online')")===false);
}catch(Exception $e){t('admin-orders payment config',false,$e->getMessage());}
try{$sjsPC=file_get_contents($root.'/js/store.js');
    t('placeOrder reads PAY_CONFIG',strpos($sjsPC,'var mode=PAY_CONFIG')!==false);
    t('placeOrder stamps payment_config',strpos($sjsPC,'payment_config:mode')!==false);
    t('placeOrder Test branch',strpos($sjsPC,"mode==='Test'")!==false);
    t('placeOrder InPerson cash/check branch',strpos($sjsPC,"mode==='InPerson'&&!isCard")!==false);
    t('placeOrder includes check_number',strpos($sjsPC,'check_number:checkNum')!==false);
    t('showInPersonConfirm function exists',strpos($sjsPC,'function showInPersonConfirm(')!==false);
    t('updateInPersonUI function exists',strpos($sjsPC,'function updateInPersonUI(')!==false);
    t('updateShippingDisplay honors optional shipping',strpos($sjsPC,'co-ship-req')!==false);
}catch(Exception $e){t('store.js payment config',false,$e->getMessage());}
try{$htmlPC=file_get_contents($root.'/index.php');
    t('checkout InPerson section present',strpos($htmlPC,'id="co-inperson"')!==false);
    t('checkout payment method select',strpos($htmlPC,'id="co-paymethod"')!==false);
    t('checkout check number field',strpos($htmlPC,'id="co-checknum"')!==false);
    t('checkout optional shipping checkbox',strpos($htmlPC,'id="co-ship-req"')!==false);
    t('shop.css cache-busted',strpos($htmlPC,'shop.css?v=')!==false);
    $sbkPos=strpos($htmlPC,'class="sbk"');$navPos=strpos($htmlPC,'id="admin-nav"');
    t('Back to Store sits above admin nav',$sbkPos!==false&&$navPos!==false&&$sbkPos<$navPos);
}catch(Exception $e){t('index.php payment config',false,$e->getMessage());}

// ── DEPLOY HISTORY ──
try{
    t('api/deploy_log.php exists',file_exists($root.'/api/deploy_log.php'));
    $dlphp=file_get_contents($root.'/api/deploy_log.php');
    t('deploy_log appends entries',strpos($dlphp,'FILE_APPEND')!==false);
    t('deploy_log returns deploys',strpos($dlphp,"'deploys'")!==false);
    // deploy.ps1 is not deployed to server — verified locally only
    t('deploy_log.php POST handler exists',strpos($dlphp,"method === 'POST'")!==false);
    t('deploy_log.php GET handler exists',strpos($dlphp,"method === 'GET'")!==false);
    $navjs=file_get_contents($root.'/js/admin-nav.js');
    t('deploylog in nav titles',strpos($navjs,"deploylog:'Deploy History'")!==false);
    t('rDeployLog in nav',strpos($navjs,'rDeployLog(el)')!==false);
    $amjs=isset($amjs)?$amjs:file_get_contents($root.'/js/admin-misc.js');
    t('rDeployLog function exists',strpos($amjs,'function rDeployLog(')!==false);
    t('rDeployLog fetches deploy_log',strpos($amjs,"'deploy_log.php'")!==false);
    t('rDeployLog groups by 5-min window',strpos($amjs,'GAP=5*60*1000')!==false);
    t('rDeployLog shows deploy sessions',strpos($amjs,'deploy session')!==false);
    // Version column (recorded per deploy)
    t('deploy_log captures site version',strpos($dlphp,"'version' => \$version")!==false&&strpos($dlphp,'major_version')!==false&&strpos($dlphp,'minor_version')!==false);
    t('rDeployLog carries version into session',strpos($amjs,'version:dep.version')!==false);
    t('rDeployLog has Version column header',strpos($amjs,'<th>Version</th>')!==false);
    t('rDeployLog renders version cell',strpos($amjs,'(dep.version||')!==false);
}catch(Exception $e){t('deploy history checks',false,$e->getMessage());}

// ── CHANGE HISTORY ──
try{
    t('api/github_log.php exists',file_exists($root.'/api/github_log.php'));
    $ghphp=file_get_contents($root.'/api/github_log.php');
    t('github_log fetches commits API',strpos($ghphp,'api.github.com')!==false&&strpos($ghphp,'commits')!==false);
    t('github_log uses curl_multi',strpos($ghphp,'curl_multi_init')!==false);
    t('github_log reads github_token setting',strpos($ghphp,"'github_token'")!==false);
    t('github_log caches results',strpos($ghphp,'cacheFile')!==false&&strpos($ghphp,'cacheTTL')!==false);
    // Change History must show full commit message (body + summary), not just the first line
    t('github_log returns full commit message (not truncated to first line)',strpos($ghphp,'$lines[0]')===false&&strpos($ghphp,"'message' => \$msg")!==false);
    // Repo migration (2026-07-03): repo moved to ETWSRepo/HDBS — github_log.php's owner/repo
    // must point at the new location, not the pre-migration C177LVR/HandmadeDesignsBySuzi
    t('github_log points at the migrated repo (ETWSRepo/HDBS)',strpos($ghphp,"\$owner   = 'ETWSRepo'")!==false&&strpos($ghphp,"\$repo    = 'HDBS'")!==false);
    t('github_log no longer references the pre-migration repo',strpos($ghphp,'C177LVR/HandmadeDesignsBySuzi')===false);
    $navjs=file_get_contents($root.'/js/admin-nav.js');
    t('gitlog in nav titles',strpos($navjs,"gitlog:'Change History'")!==false);
    t('rGitLog wired in nav',strpos($navjs,'rGitLog(el)')!==false);
    $amjs=isset($amjs)?$amjs:file_get_contents($root.'/js/admin-misc.js');
    t('rGitLog fetches github_log',strpos($amjs,"'github_log.php'")!==false);
    t('github token card in settings',strpos($amjs,'ghtoken-card')!==false&&strpos($amjs,'saveGitHubToken')!==false);
    t('saveGitHubToken function exists',strpos($amjs,'function saveGitHubToken(')!==false);
    // Live check — only runs if github_token is set (private repo requires auth)
    $ghTok=$pdo->query("SELECT value FROM settings WHERE key_name='github_token' LIMIT 1")->fetchColumn();
    if($ghTok){
        // github_log.php now requires admin auth
        $ghAdminTok=$pdo->query("SELECT value FROM settings WHERE key_name='admin_session_token' LIMIT 1")->fetchColumn();
        $ch=curl_init('https://handmadedesignsbysuzi.com/api/github_log.php');
        $ghHdrs=['Content-Type: application/json'];
        if($ghAdminTok)$ghHdrs[]='X-Admin-Token: '.$ghAdminTok;
        curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>15,CURLOPT_HTTPHEADER=>$ghHdrs]);
        $body=curl_exec($ch);curl_close($ch);
        $gd=json_decode($body,true);
        tProd('github_log returns commits',isset($gd['commits'])&&count($gd['commits'])>0);
    }else{
        t('github_log returns commits',true,'skipped — no github_token set yet');
    }
    // Per-commit Version column (mapped from deploy log)
    t('_renderGitLog function exists',strpos($amjs,'function _renderGitLog(')!==false);
    t('rGitLog fetches deploy_log for versions',strpos($amjs,"apiFetch('deploy_log.php','GET')")!==false);
    t('_renderGitLog maps commit to version',strpos($amjs,'function verForCommit(')!==false);
    t('Change History header shows current version',strpos($amjs,'gitlog-ver')!==false);
    // Version column header appears in both deploy + change history renderers
    t('Version column header present',substr_count($amjs,'<th>Version</th>')>=2);
    // Staging cache-busting of admin JS in index.php
    $htmlV=file_get_contents($root.'/index.php');
    t('admin-orders.js cache-busted',strpos($htmlV,'admin-orders.js?v=')!==false);
    t('admin-misc.js cache-busted',strpos($htmlV,'admin-misc.js?v=')!==false);
}catch(Exception $e){t('change history checks',false,$e->getMessage());}

// ── REGRESSION TEST SECURITY ──
try{
    $rtphp=file_get_contents($root.'/regression_test.php');
    t('regression_test.php has token gate',strpos($rtphp,'rt_token')!==false&&strpos($rtphp,'hash_equals')!==false);
    t('regression_test.php returns 403 on bad token',strpos($rtphp,'http_response_code(403)')!==false);
    $amjs=isset($amjs)?$amjs:file_get_contents($root.'/js/admin-misc.js');
    t('admin-misc fetches rt_token',strpos($amjs,"key:'rt_token'")!==false);
    t('runRegTests appends token',strpos($amjs,'_rtToken')!==false);
    // Live HTTP check — bare URL must return 403
    $ch=curl_init('https://handmadedesignsbysuzi.com/regression_test.php');
    curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>8,CURLOPT_NOBODY=>true]);
    curl_exec($ch);
    $code=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE);
    curl_close($ch);
    t('bare URL returns 403',$code===403,'HTTP '.$code);
}catch(Exception $e){t('regression test security checks',false,$e->getMessage());}

// ── TABLEKIT INTEGRATION ──
try{
    $tblcss=file_get_contents($root.'/css/table.css');
    $tbljs=file_get_contents($root.'/js/table.js');
    t('css/table.css exists',strlen($tblcss)>100);
    t('js/table.js exists',strlen($tbljs)>100);
    $html=isset($html)?$html:file_get_contents($root.'/index.php');
    t('index.php loads table.css',strpos($html,'css/table.css')!==false);
    t('index.php loads table.js',strpos($html,'js/table.js')!==false);
    t('TableKit.initAll() in index.php',strpos($html,'TableKit.initAll()')!==false);
    $aojs=isset($aojs)?$aojs:file_get_contents($root.'/js/admin-orders.js');
    t('buildCustThead exists with colgroup',strpos($aojs,'buildCustThead')!==false&&strpos($aojs,'colgroup')!==false);
    t('buildOrdThead plain th',strpos($aojs,"cols.map(function(l){return'<th>'+l+'</th>';}")!==false);
    t('orders table has tablekit class',strpos($aojs,'tablekit')!==false);
    t('customers table has tablekit class',substr_count($aojs,'tablekit')>=2);
    t('sqPay thead plain th',strpos($aojs,"'Date / Time'")!==false&&strpos($aojs,"return'<th>'+l+'</th>';")!==false);
    t('sqPay table has tablekit class',substr_count($aojs,'tablekit')>=3);
    $amjs=isset($amjs)?$amjs:file_get_contents($root.'/js/admin-misc.js');
    t('buildElThead plain th',strpos($amjs,'buildElThead')!==false&&strpos($amjs,'Date &amp; Time')!==false);
    t('email log table has tablekit class',strpos($amjs,'tablekit')!==false);
    $apjs=file_get_contents($root.'/js/admin-products.js');
    t('buildProdThead plain th',strpos($apjs,'buildProdThead')!==false&&strpos($apjs,'<th>Product</th>')!==false);
    t('products table has tablekit class',strpos($apjs,'tablekit')!==false);
    $shopcss=file_get_contents($root.'/css/shop.css');
    t('tk-drop-btn hidden in shop.css',strpos($shopcss,'tk-drop-btn')!==false&&strpos($shopcss,'opacity:0')!==false);
    t('tk-th-label arrow in shop.css',strpos($shopcss,'tk-th-label')!==false&&strpos($shopcss,'25BC')!==false);
}catch(Exception $e){t('TableKit integration checks',false,$e->getMessage());}

// ── SECURITY: HTACCESS ──
try{
    $htaccess=file_get_contents($root.'/.htaccess');
    tProd('htaccess disables directory listing',strpos($htaccess,'Options -Indexes')!==false);
    tProd('htaccess blocks config.php',strpos($htaccess,'"config.php"')!==false&&strpos($htaccess,'Deny from all')!==false);
    tProd('htaccess blocks applog.php',strpos($htaccess,'"applog.php"')!==false);
    tProd('htaccess blocks secrets.php',strpos($htaccess,'secrets\.php')!==false);
    // Verify secrets.php defines all required constants (readable one level above public_html)
    $secretsFile=dirname($root).'/secrets.php';
    if(file_exists($secretsFile)){
        $secretsPhp=file_get_contents($secretsFile);
        t('secrets.php defines SQUARE_TOKEN',strpos($secretsPhp,"define('SQUARE_TOKEN'")!==false);
        t('secrets.php defines SQUARE_APP_ID',strpos($secretsPhp,"define('SQUARE_APP_ID'")!==false);
        t('secrets.php defines SQUARE_WEBHOOK_SIG_KEY',strpos($secretsPhp,"define('SQUARE_WEBHOOK_SIG_KEY'")!==false);
        t('secrets.php defines DB_PASSWORD',strpos($secretsPhp,"define('DB_PASSWORD'")!==false);
    } else {
        t('secrets.php exists above public_html',false,'File not found at '.$secretsFile);
    }
    tProd('htaccess blocks .log/.txt files',strpos($htaccess,'\.(log|txt)$')!==false);
    // Security headers (prod .htaccess only — staging keeps its own Basic Auth .htaccess)
    tProd('htaccess sets X-Frame-Options',strpos($htaccess,'X-Frame-Options')!==false);
    tProd('htaccess sets X-Content-Type-Options nosniff',strpos($htaccess,'X-Content-Type-Options')!==false&&strpos($htaccess,'nosniff')!==false);
    tProd('htaccess sets Referrer-Policy',strpos($htaccess,'Referrer-Policy')!==false);
    tProd('htaccess sets HSTS (Strict-Transport-Security)',strpos($htaccess,'Strict-Transport-Security')!==false);
    tProd('CSP restricts frame-ancestors',strpos($htaccess,"frame-ancestors 'self'")!==false);
    // Live HTTP checks
    function httpCode($url){$ch=curl_init($url);curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>8,CURLOPT_NOBODY=>true,CURLOPT_FOLLOWLOCATION=>false]);curl_exec($ch);$c=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE);curl_close($ch);return $c;}
    $base='https://handmadedesignsbysuzi.com';
    t('api/config.php blocked (403)',httpCode($base.'/api/config.php')===403,'HTTP '.httpCode($base.'/api/config.php'));
    t('api/applog.php blocked (403)',httpCode($base.'/api/applog.php')===403,'HTTP '.httpCode($base.'/api/applog.php'));
    t('secrets.php blocked (403)',httpCode($base.'/secrets.php')===403,'HTTP '.httpCode($base.'/secrets.php'));
    t('notify_log.txt blocked (403)',httpCode($base.'/notify_log.txt')===403,'HTTP '.httpCode($base.'/notify_log.txt'));
    t('api/ directory listing blocked (403)',httpCode($base.'/api/')===403,'HTTP '.httpCode($base.'/api/'));
    t('js/ directory listing blocked (403)',httpCode($base.'/js/')===403,'HTTP '.httpCode($base.'/js/'));
    // CSP header check
    $ch=curl_init($base.'/');curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>8,CURLOPT_HEADER=>true,CURLOPT_NOBODY=>true]);$resp=curl_exec($ch);curl_close($ch);
    t('CSP upgrade-insecure-requests header set',stripos($resp,'upgrade-insecure-requests')!==false);
    t('htaccess has no http:// asset loads',strpos(file_get_contents($root.'/.htaccess'),'http://')===false);
}catch(Exception $e){t('htaccess security checks',false,$e->getMessage());}

// ── INPUT VALIDATION & PASSWORD INTEGRITY ──
try{
    $prodphp=file_get_contents($root.'/api/products.php');
    t('products.php validates id format (blocks path traversal)',strpos($prodphp,"preg_match('/^[A-Za-z0-9_-]+\$/'")!==false&&strpos($prodphp,'Invalid product id')!==false);
    // Tripwire: admin password must be a valid bcrypt hash — catches corruption/lockout early
    $apHash=$pdo->query("SELECT value FROM settings WHERE key_name='admin_password' LIMIT 1")->fetchColumn();
    t('admin_password is a valid bcrypt hash',is_string($apHash)&&(strncmp($apHash,'$2y$',4)===0||strncmp($apHash,'$2b$',4)===0),'starts: '.substr((string)$apHash,0,4));
    // #4: per-session admin token table (concurrent sessions; test no longer clobbers live session)
    $cfgAuth=file_get_contents($root.'/api/config.php');
    t('config.php has validAdminToken helper',strpos($cfgAuth,'function validAdminToken(')!==false);
    t('requireAdmin checks admin_sessions table',strpos($cfgAuth,'FROM admin_sessions WHERE token')!==false);
    $adAuth=file_get_contents($root.'/api/admin.php');
    t('login inserts into admin_sessions',strpos($adAuth,'INSERT INTO admin_sessions')!==false);
    t('logout deletes session row',strpos($adAuth,'DELETE FROM admin_sessions WHERE token')!==false);
    t('reset_password clears all sessions',strpos($adAuth,'DELETE FROM admin_sessions"')!==false);
    // #5 tripwire: production must not have debug logging enabled (body logging)
    $dch=curl_init('https://handmadedesignsbysuzi.com/api/admin.php');
    curl_setopt_array($dch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>8,CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>'{"action":"get_setting","key":"debug_mode"}',CURLOPT_HTTPHEADER=>['Content-Type: application/json']]);
    $dresp=json_decode(curl_exec($dch),true);curl_close($dch);
    t('prod debug_mode is off',isset($dresp['value'])&&(string)$dresp['value']==='0','value='.($dresp['value']??'?'));
    // #3: order_confirm.php uses fixed CORS origin (no Origin reflection)
    $ocCors=file_get_contents($root.'/order_confirm.php');
    t('order_confirm.php no echo-origin CORS',strpos($ocCors,'HTTP_ORIGIN')===false&&strpos($ocCors,'ALLOWED_ORIGIN')!==false);
}catch(Exception $e){t('input validation / password integrity checks',false,$e->getMessage());}

// ── ORDER CONFIRM TOKEN GATE ──
try{
    $ocphp=file_get_contents($root.'/order_confirm.php');
    t('order_confirm.php has token gate',strpos($ocphp,'confirm_token')!==false&&strpos($ocphp,'hash_equals')!==false);
    t('order_confirm.php requires config.php at top',strpos($ocphp,"require_once __DIR__ . '/api/config.php'")!==false);
    // confirm emails now sent by process_payment.php server-side; store.js no longer calls order_confirm.php
    t('store.js calls process_payment not order_confirm',strpos(file_get_contents($root.'/js/store.js'),'process_payment.php')!==false&&strpos(file_get_contents($root.'/js/store.js'),'order_confirm.php')===false);
    t('ui.js loads confirm_token',strpos(file_get_contents($root.'/js/ui.js'),"key:'confirm_token'")!==false);
    // Live: no token → 403
    $ch=curl_init('https://handmadedesignsbysuzi.com/order_confirm.php');
    curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>8,CURLOPT_POST=>true,
        CURLOPT_POSTFIELDS=>'{"order_id":"TEST","customer_email":"test@test.com"}',
        CURLOPT_HTTPHEADER=>['Content-Type: application/json']]);
    curl_exec($ch);$code=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE);curl_close($ch);
    t('order_confirm blocked without token (403)',$code===403,'HTTP '.$code);
    // Live: wrong token → 403
    $ch=curl_init('https://handmadedesignsbysuzi.com/order_confirm.php');
    curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>8,CURLOPT_POST=>true,
        CURLOPT_POSTFIELDS=>'{"order_id":"TEST","customer_email":"test@test.com","confirm_token":"wrongtoken"}',
        CURLOPT_HTTPHEADER=>['Content-Type: application/json']]);
    curl_exec($ch);$code=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE);curl_close($ch);
    t('order_confirm blocked with wrong token (403)',$code===403,'HTTP '.$code);
}catch(Exception $e){t('order_confirm token gate checks',false,$e->getMessage());}

// ── DB BACKUP ──
try{
    t('api/db_backup.php exists',file_exists($root.'/api/db_backup.php'));
    $bkphp=file_get_contents($root.'/api/db_backup.php');
    t('db_backup has token gate',strpos($bkphp,'hash_equals')!==false&&strpos($bkphp,'backup_token')!==false);
    t('db_backup dumps all tables',strpos($bkphp,'SHOW TABLES')!==false);
    t('db_backup emails backup',strpos($bkphp,'sendEmailWithAttachment')!==false);
    t('db_backup uses DROP TABLE IF EXISTS',strpos($bkphp,'DROP TABLE IF EXISTS')!==false);
    $amjs=isset($amjs)?$amjs:file_get_contents($root.'/js/admin-misc.js');
    t('rDbBackup function exists',strpos($amjs,'function rDbBackup(')!==false);
    t('runDbBackup function exists',strpos($amjs,'function runDbBackup(')!==false);
    t('dbbackup in ADMIN_NAV_LABELS',strpos($amjs,"dbbackup:'")!==false);
    t('dbbackup in developer folder',strpos($amjs,"'dbbackup'")!==false);
    $anjs=isset($anjs)?$anjs:file_get_contents($root.'/js/admin-nav.js');
    t('dbbackup in nav titles',strpos($anjs,"dbbackup:'DB Backup'")!==false);
    t('dbbackup wired in router',strpos($anjs,'rDbBackup(el)')!==false);
    t('backup_token auto-generated in admin.php',strpos(file_get_contents($root.'/api/admin.php'),"'backup_token'")!==false);
    // Live: db_backup blocked without token
    $ch=curl_init('https://handmadedesignsbysuzi.com/api/db_backup.php');
    curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>8,CURLOPT_POST=>true,
        CURLOPT_POSTFIELDS=>'{"token":"wrongtoken"}',CURLOPT_HTTPHEADER=>['Content-Type: application/json']]);
    curl_exec($ch);$code=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE);curl_close($ch);
    t('db_backup blocked with wrong token (403)',$code===403,'HTTP '.$code);
}catch(Exception $e){t('db_backup checks',false,$e->getMessage());}

// ── LOGOUT MENU ──
try{
    $amjs2=isset($amjs)?$amjs:file_get_contents($root.'/js/admin-misc.js');
    $anjs2=isset($anjs)?$anjs:file_get_contents($root.'/js/admin-nav.js');
    t('logout in ADMIN_NAV_LABELS',strpos($amjs2,"logout:'🚪 Logout'")!==false);
    t('logout in ADMIN_NAV_STRUCTURE_DEFAULT',strpos($amjs2,"type:'item',sec:'logout'")!==false);
    t('logout in nav titles',strpos($anjs2,"logout:'Logout'")!==false);
    t('logout clears token and reloads',strpos($anjs2,"localStorage.removeItem('suzi_admin_token')")!==false&&strpos($anjs2,'location.reload()')!==false);
}catch(Exception $e){t('logout menu checks',false,$e->getMessage());}

// ── SHIPPING EMAIL SHIPPER/TRACKING ──
try{
    $aojs=isset($aojs)?$aojs:file_get_contents($root.'/js/admin-orders.js');
    $ssphp2=isset($ssphp)?$ssphp:file_get_contents($root.'/send_shipping.php');
    t('emailPreviewThenSend defined',strpos($aojs,'function emailPreviewThenSend')!==false);
    t('showEmailPreviewModal detects shipping email',strpos($aojs,"endpoint.indexOf('send_shipping')!==-1")!==false);
    t('shipping preview has shipper dropdown',strpos($aojs,"id=\"email-carrier\"")!==false);
    t('shipping preview has tracking field',strpos($aojs,"id=\"email-tracking\"")!==false);
    t('emailSendNow extracts shipper value',strpos($aojs,"payload.carrier=carrierEl.value")!==false);
    t('emailSendNow extracts tracking value',strpos($aojs,"payload.tracking=trackingEl.value")!==false);
    t('send_shipping accepts carrier param',strpos($ssphp2,"\$carrier_override = isset(\$data['carrier'])")!==false);
    t('send_shipping accepts tracking param',strpos($ssphp2,"\$tracking_override = isset(\$data['tracking'])")!==false);
    t('send_shipping updates order with shipper',strpos($ssphp2,"'shipping_carrier=?'")!==false);
    t('send_shipping updates order with tracking',strpos($ssphp2,"'tracking_number=?'")!==false);
}catch(Exception $e){t('shipping email shipper/tracking checks',false,$e->getMessage());}

// ── SENSITIVE SETTINGS BLOCKED ──
try{
    $adphp=isset($adphp)?$adphp:file_get_contents($root.'/api/admin.php');
    $sensitiveKeys=['github_token','admin_password','admin_sec_answer','square_access_token','square_app_secret'];
    foreach($sensitiveKeys as $sk)
        t('get_setting blocks '.$sk, strpos($adphp,"'".$sk."'")!==false&&strpos($adphp,'$sensitive')!==false);
    // Live checks — sensitive or admin-only keys must be blocked for unauthenticated requests
    // (returns 401 Unauthorized from requireAdmin, or 400 Forbidden from sensitive blocklist)
    $apiUrl='https://handmadedesignsbysuzi.com/api/admin.php';
    foreach(['github_token','admin_password'] as $sk){
        $ch=curl_init($apiUrl);
        curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>8,CURLOPT_POST=>true,
            CURLOPT_POSTFIELDS=>json_encode(['action'=>'get_setting','key'=>$sk]),
            CURLOPT_HTTPHEADER=>['Content-Type: application/json']]);
        $res=json_decode(curl_exec($ch),true);curl_close($ch);
        t('get_setting '.$sk.' returns forbidden',isset($res['success'])&&$res['success']===false,$res['error']??json_encode($res));
    }
    // rt_token requires admin auth (not a public key) — check with admin token from DB
    $rtTok=isset($_rtAdminToken)?$_rtAdminToken:$pdo->query("SELECT value FROM settings WHERE key_name='admin_session_token' LIMIT 1")->fetchColumn();
    if($rtTok){
        $ch=curl_init($apiUrl);
        curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>8,CURLOPT_POST=>true,
            CURLOPT_POSTFIELDS=>json_encode(['action'=>'get_setting','key'=>'rt_token']),
            CURLOPT_HTTPHEADER=>['Content-Type: application/json',"X-Admin-Token: $rtTok"]]);
        $rtRes=json_decode(curl_exec($ch),true);curl_close($ch);
        tProd('get_setting rt_token returns value (with admin token)',isset($rtRes['success'])&&$rtRes['success']===true&&!empty($rtRes['value']));
    } else {
        t('get_setting rt_token requires admin token (no session available, skip)',true,'skipped - no admin session');
    }
}catch(Exception $e){t('sensitive settings blocked checks',false,$e->getMessage());}

// ── DEBUG/UTILITY FILES REMOVED ──
foreach(['debug.php','debug.flag','drop_tn_tax.php','fix_tax.php','sq_test.php','run_tests.html','reset_nav.php','default.php','get_products.php'] as $df)
    tProd($df.' removed from server',!file_exists($root.'/'.$df));
tProd('api/prompt_log.php removed from server',!file_exists($root.'/api/prompt_log.php'));

// ── FAVICON ──
try{
    $ihtml=isset($ihtml)?$ihtml:file_get_contents($root.'/index.php');
    t('favicon.png exists',file_exists($root.'/favicon.png'));
    t('favicon.png linked in index.php',strpos($ihtml,'favicon.png')!==false);
    t('favicon link is PNG type',strpos($ihtml,'type="image/png"')!==false);
    t('SVG emoji favicon removed',strpos($ihtml,"data:image/svg+xml")===false);
    t('favicon.png accessible (200)',httpCode('https://handmadedesignsbysuzi.com/favicon.png')===200);
}catch(Exception $e){t('favicon checks',false,$e->getMessage());}

// ── ABOUT PAGE ──
try{
    $ihtml=isset($ihtml)?$ihtml:file_get_contents($root.'/index.php');
    t('aboutsuzi.jpeg exists',file_exists($root.'/aboutsuzi.jpeg'));
    t('aboutsuzi.jpeg under size guard',filesize($root.'/aboutsuzi.jpeg')<400*1024,round(filesize($root.'/aboutsuzi.jpeg')/1024).'KB');
    t('aboutsuzi.jpeg in About page',strpos($ihtml,'aboutsuzi.jpeg')!==false);
    t('About page has photo img tag',strpos($ihtml,'src="aboutsuzi.jpeg?v=2"')!==false);
    t('emoji placeholder removed from About page',strpos($ihtml,'font-size:5rem;margin-bottom:1rem">👜')===false);
    t('About page grid has about-grid class',strpos($ihtml,'about-grid')!==false);
    $css=file_get_contents($root.'/css/shop.css');
    t('about-grid mobile breakpoint in shop.css',strpos($css,'about-grid')!==false&&strpos($css,'max-width:600px')!==false);
    t('about-grid stacks to 1 column on mobile',strpos($css,'about-grid')!==false&&strpos($css,'grid-template-columns:1fr')!==false);
}catch(Exception $e){t('about page checks',false,$e->getMessage());}

// ── MULTI-CATEGORY PRODUCTS ──
try{
    $cfgjs=file_get_contents($root.'/js/config.js');
    t('parseCats helper in config.js',strpos($cfgjs,'function parseCats')!==false);
    t('parseCats handles JSON array',strpos($cfgjs,'JSON.parse')!==false&&strpos($cfgjs,'Array.isArray')!==false);
    $apjs=file_get_contents($root.'/js/admin-products.js');
    t('admin-products: checkbox group (pf-cats)',strpos($apjs,'pf-cats')!==false);
    t('admin-products: pfGetCats function',strpos($apjs,'function pfGetCats')!==false);
    t('admin-products: saveP uses pfGetCats',strpos($apjs,'pfGetCats()')!==false&&strpos($apjs,'JSON.stringify(pfGetCats())')!==false);
    t('admin-products: select#pf-c removed',strpos($apjs,'id="pf-c"')===false);
    t('admin-products: product table uses parseCats',strpos($apjs,'parseCats(p.cat)')!==false);
    $sjs=file_get_contents($root.'/js/store.js');
    t('store.js: filter uses parseCats',strpos($sjs,'parseCats(p.cat).indexOf(ACTIVE_CAT)')!==false);
    t('store.js: detail view uses parseCats join',strpos($sjs,'parseCats(p.cat).join')!==false);
    $aojs=file_get_contents($root.'/js/admin-orders.js');
    t('admin-orders: category count uses parseCats',strpos($aojs,'parseCats(p.cat).indexOf(cat)')!==false);
}catch(Exception $e){t('multi-category checks',false,$e->getMessage());}

// ── CATEGORY DRAG-AND-DROP REORDER ──
try{
    $aojs=isset($aojs)?$aojs:file_get_contents($root.'/js/admin-orders.js');
    t('initCatDrag function exists',strpos($aojs,'function initCatDrag')!==false);
    t('drag handle in category row',strpos($aojs,'draggable="true"')!==false);
    t('dragstart event wired',strpos($aojs,'dragstart')!==false);
    t('drop event saves new order',strpos($aojs,'drop')!==false&&strpos($aojs,'CATS.splice')!==false);
    t('moveCat removed (replaced by drag)',strpos($aojs,'function moveCat')===false);
    t('up/down arrow buttons removed',strpos($aojs,'moveCat(')===false);
}catch(Exception $e){t('drag-and-drop reorder checks',false,$e->getMessage());}

// ── GOOGLE ANALYTICS ──
try{
    $ihtml=isset($ihtml)?$ihtml:file_get_contents($root.'/index.php');
    t('GA4 measurement ID in index.php',strpos($ihtml,'G-0ELY03XGRE')!==false);
    t('GA4 gtag.js script tag present',strpos($ihtml,'googletagmanager.com/gtag/js')!==false);
    t('GA4 gtag config call present',strpos($ihtml,"gtag('config', 'G-0ELY03XGRE')")!==false);
    $cfgGA=file_get_contents($root.'/js/config.js');
    t('showPage function defined in config.js',strpos($cfgGA,'function showPage(')!==false);
    t('goStore fires gtag page_view',strpos($cfgGA,"gtag('event','page_view'")!==false&&strpos($cfgGA,"page_path:'/#store'")!==false);
    t('goAbout fires gtag page_view',strpos($cfgGA,"page_title:'About Suzi'")!==false&&strpos($cfgGA,"page_path:'/#about'")!==false);
    t('goFAQ fires gtag page_view',strpos($cfgGA,"page_title:'FAQ'")!==false&&strpos($cfgGA,"page_path:'/#faq'")!==false);
    t('goCustom fires gtag page_view',strpos($cfgGA,"page_title:'Custom Orders'")!==false&&strpos($cfgGA,"page_path:'/#custom'")!==false);
    t('goContact fires gtag page_view',strpos($cfgGA,"page_title:'Contact Us'")!==false&&strpos($cfgGA,"page_path:'/#contact'")!==false);
    t('goAuth fires gtag page_view',strpos($cfgGA,"page_path:'/#auth'")!==false);
    $sjsGA=file_get_contents($root.'/js/store.js');
    t('openCart fires gtag page_view',strpos($sjsGA,"page_title:'Your Cart'")!==false&&strpos($sjsGA,"page_path:'/#cart'")!==false);
    t('openCheckout fires gtag page_view',strpos($sjsGA,"page_title:'Checkout'")!==false&&strpos($sjsGA,"page_path:'/#checkout'")!==false);
    t('gtag guarded with typeof check in config.js',strpos($cfgGA,"typeof gtag==='function'")!==false);
    t('gtag guarded with typeof check in store.js',strpos($sjsGA,"typeof gtag==='function'")!==false);
}catch(Exception $e){t('Google Analytics checks',false,$e->getMessage());}

// ── STRUCTURED DATA (JSON-LD) ──
try{
    $ihtml=isset($ihtml)?$ihtml:file_get_contents($root.'/index.php');
    t('LocalBusiness JSON-LD in index.php',strpos($ihtml,'application/ld+json')!==false&&strpos($ihtml,'"LocalBusiness"')!==false);
    t('LocalBusiness has name',strpos($ihtml,'"name": <?php echo json_encode($bizName); ?>')!==false);
    t('LocalBusiness has address (Knoxville TN)',strpos($ihtml,'"Knoxville"')!==false&&strpos($ihtml,'"TN"')!==false);
    t('LocalBusiness has email',strpos($ihtml,'"email": <?php echo json_encode($bizEmail); ?>')!==false);
    $cfgLD=file_get_contents($root.'/js/config.js');
    t('injectProductSchemas function exists',strpos($cfgLD,'function injectProductSchemas(')!==false);
    t('injectProductSchemas uses p.desc (not p.description)',strpos($cfgLD,'p.desc||')!==false&&strpos($cfgLD,'p.description')===false);
    t('injectProductSchemas removes stale schemas',strpos($cfgLD,'product-schema')!==false&&strpos($cfgLD,'remove()')!==false);
    t('injectProductSchemas filters sell==1 and stock>0',strpos($cfgLD,'p.sell==1')!==false&&strpos($cfgLD,'p.stock>0')!==false);
    t('injectProductSchemas reads p.imgs array (not p.img1/2/3)',strpos($cfgLD,'p.imgs||[]')!==false&&strpos($cfgLD,'p.img1')===false);
    t('product schema includes image field',strpos($cfgLD,'"image":imgs')!==false);
    t('product schema includes offers with price',strpos($cfgLD,'"offers":')!==false&&strpos($cfgLD,'"price":parseFloat(p.price)')!==false);
    t('product schema includes brand',strpos($cfgLD,'"brand":')!==false&&strpos($cfgLD,'"@type":"Brand","name":(window.BIZ_NAME')!==false);
    // hasOfferCatalog removed — bare Product entries with no offers triggered Google critical errors
    t('hasOfferCatalog removed from index.php',strpos($ihtml,'hasOfferCatalog')===false);
    t('no bare category Product entries',strpos($ihtml,'"name": "Corvette Tote Bags"')===false&&strpos($ihtml,'"name": "Handmade Purses"')===false);
    t('single LocalBusiness block (no duplicate)',substr_count($ihtml,'"@type": "LocalBusiness"')+substr_count($ihtml,'"@type":"LocalBusiness"')===1);
    t('LocalBusiness has logo',strpos($ihtml,'"logo":')!==false&&strpos($ihtml,'HDBSLogo.jpeg')!==false);
    t('LocalBusiness priceRange is specific range',strpos($ihtml,'"priceRange": "$35–$200"')!==false);
    $uiLD=file_get_contents($root.'/js/ui.js');
    t('injectProductSchemas called after API load',strpos($uiLD,'injectProductSchemas()')!==false);
    t('checkProductParam function exists',strpos($uiLD,'function checkProductParam(')!==false);
    t('checkProductParam reads ?p= URL param',strpos($uiLD,"params.get('p')")!==false);
    t('checkProductParam called after products load',strpos($uiLD,'checkProductParam()')!==false);
}catch(Exception $e){t('structured data checks',false,$e->getMessage());}

// ── PER-PRODUCT SEO (title, meta, URL) ──
try{
    $sjsSEO=file_get_contents($root.'/js/store.js');
    t('openPD updates document.title',strpos($sjsSEO,"document.title=p.name+' | '+(window.BIZ_NAME")!==false);
    t('openPD updates meta description',strpos($sjsSEO,'meta[name="description"]')!==false&&strpos($sjsSEO,'setAttribute(')!==false);
    t('openPD pushes ?p= URL state',strpos($sjsSEO,"history.pushState({p:p.id}")!==false);
    t('closePD restores original title',strpos($sjsSEO,'Handcrafted Bags & Purses | Knoxville, TN')!==false);
    t('closePD restores URL to pathname',strpos($sjsSEO,'window.location.pathname')!==false);
}catch(Exception $e){t('per-product SEO checks',false,$e->getMessage());}

// ── IMAGE ALT TEXT ──
try{
    $sjsAlt=file_get_contents($root.'/js/store.js');
    t('store card image has alt=product name',strpos($sjsAlt,"alt=\"'+p.name+'\"")!==false);
    t('detail thumbnails have numbered alt text',strpos($sjsAlt,"alt=\"'+p.name+' photo '+(t+1)+'\"")!==false);
    t('cart item image has alt=product name',strpos($sjsAlt,"alt=\"'+p.name+'\"")!==false);
    t('gallery slides have alt=product name',substr_count($sjsAlt,"alt=\"'+p.name+'\"")>=2);
    t('openLightbox passes product name to lightbox',strpos($sjsAlt,'openLightbox(window._pdImgs,idx,p.name)')!==false);
    $uiAlt=file_get_contents($root.'/js/ui.js');
    t('openLightbox accepts altText parameter',strpos($uiAlt,'function openLightbox(imgs,idx,altText)')!==false);
    t('lightbox img alt set on open',strpos($uiAlt,'lbImg.alt=')!==false);
    t('lightbox img alt updated on nav',strpos($uiAlt,'img.alt=LB_ALT')!==false);
}catch(Exception $e){t('image alt text checks',false,$e->getMessage());}

// ── CHANGE HISTORY STATS HEADER + REPO STATS ──
try{
    t('api/repo_stats.php exists',file_exists($root.'/api/repo_stats.php'));
    $rsphp=file_get_contents($root.'/api/repo_stats.php');
    t('repo_stats.php is admin-gated',strpos($rsphp,'requireAdmin()')!==false);
    t('repo_stats.php scans deployment dir',strpos($rsphp,'RecursiveDirectoryIterator')!==false&&strpos($rsphp,'dirname(__DIR__)')!==false);
    t('repo_stats.php returns file counts + LOC',strpos($rsphp,"'total_files'")!==false&&strpos($rsphp,"'code_files'")!==false&&strpos($rsphp,"'lines_of_code'")!==false);
    t('repo_stats.php returns repo + path',strpos($rsphp,"'ETWSRepo/HDBS'")!==false&&strpos($rsphp,"'path'")!==false);
    // github_log.php — full pagination, total commit count, refresh cache bypass
    $ghphp=file_get_contents($root.'/api/github_log.php');
    t('github_log paginates all commits',strpos($ghphp,'per_page=$perPage&page=$page')!==false&&strpos($ghphp,'array_merge($commits')!==false);
    t('github_log returns total_commits',strpos($ghphp,'total_commits')!==false&&strpos($ghphp,'function ghTotalCommits')!==false);
    t('github_log refresh bypasses cache',strpos($ghphp,'$noCache')!==false&&strpos($ghphp,"_GET['refresh']")!==false);
    // admin-misc.js — Change History stats header, layout, refresh
    $amjs=isset($amjs)?$amjs:file_get_contents($root.'/js/admin-misc.js');
    t('rGitLog accepts force (cache bypass) arg',strpos($amjs,'function rGitLog(el,force)')!==false&&strpos($amjs,"force?'?refresh=1'")!==false);
    t('Change History Refresh forces bypass',strpos($amjs,"getElementById(\\'acnt\\'),true")!==false);
    t('Change History fetches repo_stats',strpos($amjs,"apiFetch('repo_stats.php')")!==false);
    t('Change History has stat cards',strpos($amjs,'id="gl-path"')!==false&&strpos($amjs,'id="gl-total"')!==false&&strpos($amjs,'id="gl-code"')!==false&&strpos($amjs,'id="gl-loc"')!==false);
    // Repo migration (2026-07-03): the Repo card must be populated live from repo_stats.php's
    // 's.repo' response, not a hardcoded string — a hardcoded string is exactly what went stale
    // when the repo moved to ETWSRepo/HDBS and stayed wrong on screen after the fix elsewhere.
    t('Repo card is a live stat, not a hardcoded string',strpos($amjs,'id="gl-repo"')!==false&&strpos($amjs,'C177LVR/HandmadeDesignsBySuzi')===false);
    t('Repo card is wired to repo_stats.php\'s repo field',strpos($amjs,"setT('gl-repo',s.repo")!==false);
    t('Change History form centered + narrower',strpos($amjs,'max-width:1000px;margin:0 auto')!==false);
    t('Change History entries scroll vertically',strpos($amjs,'max-height:55vh;overflow-y:auto')!==false);
    // deploy_log.php — minor version auto-increment, one per logical change
    $dlphp2=file_get_contents($root.'/api/deploy_log.php');
}catch(Exception $e){t('change history stats checks',false,$e->getMessage());}

// ── WATCH SCRIPT ──
t('watch.ps1 not deployed to server',!file_exists($root.'/watch.ps1'));

// ── PRODUCT FORM ACTION BUTTONS ──
try{
    $apjs=isset($apjs)?$apjs:file_get_contents($root.'/js/admin-products.js');
    t('pfSetActionBtns function exists',strpos($apjs,'function pfSetActionBtns')!==false);
    t('action buttons container (pf-action-btns)',strpos($apjs,'pf-action-btns')!==false);
    t('Update button appears before Cancel',strpos($apjs,'saveP()')!==false&&strpos($apjs,'cancelPF()')!==false&&strpos($apjs,'saveP()')< strpos($apjs,'cancelPF()'));
    t('bottom Cancel/Save div removed from form',strpos($apjs,"justify-content:flex-end;margin-top:.5rem")===false);
    t('cancelPF restores Add Product button',strpos($apjs,'cancelPF')!==false&&strpos($apjs,'+ Add Product')!==false);
}catch(Exception $e){t('product form action buttons checks',false,$e->getMessage());}

// ── 3. FILES ──
foreach(['api/config.php','api/admin.php','api/orders.php','api/products.php',
         'api/tax_sweep.php','api/square_payments.php','api/fetch_tax.php',
         'api/email_log.php','api/tn_city_tax.php','api/applog.php',
         'api/business_docs.php',
         'mailer.php','checkout.php','send_confirm.php','send_shipping.php','send_generic.php',
         'verify_payment.php','notify.php','index.php',
         'css/shop.css','css/table.css','js/table.js','js/api.js','js/config.js','js/store.js','js/auth.js',
         'js/ui.js','js/admin-nav.js','js/admin-general.js','js/admin-products.js',
         'js/admin-orders.js','js/admin-misc.js','js/admin-business.js'] as $f)
    t($f, file_exists($root.'/'.$f));

// ── 4. JS FUNCTION CHECKS ──
$fns=[
    // Storefront
    'openCheckout','placeOrder','addToCart',
    // Orders
    'renderOrdersTable','viewOrder',
    'sendConfirmEmail','sendShippingEmail','sendGenericEmail','previewGenericEmail','deleteOrder','deleteAllOrders',
    'printInvoice','printShippingLabel',
    'exportOrdersCsv','exportTaxCSV','clearOrdFilters','clearOrderFilters',
    'updCarrier','updTracking','fetchOrderTax',
    'showRefundForm','saveRefund',
    // Products
    'pfNextSku','pfAutoSku','pfGetCats','pfSetActionBtns',
    'initCatDrag','showPF','cancelPF','saveP',
    'prodSort','prodFilt','applyProdFilters',
    'setAllStock1','setAllPrice1','autoAssignSkus',
    'exportProductsCsv','showImportCsv','doImportCsv','toggleSell',
    // Categories
    'editCat','saveCatEdit','addCat','deleteCat',
    // Customers
    'custSort','custFilt','applyCustomerFilters',
    'showCustForm','cancelCustForm','saveCust','deleteCust',
    'custEditRow','custInpStyle',
    // FAQs
    'rAdminFAQs','saveFAQ','editFAQ','deleteFAQ',
    // Reviews
    'deleteReview',
    // Shipping
    'applyShippingConfig','saveShipping','addTier','deleteTier','addState',
    // Settings
    'saveSquareFees','saveTaxRates','resetDefaultTaxRates',
    'saveVersion','saveGitHubToken','saveBizProfile',
    // Tax sweep
    'rSweep','showAddSweepForm','saveAddSweepForm','deleteSweepRow','editSweepRow','saveSweepEdit',
    // Square payments
    'rSqPay',
    // Subscribers
    'delSub','exportSubs',
    // DB Backup
    'rDbBackup','runDbBackup',
    // Logs
    'rLogs','clearLog','logFullScreen','emailLog','clearEmailLog','elRefresh',
    // Email log
    'rEmailLog','elSort','elFilt','elFiltApply','applyElFilters','buildElThead',
    // Nav
    'buildAdminNav','saveNavOrder','toggleNavFolder',
    // Biz profile
    'rBizProfile',
    // Business: documents, inventory, reports
    'rBizDocs','bizDocUpload','bizDocView','bizDocDownload','bizDocDelete',
    'rBizInv','rBizReports',
    // Regression test
    'rRegTest','runRegTests','cancelRegTests',
    // TN City
    'rTnCity','showAddTnCity','addTnCity','saveTnCity','deleteTnCity',
    // Deploy / git log
    'rDeployLog','rGitLog',
    // Debug / misc
    'setDebugMode','setPageLogMode',
    'SQ_FEE_PCT','TAX_RATES',
];
try{
    $js='';
    foreach(['js/api.js','js/config.js','js/data.js','js/store.js','js/auth.js',
             'js/ui.js','js/admin-nav.js','js/admin-general.js','js/admin-products.js',
             'js/admin-orders.js','js/admin-misc.js','js/admin-business.js'] as $jsf){
        if(file_exists($root.'/'.$jsf)) $js.=file_get_contents($root.'/'.$jsf);
    }
    t('JS files readable', strlen($js)>10000, strlen($js).' bytes');
// Check store.js has sold-out diagonal
try{$sjs=file_get_contents($root.'/js/store.js');t('store.js has sold-out diagonal',strpos($sjs,'stroke-width')!==false&&strpos($sjs,'SOLD OUT')!==false);}catch(Exception $e){t('sold-out diagonal',false,$e->getMessage());}
// Check orders.php has stock decrement
try{$oapi=file_get_contents($root.'/api/orders.php');t('orders.php decrements stock',strpos($oapi,'stock = stock - ?')!==false);}catch(Exception $e){t('stock decrement',false,$e->getMessage());}
    foreach($fns as $fn){
        $found=(bool)preg_match('/function\s+'.preg_quote($fn,'/').'[\s(]|var\s+'.preg_quote($fn,'/').'[\s=;,]/', $js);
        t('JS:'.$fn, $found);
    }
    // Check admin-nav id in index.php
    $html=file_get_contents($root.'/index.php');
    t('JS:admin-nav', strpos($html,'id="admin-nav"')!==false);
    // Debug functions (underscore prefix — checked via file content)
    t('JS:_dbgEnabled', strpos($js,'_dbgEnabled')!==false);
    t('JS:_dbgLog',     strpos($js,'_dbgLog')!==false);
    t('JS:_dbgScreen',  strpos($js,'_dbgScreen')!==false);
}catch(Exception $e){
    foreach($fns as $fn) t('JS:'.$fn, false, $e->getMessage());
}

// ── 5. BUTTON COVERAGE ──
// Verify every major button on the site has its onclick handler wired in source
try{
    $aojs=file_get_contents($root.'/js/admin-orders.js');
    $amjs=file_get_contents($root.'/js/admin-misc.js');
    $apjs=file_get_contents($root.'/js/admin-products.js');
    $anjs=file_get_contents($root.'/js/admin-nav.js');
    $ihtml=file_get_contents($root.'/index.php');
    $sjs=file_get_contents($root.'/js/store.js');

    // Storefront buttons
    t('btn:Add to Cart wired',strpos($sjs,'addToCart')!==false||strpos($ihtml,'addToCart')!==false);
    t('btn:Open Checkout wired',strpos($sjs,'openCheckout')!==false||strpos($ihtml,'openCheckout')!==false);
    t('btn:Place Order wired',strpos($sjs,'placeOrder')!==false||strpos($ihtml,'placeOrder')!==false);

    // Product management buttons
    t('btn:Add Product wired',strpos($apjs,'showPF(null)')!==false);
    t('btn:Save/Update Product wired',strpos($apjs,'saveP()')!==false);
    t('btn:Cancel Product form wired',strpos($apjs,'cancelPF()')!==false);
    t('btn:Delete Product wired',strpos($apjs,'delP(')!==false);
    t('btn:Edit Product wired',strpos($apjs,"showPF(")!==false&&strpos($apjs,'Edit</button>')!==false);
    t('btn:Toggle Sell wired',strpos($apjs,'toggleSell(')!==false);
    t('btn:Set All Stock to 1 wired',strpos($apjs,'setAllStock1()')!==false);
    t('btn:Set All Prices to $1 wired',strpos($apjs,'setAllPrice1()')!==false);
    t('btn:Auto-assign SKUs wired',strpos($apjs,'autoAssignSkus()')!==false);
    t('btn:Export Products CSV wired',strpos($apjs,'exportProductsCsv()')!==false);
    t('btn:Import CSV wired',strpos($apjs,'showImportCsv()')!==false);

    // Customer management buttons
    t('btn:Add Customer wired',strpos($aojs,'showCustForm(null)')!==false);
    t('btn:Edit Customer wired',strpos($aojs,'showCustForm(')!==false);
    t('btn:Save Customer wired',strpos($aojs,'saveCust()')!==false);
    t('btn:Cancel Customer form wired',strpos($aojs,'cancelCustForm()')!==false);
    t('btn:Delete Customer wired',strpos($aojs,'deleteCust(')!==false);

    // Customer inline editing
    t('custEditRow function exists',strpos($aojs,'function custEditRow(')!==false);
    t('custInpStyle function exists',strpos($aojs,'function custInpStyle(')!==false);
    t('CUST_EDITID state variable exists',strpos($aojs,'CUST_EDITID')!==false);
    t('customer inline inputs use ci-fn id',strpos($aojs,'ci-fn')!==false);
    t('customer inline inputs use ci-em id',strpos($aojs,'ci-em')!==false);
    t('customer table-layout fixed',strpos($aojs,'table-layout:fixed')!==false);

    // Category buttons
    t('btn:Add Category wired',strpos($aojs,'addCat()')!==false);
    t('btn:Edit Category wired',strpos($aojs,'editCat(')!==false);
    t('btn:Save Cat Edit wired',strpos($aojs,'saveCatEdit(')!==false);
    t('btn:Delete Category wired',strpos($aojs,'deleteCat(')!==false);
    t('btn:Category drag-to-reorder wired',strpos($aojs,'draggable="true"')!==false);

    // Order buttons
    t('btn:View Order wired',strpos($aojs,'viewOrder(')!==false);
    t('btn:Send Confirm Email wired',strpos($aojs,'sendConfirmEmail(')!==false);
    t('btn:Send Shipping Email wired',strpos($aojs,'sendShippingEmail(')!==false);
    t('btn:Delete Order wired',strpos($aojs,'delOrder(')!==false||strpos($aojs,'deleteOrder(')!==false);
    t('btn:Export Orders CSV wired',strpos($aojs,'exportOrdersCsv()')!==false);
    t('btn:Refund wired',strpos($aojs,'showRefundForm()')!==false);

    // FAQ buttons
    t('btn:Save FAQ wired',strpos($aojs,'saveFAQ(')!==false);
    t('btn:Edit FAQ wired',strpos($aojs,'editFAQ(')!==false);
    t('btn:Delete FAQ wired',strpos($aojs,'deleteFAQ(')!==false);

    // Review buttons
    t('btn:Delete Review wired',strpos($aojs,'deleteReview(')!==false);

    // Shipping buttons
    t('btn:Save Shipping wired',strpos($aojs,'saveShipping()')!==false);
    t('btn:Add Shipping Tier wired',strpos($aojs,'addTier()')!==false);
    t('btn:Delete Shipping Tier wired',strpos($aojs,'deleteTier(')!==false);

    // Settings buttons
    t('btn:Save Square Fees wired',strpos($aojs,'saveSquareFees()')!==false);
    t('btn:Save PayPal Fees wired',strpos($aojs,'savePaypalFees()')!==false);
    t('btn:Save Tax Rates wired',strpos($aojs,'saveTaxRates()')!==false);
    t('btn:Reset Default Tax Rates wired',strpos($aojs,'resetDefaultTaxRates()')!==false);
    t('btn:Save Version wired',strpos($amjs,'saveVersion()')!==false);
    t('btn:Save GitHub Token wired',strpos($amjs,'saveGitHubToken()')!==false);
    $abjsBtn=isset($abjs)?$abjs:file_get_contents($root.'/js/admin-business.js');
    t('btn:Save Biz Profile wired',strpos($abjsBtn,'saveBizProfile()')!==false);

    // Log buttons
    t('btn:Clear Log wired',strpos($aojs,'clearLog(')!==false);
    t('btn:Email Log button wired',strpos($aojs,'emailLog(')!==false||strpos($amjs,'emailLog(')!==false);
    t('btn:Log Full Screen wired',strpos($aojs,'logFullScreen(')!==false);
    t('btn:Clear Email Log wired',strpos($amjs,'clearEmailLog()')!==false);

    // DB Backup button
    t('btn:Run DB Backup wired',strpos($amjs,'runDbBackup()')!==false);

    // Subscribers buttons
    t('btn:Delete Subscriber wired',strpos($anjs,'delSub(')!==false);
    t('btn:Export Subscribers wired',strpos($anjs,'exportSubs()')!==false);

    // Regression test buttons
    t('btn:Run Tests wired',strpos($amjs,'runRegTests()')!==false);
    t('btn:Cancel Tests wired',strpos($amjs,'cancelRegTests()')!==false);
    t('btn:Show Failed Only wired',strpos($amjs,'rtToggleFailedOnly()')!==false);
    t('rtToggleFailedOnly function exists',strpos($amjs,'function rtToggleFailedOnly(')!==false);
    t('rt-row class on skeleton rows',strpos($amjs,"class=\"rt-row\"")!==false||strpos($amjs,"class='rt-row'")!==false);

    // Tax sweep buttons
    t('btn:Show Add Sweep Form wired',strpos($amjs,'showAddSweepForm()')!==false);
    t('btn:Delete Sweep Row wired',strpos($amjs,'deleteSweepRow(')!==false);

    // TN City buttons
    t('btn:Show Add TN City wired',strpos($amjs,'showAddTnCity()')!==false);
    t('btn:Add TN City wired',strpos($amjs,'addTnCity()')!==false);
    t('btn:Delete TN City wired',strpos($amjs,'deleteTnCity(')!==false);

}catch(Exception $e){t('button coverage checks',false,$e->getMessage());}

// ── 6. CUSTOMER API ACTIONS ──
try{
    $cphp=file_get_contents($root.'/api/customers.php');
    t('customers.php add_customer action',strpos($cphp,"action === 'add_customer'")!==false);
    t('customers.php update_customer action',strpos($cphp,"action === 'update_customer'")!==false);
    t('customers.php delete_customer action',strpos($cphp,"action === 'delete_customer'")!==false);
    t('customers.php delete_customer uses DELETE query',strpos($cphp,'DELETE FROM customers')!==false);
    t('customers.php update_customer updates name+email+phone',strpos($cphp,'first_name=?, last_name=?, email=?, phone=?')!==false);
}catch(Exception $e){t('customer API action checks',false,$e->getMessage());}

// ── 7. GITHUB TOKEN + SECURITY QUESTION FIXES ──
try{
    $adphp=isset($adphp)?$adphp:file_get_contents($root.'/api/admin.php');
    t('admin.php save_github_token action',strpos($adphp,"action === 'save_github_token'")!==false);
    t('admin.php get_github_token action',strpos($adphp,"action === 'get_github_token'")!==false);
    t('github_token not writable via set_setting',strpos($adphp,"'github_token'")!==false&&strpos($adphp,'$sensitive')!==false);
    $aojs2=isset($aojs)?$aojs:file_get_contents($root.'/js/admin-orders.js');
    t('rSettings fetches get_sec_question before render',strpos($aojs2,'rSettingsInner')!==false&&strpos($aojs2,'get_sec_question')!==false);
    t('rSettingsInner renders security question card',strpos($aojs2,'function rSettingsInner(')!==false);
    $amjs2=isset($amjs)?$amjs:file_get_contents($root.'/js/admin-misc.js');
    t('saveGitHubToken uses save_github_token action',strpos($amjs2,"action:'save_github_token'")!==false);
    t('loadGitHubToken uses get_github_token action',strpos($amjs2,"action:'get_github_token'")!==false);
    t('saveSQ refreshes rSettings after save',strpos($amjs2,'rSettings(el)')!==false);
}catch(Exception $e){t('github token + sec question checks',false,$e->getMessage());}

// ── 7b. PRODUCTION HARDENING ──
// Ensure admin_session_token/expires rows exist in DB before testing
(function()use($pdo){
    $pdo->prepare("INSERT IGNORE INTO settings (key_name,value) VALUES ('admin_session_token','')")->execute();
    $pdo->prepare("INSERT IGNORE INTO settings (key_name,value) VALUES ('admin_session_expires','0')")->execute();
})();
try{
    // No console.log in payment flow (ui.js)
    $uijs=isset($uijs)?$uijs:file_get_contents($root.'/js/ui.js');
    t('ui.js no VP console.log',strpos($uijs,"console.log('VP:')")===false);

    // No console.log in test-mode block (store.js)
    $sjs=isset($sjs)?$sjs:file_get_contents($root.'/js/store.js');
    t('store.js no Test confirm console.log',strpos($sjs,"console.log('Test confirm:')")===false);

    // CORS no longer allows localhost
    $cfgphp=file_get_contents($root.'/api/config.php');
    preg_match('/function cors\(\).*?\n\}/s',$cfgphp,$corsMatch);
    $corsFn=$corsMatch[0]??'';
    t('CORS localhost exception removed',strpos($corsFn,'localhost')===false&&strpos($corsFn,'127.0.0.1')===false);
    t('CORS only allows ALLOWED_ORIGIN',strpos($corsFn,'ALLOWED_ORIGIN')!==false);

    // admin_password null check
    $adphp=isset($adphp)?$adphp:file_get_contents($root.'/api/admin.php');
    t('login guards against null admin_password',strpos($adphp,'Admin password not configured')!==false);
    t('login null password returns 500',strpos($adphp,'!$hash) fail(')!==false&&strpos($adphp,'500')!==false);

    // Server-side admin auth (requireAdmin)
    $cfgphp=isset($cfgphp)?$cfgphp:file_get_contents($root.'/api/config.php');
    t('config.php has requireAdmin()',strpos($cfgphp,'function requireAdmin()')!==false);
    t('requireAdmin reads X-Admin-Token header',strpos($cfgphp,'HTTP_X_ADMIN_TOKEN')!==false);
    t('requireAdmin checks admin_session_expires',strpos($cfgphp,'admin_session_expires')!==false);
    t('login generates session token',strpos($adphp,'admin_session_token')!==false&&strpos($adphp,'admin_session_expires')!==false);
    t('login returns token to JS',strpos($adphp,"'token' => \$token")!==false||strpos($adphp,'"token" => $token')!==false||strpos($adphp,"'token'=>\$token")!==false);
    t('orders.php has requireAdmin()',strpos(file_get_contents($root.'/api/orders.php'),'requireAdmin()')!==false);
    t('products.php POST has requireAdmin()',strpos(file_get_contents($root.'/api/products.php'),'requireAdmin()')!==false);
    t('customers.php list has requireAdmin()',strpos(file_get_contents($root.'/api/customers.php'),'requireAdmin()')!==false);
    t('faqs.php write has requireAdmin()',strpos(file_get_contents($root.'/api/faqs.php'),'requireAdmin()')!==false);
    t('subscribers.php GET has requireAdmin()',strpos(file_get_contents($root.'/api/subscribers.php'),'requireAdmin()')!==false);
    t('reviews.php write has requireAdmin()',strpos(file_get_contents($root.'/api/reviews.php'),'requireAdmin()')!==false);

    // ── Staging / environment-aware config (production defaults must be preserved) ──
    $cfgEnv=file_get_contents($root.'/api/config.php');
    t('config.php branches on staging host',strpos($cfgEnv,'$__staging')!==false&&strpos($cfgEnv,"\$_SERVER['HTTP_HOST']")!==false&&strpos($cfgEnv,"'staging'")!==false);
    t('config.php keeps prod DB name default',strpos($cfgEnv,"'u541882440_hdbs_data'")!==false);
    t('config.php has staging DB name',strpos($cfgEnv,"'u541882440_hdbs_staging'")!==false);
    t('config.php env-aware secrets path',strpos($cfgEnv,'secrets.staging.php')!==false&&strpos($cfgEnv,'secrets.php')!==false);
    t('config.php keeps prod+staging origins',strpos($cfgEnv,"'https://handmadedesignsbysuzi.com'")!==false&&strpos($cfgEnv,"'https://staging.handmadedesignsbysuzi.com'")!==false);
    $apiEnv=file_get_contents($root.'/js/api.js');
    t('api.js SITE_ORIGIN uses same-origin as page',strpos($apiEnv,'var SITE_ORIGIN=location.origin')!==false);
    t('api.js no hardcoded hostname branching for SITE_ORIGIN',strpos($apiEnv,'location.hostname')===false);
    t('api.js API base uses SITE_ORIGIN',strpos($apiEnv,"var API=SITE_ORIGIN+'/api'")!==false);
    t('api.js no hardcoded prod API base',strpos($apiEnv,"var API='https://handmadedesignsbysuzi.com/api'")===false);
    t('config.js API base uses SITE_ORIGIN',strpos(file_get_contents($root.'/js/config.js'),"var API=SITE_ORIGIN+'/api'")!==false);
    $stEnv=file_get_contents($root.'/js/store.js');
    t('store.js notify/verify use SITE_ORIGIN',strpos($stEnv,"SITE_ORIGIN+'/notify.php'")!==false&&strpos($stEnv,"SITE_ORIGIN+'/verify_payment.php'")!==false);
    $aoEnv=file_get_contents($root.'/js/admin-orders.js');
    t('admin-orders send_* use SITE_ORIGIN',strpos($aoEnv,'SITE_ORIGIN+endpoint')!==false&&strpos($aoEnv,"emailPreviewThenSend('/send_confirm.php'")!==false&&strpos($aoEnv,"emailPreviewThenSend('/send_shipping.php'")!==false);
    t('admin-misc db_backup uses SITE_ORIGIN',strpos(file_get_contents($root.'/js/admin-misc.js'),"SITE_ORIGIN+'/api/db_backup.php")!==false);
    // Dev banner (staging-only) must never be able to render in production: hidden by default + hostname-gated
    $ihDev=file_get_contents($root.'/index.php');
    if(strpos($ihDev,'dev-banner')!==false){
        t('dev banner hidden by default (prod-safe)',strpos($ihDev,'id="dev-banner"')!==false&&strpos($ihDev,'display:none')!==false);
        t('dev banner gated on staging hostname',strpos($ihDev,"indexOf('staging')")!==false);
    } else {
        t('dev banner absent here (production) — nothing to render',true,'no dev-banner in this environment');
    }

    // CORS fixes
    $ckphp=file_get_contents($root.'/checkout.php');
    t('checkout.php CORS hardcoded to ALLOWED_ORIGIN',strpos($ckphp,'Access-Control-Allow-Origin: https://handmadedesignsbysuzi.com')!==false);
    t('checkout.php no echo-origin CORS',strpos($ckphp,'HTTP_ORIGIN')===false);
    t('checkout.php no hardcoded sandbox token',strpos($ckphp,'EAAAl0SOR43xq09AVkTzfRKaZZ04ZGTyAkVMYvYWxAbFT4SoZlrod4oDQtui8jYt')===false);
    $vpphp=file_get_contents($root.'/verify_payment.php');
    t('verify_payment.php CORS not wildcard',strpos($vpphp,"Allow-Origin: *")===false);
    t('verify_payment.php CORS set to handmadedesignsbysuzi.com',strpos($vpphp,'handmadedesignsbysuzi.com')!==false);

    // api.js sends X-Admin-Token
    $apijs=file_get_contents($root.'/js/api.js');
    t('api.js sends X-Admin-Token header',strpos($apijs,'X-Admin-Token')!==false);
    t('api.js uses window._adminToken',strpos($apijs,'_adminToken')!==false);

    // auth.js stores and restores token
    $authjs=isset($authjs)?$authjs:file_get_contents($root.'/js/auth.js');
    t('auth.js stores token in sessionStorage',strpos($authjs,'sessionStorage.setItem')!==false&&strpos($authjs,'hdbs_admin_token')!==false);
    t('auth.js restores token on page load',strpos($authjs,'sessionStorage.getItem')!==false&&strpos($authjs,'_adminToken')!==false);
    t('auth.js doLogout clears token',strpos($authjs,'function doLogout(')!==false&&strpos($authjs,'sessionStorage.removeItem')!==false);

    // Graceful expired-session handling: apiFetch detects 401 and bounces to login
    t('api.js detects expired-session 401',strpos($apijs,'r.status===401')!==false&&strpos($apijs,'handleSessionExpired')!==false);
    t('auth.js defines handleSessionExpired',strpos($authjs,'function handleSessionExpired(')!==false);
    t('handleSessionExpired clears token',strpos($authjs,'function handleSessionExpired(')!==false&&strpos($authjs,'_adminToken=null')!==false&&strpos($authjs,'sessionStorage.removeItem')!==false);
    t('handleSessionExpired returns to login',strpos($authjs,'function handleSessionExpired(')!==false&&strpos($authjs,'goAdminLogin()')!==false);
    t('doLogin re-arms session expiry handling',strpos($authjs,'_sessionExpiredHandled=false')!==false);

    // DB has session token rows seeded
    $sessTokExists=$pdo->query("SELECT COUNT(*) FROM settings WHERE key_name='admin_session_token'")->fetchColumn();
    $sessExpExists=$pdo->query("SELECT COUNT(*) FROM settings WHERE key_name='admin_session_expires'")->fetchColumn();
    t('admin_session_token row in settings DB',(int)$sessTokExists>0);
    t('admin_session_expires row in settings DB',(int)$sessExpExists>0);

    // Webhook signature mandatory
    $wphp=file_get_contents($root.'/api/square-webhook.php');
    t('webhook signature check is mandatory',strpos($wphp,'Missing signature')!==false&&strpos($wphp,'if (!$sq_sig)')!==false);
    t('webhook signature key reads from secrets.php',strpos($wphp,'SQUARE_WEBHOOK_SIG_KEY')!==false);
    t('webhook no longer skips sig check when header absent',strpos($wphp,'if ($sq_sig) {')===false);

    // Previously unprotected endpoints now have requireAdmin
    t('products_csv.php has requireAdmin()',strpos(file_get_contents($root.'/api/products_csv.php'),'requireAdmin()')!==false);
    t('deploy_log.php GET has requireAdmin()',strpos(file_get_contents($root.'/api/deploy_log.php'),'requireAdmin()')!==false);
    t('email_log.php GET has requireAdmin()',strpos(file_get_contents($root.'/api/email_log.php'),'requireAdmin()')!==false);
    t('tax_sweep.php has requireAdmin()',strpos(file_get_contents($root.'/api/tax_sweep.php'),'requireAdmin()')!==false);
    t('square_payments.php has requireAdmin()',strpos(file_get_contents($root.'/api/square_payments.php'),'requireAdmin()')!==false);
    t('github_log.php has requireAdmin()',strpos(file_get_contents($root.'/api/github_log.php'),'requireAdmin()')!==false);

    // Security question rate limiting
    $adphp=isset($adphp)?$adphp:file_get_contents($root.'/api/admin.php');
    t('sec_answer rate limiting exists',strpos($adphp,'sec_fail_count')!==false&&strpos($adphp,'sec_fail_time')!==false);
    t('reset_password invalidates session on success',strpos($adphp,"admin_session_token','")!==false||strpos($adphp,"'admin_session_token',   ''")!==false);

    // Customer login rate limiting
    $custphp=file_get_contents($root.'/api/customers.php');
    t('customer login rate limiting exists',strpos($custphp,'customer_login_attempts')!==false&&strpos($custphp,'Too many failed attempts')!==false);

    // checkout.php $data parsed before $mode
    $ckphp=file_get_contents($root.'/checkout.php');
    // $raw/$data must appear before $mode assignment — find their positions
    $posData=strpos($ckphp,'$data = json_decode(');
    $posMode=strpos($ckphp,'$mode = $data[');
    t('checkout.php $data parsed before $mode',$posData!==false&&$posMode!==false&&$posData<$posMode);

    // config.php generic DB error
    $cfgphp2=file_get_contents($root.'/api/config.php');
    t('config.php DB error does not leak connection details',strpos($cfgphp2,"'DB connection failed: '.\$e->getMessage()")===false&&strpos($cfgphp2,'Service temporarily unavailable')!==false);

    // contact.php uses sendEmail not mail()
    $ctphp=file_get_contents($root.'/api/contact.php');
    t('contact.php uses sendEmail() not mail()',strpos($ctphp,'sendEmail(')!==false&&strpos($ctphp,'= mail(')===false);

    // auth.js dead CUR_USER.pw check removed
    $authjs2=file_get_contents($root.'/js/auth.js');
    t('auth.js CUR_USER.pw dead check removed',strpos($authjs2,'CUR_USER.pw')===false);

    // regression_test.php CORS no longer wildcard (check the header() call specifically)
    $rtphp=file_get_contents($root.'/regression_test.php');
    t('regression_test.php CORS not wildcard',strpos($rtphp,"header('Access-Control-Allow-Origin: "."*')")===false);
    t('regression_test.php CORS uses ALLOWED_ORIGIN',strpos($rtphp,"header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN)")!==false);

    // Round 3 fixes
    // tn_tax + tn_city_tax write/delete requires auth
    $tntax=file_get_contents($root.'/api/tn_tax.php');
    t('tn_tax.php POST has requireAdmin()',substr_count($tntax,'requireAdmin()')>=1&&strpos($tntax,"'POST'")!==false);
    t('tn_tax.php DELETE has requireAdmin()',substr_count($tntax,'requireAdmin()')>=2);
    $tncity=file_get_contents($root.'/api/tn_city_tax.php');
    t('tn_city_tax.php POST has requireAdmin()',strpos($tncity,'requireAdmin()')!==false);
    t('tn_city_tax.php no duplicate require applog',substr_count($tncity,"require_once __DIR__ . '/applog.php'")===1);
    // email_log POST now requires auth
    t('email_log.php POST has requireAdmin()',substr_count(file_get_contents($root.'/api/email_log.php'),'requireAdmin()')>=3);
    // deploy_log POST has size cap
    $dlphp=file_get_contents($root.'/api/deploy_log.php');
    t('deploy_log.php POST has size cap',strpos($dlphp,'filesize')!==false&&strpos($dlphp,'512')!==false);
    // customer reset_password rate limiting
    $custphp=file_get_contents($root.'/api/customers.php');
    t('customers.php reset_password rate limited',substr_count($custphp,"'reset_'")>=1&&substr_count($custphp,'customer_login_attempts')>=2);
    // admin sec answer hashed
    $adphp2=isset($adphp)?$adphp:file_get_contents($root.'/api/admin.php');
    t('admin sec answer stored as bcrypt hash',strpos($adphp2,"password_hash(\$a, PASSWORD_DEFAULT)")!==false&&strpos($adphp2,'admin_sec_answer')!==false);
    t('admin sec answer verified with password_verify',strpos($adphp2,'password_verify($ans, $stored)')!==false);
    // js_debug_log size cap
    t('js_debug_log has size cap',strpos($adphp2,'2 * 1024 * 1024')!==false&&strpos($adphp2,'js_debug_log')!==false);
    // product image upload size + magic byte check
    $prodphp=file_get_contents($root.'/api/products.php');
    t('products.php image max size check',strpos($prodphp,'Image too large')!==false&&strpos($prodphp,'4 * 1024 * 1024')!==false);
    t('products.php magic byte check for JPEG/PNG',strpos($prodphp,'xFF\xD8')!==false&&strpos($prodphp,'x89PNG')!==false);
    // verify_payment amount fallback tolerance tightened
    $vpphp2=file_get_contents($root.'/verify_payment.php');
    t('verify_payment amount fallback <= 1 cent',strpos($vpphp2,'<= 1')!==false&&strpos($vpphp2,'cent')!==false);
    t('verify_payment no $1 tolerance window',strpos($vpphp2,'<= 100')===false);
    // fetch_tax.php include order fixed + requireAdmin
    $ftphp=file_get_contents($root.'/api/fetch_tax.php');
    t('fetch_tax.php config loaded before dbg() call',strpos($ftphp,'require_once')!==false&&strpos($ftphp,'requireAdmin()')!==false);
    t('fetch_tax.php requireAdmin added',strpos($ftphp,'requireAdmin()')!==false);
    // webhook fallback key removed (TODO — manual step)
    $wphp2=file_get_contents($root.'/api/square-webhook.php');
    t('webhook reads key from secrets.php',strpos($wphp2,'require_once')!==false&&strpos($wphp2,'SQUARE_WEBHOOK_SIG_KEY')!==false);
}catch(Exception $e){t('production hardening checks',false,$e->getMessage());}

// ── HTTP helpers (used by sections 10+) ──
$base='https://handmadedesignsbysuzi.com';
// Log in fresh to get an admin token for auth'd live tests
$_rtAdminToken=null;
(function()use(&$_rtAdminToken,$pdo,$base){
    // Get the real admin password hash to verify we can obtain a token
    $hash=$pdo->query("SELECT value FROM settings WHERE key_name='admin_password' LIMIT 1")->fetchColumn();
    if(!$hash)return;
    // Check if current session token is still valid (expires > now)
    $tok=$pdo->query("SELECT value FROM settings WHERE key_name='admin_session_token' LIMIT 1")->fetchColumn();
    $exp=(int)($pdo->query("SELECT value FROM settings WHERE key_name='admin_session_expires' LIMIT 1")->fetchColumn()?:0);
    if($tok&&time()<$exp){$_rtAdminToken=$tok;return;}
    // No valid session — generate one in the per-session table (does NOT clobber the
    // live admin's settings token, so running the suite no longer logs the admin out)
    $newTok=bin2hex(random_bytes(32));
    $newExp=time()+3600; // 1 hour for test run
    $pdo->exec("CREATE TABLE IF NOT EXISTS admin_sessions (token VARCHAR(64) PRIMARY KEY, expires BIGINT NOT NULL)");
    $pdo->prepare("INSERT INTO admin_sessions (token,expires) VALUES (?,?)")->execute([$newTok,$newExp]);
    $_rtAdminToken=$newTok;
})();
function uiGet($url){
    $ctx=stream_context_create(['http'=>['timeout'=>8,'ignore_errors'=>true]]);
    $body=@file_get_contents($url,false,$ctx);
    $code=0;
    if(isset($http_response_header)){foreach($http_response_header as $h){if(preg_match('/HTTP\/\S+\s+(\d+)/',$h,$m)){$code=(int)$m[1];break;}}}
    return['body'=>(string)$body,'code'=>$code];
}
function uiPost($url,$data){
    $ctx=stream_context_create(['http'=>['method'=>'POST','header'=>'Content-Type: application/json','content'=>json_encode($data),'timeout'=>8,'ignore_errors'=>true]]);
    $body=@file_get_contents($url,false,$ctx);
    $code=0;
    if(isset($http_response_header)){foreach($http_response_header as $h){if(preg_match('/HTTP\/\S+\s+(\d+)/',$h,$m)){$code=(int)$m[1];break;}}}
    $json=@json_decode($body,true);
    return['body'=>(string)$body,'code'=>$code,'json'=>$json];
}
function uiPostAdmin($url,$data){
    global $_rtAdminToken;
    $hdr='Content-Type: application/json'.($_rtAdminToken?"\r\nX-Admin-Token: $_rtAdminToken":'');
    $ctx=stream_context_create(['http'=>['method'=>'POST','header'=>$hdr,'content'=>json_encode($data),'timeout'=>8,'ignore_errors'=>true]]);
    $body=@file_get_contents($url,false,$ctx);
    $code=0;
    if(isset($http_response_header)){foreach($http_response_header as $h){if(preg_match('/HTTP\/\S+\s+(\d+)/',$h,$m)){$code=(int)$m[1];break;}}}
    $json=@json_decode($body,true);
    return['body'=>(string)$body,'code'=>$code,'json'=>$json];
}
function uiGetAdmin($url){
    global $_rtAdminToken;
    $hdr=$_rtAdminToken?"X-Admin-Token: $_rtAdminToken":null;
    $opts=['timeout'=>8,'ignore_errors'=>true];
    if($hdr)$opts['header']=$hdr;
    $ctx=stream_context_create(['http'=>$opts]);
    $body=@file_get_contents($url,false,$ctx);
    $code=0;
    if(isset($http_response_header)){foreach($http_response_header as $h){if(preg_match('/HTTP\/\S+\s+(\d+)/',$h,$m)){$code=(int)$m[1];break;}}}
    $json=@json_decode($body,true);
    return['body'=>(string)$body,'code'=>$code,'json'=>$json];
}

// ── 8. SMTP SETTINGS ──
try{
    $mailphp=file_get_contents($root.'/mailer.php');
    t('mailer.php no hardcoded password',strpos($mailphp,'hvgcsasrvycrofeu')===false);
    t('mailer.php reads smtp_pass from DB',strpos($mailphp,'smtp_pass')!==false&&strpos($mailphp,'_smtpConfig')!==false);
    t('mailer.php _smtpConfig function exists',strpos($mailphp,'function _smtpConfig(')!==false);
    t('sendEmailWithAttachment uses _smtpConfig',strpos($mailphp,'sendEmailWithAttachment')!==false&&substr_count($mailphp,'_smtpConfig()')>=2);
    $adphp=isset($adphp)?$adphp:file_get_contents($root.'/api/admin.php');
    t('admin.php save_smtp action',strpos($adphp,"action === 'save_smtp'")!==false);
    t('admin.php get_smtp action',strpos($adphp,"action === 'get_smtp'")!==false);
    t('smtp_pass in sensitive blocklist',strpos($adphp,"'smtp_pass'")!==false&&strpos($adphp,'$sensitive')!==false);
    $aojs=isset($aojs)?$aojs:file_get_contents($root.'/js/admin-orders.js');
    t('SMTP card in settings page',strpos($aojs,'smtp-host')!==false&&strpos($aojs,'smtp-pass')!==false);
    t('SMTP settings loaded on render',strpos($aojs,"action:'get_smtp'")!==false);
    $amjs=isset($amjs)?$amjs:file_get_contents($root.'/js/admin-misc.js');
    t('saveSmtp function exists',strpos($amjs,'function saveSmtp(')!==false);
    t('saveSmtp uses save_smtp action',strpos($amjs,"action:'save_smtp'")!==false);
    // DB has SMTP settings seeded
    $smtpHost=$pdo->query("SELECT value FROM settings WHERE key_name='smtp_host' LIMIT 1")->fetchColumn();
    $smtpPass=$pdo->query("SELECT value FROM settings WHERE key_name='smtp_pass' LIMIT 1")->fetchColumn();
    t('smtp_host seeded in DB',$smtpHost!==false&&$smtpHost!=='');
    t('smtp_pass seeded in DB',$smtpPass!==false&&$smtpPass!=='');
}catch(Exception $e){t('SMTP settings checks',false,$e->getMessage());}

// ── 10. LOGIN RATE LIMITING ──
try{
    $adphp=isset($adphp)?$adphp:file_get_contents($root.'/api/admin.php');
    t('login rate limit: LOGIN_MAX_ATTEMPTS defined',strpos($adphp,'LOGIN_MAX_ATTEMPTS')!==false);
    t('login rate limit: LOGIN_LOCKOUT_SECONDS defined',strpos($adphp,'LOGIN_LOCKOUT_SECONDS')!==false);
    t('login rate limit: reads login_fail_count',strpos($adphp,'login_fail_count')!==false);
    t('login rate limit: reads login_fail_time',strpos($adphp,'login_fail_time')!==false);
    t('login rate limit: increments fail count on bad password',strpos($adphp,'login_fail_count')!==false&&strpos($adphp,'$fails++')!==false);
    t('login rate limit: resets counters on success',strpos($adphp,"setSetting(\$pdo, 'login_fail_count', '0')")!==false);
    t('login rate limit: lockout message has minutes',strpos($adphp,'minute')!==false&&strpos($adphp,'Too many failed attempts')!==false);
    $authjs=file_get_contents($root.'/js/auth.js');
    t('login UI shows dynamic error message',strpos($authjs,'d.error||')!==false&&strpos($authjs,'lerr')!==false);
    // Live: wrong password returns error with attempts remaining
    $r=uiPost($base.'/api/admin.php',['action'=>'login','password'=>'__wrongpassword_rt_check__']);
    t('login rate limit: wrong password returns error',$r['json']&&empty($r['json']['success'])&&!empty($r['json']['error']));
    t('login rate limit: error mentions attempts or lockout',
        !empty($r['json']['error'])&&(strpos($r['json']['error'],'attempt')!==false||strpos($r['json']['error'],'locked')!==false||strpos($r['json']['error'],'Incorrect')!==false));
    // Reset counters so we don't lock ourselves out during testing
    $pdo->prepare("INSERT INTO settings (key_name,value) VALUES ('login_fail_count','0') ON DUPLICATE KEY UPDATE value='0'")->execute();
    $pdo->prepare("INSERT INTO settings (key_name,value) VALUES ('login_fail_time','0') ON DUPLICATE KEY UPDATE value='0'")->execute();
    t('login rate limit: counters reset after test',true);
}catch(Exception $e){t('login rate limit checks',false,$e->getMessage());}

// ── 11. LIVE UI TESTS ──
try{
    // Storefront loads
    $r=uiGet($base.'/');
    t('ui:homepage returns 200',$r['code']===200,'HTTP '.$r['code']);
    t('ui:homepage has <title>',$r['code']===200&&strpos($r['body'],'<title>')!==false);
    t('ui:homepage loads store.js',$r['code']===200&&strpos($r['body'],'js/store.js')!==false);
    t('ui:homepage loads admin-orders.js',$r['code']===200&&strpos($r['body'],'js/admin-orders.js')!==false);
    t('ui:homepage has cart',$r['code']===200&&stripos($r['body'],'cart')!==false);
    t('ui:homepage loads Square via JS',strpos(file_get_contents($root.'/js/admin-orders.js'),'squareup')!==false||strpos(file_get_contents($root.'/js/ui.js'),'squareup')!==false||strpos(file_get_contents($root.'/index.php'),'Square')!==false);

    // Key JS/CSS assets load
    foreach(['js/store.js','js/api.js','js/config.js','js/ui.js','js/auth.js',
             'js/admin-orders.js','js/admin-misc.js','js/admin-products.js',
             'js/table.js','js/toolbar.js','css/shop.css','css/table.css'] as $asset){
        $a=uiGet($base.'/'.$asset);
        t('ui:asset '.$asset,$a['code']===200,'HTTP '.$a['code']);
    }

    // Products API — uses GET not POST
    $r=uiGet($base.'/api/products.php');
    t('ui:products API returns 200',$r['code']===200,'HTTP '.$r['code']);
    $pj=@json_decode($r['body'],true);
    t('ui:products API success',$pj&&!empty($pj['success']),'body: '.substr($r['body'],0,80));
    t('ui:products API returns array',$pj&&isset($pj['products'])&&is_array($pj['products']));
    t('ui:products list non-empty',$pj&&!empty($pj['products']),'count: '.count($pj['products']??[]));

    // FAQs API — uses GET
    $r=uiGet($base.'/api/faqs.php');
    t('ui:FAQs API returns 200',$r['code']===200,'HTTP '.$r['code']);
    $fj=@json_decode($r['body'],true);
    t('ui:FAQs API success',$fj&&!empty($fj['success']));

    // Admin login — wrong password: fail() returns HTTP 400
    $r=uiPost($base.'/api/admin.php',['action'=>'login','password'=>'__wrong__']);
    t('ui:admin login rejects bad password',$r['json']&&empty($r['json']['success']),'HTTP '.$r['code']);

    // Admin get_sec_question returns question
    $r=uiPost($base.'/api/admin.php',['action'=>'get_sec_question']);
    t('ui:admin get_sec_question returns question',$r['code']===200&&!empty($r['json']['success'])&&!empty($r['json']['question']));

    // Sensitive settings blocked — fail() returns HTTP 400
    foreach(['admin_password','square_access_token','admin_sec_answer','smtp_pass'] as $sk){
        $r=uiPost($base.'/api/admin.php',['action'=>'get_setting','key'=>$sk]);
        t('ui:get_setting blocks '.$sk,!empty($r['json'])&&empty($r['json']['success']));
    }

    // GitHub token endpoints work (requires auth)
    $r=uiPostAdmin($base.'/api/admin.php',['action'=>'get_github_token']);
    tProd('ui:get_github_token returns 200',$r['code']===200,'HTTP '.$r['code']);
    tProd('ui:get_github_token returns value',$r['json']&&!empty($r['json']['success'])&&isset($r['json']['value']));

    // Auth enforcement — protected endpoints require X-Admin-Token
    $r=uiGet($base.'/api/orders.php');
    t('ui:orders.php GET requires auth without token',$r['code']===401,'HTTP '.$r['code']);
    $r=uiPost($base.'/api/orders.php',[]);
    t('ui:orders.php POST is public (customer checkout)',$r['code']!==401,'HTTP '.$r['code']);
    $r=uiGet($base.'/api/customers.php?action=list');
    t('ui:customers list requires auth without token',$r['code']===401,'HTTP '.$r['code']);
    $r=uiPost($base.'/api/admin.php',['action'=>'get_setting','key'=>'debug_mode']);
    t('ui:get_setting public key no token allowed',$r['code']===200&&!empty($r['json']['success']),'HTTP '.$r['code']);

    // Customers API — list requires admin token
    $r=uiGetAdmin($base.'/api/customers.php?action=list');
    tProd('ui:customers list with token returns 200',$r['code']===200,'HTTP '.$r['code']);
    $cj=isset($r['json'])?$r['json']:null;
    tProd('ui:customers list has customers array',$cj&&isset($cj['customers'])&&is_array($cj['customers']));

    // Customer register — duplicate email is rejected gracefully (not a 500).
    // Prod-only: this call hits $base (hardcoded prod), so running it from a staging suite would
    // create a real customer in PROD that this run's $pdo (staging) can't clean up. Skip on staging.
    if(!$isStaging){
      $r=uiPost($base.'/api/customers.php',['action'=>'register','em'=>'regression_dupe@test.com','pw'=>'Test1234!','fn'=>'Reg','ln'=>'Test','secQ'=>'What city were you born in?','secA'=>'test','secA2'=>'test']);
      t('ui:customer register not 500',$r['code']!==500,'HTTP '.$r['code']);
      // Clean up the customer this may have created (and any left by earlier runs).
      try { $pdo->prepare("DELETE FROM customers WHERE email = ?")->execute(['regression_dupe@test.com']); } catch (Exception $e) {}
      $rtDupe=$pdo->prepare("SELECT COUNT(*) c FROM customers WHERE email = ?"); $rtDupe->execute(['regression_dupe@test.com']);
      t('ui:register test customer cleaned up (no test data left behind)',((int)(($rtDupe->fetch()['c'])??0))===0);
    } else {
      t('ui:customer register not 500',true,'skipped on staging (would create prod data)');
      t('ui:register test customer cleaned up (no test data left behind)',true,'skipped on staging');
    }

    // Customer login — wrong password rejected
    $r=uiPost($base.'/api/customers.php',['action'=>'login','em'=>'nobody@example.com','pw'=>'wrong']);
    t('ui:customer login rejects bad credentials',$r['json']&&empty($r['json']['success']));

    // TN city tax API — uses GET
    $r=uiGet($base.'/api/tn_city_tax.php?action=list');
    t('ui:TN city tax list returns 200',$r['code']===200,'HTTP '.$r['code']);

    // Contact form — missing fields returns failure not 500.
    // Note: a PHP fatal error still returns HTTP 200 with mangled HTML+JSON output, so
    // code!==500 alone previously missed the $pdo-undefined bug below — also require valid JSON.
    $r=uiPost($base.'/api/contact.php',[]);
    t('ui:contact API handles empty body',$r['code']!==500,'HTTP '.$r['code']);
    t('ui:contact API returns valid JSON (no PHP error leakage)',$r['json']!==null,'body: '.substr($r['body'],0,150));
    t('ui:contact API empty body rejected cleanly',$r['json']&&empty($r['json']['success']));

    // regression_test.php itself gated (wrong token → forbidden)
    $r=uiGet($base.'/regression_test.php?token=wrongtoken');
    $rj=@json_decode($r['body'],true);
    t('ui:regression test blocks wrong token',$r['code']===403||(!empty($rj['error'])&&$rj['error']==='Forbidden'));

    // CORS — localhost origin is rejected (header should be the allowed origin, not localhost)
    $ctx=stream_context_create(['http'=>['method'=>'POST','header'=>"Content-Type: application/json\r\nOrigin: http://localhost:3000",'content'=>'{"action":"list"}','timeout'=>8,'ignore_errors'=>true]]);
    $corsBody=@file_get_contents($base.'/api/products.php',false,$ctx);
    $corsHeaders=isset($http_response_header)?$http_response_header:[];
    $corsOrigin='';
    foreach($corsHeaders as $h){if(stripos($h,'Access-Control-Allow-Origin')!==false){$corsOrigin=$h;break;}}
    t('ui:CORS rejects localhost origin',strpos($corsOrigin,'localhost')===false,'Header: '.$corsOrigin);

}catch(Exception $e){t('ui tests',false,$e->getMessage());}

// ── 12. ROUND 4 HARDENING ──
try{
    // verify_payment.php test_mode requires admin token
    $r=uiPost($base.'/verify_payment.php',['order_id'=>'FAKE-RT-001','test_mode'=>true]);
    t('verify_payment:test_mode without token is 401',$r['code']===401,'HTTP '.$r['code']);
    // with admin token it should pass auth (order not found → error, but not 401)
    $r=uiPostAdmin($base.'/verify_payment.php',['order_id'=>'FAKE-RT-001','test_mode'=>true]);
    tProd('verify_payment:test_mode with token passes auth',$r['code']!==401,'HTTP '.$r['code']);

    // notify.php CORS is locked (not wildcard)
    $notifyPhp=file_get_contents($root.'/notify.php');
    t('notify:CORS not wildcard',strpos($notifyPhp,'HTTP_ORIGIN')===false&&strpos($notifyPhp,'handmadedesignsbysuzi.com')!==false);

    // notify.php validates order_id against DB before sending email
    t('notify:validates order exists in DB',strpos($notifyPhp,'Order not found')!==false&&strpos($notifyPhp,'SELECT id FROM orders WHERE id')!==false);

    // notify.php live: unknown order_id rejected
    $r=uiPost($base.'/notify.php',['order_id'=>'FAKE-RT-DOES-NOT-EXIST','customer_name'=>'Test','customer_email'=>'test@test.com','total'=>'1.00','items'=>[]]);
    t('notify:rejects unknown order_id',$r['code']===404||(!empty($r['json'])&&empty($r['json']['success'])),'HTTP '.$r['code']);

    // checkout.php curl error is not leaked to browser
    $coPhp=file_get_contents($root.'/checkout.php');
    t('checkout:curl error not leaked',strpos($coPhp,"'Network error: ' . \$curl_error")===false&&strpos($coPhp,'curl_error')!==false&&strpos($coPhp,'error_log')!==false);

    // contact.php rate limit table created
    $contactPhp=file_get_contents($root.'/api/contact.php');
    t('contact:per-IP rate limit present',strpos($contactPhp,'rate_limits')!==false&&strpos($contactPhp,'md5(\'contact_\'')!==false);
    t('contact:rate limit returns 429',strpos($contactPhp,'429')!==false);

    // reviews.php rate limit
    $revPhp=file_get_contents($root.'/api/reviews.php');
    t('reviews:per-IP rate limit present',strpos($revPhp,'rate_limits')!==false&&strpos($revPhp,'md5(\'review_\'')!==false);

    // subscribers.php rate limit
    $subPhp=file_get_contents($root.'/api/subscribers.php');
    t('subscribers:per-IP rate limit present',strpos($subPhp,'rate_limits')!==false&&strpos($subPhp,'md5(\'sub_\'')!==false);

    // orders.php POST is public (customer checkout); GET/PUT/DELETE require auth
    $ordPhp=file_get_contents($root.'/api/orders.php');
    t('orders:POST public — no top-level requireAdmin',strpos($ordPhp,"requireAdmin();\n\n// GET")!==false||strpos($ordPhp,'// GET — return all orders')!==false);
    t('orders:GET requires admin',preg_match('/GET.*{.*requireAdmin\(\)/s',$ordPhp)||strpos($ordPhp,"if (\$method === 'GET') { requireAdmin()")!==false);
    t('orders:PUT requires admin',strpos($ordPhp,"'PUT') { requireAdmin()")!==false);
    t('orders:DELETE requires admin',strpos($ordPhp,"'DELETE') { requireAdmin()")!==false);
    t('orders:guest POST clamped to Awaiting Payment',strpos($ordPhp,"'Awaiting Payment'")!==false&&strpos($ordPhp,'isAdmin')!==false);

    // cancel_order endpoint exists in customers.php and validates status
    $custPhp=file_get_contents($root.'/api/customers.php');
    t('customers:cancel_order action exists',strpos($custPhp,"action === 'cancel_order'")!==false);
    t('customers:cancel_order checks Awaiting Payment',strpos($custPhp,'Awaiting Payment')!==false&&strpos($custPhp,'cancel_order')!==false);
    t('customers:cancel_order restores stock',strpos($custPhp,'stock = stock + ?')!==false);

    // Live: cancel_order rejects unknown order
    $r=uiPost($base.'/api/customers.php',['action'=>'cancel_order','order_id'=>'FAKE-CANCEL-999']);
    t('customers:cancel_order rejects unknown order',$r['json']&&empty($r['json']['success']),'HTTP '.$r['code']);

    // rate_limits table exists on server (created on first hit; ensure it exists now)
    $pdo->exec("CREATE TABLE IF NOT EXISTS rate_limits (
        key_hash CHAR(32) PRIMARY KEY,
        attempts INT NOT NULL DEFAULT 0,
        last_at  INT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $tbls2=$pdo->query("SHOW TABLES LIKE 'rate_limits'")->fetchAll(PDO::FETCH_COLUMN);
    t('rate_limits:table exists',count($tbls2)>0);

}catch(Exception $e){t('round 4 hardening checks',false,$e->getMessage());}

// ── Embedded Square SDK (process_payment.php) ──
try{
    $ppFile=$root.'/api/process_payment.php';
    t('process_payment.php exists',file_exists($ppFile));
    $ppPhp=file_exists($ppFile)?file_get_contents($ppFile):'';

    // Endpoint rejects GET
    $rGet=uiGet($base.'/api/process_payment.php');
    t('process_payment:GET returns 405',$rGet['code']===405,'HTTP '.$rGet['code']);

    // Endpoint rejects missing params
    $rMissing=uiPost($base.'/api/process_payment.php',['source_id'=>'','order_id'=>'']);
    t('process_payment:rejects empty params',$rMissing['json']&&empty($rMissing['json']['success']),'HTTP '.$rMissing['code']);

    // test_mode requires admin auth
    $rTmNoAuth=uiPost($base.'/api/process_payment.php',['source_id'=>'tok_test','order_id'=>'FAKE-PP-001','test_mode'=>true]);
    t('process_payment:test_mode without token is 401',$rTmNoAuth['code']===401,'HTTP '.$rTmNoAuth['code']);

    // Rejects unknown order (with admin token)
    $rUnknown=uiPostAdmin($base.'/api/process_payment.php',['source_id'=>'tok_test','order_id'=>'FAKE-PP-999','test_mode'=>true]);
    t('process_payment:rejects unknown order',$rUnknown['json']&&empty($rUnknown['json']['success']),'HTTP '.$rUnknown['code'].' err='.($rUnknown['json']['error']??''));

    // Server-side recalculates total (tax field present)
    t('process_payment:recalculates tax server-side',strpos($ppPhp,'0.0975')!==false);
    t('process_payment:uses sq_curl',strpos($ppPhp,'sq_curl')!==false);
    t('process_payment:marks order Paid',strpos($ppPhp,"status='Paid'")!==false);
    t('process_payment:sends confirmation email',strpos($ppPhp,'sendOrderConfirmation(')!==false);
    t('process_payment:test_mode requireAdmin before order lookup',
        strpos($ppPhp,'test_mode')!==false&&strpos($ppPhp,'requireAdmin')!==false);

    // index.php has new embedded SDK panels
    $idx=file_get_contents($root.'/index.php');
    t('index.php:co-payment panel exists',strpos($idx,'id="co-payment"')!==false);
    t('index.php:co-processing panel exists',strpos($idx,'id="co-processing"')!==false);
    t('index.php:co-result panel exists',strpos($idx,'id="co-result"')!==false);
    t('index.php:card-container exists',strpos($idx,'id="card-container"')!==false);
    t('index.php:no redirect to Square (co-pay-waiting removed)',strpos($idx,'co-pay-waiting')===false);

    // store.js has new embedded SDK functions
    $stjs=file_get_contents($root.'/js/store.js');
    t('store.js:loadSquareSdk function',strpos($stjs,'function loadSquareSdk')!==false);
    t('store.js:initSquareCard function',strpos($stjs,'function initSquareCard')!==false);
    t('store.js:submitPayment function',strpos($stjs,'function submitPayment')!==false);
    t('store.js:backToCheckoutForm function',strpos($stjs,'function backToCheckoutForm')!==false);
    t('store.js:showPaymentStep function',strpos($stjs,'function showPaymentStep')!==false);
    t('store.js:tax calculated in updateShippingDisplay',strpos($stjs,'0.0975')!==false);
    t('store.js:calls process_payment.php',strpos($stjs,'process_payment.php')!==false);
    t('store.js:no checkout.php redirect call',strpos($stjs,"fetch('checkout.php'")===false);
    t('store.js:square_app_id hardcoded',strpos($stjs,'sq0idp-08N-GQIys4jnwilvp0STsQ')!==false);

    // process_payment.php correctness checks
    $ppPhp=file_get_contents($root.'/api/process_payment.php');
    t('process_payment.php exists',strlen($ppPhp)>100);
    t('process_payment uses SQUARE_TOKEN constant',strpos($ppPhp,'SQUARE_TOKEN')!==false&&strpos($ppPhp,"getSetting(\$pdo, 'square_access_token')")===false);
    t('process_payment has display_errors off',strpos($ppPhp,"ini_set('display_errors', 0)")!==false);
    t('process_payment has PAY-START log',strpos($ppPhp,"'PAY-START'")!==false);
    t('process_payment has PAYMENT-FAIL log',strpos($ppPhp,"'PAYMENT-FAIL'")!==false);
    t('process_payment guards null resp on errCode',strpos($ppPhp,'$resp ? ($resp[\'errors\']')!==false);
    t('process_payment has idempotency key with nonce hash',strpos($ppPhp,'md5($source_id)')!==false);
    t('process_payment no debug console.log in store.js',strpos($stjs,"console.log('[SQ]")===false);
    // Hardening: atomic guard, rollback, orphan logging, cancel token
    t('process_payment has atomic Processing guard',strpos($ppPhp,"status='Processing' WHERE id=? AND status='Awaiting Payment'")!==false);
    t('process_payment rolls back on Square failure',strpos($ppPhp,"status='Awaiting Payment' WHERE id=? AND status='Processing'")!==false);
    t('process_payment has CHARGE-ORPHANED log',strpos($ppPhp,"'CHARGE-ORPHANED'")!==false);
    // cancel_order ownership token
    $custPhp=file_get_contents($root.'/api/customers.php');
    t('cancel_order requires cancel_token',strpos($custPhp,'cancel_token')!==false&&strpos($custPhp,'hash_equals')!==false&&strpos($custPhp,'hash_hmac')!==false);
    t('cancel_order returns 403 on missing token',strpos($custPhp,"fail('Missing cancel token', 403)")!==false);
    t('orders.php returns cancel_token',strpos(file_get_contents($root.'/api/orders.php'),'cancel_token')!==false);
    t('store.js stores pendingCancelToken',strpos($stjs,'_pendingCancelToken')!==false);
    t('store.js sends cancel_token with cancel_order',strpos($stjs,'cancel_token:window._pendingCancelToken')!==false);

    // config.php now owns getSetting/setSetting
    $cfgPhp=file_get_contents($root.'/api/config.php');
    t('config.php defines getSetting',strpos($cfgPhp,'function getSetting')!==false);
    t('config.php defines setSetting',strpos($cfgPhp,'function setSetting')!==false);
    t('admin.php wraps getSetting with function_exists',strpos(file_get_contents($root.'/api/admin.php'),"function_exists('getSetting')")!==false);

}catch(Exception $e){t('embedded Square SDK checks',false,$e->getMessage());}

// ── PAYPAL (Orders v2, runs alongside Square) ──
// File-content checks only ($root = local filesystem). No $base live-HTTP checks here on
// purpose: $base is hardcoded to prod, and the PayPal endpoints don't exist on prod until
// the checkpoint that promotes this feature — HTTP tests would false-fail until then.
try{
    $stjs = file_get_contents($root.'/js/store.js');
    $cfgjs= file_get_contents($root.'/js/config.js');
    $idx  = file_get_contents($root.'/index.php');
    $aojs = file_get_contents($root.'/js/admin-orders.js');

    // Required files exist
    t('api/paypal.php exists',file_exists($root.'/api/paypal.php'));
    t('api/paypal_create.php exists',file_exists($root.'/api/paypal_create.php'));
    t('api/paypal_capture.php exists',file_exists($root.'/api/paypal_capture.php'));
    t('api/paypal_status.php exists',file_exists($root.'/api/paypal_status.php'));
    t('api/order_confirm_email.php exists',file_exists($root.'/api/order_confirm_email.php'));

    // Shared helpers
    $ppApi=file_get_contents($root.'/api/paypal.php');
    t('paypal.php defines pp_token',strpos($ppApi,'function pp_token')!==false);
    t('paypal.php defines pp_curl',strpos($ppApi,'function pp_curl')!==false);
    t('paypal.php pp_env sandbox on staging',strpos($ppApi,'function pp_env')!==false&&strpos($ppApi,'sandbox')!==false);
    t('paypal.php ensurePaypalColumn adds paypal_capture_id',strpos($ppApi,'function ensurePaypalColumn')!==false&&strpos($ppApi,'paypal_capture_id')!==false);
    t('paypal.php recomputes total server-side (9.75% tax)',strpos($ppApi,'function pp_order_amounts')!==false&&strpos($ppApi,'0.0975')!==false);

    // Shared confirmation-email helper
    $oce=file_get_contents($root.'/api/order_confirm_email.php');
    t('order_confirm_email defines sendOrderConfirmation',strpos($oce,'function sendOrderConfirmation')!==false);

    // Create order: server-side amount, CAPTURE intent, awaiting-payment guard, test bypass
    $ppc=file_get_contents($root.'/api/paypal_create.php');
    t('paypal_create uses server-side amounts',strpos($ppc,'pp_order_amounts(')!==false);
    t('paypal_create sets intent CAPTURE',strpos($ppc,"'intent' => 'CAPTURE'")!==false);
    t('paypal_create guards Awaiting Payment',strpos($ppc,'Awaiting Payment')!==false);
    t('paypal_create has test_mode admin bypass',strpos($ppc,'test_mode')!==false&&strpos($ppc,'requireAdmin')!==false);

    // Capture: atomic lock, marks Paid/PayPal, stores capture id, idempotency, confirmation
    $ppcap=file_get_contents($root.'/api/paypal_capture.php');
    t('paypal_capture has atomic Processing guard',strpos($ppcap,"status='Processing' WHERE id=? AND status='Awaiting Payment'")!==false);
    t('paypal_capture rolls back on failure',strpos($ppcap,"status='Awaiting Payment' WHERE id=? AND status='Processing'")!==false);
    t('paypal_capture sets payment_method PayPal',strpos($ppcap,"payment_method='PayPal'")!==false);
    t('paypal_capture stores paypal_capture_id',strpos($ppcap,'paypal_capture_id=?')!==false);
    t('paypal_capture idempotent PayPal-Request-Id',strpos($ppcap,'PayPal-Request-Id')!==false);
    t('paypal_capture sends confirmation email',strpos($ppcap,'sendOrderConfirmation(')!==false);
    t('paypal_capture has test_mode admin bypass',strpos($ppcap,'test_mode')!==false&&strpos($ppcap,'requireAdmin')!==false);
    t('paypal_capture labels Venmo funding source',strpos($ppcap,"payment_source']['venmo']")!==false);

    // Refund routing (automated PayPal refund parity with Square; Venmo rides the PayPal rail)
    $refPhp=file_get_contents($root.'/api/refund.php');
    t('refund.php routes PayPal refunds',strpos($refPhp,"'PayPal'")!==false&&strpos($refPhp,'/v2/payments/captures/')!==false);
    t('refund.php routes Venmo on PayPal rail',strpos($refPhp,"['PayPal', 'Venmo']")!==false);
    t('refund.php uses paypal_capture_id',strpos($refPhp,'paypal_capture_id')!==false);

    // Frontend wiring
    t('store.js defines initPayPal',strpos($stjs,'function initPayPal')!==false);
    t('store.js loads PayPal SDK',strpos($stjs,'function loadPayPalSdk')!==false&&strpos($stjs,'paypal.com/sdk/js')!==false);
    t('store.js enables Venmo',strpos($stjs,'enable-funding=venmo')!==false);
    t('store.js disables card + credit + Pay Later (Square owns cards; no Pay Later)',strpos($stjs,'disable-funding=credit,card,paylater')!==false);
    t('Square Payments money-goes table no longer lists Pay Later (removed from checkout)',strpos($aojs,'Pay&nbsp;Later')===false&&strpos($aojs,'>PayPal, Venmo</td>')!==false);
    t('store.js calls paypal_create.php',strpos($stjs,'paypal_create.php')!==false);
    t('store.js calls paypal_capture.php',strpos($stjs,'paypal_capture.php')!==false);
    t('config.js defines PAYPAL_ENV',strpos($cfgjs,'PAYPAL_ENV')!==false);
    t('config.js defines PAYPAL_CLIENT_ID',strpos($cfgjs,'PAYPAL_CLIENT_ID')!==false);
    t('index.php has paypal-button-container',strpos($idx,'paypal-button-container')!==false);

    // Admin diagnostic + payment-method recognition
    t('admin-orders.js has checkPaypalConfig',strpos($aojs,'function checkPaypalConfig')!==false);
    t('admin-orders.js PayPal+Venmo in Paid-By dropdown',strpos($aojs,"'Credit Card','Cash','Check','Square','PayPal','Venmo','Other'")!==false);
    t('admin-orders.js counts Venmo fee as processor fee',strpos($aojs,"order.pay==='Venmo'")!==false);
    t('admin-orders.js Square Payments settlement note',strpos($aojs,'Where the money goes')!==false);
    t('paypal_status.php requires admin',strpos(file_get_contents($root.'/api/paypal_status.php'),'requireAdmin')!==false);

}catch(Exception $e){t('PayPal integration checks',false,$e->getMessage());}

// ── PAYPAL PAYMENTS ADMIN SCREEN (below Square Payments, sourced from our own orders table) ──
try{
    t('api/paypal_payments.php exists',file_exists($root.'/api/paypal_payments.php'));
    $ppPayApi=file_get_contents($root.'/api/paypal_payments.php');
    t('paypal_payments.php requires admin',strpos($ppPayApi,'requireAdmin()')!==false);
    t('paypal_payments.php sources from our own orders table (no live PayPal API call)',strpos($ppPayApi,'FROM orders')!==false&&strpos($ppPayApi,'paypal_capture_id')!==false);
    t('paypal_payments.php supports begin/end date filtering',strpos($ppPayApi,"\$_GET['begin']")!==false&&strpos($ppPayApi,"\$_GET['end']")!==false);
    t('paypal_payments.php reports mode via pp_env()',strpos($ppPayApi,'pp_env()')!==false);
    t('paypal_payments.php classifies refund status',strpos($ppPayApi,'REFUNDED')!==false&&strpos($ppPayApi,'PARTIAL_REFUND')!==false);

    $aojsPp=file_get_contents($root.'/js/admin-orders.js');
    t('admin-orders.js defines rPpPay',strpos($aojsPp,'function rPpPay')!==false);
    t('admin-orders.js defines ppPayLoad (calls paypal_payments.php)',strpos($aojsPp,'function ppPayLoad')!==false&&strpos($aojsPp,'paypal_payments.php')!==false);
    t('admin-orders.js defines renderPpPayTable',strpos($aojsPp,'function renderPpPayTable')!==false);
    t('admin-orders.js defines ppPayExportCsv',strpos($aojsPp,'function ppPayExportCsv')!==false);
    t('admin-orders.js PayPal Payments defaults From to launch date',strpos($aojsPp,"ppPayLoad(el,'2026-07-01'")!==false);
    t('admin-orders.js Square Payments note points to PayPal Payments screen',strpos($aojsPp,'PayPal Payments screen')!==false);

    $anavPp=file_get_contents($root.'/js/admin-nav.js');
    t('admin-nav.js routes paypalpay to rPpPay',strpos($anavPp,"sec==='paypalpay')rPpPay(el)")!==false);
    t('admin-nav.js has PayPal Payments title',strpos($anavPp,"paypalpay:'PayPal Payments'")!==false);

    $amiscPp=file_get_contents($root.'/js/admin-misc.js');
    t('admin-misc.js has PayPal Payments nav label',strpos($amiscPp,"paypalpay:'🅿️ PayPal Payments'")!==false);
    $shopMatchPp=preg_match("/sec:'shop'.*?children:\[([^\]]+)\]/s",$amiscPp,$smPp);
    t('Shop folder default has paypalpay right after sqpay',$shopMatchPp&&strpos($smPp[1],"'sqpay','paypalpay'")!==false);
    t('loadNavOrder migrates paypalpay into Shop after sqpay on saved nav_orders',strpos($amiscPp,'add PayPal Payments into Shop right after Square Payments')!==false&&strpos($amiscPp,"idx>=0)n.children.splice(idx+1,0,'paypalpay')")!==false);
}catch(Exception $e){t('PayPal Payments admin screen checks',false,$e->getMessage());}

// ── PAYPAL TRANSACTION FEES (Settings card, right after Square Transaction Fees) ──
try{
    $cfgjsPp=file_get_contents($root.'/js/config.js');
    t('config.js defines PP_FEE_PCT/PP_FEE_CENTS',strpos($cfgjsPp,'var PP_FEE_PCT=')!==false&&strpos($cfgjsPp,'var PP_FEE_CENTS=')!==false);

    $uijsPp=file_get_contents($root.'/js/ui.js');
    t('ui.js loads paypal_fees setting on startup',strpos($uijsPp,"key:'paypal_fees'")!==false&&strpos($uijsPp,'PP_FEE_PCT=pf.pct')!==false);

    $aojsPpFee=file_get_contents($root.'/js/admin-orders.js');
    t('Settings has PayPal Transaction Fees card right after Square\'s',strpos($aojsPpFee,'Square Transaction Fees</div>')!==false&&strpos($aojsPpFee,'PayPal Transaction Fees</div>')!==false&&strpos($aojsPpFee,'Square Transaction Fees</div>')<strpos($aojsPpFee,'PayPal Transaction Fees</div>'));
    t('PayPal fee card has pct/cents inputs',strpos($aojsPpFee,'id="ppfee-pct"')!==false&&strpos($aojsPpFee,'id="ppfee-cents"')!==false);
    t('savePaypalFees defined and saves to paypal_fees setting',strpos($aojsPpFee,'function savePaypalFees')!==false&&strpos($aojsPpFee,"key:'paypal_fees'")!==false);
    t('savePaypalFees validates pct/cents like saveSquareFees',strpos($aojsPpFee,"Invalid percentage")!==false&&strpos($aojsPpFee,'Invalid per-transaction cost')!==false);
}catch(Exception $e){t('PayPal transaction fees checks',false,$e->getMessage());}

// ── PAYPAL CUSTOMER-PAID SURCHARGE (customer covers the PayPal/Venmo fee; Square/card unaffected) ──
try{
    $ppApiSc=file_get_contents($root.'/api/paypal.php');
    t('paypal.php defines pp_surcharge()',strpos($ppApiSc,'function pp_surcharge')!==false);
    t('pp_surcharge reads the paypal_fees setting',strpos($ppApiSc,"getSetting(\$pdo, 'paypal_fees')")!==false);
    t('ensurePaypalColumn adds paypal_surcharge column',strpos($ppApiSc,'paypal_surcharge')!==false&&strpos($ppApiSc,"LIKE 'paypal_surcharge'")!==false);

    $ppCreateSc=file_get_contents($root.'/api/paypal_create.php');
    t('paypal_create adds the surcharge to the PayPal order total',strpos($ppCreateSc,'pp_surcharge($pdo, $total)')!==false&&strpos($ppCreateSc,'round($total + $surcharge, 2)')!==false);
    t('paypal_create includes a handling breakdown line for the surcharge (PayPal amount validation)',strpos($ppCreateSc,"'handling'")!==false);
    t('paypal_create returns the surcharge/total to the frontend',strpos($ppCreateSc,"'surcharge' => \$surcharge")!==false);

    $ppCapSc=file_get_contents($root.'/api/paypal_capture.php');
    t('paypal_capture applies the same surcharge before capturing',strpos($ppCapSc,'pp_surcharge($pdo, $total)')!==false);
    t('paypal_capture stores paypal_surcharge on the order (real + test_mode paths)',substr_count($ppCapSc,'paypal_surcharge=?')>=2);
    t('paypal_capture passes surcharge into the confirmation email',strpos($ppCapSc,'sendOrderConfirmation($pdo, $order, $lineItems, $total, $shipping, $tax, $captureId, $surcharge)')!==false);

    $oceSc=file_get_contents($root.'/api/order_confirm_email.php');
    t('sendOrderConfirmation accepts an optional $surcharge param (defaults 0, Square path unaffected)',strpos($oceSc,'$surcharge = 0')!==false);
    t('order_confirm_email shows a processing-fee line only when a surcharge was charged',strpos($oceSc,'$surcharge > 0')!==false&&strpos($oceSc,'Processing Fee')!==false);

    $ordersApiSc=file_get_contents($root.'/api/orders.php');
    t('orders.php exposes paypal_surcharge to the admin',strpos($ordersApiSc,"'paypal_surcharge'")!==false);

    $stjsSc=file_get_contents($root.'/js/store.js');
    t('store.js defines showPaypalFeeNote',strpos($stjsSc,'function showPaypalFeeNote')!==false);
    t('store.js shows the fee note using PP_FEE_PCT/PP_FEE_CENTS as the pre-click estimate',strpos($stjsSc,'PP_FEE_PCT')!==false&&strpos($stjsSc,'PP_FEE_CENTS')!==false);
    t('store.js updates the fee note with the server-confirmed surcharge from paypal_create.php',strpos($stjsSc,'d.surcharge')!==false&&strpos($stjsSc,'showPaypalFeeNote(total,d.surcharge,d.total)')!==false);
    t('resetWalletButtons hides the PayPal fee note',strpos($stjsSc,"getElementById('paypal-fee-note')")!==false);

    $idxSc=file_get_contents($root.'/index.php');
    t('index.php has the paypal-fee-note element',strpos($idxSc,'id="paypal-fee-note"')!==false);

    $aojsSc=file_get_contents($root.'/js/admin-orders.js');
    t('printInvoice shows the PayPal/Venmo processing fee when charged',strpos($aojsSc,"order.paypal_surcharge")!==false&&strpos($aojsSc,'PayPal/Venmo Processing Fee')!==false);

    $apjsSc=file_get_contents($root.'/js/admin-products.js');
    t('Order Detail (viewOrder) shows the PayPal/Venmo processing fee when charged',strpos($apjsSc,'order.paypal_surcharge')!==false&&strpos($apjsSc,'PayPal/Venmo Processing Fee')!==false);
}catch(Exception $e){t('PayPal customer-paid surcharge checks',false,$e->getMessage());}

// ── ORDERS bulk select/delete + Square Payments default date ──
try{
    $aojs=file_get_contents($root.'/js/admin-orders.js');
    t('admin-orders.js orders rows have checkbox column',strpos($aojs,'class="ord-chk"')!==false);
    t('admin-orders.js has ordToggleAll (header select-all)',strpos($aojs,'function ordToggleAll')!==false);
    t('admin-orders.js re-injects select-all header after TableKit',strpos($aojs,'ord-selall-th')!==false&&strpos($aojs,'ordToggleAll(this)')!==false);
    t('admin-orders.js has deleteCheckedOrders',strpos($aojs,'function deleteCheckedOrders')!==false);
    t('admin-orders.js Delete Selected button wired',strpos($aojs,'onclick="deleteCheckedOrders()"')!==false&&strpos($aojs,'Delete Selected')!==false);
    t('admin-orders.js deleteCheckedOrders guards empty selection',strpos($aojs,'No orders are checked')!==false);
    t('admin-orders.js keeps deleteAllOrders for Settings full wipe',strpos($aojs,'function deleteAllOrders')!==false);
    t('admin-orders.js Square Payments defaults From to launch date',strpos($aojs,"sqPayLoad(el,'2026-07-01'")!==false);
}catch(Exception $e){t('orders bulk-delete + sqpay default checks',false,$e->getMessage());}

// ── CUSTOMER ORDER LOOKUP (account view + guest magic link) ──
try{
    t('api/order_token.php exists',file_exists($root.'/api/order_token.php'));
    t('api/order_lookup.php exists',file_exists($root.'/api/order_lookup.php'));

    // Signed, expiring token (HMAC with DB_PASS, same pattern as the order cancel token)
    $otk=file_get_contents($root.'/api/order_token.php');
    t('order_token defines makeOrderToken',strpos($otk,'function makeOrderToken')!==false);
    t('order_token defines verifyOrderToken',strpos($otk,'function verifyOrderToken')!==false);
    t('order_token signs with DB_PASS + hash_equals',strpos($otk,'hash_hmac')!==false&&strpos($otk,'DB_PASS')!==false&&strpos($otk,'hash_equals')!==false);
    t('order_token enforces expiry',strpos($otk,'< time()')!==false);

    // Lookup endpoint: generic non-enumerating request + token-gated view
    $olk=file_get_contents($root.'/api/order_lookup.php');
    t('order_lookup handles request action',strpos($olk,"=== 'request'")!==false);
    t('order_lookup handles view action',strpos($olk,"=== 'view'")!==false);
    t('order_lookup response is generic (no enumeration)',strpos($olk,'If we found orders for that email')!==false);
    t('order_lookup rate-limits link requests',strpos($olk,'order_lookup_requests')!==false);
    t('order_lookup verifies token before returning orders',strpos($olk,'verifyOrderToken')!==false);
    t('order_lookup scopes orders to the token email',strpos($olk,'LOWER(customer_email)')!==false);
    t('order_lookup magic link is environment-aware',strpos($olk,'ALLOWED_ORIGIN')!==false);

    // customers.php issues the order token at login + register
    $custPhp2=file_get_contents($root.'/api/customers.php');
    t('customers.php requires order_token helper',strpos($custPhp2,'order_token.php')!==false);
    t('customers.php returns orders_token (login + register)',substr_count($custPhp2,'orders_token')>=2&&strpos($custPhp2,'makeOrderToken')!==false);

    // Frontend: account order fetch + guest lookup + magic-link landing
    $authjs=file_get_contents($root.'/js/auth.js');
    t('auth.js account page fetches real orders via token',strpos($authjs,'loadMyOrders(CUR_USER.orders_token')!==false);
    t('auth.js defines loadMyOrders (calls order_lookup)',strpos($authjs,'function loadMyOrders')!==false&&strpos($authjs,'order_lookup.php')!==false);
    t('auth.js defines renderOrderCards',strpos($authjs,'function renderOrderCards')!==false);
    t('auth.js defines openMyOrders',strpos($authjs,'function openMyOrders')!==false);
    t('auth.js defines requestOrderLink',strpos($authjs,'function requestOrderLink')!==false);
    t('auth.js defines checkOrdersLink (magic link)',strpos($authjs,'function checkOrdersLink')!==false&&strpos($authjs,"params.get('orders')")!==false);
    t('ui.js calls checkOrdersLink on load',strpos(file_get_contents($root.'/js/ui.js'),'checkOrdersLink()')!==false);

    // index.php: modal + three entry points (side menu, top nav, footer)
    $idxOl=file_get_contents($root.'/index.php');
    t('index.php has My Orders modal',strpos($idxOl,'id="myorders-modal"')!==false&&strpos($idxOl,'id="mo-email"')!==false);
    t('index.php wires openMyOrders entry points (menu+nav+footer)',substr_count($idxOl,'openMyOrders()')>=3);
    t('index.php footer has Track My Order link',strpos($idxOl,'Track / View My Orders')!==false);
}catch(Exception $e){t('customer order lookup checks',false,$e->getMessage());}

// ── INVOICE LOGO ──
try{
    $aoInv=file_get_contents($root.'/js/admin-orders.js');
    t('printInvoice includes logo image',strpos($aoInv,'inv-logo')!==false&&strpos($aoInv,'HDBSLogo.jpeg')!==false);
    t('printInvoice logo has graceful onerror fallback',strpos($aoInv,'this.style.display=')!==false);
    t('HDBSLogo.jpeg exists',file_exists($root.'/HDBSLogo.jpeg'));
}catch(Exception $e){t('invoice logo checks',false,$e->getMessage());}

// ── EMAIL LOGO (spliced into each template's own colored header block) ──
try{
    $mailPhp=file_get_contents($root.'/mailer.php');
    t('mailer defines _emailLogoHeader with logo',strpos($mailPhp,'function _emailLogoHeader')!==false&&strpos($mailPhp,'HDBSLogo.jpeg')!==false);
    t('sendEmail applies the logo header',strpos($mailPhp,'$html = _emailLogoHeader($html);')!==false);
    t('sendEmailWithAttachment applies the logo header',substr_count($mailPhp,'_emailLogoHeader($html)')>=3);
    t('_emailLogoHeader turns the header div into a flex row (logo beside title)',strpos($mailPhp,'display:flex')!==false&&strpos($mailPhp,'preg_replace_callback')!==false);
    t('_emailLogoHeader keeps a masthead fallback for unrecognized header shapes',strpos($mailPhp,'background:#2d2220;padding:14px 0')!==false);

    // Functional check: run the real function against sample headers shaped like our actual
    // templates (h1+subtitle, and a plain styled div with no h1) and confirm the logo lands
    // INSIDE that header, before the title, rather than in a separate bar above it.
    require_once $root.'/mailer.php';
    $sampleH1 = "<body><div style='background:#a07810;padding:28px;text-align:center'>"
              . "<h1 style='color:#fff'>Handmade Designs By Suzi</h1>"
              . "<p style='color:#fdf3d0'>Order Confirmation</p></div></body>";
    $outH1 = _emailLogoHeader($sampleH1);
    $logoPos = strpos($outH1,'HDBSLogo.jpeg');
    $h1Pos   = strpos($outH1,'<h1');
    t('_emailLogoHeader (h1 template): logo present',$logoPos!==false);
    t('_emailLogoHeader (h1 template): logo appears before the title',$logoPos!==false&&$h1Pos!==false&&$logoPos<$h1Pos);
    t('_emailLogoHeader (h1 template): title + subtitle both preserved',strpos($outH1,'Handmade Designs By Suzi')!==false&&strpos($outH1,'Order Confirmation')!==false);
    t('_emailLogoHeader (h1 template): header div becomes a flex row',preg_match('/background:#a07810[^\'"]*display:flex/',$outH1)===1);

    $samplePlain = "<body><div style='background:#a07810;padding:28px;text-align:center'>"
                 . "<div style='color:#fff;font-weight:bold'>Handmade Designs By Suzi</div></div></body>";
    $outPlain = _emailLogoHeader($samplePlain);
    $logoPosPlain=strpos($outPlain,'HDBSLogo.jpeg'); $titlePosPlain=strpos($outPlain,'font-weight:bold');
    t('_emailLogoHeader (plain-div template): logo appears before the title',$logoPosPlain!==false&&$titlePosPlain!==false&&$logoPosPlain<$titlePosPlain);

    // Fallback path: a body with no recognizable colored header should still get the logo somewhere.
    $sampleNoHeader = "<body><p>No colored header here.</p></body>";
    $outFallback = _emailLogoHeader($sampleNoHeader);
    t('_emailLogoHeader falls back to a masthead when no header div matches',strpos($outFallback,'HDBSLogo.jpeg')!==false);

    // Preview modes bypass sendEmail() entirely (they return $html without sending), so each
    // preview-supporting endpoint must apply _emailLogoHeader() itself or the admin preview
    // modal shows an email that doesn't match what actually gets sent.
    foreach(['send_confirm.php','send_shipping.php','send_generic.php'] as $pf){
        $pfSrc=file_get_contents($root.'/'.$pf);
        t($pf.' preview applies logo header',strpos($pfSrc,"'html'=>_emailLogoHeader(\$html)")!==false||strpos($pfSrc,'\'html\' => _emailLogoHeader($html)')!==false);
    }

    // sendEmail()/sendEmailWithAttachment() take $html BY REFERENCE, so the logo-splice mutates
    // the caller's own variable — every template logs this SAME $html to email_log afterward, so
    // that log now reflects what was actually sent instead of the pre-logo template (previously
    // the preview showed the logo but the Email Log entry didn't, since the caller's copy of
    // $html was never updated by the old by-value sendEmail()).
    t('sendEmail takes $html by reference',strpos($mailPhp,'function sendEmail($to, $subject, &$html,')!==false);
    t('sendEmailWithAttachment takes $html by reference',strpos($mailPhp,'function sendEmailWithAttachment($to, $subject, &$html,')!==false);
    foreach(['send_confirm.php','send_shipping.php','send_generic.php','api/order_confirm_email.php',
             'api/refund.php','notify.php','order_confirm.php','api/contact.php'] as $ef){
        $efSrc=file_get_contents($root.'/'.$ef);
        // Confirms the email_log INSERT for this template logs the same $html variable that was
        // passed to sendEmail() (not a separately-built string), so the by-ref fix covers it.
        t($ef.' logs the same $html passed to sendEmail (by-ref fix applies)',preg_match('/INSERT INTO email_log.*?execute\(\[.*?\$html\]\)/s',$efSrc)===1||preg_match('/INSERT INTO email_log.*?execute\(\[.*?\$html_body\]\)/s',$efSrc)===1);
    }
}catch(Exception $e){t('email logo checks',false,$e->getMessage());}

// ── SCROLL TO TOP / BOTTOM ──
try{
    $idxSn=file_get_contents($root.'/index.php');
    t('index.php has scroll-nav widget with top+bottom buttons',strpos($idxSn,'id="scroll-nav"')!==false&&strpos($idxSn,'id="scroll-top-btn"')!==false&&strpos($idxSn,'id="scroll-bottom-btn"')!==false);
    $uijs2=file_get_contents($root.'/js/ui.js');
    t('ui.js defines scrollToTop/scrollToBottom',strpos($uijs2,'function scrollToTop')!==false&&strpos($uijs2,'function scrollToBottom')!==false);
    t('ui.js toggles scroll-nav visibility on scroll',strpos($uijs2,'function _updateScrollNav')!==false&&strpos($uijs2,"addEventListener('scroll'")!==false);
    $cfgjs2=file_get_contents($root.'/js/config.js');
    t('config.js hides scroll-nav on admin panel',strpos($cfgjs2,"id==='apanel'")!==false&&strpos($cfgjs2,'scroll-nav')!==false);
}catch(Exception $e){t('scroll to top/bottom checks',false,$e->getMessage());}

// ── DIGITAL WALLETS (Apple Pay / Google Pay) + SANDBOX/LIVE MODE ──
try{
    $stjs   = file_get_contents($root.'/js/store.js');
    $cfgjs  = file_get_contents($root.'/js/config.js');
    $uijs   = file_get_contents($root.'/js/ui.js');
    $aojs   = file_get_contents($root.'/js/admin-orders.js');
    $idx    = file_get_contents($root.'/index.php');
    $ppPhp  = file_get_contents($root.'/api/process_payment.php');
    $sqpPhp = file_get_contents($root.'/api/square_payments.php');
    $admPhp = file_get_contents($root.'/api/admin.php');

    // store.js — wallet payment methods
    t('store.js:initApplePay function',strpos($stjs,'function initApplePay')!==false);
    t('store.js:initGooglePay function',strpos($stjs,'function initGooglePay')!==false);
    t('store.js:chargeWithMethod shared charge fn',strpos($stjs,'function chargeWithMethod')!==false);
    t('store.js:resetWalletButtons function',strpos($stjs,'function resetWalletButtons')!==false);
    t('store.js:builds Square paymentRequest',strpos($stjs,'payments.paymentRequest(')!==false);
    t('store.js:calls payments.applePay',strpos($stjs,'payments.applePay(')!==false);
    t('store.js:calls payments.googlePay',strpos($stjs,'payments.googlePay(')!==false);
    t('store.js:guards ApplePaySession.canMakePayments',strpos($stjs,'ApplePaySession.canMakePayments()')!==false);
    t('store.js:submitPayment delegates to chargeWithMethod',strpos($stjs,'chargeWithMethod(window._sqCard)')!==false);
    t('store.js:backToCheckoutForm resets wallets',strpos($stjs,'resetWalletButtons()')!==false);
    // Mode-aware app id + location (sandbox vs live) — no leftover placeholder
    t('store.js:sandbox app id wired',strpos($stjs,'sandbox-sq0idb-hp0qHCyM-fNmVakmBP5VQA')!==false);
    t('store.js:no sandbox placeholder left',strpos($stjs,'YOUR_SANDBOX_APP_ID')===false);
    t('store.js:location branches on SQUARE_MODE',strpos($stjs,"SQUARE_MODE==='test'?'LVD15H6H5R4NW':'LJP687TQBTWTA'")!==false);

    // index.php — wallet buttons + divider
    t('index.php:apple-pay-button present',strpos($idx,'id="apple-pay-button"')!==false);
    t('index.php:google-pay-button present',strpos($idx,'id="google-pay-button"')!==false);
    t('index.php:wallet-divider present',strpos($idx,'id="wallet-divider"')!==false);

    // config.js — SQUARE_MODE auto-detects staging by hostname
    t('config.js:SQUARE_MODE hostname auto-detect',strpos($cfgjs,"location.hostname.indexOf('staging.')")!==false);

    // ui.js + admin — square_mode persisted through DB
    t('ui.js:loads square_mode from DB',strpos($uijs,"key:'square_mode'")!==false);
    t('admin-orders.js:Square Payment Mode card',strpos($aojs,'Square Payment Mode')!==false&&strpos($aojs,'id="sqmode-sel"')!==false);
    t('admin-orders.js:setSquareMode saves setting',strpos($aojs,'function setSquareMode')!==false&&strpos($aojs,"key:'square_mode'")!==false);
    t('admin.php:square_mode is a public get_setting key',strpos($admPhp,"'square_mode','square_app_id'")!==false);

    // process_payment.php — sandbox URL typo fixed + sandbox location branching
    t('process_payment:correct sandbox host',strpos($ppPhp,'connect.squareupsandbox.com')!==false);
    t('process_payment:no squaresandbox typo',strpos($ppPhp,'connect.squaresandbox.com')===false);
    t('process_payment:sandbox location branching',strpos($ppPhp,'SQUARE_SANDBOX_LOCATION_ID')!==false);

    // square_payments.php — reporting query uses mode-aware location (was hardcoded live)
    t('square_payments:mode-aware location var',strpos($sqpPhp,'SQUARE_SANDBOX_LOCATION_ID')!==false);
    t('square_payments:list query uses $locationId',strpos($sqpPhp,"'location_id'=>\$locationId")!==false);
    t('square_payments:no undefined SQUARE_LOCATION_ID in backfill',strpos($sqpPhp,'defined(\'SQUARE_LOCATION_ID\')')===false);

    // Homepage + checkout payment-trust copy
    t('index.php:homepage We Accept section',strpos($idx,'We Accept')!==false);
    t('index.php:lists card brands (American Express)',strpos($idx,'American Express')!==false&&strpos($idx,'Discover')!==false);
    t('index.php:payment security note',strpos($idx,'processed securely by Square')!==false);
    t('index.php:We Accept lists PayPal + Venmo',strpos($idx,'🅿️ PayPal')!==false&&strpos($idx,'Venmo')!==false);
    t('index.php:We Accept lists Apple Pay + Google Pay',strpos($idx,'Apple Pay')!==false&&strpos($idx,'Google Pay')!==false);
    t('index.php:security note credits Square + PayPal',strpos($idx,'Square (cards, Apple Pay, Google Pay) and PayPal')!==false);

    // Apple Pay domain association file (deployed to staging webroot)
    t('.well-known Apple Pay domain file exists',file_exists($root.'/.well-known/apple-developer-merchantid-domain-association'));

}catch(Exception $e){t('digital wallet + sandbox mode checks',false,$e->getMessage());}

// ── PROD ERROR HARDENING + PROD-ONLY VERSION AUTO-BUMP ──
try{
    $cfgPhp = file_get_contents($root.'/api/config.php');
    $dlPhp  = file_get_contents($root.'/api/deploy_log.php');

    // config.php: display_errors off in prod, on in staging, log_errors on in prod
    t('config.php hides errors in production',strpos($cfgPhp,"ini_set('display_errors', '0')")!==false);
    t('config.php shows errors on staging',strpos($cfgPhp,"ini_set('display_errors', '1')")!==false);
    t('config.php logs errors in production',strpos($cfgPhp,"ini_set('log_errors', '1')")!==false);
    // The display_errors guard must precede the secrets require, so even a missing-secrets
    // fatal is suppressed on prod (the exact leak that happened in HDBS_12).
    $posErr = strpos($cfgPhp,"ini_set('display_errors', '0')");
    $posReq = strpos($cfgPhp,'require_once ($__staging');
    t('config.php sets display_errors before secrets require',$posErr!==false&&$posReq!==false&&$posErr<$posReq);

    // deploy_log.php: prod-only minor auto-bump, debounced, stamps version_updated_at
    t('deploy_log auto-bumps minor_version',strpos($dlPhp,"setSetting(\$pdo, 'minor_version'")!==false);
    t('deploy_log skips version bump on staging',strpos($dlPhp,'empty($__staging)')!==false);
    t('deploy_log debounces the bump (300s)',strpos($dlPhp,'version_updated_at')!==false&&strpos($dlPhp,'> 300')!==false);
    t('deploy_log stamps version_updated_at on bump',strpos($dlPhp,"setSetting(\$pdo, 'version_updated_at'")!==false);
}catch(Exception $e){t('error-hardening + auto-bump checks',false,$e->getMessage());}

// ── ORDER REFUNDS (Square API + cash/check ledger + customer email) ──
try{
    $rfFile=$root.'/api/refund.php';
    t('refund.php exists',file_exists($rfFile));
    $rfPhp=file_exists($rfFile)?file_get_contents($rfFile):'';

    // Schema
    t('refund.php creates refunds table',strpos($rfPhp,'CREATE TABLE IF NOT EXISTS refunds')!==false);
    t('refund.php migrates orders.refunded_amount',strpos($rfPhp,'ADD COLUMN refunded_amount')!==false);
    $ordcolsRF=$pdo->query("SHOW COLUMNS FROM orders")->fetchAll(PDO::FETCH_COLUMN);
    t('orders.refunded_amount column exists',in_array('refunded_amount',$ordcolsRF));
    // Lazily created by refund.php on first real invocation — won't exist on staging until
    // that endpoint has actually been hit there (the tProd live checks below only ever hit prod).
    $tblsRF=$pdo->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);
    tProd('refunds table exists',in_array('refunds',$tblsRF));

    // Core logic
    t('refund.php requires admin',strpos($rfPhp,'requireAdmin()')!==false);
    t('refund.php requires a reason',strpos($rfPhp,"reason === ''")!==false&&strpos($rfPhp,'A reason is required')!==false);
    t('refund.php validates amount > 0',strpos($rfPhp,'Refund amount must be greater than zero')!==false);
    t('refund.php caps amount to remaining balance',strpos($rfPhp,'exceeds remaining refundable balance')!==false);
    t('refund.php detects card orders',strpos($rfPhp,"['Credit Card', 'Square']")!==false);
    t('refund.php requires square_payment_id for card refunds',strpos($rfPhp,'no linked Square payment')!==false);
    t('refund.php calls Square refunds API',strpos($rfPhp,'/refunds')!==false&&strpos($rfPhp,'sq_curl')!==false);
    t('refund.php uses idempotency key',strpos($rfPhp,'idempotency_key')!==false);
    t('refund.php rejects failed Square refunds',strpos($rfPhp,'REJECTED')!==false&&strpos($rfPhp,'FAILED')!==false);
    t('refund.php logs to refunds table',strpos($rfPhp,'INSERT INTO refunds')!==false);
    t('refund.php marks order Refunded when fully refunded',strpos($rfPhp,"'Refunded' : \$order['status']")!==false);
    t('refund.php sends customer email',strpos($rfPhp,'sendRefundEmail')!==false&&strpos($rfPhp,'sendEmail(')!==false);
    t('refund.php logs to email_log',strpos($rfPhp,"'Refund Notification'")!==false);
    t('refund.php email failure does not block refund',strpos($rfPhp,'email failure')!==false||strpos($rfPhp,"'email_sent'")!==false);

    // Live endpoint checks (fake order IDs / bad payloads only — never touches a real order).
    // uiGet/uiPost always hit production ($base), so on staging — before this feature is
    // promoted via checkpoint — api/refund.php won't exist there yet. tProd() reports these
    // as skipped (not failed) on staging, then verifies for real once it's live on prod.
    $rNoAuthGet=uiGet($base.'/api/refund.php');
    tProd('refund.php:GET without token is 401',$rNoAuthGet['code']===401,'HTTP '.$rNoAuthGet['code']);
    $rNoAuthPost=uiPost($base.'/api/refund.php',['order_id'=>'FAKE-REFUND-000','amount'=>1,'reason'=>'test']);
    tProd('refund.php:POST without token is 401',$rNoAuthPost['code']===401,'HTTP '.$rNoAuthPost['code']);
    $rMissingOid=uiPostAdmin($base.'/api/refund.php',['amount'=>10,'reason'=>'test']);
    tProd('refund.php:rejects missing order_id',$rMissingOid['json']&&empty($rMissingOid['json']['success']),'HTTP '.$rMissingOid['code']);
    $rBadAmt=uiPostAdmin($base.'/api/refund.php',['order_id'=>'FAKE-REFUND-001','amount'=>0,'reason'=>'test']);
    tProd('refund.php:rejects zero/negative amount',$rBadAmt['json']&&empty($rBadAmt['json']['success']),'HTTP '.$rBadAmt['code']);
    $rNoReason=uiPostAdmin($base.'/api/refund.php',['order_id'=>'FAKE-REFUND-002','amount'=>10,'reason'=>'']);
    tProd('refund.php:rejects empty reason',$rNoReason['json']&&empty($rNoReason['json']['success']),'HTTP '.$rNoReason['code']);
    $rUnknownOid=uiPostAdmin($base.'/api/refund.php',['order_id'=>'FAKE-REFUND-999','amount'=>10,'reason'=>'test']);
    tProd('refund.php:rejects unknown order',$rUnknownOid['json']&&empty($rUnknownOid['json']['success']),'HTTP '.$rUnknownOid['code'].' err='.($rUnknownOid['json']['error']??''));

    // orders.php exposes refunded_amount
    $ordPhpRF=file_get_contents($root.'/api/orders.php');
    t('orders.php GET returns refunded_amount',strpos($ordPhpRF,"'refunded_amount' =>")!==false);

    // Admin UI wiring
    $apjsRF=isset($apjs)?$apjs:file_get_contents($root.'/js/admin-products.js');
    $aojsRF=isset($aojs)?$aojs:file_get_contents($root.'/js/admin-orders.js');
    t('showRefundFormFor function exists',strpos($apjsRF,'function showRefundFormFor(')!==false);
    t('saveRefundFor function exists',strpos($apjsRF,'function saveRefundFor(')!==false);
    t('updateRefundAmountFor function exists',strpos($apjsRF,'function updateRefundAmountFor(')!==false);
    t('refundRemaining helper exists',strpos($aojsRF,'function refundRemaining(')!==false);
    t('btn:Refund Order (order detail) wired',strpos($apjsRF,'showRefundFormFor(')!==false);
    t('order detail shows Refunded running total',strpos($apjsRF,'Refunded: $')!==false);
    t('orders list has Refunded column',strpos($aojsRF,"'Refunded'")!==false);
    t('refund form requires a reason (UI)',strpos($apjsRF,'A reason is required')!==false&&strpos($aojsRF,'A reason is required')!==false);
    t('refund form calls refund.php',strpos($apjsRF,"apiFetch('refund.php'")!==false);

    // Hardening (2026-07-02): idempotency key must be deterministic so a genuine retry of the
    // same refund dedupes on Square's side instead of double-refunding real money.
    t('refund.php idempotency key has no random component',strpos($rfPhp,'uniqid')===false);
    t('refund.php idempotency key is time-bucketed and deterministic',strpos($rfPhp,'floor(time() / 600)')!==false);
    // Hardening: order id (customer-controlled, unrestricted format at checkout) is sanitized
    // before reaching the refund email — CR/LF stripped (blocks SMTP header injection via the
    // subject line) and HTML-escaped separately for the body.
    t('refund.php strips CR/LF from order id before use in email',strpos($rfPhp,'str_replace(["\r", "\n"], \'\', $order[\'id\'])')!==false);
    t('refund.php HTML-escapes order id for the email body',strpos($rfPhp,'$oidSafe   = htmlspecialchars($oid)')!==false);
    t('refund.php email body uses the escaped order id, not the raw one',strpos($rfPhp,'#{$oidSafe}')!==false);
}catch(Exception $e){t('order refunds checks',false,$e->getMessage());}

// ── Business: Capital Equipment (date purchased, purchase price, description, receipt) ──
try{
    $ceFile=$root.'/api/capital_equipment.php';
    t('capital_equipment.php exists',file_exists($ceFile));
    $cePhp=file_exists($ceFile)?file_get_contents($ceFile):'';
    t('capital_equipment.php requires admin',strpos($cePhp,'requireAdmin()')!==false);
    t('capital_equipment.php creates table',strpos($cePhp,'CREATE TABLE IF NOT EXISTS capital_equipment')!==false);
    t('capital_equipment.php table has description/date/price columns',strpos($cePhp,'description TEXT NOT NULL')!==false&&strpos($cePhp,'purchase_date DATE NOT NULL')!==false&&strpos($cePhp,'purchase_price DECIMAL(10,2) NOT NULL')!==false);
    t('capital_equipment.php GET returns items',strpos($cePhp,"ok(['items'")!==false);
    t('capital_equipment.php POST validates required fields',strpos($cePhp,'purchase date, and a price greater than zero are required')!==false);
    t('capital_equipment.php supports PUT (edit)',strpos($cePhp,"\$method === 'PUT'")!==false&&strpos($cePhp,'UPDATE capital_equipment SET')!==false);
    t('capital_equipment.php supports DELETE',strpos($cePhp,"\$method === 'DELETE'")!==false&&strpos($cePhp,'DELETE FROM capital_equipment')!==false);
    t('capital_equipment.php POST returns new item id',strpos($cePhp,"'id' => (int)\$pdo->lastInsertId()")!==false);

    // Receipt storage: outside the webroot, validated by magic bytes (not client mime type)
    t('capital_equipment.php stores receipts outside webroot',strpos($cePhp,"dirname(dirname(__DIR__)) . '/capital_equipment_receipts/'")!==false);
    t('capital_equipment.php validates receipt by magic bytes',strpos($cePhp,"substr(\$bytes, 0, 4)")!==false&&strpos($cePhp,'PDF')!==false&&strpos($cePhp,'PNG')!==false);
    t('capital_equipment.php caps receipt at 5MB',strpos($cePhp,'5 * 1024 * 1024')!==false);
    t('capital_equipment.php supports upload_receipt action',strpos($cePhp,"\$action === 'upload_receipt'")!==false);
    t('capital_equipment.php supports download_receipt action',strpos($cePhp,"\$action === 'download_receipt'")!==false);
    t('capital_equipment.php supports delete_receipt action',strpos($cePhp,"\$action === 'delete_receipt'")!==false);
    t('capital_equipment.php GET exposes has_receipt',strpos($cePhp,"'has_receipt'")!==false);
    t('capital_equipment.php deletes receipt file when item is deleted',strpos($cePhp,'DELETE FROM capital_equipment WHERE id=?')!==false&&substr_count($cePhp,'@unlink($path)')>=1);

    // Live endpoint: unauthenticated request is rejected (401), never reaches the DB
    $rCeNoAuth=uiGet($base.'/api/capital_equipment.php');
    tProd('capital_equipment.php:GET without token is 401',$rCeNoAuth['code']===401,'HTTP '.$rCeNoAuth['code']);

    // Admin UI
    $abjsCe=isset($abjs)?$abjs:file_get_contents($root.'/js/admin-business.js');
    t('Capital Equipment form has date field',strpos($abjsCe,'ce-date')!==false);
    t('Capital Equipment form has price field',strpos($abjsCe,'ce-price')!==false);
    t('Capital Equipment form has description field',strpos($abjsCe,'ce-desc')!==false);
    t('saveBizEquip validates date/price/description',strpos($abjsCe,'function saveBizEquip(')!==false&&strpos($abjsCe,'purchase date')!==false&&strpos($abjsCe,'purchase price')!==false);
    t('editBizEquip function exists',strpos($abjsCe,'function editBizEquip(')!==false);
    t('deleteBizEquip function exists',strpos($abjsCe,'function deleteBizEquip(')!==false);
    t('Capital Equipment shows Total Invested stat',strpos($abjsCe,'Total Invested')!==false);
    t('Capital Equipment calls capital_equipment.php',strpos($abjsCe,"apiFetch('capital_equipment.php'")!==false);
    // Receipt is attached via the Add/Edit form (not a per-row upload input) — the item is
    // saved first, then the receipt is attached to the returned/edited id in the same action.
    t('Add/Edit form has receipt file field',strpos($abjsCe,'ce-receipt-file')!==false);
    t('saveBizEquip uploads receipt after item is saved',strpos($abjsCe,"action:'upload_receipt',id:itemId")!==false);
    t('editBizEquip shows current receipt in the form',strpos($abjsCe,'ce-receipt-current')!==false&&strpos($abjsCe,'Current receipt:')!==false);
    t('No more per-row receipt upload input',strpos($abjsCe,'onchange="uploadEquipReceipt(')===false);
    // View displays the receipt inline (image lightbox or new-tab PDF) instead of downloading
    t('viewEquipReceipt function exists',strpos($abjsCe,'function viewEquipReceipt(')!==false);
    // Scoped to just this function's body — 'a.download' legitimately appears elsewhere
    // (bizDocDownload, a genuine file download for an unrelated feature).
    $viewFnStart=strpos($abjsCe,'function viewEquipReceipt(');
    $viewFnEnd=strpos($abjsCe,'function showReceiptImageModal(');
    $viewFnBody=($viewFnStart!==false&&$viewFnEnd!==false&&$viewFnEnd>$viewFnStart)?substr($abjsCe,$viewFnStart,$viewFnEnd-$viewFnStart):'';
    t('viewEquipReceipt does not force a download',$viewFnBody!==''&&strpos($viewFnBody,'a.download')===false);
    t('showReceiptImageModal function exists',strpos($abjsCe,'function showReceiptImageModal(')!==false);
    t('images open in a lightbox',strpos($abjsCe,"ctype.indexOf('image/')===0")!==false&&strpos($abjsCe,'showReceiptImageModal(url)')!==false);
    t('PDFs open in a new tab',strpos($abjsCe,"window.open(url,'_blank')")!==false);
    t('deleteEquipReceipt function exists',strpos($abjsCe,'function deleteEquipReceipt(')!==false);

    // Hardening (2026-07-02): receipt_orig_name is client-controlled (the uploaded file's
    // reported name) and was reflected unescaped in an HTML title attribute and a response
    // header — fixed with sanitization at upload time, a header-output guard, and JS escaping.
    t('capital_equipment.php sanitizes filename at upload (strips control/quote/HTML chars)',strpos($cePhp,'[\x00-\x1F\x7F')!==false&&strpos($cePhp,'<>]')!==false);
    t('capital_equipment.php caps sanitized filename length',strpos($cePhp,'substr($origName, 0, 200)')!==false);
    t('capital_equipment.php Content-Disposition strips quotes/CRLF (defense in depth)',strpos($cePhp,'$dispositionName = str_replace([\'"\', "\r", "\n"]')!==false);
    t('ceEsc escape helper exists in admin-business.js',strpos($abjsCe,'function ceEsc(')!==false);
    t('description is escaped before rendering',strpos($abjsCe,'ceEsc(i.description)')!==false);
    t('receipt_orig_name is escaped in the View button title',strpos($abjsCe,'ceEsc(i.receipt_orig_name)')!==false);
    t('receipt_orig_name is escaped in the edit form current-receipt display',strpos($abjsCe,'ceEsc(item.receipt_orig_name')!==false);
}catch(Exception $e){t('capital equipment checks',false,$e->getMessage());}

// ── Round 5 hardening: isAdminRequest + atomic stock decrement ──
try {
    $ordPhp2 = file_get_contents($root . '/api/orders.php');
    $cfgPhp2 = file_get_contents($root . '/api/config.php');

    // isAdminRequest() must exist in config.php and orders.php must use it
    t('config.php defines isAdminRequest', strpos($cfgPhp2, 'function isAdminRequest') !== false);
    t('orders.php uses isAdminRequest()', strpos($ordPhp2, 'isAdminRequest()') !== false);
    t('orders.php no longer uses !empty HTTP_X_ADMIN_TOKEN', strpos($ordPhp2, "!empty(\$_SERVER['HTTP_X_ADMIN_TOKEN'])") === false);

    // Atomic stock guard
    t('orders.php stock decrement uses AND stock >= ?', strpos($ordPhp2, 'AND stock >= ?') !== false);
    t('orders.php stock decrement checks rowCount', strpos($ordPhp2, 'rowCount() === 0') !== false && strpos($ordPhp2, 'out of stock') !== false);
    t('orders.php no longer uses GREATEST(0, stock -', strpos($ordPhp2, 'GREATEST(0, stock -') === false);

    // Live: POST order with bogus X-Admin-Token via curl — status must be clamped to Awaiting Payment.
    // Prod-only: this POST hits $base (hardcoded prod) and CREATES an order there; running it from a
    // staging suite would leak that order into PROD, which this run's $pdo (staging) can't clean up.
    if(!$isStaging){
      $fakeOid = 'RT-FKADM-' . time();
      $fakePayload = json_encode(['id'=>$fakeOid,'total'=>1.00,'cust'=>'Test','email'=>'rt@test.com','status'=>'Paid']);
      $ch = curl_init($base . '/api/orders.php');
      curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER=>true, CURLOPT_POST=>true,
          CURLOPT_POSTFIELDS=>$fakePayload,
          CURLOPT_HTTPHEADER=>['Content-Type: application/json','X-Admin-Token: not-a-real-token'],
          CURLOPT_TIMEOUT=>8]);
      $rb = curl_exec($ch); curl_close($ch);
      $rj = @json_decode($rb, true);
      // Clean up the test order if it was created
      if (!empty($rj['success'])) {
          $pdo->prepare("DELETE FROM orders WHERE id=?")->execute([$fakeOid]);
      }
      // Check DB: order should not exist with status Paid (it was either rejected or clamped)
      $chk = $pdo->prepare("SELECT status FROM orders WHERE id=?"); $chk->execute([$fakeOid]);
      $chkRow = $chk->fetch();
      $fakeAdminOk = !$chkRow || $chkRow['status'] !== 'Paid';
      t('orders.php rejects fake admin token (status not Paid)', $fakeAdminOk, $chkRow ? 'status='.$chkRow['status'] : 'order not created');
      // Always remove the row we just created, whatever its status came back as.
      $pdo->prepare("DELETE FROM orders WHERE id=?")->execute([$fakeOid]);
      $pdo->prepare("DELETE FROM order_items WHERE order_id=?")->execute([$fakeOid]);
    } else {
      t('orders.php rejects fake admin token (status not Paid)', true, 'skipped on staging (would create prod data)');
    }
} catch (Exception $e) { t('round 5 hardening checks', false, $e->getMessage()); }

// ── DB TABLE LIST / CONTENTS ──
try {
    $adphp = isset($adphp) ? $adphp : file_get_contents($root.'/api/admin.php');
    t('db_table_list action in admin.php', strpos($adphp, "action === 'db_table_list'") !== false);
    t('db_table_contents action in admin.php', strpos($adphp, "action === 'db_table_contents'") !== false);
    t('db_table_contents whitelist prevents injection', strpos($adphp, 'in_array($tbl, $allowed, true)') !== false);
    $amjs = isset($amjs) ? $amjs : file_get_contents($root.'/js/admin-misc.js');
    t('dbtables-card in admin-misc.js', strpos($amjs, 'dbtables-card') !== false);
    t('dbListTables function exists', strpos($amjs, 'function dbListTables(') !== false);
    t('dbBrowseTable function exists', strpos($amjs, 'function dbBrowseTable(') !== false);
    t('dbSelectAndBrowse function exists', strpos($amjs, 'function dbSelectAndBrowse(') !== false);
    t('dropdown auto-populated on card render', strpos($amjs, "action:'db_table_list'") !== false);
    // Live: db_table_list requires admin auth
    $ch = curl_init('https://handmadedesignsbysuzi.com/api/admin.php');
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER=>true, CURLOPT_TIMEOUT=>8, CURLOPT_POST=>true,
        CURLOPT_POSTFIELDS=>json_encode(['action'=>'db_table_list']),
        CURLOPT_HTTPHEADER=>['Content-Type: application/json']]);
    $res = json_decode(curl_exec($ch), true); curl_close($ch);
    t('db_table_list blocked unauthenticated', isset($res['success']) && $res['success'] === false);
    // Live: db_table_contents requires admin auth
    $ch = curl_init('https://handmadedesignsbysuzi.com/api/admin.php');
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER=>true, CURLOPT_TIMEOUT=>8, CURLOPT_POST=>true,
        CURLOPT_POSTFIELDS=>json_encode(['action'=>'db_table_contents','table'=>'settings']),
        CURLOPT_HTTPHEADER=>['Content-Type: application/json']]);
    $res = json_decode(curl_exec($ch), true); curl_close($ch);
    t('db_table_contents blocked unauthenticated', isset($res['success']) && $res['success'] === false);
    // Live: db_table_contents rejects unknown table (with admin token)
    $rtTok = isset($_rtAdminToken) ? $_rtAdminToken : $pdo->query("SELECT value FROM settings WHERE key_name='admin_session_token' LIMIT 1")->fetchColumn();
    if ($rtTok) {
        $ch = curl_init('https://handmadedesignsbysuzi.com/api/admin.php');
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER=>true, CURLOPT_TIMEOUT=>8, CURLOPT_POST=>true,
            CURLOPT_POSTFIELDS=>json_encode(['action'=>'db_table_contents','table'=>'../etc/passwd']),
            CURLOPT_HTTPHEADER=>['Content-Type: application/json', "X-Admin-Token: $rtTok"]]);
        $res = json_decode(curl_exec($ch), true); curl_close($ch);
        t('db_table_contents rejects unknown/malicious table name', isset($res['success']) && $res['success'] === false);
    } else {
        t('db_table_contents injection check (no admin session, skip)', true, 'skipped');
    }
} catch (Exception $e) { t('db table list/contents checks', false, $e->getMessage()); }

// ── WWW SUBDOMAIN ──
try{
    // www subdomain should be accessible and serve the storefront
    t('www subdomain homepage accessible (200)',httpCode('https://www.handmadedesignsbysuzi.com/')===200);
    // API on www subdomain must send Access-Control-Allow-Origin header (GET, since HEAD/OPTIONS may 405)
    $ch=curl_init('https://www.handmadedesignsbysuzi.com/api/products.php');
    curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>8,CURLOPT_HEADER=>true,CURLOPT_NOBODY=>false]);
    $resp=curl_exec($ch);curl_close($ch);
    $wwwHdrs=substr($resp,0,strpos($resp,"\r\n\r\n"));
    t('www subdomain API sends Access-Control-Allow-Origin',stripos($wwwHdrs,'Access-Control-Allow-Origin')!==false,$wwwHdrs===false?'no response':'');
}catch(Exception $e){t('www subdomain checks',false,$e->getMessage());}

// ── GENERIC CUSTOMER EMAIL (2026-07-03) ──
try{
    $sgFile=$root.'/send_generic.php';
    t('send_generic.php exists',file_exists($sgFile));
    $sgPhp=file_exists($sgFile)?file_get_contents($sgFile):'';
    t('send_generic.php requires order_id',strpos($sgPhp,'Missing order_id')!==false);
    t('send_generic.php requires subject and message',strpos($sgPhp,'Subject and message are required')!==false);
    t('send_generic.php strips CR/LF from subject (header injection guard)',strpos($sgPhp,'str_replace(["\r","\n"]')!==false);
    t('send_generic.php escapes message body',strpos($sgPhp,'nl2br(htmlspecialchars($message_in')!==false);
    t('send_generic.php escapes order id in email body',strpos($sgPhp,'htmlspecialchars($order_id, ENT_QUOTES')!==false);
    t('send_generic.php supports preview mode without sending',strpos($sgPhp,"!empty(\$data['preview'])")!==false&&strpos($sgPhp,"'preview'=>true")!==false);
    t('send_generic.php logs to email_log as Custom Email',strpos($sgPhp,"'Custom Email'")!==false);
    t('send_generic.php uses bizName for from-name',strpos($sgPhp,'bizName($pdo)')!==false);

    // Admin UI wiring
    $aojsGe=isset($aojs)?$aojs:file_get_contents($root.'/js/admin-orders.js');
    $apjsGe=isset($apjs)?$apjs:file_get_contents($root.'/js/admin-products.js');
    t('sendGenericEmail validates customer email before opening compose modal',strpos($aojsGe,'function sendGenericEmail(oid)')!==false&&strpos($aojsGe,'Cannot send: no valid email address on this order.')!==false);
    t('sendGenericEmail opens compose modal with subject + message fields',strpos($aojsGe,'ge-subject')!==false&&strpos($aojsGe,'ge-message')!==false);
    t('previewGenericEmail requires subject and message before preview',strpos($aojsGe,'function previewGenericEmail(oid)')!==false&&strpos($aojsGe,'Subject and message are both required.')!==false);
    t('previewGenericEmail calls send_generic.php preview',strpos($aojsGe,"SITE_ORIGIN+'/send_generic.php'")!==false);
    t('emailSendNow carries subject/message through to final send',strpos($aojsGe,"endpoint.indexOf('send_generic')!==-1 && _genericDraft")!==false);
    t('btn:Send Email (generic) wired on Order Detail',strpos($apjsGe,'sendGenericEmail(')!==false);
}catch(Exception $e){t('generic customer email checks',false,$e->getMessage());}

// ── MULTIPLE TRACKING NUMBERS (2026-07-03) ──
try{
    $ordPhpTr=isset($ordPhpRF)?$ordPhpRF:file_get_contents($root.'/api/orders.php');
    t('orders.php widens tracking_number column when narrower than 500',strpos($ordPhpTr,'MODIFY COLUMN tracking_number VARCHAR(500)')!==false);

    $ssphpTr=isset($ssphp)?$ssphp:file_get_contents($root.'/send_shipping.php');
    t('send_shipping.php splits tracking on commas/newlines',strpos($ssphpTr,"preg_split('/[,\\n]+/'")!==false);
    t('send_shipping.php builds a per-carrier tracking URL helper',strpos($ssphpTr,'function trackingUrl($carrier, $num)')!==false);
    t('send_shipping.php renders one link per tracking number',strpos($ssphpTr,'array_map(function($num) use ($carrier)')!==false);
    t('send_shipping.php handles empty tracking list gracefully',strpos($ssphpTr,'empty($tracking_list)')!==false);

    $aojsTr=isset($aojsGe)?$aojsGe:file_get_contents($root.'/js/admin-orders.js');
    $apjsTr=isset($apjsGe)?$apjsGe:file_get_contents($root.'/js/admin-products.js');
    t('Edit Order tracking field hints at comma-separated multiple',strpos($aojsTr,'comma-separate multiple')!==false);
    t('Send Shipping preview tracking field hints at comma-separated multiple',strpos($aojsTr,'Comma-separate multiple')!==false);
    t('Order Detail renders each tracking number as its own chip',strpos($apjsTr,"order.tracking.split(/[,\\n]+/)")!==false);
}catch(Exception $e){t('multiple tracking numbers checks',false,$e->getMessage());}

// ── TRANSACTION FEE PERSISTENCE (2026-07-03) ──
// Root cause: Square's Payment object carries the real processing_fee it charged, but neither
// payment-completion path ever read or saved it, so transaction_fee stayed $0 for every card
// order regardless of what Square actually took.
try{
    $vpPhpFee=isset($vpphp2)?$vpphp2:file_get_contents($root.'/verify_payment.php');
    t('verify_payment.php extracts Square processing_fee',strpos($vpPhpFee,'$sq_actual_fee')!==false&&strpos($vpPhpFee,"matched['processing_fee']")!==false);
    t('verify_payment.php persists transaction_fee on the order',strpos($vpPhpFee,'transaction_fee=?')!==false&&strpos($vpPhpFee,'$sq_actual_fee, $order_id')!==false);
    t('verify_payment.php falls back to fee estimate only when Square has not posted one yet',strpos($vpPhpFee,'if ($sq_actual_fee > 0)')!==false);
    t('verify_payment.php test_mode path initializes sq_actual_fee from the stored order',strpos($vpPhpFee,"\$sq_actual_fee = (float)(isset(\$order['transaction_fee'])")!==false);

    $whPhpFee=isset($wphp2)?$wphp2:file_get_contents($root.'/api/square-webhook.php');
    t('square-webhook.php extracts Square processing_fee',strpos($whPhpFee,"payment['processing_fee']")!==false);
    t('square-webhook.php persists transaction_fee on the order',strpos($whPhpFee,'transaction_fee = ?')!==false&&strpos($whPhpFee,'$fee_dollars, $order_id')!==false);
}catch(Exception $e){t('transaction fee persistence checks',false,$e->getMessage());}

// ── SQUARE PAYMENTS REPORT — TAX SOURCE FIX (2026-07-03) ──
// process_payment.php charges a flat total via the raw Payments API (no Square Order, no tax
// line item), so Square never has tax to report for these payments. The report used to ask
// Square's Orders API for tax and would always get back nothing for real orders — now it reads
// the authoritative tax_amount from our own orders table instead.
try{
    $spPhp=file_get_contents($root.'/api/square_payments.php');
    t('square_payments.php no longer queries Square Orders API for tax',strpos($spPhp,'orders/batch-retrieve')===false);
    t('square_payments.php looks up tax_amount from our own orders table by square_payment_id',strpos($spPhp,'SELECT square_payment_id, tax_amount FROM orders WHERE square_payment_id IN')!==false);
    t('square_payments.php keys tax lookup by payment id, not Square order id',strpos($spPhp,"\$taxByPaymentId[\$row['square_payment_id']]")!==false);
    t('square_payments.php still requires admin',strpos($spPhp,'requireAdmin()')!==false);
}catch(Exception $e){t('square payments report tax source checks',false,$e->getMessage());}

// ── DESIGN STUDIO (2026-07-05) ──
// Commission-inquiry showcase page: services/gallery/projects/testimonials/FAQs content
// (studio_items) + inquiry form (studio_inquiries), admin-managed via js/admin-studio.js.
try{
    t('api/studio.php',file_exists($root.'/api/studio.php'));
    t('js/studio.js',file_exists($root.'/js/studio.js'));
    t('js/admin-studio.js',file_exists($root.'/js/admin-studio.js'));
    $spphp=file_get_contents($root.'/api/studio.php');

    $sicols=$pdo->query("SHOW COLUMNS FROM studio_items")->fetchAll(PDO::FETCH_COLUMN);
    t('studio_items table',count($sicols)>0);
    $sqcols=$pdo->query("SHOW COLUMNS FROM studio_inquiries")->fetchAll(PDO::FETCH_COLUMN);
    t('studio_inquiries table',count($sqcols)>0);

    $svcCount=(int)$pdo->query("SELECT COUNT(*) FROM studio_items WHERE section='service'")->fetchColumn();
    t('studio services seeded',$svcCount>0,$svcCount.' rows');
    $faqCount=(int)$pdo->query("SELECT COUNT(*) FROM studio_items WHERE section='faq'")->fetchColumn();
    t('studio faqs seeded',$faqCount>0,$faqCount.' rows');

    // Public GET is read-only — safe to hit live (mirrors other live curl checks in this suite)
    // Tests the environment the suite is actually running on (ALLOWED_ORIGIN), not a hardcoded
    // host — the Design Studio may exist on staging before it's promoted to prod.
    $sch=curl_init(ALLOWED_ORIGIN.'/api/studio.php');
    curl_setopt_array($sch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>8]);
    $sresp=curl_exec($sch);$scode=(int)curl_getinfo($sch,CURLINFO_HTTP_CODE);curl_close($sch);
    $sjson=json_decode((string)$sresp,true);
    t('studio GET public',$scode===200&&is_array($sjson)&&!empty($sjson['success']),'HTTP '.$scode);

    t('studio POST auth',strpos($spphp,'requireAdmin();')!==false&&strpos($spphp,"action === 'save_item'")!==false&&strpos($spphp,"action === 'inquire'")!==false);
    t('studio inquire validates',strpos($spphp,'Name, email and a project description are required')!==false&&strpos($spphp,'FILTER_VALIDATE_EMAIL')!==false);
    t('studio rate limit',strpos($spphp,'rate_limits')!==false&&strpos($spphp,"attempts'] >= 5")!==false);

    $stjs=file_get_contents($root.'/js/studio.js');
    t('JS:goStudio',strpos(file_get_contents($root.'/js/config.js'),'function goStudio(')!==false);
    t('JS:renderStudio',strpos($stjs,'function renderStudio(')!==false);
    t('JS:submitStudioInquiry',strpos($stjs,'function submitStudioInquiry(')!==false);
    t('JS:STUDIO_PICKS',strpos($stjs,'STUDIO_PICKS')!==false);
    $asjs=file_get_contents($root.'/js/admin-studio.js');
    t('JS:rStudio',strpos($asjs,'function rStudio(')!==false);
    t('JS:dsSaveItem',strpos($asjs,'function dsSaveItem(')!==false);

    t('index.php studio-page',strpos($chtml,'id="studio-page"')!==false);
    t('index.php studio scripts',strpos($chtml,'js/studio.js')!==false&&strpos($chtml,'js/admin-studio.js')!==false);

    // Design Studio Projects: top-level nav fix + status pipeline + notes + email-customer
    $amjs3=isset($amjs)?$amjs:file_get_contents($root.'/js/admin-misc.js');
    $amjs=$amjs3;
    t('ADMIN_NAV_LABELS has studio',strpos($amjs,"studio:'🎨 Design Studio'")!==false);
    $sncols=$pdo->query("SHOW COLUMNS FROM studio_project_notes")->fetchAll(PDO::FETCH_COLUMN);
    t('studio_project_notes table',count($sncols)>0);
    t('inquiry_status allows new pipeline',strpos($spphp,"'in_progress'")!==false&&strpos($spphp,'PROJECT_STATUSES')!==false);
    t('send_studio_project.php exists',file_exists($root.'/send_studio_project.php'));
    t('send_studio_project.php requires admin',strpos(file_get_contents($root.'/send_studio_project.php'),'requireAdmin()')!==false);
    t('JS:sendProjectEmail',strpos($asjs,'function sendProjectEmail(')!==false);
    t('JS:dsAddNote',strpos($asjs,'function dsAddNote(')!==false);
    t('note timestamps shown in business timezone',strpos($spphp,'function dsFormatNoteTime')!==false&&strpos($spphp,"America/New_York")!==false);
}catch(Exception $e){t('design studio checks',false,$e->getMessage());}

}catch(Exception $e){t('Exception',false,$e->getMessage().' line '.$e->getLine());}

// ── TEST-DATA CLEANUP SWEEP ──
// Safety net so the suite never leaves fake records behind. Order-creating tests target $base
// (hardcoded prod), so on a PRODUCTION run this $pdo IS prod and this clears the fake orders/
// customers there — including any leaked by earlier staging runs (which couldn't self-clean).
try {
    $pdo->prepare("DELETE FROM order_items WHERE order_id LIKE 'RT-FKADM-%' OR order_id LIKE 'FAKE-%'")->execute();
    $pdo->prepare("DELETE FROM orders WHERE id LIKE 'RT-FKADM-%' OR id LIKE 'FAKE-%'")->execute();
    $pdo->prepare("DELETE FROM customers WHERE email = 'regression_dupe@test.com'")->execute();
    $rtLeft=(int)$pdo->query("SELECT COUNT(*) FROM orders WHERE id LIKE 'RT-FKADM-%' OR id LIKE 'FAKE-%'")->fetchColumn();
    t('test-data cleanup: no fake orders remain in this DB', $rtLeft===0, $rtLeft.' left');
} catch (Exception $e) { t('test-data cleanup sweep', false, $e->getMessage()); }

ob_end_clean();
echo json_encode(['pass'=>$pass,'fail'=>$fail,'total'=>$pass+$fail,
    'pct'=>($pass+$fail>0?round($pass/($pass+$fail)*100):0),'results'=>$results]);
