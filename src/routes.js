const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { extractOTP } = require('./otp');

const router = express.Router();

// ============ DOMAIN MANAGEMENT ============

// GET /api/domains - List all active domains
router.get('/api/domains', (req, res) => {
  const domains = db.prepare('SELECT * FROM domains WHERE active = 1 ORDER BY domain').all();
  res.json({ domains });
});

// POST /api/domains - Add a new domain
router.post('/api/domains', (req, res) => {
  const { domain } = req.body;
  if (!domain) return res.status(400).json({ error: 'domain is required' });

  try {
    db.prepare('INSERT INTO domains (domain) VALUES (?)').run(domain.toLowerCase().trim());
    res.json({ ok: true, domain: domain.toLowerCase().trim() });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'domain already exists' });
    }
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/domains/:domain - Remove a domain
router.delete('/api/domains/:domain', (req, res) => {
  db.prepare('UPDATE domains SET active = 0 WHERE domain = ?').run(req.params.domain);
  res.json({ ok: true });
});

// ============ EMAIL WEBHOOK (from CF Worker) ============

// POST /api/incoming - Receive email from Cloudflare Worker
router.post('/api/incoming', (req, res) => {
  const { message_id, to, from, subject, text, html } = req.body;

  if (!to || !from) {
    return res.status(400).json({ error: 'to and from are required' });
  }

  const [localPart, domain] = to.toLowerCase().split('@');
  const otp = extractOTP(text || html || '');

  db.prepare(`
    INSERT INTO emails (message_id, mail_to, mail_from, subject, body_text, body_html, otp, domain, local_part)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    message_id || uuidv4(),
    to.toLowerCase(),
    from,
    subject || '(no subject)',
    text || '',
    html || '',
    otp,
    domain || '',
    localPart || ''
  );

  res.json({ ok: true, otp });
});

// ============ CHECK EMAILS ============

// GET /api/mail/:address - Get all emails for an address
// Example: GET /api/mail/1@bambo.com
router.get('/api/mail/:address', (req, res) => {
  const address = req.params.address.toLowerCase();
  const limit = parseInt(req.query.limit) || 50;

  const emails = db.prepare(`
    SELECT id, message_id, mail_from, subject, otp, created_at
    FROM emails
    WHERE mail_to = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(address, limit);

  res.json({ address, count: emails.length, emails });
});

// GET /api/mail/:address/detail/:id - Get full email content
router.get('/api/mail/:address/detail/:id', (req, res) => {
  const email = db.prepare(`
    SELECT * FROM emails WHERE id = ? AND mail_to = ?
  `).get(req.params.id, req.params.address.toLowerCase());

  if (!email) return res.status(404).json({ error: 'not found' });
  res.json(email);
});

// GET /api/otp/:address - Get latest OTP only (just the number!)
// Example: GET /api/otp/1@bambo.com → { "otp": "123456" }
router.get('/api/otp/:address', (req, res) => {
  const address = req.params.address.toLowerCase();

  const email = db.prepare(`
    SELECT otp, mail_from, subject, created_at
    FROM emails
    WHERE mail_to = ? AND otp IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1
  `).get(address);

  if (!email) {
    return res.json({ otp: null, message: 'no OTP found' });
  }

  res.json({
    otp: email.otp,
    from: email.mail_from,
    subject: email.subject,
    time: email.created_at
  });
});

// GET /api/otp/:address/wait - Wait for new OTP (long polling, max 60s)
router.get('/api/otp/:address/wait', async (req, res) => {
  const address = req.params.address.toLowerCase();
  const timeout = Math.min(parseInt(req.query.timeout) || 60, 120) * 1000;
  const since = req.query.since || new Date().toISOString();

  const start = Date.now();
  const check = () => {
    const email = db.prepare(`
      SELECT otp, mail_from, subject, created_at
      FROM emails
      WHERE mail_to = ? AND otp IS NOT NULL AND created_at > ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(address, since);

    if (email) {
      return res.json({
        otp: email.otp,
        from: email.mail_from,
        subject: email.subject,
        time: email.created_at
      });
    }

    if (Date.now() - start >= timeout) {
      return res.json({ otp: null, message: 'timeout' });
    }

    setTimeout(check, 2000);
  };

  check();
});

// ============ GENERATE RANDOM ADDRESS ============

// GET /api/generate?domain=bambo.com - Generate a random temp email
router.get('/api/generate', (req, res) => {
  let domain = req.query.domain;

  if (!domain) {
    const d = db.prepare('SELECT domain FROM domains WHERE active = 1 ORDER BY RANDOM() LIMIT 1').get();
    if (!d) return res.status(400).json({ error: 'no domains configured' });
    domain = d.domain;
  }

  const local = uuidv4().split('-')[0];
  res.json({ email: `${local}@${domain}`, domain, local });
});

// ============ CLEANUP ============

// DELETE /api/cleanup?hours=24 - Delete emails older than X hours
router.delete('/api/cleanup', (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const result = db.prepare(`
    DELETE FROM emails WHERE created_at < datetime('now', ? || ' hours')
  `).run(`-${hours}`);

  res.json({ deleted: result.changes });
});

module.exports = router;
