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
header('Access-Control-Allow-Origin: *');
set_time_limit(20);
$results=[];$pass=0;$fail=0;
function t($n,$ok,$d=''){global $results,$pass,$fail;$ok?$pass++:$fail++;$results[]=['name'=>$n,'ok'=>(bool)$ok,'detail'=>(string)$d];}

try{
require_once __DIR__.'/api/config.php';
$pdo=db();
$root=__DIR__;

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
try{t('orders exist', (int)$pdo->query("SELECT COUNT(*) FROM orders")->fetchColumn()>0);}catch(Exception $e){t('orders exist',false,$e->getMessage());}
try{t('settings exist',(int)$pdo->query("SELECT COUNT(*) FROM settings")->fetchColumn()>0);}catch(Exception $e){t('settings exist',false,$e->getMessage());}
try{$rtt=$pdo->query("SELECT value FROM settings WHERE key_name='rt_token' LIMIT 1")->fetchColumn();t('rt_token set',$rtt!==false&&strlen($rtt)>=16);}catch(Exception $e){t('rt_token set',false,$e->getMessage());}
try{$sq=$pdo->query("SELECT value FROM settings WHERE key_name='square_mode' LIMIT 1")->fetchColumn();t('square_mode set',$sq!==false);}catch(Exception $e){t('square_mode set',false,$e->getMessage());}
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
try{t('shop.css has /hero.jpg', strpos(file_get_contents($root.'/css/shop.css'),'url("/hero.jpg")')!==false);}catch(Exception $e){t('shop.css check',false,$e->getMessage());}

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
// products_csv.php exists
try{t('api/products_csv.php exists',file_exists($root.'/api/products_csv.php'));}catch(Exception $e){t('products_csv',false,$e->getMessage());}
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
        $ch=curl_init('https://handmadedesignsbysuzi.com/api/github_log.php');
        curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>15]);
        $body=curl_exec($ch);curl_close($ch);
        $gd=json_decode($body,true);
        t('github_log returns commits',isset($gd['commits'])&&count($gd['commits'])>0);
    }else{
        t('github_log returns commits',true,'skipped — no github_token set yet');
    }
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
    t('buildCustThead plain th',strpos($aojs,'buildCustThead')!==false&&strpos($aojs,"cols.map(function(col){return'<th>'+col.label+'</th>';")!==false);
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
$fns=['openCheckout','placeOrder','renderOrdersTable','viewOrder','showManualOrderForm',
      'sendConfirmEmail','rSweep','rSqPay','applyShippingConfig','rBizProfile',
      'buildAdminNav','saveNavOrder','rRegTest','runRegTests','cancelRegTests',
      'SQ_FEE_PCT','TAX_RATES','updCarrier','updTracking','deleteOrder','sendShippingEmail',
      'pfNextSku','pfAutoSku','fetchOrderTax','editCat','saveCatEdit',
      'prodSort','prodFilt','applyProdFilters','custSort','custFilt','applyCustomerFilters',
      'setAllStock1','setAllPrice1','autoAssignSkus','exportProductsCsv','showImportCsv','doImportCsv','toggleSell',
      'elSort','elFilt','elFiltApply','applyElFilters','buildElThead','rEmailLog','elRefresh','clearEmailLog',
      'setDebugMode','logFullScreen','emailLog','setPageLogMode'];
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
try{$oapi=file_get_contents($root.'/api/orders.php');t('orders.php decrements stock',strpos($oapi,'GREATEST')!==false);}catch(Exception $e){t('stock decrement',false,$e->getMessage());}
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

}catch(Exception $e){t('Exception',false,$e->getMessage().' line '.$e->getLine());}

ob_end_clean();
echo json_encode(['pass'=>$pass,'fail'=>$fail,'total'=>$pass+$fail,
    'pct'=>($pass+$fail>0?round($pass/($pass+$fail)*100):0),'results'=>$results]);
