# TempMail - Full Cloudflare

Email tam thoi, nhieu domain, auto OTP. Chay hoan toan tren Cloudflare (free, khong can VPS).

```
[Email] → [CF Email Routing] → [Worker (email handler)]
                                      ↓
                                 [D1 Database]
                                      ↑
[Browser/API] → [Worker (API + UI)] → [D1 Database]
```

## Setup

### 1. Install & Login Cloudflare

```bash
npm install
npx wrangler login
```

### 2. Tao D1 Database

```bash
npx wrangler d1 create tempmail-db
```

Copy `database_id` vao `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "tempmail-db"
database_id = "xxxx-xxxx-xxxx"   # ← paste here
```

### 3. Chay migration

```bash
# Remote (production)
npm run db:migrate

# Local dev
npm run db:migrate:local
```

### 4. Deploy

```bash
npm run deploy
```

Worker se chay tai `https://tempmail.<your-account>.workers.dev`

### 5. Setup Email Routing (cho moi domain)

1. **CF Dashboard** → chon domain (vd `bambo.com`)
2. **Email** → **Email Routing** → Enable
3. Tab **Email Workers** → route toi worker `tempmail`
4. **Routing rules** → **Catch-all** → Send to Worker `tempmail`

Lap lai cho moi domain.

### 6. Them domain vao he thong

Mo web UI hoac:

```bash
curl -X POST https://tempmail.xxx.workers.dev/api/domains \
  -H "Content-Type: application/json" \
  -d '{"domain": "bambo.com"}'
```

## API

### Domains
- `GET  /api/domains` - list domains
- `POST /api/domains` - add `{"domain":"x.com"}`
- `DELETE /api/domains/:domain` - remove

### Emails
- `GET /api/mail/:address` - inbox (vd `/api/mail/1@bambo.com`)
- `GET /api/mail/:address/detail/:id` - full email

### OTP (chi tra ve so!)
- `GET /api/otp/:address` → `{"otp":"123456"}`
- `GET /api/otp/:address/wait?since=...` - poll cho OTP moi

### Utils
- `GET /api/generate?domain=bambo.com` - random email
- `DELETE /api/cleanup?hours=24` - xoa email cu

## Vi du

```bash
# Lay OTP cua 1@bambo.com
curl https://tempmail.xxx.workers.dev/api/otp/1@bambo.com
# → {"otp":"483921","from":"noreply@service.com",...}

# Poll doi OTP moi
curl https://tempmail.xxx.workers.dev/api/otp/1@bambo.com/wait?since=2024-01-01
```

## Bao mat

Set API_KEY:
```bash
npx wrangler secret put API_KEY
```

Sau do moi request can header `X-Api-Key: xxx` hoac query `?key=xxx`.

## Dev local

```bash
npm run dev
```

Chay local tai `http://localhost:8787`
