# TempMail - Multi Domain Temporary Email

Dich vu email tam thoi ho tro nhieu domain, tu dong trich xuat OTP.

## Architecture

```
[Email] → [Cloudflare Email Routing] → [CF Worker] → [API Server] → [SQLite]
                                                           ↕
                                                     [Web UI / API]
```

## Quick Start

### 1. Run server

```bash
# Direct
npm install
npm start

# Docker
docker compose up -d
```

Server chay tai `http://localhost:3000`

### 2. Setup Cloudflare Email Routing

Cho moi domain (vd: `bambo.com`):

1. **Cloudflare Dashboard** → chon domain → **Email** → **Email Routing**
2. Enable Email Routing
3. **Email Workers** → Create Worker → paste code tu `cf-worker/worker.js`
4. Set environment variables:
   - `API_URL` = URL server cua ban (vd: `https://mail.yourdomain.com`)
   - `API_KEY` = key bao mat (chay `wrangler secret put API_KEY`)
5. **Routes** → **Catch-all** → Send to Worker

Lam lai buoc nay cho moi domain muon su dung.

### 3. Add domains via UI or API

```bash
# Via API
curl -X POST http://localhost:3000/api/domains \
  -H "Content-Type: application/json" \
  -d '{"domain": "bambo.com"}'
```

## API Endpoints

### Domains

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/domains` | List all domains |
| POST | `/api/domains` | Add domain `{"domain": "x.com"}` |
| DELETE | `/api/domains/:domain` | Remove domain |

### Emails

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/mail/:address` | Get all emails for address |
| GET | `/api/mail/:address/detail/:id` | Get full email |
| GET | `/api/generate?domain=x.com` | Generate random address |

### OTP (chi lay so!)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/otp/:address` | Get latest OTP |
| GET | `/api/otp/:address/wait?timeout=60` | Wait for new OTP (long polling) |

### Webhook

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/incoming` | Receive email from CF Worker |

### Cleanup

| Method | Endpoint | Description |
|--------|----------|-------------|
| DELETE | `/api/cleanup?hours=24` | Delete old emails |

## API Examples

```bash
# Check mail
curl http://localhost:3000/api/mail/1@bambo.com

# Get OTP only (chi tra ve so!)
curl http://localhost:3000/api/otp/1@bambo.com
# → {"otp": "123456", "from": "noreply@service.com", ...}

# Wait for OTP (long polling, max 60s)
curl http://localhost:3000/api/otp/1@bambo.com/wait?timeout=60
# → {"otp": "789012"} khi co OTP moi

# Generate random email
curl http://localhost:3000/api/generate?domain=bambo.com
# → {"email": "a1b2c3d4@bambo.com", ...}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `API_KEY` | _(empty)_ | API key (empty = no auth) |

## Security

Set `API_KEY` env var de bat xac thuc:

```bash
API_KEY=my-secret-key node src/server.js
```

Moi request API can header `X-Api-Key: my-secret-key` hoac query `?key=my-secret-key`.
