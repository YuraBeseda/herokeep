# Hosting research: free tiers, WebSocket hosts, TURN

*All facts checked 2026-08-29 against the cited sources (the official pricing, limits and documentation pages of each provider). Re-verify before relying on them in a later year.*

Anything the research could not confirm from an official page is marked **unverified**. Abbreviated source paths written as `…/path/` are sibling pages of the full URL in the same row.

## 1. Cloudflare

| What | Limit / price | Source |
|---|---|---|
| Workers Free | 100,000 requests/day; 10 ms CPU per invocation; 3 MB script; a WebSocket Upgrade counts as 1 request; WebSocket messages passing through a Worker are not counted | developers.cloudflare.com/workers/platform/limits/ ; …/pricing/ |
| Workers Paid | $5/mo minimum; 10M requests + 30M CPU-ms included | same |
| Durable Objects Free | Available (SQLite backend only): 100k requests/day, 13,000 GB-s/day, 5 GB storage per account, 10 GB per DO, 100 classes; SQLite 5M rows read + 100k rows written per day | developers.cloudflare.com/durable-objects/platform/pricing/ ; …/limits/ |
| DO WebSockets | Outgoing messages free, protocol pings free; incoming messages billed 20:1 (100 messages = 5 requests); Hibernation API: no duration charge while hibernated; 32 MiB maximum received message | developers.cloudflare.com/durable-objects/best-practices/websockets/ |
| D1 Free | 5M rows read/day, 100k rows written/day, 5 GB | developers.cloudflare.com/d1/platform/pricing/ |
| Static Assets / Pages | Static asset requests free and unlimited (no egress charge); 20,000 files, 25 MiB per file; Pages: 500 builds/mo, 1 concurrent build, 100 custom domains per project | developers.cloudflare.com/workers/platform/limits/ ; developers.cloudflare.com/pages/platform/limits/ |
| Custom domain | Requires an active Cloudflare zone; workers.dev subdomain is free | developers.cloudflare.com/workers/configuration/routing/custom-domains/ |
| Credit card | Not stated on official pages — **unverified** (third-party sources say none is needed) | — |

## 2. Cloudflare TURN (Realtime)

| What | Detail | Source |
|---|---|---|
| TURN | $0.05/GB egress; free tier 1,000 GB/mo shared between SFU and TURN | developers.cloudflare.com/realtime/sfu/pricing/ ; developers.cloudflare.com/realtime/turn/faq/ |
| STUN | stun.cloudflare.com:3478 — free and unlimited | developers.cloudflare.com/realtime/turn/faq/ |
| Endpoints | turn.cloudflare.com UDP/TCP 3478, TLS 5349 (alternate ports 53/80/443) | developers.cloudflare.com/realtime/turn/ |
| Credit card | Not stated — **unverified** | — |

## 3. Other TURN / STUN providers

| Provider | Offer | Source |
|---|---|---|
| Metered Open Relay | 20 GB/mo free TURN; free signup + API key | metered.ca/tools/openrelay/ |
| Metered plans | 500 MB/mo trial; 150 GB for $99/mo | metered.ca/stun-turn |
| Twilio | From $0.40/GB; no free tier | twilio.com/en-us/stun-turn/pricing |
| Xirsys | Free dev plan: 30-day trial then capped relay (amount **unverified**), 25 concurrent; Basic $39/mo for 50 GB | xirsys.com/pricing |
| Google STUN | stun:stun.l.google.com:19302 | webrtc samples |

## 4. Long-lived WebSocket hosts

| Host | Free tier / WebSocket behaviour | Source |
|---|---|---|
| Fly.io | NO free tier: trial 2 VM-hours per 7 days; card or $25 credit; no small-bill waiver found | fly.io/docs/about/free-trial/ |
| Render Free | 512 MB; WebSockets supported; spins down after 15 min idle, ~1 min spin-up; 750 h/mo; 5 GB bandwidth | render.com/docs/free |
| Railway | Trial $5 for 30 days, then $1/mo credit; Hobby plan $5 | docs.railway.com/pricing |
| Koyeb | 1 free instance, 0.1 vCPU / 512 MB, scales to zero after 1 h; card required ($29 pre-authorization) | koyeb.com/docs |
| Oracle Always Free | 2x E2.1.Micro + Arm A1 1,500 OCPU-h / 9,000 GB-h per month (= 2 OCPU / 12 GB, recently halved); 10 TB egress; reclaimed if idle 7 days (<20% CPU/net/mem); capacity errors common; card required | docs.oracle.com freetier Always_Free_Resources; oracle.com/cloud/free/faq |
| Cloud Run | WebSockets supported, timeout up to 60 min; an open WebSocket keeps the instance active (instance billing); free 180k vCPU-s, 360k GiB-s, 2M requests/mo | cloud.google.com/run/pricing |
| Azure Container Apps | Free 180k vCPU-s, 360k GiB-s, 2M requests/mo; WebSocket vs scale-to-zero behaviour **unverified** | learn.microsoft.com/azure/container-apps/billing |
| Azure App Service F1 | 60 CPU-min/day, 1 GB, 5 WebSockets per instance, no custom domains, no Always On | azure-subscription-service-limits |
| Deno Deploy Free | 1M requests, 20 GiB egress, 10 h active CPU, 150 GiB-h memory; WebSockets supported; idle eviction 5 s – 10 min | deno.com/deploy/pricing |
| Vercel | WebSockets in Functions are Public Beta (Fluid compute) | vercel.com/docs/functions/websockets |
| Netlify | Functions do not support WebSockets (**unverified**) | — |

## 5. Static hosting

| Host | Limits | Source |
|---|---|---|
| GitHub Pages | 1 GB site, 100 GB/mo soft bandwidth limit, 10 builds/h, non-commercial use | docs.github.com github-pages-limits |
| Vercel Hobby | 100 GB transfer | vercel.com/docs/limits |
| Netlify Free | 300 credits/mo (~15 GB) | docs.netlify.com credit-based |
| Cloudflare | Unlimited requests and bandwidth, 500 builds/mo | see section 1 |

## 6. Self-hosted fallback (Windows 10, static IP)

Docker Desktop (WSL2) running coturn/coturn plus Caddy for automatic HTTPS (ports 80/443 must be reachable). Gotchas: the coturn README recommends `--network=host` (large UDP relay port range 49152–65535) and host networking on Docker Desktop for Windows is limited, so run coturn inside WSL2 or a Linux VM; forward UDP 3478 / TLS 5349 plus the relay range; uptime, upstream bandwidth and Windows Update reboots are your own responsibility.

## Recommendations

- Zero-maintenance: Cloudflare only. PWA on Workers Static Assets; relay = SQLite-backed Durable Object with WebSocket Hibernation; optional D1 for persistence; STUN via stun.cloudflare.com; Cloudflare TURN within the 1,000 GB/mo free tier. Caveat: 32 MiB DO message cap (chunk images); card requirement **unverified**.
- Fallback: static hosting on GitHub Pages / Cloudflare Pages; relay on Render Free (sleeps, needs reconnect logic) or an Oracle Arm VM; TURN via Metered Open Relay (20 GB/mo); beyond that, coturn on the home PC.
