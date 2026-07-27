# Project management

> Link Carbon quality issues to Linear or Jira so engineering tracks them in their own tool.

When a quality problem needs engineering's attention, Carbon can push it into the issue tracker your team
already lives in. Both connectors link a nonconformance's **action tasks**
to an external issue and keep the two in step, status, assignee, and notes sync both ways.

## Linear

Authenticate with a **Linear API key** (it begins with `lin_api`).

  
  ### Paste your Linear API key

  Provide your Linear API key. Carbon checks the `lin_api` prefix.
  
  
  ### Action tasks sync

  Once connected, Carbon links each nonconformance action task to a Linear issue and keeps the pair matched, so status, assignee, and notes stay aligned in both directions.
  

| Setting | What it controls |
| --- | --- |
| API key | Your Linear API key — Carbon checks the `lin_api` prefix. |

## Jira

Connect over **OAuth**. There are no fields to fill in beyond authorizing Carbon.

  
  ### Authorize over OAuth

  Authorize Carbon in Jira. There are no fields to fill in.
  
  
  ### Link an action task

  Once connected, you can link a nonconformance action task to a Jira issue, and status, assignee, and notes stay aligned in both directions.
  

Jira only appears when its OAuth client is configured server-side (`JIRA_CLIENT_ID`) — see
`docs/platform/self-hosting/environment-variables`.

## Related

  - Quality The nonconformance issues these integrations push to engineering.
