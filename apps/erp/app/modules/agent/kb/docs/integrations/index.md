# Integrations

> Connect Carbon to your accounting, CAD, project-management, estimating, and messaging tools.

Carbon ships a set of first-party **integrations** to third-party apps. Each one is enabled per company
under **Settings → Integrations**, where you flip it on and supply its credentials or settings.

Integrations are an **Enterprise** capability. On [Carbon Cloud](https://app.carbon.ms) they're included
with the **Business** plan; self-hosted, they require a commercial (Enterprise) license —
see `docs/platform/licensing`. **Email** and **Exchange Rates** are the exceptions, available on
every edition and plan.

## How a connection works

An integration has two parts: a system-wide **definition** and a per-company **activation**.

- The **definition** describes the fields that integration needs: API keys, OAuth tokens, mapping options.
- The **activation** is a `companyIntegration` record: an `active` flag plus a `metadata` object holding
  your credentials and settings. Carbon validates that metadata against the definition, so an integration
  can't be switched on with incomplete configuration.

Connections are established one of three ways, depending on the app:

| Style | Apps | How |
| --- | --- | --- |
| Provider settings | Email | Pick a provider and fill in its fields. |
| API key | Linear, Paperless Parts, Exchange Rates | Paste a key (and any options). |
| OAuth | Xero, Jira, Onshape, Slack | Authorize Carbon with the provider; tokens are stored for you. |

Disconnecting an integration sets `active = false` but **keeps your stored credentials**. Reconnecting
doesn't make you re-enter them. To remove credentials entirely, clear the integration's settings before you
disconnect.

## What's available depends on your deployment

Which integrations even appear depends on how Carbon is deployed. The OAuth connectors, **Xero**, **Jira**,
and **Onshape**, only show up when their OAuth client is configured server-side (see
`docs/platform/self-hosting/environment-variables`), and **Slack** is hidden in controlled (ITAR)
environments. So the same Carbon build can offer a different set of integrations depending on its
configuration.

## Browse by category

  - Accounting Xero and automatic currency exchange rates.
  - Project management Push quality issues to Linear or Jira.
  - CAD Sync CAD data from Onshape.
  - Estimating & quoting Pull quotes and BOMs from Paperless Parts.
  - Email Send outbound email through Resend or your own SMTP server.
  - Assistant Bring the Carbon Assistant into Slack.

## Related

  - Webhooks Push record changes to your own endpoints instead of a packaged integration.
  - Environment variables The server-side credentials that gate the OAuth integrations.
