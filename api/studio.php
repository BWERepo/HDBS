<?php
// api/studio.php — Design Studio: content items (services, galleries, projects,
// testimonials, FAQs), page copy config, and commission inquiries.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/applog.php';
cors();

$method = $_SERVER['REQUEST_METHOD'];
applog('studio', $method);
$pdo    = db();
$d      = body();

// Ensure tables exist
$pdo->exec("CREATE TABLE IF NOT EXISTS studio_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    section VARCHAR(12) NOT NULL,
    title VARCHAR(150) NOT NULL DEFAULT '',
    data TEXT,
    image VARCHAR(255) NOT NULL DEFAULT '',
    sort_order INT DEFAULT 0,
    active TINYINT NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
$pdo->exec("CREATE TABLE IF NOT EXISTS studio_inquiries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(190) NOT NULL,
    phone VARCHAR(40) NOT NULL DEFAULT '',
    project_type VARCHAR(80) NOT NULL DEFAULT '',
    budget VARCHAR(60) NOT NULL DEFAULT '',
    timeline VARCHAR(60) NOT NULL DEFAULT '',
    description TEXT,
    contact_pref VARCHAR(20) NOT NULL DEFAULT '',
    inspiration TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'inquiry',
    ip VARCHAR(45) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
$pdo->exec("CREATE TABLE IF NOT EXISTS studio_project_notes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    note_text TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
// Widen status from the old 3-value scheme (new/replied/closed, VARCHAR(10)) — 'in_progress'
// is 11 chars and would otherwise get truncated on installs that predate this pipeline.
$statusCol = $pdo->query("SHOW COLUMNS FROM studio_inquiries LIKE 'status'")->fetch();
if ($statusCol && stripos($statusCol['Type'], 'varchar(10)') !== false) {
    $pdo->exec("ALTER TABLE studio_inquiries MODIFY status VARCHAR(20) NOT NULL DEFAULT 'inquiry'");
}

$STUDIO_SECTIONS = ['service','gallery','project','testimonial','faq'];
$PROJECT_STATUSES = ['inquiry','started','in_progress','completed'];

// Notes are stored as server (UTC) time; format for display in the business's own timezone,
// matching the convention already used for order timestamps (api/orders.php).
function dsFormatNoteTime($utcDatetime) {
    if (!$utcDatetime) return '';
    $dt = new DateTime($utcDatetime, new DateTimeZone('UTC'));
    $dt->setTimezone(new DateTimeZone('America/New_York'));
    return $dt->format('M j, Y g:i A');
}

// One-time seed: starter service cards + FAQs (placeholder copy for Suzi to review in the
// admin — galleries/projects/testimonials are never seeded; they stay hidden until real
// content is added).
function studioSeed($pdo) {
    $count = (int)$pdo->query("SELECT COUNT(*) FROM studio_items WHERE section='service'")->fetchColumn();
    if ($count === 0) {
        $services = [
            ['Custom Tote Bags', 'Handcrafted tote bags made from premium fabrics, including one-of-a-kind themed designs.', 'Everyday use, gifts, shopping, travel, and special occasions.', 'Corvette, floral, seasonal, patriotic, and personalized designs.'],
            ['Crossbody Bags', 'Stylish, lightweight bags designed for everyday convenience and hands-free carrying.', 'Travel, festivals, shopping, and daily use.', 'Compact crossbody bags with zipper pockets and adjustable straps.'],
            ['Custom Bags', 'Handmade bags in a variety of styles beyond totes and crossbodies, built around your fabric and features.', 'Handbags, wristlets, pouches, and everyday carry.', 'A quilted wristlet, a zippered pouch set, or a one-of-a-kind handbag.'],
            ['Custom Quilts', 'Beautiful handmade quilts created for family heirlooms, gifts, and everyday comfort.', 'Weddings, baby showers, anniversaries, and home décor.', 'Lap quilts, baby quilts, memory quilts, and seasonal designs.'],
            ['Custom Embroidery', 'Personalize bags, towels, blankets, hats, and more with names, monograms, or custom designs.', 'Birthdays, weddings, businesses, and personalized gifts.', 'Monograms, custom names, logos, and decorative embroidery.'],
            ['Memory Keepsakes', 'Transform meaningful clothing or fabric into treasured keepsakes you\'ll cherish for years.', 'Memorial gifts, baby clothes, graduation shirts, and family memories.', 'T-shirt quilts, memory pillows, keepsake bags, and embroidered remembrance gifts.'],
            ['Custom Sewing Projects', 'Have an idea? Let\'s create something completely unique just for you.', 'Special requests and custom commissions.', 'If you can imagine it, we\'ll work together to bring it to life.'],
        ];
        $ins = $pdo->prepare("INSERT INTO studio_items (section,title,data,sort_order) VALUES ('service',?,?,?)");
        foreach ($services as $i => $s) {
            $ins->execute([$s[0], json_encode(['desc'=>$s[1],'ideal'=>$s[2],'example'=>$s[3]]), $i]);
        }
    }
    $count = (int)$pdo->query("SELECT COUNT(*) FROM studio_items WHERE section='faq'")->fetchColumn();
    if ($count === 0) {
        $faqs = [
            ['How much does a custom commission cost?', 'Every project is quoted individually based on size, materials, and the time involved. After you share your idea, Suzi will send a clear quote before any work begins — no surprises.'],
            ['How long will my project take?', 'Timelines vary by project type and current workload. You\'ll get an estimated completion date with your quote, and Suzi keeps you updated at every stage.'],
            ['Can I request changes during the process?', 'Yes. Every commission includes a refinement stage where you review the work in progress and request adjustments before final delivery.'],
            ['Who owns the finished artwork?', 'You receive the finished piece, and for design work the print and usage rights are agreed up front. Suzi may share photos of the work in her portfolio unless you ask otherwise.'],
            ['Do you ship?', 'Yes — finished pieces are carefully packed and shipped to you. Local pickup or delivery may also be available in the Knoxville, TN area.'],
            ['Can I get digital files?', 'For design work like logos and branding you\'ll receive the standard digital files you need. Digital copies of artwork are available on request.'],
            ['Can you make something that isn\'t listed here?', 'Almost certainly. If it\'s creative, just ask — custom requests are the heart of the Design Studio.'],
            ['What happens in the consultation?', 'A friendly conversation — by email, phone, or text, whichever you prefer — about your vision, budget, and timeline. There\'s no commitment until you approve the quote.'],
            ['How does payment work?', 'Payment details are agreed along with your quote — typically a portion up front with the balance on completion. Options are discussed during the consultation.'],
            ['What is it like working together?', 'Personal and collaborative. You work one-on-one with Suzi from first idea to final delivery, and she reads and answers every message herself.'],
        ];
        $ins = $pdo->prepare("INSERT INTO studio_items (section,title,data,sort_order) VALUES ('faq',?,?,?)");
        foreach ($faqs as $i => $f) {
            $ins->execute([$f[0], json_encode(['answer'=>$f[1]]), $i]);
        }
    }
}

// Save a base64 data-URL image to /studio_images/, return its public URL.
// Pass-through if already a URL. Same validation as product images (JPEG/PNG, 4MB cap).
function studioSaveImage($val, $filebase) {
    if (empty($val)) return '';
    if (strpos($val, 'data:image') === false) return $val; // already a URL — keep as-is
    if (!preg_match('/^data:image\/(\w+);base64,(.+)$/s', $val, $m)) return '';
    if (strlen($m[2]) > 4 * 1024 * 1024 * 4 / 3) fail('Image too large (max 4MB)', 400);
    $bytes = base64_decode($m[2], true);
    if (!$bytes) return '';
    // Validate magic bytes: JPEG = FF D8, PNG = 89 50 4E 47
    $magic  = substr($bytes, 0, 4);
    $isJpeg = (substr($magic, 0, 2) === "\xFF\xD8");
    $isPng  = ($magic === "\x89PNG");
    if (!$isJpeg && !$isPng) fail('Invalid image format — only JPEG and PNG are accepted', 400);
    $ext = $isPng ? 'png' : 'jpg';
    $dir = dirname(__DIR__) . '/studio_images/';
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    $filename = $filebase . '.' . $ext;
    file_put_contents($dir . $filename, $bytes);
    // ALLOWED_ORIGIN keeps the URL on the environment the file was saved to (staging vs prod)
    return ALLOWED_ORIGIN . '/studio_images/' . $filename . '?t=' . time();
}

// GET — public: all items + page copy config. Admin: ?action=inquiries
if ($method === 'GET') {
    if (($_GET['action'] ?? '') === 'inquiries') {
        requireAdmin();
        $rows = $pdo->query("SELECT * FROM studio_inquiries ORDER BY created_at DESC, id DESC")->fetchAll();
        $notesByProject = [];
        foreach ($pdo->query("SELECT * FROM studio_project_notes ORDER BY created_at DESC, id DESC")->fetchAll() as $n) {
            $notesByProject[(int)$n['project_id']][] = ['id' => (int)$n['id'], 'note_text' => $n['note_text'], 'created_at' => dsFormatNoteTime($n['created_at'])];
        }
        ok(['inquiries' => array_map(function($r) use ($notesByProject) {
            $r['id'] = (int)$r['id'];
            $r['inspiration'] = $r['inspiration'] ? (json_decode($r['inspiration'], true) ?: null) : null;
            $r['notes'] = $notesByProject[$r['id']] ?? [];
            return $r;
        }, $rows)]);
    }
    studioSeed($pdo);
    $rows = $pdo->query("SELECT * FROM studio_items ORDER BY FIELD(section,'service','gallery','project','testimonial','faq'), sort_order ASC, id ASC")->fetchAll();
    $items = array_map(function($r) {
        return [
            'id'         => (int)$r['id'],
            'section'    => $r['section'],
            'title'      => $r['title'],
            'data'       => $r['data'] ? (json_decode($r['data'], true) ?: []) : [],
            'image'      => $r['image'],
            'sort_order' => (int)$r['sort_order'],
            'active'     => (int)$r['active'],
        ];
    }, $rows);
    $cfgRaw = getSetting($pdo, 'studio_config');
    ok(['items' => $items, 'config' => $cfgRaw ? (json_decode($cfgRaw, true) ?: null) : null]);
}

// POST — public inquiry submission, or admin content management
if ($method === 'POST') {
    $action = $d['action'] ?? '';

    // ── Public: commission inquiry ──
    if ($action === 'inquire') {
        // Per-IP rate limit: 5 inquiries per 15 minutes (same rate_limits table as contact.php)
        (function() use ($pdo) {
            $ip  = $_SERVER['REMOTE_ADDR'] ?? '';
            $key = md5('studio_' . $ip);
            $now = time();
            $pdo->exec("CREATE TABLE IF NOT EXISTS rate_limits (
                key_hash CHAR(32) PRIMARY KEY,
                attempts INT NOT NULL DEFAULT 0,
                last_at  INT NOT NULL DEFAULT 0
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
            $row = $pdo->prepare("SELECT attempts, last_at FROM rate_limits WHERE key_hash = ?");
            $row->execute([$key]);
            $row = $row->fetch() ?: ['attempts' => 0, 'last_at' => 0];
            if ($row['attempts'] >= 5 && ($now - $row['last_at']) < 900) {
                $mins = (int)ceil((900 - ($now - $row['last_at'])) / 60);
                fail("Too many requests. Try again in {$mins} minute" . ($mins === 1 ? '' : 's') . '.', 429);
            }
            if ($row['attempts'] >= 5) {
                $pdo->prepare("INSERT INTO rate_limits (key_hash,attempts,last_at) VALUES (?,1,?) ON DUPLICATE KEY UPDATE attempts=1,last_at=?")->execute([$key,$now,$now]);
            } else {
                $new = $row['attempts'] + 1;
                $pdo->prepare("INSERT INTO rate_limits (key_hash,attempts,last_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE attempts=?,last_at=?")->execute([$key,$new,$now,$new,$now]);
            }
        })();

        $name  = htmlspecialchars(trim($d['name']  ?? ''));
        $email = htmlspecialchars(trim($d['email'] ?? ''));
        $desc  = htmlspecialchars(trim($d['description'] ?? ''));
        if (!$name || !$email || !$desc) fail('Name, email and a project description are required');
        if (!filter_var(trim($d['email'] ?? ''), FILTER_VALIDATE_EMAIL)) fail('Invalid email address');
        $phone    = htmlspecialchars(trim($d['phone']        ?? ''));
        $type     = htmlspecialchars(trim($d['project_type'] ?? ''));
        $budget   = htmlspecialchars(trim($d['budget']       ?? ''));
        $timeline = htmlspecialchars(trim($d['timeline']     ?? ''));
        $pref     = htmlspecialchars(trim($d['contact_pref'] ?? ''));
        $inspo    = $d['inspiration'] ?? null; // {picks:[{id,title,image}], links:'...'}
        $inspoJson = $inspo ? json_encode($inspo) : null;

        $pdo->prepare("INSERT INTO studio_inquiries (name,email,phone,project_type,budget,timeline,description,contact_pref,inspiration,status,ip)
            VALUES (?,?,?,?,?,?,?,?,?,'inquiry',?)")
            ->execute([$name,$email,$phone,$type,$budget,$timeline,$desc,$pref,$inspoJson,($_SERVER['REMOTE_ADDR'] ?? '')]);
        $newProjectId = (int)$pdo->lastInsertId();

        // Email notification to Suzi (same template style + Yahoo relay rules as contact.php)
        require_once dirname(__DIR__) . '/mailer.php';
        $to       = 'handmadedesignsbysuzi@yahoo.com';
        $fullsubj = 'Design Studio Inquiry: ' . ($type ?: 'New Project') . ' — ' . $name;
        $biz_name = bizName($pdo);
        $picksHtml = '';
        if (!empty($inspo['picks']) && is_array($inspo['picks'])) {
            foreach ($inspo['picks'] as $p) {
                $pt  = htmlspecialchars($p['title'] ?? '');
                $pim = htmlspecialchars($p['image'] ?? '');
                $picksHtml .= "<div style='display:inline-block;margin:4px;text-align:center'>"
                    . ($pim ? "<img src='{$pim}' width='64' height='64' style='object-fit:cover;border-radius:8px;display:block'>" : '')
                    . "<div style='font-size:11px;color:#6b6040;max-width:72px'>{$pt}</div></div>";
            }
        }
        $linksTxt = htmlspecialchars(trim($inspo['links'] ?? ''));
        $rowsHtml =
            "<tr><td style='padding:5px 0;color:#6b6040;width:110px'>From</td><td style='padding:5px 0;font-weight:600'>{$name}</td></tr>" .
            "<tr><td style='padding:5px 0;color:#6b6040'>Email</td><td style='padding:5px 0'><a href='mailto:{$email}' style='color:#a07810'>{$email}</a></td></tr>" .
            ($phone    ? "<tr><td style='padding:5px 0;color:#6b6040'>Phone</td><td style='padding:5px 0'>{$phone}</td></tr>" : '') .
            ($type     ? "<tr><td style='padding:5px 0;color:#6b6040'>Project type</td><td style='padding:5px 0'>{$type}</td></tr>" : '') .
            ($budget   ? "<tr><td style='padding:5px 0;color:#6b6040'>Budget</td><td style='padding:5px 0'>{$budget}</td></tr>" : '') .
            ($timeline ? "<tr><td style='padding:5px 0;color:#6b6040'>Timeline</td><td style='padding:5px 0'>{$timeline}</td></tr>" : '') .
            ($pref     ? "<tr><td style='padding:5px 0;color:#6b6040'>Contact via</td><td style='padding:5px 0'>{$pref}</td></tr>" : '');
        $html_body = "<!DOCTYPE html><html><head><meta charset='UTF-8'></head>
<body style='margin:0;padding:0;background:#fffdf0;font-family:sans-serif'>
<div style='max-width:560px;margin:30px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8e0b8'>
  <div style='background:linear-gradient(135deg,#a07810,#d4a017);padding:24px 28px;text-align:center'>
    <div style='color:#fff;font-size:20px;font-style:italic;font-weight:600'>{$biz_name}</div>
    <div style='color:rgba(255,255,255,.85);font-size:13px;margin-top:4px'>New Design Studio Inquiry</div>
  </div>
  <div style='padding:24px 28px'>
    <table style='width:100%;font-size:14px;color:#2d2220;border-collapse:collapse;margin-bottom:20px'>{$rowsHtml}</table>
    <div style='background:#fffdf0;border:1px solid #e8e0b8;border-radius:8px;padding:16px;font-size:14px;color:#2d2220;line-height:1.7;white-space:pre-wrap'>{$desc}</div>" .
    ($picksHtml ? "<div style='margin-top:14px'><div style='font-size:12px;color:#6b6040;margin-bottom:4px'>Inspiration picks</div>{$picksHtml}</div>" : '') .
    ($linksTxt  ? "<div style='margin-top:14px;font-size:13px;color:#2d2220'><span style='color:#6b6040'>Inspiration links:</span><br>{$linksTxt}</div>" : '') .
    "<div style='margin-top:20px;padding:12px 16px;background:#fff8e1;border:1px solid #e8d070;border-radius:8px;font-size:13px;color:#7a5f00'>
      Click the email address above to respond directly to {$name}. This inquiry is also saved in the back office under Design Studio &gt; Inquiries.
    </div>
  </div>
  <div style='background:#2d2220;padding:14px 28px;text-align:center'>
    <div style='color:rgba(255,255,255,.5);font-size:12px'>{$biz_name} &nbsp;&middot;&nbsp; Knoxville, TN</div>
  </div>
</div>
</body></html>";
        // From (and any Reply-To) must be the SMTP-authenticated mailbox — Yahoo's relay rejects
        // both a mismatched envelope-from and a mismatched Reply-To (see contact.php).
        $result = sendEmail($to, $fullsubj, $html_body, $to, $name);
        try {
            $pdo->prepare("INSERT INTO email_log (sent_at,email_type,sent_to,order_id,subject,status,email_body) VALUES (CONVERT_TZ(NOW(),'+00:00','-04:00'),?,?,?,?,?,?)")
                ->execute(['Studio Inquiry', $to, 'DS-'.$newProjectId, $fullsubj, $result===true?'sent':'failed', $html_body]);
        } catch (Exception $e) {}
        // The inquiry is stored either way — don't fail the visitor if only the email relay hiccuped
        ok(['message' => 'Inquiry received']);
    }

    // ── Admin: content management ──
    requireAdmin();

    if ($action === 'save_item') {
        $section = $d['section'] ?? '';
        if (!in_array($section, $STUDIO_SECTIONS, true)) fail('Invalid section');
        $id    = (int)($d['id'] ?? 0);
        $title = trim($d['title'] ?? '');
        if (!$title) fail('Title is required');
        $data  = json_encode($d['data'] ?? []);
        $sort  = (int)($d['sort_order'] ?? 0);
        $active = !empty($d['active']) ? 1 : 0;
        if (!$id) {
            $pdo->prepare("INSERT INTO studio_items (section,title,data,sort_order,active) VALUES (?,?,?,?,?)")
                ->execute([$section,$title,$data,$sort,$active]);
            $id = (int)$pdo->lastInsertId();
        }
        $image = studioSaveImage($d['image'] ?? '', 'studio_' . $id);
        $pdo->prepare("UPDATE studio_items SET title=?, data=?, image=?, sort_order=?, active=? WHERE id=?")
            ->execute([$title,$data,$image,$sort,$active,$id]);
        ok(['message' => 'Saved', 'id' => $id]);
    }

    if ($action === 'delete_item') {
        $id = (int)($d['id'] ?? 0);
        if (!$id) fail('Missing id');
        // Remove the uploaded image file too (only ever touches files inside /studio_images/)
        $row = $pdo->prepare("SELECT image FROM studio_items WHERE id=?");
        $row->execute([$id]);
        $img = ($row->fetch() ?: [])['image'] ?? '';
        if ($img && strpos($img, '/studio_images/') !== false) {
            $file = dirname(__DIR__) . '/studio_images/' . basename(parse_url($img, PHP_URL_PATH));
            if (is_file($file)) @unlink($file);
        }
        $pdo->prepare("DELETE FROM studio_items WHERE id=?")->execute([$id]);
        ok(['message' => 'Deleted']);
    }

    if ($action === 'reorder') {
        $ids = $d['order'] ?? [];
        $stmt = $pdo->prepare("UPDATE studio_items SET sort_order=? WHERE id=?");
        foreach ($ids as $i => $id) $stmt->execute([$i, (int)$id]);
        ok(['message' => 'Order saved']);
    }

    if ($action === 'save_config') {
        $cfg = $d['config'] ?? null;
        if (!is_array($cfg)) fail('Missing config');
        // Hero image may arrive as a base64 upload — save to disk and store the URL
        if (!empty($cfg['hero']['image'])) {
            $cfg['hero']['image'] = studioSaveImage($cfg['hero']['image'], 'studio_hero');
        }
        setSetting($pdo, 'studio_config', json_encode($cfg));
        ok(['message' => 'Page copy saved']);
    }

    if ($action === 'inquiry_status') {
        $id = (int)($d['id'] ?? 0);
        $status = $d['status'] ?? '';
        if (!$id || !in_array($status, $PROJECT_STATUSES, true)) fail('Missing id or invalid status');
        $pdo->prepare("UPDATE studio_inquiries SET status=? WHERE id=?")->execute([$status,$id]);
        ok(['message' => 'Status updated']);
    }

    if ($action === 'add_note') {
        $projectId = (int)($d['project_id'] ?? 0);
        $noteText  = trim($d['note_text'] ?? '');
        if (!$projectId || !$noteText) fail('Missing project_id or note_text');
        $pdo->prepare("INSERT INTO studio_project_notes (project_id,note_text) VALUES (?,?)")->execute([$projectId,$noteText]);
        $id = (int)$pdo->lastInsertId();
        $row = $pdo->prepare("SELECT * FROM studio_project_notes WHERE id=?");
        $row->execute([$id]);
        $note = $row->fetch();
        ok(['message' => 'Note added', 'note' => ['id' => (int)$note['id'], 'note_text' => $note['note_text'], 'created_at' => dsFormatNoteTime($note['created_at'])]]);
    }

    if ($action === 'delete_note') {
        $id = (int)($d['id'] ?? 0);
        if (!$id) fail('Missing id');
        $pdo->prepare("DELETE FROM studio_project_notes WHERE id=?")->execute([$id]);
        ok(['message' => 'Note deleted']);
    }

    fail('Unknown action');
}

fail('Method not allowed', 405);
