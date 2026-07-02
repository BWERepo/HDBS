<?php
require_once __DIR__ . '/api/config.php';
$pdo = db();
$bizName = bizName($pdo);
$bizShortName = 'By Suzi';
try {
    $bzRaw = getSetting($pdo, 'biz_profile');
    $bz = $bzRaw ? json_decode($bzRaw, true) : null;
    if (!empty($bz['short_name'])) $bizShortName = $bz['short_name'];
} catch (Exception $e) { /* keep fallback */ }
$bizNameAttr = htmlspecialchars($bizName, ENT_QUOTES, 'UTF-8');
$bizShortNameAttr = htmlspecialchars($bizShortName, ENT_QUOTES, 'UTF-8');
$bizEmail = !empty($bz['email']) ? $bz['email'] : 'handmadedesignsbysuzi@yahoo.com';
$bizEmailAttr = htmlspecialchars($bizEmail, ENT_QUOTES, 'UTF-8');
// Logo: uploaded logo is stored as a full URL (see api/admin.php save_setting); falls back to
// the original static file if no logo has been uploaded yet.
$bizLogoAbs = !empty($bz['logo']) ? $bz['logo'] : 'https://handmadedesignsbysuzi.com/HDBSLogo.jpeg?v=2';
$bizLogoAbsAttr = htmlspecialchars($bizLogoAbs, ENT_QUOTES, 'UTF-8');
$bizLogoWidth = 748; $bizLogoHeight = 913; $bizLogoMime = 'image/jpeg';
if (!empty($bz['logo'])) {
    $logoLocalPath = __DIR__ . '/business_logo/' . basename($bz['logo']);
    $dims = @getimagesize($logoLocalPath);
    if ($dims) { $bizLogoWidth = $dims[0]; $bizLogoHeight = $dims[1]; $bizLogoMime = $dims['mime']; }
}
?>
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title><?php echo $bizNameAttr; ?> — Handcrafted Bags &amp; Purses | Knoxville, TN</title>
<meta name="description" content="<?php echo $bizNameAttr; ?> — one-of-a-kind handmade tote bags and purses crafted with love in Knoxville, TN. Unique Corvette and car show themed bags, embroidered designs, and custom gifts for car enthusiasts.">
<meta name="keywords" content="handmade bags, handmade purses, tote bags, Corvette tote bag, car show gifts, ETCC tote bag, Knoxville Tennessee, embroidered bags, handcrafted purses, one of a kind bags, Corvette show merchandise, car enthusiast gifts">
<meta name="author" content="<?php echo $bizNameAttr; ?>">
<meta name="robots" content="index, follow">

<!-- Open Graph / Facebook -->
<meta property="og:type" content="website">
<meta property="og:url" content="https://handmadedesignsbysuzi.com">
<meta property="og:title" content="<?php echo $bizNameAttr; ?> — One-of-a-Kind Bags &amp; Purses">
<meta property="og:description" content="<?php echo $bizNameAttr; ?> — every bag one of a kind, handcrafted with love in Knoxville, TN. Shop tote bags, purses &amp; clutches.">
<meta property="og:image" content="<?php echo $bizLogoAbsAttr; ?>">
<meta property="og:image:width" content="<?php echo (int)$bizLogoWidth; ?>">
<meta property="og:image:height" content="<?php echo (int)$bizLogoHeight; ?>">
<meta property="og:image:type" content="<?php echo htmlspecialchars($bizLogoMime, ENT_QUOTES, 'UTF-8'); ?>">
<meta property="og:site_name" content="<?php echo $bizNameAttr; ?>">
<meta property="og:locale" content="en_US">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="<?php echo $bizNameAttr; ?> — One-of-a-Kind Bags &amp; Purses">
<meta name="twitter:description" content="<?php echo $bizNameAttr; ?> — every bag one of a kind, handcrafted with love in Knoxville, TN. Shop tote bags, purses &amp; clutches.">
<meta name="twitter:image" content="<?php echo $bizLogoAbsAttr; ?>">

<!-- Canonical URL -->
<link rel="canonical" href="https://handmadedesignsbysuzi.com">

<!-- Favicon -->
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="shortcut icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="<?php echo $bizLogoAbsAttr; ?>">
<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-0ELY03XGRE"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-0ELY03XGRE');
</script>

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="css/shop.css?v=14">
<link rel="stylesheet" href="css/table.css">
<link rel="stylesheet" href="css/toolbar.css">

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": <?php echo json_encode($bizName); ?>,
  "description": "One-of-a-kind handmade tote bags and purses, including Corvette and car show themed designs, crafted with love in Knoxville, TN.",
  "url": "https://handmadedesignsbysuzi.com",
  "email": <?php echo json_encode($bizEmail); ?>,
  "address": {
    "@type": "PostalAddress",
    "addressLocality": "Knoxville",
    "addressRegion": "TN",
    "addressCountry": "US"
  },
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": 35.9606,
    "longitude": -83.9207
  },
  "logo": <?php echo json_encode($bizLogoAbs); ?>,
  "image": <?php echo json_encode($bizLogoAbs); ?>,
  "priceRange": "$35–$200",
  "openingHours": "Mo-Su 00:00-23:59",
  "sameAs": [
    "https://handmadedesignsbysuzi.com"
  ]
}
</script>
<script>window.BIZ_NAME=<?php echo json_encode($bizName); ?>;window.BIZ_SHORT_NAME=<?php echo json_encode($bizShortName); ?>;window.BIZ_EMAIL=<?php echo json_encode($bizEmail); ?>;</script>
</head>
<body>

  <!-- Staging-only DEVELOPMENT banner shown on EVERY screen. Gated on the staging hostname, so it
       can NEVER render in production (handmadedesignsbysuzi.com has no "staging" in the host).
       Sits above all SPA page sections. -->
  <div id="dev-banner" style="display:none;background:#c62828;color:#fff;text-align:center;font-weight:700;letter-spacing:.12em;padding:.4rem 1rem;font-size:.85rem">&#9888; DEVELOPMENT &mdash; staging environment</div>
  <script>if(location.hostname.indexOf('staging')!==-1){var _db=document.getElementById('dev-banner');if(_db)_db.style.display='block';}</script>

  <!-- SIDE MENU OVERLAY -->
  <div class="menu-overlay" id="menu-overlay" onclick="closeMenu()"></div>

  <!-- SIDE MENU PANEL -->
  <div class="side-menu" id="side-menu">
    <div class="side-menu-header">
      <div class="side-menu-logo"><img src="<?php echo $bizLogoAbsAttr; ?>" alt="<?php echo $bizNameAttr; ?>" style="height:80px;width:80px;object-fit:cover;border-radius:50%;border:2px solid rgba(255,255,255,.3)"></div>
      <button class="side-menu-close" onclick="closeMenu()">×</button>
    </div>
    <div class="side-menu-nav">
      <button class="smitem" onclick="closeMenu();goStore()">
        <span class="smi-icon">🏠</span> Shop
      </button>
      <button class="smitem" onclick="closeMenu();goGallery()">
        <span class="smi-icon">🖼️</span> Gallery
      </button>
      <button class="smitem" onclick="closeMenu();goAbout()">
        <span class="smi-icon">🌸</span> About Suzi
      </button>
      <button class="smitem" onclick="closeMenu();goCustom()">
        <span class="smi-icon">🧵</span> Custom Bags
      </button>
      <button class="smitem" onclick="closeMenu();goFAQ()">
        <span class="smi-icon">❓</span> FAQ
      </button>
      <button class="smitem" onclick="closeMenu();goContact()">
        <span class="smi-icon">✉️</span> Contact Us
      </button>
      <div class="side-menu-divider"></div>
      <button class="smitem" id="sm-signin" onclick="closeMenu();goAuth('si')">
        <span class="smi-icon">👤</span> Sign In / Register
      </button>
      <button class="smitem" id="sm-account" style="display:none" onclick="closeMenu();goAuth('account')">
        <span class="smi-icon">👤</span> My Account
      </button>
      <button class="smitem" id="sm-signout" style="display:none" onclick="closeMenu();doSignOut()">
        <span class="smi-icon">🚪</span> Sign Out
      </button>
      <div class="side-menu-divider"></div>
      <button class="smitem" onclick="closeMenu();goAdminLogin()">
        <span class="smi-icon">🔧</span> Back Office
      </button>
    </div>
    <div class="side-menu-footer">
      <p>Handmade with love in<br>Knoxville, TN 🌸</p>
    </div>
  </div>

