<?php
// وسيط (proxy) آمن لإخفاء مفتاح الـ API عن المتصفح. يعمل على أي استضافة PHP عادية.
// 1) ضع مفتاحك في السطر التالي  2) في config.js اكتب API_URL: "api/chat.php"
$API_KEY = "ضع_مفتاح_ANTHROPIC_هنا";
$MODEL   = "claude-sonnet-4-5";   // يمكنك تغييره لأي نموذج متاح لحسابك
$ALLOWED_ORIGIN = "";             // مثال: "https://ilogia-eg.com" (اتركه فارغًا لنفس الموقع)

header("Content-Type: application/json; charset=utf-8");
if ($ALLOWED_ORIGIN) header("Access-Control-Allow-Origin: $ALLOWED_ORIGIN");
if ($_SERVER["REQUEST_METHOD"] !== "POST") { http_response_code(405); echo json_encode(["error" => "POST only"]); exit; }

$in = json_decode(file_get_contents("php://input"), true);
if (!$in || empty($in["messages"]) || !is_array($in["messages"])) {
  http_response_code(400); echo json_encode(["error" => "طلب غير صالح"]); exit;
}

$modes = [
  "explain"   => "اشرح الفكرة خطوة بخطوة بأمثلة واضحة.",
  "summarize" => "لخّص النص في نقاط مركزة.",
  "simplify"  => "بسّط الشرح بلغة سهلة لطالب أصغر سنًا.",
  "practice"  => "اطرح 5 أسئلة تدريبية من النص بالصيغة: سطر يبدأ بـ \"س:\" ثم سطر يبدأ بـ \"ج:\" لكل سؤال، بدون أي كلام إضافي بينها."
];
$mode    = $modes[$in["mode"] ?? "explain"] ?? $modes["explain"];
$subject = mb_substr((string)($in["subject"] ?? "عام"), 0, 40);

$system = "أنت مساعد دراسي عربي اسمه مساعد ilogia الدراسي. المادة: $subject. $mode "
        . "اكتب بالعربية الفصحى المبسّطة، بإيجاز ووضوح، وإن لم تكن متأكدًا فقل ذلك. لا تختلق معلومات.";

$msgs = [];
foreach (array_slice($in["messages"], -12) as $m) {
  $role = ($m["role"] ?? "") === "assistant" ? "assistant" : "user";
  $msgs[] = ["role" => $role, "content" => mb_substr((string)($m["content"] ?? ""), 0, 20000)];
}
// يجب أن تبدأ المحادثة برسالة user
while ($msgs && $msgs[0]["role"] !== "user") array_shift($msgs);
if (!$msgs) { http_response_code(400); echo json_encode(["error" => "لا توجد رسالة"]); exit; }

$ch = curl_init("https://api.anthropic.com/v1/messages");
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT => 60,
  CURLOPT_HTTPHEADER => [
    "content-type: application/json",
    "x-api-key: $API_KEY",
    "anthropic-version: 2023-06-01"
  ],
  CURLOPT_POSTFIELDS => json_encode([
    "model" => $MODEL, "max_tokens" => 1500, "system" => $system, "messages" => $msgs
  ], JSON_UNESCAPED_UNICODE)
]);
$res  = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$j = json_decode($res, true);
if ($code !== 200 || !isset($j["content"][0]["text"])) {
  http_response_code(502);
  echo json_encode(["error" => "تعذّر الاتصال بالخدمة (" . $code . ")"]);
  exit;
}
echo json_encode(["reply" => $j["content"][0]["text"]], JSON_UNESCAPED_UNICODE);
