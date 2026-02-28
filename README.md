<p align="center">
  <img src="logo.png" alt="Carapace" width="400">
</p>

# Carapace

> *Exoskeletal webhook armor for OpenClaw*

Hardened reverse proxy that sits in front of OpenClaw's webhook endpoints. Validates, rate-limits, and forwards only safe requests.

## Architecture

```
Internet → Caddy (TLS, :443) → Carapace (Bun, :3000) → OpenClaw (:18789)
```

## Quick Start

### Local Development

```bash
cp .env.example .env
# Edit .env with your tokens
bun install
bun run src/index.ts
```

### Docker

```bash
cp .env.example .env
# Edit .env with your tokens and domain
docker compose up -d
```

The compose stack includes three services:

| Service | Image | Role |
|---|---|---|
| `caddy` | `caddy:2-alpine` | TLS termination, reverse proxy |
| `carapace` | built from `Dockerfile` | Webhook validation, rate limiting |
| `openclaw` | `alpine/openclaw` | Gateway backend |

## OpenClaw (Docker)

> Docker is optional. Use it only if you want a containerized gateway or to validate the Docker flow.

**Is Docker right for me?**
- **Yes** — you want an isolated, throwaway gateway environment or to run OpenClaw on a host without local installs.
- **No** — you're running on your own machine and just want the fastest dev loop. Use the local development flow above.

> **Sandboxing note:** Agent sandboxing uses Docker too, but it does not require the full gateway to run in Docker. See the [OpenClaw Sandboxing docs](https://github.com/openclaw/openclaw) for details.

### Requirements

- Docker Desktop (or Docker Engine) + Docker Compose v2
- At least 2 GB RAM for image build (`pnpm install` may be OOM-killed on 1 GB hosts with exit 137)

### Quick Start

```bash
docker compose up -d
```

After OpenClaw starts, open `http://127.0.0.1:18789/` in your browser and paste the gateway token into the Control UI (Settings → token).

Need the token again?

```bash
docker compose exec openclaw node dist/index.js dashboard --no-open
```

### Channel Setup (optional)

Configure messaging channels via the OpenClaw CLI container:

```bash
# WhatsApp (QR)
docker compose exec openclaw node dist/index.js channels login

# Telegram
docker compose exec openclaw node dist/index.js channels add --channel telegram --token "<token>"

# Discord
docker compose exec openclaw node dist/index.js channels add --channel discord --token "<token>"
```

### Health Check

```bash
docker compose exec openclaw node dist/index.js health --token "$OPENCLAW_GATEWAY_TOKEN"
```

### Persistent Data

OpenClaw config and workspace are stored in Docker volumes (`openclaw_config`, `openclaw_workspace`). To back up or inspect:

```bash
docker volume inspect carapace_openclaw_config
```

### Permissions

The `alpine/openclaw` image runs as `node` (uid 1000). If you see `EACCES` errors, ensure bind mounts are owned by uid 1000:

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

\* At least one of `CARAPACE_TOKEN` or `CARAPACE_HMAC_SECRET` should be set.

## Auth Modes

- **Token only**: Set `CARAPACE_TOKEN` — requests need `Authorization: Bearer <token>`
- **HMAC only**: Set `CARAPACE_HMAC_SECRET` — requests need `x-openclaw-hmac-sha256` header
- **Both**: Set both — requests must pass both checks

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/hooks/wake` | Wake hook (requires `text` field) |
| `POST` | `/hooks/agent` | Agent hook (requires `message` field) |
| `POST` | `/hooks/:name` | Mapped hooks (pass-through with size limit) |

## Security

- Bearer token + optional HMAC-SHA256 signature verification
- Rejects `?token=` query params (400)
- Sliding window rate limiting with progressive IP lockout (3 auth failures → 5min block)
- Body size limits (413 on oversized payloads)
- Schema validation per endpoint
- Never logs request bodies or tokens
- Runs as non-root user in Docker with read-only filesystem
- Only Caddy is exposed to the internet
