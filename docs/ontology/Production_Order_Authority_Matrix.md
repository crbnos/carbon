# Production Order Authority Matrix

| Canonical concept | ERPNext source | Carbon MES source | Authority | Confidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Production Order identity | Work Order `name` | Job `id` / `jobId` | Factory OS projection retains both | REQUIRES_DOMAIN_CONFIRMATION | Merge requires explicit lineage; IDs are never fuzzy-matched. |
| Display name | Work Order item/name | Job display/item | Factory OS presentation | HIGH_CONFIDENCE | Source values are preserved. |
| Planned quantity | Work Order `qty` | Job `quantity` copied into Carbon | ERPNext planning | CONFIRMED | Metric remains source-labelled. |
| Execution quantity | No authoritative ERP execution projection in this MVP | Job execution/production quantity fields | Carbon MES | PARTIAL | Do not equate with canonical completed quantity. |
| Job quantity complete | Work Order `produced_qty` is a source fact | Job `quantityComplete` | Carbon MES for the raw field | REQUIRES_DOMAIN_CONFIRMATION | 1/1/0 demonstrates aggregation ambiguity. |
| Operation completed quantity | Work Order operation planning fields | JobOperation `quantityComplete` | Carbon MES operation | CONFIRMED | Operation-level metric only. |
| Planned start/finish | Work Order planned dates | Job schedule fields | ERPNext planning | HIGH_CONFIDENCE | No cross-system timezone policy is added. |
| Actual start/finish | Job Card actual dates | Production event / Job operation dates | Carbon MES execution | PARTIAL | Preserve both source values. |
| Due/required date | Work Order `expected_delivery_date` | Job `dueDate` | ERPNext planning | HIGH_CONFIDENCE | Distinct field names are retained. |
| Planning status | Work Order `status` | Job raw `status` | Source-specific | REQUIRES_DOMAIN_CONFIRMATION | No silent status crosswalk. |
| Operation execution state | Job Card status | JobOperation status | Carbon MES execution | HIGH_CONFIDENCE | ERP operation state remains separate. |
| Work center/equipment reference | Workstation / Workstation Type | Work Center | Source-specific | PARTIAL | Workstation is not collapsed into Work Center. |

Factory OS does not become a third operational source of truth. The merge
function only combines authority-labelled facts when lineage is explicitly
confirmed.
