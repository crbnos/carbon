# AWS Cost + Abuse Guardrails (GovCloud ERP/MES)

Context: 2026-08-27 ~18:47 EDT an external credential/SSRF scanner flooded the ERP
ALB (~2,400 req in ~4 min, 97% 404s). CPU/mem stayed low (24%/38%) but the single
task's request queue backed up, so heaviside's real requests felt like they hung.
No WAF was associated; billing/anomaly tooling doesn't exist in GovCloud.

## Done — in `sst.config.ts` (applies to every `aws === true` workspace via `ci/src/deploy.ts`)

1. **WAF associated with both ALBs.** The `AppAlbWebAcl` (rate-limit 1000 req/IP/5min
   + `AWSManagedRulesCommonRuleSet`) already existed but inspected no traffic. Added
   `aws.wafv2.WebAclAssociation` for `erp.nodes.loadBalancer.arn` and
   `mes.nodes.loadBalancer.arn`. This is the primary control for the incident class —
   the scanner's ~2,700 req/5min from a source IP now trips the rate rule, and the
   managed set flags the `/etc/passwd`, `../`, `@fs` traversal probes.
2. **Request-count autoscaling.** Added `requestCount: 500` to both services' `scaling`
   (kept `min: 1`, `max: 10`). CPU/mem triggers never fired under the I/O-bound pile-up;
   this adds capacity for *legitimate* sustained bursts. Safe now that the WAF blocks
   floods before they reach targets — otherwise it would scale out to serve garbage.

### Validate before/at merge (can't typecheck locally — `.sst/platform` types are generated at deploy)
```bash
# read-only preview against a stage; confirms requestCount + WebAclAssociation resolve
npx --yes sst@3.17.24 diff --stage prod
```
CI deploys on merge to `main` touching `packages/**`/`apps/{erp,mes}/**`; a bad property
fails the per-workspace deploy, so confirm the diff is clean first.

### Cost-ceiling knobs (decide deliberately)
- `scaling.max` is the hard Fargate compute ceiling: worst case = `max × 2 services ×
  N workspaces`. 10 is generous for one tenant; drop to 4–6 for a tighter ceiling.
- WAF cost is trivial (~$5/web-ACL/mo + ~$1/rule + $0.60/M req) vs. what it prevents.

## To do — commercial payer account (NOT GovCloud)

GovCloud has no billing console; `budgets.*` and `ce.*` endpoints don't exist in
`us-gov-east-1`. GovCloud charges bill to the **paired commercial account**, so Budgets
and Cost Anomaly Detection are created there (provider region `us-east-1`), filtered to
the linked account. Pulumi snippet to drop into that account's IaC:

```ts
// provider: commercial account, region us-east-1
const alertEmail = "cloud-alerts@carbon.ms"; // set real recipient / SNS

// 1) Monthly budget with forecasted + actual alerts
new aws.budgets.Budget("GovCloudMonthlyBudget", {
  budgetType: "COST",
  timeUnit: "MONTHLY",
  limitAmount: "3000",          // set to expected monthly + headroom
  limitUnit: "USD",
  // Scope to the GovCloud usage as it appears in the payer account:
  costFilters: [{ name: "LinkedAccount", values: ["<LINKED_ACCOUNT_ID>"] }],
  notifications: [
    { comparisonOperator: "GREATER_THAN", threshold: 80,  thresholdType: "PERCENTAGE",
      notificationType: "ACTUAL",     subscriberEmailAddresses: [alertEmail] },
    { comparisonOperator: "GREATER_THAN", threshold: 100, thresholdType: "PERCENTAGE",
      notificationType: "FORECASTED", subscriberEmailAddresses: [alertEmail] },
  ],
});

// 2) ML anomaly detection — catches spikes you didn't set a threshold for
const monitor = new aws.costexplorer.AnomalyMonitor("ServiceAnomalyMonitor", {
  name: "carbon-service-monitor",
  monitorType: "DIMENSIONAL",
  monitorDimension: "SERVICE",
});
new aws.costexplorer.AnomalySubscription("ServiceAnomalySubscription", {
  name: "carbon-anomaly-alerts",
  frequency: "DAILY",
  monitorArnLists: [monitor.arn],
  subscribers: [{ type: "EMAIL", address: alertEmail }],
  thresholdExpression: {
    dimension: { key: "ANOMALY_TOTAL_IMPACT_ABSOLUTE", values: ["100"], matchOptions: ["GREATER_THAN_OR_EQUAL"] },
  },
});
```
Optional hard backstop: a **Budget Action** at a ceiling that applies a restrictive IAM
policy / notifies SNS. Blunt — prefer `max` + WAF + anomaly alerts for prod.

## To do — ALB access logs (GovCloud/SST, follow-up)

Disabled today, so no source IPs were recoverable for this incident. Wire an S3 bucket +
`transform.loadBalancer.accessLogs`; the only real work is the bucket policy granting the
GovCloud ELB log-delivery principal (`us-gov-east-1` ELB account, or the
`logdelivery.elasticloadbalancing.amazonaws.com` service principal) write access.

## Already fine (checked, no action)
- CloudWatch Logs retention: 30 days on all four Carbon log groups (~20 MB each).
