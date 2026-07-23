# Project management

> Link Carbon quality issues to Linear or Jira so engineering tracks them in their own tool.

When a quality problem needs engineering's attention, Carbon can push it into the issue tracker your team
already lives in. Both connectors are aimed at **quality (nonconformance) issues**.

## Linear

Authenticate with a **Linear API key** (it begins with `lin_api`).

  
  ### Paste your Linear API key

  Provide your Linear API key. Carbon checks the `lin_api` prefix.
  
  
  ### Issues sync

  Once connected, Carbon syncs issues to Linear, keeping each Carbon issue matched to the same Linear issue.
  

| Setting | What it controls |
| --- | --- |
| API key | Your Linear API key — Carbon checks the `lin_api` prefix. |

## Jira

Connect over **OAuth**. There are no fields to fill in beyond authorizing Carbon.

  
  ### Authorize over OAuth

  Authorize Carbon in Jira. There are no fields to fill in.
  
  
  ### Link a quality issue

  Once connected, you can link a quality issue to a Jira issue.
  

Jira only appears when its OAuth client is configured server-side (`JIRA_CLIENT_ID`) — see
`docs/platform/self-hosting/environment-variables`.

## Related

  - Quality The nonconformance issues these integrations push to engineering.
