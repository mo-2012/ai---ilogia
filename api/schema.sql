-- شغّل هذا الملف مرة واحدة في phpMyAdmin (قاعدة MySQL / MariaDB)
CREATE TABLE IF NOT EXISTS students (
  id          VARCHAR(64)  NOT NULL PRIMARY KEY,
  name        VARCHAR(100) NULL,
  grade       VARCHAR(50)  NULL,
  notes       TEXT         NULL,           -- ملاحظات عامة (أهداف، أسلوب تعلّم...)
  created_at  DATETIME     NOT NULL,
  last_seen   DATETIME     NOT NULL
) CHARACTER SET utf8mb4;

-- سجل التقييمات: صف جديد بعد كل تفاعل (ده اللي بيدّيك التطوّر عبر الزمن)
CREATE TABLE IF NOT EXISTS assessments (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id  VARCHAR(64)  NOT NULL,
  chat_id     VARCHAR(40)  NULL,
  mode        VARCHAR(20)  NULL,
  subject     VARCHAR(60)  NOT NULL,
  topic       VARCHAR(120) NOT NULL,
  level       DECIMAL(3,2) NOT NULL,       -- 1.00 (مبتدئ) → 5.00 (متقدم)
  confidence  DECIMAL(3,2) NOT NULL,       -- 0 → 1 : ثقة النموذج في التقدير
  strengths   TEXT NULL,
  weaknesses  TEXT NULL,
  created_at  DATETIME NOT NULL,
  INDEX idx_student_time (student_id, created_at),
  INDEX idx_student_subject (student_id, subject)
) CHARACTER SET utf8mb4;

-- المستوى الحالي (متوسط متحرّك) لكل موضوع
CREATE TABLE IF NOT EXISTS topic_levels (
  student_id  VARCHAR(64)  NOT NULL,
  subject     VARCHAR(60)  NOT NULL,
  topic       VARCHAR(120) NOT NULL,
  level       DECIMAL(3,2) NOT NULL,
  samples     INT UNSIGNED NOT NULL DEFAULT 1,
  updated_at  DATETIME NOT NULL,
  PRIMARY KEY (student_id, subject, topic)
) CHARACTER SET utf8mb4;
