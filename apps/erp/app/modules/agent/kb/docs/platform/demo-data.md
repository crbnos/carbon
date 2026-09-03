# Demo data

> Fill a company with a realistic industry story, so every screen has something in it, and put back exactly what was there before with one click.

Demo data fills a company with a full, coherent industry story: items with BOMs and routings, customers and suppliers, quotes, orders, jobs, inspections, change orders and ledger entries. Every list screen has rows and every detail screen opens, which makes it the fastest way to explore Carbon, demo it, or test against realistic data. You apply it from **Settings → Demo Data**, or pick it at sign-up as **"Use a demo template"**.

## The templates

Each template tells one industry's story, end to end, across sales, purchasing, production, quality and accounting:

  - **Aerospace &amp; Satellite**: A satellite manufacturer, from RFQs through built and inspected flight hardware.
  - **Robotics OEM**: A robotics maker building assemblies to order.
  - **Precision Manufacturing**: A machine shop quoting and cutting precision parts.
  - **Motor Assembly**: An automotive supplier assembling motors.

Every seeded date is relative to the day you apply the template, so the company always looks live: recent orders, jobs in progress, upcoming due dates. Parts come with real thumbnails, and each industry includes a 3D assembly you can open in the viewer.

Demo data is seeded fresh from Carbon's own dataset definitions each time, not imported from a stored backup file. That's why it always matches the current version of the app. To stand a company up from another company's actual data, use a `docs/platform/backups` instead.

## Apply a template

On **Settings → Demo Data**, the "Apply a demo template" card lists the templates; select **"Apply"** on one. It is safe to try on a company that already has data: Carbon saves a copy of your current data first, then replaces it with the demo story. The page shows each phase as it runs, from **"Saving a copy of your current data"** through **"Adding demo records"**, and it keeps running if you leave the page.

When it finishes, the **"Demo data applied"** card asks you to decide:

- **"Keep"** accepts the demo data.
- **"Revert"** puts back exactly what was here before.

The choice stays open until you make it, and only one demo-data change can be in flight per company. Applying is all-or-nothing: if anything fails partway, no rows are written and the card shows the error with a **"Dismiss"** button.

If a revert seems stuck, the card says so after a few minutes and offers "Retry revert". The saved copy of your data is kept until the revert succeeds, so retrying is always safe.

## Demo data at sign-up

The same templates power onboarding. When Carbon staff create a new company, the data step asks **"How would you like to start?"**:

  - **Use a demo template**: Sets up sample customers, suppliers, parts and orders for the industry you pick. They appear shortly after you finish.
  - **Restore from a backup**: Sets the new company up from an uploaded Carbon `docs/platform/backups` of another company.
  - **I don't need data**: Starts with a clean, empty environment.

Choosing a template then asks **"Which best describes your company?"** and seeds the matching industry. See `docs/reference/onboarding` for the rest of the wizard.

Demo Data sits behind the same gate as Backups, since it replaces a company's data wholesale. On production deployments it is currently limited to Carbon staff; on a local development stack it is open to everyone.

## Troubleshooting

### The Demo Data page isn't in my Settings menu
On production deployments Demo Data is visible to internal Carbon staff accounts only; on a local development stack it is open to everyone. Its absence for a regular customer account is expected — same gate as Backups.

### I applied a template and want my old data back
Use "Revert" on the "Demo data applied" card. Carbon saved a copy of your data immediately before applying, and the card stays open until you choose Keep or Revert — reverting puts back exactly what was there before.

### The apply or revert looks stuck
It keeps running even if you leave the page. If it's been more than a few minutes, the card shows "This is taking longer than expected" and offers "Retry revert" — safe to click, because the saved copy of your data is kept until the revert succeeds.

### Can't apply a second template
Only one demo-data change can be open per company. Resolve the pending one first — Keep or Revert on the review card (or Dismiss if it failed).

### Applying failed with an error
Applying is all-or-nothing: a failure writes no rows and your data is unchanged. The card shows the job's error next to "Failed"; Dismiss clears it, and you can apply again.

### The demo dates look recent — is that real activity?
Yes, by design: every seeded date is relative to the day the template was applied, so the company always looks live with recent orders and jobs in progress.
