---
paths: []
triggers: []
promoted: null
---
# A Ramp custom accounting field is typed OTHER — match it by external id, never by the type enum

**Context:** Carbon pushes cost centers to Ramp as a custom `SINGLE_CHOICE` accounting field (`POST /accounting/fields`, `id: "carbon-cost-center"`) so a card holder can tag a charge with a project. The read-back in `ramp-sync` matched a selection's `category_info.type === "COST_CENTER"` to recover the cost center.

**Problem:** The custom-field create body has no `type` property, so Ramp reports its selections as `OTHER`; `COST_CENTER` is Ramp's native enum for its own cost-center concept. The match never fired, `costCenterId` stayed null, and every project tag was silently dropped — while the GL-account leg (a native `GL_ACCOUNT` field) worked, so the sandbox verification of "a coded transaction" proved nothing about the custom field. Three more breaks hid behind it: the push sent `external_id` where Ramp wants `id` (and the string id as `field_id`, which wants the `ramp_id` UUID), `POST /field-options` is all-or-nothing and rejects existing options so every second converge threw into a swallowed `catch`, and the posting function needs a `CostCenter` `dimension` row that nothing seeds for company groups created after the `20260228024512` backfill.

**Rule:** Identify a custom Ramp field by `category_info.external_id` (the `id` Carbon created it with), and keep that constant in one pure, unit-tested module (`packages/ee/src/ramp/lib/coding.ts`). Treat every Carbon → Ramp push as a converge (list, diff by fingerprint, create/PATCH/hide) and verify the *inbound* leg of a custom field on the sandbox separately from the native GL account. A tag the customer typed must fail loudly if it cannot be kept — never post a balanced journal that lost it.

**Applies to:** `pushCostCenters` / `pushChartOfAccounts` and any future Ramp coding field (departments, locations); `codeSelections`; `post-charge`'s dimension write; and, generally, any integration where a provider echoes an ERP-created object under a different classification than the ERP's own.
