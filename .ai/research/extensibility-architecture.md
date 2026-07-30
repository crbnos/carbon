# Research: Extensibility & Upgrade-Safety in Open-Source ERPs

> Date: 2026-07-12
> Feeds: `.ai/specs/2026-07-12-extensibility-architecture.md`
> Mode: autonomous (synthesized for the extensibility architecture spec; no human interview)

## Question

How do mature open-source ERPs let third parties extend the system (fields,
behavior, processes), and why do those mechanisms make upgrades painful? What
should Carbon copy, and what should it structurally avoid?

## Findings by competitor

### ERPNext / Frappe

- **Mechanism:** `hooks.py` (event hooks with no payload contract), server
  scripts (Python stored in the DB), monkey-patching via `override_whitelisted_methods`,
  and **Custom Fields** stored as DocType metadata — an EAV-flavored,
  application-level schema that Postgres/MariaDB knows nothing about.
- **Consequences:** no type safety or FK integrity on custom fields; hook
  payloads are whatever the emitting version happens to pass; any app can
  import any app. Upgrades are manual regression work — customizations
  routinely break silently because nothing is versioned and nothing is
  contract-tested.
- **Takeaway for Carbon:** named hooks are the right ergonomic, but they need
  versioned, schema-validated payloads and static registration to be
  upgrade-safe. Metadata-level custom fields are the anti-pattern to avoid.

### Odoo

- **Mechanism:** ORM class inheritance (`_inherit`) — an extension module
  patches core models *in place*, including ALTERing core tables and
  overriding core methods. Automated/server actions for imperative automation.
- **Consequences:** extensions couple to core internals by construction, so
  every major upgrade breaks them; the ecosystem's answer is a paid migration
  service and multi-week consulting projects (OpenUpgrade exists because the
  problem is that bad). Module isolation is effectively nil.
- **Takeaway for Carbon:** never allow in-place override of core behavior or
  core schema. The absence of an override mechanism is a feature.

### open-mercato (MIT License) — primary prior art

- <https://github.com/open-mercato/open-mercato>, MIT License, © 2025–2026
  Open Mercato contributors. Carbon's spec-writing workflow already credits it
  (see the attribution header in `.ai/skills/spec-writing/SKILL.md`).
- **Mechanism:** a modern TypeScript commerce/ERP platform built around clean
  dependency-injection module contracts — modules interact through declared
  interfaces, not each other's internals. Package boundaries are real.
- **Gaps:** young, shallow ERP domain depth (no MES/QMS/costing), partial
  answers on schema extension and static upgrade-impact analysis.
- **Takeaway for Carbon:** the contract-package discipline is proven and worth
  adopting wholesale; Carbon's opportunity is applying it to a deep ERP domain
  and closing the schema-extension and upgrade-proof gaps it leaves open.

## Cross-cutting findings

- **EAV vs. real tables:** every system that stored extension fields as
  metadata (ERPNext) or JSON traded write-time convenience for permanent
  costs: no indexes, no constraints, unqueryable reporting. Side tables keyed
  1:1 to the core row (composite FK, cascade delete) give real types and RLS
  while leaving core tables untouched.
- **Process automation is the dominant extension shape** in manufacturing:
  approval chains, inspection flows, compliance steps. Systems that offer only
  single-step hooks force every plugin author to hand-roll persistence,
  retries, and cleanup. Durable-execution engines (Inngest, Temporal;
  n8n-like in authoring shape) solve this as infrastructure. Carbon already
  runs Inngest (`@carbon/jobs`), so a workflow primitive can bind to the
  existing backbone rather than a bespoke runner.
- **Upgrade safety is only real if executable:** none of the surveyed systems
  run installed-extension test suites against release candidates. A registry
  corpus + contract tests on every core RC is the differentiating mechanism —
  it converts "we try not to break you" into a CI gate.

## Recommendation

Adopt open-mercato's contract-package discipline; reject Odoo-style override
and ERPNext-style metadata fields; make a durable workflow engine the primary
extension primitive; enforce module isolation at lint, type, and DB-role
levels; and gate every core release on a corpus of extension contract tests.
