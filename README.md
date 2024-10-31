# 🚨 CFDuty

Cloudflare Worker to use PagerDuty with Cloudflare Health Checks on a Pro plan.

This covers the simple use case where you have a few servers, running a few
services, and you want to get notified if a server or service goes down,
but you don't want to pay a huge sum of money to PagerDuty and you also
don't want multiple redundant alerts for each service if a server goes
down (or is rebooted).

## 🚧 Deploy the Worker

If you want to use Cloudflare's automatic deployment from Github, you
can fork this repo into your own account and
[connect Cloudflare to your repo](https://developers.cloudflare.com/workers/ci-cd/builds/).
Or you can manually deploy with [Wrangler](https://developers.cloudflare.com/workers/wrangler/).

Edit `wrangler.toml` if necessary. If you want to use a `workers.dev`
domain, or deploy the worker under a different name, this is where you
do that.

You need to create several environment variables, which you can create
in the Dashboard or as secrets with Wrangler (details below).

You can use the `workers.dev` domain Cloudflare assigns you, or you can
put the worker on a custom domain like `alerts.example.com`.

## 🪝 Create a webhook

Create a webhook notification destination [in the Cloudflare dashboard](https://dash.cloudflare.com/?to=/:account/notifications/destinations).
The URL should be whatever route you've deployed the worker on, with
the path `/alert`. So if you've put the Worker on `alerts.example.com`,
the URL would be `https://alerts.example.com/alert`.

For the shared secret, it can be whatever you want. This is used to
verify that the webhook is coming from your Cloudflare setup.

> [!NOTE]
> You must have a Cloudflare Pro plan (or higher) to use webhooks. This
> will not work on a free Cloudflare plan.

## 📣 Create health checks

Create a health check [in the Cloudflare dashboard](https://dash.cloudflare.com/?to=/:account/:zone/traffic/health-checks)
and set it to use your webhook. See below for what to name your health
checks. Set it to trigger when the monitored service becomes unhealthy
or becomes healthy.

## 🤫 Secrets

Create secrets for the Worker as follows:

- WEBHOOK_SECRET - The shared secret you added when you created the webhook.
- CF_API_TOKEN - Cloudflare API token, needs read access to health checks.
- CF_ZONE_ID - The Cloudflare zone ID where the health checks are.
- KEY_foo - where `foo` is the name of your service. See below.

## 📟 PagerDuty services

This script uses naming conventions to group and deduplicate alerts.

For a server `foo`, create a PagerDuty service `foo` (the name actually
doesn't need to match).

If `foo` is running several services, say, web, SMTP, and IMAP, create
three health checks named `foo-web`, `foo-smtp`, and `foo-imap`, for
each service. The first name component is used to dedup alerts, so
multiple alerts on `foo-*` health checks will create just one PagerDuty
incident and thus one page.

In PagerDuty, for each service, add an Integration and choose "Events API V2".
This will create an integration key (routing key) for the service.

For each service (`foo-*`) create an environment variable (or secret)
for your Worker called `KEY_foo` with this PagerDuty service routing key.

> [!NOTE]
> This works with a free PagerDuty account.

## 😴 Auto-resolving incidents

If CF_API_TOKEN and CF_ZONE_ID are set, a "healthy" alert from a check
(when a check changes from unhealthy to healthy) will query Cloudflare's
API for all health checks. If all `foo-*` health checks (everything on the
same service/server) are now healthy, the message will be sent to PagerDuty
with a `resolve` action, which will automatically mark the open issue as
resolved. If some `foo-*` checks are still unhealthy it will be sent as a
low-severity message so the incident will remain open. (Any further pages
are determined by your PagerDuty escalation policy.)

Thus, if you reboot a server, the incident will close automatically when
the server comes back up.

## 🤖 Error handling

Calls to the Cloudflare and PagerDuty APIs are retried on failure using
Cloudflare's Workflows API. On a "healthy" notification, if the Cloudflare
API calls fail even after a few retries, the PagerDuty notification is
sent anyway (as a low-severity message so it won't generate a page), but
won't resolve the incident.
