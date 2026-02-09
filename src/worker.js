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

// ============ EMAIL DECODING HELPERS ============

function decodeQuotedPrintable(str) {
  // Remove soft line breaks (=\r\n or =\n)
  str = str.replace(/=\r?\n/g, '');
  // Decode =XX hex sequences
  return str.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

function decodeBase64(str) {
  try {
    // Remove line breaks, then decode
    const clean = str.replace(/\r?\n/g, '');
    const bytes = Uint8Array.from(atob(clean), c => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return str;
  }
}

function decodeContent(content, encoding) {
  if (!content || !encoding) return content || '';
  encoding = encoding.toLowerCase().trim();
  if (encoding === 'quoted-printable') return decodeQuotedPrintable(content);
  if (encoding === 'base64') return decodeBase64(content);
  return content;
}

function decodeHeader(raw) {
  if (!raw) return '';
  // Decode RFC 2047 encoded headers: =?charset?encoding?text?=
  return raw.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, enc, text) => {
    if (enc.toUpperCase() === 'B') {
      try {
        const bytes = Uint8Array.from(atob(text), c => c.charCodeAt(0));
        return new TextDecoder(charset).decode(bytes);
      } catch { return text; }
    }
    if (enc.toUpperCase() === 'Q') {
      const decoded = text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g,
        (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      try {
        const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
        return new TextDecoder(charset).decode(bytes);
      } catch { return decoded; }
    }
    return text;
  });
}

function parseMimePart(part) {
  const headerEnd = part.indexOf('\r\n\r\n');
  if (headerEnd === -1) {
    const headerEnd2 = part.indexOf('\n\n');
    if (headerEnd2 === -1) return { headers: '', body: part };
    return { headers: part.substring(0, headerEnd2), body: part.substring(headerEnd2 + 2) };
  }
  return { headers: part.substring(0, headerEnd), body: part.substring(headerEnd + 4) };
}

function getHeader(headers, name) {
  const regex = new RegExp(`^${name}:\\s*(.+?)$`, 'im');
  const match = headers.match(regex);
  // Handle folded headers (continuation lines starting with whitespace)
  if (match) {
    let val = match[1];
    const lines = headers.split(/\r?\n/);
    let found = false;
    for (const line of lines) {
      if (found && /^\s/.test(line)) {
        val += ' ' + line.trim();
      } else if (line.toLowerCase().startsWith(name.toLowerCase() + ':')) {
        found = true;
      } else if (found) {
        break;
      }
    }
    return val.trim();
  }
  return '';
}

// ============ EMAIL HANDLER (Cloudflare Email Routing) ============

async function handleEmail(message, env) {
  const to = message.to;
  const from = message.from;
  const rawSubject = message.headers.get('subject') || '(no subject)';
  const subject = decodeHeader(rawSubject);
  const messageId = message.headers.get('message-id') || '';

  // Read raw email
  const rawEmail = await new Response(message.raw).text();

  let text = '';
  let html = '';

  // Find boundary from Content-Type header
  const ctHeader = getHeader(rawEmail.split(/\r?\n\r?\n/)[0] || '', 'Content-Type');
  const boundaryMatch = ctHeader.match(/boundary="?([^"\s;]+)"?/i);

  if (boundaryMatch) {
    // Multipart email
    const boundary = boundaryMatch[1];
    const parts = rawEmail.split('--' + boundary);

    for (const part of parts) {
      const { headers, body } = parseMimePart(part);
      const ct = getHeader(headers, 'Content-Type').toLowerCase();
      const cte = getHeader(headers, 'Content-Transfer-Encoding');

      if (ct.includes('text/plain') && !text) {
        text = decodeContent(body.trim(), cte);
      }
      if (ct.includes('text/html') && !html) {
        html = decodeContent(body.trim(), cte);
      }

      // Handle nested multipart (e.g. multipart/alternative inside multipart/mixed)
      const nestedBoundary = ct.match(/boundary="?([^"\s;]+)"?/i);
      if (nestedBoundary) {
        const nestedParts = body.split('--' + nestedBoundary[1]);
        for (const np of nestedParts) {
          const nested = parseMimePart(np);
          const nct = getHeader(nested.headers, 'Content-Type').toLowerCase();
          const ncte = getHeader(nested.headers, 'Content-Transfer-Encoding');
          if (nct.includes('text/plain') && !text) {
            text = decodeContent(nested.body.trim(), ncte);
          }
          if (nct.includes('text/html') && !html) {
            html = decodeContent(nested.body.trim(), ncte);
          }
        }
      }
    }
  } else {
    // Single part email
    const { headers, body } = parseMimePart(rawEmail);
    const cte = getHeader(headers, 'Content-Transfer-Encoding');
    const ct = getHeader(headers, 'Content-Type').toLowerCase();

    const decoded = decodeContent(body.trim(), cte);
    if (ct.includes('text/html')) {
      html = decoded;
    } else {
      text = decoded;
    }
  }

  // Fallback
  if (!text && !html) {
    text = rawEmail.split(/\r?\n\r?\n/).slice(1).join('\n\n').trim();
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
