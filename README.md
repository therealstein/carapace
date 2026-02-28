<p align="center">
  <img src="logo.png" alt="Carapace" width="400">
</p>

<p align="center">
  <strong>SHELL UP. LOCK DOWN.</strong>
</p>

# Carapace — Webhook Armor for OpenClaw

**Carapace** is a hardened reverse proxy that sits in front of [OpenClaw](https://github.com/openclaw/openclaw)'s webhook endpoints.
It validates, rate-limits, and forwards only safe requests. The Gateway never touches the public internet — only Caddy is exposed.

If you expose OpenClaw webhooks to the internet, run them through Carapace.

## How it works

```
Internet ──► Caddy (TLS, :443) ──► Carapace (Bun, :3000) ──► OpenClaw (:18789)
```

The compose stack runs three services:

| Service | Image | Role |
|---|---|---|
| `caddy` | `caddy:2-alpine` | TLS termination, security headers, reverse proxy |
| `carapace` | `therealstein/carapace:latest` | Auth, rate limiting, body validation, proxying |
| `openclaw` | `alpine/openclaw` | Gateway backend |

## Install (recommended)

All images are pulled from Docker Hub — no local build required.

```bash
cp .env.example .env
# Edit .env — set CARAPACE_TOKEN and OPENCLAW_HOOKS_TOKEN

docker compose up -d
```

That's it. Caddy auto-provisions TLS via Let's Encrypt when you set `DOMAIN`.

### Local dev (no Docker)

```bash
bun install
bun run src/index.ts
```

## OpenClaw (Docker)

Docker is optional. Use it only if you want a containerized gateway or to validate the Docker flow.

- **Yes** — you want an isolated, throwaway gateway environment or to run OpenClaw on a host without local installs.
- **No** — you're running on your own machine and just want the fastest dev loop. Use the local dev flow.

> Sandboxing note: agent sandboxing uses Docker too, but it does not require the full gateway to run in Docker. See [OpenClaw Sandboxing](https://github.com/openclaw/openclaw).

### Requirements

- Docker Desktop (or Docker Engine) + Docker Compose v2
- At least 512 MB RAM available for the stack

### Gateway token + pairing

After the stack starts, open `http://127.0.0.1:18789/` and paste the gateway token into the Control UI (Settings > token).

Need the token again?

```bash
docker compose exec openclaw node dist/index.js dashboard --no-open
```

### Channel setup (optional)

```bash
# WhatsApp (QR)
docker compose exec openclaw node dist/index.js channels login

# Telegram
docker compose exec openclaw node dist/index.js channels add --channel telegram --token "<token>"

# Discord
docker compose exec openclaw node dist/index.js channels add --channel discord --token "<token>"
```

### Health check

```bash
docker compose exec openclaw node dist/index.js health --token "$OPENCLAW_GATEWAY_TOKEN"
```

### Persistent data

Config and workspace live in Docker volumes (`openclaw_config`, `openclaw_workspace`). Inspect:

```bash
docker volume inspect carapace_openclaw_config
```

### Permissions + EACCES

The `alpine/openclaw` image runs as `node` (uid 1000). If you see permission errors on `/home/node/.openclaw`, make sure your host bind mounts are owned by uid 1000:

```bash
sudo chown -R 1000:1000 /path/to/openclaw-config /path/to/openclaw-workspace
```

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `CARAPACE_TOKEN` | Yes* | — | Bearer token for webhook auth |
| `OPENCLAW_HOOKS_TOKEN` | Yes | — | Token forwarded to OpenClaw |
| `OPENCLAW_UPSTREAM` | No | `http://127.0.0.1:18789` | OpenClaw upstream URL |
| `DOMAIN` | No | `localhost` | Domain for Caddy TLS |
| `CARAPACE_HMAC_SECRET` | No | — | HMAC-SHA256 secret for signature verification |
| `RATE_LIMIT_MAX` | No | `30` | Max requests per window |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Rate limit window in ms |
| `MAX_BODY_SIZE` | No | `65536` | Max request body size in bytes |
| `PROXY_TIMEOUT_MS` | No | `30000` | Upstream request timeout in ms |
| `LOG_LEVEL` | No | `info` | Log level: debug, info, warn, error |

\* At least one of `CARAPACE_TOKEN` or `CARAPACE_HMAC_SECRET` must be set.

## Auth modes

- **Token only** — set `CARAPACE_TOKEN`; requests need `Authorization: Bearer <token>`.
- **HMAC only** — set `CARAPACE_HMAC_SECRET`; requests need `x-openclaw-hmac-sha256` header.
- **Both** — set both; requests must pass both checks.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check (no auth) |
| `POST` | `/hooks/wake` | Wake hook — requires `text` field |
| `POST` | `/hooks/agent` | Agent hook — requires `message` field |
| `POST` | `/hooks/:name` | Mapped hooks — pass-through with size limit |

## Deployment + DNS

Caddy auto-provisions TLS via Let's Encrypt. You just need a domain with a DNS record pointing to your server.

### Domain options

| Option | Cost | Notes |
|---|---|---|
| **Cloudflare Tunnel** | Free | No ports to open, no static IP needed. Outbound tunnel to Cloudflare's edge. |
| **DuckDNS** | Free | Dynamic DNS subdomain (`yourname.duckdns.org`). Good for home servers. |
| **Tailscale Funnel** | Free | Exposes via `*.ts.net`. Best for private/dev use. |
| **Porkbun / Cloudflare Registrar** | ~$2–10/yr | Cheap domains (`.xyz`, `.dev`, `.app`). Cloudflare sells at cost. |

### Own domain + DNS (production)

1. Buy a domain (e.g. `example.xyz` — Porkbun or Cloudflare Registrar).
2. Point nameservers to Cloudflare (free plan) or your registrar's DNS.
3. Add an `A` record:

   ```
   Type  Name  Content       TTL
   A     @     203.0.113.42  Auto
   ```

4. Set `DOMAIN=example.xyz` in `.env`.
5. Open ports **80** + **443** on your server.
6. `docker compose up -d` — Caddy obtains and renews certs automatically.

### Cloudflare Tunnel (free, no ports)

Use this if you can't open ports or don't have a static IP.

```bash
# Install cloudflared
curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
  -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared

# Auth + create tunnel
cloudflared tunnel login
cloudflared tunnel create carapace
```

Configure `~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: ~/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: example.xyz
    service: http://localhost:443
  - service: http_status:404
```

Add a CNAME in Cloudflare DNS (`@ → <TUNNEL_ID>.cfargotunnel.com`), then:

```bash
cloudflared tunnel run carapace
```

### DuckDNS (free dynamic DNS)

1. Sign up at [duckdns.org](https://www.duckdns.org) — create a subdomain.
2. Auto-refresh your IP (crontab):

   ```bash
   echo url="https://www.duckdns.org/update?domains=YOURSUBDOMAIN&token=YOUR_DUCKDNS_TOKEN&ip=" | curl -k -o /dev/null -s -K -
   ```

3. Set `DOMAIN=yoursubdomain.duckdns.org` in `.env`.
4. Open ports **80** + **443** on your router/firewall.
5. `docker compose up -d`

### Firewall checklist

| Port | Protocol | Required by |
|---|---|---|
| 80 | TCP | Caddy — Let's Encrypt ACME HTTP-01 challenge |
| 443 | TCP + UDP | Caddy — HTTPS + HTTP/3 QUIC |

Ports 3000 (Carapace) and 18789 (OpenClaw) stay on the internal Docker network. Do **not** expose them.

## Security

- Bearer token + optional HMAC-SHA256 signature verification.
- Rejects `?token=` query params (400) — tokens belong in headers.
- Sliding window rate limiting with progressive IP lockout (3 auth failures → 5 min block).
- Body size limits (413 on oversized payloads).
- Schema validation per endpoint.
- Never logs request bodies or tokens.
- Runs as non-root user in Docker with read-only filesystem.
- Only Caddy is exposed to the internet.
