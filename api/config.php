<?php
// ⚠️ هذا الملف على السيرفر فقط. لا ترفعه على GitHub.
define('ANTHROPIC_API_KEY', 'ضع_مفتاح_Anthropic_هنا');   // يبدأ بـ sk-ant-
define('CHAT_MODEL',   'claude-sonnet-5-5');            // الرد على الطالب
define('ASSESS_MODEL', 'claude-haiku-5-5');             // تحليل المستوى (أرخص وأسرع)

define('DB_HOST', 'localhost');
define('DB_NAME', 'اسم_القاعدة');
define('DB_USER', 'اسم_المستخدم');
define('DB_PASS', 'كلمة_المرور');

function db() {
  static $pdo = null;
  if (!$pdo) {
    $pdo = new PDO('mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4', DB_USER, DB_PASS, [
      PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
      PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
  }
  return $pdo;
}
