import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { extractOTP } from './otp.js';

const app = new Hono();

app.use('*', cors());

// ---- Auth middleware ----
app.use('/api/*', async (c, next) => {
  const apiKey = c.env.API_KEY;
  if (!apiKey) return next();
  const key = c.req.header('x-api-key') || c.req.query('key');
  if (key !== apiKey) return c.json({ error: 'invalid api key' }, 401);
  return next();
});

// ============ DOMAIN MANAGEMENT ============

app.get('/api/domains', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM domains WHERE active = 1 ORDER BY domain'
  ).all();
  return c.json({ domains: results });
});

app.post('/api/domains', async (c) => {
  const { domain } = await c.req.json();
  if (!domain) return c.json({ error: 'domain is required' }, 400);

  try {
    await c.env.DB.prepare('INSERT INTO domains (domain) VALUES (?)')
      .bind(domain.toLowerCase().trim()).run();
    return c.json({ ok: true, domain: domain.toLowerCase().trim() });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return c.json({ error: 'domain already exists' }, 409);
    return c.json({ error: e.message }, 500);
  }
});

app.delete('/api/domains/:domain', async (c) => {
  await c.env.DB.prepare('UPDATE domains SET active = 0 WHERE domain = ?')
    .bind(c.req.param('domain')).run();
  return c.json({ ok: true });
});

// ============ INCOMING EMAIL (from CF Email Worker or webhook) ============

app.post('/api/incoming', async (c) => {
  const { message_id, to, from, subject, text, html } = await c.req.json();
  if (!to || !from) return c.json({ error: 'to and from are required' }, 400);

  const [localPart, domain] = to.toLowerCase().split('@');
  const otp = extractOTP(text || html || '');

  await c.env.DB.prepare(`
    INSERT INTO emails (message_id, mail_to, mail_from, subject, body_text, body_html, otp, domain, local_part)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    message_id || crypto.randomUUID(),
    to.toLowerCase(), from, subject || '(no subject)',
    text || '', html || '', otp, domain || '', localPart || ''
  ).run();

  return c.json({ ok: true, otp });
});

// ============ CHECK EMAILS ============

app.get('/api/mail/:address', async (c) => {
  const address = c.req.param('address').toLowerCase();
  const limit = parseInt(c.req.query('limit') || '50');

  const { results } = await c.env.DB.prepare(`
    SELECT id, message_id, mail_from, subject, otp, created_at
    FROM emails WHERE mail_to = ? ORDER BY created_at DESC LIMIT ?
  `).bind(address, limit).all();

  return c.json({ address, count: results.length, emails: results });
});

app.get('/api/mail/:address/detail/:id', async (c) => {
  const email = await c.env.DB.prepare(
    'SELECT * FROM emails WHERE id = ? AND mail_to = ?'
  ).bind(c.req.param('id'), c.req.param('address').toLowerCase()).first();

  if (!email) return c.json({ error: 'not found' }, 404);
  return c.json(email);
});

// ============ OTP ============

app.get('/api/otp/:address', async (c) => {
  const address = c.req.param('address').toLowerCase();

  const email = await c.env.DB.prepare(`
    SELECT otp, mail_from, subject, created_at
    FROM emails WHERE mail_to = ? AND otp IS NOT NULL
    ORDER BY created_at DESC LIMIT 1
  `).bind(address).first();

  if (!email) return c.json({ otp: null, message: 'no OTP found' });
  return c.json({ otp: email.otp, from: email.mail_from, subject: email.subject, time: email.created_at });
});

// OTP wait (long polling via repeated fetches on client side - Workers have 30s limit)
app.get('/api/otp/:address/wait', async (c) => {
  const address = c.req.param('address').toLowerCase();
  const since = c.req.query('since') || '1970-01-01';

  const email = await c.env.DB.prepare(`
    SELECT otp, mail_from, subject, created_at
    FROM emails WHERE mail_to = ? AND otp IS NOT NULL AND created_at > ?
    ORDER BY created_at DESC LIMIT 1
  `).bind(address, since).first();

  if (email) {
    return c.json({ otp: email.otp, from: email.mail_from, subject: email.subject, time: email.created_at });
  }
  return c.json({ otp: null, message: 'no new OTP yet' });
});

// ============ GENERATE ============

app.get('/api/generate', async (c) => {
  let domain = c.req.query('domain');

  if (!domain) {
    const d = await c.env.DB.prepare(
      'SELECT domain FROM domains WHERE active = 1 ORDER BY RANDOM() LIMIT 1'
    ).first();
    if (!d) return c.json({ error: 'no domains configured' }, 400);
    domain = d.domain;
  }

  const local = crypto.randomUUID().split('-')[0];
  return c.json({ email: `${local}@${domain}`, domain, local });
});

// ============ CLEANUP ============

app.delete('/api/cleanup', async (c) => {
  const hours = parseInt(c.req.query('hours') || '24');
  const result = await c.env.DB.prepare(
    `DELETE FROM emails WHERE created_at < datetime('now', '-' || ? || ' hours')`
  ).bind(hours).run();

  return c.json({ deleted: result.meta.changes });
});

// ============ EMAIL HANDLER (Cloudflare Email Routing) ============

async function handleEmail(message, env) {
  const to = message.to;
  const from = message.from;
  const subject = message.headers.get('subject') || '(no subject)';
  const messageId = message.headers.get('message-id') || '';

  // Read raw email
  const rawEmail = await new Response(message.raw).text();

  // Parse text/html parts
  let text = '';
  let html = '';

  const parts = rawEmail.split(/--[\w\-]+/);
  for (const part of parts) {
    if (part.includes('Content-Type: text/plain')) {
      text = part.split('\r\n\r\n').slice(1).join('\r\n\r\n').trim();
    }
    if (part.includes('Content-Type: text/html')) {
      html = part.split('\r\n\r\n').slice(1).join('\r\n\r\n').trim();
    }
  }

  if (!text && !html) {
    text = rawEmail.split('\r\n\r\n').slice(1).join('\r\n\r\n').trim();
  }

  const [localPart, domain] = to.toLowerCase().split('@');
  const otp = extractOTP(text || html || '');

  await env.DB.prepare(`
    INSERT INTO emails (message_id, mail_to, mail_from, subject, body_text, body_html, otp, domain, local_part)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    messageId || crypto.randomUUID(),
    to.toLowerCase(), from, subject,
    text, html, otp, domain || '', localPart || ''
  ).run();
}

// ============ EXPORT ============

export default {
  fetch: app.fetch,
  async email(message, env, ctx) {
    try {
      await handleEmail(message, env);
    } catch (err) {
      console.error('Email handler error:', err);
      message.setReject('Processing failed');
    }
  }
};
