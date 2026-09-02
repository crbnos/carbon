# SolidWorks Connector — Test Plan

Acceptance for Architecture A (local connector, outbound HTTPS). Automated tests cover Carbon + connector logic. **Live SolidWorks / PDM is environment-gated** and must not be marked passed without a real Windows + SolidWorks machine.

## Environment checklist (stop if unchecked)

- [ ] SolidWorks installed and licensed
- [ ] Matching bitness (64-bit SW ↔ 64-bit Node)
- [ ] Optional `winax` installed in this package (`pnpm add winax` locally; native Windows module)
- [ ] An assembly can be opened as `ActiveDoc`
- [ ] Custom properties Part Number / Description / Revision present (or mapped in settings)
- [ ] Carbon ERP reachable with API key scopes: `parts_update` + `documents_create`
- [ ] Optional: existing `{basename}.pdf` / `{basename}.step` beside CAD files

If SolidWorks is unavailable, record **REQUIRES SOLIDWORKS** and use the automated suite only.

## Automated (CI — no SolidWorks)

```bash
pnpm --filter @carbon/solidworks-connector test
pnpm --filter @carbon/solidworks-connector typecheck
pnpm exec vitest run app/routes/api+/integrations.solidworks.models.test.ts --config apps/erp/vitest.config.ts
pnpm --filter @carbon/jobs test -- src/inngest/functions/integrations/onshape-matching.test.ts
pnpm exec turbo run typecheck --filter=erp
```

Proven by mocks only: property maps, BOM aggregation, asset path rules, CarbonClient headers/errors, send workflow with `FakeSolidWorksSession`, payload validation, Onshape matching regression.

**Not proven:** winax GetObject, ActiveDoc, GetComponents(true), GetChildren, GetSuppression2, CustomPropertyManager Get/Get6, bitness, live HTTPS to a real tenant.

---

## Real SolidWorks sequence (exact)

Prerequisites: `crbn up` (or deployed ERP). Create API key under **Settings → API Keys** with **only** `parts_update` and `documents_create` for this company. Set:

```bash
set CARBON_BASE_URL=http://localhost:3000
set CARBON_API_KEY=crbn_...
```

Launch GUI (preferred) or CLI:

```bash
pnpm --filter @carbon/solidworks-connector gui
# or
pnpm --filter @carbon/solidworks-connector start
```

### A. Connection

1. Start SolidWorks. Leave no document open.
2. Click **Refresh** (GUI) or run CLI without `--yes`.
3. **Pass:** Status error `SolidWorks has no active document` (or equivalent actionable message).
4. Close SolidWorks entirely; Refresh again.
5. **Pass:** `SolidWorks is not running` (also covers missing `winax`).

### B. Simple assembly

1. Open a simple assembly (one or two parts) as ActiveDoc.
2. Refresh.
3. **Pass:** Status connected; Assembly name matches file; not a part/drawing.

### C. Metadata

1. Confirm Part Number, Description, Revision appear in the UI/CLI preview.
2. Temporarily clear Part Number custom property; Refresh/Send.
3. **Pass:** `missing-part-number` (or equivalent); Send blocked.
4. Restore properties.

### D. Nested BOM

1. Open an assembly with a subassembly that contains parts.
2. Send.
3. **Pass:** Carbon make method shows dotted indexes (`1`, `1.1`, …); subassembly is Make; leaves Buy (default heuristic).

### E. Quantities / repeated parts

1. Open an assembly with the same part inserted twice at the same level.
2. Send.
3. **Pass:** One BOM row with quantity `2` (not two quantity-1 rows).

### F. PDF

1. Place `{assemblyBasename}.pdf` next to the assembly (and optionally component PDFs).
2. Send (key must include `documents_create`).
3. **Pass:** PDF attached on the matching Carbon item (`document` under Part); wrong PN/rev must not receive it.

### G. STEP

1. Place `{basename}.step` or `.stp` next to CAD.
2. Send.
3. **Pass:** `modelUpload` linked on item; `model-optimize` triggered.

### H. Carbon upload

1. Open the root item in Carbon by `readableIdWithRevision` (e.g. `ASM-100.B`).
2. **Pass:** Name/description match; BOM tree present; assets on correct items.

### I. Duplicate send

1. Send the **same** assembly/revision again without changing CAD.
2. **Pass:** Same root `itemId`; no second item with the same `readableIdWithRevision`; make-method materials replaced (not duplicated rows from a second insert without clear).

### J. Network failure

1. Set `CARBON_BASE_URL` to an unreachable host; Send.
2. **Pass:** Actionable network/timeout error; no crash dump of the API key.

### K. Missing metadata

1. Missing Revision → Send fails with missing-revision.
2. Missing Description (default `requireDescription: true`) → missing-description.
3. **Pass:** No Carbon write occurs.

### L. Missing / invalid assets

1. No PDF/STEP → Send succeeds; warnings listed; item+BOM still created.
2. Only PDF or only STEP → that asset uploads; the other warns.
3. `{basename}.exe` or empty PDF → rejected/warned; not uploaded.
4. File outside assembly tree without `allowedRoots` → rejected.

---

## COM methods that require live validation

| Call | Why mocks are insufficient |
|------|----------------------------|
| `winax` + `SldWorks.Application` `{getobject:true}` | Native module + ProgID |
| `ActiveDoc`, `GetType` | Document state |
| `GetComponents(true)` + `GetChildren` | Tree shape; false would flatten+duplicate |
| `GetSuppression2` / `GetSuppression` | Must not use `IsSuppressed` alone (true for lightweight) |
| `GetModelDoc2` | Null when lightweight |
| `Extension.CustomPropertyManager` + `Get` / `Get6` / `Get4` | ByRef marshalling under winax |
| `ReferencedConfiguration`, `GetPathName` | Vault vs local paths |

---

## Explicit non-claims

- Real SolidWorks e2e until the checklist above is executed on a SW machine
- PDM data-card enrichment without SW property mapping
- Generating PDF/STEP
- Carbon PDM picker / poll / webhook
- SolidWorks add-in MSI