<!-- STORE -->
<div id="store">

  <nav>
    <div style="display:flex;align-items:center;gap:.3rem">
      <button class="menu-btn" id="menu-toggle" onclick="openMenu()" aria-label="Menu">
        <span></span><span></span><span></span>
      </button>
      <a href="#" onclick="showPage('store');return false;" style="display:inline-flex;align-items:center"><img src="<?php echo $bizLogoAbsAttr; ?>" alt="<?php echo $bizNameAttr; ?>" style="height:80px;width:80px;object-fit:cover;border-radius:50%;border:2px solid rgba(255,255,255,.3)"></a>
    </div>
    <div class="nav-r">
      <span id="greeting" style="color:rgba(255,255,255,.78);font-size:.81rem"></span>
      <button class="nb" id="auth-btn" onclick="goAuth('si')">Sign In</button>
      <button class="nb" id="acct-btn" style="display:none" onclick="goAuth('account')">My Account</button>
      <button class="nb" id="so-btn" style="display:none" onclick="doSignOut()">Sign Out</button>
      <button class="nb cart-nb" onclick="openCart()">🛍 Cart <span id="cart-count">0</span></button>
    </div>
  </nav>
  <div class="hero" id="hero-section">
    <div class="hero-bg" id="hero-bg"></div>
    <div class="hero-overlay"></div>
    <div class="hero-content">
      <div class="hero-overline">Handmade in Knoxville, Tennessee</div>
      <h1>Handcrafted. One of a kind.<br>Never repeated.</h1>
      <p>Upcycled tote bags, purses, and quilts — sewn one stitch at a time by Suzi.</p>
      <div class="hero-btns">
        <button class="hbtn hbtn-primary" onclick="document.getElementById('ps').scrollIntoView({behavior:'smooth'})">Shop the collection</button>
        <button class="hbtn hbtn-secondary" onclick="goCustom()">Request a custom bag</button>
      </div>
    </div>
  </div>
  <div style="background:#2B2B2B;padding:.6rem 1.5rem;text-align:center"><p style="color:#e7cfa3;font-size:.92rem;font-weight:500;letter-spacing:.04em;margin:0">Every bag is one of a kind — handcrafted, never repeated. Once it's gone, it's gone.</p></div>
  <!-- FEATURED COLLECTIONS -->
  <div class="featured" id="featured">
    <div class="sh"><h2>Shop by collection</h2><div class="shd"></div><p style="color:#6b6040;font-size:.88rem;margin-top:.4rem">Find your one of a kind</p></div>
    <div class="fc-grid" id="featured-cards"></div>
  </div>

  <!-- COMING SOON -->
  <div id="coming-soon" style="display:none">
    <div class="cs-eyebrow">First look</div>
    <div class="sh"><h2>Coming Soon</h2><div class="shd"></div><p style="color:rgba(248,246,242,.72);font-size:.9rem;margin-top:.4rem">Something beautiful is being crafted — be the first to know.</p></div>
    <div class="grid" id="cs-grid"></div>
  </div>

  <!-- GALLERY -->
  <div class="gallery-sec" id="gallery">
    <div class="sh"><h2>From my studio</h2><div class="shd"></div><p style="color:#6b6040;font-size:.88rem;margin-top:.4rem">A look at the work</p></div>
    <div class="masonry" id="gallery-grid"></div>
  </div>

  <div class="sh" id="ps"><h2>Our Collection</h2><div class="shd"></div><p style="color:#6b6040;font-size:.88rem;margin-top:.4rem">Each bag handcrafted with premium materials</p></div>
  <div id="cat-filter" style="padding:.7rem 1.5rem .2rem;display:flex;gap:.5rem;flex-wrap:wrap;max-width:1000px;margin:0 auto"></div>
  <div class="grid" id="pgrid"></div>

  <!-- ABOUT TEASER -->
  <div class="about-teaser">
    <div class="at-photo"><img src="aboutsuzi.jpeg?v=2" alt="Suzi in her studio"></div>
    <div class="at-text">
      <div class="at-overline">About Suzi</div>
      <h2>Every bag carries a story</h2>
      <p>I believe handmade pieces carry stories that mass-produced products never can. Each bag begins as a one-of-a-kind idea and an upcycled find, then becomes something you'll carry for years — sewn here in Knoxville, never repeated.</p>
      <button class="at-link" onclick="goAbout()">Read her story →</button>
    </div>
  </div>

  <!-- PROCESS -->
  <div class="process">
    <div class="sh"><h2>How a custom piece comes to life</h2><div class="shd"></div><p style="color:#6b6040;font-size:.88rem;margin-top:.4rem">Every custom bag is a collaboration</p></div>
    <div class="proc-steps">
      <div class="proc-step"><div class="proc-num">1</div><div class="proc-label">Share your idea</div></div>
      <div class="proc-step"><div class="proc-num">2</div><div class="proc-label">I sketch and design</div></div>
      <div class="proc-step"><div class="proc-num">3</div><div class="proc-label">Handmade with care</div></div>
      <div class="proc-step"><div class="proc-num">4</div><div class="proc-label">Delivered to you</div></div>
    </div>
    <div style="text-align:center;margin-top:1.4rem"><button class="hbtn hbtn-primary" onclick="goCustom()">Request a custom bag</button></div>
  </div>

  <!-- NEWSLETTER -->
  <div class="newsletter">
    <h2>🌸 Stay in the Loop</h2>
    <p>Be the first to know about new designs, special offers, and behind-the-scenes peeks at Suzi's creative process.</p>
    <div class="nl-form">
      <input class="nl-input" id="nl-email" type="email" placeholder="Enter your email address">
      <button class="nl-btn" onclick="nlSubscribe()">Subscribe</button>
    </div>
    <div class="nl-err" id="nl-err"></div>
    <div class="nl-ok" id="nl-ok">✓ You're subscribed! Thank you for joining our community 🌸</div>
  </div>

  <!-- REVIEWS SECTION -->
  <div class="reviews-section" id="reviews-section">
    <h2>What Our Customers Say</h2>
    <div class="shd" style="margin:.4rem auto .3rem"></div>
    <p style="text-align:center;color:#6b6040;font-size:.85rem">Real bags. Real customers. Real love.</p>
    <div class="reviews-grid" id="reviews-grid"><div style="text-align:center;padding:2rem;color:#6b6040;font-size:.88rem">Loading reviews…</div></div>
    <button class="reviews-submit-btn" onclick="toggleReviewForm()">✍️ Write a Review</button>
    <div class="review-form-wrap" id="review-form-wrap">
      <div style="font-weight:700;margin-bottom:.9rem;color:#2d2220">Share Your Experience</div>
      <div class="merr" id="rv-err"></div>
      <label class="fl">Your Name *</label>
      <input class="fi" id="rv-name" placeholder="Jane S.">
      <label class="fl">Product *</label>
      <input class="fi" id="rv-prod" placeholder="e.g. Corvette Tote Bag">
      <label class="fl">Rating *</label>
      <div class="star-pick" id="star-pick">
        <button onclick="setStars(1)">★</button>
        <button onclick="setStars(2)">★</button>
        <button onclick="setStars(3)">★</button>
        <button onclick="setStars(4)">★</button>
        <button onclick="setStars(5)">★</button>
      </div>
      <label class="fl">Your Review *</label>
      <textarea class="fi" id="rv-text" rows="3" placeholder="Tell us about your bag…" style="resize:vertical"></textarea>
      <button class="mbtn" style="margin-top:.5rem" onclick="submitReview()">Submit Review</button>
      <p style="font-size:.75rem;color:#6b6040;margin-top:.5rem;text-align:center">Reviews are approved before publishing.</p>
    </div>
  </div>

  <footer style="background:#2d2220;padding:1.5rem;text-align:center">
    <div style="color:rgba(255,255,255,.5);font-size:.82rem">© 2026 <?php echo $bizNameAttr; ?> · Knoxville, TN · <a href="mailto:<?php echo $bizEmailAttr; ?>" style="color:rgba(255,255,255,.5)"><?php echo $bizEmailAttr; ?></a></div>
    <div style="color:rgba(255,255,255,.5);font-size:.68rem;margin-top:.4rem">Website by East Tennessee Web Services &middot; <a href="mailto:easttnwebservices@yahoo.com" style="color:rgba(255,255,255,.5);text-decoration:underline">easttnwebservices@yahoo.com</a></div>
    <div class="site-version-line" style="color:rgba(255,255,255,.5);font-size:.6rem;margin-top:.5rem"></div>
    <div style="margin-top:1rem">
      <img src="https://handmadedesignsbysuzi.com/QRCode.png" alt="Scan to visit handmadedesignsbysuzi.com" style="width:90px;height:90px;border-radius:6px;opacity:.85">
      <div style="color:rgba(255,255,255,.35);font-size:.65rem;margin-top:.3rem">Scan to shop</div>
    </div>
  </footer>
