<?php
require __DIR__ . '/config.php';
header('Content-Type: application/json; charset=utf-8');

function out($arr, $code = 200) { http_response_code($code); echo json_encode($arr, JSON_UNESCAPED_UNICODE); exit; }

function claude($model, $system, $messages, $max) {
  $ch = curl_init('https://api.anthropic.com/v1/messages');
  curl_setopt_array($ch, [
    CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 90,
    CURLOPT_HTTPHEADER => ['content-type: application/json', 'x-api-key: ' . ANTHROPIC_API_KEY, 'anthropic-version: 2023-06-01'],
    CURLOPT_POSTFIELDS => json_encode(['model' => $model, 'max_tokens' => $max, 'system' => $system, 'messages' => $messages], JSON_UNESCAPED_UNICODE),
  ]);
  $r = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
  $j = json_decode($r, true);
  if ($code !== 200 || !isset($j['content'][0]['text'])) throw new Exception($j['error']['message'] ?? 'AI error');
  return $j['content'][0]['text'];
}

// يضمن أن الرسائل تبدأ بـ user وتتبادل الأدوار
function clean_messages($msgs) {
  $res = [];
  foreach ($msgs as $m) {
    $role = ($m['role'] ?? '') === 'assistant' ? 'assistant' : 'user';
    $text = mb_substr((string)($m['content'] ?? ''), 0, 60000);
    if ($text === '') continue;
    if (!$res && $role !== 'user') continue;
    if ($res && end($res)['role'] === $role) { $res[count($res) - 1]['content'] .= "\n" . $text; continue; }
    $res[] = ['role' => $role, 'content' => $text];
  }
  return $res;
}

$in = json_decode(file_get_contents('php://input'), true);
if (!is_array($in)) out(['error' => 'طلب غير صالح'], 400);
$sid = (string)($in['student_id'] ?? '');
if (!preg_match('/^[a-zA-Z0-9-]{16,64}$/', $sid)) out(['error' => 'معرّف الطالب غير صالح'], 400);
$mode    = in_array($in['mode'] ?? '', ['explain', 'summarize', 'simplify', 'practice']) ? $in['mode'] : 'explain';
$subject = mb_substr((string)($in['subject'] ?? 'عام'), 0, 60);
$chatId  = mb_substr(preg_replace('/[^a-zA-Z0-9]/', '', (string)($in['chat_id'] ?? '')), 0, 40);
$messages = clean_messages($in['messages'] ?? []);
if (!$messages) out(['error' => 'لا توجد رسالة'], 400);

try {
  $pdo = db(); $now = date('Y-m-d H:i:s');
  $pdo->prepare('INSERT INTO students (id, created_at, last_seen) VALUES (?,?,?) ON DUPLICATE KEY UPDATE last_seen = VALUES(last_seen)')->execute([$sid, $now, $now]);
  $st = $pdo->prepare('SELECT name, grade, notes FROM students WHERE id = ?'); $st->execute([$sid]); $stu = $st->fetch();
  $tl = $pdo->prepare('SELECT topic, level FROM topic_levels WHERE student_id = ? AND subject = ? ORDER BY updated_at DESC LIMIT 12');
  $tl->execute([$sid, $subject]); $levels = $tl->fetchAll();
} catch (Exception $e) { out(['error' => 'خطأ في قاعدة البيانات'], 500); }

// ---- بناء تعليمات النموذج مع ملف الطالب ----
$modes = [
  'explain'   => 'اشرح الدرس بوضوح خطوة بخطوة مع مثال.',
  'summarize' => 'لخّص النص في نقاط قصيرة ومركّزة.',
  'simplify'  => 'بسّط الفكرة بلغة سهلة وأمثلة من الحياة اليومية.',
  'practice'  => 'اكتب أسئلة تدريبية بالصيغة: "س: ..." ثم في سطر جديد "ج: ..." لكل سؤال.',
];
$profile = "";
if ($stu['name'])  $profile .= "اسم الطالب: {$stu['name']}\n";
if ($stu['grade']) $profile .= "الصف: {$stu['grade']}\n";
if ($stu['notes']) $profile .= "ملاحظات: {$stu['notes']}\n";
if ($levels) {
  $profile .= "مستواه الحالي في مادة $subject (من 1 إلى 5):\n";
  foreach ($levels as $l) $profile .= "- {$l['topic']}: {$l['level']}\n";
}
$system = "أنت مساعد دراسي عربي ودود لطلاب المدارس. المادة: $subject. المطلوب: {$modes[$mode]}\n"
  . "اكتب بالعربية البسيطة. كيّف الصعوبة والأمثلة مع مستوى الطالب أدناه.\n"
  . "لا تطلب بيانات شخصية حساسة (عنوان، هاتف، صور). إن لم تعرف صف الطالب يمكنك سؤاله مرة واحدة بشكل طبيعي.\n"
  . ($profile ? "\nملف الطالب:\n$profile" : "\n(لا توجد معلومات سابقة عن الطالب)\n");

