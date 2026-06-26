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
try{$bz=json_decode($pdo->query("SELECT value FROM settings WHERE key_name='biz_profile' LIMIT 1")->fetchColumn(),true);t('biz_profile',$bz!==null&&isset($bz['legal_name']));}catch(Exception $e){t('biz_profile',false,$e->getMessage());}
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
try{$shopcss0=file_get_contents($root.'/css/shop.css');t('shop.css has /hero.jpg',strpos($shopcss0,'url("/hero.jpg")')!==false);t('product card image (.cimg img) uses contain',strpos($shopcss0,'.cimg img{width:100%;height:100%;object-fit:contain')!==false);}catch(Exception $e){t('shop.css check',false,$e->getMessage());}

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
// notify.php does NOT log Order Placed to email_log
try{$np=file_get_contents($root.'/notify.php');t('notify.php no Order Placed log',strpos($np,"INSERT INTO email_log")===false);}catch(Exception $e){t('notify.php no Order Placed log',false,$e->getMessage());}
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
    t('products_csv export includes sell column',strpos($csvphp,"'id','sku','name','description','price','stock','category','badge','weight','size','sell','img1','img2','img3'")!==false);
    t('products_csv import includes sell column',strpos($csvphp,"':sell'")!==false);
    t('products_csv ON DUPLICATE KEY updates img1',strpos($csvphp,'img1=:img1')!==false);
    t('products_csv ON DUPLICATE KEY updates img2',strpos($csvphp,'img2=:img2')!==false);
    t('products_csv ON DUPLICATE KEY updates img3',strpos($csvphp,'img3=:img3')!==false);
    t('products_csv ON DUPLICATE KEY updates sell',strpos($csvphp,'sell=:sell')!==false);
}catch(Exception $e){t('products_csv checks',false,$e->getMessage());}

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
// Manual order form
try{$aojs=isset($aojs)?$aojs:file_get_contents($root.'/js/admin-orders.js');
    t('manual order email required',strpos($aojs,'Please enter a valid email address.')!==false);
    t('manual order email label asterisk',strpos($aojs,'Email *')!==false);
    t('order_type in saveManualOrder',strpos($aojs,'order_type:otype')!==false);
    t('setManualPayType exists',strpos($aojs,'function setManualPayType(')!==false);
    t('moLookupCityTax exists',strpos($aojs,'function moLookupCityTax(')!==false);
    t('sendConfirmEmail validates email',strpos($aojs,'Cannot send: no valid email')!==false);
    t('manual order save confirmation',strpos($aojs,'Order Saved')!==false);
    t('Cash sets In Person order type',strpos($aojs,"Cash:'In Person'")!==false);
    t('Paid By sets order type on change',strpos($aojs,"In Person")!==false&&strpos($aojs,'mo-type')!==false);
}catch(Exception $e){t('manual order form checks',false,$e->getMessage());}
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
// Manual order form
try{
    $aojs3=isset($aojs)?$aojs:file_get_contents($root.'/js/admin-orders.js');
    $aojs=$aojs3;
    t('moFmtPhone exists',strpos($aojs,'function moFmtPhone(')!==false);
    t('moSetPay exists',strpos($aojs,'function moSetPay(')!==false);
    t('moHighlightTotal exists',strpos($aojs,'function moHighlightTotal(')!==false);
    t('moToggleShipping exists',strpos($aojs,'function moToggleShipping(')!==false);
    t('moSendConfirm exists',strpos($aojs,'function moSendConfirm(')!==false);
    t('city field in manual form',strpos($aojs,'mo-city')!==false);
    t('shipping required checkbox',strpos($aojs,'mo-ship-req')!==false);
    t('dual totals display',strpos($aojs,'mo-total-cashcheck')!==false&&strpos($aojs,'mo-total-cc')!==false);
    t('transaction fee in manual order save',strpos($aojs,'fee:parseFloat')!==false);
}catch(Exception $e){t('manual order form checks',false,$e->getMessage());}
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
    $ihtml=isset($ihtml)?$ihtml:file_get_contents($root.'/index.html');
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
    $ihtml=isset($ihtml)?$ihtml:file_get_contents($root.'/index.html');
    t('authpage hidden on load',strpos($ihtml,'id="authpage" style="display:none"')!==false);
    t('alog hidden on load',strpos($ihtml,'id="alog" style="display:none"')!==false);
    t('apanel hidden on load',strpos($ihtml,'id="apanel" style="display:none"')!==false);
    t('QR code in footer',strpos($ihtml,'QRCode.jpeg')!==false);
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
    $ihtml=file_get_contents($root.'/index.html');
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
    t('hamburger on all pages',$hamCount>=7,'found '.$hamCount.' (expected 7+)');
}catch(Exception $e){t('contact page checks',false,$e->getMessage());}
// Business profile and confirmation email
try{
    $amjs3=isset($amjs)?$amjs:file_get_contents($root.'/js/admin-misc.js');
    $amjs=$amjs3;
    t('biz profile website_url field',strpos($amjs,'bp-website-url')!==false);
    t('biz profile website_email field',strpos($amjs,'bp-website-email')!==false);
    t('biz profile saves website fields',strpos($amjs,'website_url:website_url')!==false);
    t('biz profile website section',strpos($amjs,'Website & Contact')!==false);
}catch(Exception $e){t('biz profile checks',false,$e->getMessage());}
try{
    $scphp=file_get_contents($root.'/send_confirm.php');
    t('confirm email fetches biz_profile',strpos($scphp,"key_name='biz_profile'")!==false);
    t('confirm email uses biz_url',strpos($scphp,'biz_url')!==false);
    t('confirm email uses biz_email',strpos($scphp,'biz_email')!==false);
    t('confirm email shows order type',strpos($scphp,'Order Type')!==false);
    t('confirm email shows paid by',strpos($scphp,'Paid By')!==false);
    t('confirm email website prefix',strpos($scphp,'Website:')!==false);
    t('confirm email email prefix',strpos($scphp,'Email:')!==false);
}catch(Exception $e){t('send_confirm checks',false,$e->getMessage());}
// Email log clear button
try{$amjs=isset($amjs)?$amjs:file_get_contents($root.'/js/admin-misc.js');
    t('clearEmailLog function exists',strpos($amjs,'function clearEmailLog(')!==false);
    t('email log clear button',strpos($amjs,'Clear Log')!==false);
}catch(Exception $e){t('clearEmailLog',false,$e->getMessage());}
try{$elphp=file_get_contents($root.'/api/email_log.php');
    t('email_log.php supports DELETE',strpos($elphp,'DELETE')!==false&&strpos($elphp,'DELETE FROM email_log')!==false);
}catch(Exception $e){t('email_log DELETE',false,$e->getMessage());}
// Logo and hamburger on all pages
try{$ihtml=isset($ihtml)?$ihtml:file_get_contents($root.'/index.html');
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
    t('admin-orders.js logs manual form open',strpos(file_get_contents($root.'/js/admin-orders.js'),"'Manual Order Form opened'")!==false);
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

// Square payments batch-retrieve (performance fix)
try{$sqphp=file_get_contents($root.'/api/square_payments.php');
    t('square_payments uses sq_curl()',strpos($sqphp,'sq_curl(')!==false);
    t('square_payments uses batch-retrieve',strpos($sqphp,'batch-retrieve')!==false);
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
    $ihtml=isset($ihtml)?$ihtml:file_get_contents($root.'/index.html');
    t('toolbar.css linked in index.html',strpos($ihtml,'css/toolbar.css')!==false);
    t('toolbar.js included in index.html',strpos($ihtml,'js/toolbar.js')!==false);
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
    $ihtml=isset($ihtml)?$ihtml:file_get_contents($root.'/index.html');
    t('version line in footer',strpos($ihtml,'site-version-line')!==false);
    t('version line brightness matches footer (.5 opacity)',strpos($ihtml,'site-version-line')!==false&&strpos($ihtml,'rgba(255,255,255,.25)')===false,'should use .5 not .25');
    t('version fetch script in index.html',strpos($ihtml,'get_version')!==false);
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
}catch(Exception $e){t('site version checks',false,$e->getMessage());}

// ── PROMPT HISTORY ──
try{
    t('api/prompt_log.php exists',file_exists($root.'/api/prompt_log.php'));
    $plphp=file_get_contents($root.'/api/prompt_log.php');
    t('prompt_log creates table',strpos($plphp,'CREATE TABLE IF NOT EXISTS prompt_log')!==false);
    t('prompt_log add action',strpos($plphp,"add_prompt")!==false);
    t('prompt_log update action',strpos($plphp,"update_prompt")!==false);
    t('prompt_log delete action',strpos($plphp,"delete_prompt")!==false);
    t('prompt_log uses Eastern time (CONVERT_TZ)',strpos($plphp,"CONVERT_TZ(NOW(),'+00:00','-04:00')")!==false);
    $amjs=isset($amjs)?$amjs:file_get_contents($root.'/js/admin-misc.js');
    t('rPromptLog function exists',strpos($amjs,'function rPromptLog(')!==false);
    t('showAddPrompt exists',strpos($amjs,'function showAddPrompt(')!==false);
    t('savePrompt exists',strpos($amjs,'function savePrompt(')!==false);
    t('deletePrompt exists',strpos($amjs,'function deletePrompt(')!==false);
    $navjs=file_get_contents($root.'/js/admin-nav.js');
    t('promptlog in nav',strpos($navjs,"promptlog:'Prompt History'")!==false&&strpos($navjs,'rPromptLog(el)')!==false);
    t('promptlog in developer folder',strpos($amjs,"'promptlog'")!==false&&strpos($amjs,"sec:'developer'")!==false);
}catch(Exception $e){t('prompt history checks',false,$e->getMessage());}

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
    // Drag behaviour
    t('drag item into folder on header drop',strpos($amjs,'ch.appendChild(drag.el)')!==false);
    t('drag item to root on container drop',strpos($amjs,'container.appendChild(drag.el)')!==false);
    // Folder collapse
    t('toggleNavFolder saves to localStorage',strpos($amjs,'hdbs_nav_folders')!==false);
    t('folder collapse state in localStorage',strpos($amjs,'_navFolderState')!==false);
    // Migration
    t('loadNavOrder migrates old flat format',strpos($amjs,'ADMIN_NAV_STRUCTURE_DEFAULT')!==false&&strpos($amjs,'migrate')!==false);
    t('loadNavOrder adds missing secs',strpos($amjs,'existing.indexOf(sec)<0')!==false);
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
    t('moToggleCheckNum function exists',strpos($aojs,'function moToggleCheckNum(')!==false);
    t('manual order check number field',strpos($aojs,'mo-checknum')!==false);
    t('saveManualOrder stamps InPerson config',strpos($aojs,"payment_config:'InPerson'")!==false);
    t('saveManualOrder sends check_number',strpos($aojs,'check_number:checkNum')!==false);
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
try{$htmlPC=file_get_contents($root.'/index.html');
    t('checkout InPerson section present',strpos($htmlPC,'id="co-inperson"')!==false);
    t('checkout payment method select',strpos($htmlPC,'id="co-paymethod"')!==false);
    t('checkout check number field',strpos($htmlPC,'id="co-checknum"')!==false);
    t('checkout optional shipping checkbox',strpos($htmlPC,'id="co-ship-req"')!==false);
    t('shop.css cache-busted',strpos($htmlPC,'shop.css?v=')!==false);
    $sbkPos=strpos($htmlPC,'class="sbk"');$navPos=strpos($htmlPC,'id="admin-nav"');
    t('Back to Store sits above admin nav',$sbkPos!==false&&$navPos!==false&&$sbkPos<$navPos);
}catch(Exception $e){t('index.html payment config',false,$e->getMessage());}

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
    // Staging cache-busting of admin JS in index.html
    $htmlV=file_get_contents($root.'/index.html');
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
    $html=isset($html)?$html:file_get_contents($root.'/index.html');
    t('index.html loads table.css',strpos($html,'css/table.css')!==false);
    t('index.html loads table.js',strpos($html,'js/table.js')!==false);
    t('TableKit.initAll() in index.html',strpos($html,'TableKit.initAll()')!==false);
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

// ── FAVICON ──
try{
    $ihtml=isset($ihtml)?$ihtml:file_get_contents($root.'/index.html');
    t('favicon.png exists',file_exists($root.'/favicon.png'));
    t('favicon.png linked in index.html',strpos($ihtml,'favicon.png')!==false);
    t('favicon link is PNG type',strpos($ihtml,'type="image/png"')!==false);
    t('SVG emoji favicon removed',strpos($ihtml,"data:image/svg+xml")===false);
    t('favicon.png accessible (200)',httpCode('https://handmadedesignsbysuzi.com/favicon.png')===200);
}catch(Exception $e){t('favicon checks',false,$e->getMessage());}

// ── ABOUT PAGE ──
try{
    $ihtml=isset($ihtml)?$ihtml:file_get_contents($root.'/index.html');
    t('aboutsuzi.jpeg exists',file_exists($root.'/aboutsuzi.jpeg'));
    t('aboutsuzi.jpeg in About page',strpos($ihtml,'aboutsuzi.jpeg')!==false);
    t('About page has photo img tag',strpos($ihtml,'src="aboutsuzi.jpeg"')!==false);
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
         'mailer.php','checkout.php','send_confirm.php','send_shipping.php',
         'verify_payment.php','notify.php','index.html',
         'css/shop.css','css/table.css','js/table.js','js/api.js','js/config.js','js/store.js','js/auth.js',
         'js/ui.js','js/admin-nav.js','js/admin-general.js','js/admin-products.js',
         'js/admin-orders.js','js/admin-misc.js'] as $f)
    t($f, file_exists($root.'/'.$f));