</div>

<!-- IMAGE LIGHTBOX -->
<div class="lightbox" id="lightbox" onclick="closeLightbox()">
  <button class="lightbox-close" onclick="closeLightbox()">×</button>
  <button class="lightbox-prev" onclick="event.stopPropagation();lightboxNav(-1)">‹</button>
  <img id="lightbox-img" src="" alt="">
  <button class="lightbox-next" onclick="event.stopPropagation();lightboxNav(1)">›</button>
  <div class="lightbox-counter" id="lightbox-counter"></div>
</div>

<!-- PRODUCT DETAIL MODAL -->
<div id="pd-page"><div id="pd-content"></div></div>

<!-- THANK YOU MODAL -->
<div class="modal-ov" id="ty-modal" style="z-index:300">
  <div class="modal-box" style="max-width:480px;text-align:center;padding:0;overflow:hidden">
    <div style="background:linear-gradient(135deg,#a07810,#d4a017);padding:2.5rem 2rem 1.8rem">
      <div style="font-size:3.5rem;margin-bottom:.5rem">🎉</div>
      <h2 style="color:#fff;font-size:1.6rem;font-style:italic;margin-bottom:.3rem">Thank You!</h2>
      <div style="color:rgba(255,255,255,.88);font-size:.95rem">Your payment was received</div>
    </div>
    <div style="padding:1.8rem 2rem">
      <div id="ty-order-id" style="font-family:monospace;font-size:.82rem;color:#a07810;background:#fffdf0;border:1px solid #e8e0b8;border-radius:6px;padding:.5rem .9rem;display:inline-block;margin-bottom:1.2rem"></div>
      <p style="font-size:.92rem;color:#2d2220;line-height:1.7;margin-bottom:1rem">
        Your order has been placed and your payment confirmed.<br>
        We'll get your beautiful bag ready and ship it your way soon! 🌸
      </p>
      <p style="font-size:.82rem;color:#6b6040;margin-bottom:1.5rem;line-height:1.6">
        A confirmation has been sent to your email.<br>
        Questions? Contact us at <strong><?php echo $bizEmailAttr; ?></strong>
      </p>
      <button class="mbtn" style="max-width:260px;margin:0 auto" onclick="closeModal('ty-modal')">Continue Shopping</button>
    </div>
  </div>
</div>

<!-- CART DRAWER -->
<div class="cart-ov" id="cart-ov" onclick="closeCart()"></div>
<div class="cart-drawer" id="cart-drawer">
  <div class="cart-head"><h3>🛍 Your Cart</h3><button class="cart-close" onclick="closeCart()">×</button></div>
  <div class="cart-items" id="cart-items"></div>
  <div class="cart-foot">
    <div class="cart-total-row"><span>Subtotal</span><span class="cart-total-amt" id="cart-subtotal">$0.00</span></div>
    <button class="cart-chk-btn" onclick="openCheckout()">Proceed to Checkout →</button>
  </div>
</div>

