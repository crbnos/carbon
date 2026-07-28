# Risk register

> Track risks and opportunities against any entity, rated by severity and likelihood, and drive each to a resolution.

A risk entry is a titled concern you raise against something in Carbon: a supplier who ships late, an item that fails inspection, a job with a tight deadline. Each entry carries a **type** (a downside risk or an upside opportunity), two independent 1–5 ratings for **severity** and **likelihood**, an assignee, and a status you move from `"Open"` toward `"Closed"` or `"Accepted"`. The register lives in the quality module and reads back into the entity it's attached to, so a part's risks show on the part, a supplier's show on the supplier.

Open the register at **Quality → Risks** for the company-wide list, or add one inline from an item, customer, supplier, job, quote line, or maintenance dispatch page.

## What a risk entry holds

Every entry is one row in `riskRegister` (`quality.models.ts:673`, `riskRegisterValidator`). The fields you set:

  - **title**: Short name for the risk. The only always-required text field.
  - **type**: `Risk` or `Opportunity` — the register tracks both downside and upside. Defaults to `Risk`.
  - **severity**: How bad the impact would be. An independent rating, shown as colored bars (see below).
  - **likelihood**: How probable it is. Rated on the same 1–5 scale, independent of severity.
  - **status**: Where the entry sits in its lifecycle. Defaults to `"Open"`.
  - **source**: The kind of entity this risk is tied to — `Customer`, `General`, `Item`, `Job`, `Quote Line`, `Supplier`, or `Work Center`. Set automatically when you add from an entity page; a standalone risk is `General`.
  - **assignee**: The person responsible. Defaults to whoever created the entry when left blank; a change fires a notification (see below).
  - **description**: A one-line summary shown in the list and on the entity card.
  - **notes**: Rich-text detail, stored as JSON.

Severity and likelihood are stored as two separate 1–5 integers (`CHECK (severity BETWEEN 1 AND 5)`, `migration 20251210060100`). Carbon never multiplies them into a single number or a risk-matrix cell. The UI shows the two ratings side by side, and that is by design. Don't read the register expecting a computed priority.

## Rating severity and likelihood

Both ratings use the same 1–5 scale, rendered by `RiskRating.tsx` as a row of colored bars — one bar per point, colored by level: 1–2 emerald, 3 yellow, 4 orange, 5 red. On an entity card the severity bars sit behind a warning icon and the likelihood bars behind a dice icon, so you can read both at a glance without a number.

Because the two ratings are independent, a low-likelihood, high-severity risk (a rare but catastrophic failure) and a high-likelihood, low-severity one (a frequent nuisance) both show honestly rather than collapsing to the same middle score. You decide how to weigh them.

## Status lifecycle

Status is a free-set enum (`riskStatus`, `quality.models.ts:96`). Carbon does not enforce a state machine — any status can move to any other; you set where the entry stands.

  - **Open**: A newly raised risk, not yet worked. The default for a new entry.
  - **In Review**: Being assessed — someone is deciding whether and how to act on it.
  - **Mitigating**: A treatment is in progress: you're actively reducing the severity or likelihood.
  - **Closed**: Resolved. The risk was mitigated away or no longer applies.
  - **Accepted**: A deliberate decision to live with the risk as-is rather than treat it. An off-path resolution, distinct from `"Closed"`.

There is no separate "mitigation action" entity: treatment is tracked by moving the status through `"In Review"` → `"Mitigating"` and recording detail in the notes field, then landing on `"Closed"` (treated) or `"Accepted"` (tolerated).

## Attaching risks to entities

The same register surfaces as a card on the pages of the things it protects. Each entity page mounts the shared card with a fixed `source` and passes the record's id, so the card shows only that entity's risks and new entries inherit the right source. Wired entry points:

- **Items** — parts, materials, tools, consumables, and services, via `ItemRiskRegister.tsx` (`source="Item"`, which also fills the dedicated `itemId` foreign key).
- **Customers** — `CustomerRiskRegister.tsx`, at the customer's Risks tab.
- **Suppliers** — `SupplierRiskRegister.tsx`, at the supplier's Risks tab.
- **Jobs** — `JobRiskRegister.tsx` (`source="Job"`).
- **Quote lines** — `QuoteLineRiskRegister.tsx` (`source="Quote Line"`).
- **Maintenance dispatches** — the dispatch page mounts the card as well.

The `Work Center` source has no dedicated card; work-center risks are created from the company-wide list and joined into the `riskRegisters` view for display. A standalone risk created from **Quality → Risks** with no entity gets `source="General"`.

The company-wide list (`getRisks`) reads the `riskRegisters` view, which joins the work center name onto the row. The per-entity cards and the single-record edit page read the base `riskRegister` table directly, filtered by `source` and the entity id. Same data, two read paths.

## Who can do what

Creating a risk requires only that you're an **employee** of the company — the new-risk route gates on `role: "employee"`, not a `quality` create permission, so anyone on the floor can raise one. Editing and deleting are stricter: the edit route requires `quality` **update** and the delete route requires `quality` **delete**, both enforced again at the database by row-level security (`migration 20251210060100`).

When you set or change an assignee, Carbon fires a `RiskAssignment` notification to that person (a background `notify` job). On edit it only notifies when the assignee actually changed, so re-saving an entry doesn't re-ping the same owner.

## Relation to issues and CAPA

The risk register is its own table and is **not** linked to non-conformances or their corrective/preventive actions in code — a risk does not spawn an issue, and closing an issue does not touch a risk. They're complementary: an `docs/reference/quality` records a defect that already happened and drives it to closure through workflow tasks, while a risk register entry is forward-looking, capturing something that *might* go wrong (or an opportunity worth pursuing) so you can weigh and treat it before it does. Use the risk register for proactive assessment and the issue system for reactive containment.

## Troubleshooting

Mostly preconditions: the risk register has a permission split and a few validators, but no state machine.

### "Severity is required" / "Likelihood is required" / "Title is required"
Form-validation from the risk validator. A risk needs a title, a severity, and a likelihood before it saves.

### Severity or likelihood is rejected outside 1–5
Both are integers constrained to **1 through 5 inclusive**, enforced by a database CHECK constraint. A value outside that range (or non-integer) is refused. There is no separate `score` column — severity and likelihood are stored independently and not multiplied into a combined score anywhere.

### "Failed to create risk" / "Failed to update risk" / "Failed to delete risk"
The write failed — typically a permission denial at the route or row-level security. See the permission split below.

### Status won't advance the way you expect
Risk status (`Open`, `In Review`, `Mitigating`, `Closed`, `Accepted`) is a **free-set enum, not a state machine** — any value can be set from any other; nothing enforces an order or blocks a transition. If a status "isn't sticking," it's a save/permission failure, not a workflow rule.

### Permission-gated: you can create a risk but can't edit or delete it
Creating a risk only requires that you're an **employee** of the company — anyone on the floor can raise one. Editing requires `quality` **update** and deleting requires `quality` **delete**, both enforced again by row-level security. If create works but edit/delete is blocked, your role has employee access but not the quality update/delete permissions.
