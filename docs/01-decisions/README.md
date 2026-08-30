# Architecture Decision Records

Each ADR follows the same shape: **Context → Options considered → Trade-offs →
Decision → Consequences → Open points**. "Decision" is the recommendation the project
owner approved on 2026-08-30 unless the status line says otherwise.

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-001](ADR-001-topology.md) | Topology: local-first replicas + thin authoritative sync core | Approved |
| [ADR-002](ADR-002-transport.md) | Transport: WebSocket to Durable Objects, no WebRTC in v1 | Approved |
| [ADR-003](ADR-003-durability-and-recovery.md) | Durability: three copies, persistence, export, recovery flows | Approved |
| [ADR-004](ADR-004-entry-modes-solo-host-join.md) | Entry modes: Solo, Host, Join | Approved |
| [ADR-005](ADR-005-stack.md) | Stack: TypeScript everywhere, Angular + Hono/Workers | Approved |
| [ADR-006](ADR-006-hosting.md) | Hosting: Cloudflare free plan, GitHub Actions | Approved |
| [ADR-007](ADR-007-character-state-model.md) | Character state: event log of decisions | Approved |
| [ADR-008](ADR-008-extension-format-and-safety.md) | Extension format, versioning and safety | Approved |
| [ADR-009](ADR-009-i18n.md) | i18n depth | Approved |
| [ADR-010](ADR-010-images.md) | Images | Approved |
| [ADR-011](ADR-011-ui-direction.md) | UI direction and customization | Approved |
| [ADR-012](ADR-012-identity-and-security.md) | Identity and security baseline | Approved |
| [ADR-013](ADR-013-rules-engine-architecture.md) | Rules engine architecture | Approved |
| [ADR-014](ADR-014-backend-portability-and-self-hosting.md) | Backend portability: Cloudflare primary, self-hosted Node on Windows as a supported second target (amends ADR-005/006) | Approved |

Conventions: an ADR is never edited to say something different; it is superseded by a new
ADR that links back. Small clarifications (typos, links) are fine.