<!-- CHECKOUT MODAL -->
<div class="modal-ov" id="co-modal">
  <div class="co-modal-box">
    <button class="modal-close" style="background:rgba(0,0,0,.12);color:#2d2220" onclick="closeModal('co-modal')">×</button>
    <div id="co-form">
      <h2 style="font-size:1.2rem;font-weight:700;margin-bottom:.2rem;color:#2d2220">Checkout</h2>
      <div style="font-size:.82rem;color:#6b6040;margin-bottom:1.2rem">Complete your purchase below.</div>
      <div class="fsec">Contact</div>
      <div class="fr"><div><label class="fl">First Name</label><input class="fi" id="co-fn" placeholder="Jane"></div><div><label class="fl">Last Name</label><input class="fi" id="co-ln" placeholder="Smith"></div></div>
      <label class="fl">Email</label><input class="fi" id="co-em" type="email" placeholder="you@email.com">
      <label class="fl">Phone</label><input class="fi" id="co-ph" placeholder="(555) 000-0000" oninput="fmtPhone(this)">
      <div class="fsec">Shipping</div>
      <label class="fl">Street</label><input class="fi" id="co-ad" placeholder="123 Main St">
      <div class="fr"><div><label class="fl">City</label><input class="fi" id="co-ci" placeholder="Nashville"></div><div><label class="fl">State / ZIP</label><input class="fi" id="co-sz" placeholder="TN 37201" oninput="updateShippingDisplay()"></div></div>
      <div class="order-summary">
        <div class="os-row"><span>Subtotal</span><span id="oc-sub">$0.00</span></div>
        <div class="os-row"><span>Shipping <span id="oc-zone" style="font-size:.74rem;color:#a07810"></span></span><span id="oc-ship">$0.00</span></div>
        <div class="os-row" style="font-style:italic;color:#6b6040"><span id="oc-tax-label">Sales Tax</span><span id="oc-tax" style="font-size:.78rem">Calc. by Square</span></div>
        <div class="os-total"><span>Est. Total</span><span id="oc-tot">$0.00</span></div>
      </div>
      <!-- InPerson payment options (shown only when store is in InPerson mode) -->
      <div id="co-inperson" style="display:none">
        <div class="fsec">Payment</div>
        <label class="fl">Payment Method</label>
        <select class="fi" id="co-paymethod" onchange="updateInPersonUI()">
          <option>Cash</option>
          <option>Check</option>
          <option>Credit Card</option>
        </select>
        <div id="co-checknum-wrap" style="display:none">
          <label class="fl">Check Number</label>
          <input class="fi" id="co-checknum" placeholder="Check number">
        </div>
        <label style="display:flex;align-items:center;gap:.5rem;margin:.5rem 0 .9rem;font-size:.85rem;color:#2d2220;cursor:pointer">
          <input type="checkbox" id="co-ship-req" checked onchange="updateShippingDisplay()">
          <span>Add shipping charge</span>
        </label>
      </div>
      <div id="co-secure-note" style="background:#fffdf0;border:1px solid #e8e0b8;border-radius:8px;padding:.8rem 1rem;font-size:.8rem;color:#6b6040;margin-bottom:.9rem;line-height:1.6">
        🔒 Your payment is processed securely by Square. Card details are never stored on our site.
      </div>
      <button class="mbtn" id="co-submit-btn" onclick="placeOrder()">Review &amp; Pay →</button>
    </div>
    <!-- STEP 2: Embedded card payment -->
    <div id="co-payment" style="display:none;padding:1.5rem">
      <div style="display:flex;align-items:center;gap:.8rem;margin-bottom:1.2rem">
        <button onclick="backToCheckoutForm()" style="background:none;border:none;cursor:pointer;font-size:1.2rem;color:#6b6040;padding:.2rem .5rem;border-radius:6px;line-height:1">←</button>
        <span style="font-weight:700;font-size:1.1rem;color:#2d2220">Secure Payment</span>
        <span style="margin-left:auto;font-size:.75rem;color:#2e7d32;white-space:nowrap">🔒 Powered by Square</span>
      </div>
      <div id="co-pay-summary" style="background:#fffdf0;border:1px solid #e8e0b8;border-radius:8px;padding:.75rem 1rem;margin-bottom:1rem;font-size:.85rem;color:#6b6040"></div>
      <div id="card-loading" style="text-align:center;padding:1.2rem;color:#6b6040;font-size:.85rem">Loading payment form…</div>
      <div id="card-container"></div>
      <div id="card-error" style="display:none;color:#c0392b;font-size:.82rem;margin:.6rem 0;padding:.6rem .8rem;background:#fde8e8;border-radius:6px;line-height:1.5"></div>
      <button id="pay-btn" class="mbtn" onclick="submitPayment()" style="margin-top:1rem;width:100%">Pay $0.00</button>
      <div style="text-align:center;margin-top:.8rem">
        <button id="co-cancel-btn" onclick="cancelPendingOrder()" style="background:none;border:none;color:#aaa;font-size:.78rem;cursor:pointer;text-decoration:underline;padding:.3rem">Cancel order</button>
      </div>
    </div>
    <!-- STEP 3: Processing spinner -->
    <div id="co-processing" style="display:none;text-align:center;padding:2.5rem 1.5rem">
      <div style="margin:0 auto 1.2rem;width:52px;height:52px;position:relative">
        <div style="position:absolute;inset:0;border-radius:50%;border:4px solid #f0e8d0"></div>
        <div style="position:absolute;inset:0;border-radius:50%;border:4px solid transparent;border-top-color:#d4a017;animation:spin .8s linear infinite"></div>
      </div>
      <div style="font-weight:700;font-size:1.1rem;color:#2d2220;margin-bottom:.4rem">Processing payment…</div>
      <div style="font-size:.85rem;color:#6b6040">Please wait, do not close this window.</div>
    </div>
    <!-- STEP 4: Result -->
    <div id="co-result" style="display:none;text-align:center;padding:2rem 1.5rem">
      <div style="font-size:3rem;margin-bottom:.6rem">✅</div>
      <div style="font-weight:700;font-size:1.2rem;color:#2d2220;margin-bottom:.4rem">Payment Successful!</div>
      <div id="co-result-body" style="font-size:.85rem;color:#6b6040;margin-bottom:1.5rem;line-height:1.6"></div>
      <button class="mbtn" onclick="closeModal('co-modal')" style="max-width:220px;margin:0 auto">Close</button>
    </div>
  </div>
</div>

<!-- CONTACT PAGE -->
<div id="contactpage" style="display:none;min-height:100vh;background:#fdfbf0">
  <nav>
    <div style="display:flex;align-items:center;gap:.3rem">
      <button class="menu-btn" onclick="openMenu()" aria-label="Menu"><span></span><span></span><span></span></button>
      <a href="#" onclick="showPage('store');return false;" style="display:inline-flex;align-items:center"><img src="<?php echo $bizLogoAbsAttr; ?>" alt="<?php echo $bizNameAttr; ?>" style="height:80px;width:80px;object-fit:cover;border-radius:50%;border:2px solid rgba(255,255,255,.3)"></a>
    </div>
    <div class="nav-r"><button class="nb" onclick="goStore()">← Back to Shop</button></div>
  </nav>
  <div style="max-width:580px;margin:3rem auto;padding:0 1.5rem">
    <h2 style="color:#a07810;text-align:center;margin-bottom:.5rem">Contact Us</h2>
    <p style="text-align:center;color:#6b6040;margin-bottom:2rem">We'd love to hear from you — questions, custom orders, or just to say hi!</p>
    <div style="background:#fff;border:1px solid #e8e0b8;border-radius:14px;padding:2rem">
      <div class="g2" style="margin-bottom:1rem">
        <div><label class="fl">First Name</label><input class="fi" id="ctc-fn" placeholder="Susan"></div>
        <div><label class="fl">Last Name</label><input class="fi" id="ctc-ln" placeholder="Smith"></div>
      </div>
      <label class="fl">Email *</label><input class="fi" id="ctc-em" type="email" placeholder="you@email.com" style="margin-bottom:1rem">
      <label class="fl">Message *</label><textarea class="fi" id="ctc-msg" rows="5" placeholder="Tell us what's on your mind…" style="margin-bottom:1rem;resize:vertical"></textarea>
      <div id="ctc-ok" style="display:none;text-align:center;padding:.7rem;background:#e8f5e9;color:#2e7d32;border-radius:8px;margin-bottom:.8rem;font-size:.88rem">✓ Message sent! We'll be in touch soon.</div>
      <div id="ctc-err" style="display:none;text-align:center;padding:.7rem;background:#fdecea;color:#c62828;border-radius:8px;margin-bottom:.8rem;font-size:.88rem"></div>
      <button class="bp" style="width:100%" onclick="submitContact()">Send Message ✉️</button>
    </div>
  </div>
</div>

