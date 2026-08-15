# FIDS Canonical Status Model

## Frozen presentation registry

FIDS exposes exactly eight states matching the shared `CanonicalStatus` type (the React compatibility alias is `CanonicalStatusState`): `normal`, `in-progress`, `completed`, `warning`, `blocked`, `critical`, `cancelled`, and `unknown`. This layer is read-only. Consumers retain `sourceSystem`, raw `sourceState`, and presentation state. An absent or unapproved mapping is `unknown`.

Only semantics that do not require business inference are frozen. `REQUIRES_DOMAIN_CONFIRMATION` rows must not be normalized automatically.

| Domain | Source state | FIDS state | Label | Decision |
|---|---|---|---|---|
| Production Job | In Progress | `in-progress` | In Progress | Frozen |
| Production Job | Completed | `completed` | Completed | Frozen |
| Production Job | Cancelled | `cancelled` | Cancelled | Frozen |
| Production Job | Draft / Planned / Ready / Paused / Closed | `unknown` | Preserve raw label | `REQUIRES_DOMAIN_CONFIRMATION` |
| Production Job | Overdue | `unknown` | Overdue | `REQUIRES_DOMAIN_CONFIRMATION`; deprecated raw enum also has a derived UI equivalent |
| Production Job | Due Today | `unknown` | Due Today | `REQUIRES_DOMAIN_CONFIRMATION`; deprecated raw enum also has a derived UI equivalent |
| Job Operation | In Progress | `in-progress` | In Progress | Frozen |
| Job Operation | Done | `completed` | Done | Frozen |
| Job Operation | Canceled | `cancelled` | Canceled | Frozen |
| Job Operation | Todo / Ready / Waiting / Paused | `unknown` | Preserve raw label | `REQUIRES_DOMAIN_CONFIRMATION` |
| Inspection | In Progress | `in-progress` | In Progress | Frozen |
| Inspection | Passed | `completed` | Passed | Frozen presentation only; not production completion |
| Inspection | Failed | `critical` | Failed | Frozen |
| Inspection | Pending / Partial | `unknown` | Preserve raw label | `REQUIRES_DOMAIN_CONFIRMATION` |
| Inspection Sample | Passed | `completed` | Passed | Frozen presentation only |
| Inspection Sample | Failed | `critical` | Failed | Frozen |
| Inspection Sample | Pending | `unknown` | Pending | `REQUIRES_DOMAIN_CONFIRMATION` |
| Machine / Equipment | any | `unknown` | Preserve raw label | `REQUIRES_DOMAIN_CONFIRMATION`; no shared authoritative enum |
| Material | any `getJobOrderStatusCategory` result | `unknown` | Preserve existing UI label | `REQUIRES_DOMAIN_CONFIRMATION`; category/color is not ontology |
| Risk workflow | Open / In Review / Mitigating / Closed / Accepted | `unknown` | Preserve raw label | `REQUIRES_DOMAIN_CONFIRMATION`; workflow differs from risk level |
| Exception | any | `unknown` | Preserve raw label | `REQUIRES_DOMAIN_CONFIRMATION`; no shared lifecycle |

`plannedJob` is not normalized: its underlying `supplyJobStatus` may be Planned, Ready, In Progress or Paused. Consumers must retain the underlying status and obtain a domain-approved mapping.

## Concept separation

- Status reports lifecycle/condition; risk reports assessed exposure; freshness reports evidence validity.
- Completion is scoped to its object. Operation or inspection completion never proves job completion.
- `blocked`, `critical`, and `cancelled` are distinct.
- RiskIndicator levels are never derived solely from risk workflow status.

## Governed-action lifecycle

Target vocabulary: `draft → proposed → simulation → pending-approval → approved → executing → completed | failed | cancelled | stale`. The action-record `stale` state is distinct from the `stale-evidence` guard that may move an otherwise actionable record into it.

Transitions and authority are not frozen in P0 because no cross-system authorization contract exists. Integration is `REQUIRES_DOMAIN_CONFIRMATION`. P0 requires:

1. Recommendation and simulation remain advisory and cannot imply approval.
2. Approval records the authorized actor and evidence; it cannot imply execution.
3. Execution stays unavailable until approval and freshness checks pass.
4. Stale or unknown evidence blocks by default and prompts refresh/recalculation; overrides require a future explicit policy.
5. Outcomes retain timestamp, actor/system and result evidence when supplied.

## Unknown handling

Unknown is visible. A raw label may be preserved, but unknown semantics remain until mapping approval. Unknown never becomes normal, successful, no-risk or fresh.
