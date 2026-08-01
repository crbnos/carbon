# Permissions and access

> How Carbon decides who can see and change what, from the module-action model to employee types, groups, invites, and shop-floor PIN accounts.

Everyone who works in Carbon signs in against one company, and Carbon decides what they can do from a set of small, explicit grants. A grant is a pair: a **module** (a slice of the app, like Sales or Inventory) and an **action** on it (view, create, update, or delete). Grant someone `sales_view` and they can read sales orders; grant `inventory_update` and they can edit inventory. Nothing is implied and nothing is global. A person with no grants can sign in and see nothing.

You rarely set those grants one at a time. Each employee gets an **employee type** that carries a template of grants, and you tune the exceptions per person from there. This page is the map of that system, from the permission model at the bottom to the people at the top. For the individuals themselves see `docs/reference/people`; for programmatic access that uses the same model, see `docs/reference/api-keys`.

## The module-action model

A single permission is written `<module>_<action>` — `sales_view`, `inventory_update`, `purchasing_create`. The **modules** are a fixed set defined in the database (the `module` enum, `packages/database/supabase/migrations/20240909194622_jobs.sql:10`, with `Quality` added in `20250325103806_quality-module.sql:1`):

Accounting, Documents, Invoicing, Inventory, Parts, People, Production, Purchasing, Quality, Resources, Sales, Settings, and Users. A few internal modules exist in the data (Items, Messaging, Timecards) but are hidden from the permission screens (`apps/erp/app/hooks/usePermissionMatrix.ts:64`), so what you edit is the list above.

The **actions** are always the same four (`apps/erp/app/hooks/usePermissionMatrix.ts:56`):

  - **view**: Read records in the module. Without it, the module's pages are invisible to that user.
  - **create**: Add new records.
  - **update**: Edit existing records.
  - **delete**: Remove records.

Every permission screen in Carbon is the same widget: a matrix with a **row per module and a checkbox per action** (`apps/erp/app/components/PermissionMatrix.tsx`). Toggle a cell for one grant, a row to flip a whole module, or the header to select everything. The employee-type template, a single employee's overrides, the bulk editor, and even an API key's scopes all render this identical matrix, so the mental model is the same everywhere.

Internally each grant stores the list of companies it applies to, so one person can hold different permissions in each company they belong to. In the UI you always edit permissions for the company you're currently in. The special value `"0"` means "all companies" and is how a true cross-company administrator is represented. See `docs/reference/intercompany` for how a user spans several companies.

Carbon enforces these grants in two places at once. The app checks them to show or hide screens and buttons, and the database enforces the same grants through row-level security, so a request that skips the UI still can't reach data the grant doesn't allow. That second layer is what makes the same model safe for `docs/reference/api-keys`, which carry scopes in exactly this `module_action` shape.

## Employee types

An **employee type** is a named permission template. Instead of hand-checking dozens of cells for every hire, you define a type once (say "Buyer" with full Purchasing and view-only Inventory) and assign it. Each type is edited with the same matrix under **Settings → Users → Employee Types**, and its grants become the starting point for anyone you assign to it.

Changing a type's permissions only sets the defaults for people assigned *after* the change. Employees already on that type keep the permissions they have. To push a change to existing staff, use the bulk permission editor below.

Two types are seeded and can't be deleted, marked by a stable `systemType` value so an admin can rename their display label without breaking Carbon's internal lookups (`packages/database/supabase/migrations/20260401000000_protect-console-operator-type.sql:6`):

  - **Admin**: The full-access type. Assign it to the people who run the company's Carbon setup.
  - **Console Operator**: The type given to shop-floor PIN accounts. It's managed automatically when you add an operator (below), not something you assign by hand.

Every other type is yours to create, rename, and delete. A company can hold at most one type of each system kind, enforced by a unique index (`20260401000000_protect-console-operator-type.sql:20`).

## Per-person overrides and bulk edits

A type gives everyone the same start; real people need exceptions. Open a single employee under **Settings → Users → Accounts** and their permission matrix is pre-filled from their type. Check or uncheck any cell to override just that person. Their type stays the same as a label. Switching the type from the person's screen doesn't silently rewrite their grants either — Carbon asks first whether you want to overwrite the current set with the new type's template or keep what they have.

When a change needs to reach many people at once, use the **bulk permission editor**. Select the users, pick a mode, then set the matrix:

  - **Add**: Layer the selected grants on top of whatever each user already has. Nothing is taken away.
  - **Update**: Replace each selected user's permission set wholesale with the matrix below.

