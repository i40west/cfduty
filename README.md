# CFDuty

Cloudflare Worker to use PagerDuty with Cloudflare Health Checks on a Pro plan.

## Environment variables:

- WEBHOOK_SECRET - shared secret Cloudflare sends in an HTTP header.
- CF_API_TOKEN - Cloudflare API token, needs read access to health checks.
- CF_ZONE_ID - The zone ID where the health checks are.

## Services

For a server `foo`, create a PagerDuty service `foo` (the name actually
doesn't need to match).

If `foo` is running several services, say, web, SMTP, and IMAP, create
three health checks named `foo-web`, `foo-smtp`, and `foo-imap`. The
first name component is used to dedup alerts, so multiple alerts on
`foo-*` health checks will create just one PagerDuty incident and thus
one page.

For each service (`foo-*`) create an environment variable `KEY_foo`
with the PagerDuty service routing key.

## Auto-resolve

If CF_API_TOKEN and CF_ZONE_ID are set, a "healthy" alert from a check
(when a check changes from unhealthy to healthy) will query Cloudflare's
API for all health checks. If all `foo-*` health checks are now healthy,
the message will be sent to PagerDuty with a `resolve` action, which will
automatically mark the open issue as resolved. If some `foo-*` checks are
still unhealthy it will be sent as a low-severity message so no new page
will be sent by PagerDuty.
