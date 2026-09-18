# Getting started

> The first-run setup wizard that creates your company, seeds its baseline configuration, and hands you a working tenant.

A brand-new account has no company yet, so Carbon holds you in the setup wizard at `/onboarding` until one exists. Onboarding counts as complete when the company has a **name** and at least **one location**; those two facts are the gate, and finishing the Company step supplies both.

**Theme.** Pick a color theme (cosmetic, stored in a cookie).

**Your profile.** First and last name, both required.

**Company.** The substantive step: company name, full address, base currency, optional website. Submitting creates the company and everything a usable tenant needs.

Two steps appear conditionally: **Industry** (internal Carbon staff only: offers a `docs/platform/demo-data` or a `docs/platform/backups` restore) and **Plan** (Carbon Cloud only: Stripe checkout; self-hosted installs go straight to the app).

Saving the company also creates a **"Headquarters"** location from your address, links you as an employee, and seeds the baseline: chart of accounts, posting accounts, numbering sequences, payment terms, units of measure. Fiscal year, periods, and sequences are deliberately *not* asked for — they come pre-seeded and you tune them later under `docs/reference/company-settings`.

## Where to go next

The wizard's job is a working tenant, not a configured one. Refine the seeded settings under `docs/reference/company-settings`, set up your document numbering under `docs/reference/sequences`, add your team under `docs/reference/people`, and read the [guides](/guides) for how work flows through Carbon once you're set up.

## Internals and troubleshooting

The completion gate is the layout loader (`routes/onboarding+/_layout.tsx:33-44`); step order is `utils/path.ts:2103-2109`; conditional steps at `_layout.tsx:49-53`. Theme validator `settings.models.ts:306-311`; profile `onboardingUserValidator` (`account.models.ts:12-17`); company `addressValidator` (`settings.models.ts:95-107`). Provisioning runs `provisionOnboardingCompany` (`services/onboarding.server.ts`) with the seed via `seedCompany` (`settings.service.ts:751-765`).

### Stuck in the setup wizard / keeps redirecting to /onboarding
The company lacks a name or a location — there is no `onboarded` flag. Complete the Company step; it creates both at once.

### The Industry step isn't showing
Internal Carbon staff accounts only. Its absence for regular sign-ups is expected.

### The Plan step isn't showing
Cloud-only (app.carbon.ms). Self-hosted installs skip it and land at `/x`.
