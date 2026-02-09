-- Domains table
CREATE TABLE IF NOT EXISTS domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT UNIQUE NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Emails table
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT,
  mail_to TEXT NOT NULL,
  mail_from TEXT NOT NULL,
  subject TEXT DEFAULT '',
  body_text TEXT DEFAULT '',
  body_html TEXT DEFAULT '',
  otp TEXT DEFAULT NULL,
  domain TEXT NOT NULL,
  local_part TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_emails_to ON emails(mail_to);
CREATE INDEX IF NOT EXISTS idx_emails_local_domain ON emails(local_part, domain);
CREATE INDEX IF NOT EXISTS idx_emails_created ON emails(created_at);
