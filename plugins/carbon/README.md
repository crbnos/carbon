# Carbon plugin for Cursor and Grok Bot

Marketplace connector for [Carbon](https://carbon.ms) ERP. Grok Bot installs plugins from the Cursor Marketplace, so this is the one package for both.

The server is Carbon Cloud (US):

```
https://app.carbon.ms/api/mcp
```

Transport is stateless streamable HTTP. There is no API key in this plugin. The first tool call opens Carbon's OAuth consent screen. The user picks a company, and the agent acts as that user.

Carbon registers three tools: `search_tools`, `describe_tool`, `call_tool`. The `carbon-erp` skill is the working loop.

## Install

One listing covers both products. Submit this repository (`https://github.com/crbnos/carbon`) at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish). The index is `.cursor-plugin/marketplace.json`. The plugin directory is `plugins/carbon`. Cursor reviews it, then the same **Carbon** entry appears in both catalogs. A push does not publish it.

After that review accepts the plugin:

- **Cursor:** Customize → Marketplace → search **Carbon** → Install. The `carbon-erp` rule loads with the plugin.
- **Grok Bot:** Settings → Plugins → search **Carbon** → Add. The `carbon-erp` skill loads with the plugin.

Approve the Carbon sign-in when the first tool call asks for it. There is no second submission for Cursor.

## Where this plugin belongs

| Deployment | Use this plugin |
| --- | --- |
| Carbon Cloud, US (`app.carbon.ms`) | Yes |
| Carbon Cloud, EU (`app.eu.carbon.ms`) | No. This listing is the US origin. Point a local client at the EU `/api/mcp` URL instead |
| Private network, self-hosted, or ITAR | No. Grok Bot runs on a cloud computer and can only reach a public URL. Use Grok Build or Cursor on a host that can already open that origin |

Installing this plugin does not give the agent a private ERP. Tool results still go to the model vendor behind Grok Bot or Cursor.

## Local check before submission

Copy this directory to `~/.cursor/plugins/local/carbon`, reload Cursor, and confirm Customize shows the Carbon server and the `carbon-erp` rule. That check is not marketplace acceptance.
