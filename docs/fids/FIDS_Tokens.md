# FIDS Foundation and Tokens

## Contract

FIDS is a semantic layer over the checked-in Carbon theme; it is not a second theme engine. The shared source is `packages/config/tailwind/theme.css`, consumed by ERP and MES. Shared primitives in `packages/react` remain the implementation substrate.

## Foundations

| Foundation | P0 contract | Reuse rule |
|---|---|---|
| Typography | Geist Sans for interface text; Geist Mono for identifiers, measurements, timestamps and evidence references | Use existing `font-sans` and `font-mono` |
| Spacing | 4px rhythm; compact groups 8–12px; section gaps 16–24px | Existing Tailwind scale |
| Grid | One column on mobile; expand at `md`/`lg`; repeatable fact grids | Existing responsive utilities; no fixed dashboard canvas |
| Borders | One-pixel semantic border; radius from `--radius`; elevation secondary to grouping | Existing border/radius/shadow utilities |
| Icons | Lucide; icon accompanies, never replaces, status/risk text | Existing `react-icons/lu` |
| Motion | Feedback/state transitions only; respect reduced motion | Existing transition and `motion-reduce:*` utilities |
| Focus | Every interactive control has a contrasting visible `focus-visible` ring | Existing ring primitives |
| Interaction | Default, hover, focus, active, disabled, loading and error remain distinguishable without color alone | Reuse shared controls and ARIA semantics |

## Role density and responsiveness

| Context | Density contract |
|---|---|
| Executive | Outcome, risk, exception and decision evidence first |
| Planner/supervisor | Compact comparison, dependencies, exceptions and governed actions |
| Operator/MES | Touch-first, minimum 44x44px actions, high contrast, short labels |
| Analyst/auditor | Evidence-rich, timestamped, source-attributed, raw values available |

Never hide status, risk, exception severity or freshness at narrow widths. Reflow vertically and preserve reading order.

## Semantic aliases

| Alias | Primitive | Meaning |
|---|---|---|
| `status-normal` | green | Explicit healthy/normal; never a fallback |
| `status-in-progress` | blue | Actively executing |
| `status-completed` | green | Explicit terminal completion |
| `status-warning` | yellow | Attention, waiting or degradation |
| `status-blocked` | orange | Cannot continue; distinct from failure |
| `status-critical` | red | Failure or critical adverse condition |
| `status-cancelled` | gray | Explicit cancellation; distinct from failure |
| `status-unknown` | gray | Unmapped/unavailable and visibly unknown |
| `risk-high` / `risk-medium` / `risk-low` | red / orange / yellow | Assessed non-zero exposure |
| `risk-none` / `risk-unknown` | green / gray | Explicit no-current-risk / unassessed |
| `evidence-fresh` / `evidence-aging` / `evidence-stale` / `evidence-unknown` | green / yellow / red / gray | Caller-policy freshness; unknown never assumed fresh |

Every alias uses visible text and icon/shape redundancy. Existing variants provide light/dark behavior; consuming screens must verify contrast.

## Governed-action interaction states

Recommendation, simulation, approval and execution are separate. P0 renders state only and never writes.

| State | Meaning | UI obligation |
|---|---|---|
| Recommendation | Advisory proposal | Show facts, evidence and unknowns |
| Simulation | Predicted result, not a transaction | Label simulation and assumptions |
| Pending approval | Awaiting authorized human | Show requirement; execution unavailable |
| Approved | Approval recorded, execution not implied | Show approval evidence and freshness |
| Executing | Authorized write in progress | Prevent duplicate action; show progress |
| Completed | Write succeeded | Show result reference and timestamp |
| Failed | Write failed | Preserve error evidence and safe guidance |
| Cancelled | Explicitly stopped | Preserve actor/reason if supplied |
| Stale evidence | Facts fail freshness policy | Block by default; refresh/recalculate or policy-authorized override |

## Machine aliases

`machine-running`, `machine-idle`, `machine-setup`, `machine-blocked`, `machine-maintenance`, `machine-offline` and `machine-unknown` are reserved. No authoritative shared equipment enum was found; all source mappings are `REQUIRES_DOMAIN_CONFIRMATION`.

## Rules

- Keep source state, presentation state, risk and freshness separate.
- Unknown never resolves to normal, no-risk or fresh.
- Do not infer owner, cause, impact, approval or success from presentation state.
- Do not assign arbitrary feature-level colors to domain states.