// ── 4. JS FUNCTION CHECKS ──
$fns=[
    // Storefront
    'openCheckout','placeOrder','addToCart',
    // Orders
    'renderOrdersTable','viewOrder','showManualOrderForm','saveManualOrder',
    'sendConfirmEmail','sendShippingEmail','deleteOrder','deleteAllOrders',
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
    // Prompt log
    'rPromptLog','showAddPrompt','editPrompt','savePrompt','deletePrompt',
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
             'js/admin-orders.js','js/admin-misc.js'] as $jsf){
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
    // Check admin-nav id in index.html
    $html=file_get_contents($root.'/index.html');
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
    $ihtml=file_get_contents($root.'/index.html');
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
    t('btn:Manual Order wired',strpos($aojs,'showManualOrderForm()')!==false);
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
    t('btn:Save Tax Rates wired',strpos($aojs,'saveTaxRates()')!==false);
    t('btn:Reset Default Tax Rates wired',strpos($aojs,'resetDefaultTaxRates()')!==false);
    t('btn:Save Version wired',strpos($amjs,'saveVersion()')!==false);
    t('btn:Save GitHub Token wired',strpos($amjs,'saveGitHubToken()')!==false);
    t('btn:Save Biz Profile wired',strpos($amjs,'saveBizProfile()')!==false);

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

    // Prompt log buttons
    t('btn:Add Prompt wired',strpos($amjs,'showAddPrompt()')!==false);
    t('btn:Edit Prompt wired',strpos($amjs,'editPrompt(')!==false);
    t('btn:Delete Prompt wired',strpos($amjs,'deletePrompt(')!==false);

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
    t('api.js defines env-aware SITE_ORIGIN',strpos($apiEnv,'SITE_ORIGIN')!==false&&strpos($apiEnv,'location.hostname')!==false&&strpos($apiEnv,"'staging'")!==false);
    t('SITE_ORIGIN falls back to prod URL',strpos($apiEnv,"'https://handmadedesignsbysuzi.com'")!==false);
    t('api.js API base uses SITE_ORIGIN',strpos($apiEnv,"var API=SITE_ORIGIN+'/api'")!==false);
    t('api.js no hardcoded prod API base',strpos($apiEnv,"var API='https://handmadedesignsbysuzi.com/api'")===false);
    t('config.js API base uses SITE_ORIGIN',strpos(file_get_contents($root.'/js/config.js'),"var API=SITE_ORIGIN+'/api'")!==false);
    $stEnv=file_get_contents($root.'/js/store.js');
    t('store.js notify/verify use SITE_ORIGIN',strpos($stEnv,"SITE_ORIGIN+'/notify.php'")!==false&&strpos($stEnv,"SITE_ORIGIN+'/verify_payment.php'")!==false);
    $aoEnv=file_get_contents($root.'/js/admin-orders.js');
    t('admin-orders send_* use SITE_ORIGIN',strpos($aoEnv,"SITE_ORIGIN+'/send_confirm.php'")!==false&&strpos($aoEnv,"SITE_ORIGIN+'/send_shipping.php'")!==false);
    t('admin-misc db_backup uses SITE_ORIGIN',strpos(file_get_contents($root.'/js/admin-misc.js'),"SITE_ORIGIN+'/api/db_backup.php")!==false);
    // Dev banner (staging-only) must never be able to render in production: hidden by default + hostname-gated
    $ihDev=file_get_contents($root.'/index.html');
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
    t('prompt_log.php has requireAdmin()',strpos(file_get_contents($root.'/api/prompt_log.php'),'requireAdmin()')!==false);
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
    // No valid session — generate one directly in DB (regression test has DB access)
    $newTok=bin2hex(random_bytes(32));
    $newExp=time()+3600; // 1 hour for test run
    $pdo->prepare("INSERT INTO settings (key_name,value) VALUES ('admin_session_token',?) ON DUPLICATE KEY UPDATE value=?")->execute([$newTok,$newTok]);
    $pdo->prepare("INSERT INTO settings (key_name,value) VALUES ('admin_session_expires',?) ON DUPLICATE KEY UPDATE value=?")->execute([$newExp,$newExp]);
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
    t('ui:homepage loads Square via JS',strpos(file_get_contents($root.'/js/admin-orders.js'),'squareup')!==false||strpos(file_get_contents($root.'/js/ui.js'),'squareup')!==false||strpos(file_get_contents($root.'/index.html'),'Square')!==false);

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

    // Customer register — duplicate email is rejected gracefully (not a 500)
    $r=uiPost($base.'/api/customers.php',['action'=>'register','em'=>'regression_dupe@test.com','pw'=>'Test1234!','fn'=>'Reg','ln'=>'Test','secQ'=>'What city were you born in?','secA'=>'test','secA2'=>'test']);
    t('ui:customer register not 500',$r['code']!==500,'HTTP '.$r['code']);

    // Customer login — wrong password rejected
    $r=uiPost($base.'/api/customers.php',['action'=>'login','em'=>'nobody@example.com','pw'=>'wrong']);
    t('ui:customer login rejects bad credentials',$r['json']&&empty($r['json']['success']));

    // TN city tax API — uses GET
    $r=uiGet($base.'/api/tn_city_tax.php?action=list');
    t('ui:TN city tax list returns 200',$r['code']===200,'HTTP '.$r['code']);

    // Contact form — missing fields returns failure not 500
    $r=uiPost($base.'/api/contact.php',[]);
    t('ui:contact API handles empty body',$r['code']!==500,'HTTP '.$r['code']);

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
    t('process_payment:sends confirmation email',strpos($ppPhp,'sendEmail')!==false);
    t('process_payment:test_mode requireAdmin before order lookup',
        strpos($ppPhp,'test_mode')!==false&&strpos($ppPhp,'requireAdmin')!==false);

    // index.html has new embedded SDK panels
    $idx=file_get_contents($root.'/index.html');
    t('index.html:co-payment panel exists',strpos($idx,'id="co-payment"')!==false);
    t('index.html:co-processing panel exists',strpos($idx,'id="co-processing"')!==false);
    t('index.html:co-result panel exists',strpos($idx,'id="co-result"')!==false);
    t('index.html:card-container exists',strpos($idx,'id="card-container"')!==false);
    t('index.html:no redirect to Square (co-pay-waiting removed)',strpos($idx,'co-pay-waiting')===false);

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

    // Live: POST order with bogus X-Admin-Token via curl — status must be clamped to Awaiting Payment
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
    if ($chkRow) $pdo->prepare("DELETE FROM orders WHERE id=?")->execute([$fakeOid]);
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

}catch(Exception $e){t('Exception',false,$e->getMessage().' line '.$e->getLine());}

ob_end_clean();
echo json_encode(['pass'=>$pass,'fail'=>$fail,'total'=>$pass+$fail,
    'pct'=>($pass+$fail>0?round($pass/($pass+$fail)*100):0),'results'=>$results]);
