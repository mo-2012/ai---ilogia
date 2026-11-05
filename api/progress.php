<?php
// يعرض تطوّر مستوى الطالب: ?student_id=...&period=week|month
require __DIR__ . '/config.php';
header('Content-Type: application/json; charset=utf-8');
$sid = (string)($_GET['student_id'] ?? '');
if (!preg_match('/^[a-zA-Z0-9-]{16,64}$/', $sid)) { http_response_code(400); echo '{"error":"bad id"}'; exit; }
$fmt = ($_GET['period'] ?? 'week') === 'month' ? '%Y-%m' : '%x-W%v';
$pdo = db();
$s = $pdo->prepare('SELECT name, grade, notes FROM students WHERE id=?'); $s->execute([$sid]);
$cur = $pdo->prepare('SELECT subject, topic, level, samples, updated_at FROM topic_levels WHERE student_id=? ORDER BY subject, level');
$cur->execute([$sid]);
$hist = $pdo->prepare("SELECT DATE_FORMAT(created_at,'$fmt') AS period, subject, ROUND(AVG(level),2) AS avg_level, COUNT(*) AS n
                       FROM assessments WHERE student_id=? GROUP BY period, subject ORDER BY MIN(created_at)");
$hist->execute([$sid]);
echo json_encode(['student' => $s->fetch(), 'current' => $cur->fetchAll(), 'history' => $hist->fetchAll()], JSON_UNESCAPED_UNICODE);