<!-- AUTH PAGE -->
<!-- CUSTOM ORDERS PAGE -->
<div id="custompg" style="display:none;min-height:100vh;background:#fdfbf0">
  <nav>
    <div style="display:flex;align-items:center;gap:.3rem">
      <button class="menu-btn" onclick="openMenu()" aria-label="Menu"><span></span><span></span><span></span></button>
      <a href="#" onclick="showPage('store');return false;" style="display:inline-flex;align-items:center"><img src="<?php echo $bizLogoAbsAttr; ?>" alt="<?php echo $bizNameAttr; ?>" style="height:80px;width:80px;object-fit:cover;border-radius:50%;border:2px solid rgba(255,255,255,.3)"></a>
    </div>
    <div class="nav-r"><button class="nb" onclick="goStore()">← Back to Shop</button></div>
  </nav>

  <!-- Hero -->
  <div style="background:linear-gradient(135deg,#a07810 0%,#d4a017 100%);padding:3.5rem 2rem;text-align:center">
    <div style="font-size:2.8rem;margin-bottom:.7rem">🧵</div>
    <h1 style="color:#fff;font-size:2rem;font-style:italic;font-weight:700;margin-bottom:.5rem">Custom Handmade Orders</h1>
    <p style="color:rgba(255,255,255,.9);font-size:1rem;max-width:560px;margin:0 auto;line-height:1.7">
      Got something special in mind? Suzi can bring your vision to life — one stitch at a time.
    </p>
  </div>

  <div style="max-width:860px;margin:0 auto;padding:3rem 2rem">

    <!-- Intro -->
    <div style="text-align:center;margin-bottom:2.8rem">
      <div style="width:50px;height:3px;background:#d4a017;margin:0 auto 1.2rem;border-radius:2px"></div>
      <p style="font-size:1.05rem;color:#4a3f35;line-height:1.9;max-width:640px;margin:0 auto">
        Every bag in my collection is already one of a kind — but sometimes you want something
        <em>truly</em> personal. Whether you have a fabric that means something special to you,
        a memory you want to carry with you every day, or just a vision in your head,
        I'd love to help make it real.
      </p>
    </div>

    <!-- Ideas grid -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:1.2rem;margin-bottom:3rem">

      <div style="background:#fff;border:1px solid #e8e0b8;border-radius:14px;padding:1.5rem;text-align:center">
        <div style="font-size:2.2rem;margin-bottom:.7rem">👕</div>
        <div style="font-weight:700;color:#2d2220;margin-bottom:.5rem">Repurpose a Keepsake</div>
        <div style="font-size:.85rem;color:#6b6040;line-height:1.7">
          Have a beloved t-shirt, a worn-out denim jacket, or a vintage fabric you can't bear
          to throw away? Send it to Suzi and she'll transform it into a beautiful bag you'll
          carry forever.
        </div>
      </div>

      <div style="background:#fff;border:1px solid #e8e0b8;border-radius:14px;padding:1.5rem;text-align:center">
        <div style="font-size:2.2rem;margin-bottom:.7rem">🎨</div>
        <div style="font-weight:700;color:#2d2220;margin-bottom:.5rem">Choose Your Style</div>
        <div style="font-size:.85rem;color:#6b6040;line-height:1.7">
          Pick your colors, size, and style. Want a tote with your name embroidered on it?
          A purse in your favorite color combination? A clutch for a special occasion?
          Just ask — if Suzi can stitch it, she will.
        </div>
      </div>

      <div style="background:#fff;border:1px solid #e8e0b8;border-radius:14px;padding:1.5rem;text-align:center">
        <div style="font-size:2.2rem;margin-bottom:.7rem">🎁</div>
        <div style="font-weight:700;color:#2d2220;margin-bottom:.5rem">Perfect Gifts</div>
        <div style="font-size:.85rem;color:#6b6040;line-height:1.7">
          A custom bag makes an unforgettable gift. Birthdays, anniversaries, Mother's Day,
          graduations — imagine giving someone a bag made from fabric that tells their story.
          There's nothing like it.
        </div>
      </div>

    </div>

    <!-- How it works -->
    <div style="background:#fff;border:1px solid #e8e0b8;border-radius:14px;padding:2rem;margin-bottom:2.5rem">
      <h2 style="font-size:1.3rem;font-style:italic;color:#2d2220;margin-bottom:1.3rem;text-align:center">How It Works</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:1.2rem;text-align:center">
        <div>
          <div style="width:40px;height:40px;background:#d4a017;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:1.1rem;margin:0 auto .7rem">1</div>
          <div style="font-weight:700;color:#2d2220;margin-bottom:.3rem">Reach Out</div>
          <div style="font-size:.8rem;color:#6b6040;line-height:1.6">Fill in the form below and tell Suzi what you have in mind</div>
        </div>
        <div>
          <div style="width:40px;height:40px;background:#d4a017;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:1.1rem;margin:0 auto .7rem">2</div>
          <div style="font-weight:700;color:#2d2220;margin-bottom:.3rem">Chat with Suzi</div>
          <div style="font-size:.8rem;color:#6b6040;line-height:1.6">She'll get back to you personally to discuss your idea and agree on details</div>
        </div>
        <div>
          <div style="width:40px;height:40px;background:#d4a017;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:1.1rem;margin:0 auto .7rem">3</div>
          <div style="font-weight:700;color:#2d2220;margin-bottom:.3rem">She Gets to Work</div>
          <div style="font-size:.8rem;color:#6b6040;line-height:1.6">Sit back while Suzi crafts your one-of-a-kind piece with care and love</div>
        </div>
        <div>
          <div style="width:40px;height:40px;background:#d4a017;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:1.1rem;margin:0 auto .7rem">4</div>
          <div style="font-weight:700;color:#2d2220;margin-bottom:.3rem">It Arrives at Your Door</div>
          <div style="font-size:.8rem;color:#6b6040;line-height:1.6">Your custom bag is carefully packed and shipped straight to you</div>
        </div>
      </div>
    </div>

    <!-- Request form -->
    <div style="background:#fff;border:2px solid #e8e0b8;border-radius:14px;padding:2rem;margin-bottom:2rem">
      <h2 style="font-size:1.3rem;font-style:italic;color:#2d2220;margin-bottom:.3rem;text-align:center">Tell Suzi About Your Idea</h2>
      <p style="text-align:center;font-size:.85rem;color:#6b6040;margin-bottom:1.5rem">No commitment required — just start the conversation!</p>

      <div class="merr" id="custom-err"></div>
      <div class="contact-ok" id="custom-ok" style="display:none;text-align:center;padding:.7rem;background:#e8f5e9;color:#2e7d32;border-radius:8px;margin-bottom:.8rem;font-size:.88rem">
        ✓ Request sent! Suzi will be in touch soon. 🌸
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.8rem">
        <div><label class="fl">Your Name *</label><input class="fi" id="cust-name" placeholder="Jane Smith"></div>
        <div><label class="fl">Email *</label><input class="fi" id="cust-email" type="email" placeholder="you@email.com"></div>
      </div>
      <label class="fl">Phone (optional)</label>
      <input class="fi" id="cust-phone" placeholder="(555) 000-0000" oninput="fmtPhone(this)">
      <label class="fl">What type of bag are you thinking? *</label>
      <select class="fi" id="cust-type">
        <option value="">— Select a type —</option>
        <option>Tote Bag</option>
        <option>Purse / Handbag</option>
        <option>Crossbody Bag</option>
        <option>Clutch</option>
        <option>Mini Bag</option>
        <option>I have my own fabric to repurpose</option>
        <option>Not sure — open to suggestions</option>
      </select>
      <label class="fl">Tell Suzi about your idea *</label>
      <textarea class="fi" id="cust-idea" rows="4" placeholder="Describe what you have in mind — colors, size, occasion, or if you have a special fabric like a t-shirt or quilt piece you'd like turned into a bag…" style="resize:vertical"></textarea>
      <label class="fl">Budget range (optional)</label>
      <select class="fi" id="cust-budget">
        <option value="">— Select a range —</option>
        <option>Under $50</option>
        <option>$50 – $100</option>
        <option>$100 – $150</option>
        <option>$150+</option>
        <option>Flexible — depends on the design</option>
      </select>
      <button class="mbtn" style="margin-top:.5rem" onclick="submitCustomRequest()">Send My Request 🧵</button>
    </div>

    <p style="text-align:center;font-size:.82rem;color:#6b6040;line-height:1.7">
      Suzi reads every message personally and will reply within 1–2 business days.<br>
      You can also reach her at <a href="mailto:<?php echo $bizEmailAttr; ?>" style="color:#a07810"><?php echo $bizEmailAttr; ?></a>
    </p>
  </div>

  <footer style="background:#2d2220;padding:1.5rem;text-align:center">
    <div style="color:rgba(255,255,255,.5);font-size:.82rem">© 2026 <?php echo $bizNameAttr; ?> · Knoxville, TN</div>
    <div style="color:rgba(255,255,255,.5);font-size:.68rem;margin-top:.4rem">Website by East Tennessee Web Services &middot; <a href="mailto:easttnwebservices@yahoo.com" style="color:rgba(255,255,255,.5);text-decoration:underline">easttnwebservices@yahoo.com</a></div>
  </footer>
