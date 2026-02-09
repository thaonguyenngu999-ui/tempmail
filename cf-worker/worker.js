/**
 * Cloudflare Email Worker
 *
 * Receives emails from Cloudflare Email Routing and forwards to your API.
 *
 * Setup:
 * 1. Go to Cloudflare Dashboard → Email → Email Routing → Email Workers
 * 2. Create a worker with this code
 * 3. Set environment variables:
 *    - API_URL: your server URL (e.g. https://mail.yourdomain.com)
 *    - API_KEY: your API key (same as server's API_KEY env var)
 * 4. For each domain: Email Routing → Routes → Catch-all → Send to Worker
 */

export default {
  async email(message, env, ctx) {
    const apiUrl = env.API_URL || 'http://localhost:3000';
    const apiKey = env.API_KEY || '';

    // Read the email body
    const rawEmail = await new Response(message.raw).text();

    // Parse basic info
    const to = message.to;
    const from = message.from;
    const subject = message.headers.get('subject') || '(no subject)';
    const messageId = message.headers.get('message-id') || '';

    // Extract text content from raw email (simple extraction)
    let text = '';
    let html = '';

    // Try to get text/plain and text/html parts
    const parts = rawEmail.split(/--[\w\-]+/);
    for (const part of parts) {
      if (part.includes('Content-Type: text/plain')) {
        text = part.split('\r\n\r\n').slice(1).join('\r\n\r\n').trim();
      }
      if (part.includes('Content-Type: text/html')) {
        html = part.split('\r\n\r\n').slice(1).join('\r\n\r\n').trim();
      }
    }

    // If no multipart, treat the whole thing as text
    if (!text && !html) {
      text = rawEmail.split('\r\n\r\n').slice(1).join('\r\n\r\n').trim();
    }

    // Forward to API
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-Api-Key'] = apiKey;

    try {
      const resp = await fetch(`${apiUrl}/api/incoming`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message_id: messageId,
          to,
          from,
          subject,
          text,
          html
        })
      });

      if (!resp.ok) {
        console.error(`API error: ${resp.status} ${await resp.text()}`);
        // Reject so CF retries
        message.setReject(`API error: ${resp.status}`);
      }
    } catch (err) {
      console.error('Failed to forward email:', err);
      message.setReject('Failed to forward');
    }
  }
};
