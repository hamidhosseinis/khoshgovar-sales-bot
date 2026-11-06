# Access model — Khoshgovar Sales Bot

Status: **initial specification only** (not yet implemented or deployed).

## Trust boundaries

The bot serves retail customers and authorized administrators from ONE Telegram interface.
The server, not Telegram buttons, must enforce access. **Deny by default.**

| Capability | Customer | Authorized admin |
| --- | --- | --- |
| Browse approved product titles, images and package sizes | Yes | Yes |
| View explicitly approved public offers and customer-facing price | Yes | Yes |
| Calculate final customer-facing price from approved published inputs | Yes | Yes |
| View internal procurement costs, confidential discounts, margin, unpublished offers, customer records | No | Only when specifically authorized |
| Edit product information, price rules, offer approval state | No | Yes, through authenticated admin operations |
| View audit trail | No | Yes |

## Authentication and authorization

- Telegram webhook traffic must be verified using a secret token and HTTPS. Do not trust public requests claiming a Telegram user ID.
- **Every** sensitive endpoint and callback must enforce server-side authorization using verified Telegram identity and a role allowlist or authenticated staff identity.
- Public users cannot provide or override role, owner ID, approval status, or privileged filters.
- Separate public response models from internal database records; never return sensitive fields and hide them only in the UI.
- No admin capabilities should be enabled until the owner explicitly registers their Telegram numeric user ID through a secure configuration channel (not in source control).
- Rate-limit public searches and calculations; avoid exposing personal data in logs or error responses.
- Never disclose tokens, service-role keys, webhook secrets, internal pricing exports, or other credentials via Telegram, commits, CI logs, screenshots or support messages.
- BotFather and Cloudflare secrets must be kept in platform secret storage; avoid hard-coding.

## Public publication controls

A record is publicly visible only when all applicable criteria are true:
1. Its source is authorized for customer distribution and an administrator has approved publication.
2. The product/offer is active and within its permitted validity period.
3. Geographic scope, customer eligibility, tax treatment, order quantities and limitations are checked.
4. The displayed price derives from approved public input fields only.
5. The timestamp/source and disclaimer are appropriate for price changes.

If no valid published price or offer exists, display 'قیمت/طرح معتبر برای نمایش عمومی موجود نیست' instead of deriving it from internal data.

## Role changes and audit

- Maintain an allowlist of explicitly approved administrator Telegram IDs; use least privilege.
- Record who approved a public offer, when, source version and who changed it.
- Revoke admin privileges server-side immediately when access is removed.
- Test all callback, inline, webhook, pagination, deep-link and API paths against privilege escalation and data leaks.

This document is a design baseline, not a claim that access control already exists.