</div>

<!-- FAQ PAGE -->
<div id="faqpage" style="display:none;min-height:100vh;background:#fdfbf0">
  <nav>
    <div style="display:flex;align-items:center;gap:.3rem">
      <button class="menu-btn" onclick="openMenu()" aria-label="Menu"><span></span><span></span><span></span></button>
      <a href="#" onclick="showPage('store');return false;" style="display:inline-flex;align-items:center"><img src="<?php echo $bizLogoAbsAttr; ?>" alt="<?php echo $bizNameAttr; ?>" style="height:80px;width:80px;object-fit:cover;border-radius:50%;border:2px solid rgba(255,255,255,.3)"></a>
    </div>
    <div class="nav-r"><button class="nb" onclick="goStore()">← Back to Shop</button></div>
  </nav>
  <div style="background:linear-gradient(135deg,#a07810,#d4a017);padding:3rem 2rem;text-align:center">
    <div style="font-size:2.5rem;margin-bottom:.6rem">❓</div>
    <h1 style="color:#fff;font-size:2rem;font-style:italic;font-weight:700;margin-bottom:.4rem">Frequently Asked Questions</h1>
    <p style="color:rgba(255,255,255,.88);font-size:.95rem">Everything you need to know about ordering from Suzi</p>
  </div>
  <div style="max-width:720px;margin:0 auto;padding:2.5rem 2rem" id="faq-list-wrap">
    <div id="faq-list"><div style="text-align:center;padding:3rem;color:#6b6040">Loading FAQs…</div></div>
    <div style="text-align:center;margin-top:2.5rem;padding:2rem;background:#fff;border:1px solid #e8e0b8;border-radius:12px">
      <div style="font-size:1.1rem;font-weight:700;color:#2d2220;margin-bottom:.4rem">Still have questions?</div>
      <p style="font-size:.88rem;color:#6b6040;margin-bottom:1rem">I'd love to hear from you — reach out any time!</p>
      <button class="mbtn" style="max-width:200px;margin:0 auto" onclick="goContact()">Contact Me →</button>
    </div>
  </div>
  <footer style="background:#2d2220;padding:1.5rem;text-align:center">
    <div style="color:rgba(255,255,255,.5);font-size:.82rem">© 2026 <?php echo $bizNameAttr; ?> · Knoxville, TN</div>
    <div style="color:rgba(255,255,255,.5);font-size:.68rem;margin-top:.4rem">Website by East Tennessee Web Services &middot; <a href="mailto:easttnwebservices@yahoo.com" style="color:rgba(255,255,255,.5);text-decoration:underline">easttnwebservices@yahoo.com</a></div>
  </footer>
</div>

<!-- ABOUT PAGE -->
<div id="aboutpage" style="display:none;min-height:100vh;background:#fdfbf0">
  <nav>
    <div style="display:flex;align-items:center;gap:.3rem">
      <button class="menu-btn" onclick="openMenu()" aria-label="Menu"><span></span><span></span><span></span></button>
      <a href="#" onclick="showPage('store');return false;" style="display:inline-flex;align-items:center"><img src="<?php echo $bizLogoAbsAttr; ?>" alt="<?php echo $bizNameAttr; ?>" style="height:80px;width:80px;object-fit:cover;border-radius:50%;border:2px solid rgba(255,255,255,.3)"></a>
    </div>
    <div class="nav-r"><button class="nb" onclick="goStore()">← Back to Shop</button></div>
  </nav>

  <!-- Hero banner -->
  <div style="background:linear-gradient(135deg,#a07810 0%,#d4a017 100%);padding:4rem 2rem 3rem;text-align:center">
    <div style="font-size:3rem;margin-bottom:.8rem">🌸</div>
    <h1 style="color:#fff;font-size:2.2rem;font-style:italic;font-weight:700;margin-bottom:.5rem">About Suzi</h1>
    <p style="color:rgba(255,255,255,.88);font-size:1rem;max-width:500px;margin:0 auto">The maker behind every bag</p>
  </div>

  <!-- Story section -->
  <div style="max-width:780px;margin:0 auto;padding:3rem 2rem">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:3rem;align-items:center" class="about-grid">
      <div>
        <div style="width:50px;height:3px;background:#d4a017;margin-bottom:1.2rem;border-radius:2px"></div>
        <h2 style="font-size:1.6rem;font-style:italic;color:#2d2220;margin-bottom:1.2rem;line-height:1.3">From Quilting Frames to Embroidery Machines</h2>
        <p style="color:#4a3f35;line-height:1.9;font-size:.95rem;margin-bottom:1.2rem">
          I'm a retired gal who has always had a passion for creating things. For years, quilting was my love — there's something magical about transforming fabric into something beautiful and lasting.
        </p>
        <p style="color:#4a3f35;line-height:1.9;font-size:.95rem;margin-bottom:1.2rem">
          When I moved to Knoxville, my quilting frame — usually about 10 feet wide — simply wouldn't fit. Rather than give up on my craft, I discovered that an embroidery machine can do quilting too, albeit in its own unique way. And I fell in love all over again.
        </p>
        <p style="color:#4a3f35;line-height:1.9;font-size:.95rem;margin-bottom:1.5rem">
          What started as a workaround became a whole new passion — creating one-of-a-kind bags and purses with intricate embroidered details you won't find anywhere else. Every stitch, every seam, every bag is made with care, right here in Knoxville.
        </p>
        <p style="color:#a07810;font-size:1rem;font-weight:600;font-style:italic">
          "I know that you'll love your bag." — Suzi
        </p>
      </div>
      <div style="text-align:center">
        <img src="aboutsuzi.jpeg?v=2" alt="Suzi — the maker behind every bag" style="width:100%;max-width:340px;border-radius:20px;border:3px solid #e8e0b8;box-shadow:0 8px 30px rgba(0,0,0,.12);object-fit:cover">
      </div>
    </div>

    <!-- Values strip -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1.2rem;margin-top:3rem;text-align:center">
      <div style="background:#fff;border:1px solid #e8e0b8;border-radius:12px;padding:1.5rem">
        <div style="font-size:2rem;margin-bottom:.5rem">🎨</div>
        <div style="font-weight:700;color:#2d2220;margin-bottom:.3rem">Original Designs</div>
        <div style="font-size:.8rem;color:#6b6040;line-height:1.6">No two bags are ever exactly alike — each one is a unique creation</div>
      </div>
      <div style="background:#fff;border:1px solid #e8e0b8;border-radius:12px;padding:1.5rem">
        <div style="font-size:2rem;margin-bottom:.5rem">🧵</div>
        <div style="font-weight:700;color:#2d2220;margin-bottom:.3rem">Crafted with Care</div>
        <div style="font-size:.8rem;color:#6b6040;line-height:1.6">Every stitch placed with attention to quality and detail</div>
      </div>
      <div style="background:#fff;border:1px solid #e8e0b8;border-radius:12px;padding:1.5rem">
        <div style="font-size:2rem;margin-bottom:.5rem">💛</div>
        <div style="font-weight:700;color:#2d2220;margin-bottom:.3rem">Made with Love</div>
        <div style="font-size:.8rem;color:#6b6040;line-height:1.6">Retirement didn't slow me down — it gave me time to do what I love</div>
      </div>
    </div>

    <!-- CTA -->
    <div style="text-align:center;margin-top:3rem;padding:2.5rem;background:linear-gradient(135deg,#a07810,#d4a017);border-radius:16px">
      <div style="color:#fff;font-size:1.4rem;font-style:italic;font-weight:700;margin-bottom:.6rem">Ready to find your perfect bag?</div>
      <div style="color:rgba(255,255,255,.88);font-size:.9rem;margin-bottom:1.2rem">Browse the collection — each one is waiting for the right owner.</div>
      <button class="mbtn" style="max-width:220px;margin:0 auto;background:#fff;color:#a07810" onclick="goStore()">Shop the Collection →</button>
    </div>
  </div>

  <footer style="background:#2d2220;padding:1.5rem;text-align:center">
    <div style="color:rgba(255,255,255,.5);font-size:.82rem">© 2026 <?php echo $bizNameAttr; ?> · Knoxville, TN · <a href="mailto:<?php echo $bizEmailAttr; ?>" style="color:rgba(255,255,255,.5)"><?php echo $bizEmailAttr; ?></a></div>
    <div style="color:rgba(255,255,255,.5);font-size:.68rem;margin-top:.4rem">Website by East Tennessee Web Services &middot; <a href="mailto:easttnwebservices@yahoo.com" style="color:rgba(255,255,255,.5);text-decoration:underline">easttnwebservices@yahoo.com</a></div>
    <div class="site-version-line" style="color:rgba(255,255,255,.5);font-size:.6rem;margin-top:.5rem"></div>
  </footer>