try { $reply = claude(CHAT_MODEL, $system, $messages, 1500); }
catch (Exception $e) { out(['error' => 'تعذّر الحصول على رد من الذكاء الاصطناعي'], 502); }

// ---- نرسل الرد للطالب فورًا ثم نحلّل المستوى في الخلفية ----
$body = json_encode(['reply' => $reply], JSON_UNESCAPED_UNICODE);
header('Content-Length: ' . strlen($body)); header('Connection: close');
echo $body;
if (function_exists('fastcgi_finish_request')) fastcgi_finish_request(); else { @ob_end_flush(); @flush(); }
ignore_user_abort(true);

try {
  $last = end($messages);
  $assessSys = "أنت محلّل تعليمي. اقرأ آخر تفاعل بين الطالب والمساعد وقدّر مستوى الطالب في الموضوع المطروح "
    . "اعتمادًا على جودة سؤاله وما يبدو أنه يعرفه أو لا يعرفه. أخرج JSON فقط بلا أي نص آخر وبهذا الشكل:\n"
    . '{"topic":"اسم الدرس/الموضوع باختصار","level":3.0,"confidence":0.5,"strengths":["..."],"weaknesses":["..."],'
    . '"profile":{"name":null,"grade":null,"notes":null}}' . "\n"
    . "level من 1 (مبتدئ) إلى 5 (متقدم). confidence من 0 إلى 1 (اجعلها منخفضة إذا كانت الأدلة قليلة). "
    . "profile: املأ فقط ما ذكره الطالب صراحةً (اسمه، صفه، هدف أو صعوبة عامة) وإلا null. "
    . 'إذا لم يوجد ما يمكن تقييمه (تحية مثلًا) أخرج {"skip":true}.' . "\n"
    . "مادة: $subject\nالمستوى المسجّل سابقًا: " . ($levels ? json_encode($levels, JSON_UNESCAPED_UNICODE) : 'لا يوجد');
  $txt = claude(ASSESS_MODEL, $assessSys, [['role' => 'user', 'content' =>
        "الطالب: " . mb_substr($last['content'], 0, 3000) . "\n\nالمساعد: " . mb_substr($reply, 0, 3000)]], 500);
  $a = json_decode(substr($txt, strpos($txt, '{'), strrpos($txt, '}') - strpos($txt, '{') + 1), true);
  if (!is_array($a) || !empty($a['skip']) || empty($a['topic']) || !isset($a['level'])) exit;

  $topic = mb_substr(trim($a['topic']), 0, 120);
  $level = max(1, min(5, (float)$a['level']));
  $conf  = max(0, min(1, (float)($a['confidence'] ?? 0.5)));
  $join  = function ($v) { return is_array($v) ? mb_substr(implode('، ', array_map('strval', $v)), 0, 500) : null; };

  $pdo->prepare('INSERT INTO assessments (student_id, chat_id, mode, subject, topic, level, confidence, strengths, weaknesses, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      ->execute([$sid, $chatId, $mode, $subject, $topic, $level, $conf, $join($a['strengths'] ?? null), $join($a['weaknesses'] ?? null), date('Y-m-d H:i:s')]);

  // متوسط متحرّك: كل ما زادت الثقة زاد وزن التقدير الجديد
  $old = $pdo->prepare('SELECT level FROM topic_levels WHERE student_id=? AND subject=? AND topic=?');
  $old->execute([$sid, $subject, $topic]); $o = $old->fetchColumn();
  $w = 0.3 + 0.4 * $conf;
  $new = $o === false ? $level : round((float)$o * (1 - $w) + $level * $w, 2);
  $pdo->prepare('INSERT INTO topic_levels (student_id, subject, topic, level, samples, updated_at) VALUES (?,?,?,?,1,?) '
              . 'ON DUPLICATE KEY UPDATE level=VALUES(level), samples=samples+1, updated_at=VALUES(updated_at)')
      ->execute([$sid, $subject, $topic, $new, date('Y-m-d H:i:s')]);

  // معلومات الطالب المذكورة صراحةً (لا تُكتب فوق قيمة موجودة بقيمة فارغة)
  $p = $a['profile'] ?? [];
  if (is_array($p)) {
    $pdo->prepare('UPDATE students SET name = COALESCE(?, name), grade = COALESCE(?, grade), notes = COALESCE(?, notes) WHERE id = ?')
        ->execute([
          !empty($p['name'])  ? mb_substr((string)$p['name'], 0, 100) : null,
          !empty($p['grade']) ? mb_substr((string)$p['grade'], 0, 50) : null,
          !empty($p['notes']) ? mb_substr((string)$p['notes'], 0, 1000) : null,
          $sid]);
  }
} catch (Exception $e) { error_log('assess: ' . $e->getMessage()); }
