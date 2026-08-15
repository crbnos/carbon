# Verifying work events after deploy

Work events cannot be observed before this is on `main` and deployed. The emitter
is gated on `POSTHOG_PROJECT_PUBLIC_KEY`, which local development deliberately
leaves unset, so a green local build proves the code compiles and nothing else.

This is the runbook for the first three days. Each check states what passes, what
fails, and what a failure means — a check with no failure condition is not a
check.

Run the queries in PostHog against project **CarbonOS** (id 80891, US cloud).

---

## Before merging

- [ ] Read `POSTHOG_API_HOST` from the deployed ERP env and confirm the browser
      is currently ingesting through it. The emitter POSTs to
      `${POSTHOG_API_HOST}/e/` — deliberately the same host and path `posthog-js`
      uses, because that is the one combination proven against the deployed
      value rather than against the docs. If the browser's events are arriving,
      the server's will too. **This is the most likely single point of failure
      and the cheapest thing to check.**
- [ ] Confirm the ERP and MES deployments share that project key. If they differ,
      MES-sourced events land in a different project and the MES-vs-ERP ratio is
      silently wrong rather than absent.

---

## T+1 hour — is anything arriving at all?

```sql
SELECT event, count() AS n, min(timestamp) AS first_seen, max(timestamp) AS last_seen
FROM events
WHERE timestamp > now() - INTERVAL 2 HOUR
  AND properties.work_event = true
GROUP BY event
ORDER BY n DESC
```

**Pass:** at least one row. **Fail:** zero rows.

Zero does not by itself mean the code is broken — it may mean nobody did any
work in that hour, which on this customer base is entirely plausible. Distinguish
the two before touching anything:

```sql
SELECT count() FROM events WHERE timestamp > now() - INTERVAL 2 HOUR
```

If that is also near zero, nobody was using Carbon; wait. If it is healthy and
`work_event` is empty, the emitter is failing. Check the ERP logs for
`work event rejected` (a non-2xx from PostHog, which logs the status and body)
or `work event failed` (network, timeout, or a thrown error). The emitter never
throws into the request, so a total failure is silent everywhere except the log.

---

## T+1 day — is it the right shape?

### 1. Company attribution

```sql
SELECT
  count() AS total,
  countIf($group_0 != '') AS with_company,
  uniqIf($group_0, $group_0 != '') AS companies
FROM events
WHERE timestamp > now() - INTERVAL 1 DAY AND properties.work_event = true
```

**Pass:** `with_company = total`. **Fail:** any row without a group.

A work event with no company cannot be attributed to an account and is useless.
Every emit path sets `$groups`, so a gap here means a payload lost `companyId`.

### 2. Identity joins the browser person

```sql
SELECT count() AS server_events, uniq(distinct_id) AS ids,
       countIf(distinct_id LIKE 'company:%') AS anonymous
FROM events
WHERE timestamp > now() - INTERVAL 1 DAY AND properties.work_event = true
```

**Pass:** `anonymous` is small and confined to `quote_accepted` from the customer
portal. **Fail:** a large anonymous share.

Anonymous events mean `userId` arrived null. The browser calls
`posthog.identify(userId)`, so a server event keyed on the same id lands on the
same person with no merge; a null actor breaks per-user analysis for that event.

### 3. No duplicates

```sql
SELECT count() AS rows, uniq(uuid) AS distinct_uuids, count() - uniq(uuid) AS excess
FROM events
WHERE timestamp > now() - INTERVAL 1 DAY AND properties.work_event = true
```

**Pass:** `excess = 0`. **Investigate, do not panic, if not.**

PostHog de-duplicates on `uuid` only eventually, through background ClickHouse
merges, and its own docs say that is not guaranteed. A non-zero `excess` here is
therefore expected behaviour, not a bug — it is exactly why the id is
deterministic. What matters is that duplicates share a uuid so the warehouse can
collapse them. The failure case is `excess = 0` *with* inflated counts, which
would mean the same occurrence is minting different ids.

### 4. Payload hygiene

```sql
SELECT DISTINCT arrayJoin(JSONExtractKeys(properties)) AS key
FROM events
WHERE timestamp > now() - INTERVAL 1 DAY AND properties.work_event = true
ORDER BY key
```

**Pass:** ids, enums, counts, quantities, and PostHog's own `$`-prefixed keys.
**Fail:** any key holding money, a part number, an item description, a customer
or supplier name, or free text.

This is a standing check, not a one-off — it is what stops the payload drifting
into the sensitive territory the catalog deliberately excluded.

---

## T+3 days — does it agree with reality?

This is the check that catches the failure nobody notices: a number that is
plausible and wrong.

Pick two or three active accounts. For each, compare the event count against the
ERP's own data for the same window.

```sql
-- PostHog
SELECT $group_0 AS company, event, count() AS n
FROM events
WHERE timestamp > now() - INTERVAL 3 DAY AND properties.work_event = true
GROUP BY company, event ORDER BY company, n DESC
```

Then, against the Carbon database for the same company and window:

| Event | Compare against |
|---|---|
| `job_created` | `SELECT count(*) FROM "job" WHERE "companyId" = ? AND "createdAt" > ?` |
| `receipt_posted` | `SELECT count(*) FROM "receipt" WHERE "companyId" = ? AND status = 'Posted' AND "postingDate" >= ?` |
| `job_operation_started` | `SELECT count(*) FROM "productionEvent" WHERE "companyId" = ? AND "createdAt" > ?` |
| `production_quantity_reported` | `SELECT count(*) FROM "productionQuantity" WHERE "companyId" = ? AND type = 'Production' AND "createdAt" > ?` |

**Pass:** equal, or PostHog lower by a small margin.

**PostHog lower** is the expected direction and has three benign causes: a work
path this branch does not cover (see the gaps table in `README.md`), an event lost
to a transient network failure, or ingestion lag. Lower by a *lot* means a seam
was missed.

**PostHog higher** is never benign. It means one occurrence produced two ids, and
the idempotency key is wrong.

Mind two traps when comparing. The event timestamp is UTC while Carbon's business
dates are company-local, so a day boundary will disagree — compare over three
days, not one. And `job_created` counts every job including MRP-planned ones;
filter by `source` if the ERP query does not.

---

## Standing checks once it is trusted

- **Coverage:** which of the wired events have *never* been seen. An event that
  produces nothing in a month is either a seam that broke or a feature nobody
  uses; both are worth knowing and they look identical on a dashboard.
- **Volume:** PostHog drops events once a billing limit is exceeded **and still
  returns HTTP 200**. Nothing in the app can detect this. Current usage is around
  218k events/month against a 1M free tier, so there is headroom, but a sudden
  flat-line across all events at once is the signature to watch for.
- **Batch export:** the mirror into Supabase has `filters: null`, so work events
  flow through automatically. If an event allow-list is ever set in the PostHog
  console, it lives there and not in git — a new event would silently never reach
  the warehouse.
