# Project management

> Link Carbon quality issues to Linear or Jira so engineering tracks them in their own tool.

When a quality problem needs engineering's attention, Carbon can push it into the issue tracker your team
already lives in. Both connectors link a nonconformance's **action tasks**
to an external issue and keep the two in step, status, assignee, and notes sync both ways.

## Linear

Authenticate with a **Linear API key** (it begins with `lin_api`).

  
  ### Create the webhook in Linear

  In Linear's API settings, create a new webhook and paste the URL shown in Carbon's setup instructions
  (`/api/webhook/linear/<your company id>`). This is how changes made in Linear reach Carbon.
  
  
  ### Copy the signing secret

  Linear shows a **signing secret** on the webhook's detail page. Paste it into **Webhook Signing Secret**.
  With it saved, Carbon only accepts webhook requests Linear has signed, and rejects any that are more
  than a minute old.
  
  
  ### Paste your Linear API key

  Provide your Linear API key. Carbon checks the `lin_api` prefix.
  
  
  ### Action tasks sync

  Once connected, Carbon links each nonconformance action task to a Linear issue and keeps the pair matched, so status, assignee, and notes stay aligned in both directions.
  

| Setting | What it controls |
| --- | --- |
| API key | Your Linear API key — Carbon checks the `lin_api` prefix. |
| Webhook signing secret | Optional. When set, webhook requests without a valid Linear signature are rejected. |

A Linear or Jira webhook with no secret saved in Carbon still works, so older setups keep syncing, but
Carbon cannot tell its requests from forged ones. Add the secret to every webhook you create.

## Jira

Connect over **OAuth**. The only setting is an optional webhook secret.

  
  ### Authorize over OAuth

  Authorize Carbon in Jira.
  
  
  ### Create the webhook in Jira (optional)

  For changes made in Jira to reach Carbon straight away, go to **System → WebHooks** in Jira and create a
  webhook with the URL shown in Carbon's setup instructions (`/api/webhook/jira/<your company id>`),
  subscribed to **Issue updated** and **Issue deleted**. Fill in the webhook's **Secret** field, and paste
  the same value into **Webhook Secret** in Carbon. With it saved, Carbon only accepts webhook requests
  Jira has signed.
  
  
  ### Link an action task

  Once connected, you can link a nonconformance action task to a Jira issue, and status, assignee, and notes stay aligned in both directions.
  

| Setting | What it controls |
| --- | --- |
| Webhook secret | Optional. When set, webhook requests without a valid Jira signature are rejected. |

Jira only appears when its OAuth client is configured server-side (`JIRA_CLIENT_ID`) — see
`docs/platform/self-hosting/environment-variables`.

## Related

  - Quality The nonconformance issues these integrations push to engineering.