</div>

<div id="authpage" style="display:none">
  <nav>
    <div style="display:flex;align-items:center;gap:.3rem">
      <button class="menu-btn" onclick="openMenu()" aria-label="Menu"><span></span><span></span><span></span></button>
      <a href="#" onclick="showPage('store');return false;" style="display:inline-flex;align-items:center"><img src="<?php echo $bizLogoAbsAttr; ?>" alt="<?php echo $bizNameAttr; ?>" style="height:80px;width:80px;object-fit:cover;border-radius:50%;border:2px solid rgba(255,255,255,.3)"></a>
    </div>
    <div class="nav-r"><button class="nb" onclick="goStore()">← Back to Shop</button></div>
  </nav>
  <div style="flex:1;display:flex;align-items:center;justify-content:center;padding:2rem">
    <div class="abox">
    <div style="font-size:1.5rem;text-align:center;margin-bottom:.4rem">🌸</div>
    <h2><?php echo $bizNameAttr; ?></h2><p class="sub">Your account</p>
    <div class="tabs" id="auth-tabs">
      <div class="tab on" id="tab-si" onclick="switchTab('si')">Sign In</div>
      <div class="tab" id="tab-su" onclick="switchTab('su')">Create Account</div>
    </div>
    <div class="sv on" id="sv-si">
      <div class="merr" id="si-err"></div>
      <label class="fl">Email</label><input class="fi" id="si-em" type="email" placeholder="you@email.com">
      <label class="fl">Password</label><input class="fi" id="si-pw" type="password" placeholder="••••••••">
      <button class="mbtn" onclick="doSignIn()">Sign In</button>
      <button class="lbk" onclick="switchTab('fp')">Forgot Password?</button>
      <button class="lbk" onclick="goStore()">← Back to Store</button>
    </div>

    <!-- CUSTOMER FORGOT PASSWORD -->
    <div class="sv" id="sv-fp">
      <!-- Step 1: enter email -->
      <div id="cfp-s1">
        <div style="font-size:.9rem;font-weight:600;color:#2d2220;margin-bottom:.3rem">🔑 Reset Password</div>
        <div style="font-size:.8rem;color:#6b6040;margin-bottom:.9rem">Enter your account email and we'll ask your security question.</div>
        <div class="merr" id="cfp-err1"></div>
        <label class="fl">Email Address</label>
        <input class="fi" id="cfp-em" type="email" placeholder="you@email.com">
        <button class="mbtn" onclick="cfpStep1()">Continue →</button>
        <button class="lbk" onclick="switchTab('si')">← Back to Sign In</button>
      </div>
      <!-- Step 2: answer security question -->
      <div id="cfp-s2" style="display:none">
        <div style="font-size:.9rem;font-weight:600;color:#2d2220;margin-bottom:.5rem">🔑 Security Question</div>
        <div id="cfp-question" style="font-size:.82rem;color:#6b6040;background:#fffdf0;border:1px solid #e8e0b8;border-radius:7px;padding:.6rem .8rem;margin-bottom:.7rem;line-height:1.5"></div>
        <div class="merr" id="cfp-err2"></div>
        <label class="fl">Your Answer</label>
        <input class="fi" id="cfp-ans" type="text" placeholder="Your answer">
        <button class="mbtn" onclick="cfpStep2()">Verify Answer →</button>
        <button class="lbk" onclick="cfpBack1()">← Back</button>
      </div>
      <!-- Step 3: set new password -->
      <div id="cfp-s3" style="display:none">
        <div style="font-size:.9rem;font-weight:600;color:#2d2220;margin-bottom:.5rem">✅ Set New Password</div>
        <div style="font-size:.8rem;color:#6b6040;margin-bottom:.9rem">Choose a new password for your account.</div>
        <div class="merr" id="cfp-err3"></div>
        <label class="fl">New Password</label>
        <input class="fi" id="cfp-pw1" type="password" placeholder="Min 6 characters">
        <label class="fl">Confirm Password</label>
        <input class="fi" id="cfp-pw2" type="password" placeholder="Repeat password">
        <button class="mbtn" onclick="cfpStep3()">Reset Password</button>
      </div>
    </div>
    <div class="sv" id="sv-su">
      <div class="merr" id="su-err"></div>
      <div class="fr"><div><label class="fl">First Name</label><input class="fi" id="su-fn" placeholder="Jane"></div><div><label class="fl">Last Name</label><input class="fi" id="su-ln" placeholder="Smith"></div></div>
      <label class="fl">Email</label><input class="fi" id="su-em" type="email" placeholder="you@email.com">
      <label class="fl">Password</label><input class="fi" id="su-pw" type="password" placeholder="Min 6 characters">
      <label class="fl">Confirm Password</label><input class="fi" id="su-pw2" type="password" placeholder="Repeat password">
      <label class="fl">Phone (optional)</label><input class="fi" id="su-ph" placeholder="(555) 000-0000" oninput="fmtPhone(this)">
      <div style="border-top:1px solid #e8e0b8;margin:.8rem 0 .9rem;padding-top:.9rem">
        <div style="font-size:.78rem;font-weight:700;color:#2d2220;margin-bottom:.2rem">🛡️ Security Question</div>
        <div style="font-size:.75rem;color:#6b6040;margin-bottom:.7rem">Used to verify your identity if you ever forget your password.</div>
        <label class="fl">Choose a question</label>
        <select class="fi" id="su-sq"><option value="">— Select a question —</option><option>What is the name of your first pet?</option><option>What city were you born in?</option><option>What is your mother's maiden name?</option><option>What was the name of your first school?</option><option>What was the make of your first car?</option><option>What street did you grow up on?</option><option>What is your oldest sibling's middle name?</option><option>What was the name of your childhood best friend?</option></select>
        <label class="fl">Your answer</label>
        <input class="fi" id="su-sa" type="text" placeholder="Your answer (case-insensitive)">
        <label class="fl">Confirm answer</label>
        <input class="fi" id="su-sa2" type="text" placeholder="Repeat your answer">
      </div>
      <button class="mbtn" onclick="doSignUp()">Create My Account</button>
      <button class="lbk" onclick="goStore()">← Back to Store</button>
    </div>
    <div class="sv" id="sv-ac">
      <div id="acct-content"></div>
      <button class="mbtn" style="background:#2d2220;margin-top:.5rem" onclick="doSignOut()">Sign Out</button>
      <button class="lbk" onclick="goStore()">← Back to Store</button>
    </div>
  </div>
  </div>
