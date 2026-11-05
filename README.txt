مساعد ilogia الدراسي — مع تتبّع مستوى الطالب
=============================================
1) phpMyAdmin: أنشئ قاعدة MySQL ثم شغّل api/schema.sql
2) عدّل api/config.php: مفتاح Anthropic (sk-ant-...) + بيانات القاعدة
3) ارفع كل الملفات إلى public_html (api/config.php لا يُرفع على GitHub)
4) تطوّر الطالب: api/progress.php?student_id=...&period=week

ملاحظة: لا تضع أي مفتاح في config.js أو app.js — يظهران لأي زائر.