This is the tool for propagating an employee-type change to existing staff, or for granting a new module to a whole department in one action. The two modes are the difference between "give everyone these too" and "make everyone exactly this" — reach for **Update** only when you mean to overwrite.

Carbon caches each user's effective permissions for speed. When you change someone's grants, Carbon clears their cache so the new permissions apply on their next request. If a change ever seems not to have taken, it's almost always a stale session — signing out and back in forces a fresh read.

## Inviting people

You don't create passwords for people. You **invite** them by email, and they set up their own sign-in when they accept. Add an employee under **Settings → Users → Accounts** with their name, email, employee type, and location. Carbon creates their account, records an invite, and emails them a link to finish joining.

Because an invite is a real record, an employee has a clear **status** derived from it and their account (the `employees` view, `packages/database/supabase/migrations/20260529160000_employees-view-status.sql:16`):

  - **Invited**: The invite has been sent but not yet accepted. The person can't sign in until they follow the link.
  - **Active**: The invite was accepted and the account is live. This is the normal working state.
  - **Inactive**: The account has been deactivated, or the invite was revoked before acceptance. No access.

An invite is a company-scoped record keyed by email, and it carries the permission set the person will start with, so their grants are ready the moment they accept. While it's outstanding you can **resend** the invite email or **revoke** it entirely, both from the accounts list. Deactivating an active employee removes them from the company, strips their grants, and marks them inactive; it doesn't delete the person, who may still belong to other companies. For the full picture of a person's record, see `docs/reference/people`.

## Shop-floor PIN accounts

Not everyone who needs to touch Carbon has an email inbox. A machinist on the floor signs in to the `docs/reference/mes` with a **4-digit PIN** on a shared station tablet, not a magic link. These are **console operators**, and they're a distinct kind of account.

Add one under **Settings → Users → Operators** (visible only when console mode is enabled for the company) with a name, a location, and a 4-digit PIN (`apps/erp/app/modules/users/users.models.ts:31`). Carbon creates a lightweight account with no email login and assigns it the **Console Operator** employee type automatically. On the shop floor the operator taps their name and enters the PIN, which Carbon checks against the account before starting their session (`apps/mes/app/routes/x+/console.pin-in.tsx:61`). You can reset an operator's PIN at any time from the same screen.

When a PIN account needs real ERP access, convert it: give it an email and a full employee type, and Carbon promotes the same person to a normal invited user without losing their history (`apps/erp/app/modules/users/users.server.ts:905`). Their old floor activity stays attached to the one identity.

PIN accounts are scoped to the floor by design. They carry only the grants their Console Operator type allows, which is why a lost or shared tablet can't be used to reach the office side of Carbon. For the operator experience itself — clocking on, reporting quantities, issuing material — see the `docs/reference/mes` and the `guides/floor`.

## Where each piece lives

  - People The individual accounts these permissions apply to.
  - API keys Programmatic access using the same module-action scopes.
  - The MES app Where console operators sign in with a PIN and run the floor.

## Troubleshooting

Access gates, PIN accounts, and why a permission change didn't take.

### "Incorrect PIN"
The 4-digit PIN entered on the shop-floor station doesn't match the operator's account. Re-enter it, or reset the operator's PIN from **Settings → Users → Operators**.

### "No PIN set. Please set a PIN in your account settings."
The operator account being signed into has no PIN on record. Set one for that operator from the Operators screen before they can sign in on the floor.

### "PIN must be 4 digits"
Creating or resetting an operator rejects anything that isn't exactly four digits. Enter a 4-digit numeric PIN.

### "Group members are required"
A bulk action — bulk permission edit, group edit, deactivate, resend/revoke invite — was submitted with no users selected. Select at least one user first.

### A user can sign in but sees nothing / can't open a module
Permissions are explicit grants; nothing is implied. A person with no `<module>_view` grant can't see that module's pages at all. Grant the needed `<module>_<action>` via their employee type or a per-person override. The database enforces the same grants through row-level security, so this holds even for API access, not just hidden buttons.

### Editing an employee type didn't change existing people's access
Changing a type's permissions only sets the defaults for people assigned *after* the change; employees already on that type keep their current grants. To push the change to existing staff, use the bulk permission editor (**Update** mode to overwrite, **Add** to layer on).

### A permission change doesn't seem to take effect
Carbon caches each user's effective permissions. A change applies on the user's next request; if it appears stale, have them sign out and back in to force a fresh read.

### The Operators screen isn't there
**Settings → Users → Operators** (shop-floor PIN accounts) is visible only when console mode is enabled for the company. Without it, there's no place to add PIN operators — regular users are invited by email under **Accounts** instead.