</div>

<!-- ADMIN LOGIN -->

<div id="alog" style="display:none">
  <nav>
    <div style="display:flex;align-items:center;gap:.3rem">
      <button class="menu-btn" onclick="openMenu()" aria-label="Menu"><span></span><span></span><span></span></button>
      <a href="#" onclick="showPage('store');return false;" style="display:inline-flex;align-items:center"><img src="<?php echo $bizLogoAbsAttr; ?>" alt="<?php echo $bizNameAttr; ?>" style="height:80px;width:80px;object-fit:cover;border-radius:50%;border:2px solid rgba(255,255,255,.3)"></a>
    </div>
    <div class="nav-r"><button class="nb" onclick="goStore()">← Back to Shop</button></div>
  </nav>
  <div style="flex:1;display:flex;align-items:center;justify-content:center;padding:2rem">
  <div class="lbox">
    <div style="font-size:1.6rem;margin-bottom:.3rem">🌸</div>
    <h2><?php echo $bizNameAttr; ?></h2>
    <div class="lsub">Back Office</div>
    <div class="lerr" id="lerr">Incorrect password. Please try again.</div>
    <input type="password" id="lpw" placeholder="Enter password" autocomplete="off">
    <button class="mbtn" onclick="doLogin()">Enter Back Office</button>
    <button class="lbk2" onclick="showForgot()">Forgot Password?</button>
    <button class="lbk2" onclick="goStore()">← Back to Store</button>

    <!-- FORGOT PASSWORD PANEL: step 1 — show question -->
    <div id="fp-step1" style="display:none;margin-top:1rem;border-top:1px solid #e8e0b8;padding-top:1rem">
      <div style="font-size:.88rem;font-weight:600;color:#2d2220;margin-bottom:.5rem">🔑 Reset Password</div>
      <div id="fp-question" style="font-size:.82rem;color:#6b6040;background:#fffdf0;border:1px solid #e8e0b8;border-radius:7px;padding:.6rem .8rem;margin-bottom:.6rem"></div>
      <input class="fi" id="fp-answer" type="text" placeholder="Your answer" style="width:100%;margin-bottom:.6rem">
      <div class="lerr" id="fp-err1" style="display:none">Incorrect answer. Please try again.</div>
      <button class="mbtn" onclick="checkSecAnswer()" style="margin-top:0">Verify Answer</button>
      <button class="lbk2" onclick="hideForgot()">← Back to Login</button>
    </div>

    <!-- FORGOT PASSWORD PANEL: step 2 — set new password -->
    <div id="fp-step2" style="display:none;margin-top:1rem;border-top:1px solid #e8e0b8;padding-top:1rem">
      <div style="font-size:.88rem;font-weight:600;color:#2d2220;margin-bottom:.6rem">✅ Answer correct! Set a new password:</div>
      <input class="fi" id="fp-new" type="password" placeholder="New password" style="width:100%;margin-bottom:.6rem">
      <input class="fi" id="fp-new2" type="password" placeholder="Confirm new password" style="width:100%;margin-bottom:.6rem">
      <div class="lerr" id="fp-err2" style="display:none"></div>
      <button class="mbtn" onclick="doResetPw()" style="margin-top:0">Set New Password</button>
      <button class="lbk2" onclick="hideForgot()">← Cancel</button>
    </div>
  </div>
  </div>
</div>

<!-- ADMIN PANEL -->
<div id="apanel" style="display:none">
  <div class="aside">
    <div class="alogo"><?php echo $bizNameAttr; ?><br><?php echo $bizShortNameAttr; ?><span class="asub">Back Office</span></div>
    <button class="sbk" onclick="goStore()">← Back to Store</button>
        <div id="admin-nav"></div>
  </div>
  <div class="amain">
    <div class="atop"><span id="aptitle">Dashboard</span><button class="bp" id="addbtn" style="display:none" onclick="showPF(null)">+ Add Product</button></div>
    <div class="acnt" id="acnt"></div>
  </div>
</div>

<!-- hidden file input for camera slot uploads -->
<input type="file" id="slot-file-input" accept="image/*" style="display:none">
<video id="cam-video" style="display:none" autoplay playsinline></video>

<script src="js/api.js?v=9"></script>
<script src="js/config.js?v=11"></script>
<script src="js/data.js?v=5"></script>
<script src="js/store.js?v=15"></script>
<script src="js/auth.js?v=5"></script>
<script src="js/ui.js?v=7"></script>
<script src="js/admin-nav.js?v=10"></script>
<script src="js/admin-general.js?v=5"></script>
<script src="js/admin-products.js?v=12"></script>
<script src="js/admin-orders.js?v=13"></script>
<script src="js/admin-misc.js?v=17"></script>
<script src="js/admin-business.js?v=4"></script>
<script src="js/table.js"></script>
<script src="js/toolbar.js"></script>
<script>document.addEventListener('DOMContentLoaded', function(){ TableKit.initAll(); });</script>
<script>
(function(){
  var dt=new Date();
  var ds=dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+' '+dt.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
  fetch('/api/admin.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'get_version'})})
  .then(function(r){return r.json();})
  .then(function(d){
    var txt='Version: '+(d.version||'1.0')+'   Date: '+ds;
    document.querySelectorAll('.site-version-line').forEach(function(el){el.textContent=txt;});
  }).catch(function(){
    document.querySelectorAll('.site-version-line').forEach(function(el){el.textContent='Date: '+ds;});
  });
})();
</script>
</body>
</html>
