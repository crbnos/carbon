# FIDS Reuse / Wrap / Build Matrix

> Classification is evidence-based against `docs/fids/FIDS_Component_Inventory.md`. “Build” means a small P0 semantic component built on the existing Carbon primitives, never a replacement primitive library. It does not authorize P1 App Shell, P2 Production Order 360, ERP workspace redesign, MES execution changes, routing changes, or business-workflow changes.

## Decision criteria

| Decision | Applied rule |
|---|---|
| **REUSE** | The inspected component already provides the interaction and structural UX required; FIDS adds no separate domain behavior. |
| **WRAP** | The existing component is a sound primitive or source adapter, but it lacks the canonical Factory OS vocabulary, typed state, explicit unknown behavior, or domain boundary required by P0. |
| **BUILD** | No inspected implementation satisfies the required P0 semantic contract. The new component must compose existing Carbon primitives and semantic aliases. |
| **DEFER** | The asset is useful, but it is not required to establish the five P0 semantic components and would broaden scope. |

## Matrix

| FIDS component / requirement | Existing asset (evidence) | Decision | Reason and P0 boundary |
|---|---|---|---|
| Button and icon action | `packages/react/src/Button.tsx`, `IconButton.tsx`; production `JobHeader.tsx` uses both | **REUSE** | Existing variants, loading/disabled behavior, focus treatment and labelled icon-button contract meet the primitive requirement. Do not create `FidsButton`. |
| Card/surface | `packages/react/src/Card.tsx`; quality `RiskRegisterCard.tsx` | **REUSE** | Existing Card family supplies surface composition and optional collapse. Semantic components may compose it but must not duplicate it. |
| Industrial data table | `packages/react/src/Table.tsx`; ERP `app/components/Table/Table.tsx`; `JobsTable.tsx` / `JobOperationsTable.tsx` | **REUSE** | Core semantic HTML table and ERP data-table behavior already exist. P0 must not replace existing industrial tables. |
| Drawer | `packages/react/src/Drawer.tsx`; `Jobs/ProductionQuantityForm.tsx` | **REUSE** | Radix-based dialog behavior and responsive sheet sizing are already present. Reuse when a FIDS action needs drill-in. |
| Modal/dialog | `packages/react/src/Modal.tsx`, `ModalDrawer.tsx`, `ModalCard.tsx`; ERP/MES production call sites | **REUSE** | Existing overlays provide focus and close behavior. FIDS must not create a second dialog primitive. |
| Tooltip | `packages/react/src/Tooltip.tsx`; ERP `JobOrderStatus.tsx` and pagination | **REUSE** | Existing tooltip behavior is sufficient for supplementary explanations. It cannot be the sole carrier of critical FIDS state. |
| In-context alert | `packages/react/src/Alert.tsx`; ERP production alerts and MES inspection flows | **REUSE** | Existing role-based alert is appropriate for an in-context notice inside a semantic component. It is not the semantic component itself. |
| Canonical `StatusBadge` | `packages/react/src/Badge.tsx`, `Status.tsx`; `packages/utils/src/status-colors.ts`; ERP `Jobs/JobStatus.tsx` | **WRAP** | Existing primitives present a color, icon and label, but accept free-form palette colors and source adapters hide unmapped values. Wrap with typed canonical state, visible `unknown`, canonical terminology and non-color communication. Source state remains intact. |
| Source-state color adapter | `packages/utils/src/status-colors.ts` | **WRAP** | It is a proven source enum-to-hue registry, but colors are not an ontology. An adapter layer may consume it without overwriting ERP/MES source values. |
| `RiskIndicator` | Quality `RiskRegisterCard.tsx`, `RiskRating.tsx` usage; no generic indicator located | **BUILD** | The repository has persistent risk records with severity/likelihood and lifecycle, proving risk is distinct from status, but no compact typed low/medium/high/none/unknown indicator exists. Build on Badge/icon/text primitives; do not merge risk with production state. |
| `ObjectHeader` | ERP `Jobs/JobHeader.tsx` | **BUILD** | The existing header is explicitly coupled to Job routing, permissions and ERP mutations. Build a generic identity/metadata/action composition component that does not assume a Production Order and does not take over a workspace header. |
| `ExceptionCard` | `Alert.tsx`; MES display reason functions; Job/quality risk surfaces | **BUILD** | There is no component that separates fact, inference and recommendation while representing location, severity, impact, owner, next step and available action with optional source data. Compose existing Card/Alert/Badge/Button. |
| `EvidencePanel` | MES `DisplayFrame.tsx` has a display-refresh timestamp; repository search found no user-facing record provenance/freshness panel | **BUILD** | Refresh time is not evidence provenance. Build a business-readable record presentation with source system, object/reference, fact/value, timestamp, freshness and available version/provenance; do not default to raw JSON or imply freshness when time is absent. |
| Semantic aliases for status, risk and machine | Shared theme in `packages/config/tailwind/theme.css`; source hue registry | **WRAP** | Existing theme primitives and dark-mode variables should be reused. Add aliases at the FIDS semantic layer rather than duplicating colors or creating a theme engine. Exact source-to-canonical mappings require the later status-model audit. |
| Machine / equipment canonical taxonomy | MES `utils/display.ts` (`ok`/`alert`, `blocked`/`idle`), work-display route | **WRAP** | The MES model proves limited wall-display semantics but not a full Factory OS machine taxonomy. Wrap only evidence-supported mappings; mark others `REQUIRES_DOMAIN_CONFIRMATION`. Do not alter MES execution logic. |
| Evidence freshness display | `DisplayFrame.tsx` “Updated” footer | **BUILD** | Its timestamp denotes successful page revalidation, not individual source-record freshness. Evidence freshness must be typed and distinguish `fresh`, `aging`, `stale` and `unknown`. |
| Timeline / historical decision sequence | ERP `app/components/Timeline.tsx` | **DEFER** | Generic visual timeline exists but is pointer-oriented and not required for the first five semantic components. Defer a decision/evidence timeline until a bounded use case is approved. |
| Application shell / navigation | ERP Layout components and MES route shells | **DEFER** | Explicitly P1; this P0 matrix does not authorize changes. |
| Production Order 360 reference experience | ERP Job workspace and MES job-operation views | **DEFER** | Explicitly P2; this P0 matrix does not authorize a composite order experience. |
| Exception Center / broad dashboard | Existing risk, alert, and display surfaces | **DEFER** | No P0 requirement and would broaden the work into new routing/workflows. |

## Required implementation shape implied by the matrix

```text
@carbon/react primitives + existing theme tokens
                 ↓
FIDS typed semantic wrapper/component
                 ↓
Source-system value retained alongside canonical presentation meaning
```

The implementation must follow the governing reasoning sequence for each semantic component:

```text
Role → Object → Relationship → Process → State → Exception → Decision → Action → Evidence → UI
```

## P0 guardrails

- `StatusBadge`, `RiskIndicator`, `ObjectHeader`, `ExceptionCard` and `EvidencePanel` are the only new primary semantic components permitted by the P0 plan.
- Reuse/WRAP classifications do not authorize editing ERP source-of-record behavior or MES execution state transitions.
- An unknown/unmapped source state must remain visibly unknown; it must not become a silent `normal` state or disappear.
- Status and risk remain distinct fields and visual semantics.
- A later FIDS showcase must use existing story/demo conventions where available. Repository audit found Vitest but no Storybook/component-preview configuration; do not introduce a broad preview platform without a scoped implementation decision.
