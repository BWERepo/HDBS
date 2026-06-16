<?php
// api/config.php — Shared database connection and helpers

require_once dirname(dirname(__DIR__)) . '/secrets.php';
define('DB_HOST', '127.0.0.1');
define('DB_NAME', 'u541882440_hdbs_data');
define('DB_USER', 'u541882440_hdbs_admin');
define('DB_PASS', defined('DB_PASSWORD') ? DB_PASSWORD : '');
define('PUBLIC_HTML', __DIR__ . '/..');
define('ALLOWED_ORIGIN', 'https://handmadedesignsbysuzi.com');

// ── CORS ──
function cors() {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === ALLOWED_ORIGIN || strpos($origin,'localhost')!==false || strpos($origin,'127.0.0.1')!==false) {
        header('Access-Control-Allow-Origin: ' . $origin);
    } else {
        header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
    }
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    header('Content-Type: application/json');
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit(); }
}

// ── Debug helpers ──
function _dbg_active() {
    return function_exists('dbg') && function_exists('debug_enabled') && debug_enabled();
}
function _dbg_sql_type($sql) {
    return strtoupper(strtok(ltrim($sql), " \t\n"));
}
function _dbg_sql_preview($sql) {
    return substr(preg_replace('/\s+/', ' ', trim($sql)), 0, 120);
}
function _dbg_params($params) {
    if (!$params) return '';
    $parts = array_map(function($v) {
        if ($v === null) return 'NULL';
        $s = (string)$v;
        return strlen($s) > 60 ? substr($s,0,60).'...' : $s;
    }, array_values($params));
    return ' PARAMS=['.implode(', ', $parts).']';
}
function _dbg_rows($rows) {
    if (empty($rows)) return ' ROWS=[]';
    $count = count($rows);
    // Show first row as sample
    $sample = json_encode($rows[0], JSON_UNESCAPED_UNICODE);
    if (strlen($sample) > 200) $sample = substr($sample, 0, 200).'...}';
    return " ROWS=$count sample=$sample";
}

// ── Debug-logging PDO statement wrapper ──
class DbgStatement {
    private $stmt;
    private $sql;
    private $params = [];
    public function __construct($stmt, $sql) {
        $this->stmt = $stmt;
        $this->sql  = $sql;
    }
    public function execute($params = []) {
        $this->params = $params ?: [];
        $result = $this->stmt->execute($this->params);
        if (_dbg_active()) {
            $type = _dbg_sql_type($this->sql);
            $sql  = _dbg_sql_preview($this->sql);
            $p    = _dbg_params($this->params);
            // For writes log immediately with params (data written)
            if (in_array($type, ['INSERT','UPDATE','DELETE','REPLACE'])) {
                dbg('DB-WRITE', "$type $sql$p rows_affected=".$this->stmt->rowCount());
            }
            // For reads, data is logged when fetched (see fetch/fetchAll/fetchColumn)
            if ($type === 'SELECT') {
                dbg('DB-READ', "EXECUTE $sql$p");
            }
        }
        return $result;
    }
    public function fetch($mode = PDO::FETCH_ASSOC) {
        $row = $this->stmt->fetch($mode);
        if (_dbg_active() && in_array(_dbg_sql_type($this->sql), ['SELECT','SHOW'])) {
            if ($row === false) {
                dbg('DB-READ', 'FETCH no row returned sql='._dbg_sql_preview($this->sql));
            } else {
                $s = json_encode($row, JSON_UNESCAPED_UNICODE);
                if (strlen($s) > 300) $s = substr($s,0,300).'...}';
                dbg('DB-READ', 'FETCH row='.$s);
            }
        }
        return $row;
    }
    public function fetchAll($mode = PDO::FETCH_ASSOC) {
        $rows = $this->stmt->fetchAll($mode);
        if (_dbg_active()) {
            dbg('DB-READ', 'FETCHALL'._dbg_rows($rows).' sql='._dbg_sql_preview($this->sql));
        }
        return $rows;
    }
    public function fetchColumn($col = 0) {
        $val = $this->stmt->fetchColumn($col);
        if (_dbg_active()) {
            $s = ($val === false) ? 'false' : (string)$val;
            if (strlen($s) > 100) $s = substr($s,0,100).'...';
            dbg('DB-READ', 'FETCHCOLUMN value='.$s.' sql='._dbg_sql_preview($this->sql));
        }
        return $val;
    }
    public function rowCount()         { return $this->stmt->rowCount(); }
    public function __get($k)          { return $this->stmt->$k; }
    public function __call($m, $a)     { return call_user_func_array([$this->stmt, $m], $a); }
}

// ── Debug-logging PDO wrapper ──
class DbgPDO extends PDO {
    public function prepare($sql, $opts = []) {
        $stmt = parent::prepare($sql, $opts);
        return new DbgStatement($stmt, $sql);
    }
    public function query($sql, ...$args) {
        if (_dbg_active()) {
            dbg('DB-READ', _dbg_sql_type($sql).' '._dbg_sql_preview($sql));
        }
        $result = parent::query($sql, ...$args);
        // query() returns a PDOStatement — wrap it so fetchAll/fetch log data too
        return new DbgStatement($result, $sql);
    }
    public function exec($sql) {
        $affected = parent::exec($sql);
        if (_dbg_active()) {
            $type = _dbg_sql_type($sql);
            dbg('DB-WRITE', "$type "._dbg_sql_preview($sql)." rows_affected=$affected");
        }
        return $affected;
    }
}

// ── Database connection ──
function db() {
    static $pdo = null;
    if ($pdo) return $pdo;
    try {
        // Always use DbgPDO — its methods guard with function_exists('dbg') and debug_enabled()
        $pdo = new DbgPDO(
            'mysql:host='.DB_HOST.';dbname='.DB_NAME.';charset=utf8mb4',
            DB_USER, DB_PASS,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
             PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
        );
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success'=>false,'error'=>'DB connection failed: '.$e->getMessage()]);
        exit();
    }
    return $pdo;
}

// ── Helpers ──
function body() { return json_decode(file_get_contents('php://input'), true) ?? []; }
function ok($data = []) { echo json_encode(array_merge(['success'=>true], $data)); exit(); }
function fail($msg, $code = 400) { http_response_code($code); echo json_encode(['success'=>false,'error'=>$msg]); exit(); }
function method($allowed) { if ($_SERVER['REQUEST_METHOD'] !== $allowed) fail('Method not allowed', 405); }
