/**
 * Administration — question bank. SERVER ONLY.
 *
 * The questions lean on what the admin docs flag as counterintuitive, because
 * those are what an administrator gets wrong in production: company-wide
 * switches that never backfill, numbers that are stamped once and never
 * recomputed, grants that are per-company and explicit, and the several places
 * Carbon deliberately does nothing — no time-card approval, no data-type
 * change, no custom fields in a CSV, no record created by an extraction.
 */

import type { LearnQuestion } from "../types";

const D = "https://docs.carbon.ms";
const CS = `${D}/docs/reference/company-settings`;
const SEQ = `${D}/docs/reference/sequences`;
const PPL = `${D}/docs/reference/people`;
const PERM = `${D}/docs/reference/permissions`;
const KEYS = `${D}/docs/reference/api-keys`;
const CF = `${D}/docs/reference/custom-fields`;
const IMP = `${D}/docs/reference/import-export`;
const DOC = `${D}/docs/reference/documents`;

export const questions: LearnQuestion[] = [
  // -------------------------------------------------- company settings (9)
  {
    slug: "admin.company.01",
    unitSlug: "company-settings",
    topic: "company",
    bloom: "remember",
    kind: "single",
    prompt:
      "A company's configuration is split across two records. Which pair is it?",
    options: [
      {
        id: "a",
        text: "A `company` row holding identity, address, currency and logos, and a one-to-one `companySettings` row holding the feature flags and defaults"
      },
      {
        id: "b",
        text: "One `company` row per module, each with its own flags"
      },
      {
        id: "c",
        text: "A `company` row and one settings row per user in the company"
      },
      {
        id: "d",
        text: "A single `company` row — every setting is a column on it"
      }
    ],
    answer: "a",
    explanation:
      "Identity lives on `company`; the company-wide switches live on a paired `companySettings` row keyed on the same id. Knowing which record a field is on tells you which Settings page edits it.",
    docsUrl: CS
  },
  {
    slug: "admin.company.02",
    unitSlug: "company-settings",
    topic: "company",
    bloom: "apply",
    kind: "single",
    prompt:
      "Jobs finish, shipments go out, and invoices post as normal, but nothing appears in the general ledger. What is the first thing to check?",
    options: [
      { id: "a", text: "Whether `accountingEnabled` is off for the company" },
      {
        id: "b",
        text: "Whether the journal entry sequence has run out of numbers"
      },
      {
        id: "c",
        text: "Whether each document was individually flagged to post"
      },
      {
        id: "d",
        text: "Whether the base currency matches the supplier's currency"
      }
    ],
    answer: "a",
    explanation:
      "`accountingEnabled` is a company-wide master switch for the whole ledger. When it is off, operations still complete but nothing posts — there is no per-document exception to look for.",
    docsUrl: CS
  },
  {
    slug: "admin.company.03",
    unitSlug: "company-settings",
    topic: "company",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A company ran for six months with accounting off. You turn `accountingEnabled` on in July. What happens to January–June?",
    options: [
      {
        id: "a",
        text: "Nothing — turning it on does not backfill past activity"
      },
      {
        id: "b",
        text: "Carbon replays the six months and posts them overnight"
      },
      {
        id: "c",
        text: "The first post of July carries the six months as an opening entry"
      },
      { id: "d", text: "The toggle is refused until the period is closed" }
    ],
    answer: "a",
    explanation:
      "The switch only governs what posts from now on. Six months of unposted activity stays unposted, so treat the flip as a cut-over date and plan opening balances deliberately.",
    docsUrl: CS
  },
  {
    slug: "admin.company.04",
    unitSlug: "company-settings",
    topic: "company",
    bloom: "apply",
    kind: "single",
    prompt:
      "You set the company theme to Blueberry, but a colleague signing into the same company still sees Modern. Why?",
    options: [
      {
        id: "a",
        text: "Theme is per-person — it is stored in a cookie for that user and browser, not on the company record"
      },
      { id: "b", text: "Their permissions cache has not refreshed yet" },
      { id: "c", text: "Theme only applies to users created after the change" },
      { id: "d", text: "They are signed into a different company" }
    ],
    answer: "a",
    explanation:
      "There is no company theme to set. Each person's choice is a cookie, so two people in the same company can run different themes — and document templates carry their own separate theme setting.",
    docsUrl: CS
  },
  {
    slug: "admin.company.05",
    unitSlug: "company-settings",
    topic: "company",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Which are true of a company's base currency? (Choose all that apply.)",
    options: [
      {
        id: "a",
        text: "Transactions in other currencies are converted to base at their exchange rate before they post"
      },
      {
        id: "b",
        text: "A subsidiary can carry a different base currency from its parent"
      },
      { id: "c", text: "It is required on the company record" },
      { id: "d", text: "It is chosen per document at posting time" },
      {
        id: "e",
        text: "Changing it re-denominates the posted history automatically"
      }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Base currency is the denomination of the whole posted history, which is why conversion happens on the way in and why it is not something you flip casually. Subsidiaries may differ; consolidation is where those meet.",
    docsUrl: CS
  },
  {
    slug: "admin.company.06",
    unitSlug: "company-settings",
    topic: "company",
    bloom: "analyze",
    kind: "single",
    prompt:
      'You created the tag "Urgent" while working on items. A colleague looking at jobs cannot find it. What explains this?',
    options: [
      {
        id: "a",
        text: "A tag is scoped to both a company and a table, so the same label on items and on jobs are different tags"
      },
      {
        id: "b",
        text: "Tags need the Settings update permission to be visible"
      },
      { id: "c", text: "Tags are per-user, like labels on documents" },
      {
        id: "d",
        text: "The tag has to be published before other modules can use it"
      }
    ],
    answer: "a",
    explanation:
      "Every tag carries a `companyId` and a `table`. That is deliberate — it lets the same word mean different things on items and jobs, and it means tag vocabularies never leak across companies.",
    docsUrl: CS
  },
  {
    slug: "admin.company.07",
    unitSlug: "company-settings",
    topic: "company",
    bloom: "remember",
    kind: "single",
    prompt:
      "Which logo slot on the company record is the one printed behind generated documents?",
    options: [
      { id: "a", text: "logoWatermark" },
      { id: "b", text: "logoDarkIcon" },
      { id: "c", text: "logoLight" },
      { id: "d", text: "logoLightIcon" }
    ],
    answer: "a",
    explanation:
      "There are five slots: light/dark for the two UI backgrounds, their compact icon variants, and the watermark, which is the one that prints behind documents.",
    docsUrl: CS
  },
  {
    slug: "admin.company.08",
    unitSlug: "company-settings",
    topic: "company",
    bloom: "apply",
    kind: "single",
    prompt:
      "An owner asks why they cannot see the Billing settings page on your self-hosted install. What do you tell them?",
    options: [
      {
        id: "a",
        text: "Billing needs company ownership *and* a Cloud environment — it is gated on both"
      },
      { id: "b", text: "Billing needs the Accounting view permission" },
      { id: "c", text: "Billing appears once `accountingEnabled` is on" },
      {
        id: "d",
        text: "Billing is only shown to users with the Admin employee type"
      }
    ],
    answer: "a",
    explanation:
      "Ownership alone is not enough. Both gates have to be satisfied, so a non-owner in the Cloud and an owner on a self-hosted edition both come up short.",
    docsUrl: CS
  },
  {
    slug: "admin.company.09",
    unitSlug: "company-settings",
    topic: "company",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Your login belongs to two companies. Which are true? (Choose all that apply.)",
    options: [
      { id: "a", text: "Each company has its own numbering sequences" },
      { id: "b", text: "Each company has its own base currency" },
      {
        id: "c",
        text: "Each company carries its own settings and feature toggles"
      },
      { id: "d", text: "The two companies share one set of tags" },
      {
        id: "e",
        text: "A company you belong to only as a customer or supplier still opens in the ERP"
      }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Company membership is per-user and nothing crosses the boundary. The ERP is an employee app, so supplier- and customer-only memberships are filtered out of the company picker entirely.",
    docsUrl: CS
  },

  // --------------------------------------------------------- sequences (9)
  {
    slug: "admin.company.10",
    unitSlug: "sequences",
    topic: "company",
    bloom: "remember",
    kind: "single",
    prompt: "How does Carbon assemble a document's readable number?",
    options: [
      {
        id: "a",
        text: "Prefix, then Current + Step zero-padded to Size, then suffix"
      },
      { id: "b", text: "Prefix, then the record's database id, then suffix" },
      { id: "c", text: "Prefix, then a random token of length Size" },
      {
        id: "d",
        text: "Prefix, then the creation timestamp truncated to Size digits"
      }
    ],
    answer: "a",
    explanation:
      "The whole number is `{prefix}{next + step, zero-padded to size}{suffix}` — five tunable parts and no hidden ones, which is why the sequence form can preview the result live.",
    docsUrl: SEQ
  },
  {
    slug: "admin.company.11",
    unitSlug: "sequences",
    topic: "company",
    bloom: "apply",
    kind: "single",
    prompt:
      "The job sequence has prefix J, Size 6 and Step 1. You want the next job created to be J005000. What do you set Current to?",
    options: [
      { id: "a", text: "4999" },
      { id: "b", text: "5000" },
      { id: "c", text: "5001" },
      { id: "d", text: "005000" }
    ],
    answer: "a",
    explanation:
      "Current is the last value handed out, and the next document gets Current + Step. Setting it to 5000 would produce J005001.",
    docsUrl: SEQ
  },
  {
    slug: "admin.company.12",
    unitSlug: "sequences",
    topic: "company",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Change notices in your company run from ECO-000001 to ECO-000212, and the sequence prefix now reads CN-. Someone asks you to make the old ones consistent. What is true?",
    options: [
      {
        id: "a",
        text: "A number is written to the record at creation and never recomputed, so only notices created after the change get CN-"
      },
      {
        id: "b",
        text: "Saving the sequence again renumbers every existing change notice"
      },
      {
        id: "c",
        text: "Setting Current back to 0 renumbers history from CN-000001"
      },
      {
        id: "d",
        text: "The old ids are corrupt and should be deleted and recreated"
      }
    ],
    answer: "a",
    explanation:
      "Retuning a sequence only affects documents created after the change; it never renumbers history. Mixed prefixes across a rename are expected, not a defect to repair.",
    docsUrl: SEQ
  },
  {
    slug: "admin.company.13",
    unitSlug: "sequences",
    topic: "company",
    bloom: "apply",
    kind: "single",
    prompt:
      "You put `%{hh}` in the customer sequence prefix and new customers come out as `CUS%{hh}000045`. What went wrong?",
    options: [
      {
        id: "a",
        text: "Customers are numbered by a database trigger that expands only the four date tokens, so the hour token is left literal"
      },
      { id: "b", text: "The token must be uppercase, `%{HH}`" },
      {
        id: "c",
        text: "Tokens are only interpolated when the sequence is saved, and it was saved at midnight"
      },
      { id: "d", text: "Size is too small to fit the expanded token" }
    ],
    answer: "a",
    explanation:
      "Two code paths expand tokens. Customers, suppliers and quotes go through the database function, which understands `%{yyyy}`, `%{yy}`, `%{mm}` and `%{dd}` only — stick to date tokens there.",
    docsUrl: SEQ
  },
  {
    slug: "admin.company.14",
    unitSlug: "sequences",
    topic: "company",
    bloom: "apply",
    kind: "multi",
    prompt:
      "Which of these sequence edits will the form reject? (Choose all that apply.)",
    options: [
      { id: "a", text: "A Step of 0" },
      { id: "b", text: "A Current of -1" },
      { id: "c", text: "A Size of 25" },
      { id: "d", text: "A Size of 4" },
      { id: "e", text: "A prefix containing `%{yyyy}`" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "The validator bounds each numeric field: Current must be at least 0, Step at least 1, and Size between 1 and 20. Date tokens in a prefix are supported, not rejected.",
    docsUrl: SEQ
  },
  {
    slug: "admin.company.15",
    unitSlug: "sequences",
    topic: "company",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Two people create a purchase order at the same instant. What stops them getting the same number?",
    options: [
      {
        id: "a",
        text: "The counter is advanced in the same operation that reads it, so the second read never sees the stale value"
      },
      {
        id: "b",
        text: "The second creation is queued until the first document is saved"
      },
      {
        id: "c",
        text: "A uniqueness check retries with the next free number afterwards"
      },
      {
        id: "d",
        text: "Nothing — duplicates happen and are cleaned up nightly"
      }
    ],
    answer: "a",
    explanation:
      "Read-and-advance is one operation, which is what makes concurrent creates safe. That is also why you cannot 'peek' at the next number without consuming it.",
    docsUrl: SEQ
  },
  {
    slug: "admin.company.16",
    unitSlug: "sequences",
    topic: "company",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Your company's jobs come out as WO000431, but the documented default prefix for jobs is J. Is something broken?",
    options: [
      {
        id: "a",
        text: "No — some sequences were backfilled for existing companies with a different prefix; change it under Settings → Sequences if you want the newer default"
      },
      {
        id: "b",
        text: "Yes — the sequence row is missing and Carbon fell back to a hard-coded prefix"
      },
      {
        id: "c",
        text: "Yes — the company was created before sequences existed and must be re-seeded"
      },
      {
        id: "d",
        text: "No — WO is used whenever a job comes from a sales order"
      }
    ],
    answer: "a",
    explanation:
      "The seed table describes a brand-new company. Sequences added after launch were backfilled for existing companies with their own prefixes, so a mismatch is history, not a fault.",
    docsUrl: SEQ
  },
  {
    slug: "admin.company.17",
    unitSlug: "sequences",
    topic: "company",
    bloom: "apply",
    kind: "single",
    prompt:
      "Finance wants payment numbers partitioned by year and month, like PAY-2026-07-000001. How do you set that up?",
    options: [
      {
        id: "a",
        text: "Put the date tokens in the prefix (`PAY-%{yyyy}-%{mm}-`); they are interpolated when each number is generated"
      },
      {
        id: "b",
        text: "Create one payment sequence per month and switch between them"
      },
      {
        id: "c",
        text: "Set Size to 12 so the date fits inside the padded number"
      },
      {
        id: "d",
        text: "Ask an administrator to change the payment numbering in code"
      }
    ],
    answer: "a",
    explanation:
      "Tokens are expanded at generation time, not when you save the sequence, so one row keeps producing the right year and month as the calendar moves. This is exactly how payments and journal entries ship.",
    docsUrl: SEQ
  },
  {
    slug: "admin.company.18",
    unitSlug: "sequences",
    topic: "company",
    bloom: "remember",
    kind: "single",
    prompt: "How many sequence rows exist for a given document type?",
    options: [
      { id: "a", text: "One per document type per company" },
      { id: "b", text: "One per document type, shared by every company" },
      { id: "c", text: "One per document type per location" },
      {
        id: "d",
        text: "One per document type per user who creates that document"
      }
    ],
    answer: "a",
    explanation:
      "A sequence is keyed by table and company, so two companies in the same group number their documents independently even when they share a chart of accounts.",
    docsUrl: SEQ
  },

  // ------------------------------------------------------------ people (21)
  {
    slug: "admin.people.01",
    unitSlug: "people",
    topic: "people",
    bloom: "remember",
    kind: "single",
    prompt:
      "A person in Carbon is one record split across three tables. What does each hold?",
    options: [
      {
        id: "a",
        text: "`user` is the global login identity, `employee` is their membership in this company, and `employeeJob` is their org placement"
      },
      {
        id: "b",
        text: "`user` is the login, `employee` is their permission set, and `employeeJob` is the production job they are on"
      },
      {
        id: "c",
        text: "`user` is per company, `employee` is global, and `employeeJob` is their shift"
      },
      {
        id: "d",
        text: "All three are per company and hold the same data at different times"
      }
    ],
    answer: "a",
    explanation:
      "The split is what lets one login be an employee of several companies with a different title and manager in each — the identity is global, the membership and placement are not.",
    docsUrl: PPL
  },
  {
    slug: "admin.people.02",
    unitSlug: "people",
    topic: "people",
    bloom: "apply",
    kind: "single",
    prompt:
      'A supervisor asks you to "assign J000412 to Dana in her Job section". What do you tell them?',
    options: [
      {
        id: "a",
        text: "The Job section holds a job *title* and org placement, not production jobs — work orders are assigned elsewhere"
      },
      {
        id: "b",
        text: "Only one production job can be in the Job section at a time"
      },
      {
        id: "c",
        text: "Dana needs the Production create permission before a job can be placed there"
      },
      { id: "d", text: "You have to add the job as a shift first" }
    ],
    answer: "a",
    explanation:
      '"Job" in `employeeJob` means title, location, department, shift and manager. It is completely separate from the `job` table that holds work orders on the floor.',
    docsUrl: PPL
  },
  {
    slug: "admin.people.03",
    unitSlug: "people",
    topic: "people",
    bloom: "analyze",
    kind: "single",
    prompt:
      'You set someone\'s Title to "Purchasing Manager", but they still cannot open a purchase order. Why?',
    options: [
      {
        id: "a",
        text: "A title is org data — access comes from their employee type and permission grants"
      },
      { id: "b", text: "Titles take effect on the person's next sign-in" },
      {
        id: "c",
        text: "Purchasing titles need a manager assigned before they grant access"
      },
      { id: "d", text: "The title has to match an employee type name exactly" }
    ],
    answer: "a",
    explanation:
      "Nothing about a job title grants anything. Title is what a person is called; the employee type and per-person overrides are what they can do.",
    docsUrl: PPL
  },
  {
    slug: "admin.people.04",
    unitSlug: "people",
    topic: "people",
    bloom: "apply",
    kind: "single",
    prompt:
      "One person works for two of your companies — as a Buyer reporting to Sam in one, and as a Planner reporting to Alex in the other. Can Carbon model this?",
    options: [
      {
        id: "a",
        text: "Yes — one login, with a separate employee and job placement record in each company"
      },
      {
        id: "b",
        text: "No — a person has one title and one manager across all companies"
      },
      {
        id: "c",
        text: "Yes, but only by creating a second login with a different email"
      },
      {
        id: "d",
        text: "Yes, but the second company can only see them as a contact"
      }
    ],
    answer: "a",
    explanation:
      "The employee and job records are per company and always scoped to one, so the same identity carries a different title, manager, location and shift in each.",
    docsUrl: PPL
  },
  {
    slug: "admin.people.05",
    unitSlug: "people",
    topic: "people",
    bloom: "remember",
    kind: "single",
    prompt:
      "Where does the Status shown on a row in the Employees directory come from?",
    options: [
      {
        id: "a",
        text: "It is derived from the employee record and any pending invite — it is not a stored field"
      },
      {
        id: "b",
        text: "It is a field an administrator sets on the person's profile"
      },
      {
        id: "c",
        text: "It reflects whether the person is currently clocked in"
      },
      { id: "d", text: "It is copied from the employee type" }
    ],
    answer: "a",
    explanation:
      '"Active", "Invited" and "Inactive" are computed, which is why you change the status by inviting, accepting or deactivating rather than by editing a field.',
    docsUrl: PPL
  },
  {
    slug: "admin.people.06",
    unitSlug: "people",
    topic: "people",
    bloom: "apply",
    kind: "single",
    prompt:
      "Someone has left the company. You deactivate them. What has just happened?",
    options: [
      {
        id: "a",
        text: "Their membership was torn down — removed from the company, job placement deleted, access revoked"
      },
      {
        id: "b",
        text: "Their record was archived but they keep read-only access"
      },
      {
        id: "c",
        text: "Only the Status field changed; access is removed separately"
      },
      { id: "d", text: "The whole person record was deleted from Carbon" }
    ],
    answer: "a",
    explanation:
      "Deactivation is an access action, not an edit to master data. That is why it belongs to the identity flow rather than the People screens.",
    docsUrl: PPL
  },
  {
    slug: "admin.people.07",
    unitSlug: "people",
    topic: "people",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Which are true when you deactivate a person? (Choose all that apply.)",
    options: [
      { id: "a", text: "They are removed from the company" },
      { id: "b", text: "Their job placement is deleted" },
      { id: "c", text: "Their access is revoked" },
      {
        id: "d",
        text: "Their name is scrubbed from the records they are already named on"
      },
      {
        id: "e",
        text: "The login itself is deleted, so any other company loses them too"
      }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Deactivation ends a membership; it does not rewrite history and it does not destroy the person. Records they are named on keep naming them, which is what makes past work auditable.",
    docsUrl: PPL
  },
  {
    slug: "admin.people.08",
    unitSlug: "people",
    topic: "people",
    bloom: "apply",
    kind: "single",
    prompt:
      "You are merging two departments and want to delete the empty one. What should you check first?",
    options: [
      {
        id: "a",
        text: "That nobody is still assigned to it — a department delete is a hard delete and leaves those placements with no department"
      },
      { id: "b", text: "That the department has no parent department" },
      {
        id: "c",
        text: "Nothing — the delete is refused while anyone is assigned"
      },
      { id: "d", text: "That it was created more than a year ago" }
    ],
    answer: "a",
    explanation:
      "Unlike shifts and attributes, departments are removed outright. Reassign people first, or their job placements are left pointing at nothing.",
    docsUrl: PPL
  },
  {
    slug: "admin.people.09",
    unitSlug: "people",
    topic: "people",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Which deletion in People removes the row outright rather than marking it inactive?",
    options: [
      { id: "a", text: "Deleting a department" },
      { id: "b", text: "Deleting a shift" },
      { id: "c", text: "Deleting a person attribute" },
      { id: "d", text: "Deleting an attribute category" }
    ],
    answer: "a",
    explanation:
      "Shifts and attributes soft-delete so historical assignments and already-collected values survive. Departments do not, which is the asymmetry to remember before you tidy up an org chart.",
    docsUrl: PPL
  },
  {
    slug: "admin.people.10",
    unitSlug: "people",
    topic: "people",
    bloom: "apply",
    kind: "single",
    prompt:
      'Saving a new shift fails with "Location is required", but you know a person\'s shift is optional. What is the difference?',
    options: [
      {
        id: "a",
        text: "A shift itself must belong to a location; it is the employee's *assignment* to a shift that is optional"
      },
      {
        id: "b",
        text: "The location becomes optional once the shift has members"
      },
      { id: "c", text: "Only shifts that run on weekends need a location" },
      {
        id: "d",
        text: "The message is about the employee's location, not the shift's"
      }
    ],
    answer: "a",
    explanation:
      "A shift is a named schedule tied to a site, so it cannot exist without one. The optional field is the Shift on a person's Job section.",
    docsUrl: PPL
  },
  {
    slug: "admin.people.11",
    unitSlug: "people",
    topic: "people",
    bloom: "analyze",
    kind: "single",
    prompt:
      "An operation whose process requires an ability is not being scheduled, even though its work center is free all week. What is the likely constraint?",
    options: [
      {
        id: "a",
        text: "No qualified operator is on shift — the scheduler intersects a person's shift hours with the machine's operating hours"
      },
      { id: "b", text: "The work center has no location assigned" },
      { id: "c", text: "The operation is missing a holiday exclusion" },
      {
        id: "d",
        text: "Shifts only apply to people, so they cannot affect an operation"
      }
    ],
    answer: "a",
    explanation:
      "For ability-gated work, who is on shift is the binding constraint. A free machine with nobody qualified scheduled against it simply waits.",
    docsUrl: PPL
  },
  {
    slug: "admin.people.12",
    unitSlug: "people",
    topic: "people",
    bloom: "apply",
    kind: "single",
    prompt:
      "You move the second shift's end time from 22:00 to 23:00. What else does that touch?",
    options: [
      {
        id: "a",
        text: "It queues a replan of the affected schedules, because shift hours are a real scheduling input"
      },
      {
        id: "b",
        text: "Nothing until the next person is assigned to that shift"
      },
      {
        id: "c",
        text: "It rewrites time cards already recorded against that shift"
      },
      { id: "d", text: "It only changes what the Employees directory displays" }
    ],
    answer: "a",
    explanation:
      "Editing a shift or a person's shift assignment changes when work can run, so the schedule has to be recomputed rather than left stale.",
    docsUrl: PPL
  },
  {
    slug: "admin.people.13",
    unitSlug: "people",
    topic: "people",
    bloom: "apply",
    kind: "multi",
    prompt: "Which are true of shifts? (Choose all that apply.)",
    options: [
      { id: "a", text: "A shift must belong to a location" },
      {
        id: "b",
        text: "A shift assigned to a work center defines that station's operating hours"
      },
      {
        id: "c",
        text: "Deleting a shift is a soft delete, so historical assignments stay intact"
      },
      { id: "d", text: "Every employee must be assigned a shift" },
      { id: "e", text: "A shift always runs seven days a week" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Shifts schedule people and machines from the same record, and they carry Monday-to-Sunday day toggles. The employee-side assignment is optional.",
    docsUrl: PPL
  },
  {
    slug: "admin.people.14",
    unitSlug: "people",
    topic: "people",
    bloom: "remember",
    kind: "single",
    prompt: "What does a holiday record hold?",
    options: [
      { id: "a", text: "A name and a date; the year is derived from the date" },
      { id: "b", text: "A name, a year, and a date" },
      { id: "c", text: "A name, a date, and the location it applies to" },
      { id: "d", text: "A name, a date range, and the shifts it suspends" }
    ],
    answer: "a",
    explanation:
      "Both the name and the date are required, and because the year is computed the list can group a company's non-working days one calendar year at a time.",
    docsUrl: PPL
  },
  {
    slug: "admin.people.15",
    unitSlug: "people",
    topic: "people",
    bloom: "remember",
    kind: "single",
    prompt:
      "Which data type is NOT available when you create an attribute on a person?",
    options: [
      { id: "a", text: "File" },
      { id: "b", text: "Yes/No" },
      { id: "c", text: "List" },
      { id: "d", text: "User" }
    ],
    answer: "a",
    explanation:
      "People attributes use a fixed set: Text, Numeric, Yes/No, Date, List and User. Customer and supplier custom fields extend that list with Customer, Supplier and File.",
    docsUrl: PPL
  },
  {
    slug: "admin.people.16",
    unitSlug: "people",
    topic: "people",
    bloom: "remember",
    kind: "single",
    prompt: "What does the Public toggle on an attribute category control?",
    options: [
      {
        id: "a",
        text: "Whether that category's attributes show on a person's public profile or stay admin-only"
      },
      { id: "b", text: "Whether the category is visible outside the company" },
      { id: "c", text: "Whether employees may edit the values themselves" },
      { id: "d", text: "Whether the attributes are exported to CSV" }
    ],
    answer: "a",
    explanation:
      "Public governs visibility of a whole category. Whether an employee may *edit* a value is a separate per-attribute flag — Self Managed.",
    docsUrl: PPL
  },
  {
    slug: "admin.people.17",
    unitSlug: "people",
    topic: "people",
    bloom: "apply",
    kind: "single",
    prompt:
      "You want people to keep their own emergency-contact number up to date without an admin doing it. Which attribute setting?",
    options: [
      {
        id: "a",
        text: "Self Managed — employees can then edit that value on their own profile"
      },
      { id: "b", text: "Public on the attribute's category" },
      { id: "c", text: "A List data type with the numbers as options" },
      { id: "d", text: "Give everyone the People update permission" }
    ],
    answer: "a",
    explanation:
      "Self Managed is exactly this: on, and the employee edits the value; off, and only admins can. Widening a module permission to solve it would grant far more than intended.",
    docsUrl: PPL
  },
  {
    slug: "admin.people.18",
    unitSlug: "people",
    topic: "people",
    bloom: "analyze",
    kind: "single",
    prompt:
      'A "Badge Number" attribute was created as Text and already has values against 40 people. HR now wants it Numeric. What is your move?',
    options: [
      {
        id: "a",
        text: "Create a new Numeric attribute and migrate — the data type is fixed once an attribute has recorded values"
      },
      {
        id: "b",
        text: "Change the data type; Carbon converts existing values"
      },
      { id: "c", text: "Clear all 40 values, then change the data type" },
      { id: "d", text: "Delete the attribute; the values are lost either way" }
    ],
    answer: "a",
    explanation:
      "The type is chosen at creation and locked afterwards. Deleting is a soft delete, so retiring the old attribute keeps the values that were already collected against it.",
    docsUrl: PPL
  },
  {
    slug: "admin.people.19",
    unitSlug: "people",
    topic: "people",
    bloom: "apply",
    kind: "single",
    prompt:
      "There is no Timecards tab on anybody's record and no time card list under Manage. What is missing?",
    options: [
      {
        id: "a",
        text: "Time tracking is off by default — the company's `timeCardEnabled` setting has to be turned on"
      },
      { id: "b", text: "Nobody has clocked in yet, so the tab stays hidden" },
      { id: "c", text: "The employees have no shift assigned" },
      { id: "d", text: "You lack the People view permission" }
    ],
    answer: "a",
    explanation:
      "The tab and the company-wide list both appear only once the setting is on; until then there is nowhere to record office-side clock-in and clock-out at all.",
    docsUrl: PPL
  },
  {
    slug: "admin.people.20",
    unitSlug: "people",
    topic: "people",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A supervisor wants to review and approve time cards before payroll, and asks where the pending queue is. What do you tell them?",
    options: [
      {
        id: "a",
        text: "There is no approval step — a completed entry is final, and a mistake is corrected by editing or deleting the entry"
      },
      {
        id: "b",
        text: "Approvals appear once a manager is set on the employee's Job section"
      },
      {
        id: "c",
        text: "Entries stay Active until approved, then become Complete"
      },
      { id: "d", text: "Approval is done from the MES, not the ERP" }
    ],
    answer: "a",
    explanation:
      'Status is computed from whether a clock-out exists — "Active" while on the clock, "Complete" once off it — and neither state means "pending sign-off".',
    docsUrl: PPL
  },
  {
    slug: "admin.people.21",
    unitSlug: "people",
    topic: "people",
    bloom: "analyze",
    kind: "single",
    prompt:
      "An operator's hours against job operations in the MES do not match their weekly time-card total. Is that a defect?",
    options: [
      {
        id: "a",
        text: "No — production time booked against job operations is a separate mechanism from an employee's clock-in/clock-out day"
      },
      {
        id: "b",
        text: "Yes — MES time should roll up into the time card automatically"
      },
      { id: "c", text: "Yes — the time card's clock-out is missing" },
      {
        id: "d",
        text: "No — but only because time cards round to the nearest hour"
      }
    ],
    answer: "a",
    explanation:
      "Time cards are the office-side attendance record. Shop-floor operators clock against specific operations in the MES, and the two are deliberately not the same number.",
    docsUrl: PPL
  },

  // ------------------------------------------------------- permissions (21)
  {
    slug: "admin.permissions.01",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "remember",
    kind: "single",
    prompt: "What is a single permission in Carbon?",
    options: [
      {
        id: "a",
        text: "A module paired with one of four actions — view, create, update or delete"
      },
      { id: "b", text: "A named role such as Buyer or Planner" },
      { id: "c", text: "A screen a user is allowed to open" },
      { id: "d", text: "A row-level rule written per record" }
    ],
    answer: "a",
    explanation:
      "Grants are written `<module>_<action>` — `sales_view`, `inventory_update`. Roles and employee types are templates of these pairs, not a separate mechanism.",
    docsUrl: PERM
  },
  {
    slug: "admin.permissions.02",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "apply",
    kind: "single",
    prompt:
      "A new hire signs in successfully but the sidebar is nearly empty and no module opens. What is wrong?",
    options: [
      {
        id: "a",
        text: "They hold no `<module>_view` grants — nothing is implied, so a person with no grants sees nothing"
      },
      { id: "b", text: "Their invite has not been accepted yet" },
      { id: "c", text: "They are signed into the wrong company" },
      { id: "d", text: "Their employee type has not been saved" }
    ],
    answer: "a",
    explanation:
      "Access is built from explicit grants only. Signing in proves identity; without a module's view grant its pages are invisible, and the database enforces the same thing beneath the UI.",
    docsUrl: PERM
  },
  {
    slug: "admin.permissions.03",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "apply",
    kind: "single",
    prompt:
      "A buyer can open purchase orders and read them, but every edit control is unavailable. Which grant is missing?",
    options: [
      { id: "a", text: "purchasing_update" },
      { id: "b", text: "purchasing_view" },
      { id: "c", text: "purchasing_create" },
      { id: "d", text: "settings_update" }
    ],
    answer: "a",
    explanation:
      "They clearly hold view, since the records render. Editing existing records is its own action, and holding view never implies it.",
    docsUrl: PERM
  },
  {
    slug: "admin.permissions.04",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You add Inventory view to the Buyer employee type. The six existing buyers still cannot see Inventory. Why?",
    options: [
      {
        id: "a",
        text: "Editing a type changes the template for people assigned *after* the change; existing staff keep the grants they have"
      },
      { id: "b", text: "The change needs a nightly job to propagate" },
      {
        id: "c",
        text: "Inventory view cannot be granted through an employee type"
      },
      {
        id: "d",
        text: "Their per-person overrides were cleared and need re-saving"
      }
    ],
    answer: "a",
    explanation:
      "A type is a starting point, not a live link. To push a change to people already on the type, use the bulk permission editor.",
    docsUrl: PERM
  },
  {
    slug: "admin.permissions.05",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "apply",
    kind: "single",
    prompt:
      "Thirty existing staff need Quality view added. Several of them have carefully tuned per-person exceptions you must not lose. Which bulk mode?",
    options: [
      {
        id: "a",
        text: "Add — it layers the selected grants on top of what each user already has"
      },
      {
        id: "b",
        text: "Update — it merges the matrix into each user's existing set"
      },
      {
        id: "c",
        text: "Either; the two modes differ only in the confirmation they show"
      },
      {
        id: "d",
        text: "Neither — reassign them all to a new employee type instead"
      }
    ],
    answer: "a",
    explanation:
      "Add takes nothing away. Update replaces each selected user's permission set wholesale, which is exactly how carefully tuned exceptions get wiped.",
    docsUrl: PERM
  },
  {
    slug: "admin.permissions.06",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "analyze",
    kind: "single",
    prompt:
      "After a bulk edit in Update mode, four people have lost access they previously had. What happened?",
    options: [
      {
        id: "a",
        text: "Update replaces each selected user's permission set wholesale with the matrix that was submitted"
      },
      {
        id: "b",
        text: "Update revoked grants that came from an employee type but kept overrides"
      },
      { id: "c", text: "Their employee type was deleted by the same action" },
      {
        id: "d",
        text: "Update applied only to users who were signed in at the time"
      }
    ],
    answer: "a",
    explanation:
      '"Make everyone exactly this" is what Update means — anything not ticked in the matrix is gone. Reach for it only when overwriting is the intent.',
    docsUrl: PERM
  },
  {
    slug: "admin.permissions.07",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "apply",
    kind: "single",
    prompt:
      "You grant someone Sales create and they say nothing changed on their screen. What is the first thing to try?",
    options: [
      {
        id: "a",
        text: "Have them sign out and back in — effective permissions are cached and a change applies on their next request"
      },
      {
        id: "b",
        text: "Re-save the grant, since the first save is not persisted until confirmed"
      },
      {
        id: "c",
        text: "Add Sales view as well; create does not work without it being re-granted"
      },
      { id: "d", text: "Move them to a different employee type" }
    ],
    answer: "a",
    explanation:
      "Carbon caches each user's effective permissions for speed and clears the cache on change, so a stale screen is almost always an old session rather than a missing grant.",
    docsUrl: PERM
  },
  {
    slug: "admin.permissions.08",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Which are true of Carbon's permission grants? (Choose all that apply.)",
    options: [
      {
        id: "a",
        text: "Each grant stores the list of companies it applies to"
      },
      { id: "b", text: 'The special value "0" means all companies' },
      {
        id: "c",
        text: "The database enforces the same grants through row-level security"
      },
      { id: "d", text: "Holding update on a module implies view on it" },
      { id: "e", text: "A user with no grants cannot sign in at all" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Nothing is implied and nothing is global. The second enforcement layer in the database is what makes the same model safe for API keys, which carry scopes in the identical shape.",
    docsUrl: PERM
  },
  {
    slug: "admin.permissions.09",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "apply",
    kind: "single",
    prompt:
      "A controller should have full Accounting access in the parent company but view-only in the subsidiary. Is that possible?",
    options: [
      {
        id: "a",
        text: "Yes — grants are scoped per company, and you edit them from within the company you are signed into"
      },
      {
        id: "b",
        text: "No — a person carries one permission set across every company they belong to"
      },
      { id: "c", text: "Yes, but only by giving them two separate logins" },
      {
        id: "d",
        text: "Yes, but the narrower of the two sets applies everywhere"
      }
    ],
    answer: "a",
    explanation:
      "Each grant records which companies it covers, so one person can hold genuinely different permissions in each. Switch companies to edit the other set.",
    docsUrl: PERM
  },
  {
    slug: "admin.permissions.10",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "remember",
    kind: "single",
    prompt: 'In a stored grant, what does the special company value "0" mean?',
    options: [
      {
        id: "a",
        text: "All companies — this is how a true cross-company administrator is represented"
      },
      { id: "b", text: "No companies, i.e. the grant is disabled" },
      { id: "c", text: "The company the user signed into most recently" },
      { id: "d", text: "The parent company only" }
    ],
    answer: "a",
    explanation:
      "It is a wildcard rather than an id, so matching a literal company id alone would miss a legitimate cross-company grant.",
    docsUrl: PERM
  },
  {
    slug: "admin.permissions.11",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "remember",
    kind: "single",
    prompt: "Which two employee types are seeded and cannot be deleted?",
    options: [
      { id: "a", text: "Admin and Console Operator" },
      { id: "b", text: "Admin and Employee" },
      { id: "c", text: "Owner and Guest" },
      { id: "d", text: "Admin and Buyer" }
    ],
    answer: "a",
    explanation:
      "Both carry a stable system value, so you may rename their display labels without breaking Carbon's internal lookups. Console Operator is managed for you when you add a PIN operator.",
    docsUrl: PERM
  },
  {
    slug: "admin.permissions.12",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You switch someone from Buyer to Planner on their own account screen. What happens to the exceptions you hand-tuned for them?",
    options: [
      {
        id: "a",
        text: "Carbon asks first — overwrite the current set with the new type's template, or keep what they have"
      },
      { id: "b", text: "They are always replaced by the new type's template" },
      { id: "c", text: "They are always kept; the type is only a label" },
      {
        id: "d",
        text: "They are merged, with the broader grant winning per cell"
      }
    ],
    answer: "a",
    explanation:
      "Because a type is a template rather than a live link, changing it is ambiguous — so Carbon makes you choose instead of silently rewriting somebody's access.",
    docsUrl: PERM
  },
  {
    slug: "admin.permissions.13",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "apply",
    kind: "single",
    prompt:
      'A bulk permission edit comes back with "Group members are required". What did you miss?',
    options: [
      {
        id: "a",
        text: "No users were selected — bulk actions need at least one"
      },
      { id: "b", text: "The company has no company groups defined" },
      { id: "c", text: "The matrix was submitted with no cells ticked" },
      { id: "d", text: "The selected users belong to different employee types" }
    ],
    answer: "a",
    explanation:
      "The same guard covers every bulk action — permission edit, group edit, deactivate, and resend or revoke invite. Select the users first, then set the matrix.",
    docsUrl: PERM
  },
  {
    slug: "admin.permissions.14",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "apply",
    kind: "single",
    prompt:
      'A manager asks you to "set up a password" for a new starter. What do you actually do?',
    options: [
      {
        id: "a",
        text: "Add them under Accounts with name, email, employee type and location — Carbon records an invite and emails them a link to set up their own sign-in"
      },
      {
        id: "b",
        text: "Create the account and send them a temporary password over chat"
      },
      { id: "c", text: "Create a PIN operator and convert it later" },
      {
        id: "d",
        text: "Ask them to sign up themselves and approve the request"
      }
    ],
    answer: "a",
    explanation:
      "You never create passwords in Carbon. The invite is a real record carrying the permission set they will start with, so their access is ready the moment they accept.",
    docsUrl: PERM
  },
  {
    slug: "admin.permissions.15",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Which are true of an invite that has been sent but not yet accepted? (Choose all that apply.)",
    options: [
      { id: "a", text: "It is a company-scoped record keyed by email" },
      {
        id: "b",
        text: "It carries the permission set the person will start with"
      },
      { id: "c", text: "It can be resent or revoked from the accounts list" },
      {
        id: "d",
        text: "The person can sign in with a temporary password until they accept"
      },
      { id: "e", text: "The person's status already shows Active" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Their status is Invited and they cannot sign in until they follow the link. Because the invite already holds the grants, acceptance is the only step left.",
    docsUrl: PERM
  },
  {
    slug: "admin.permissions.16",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You deactivate someone who also works for a sister company that shares your Carbon instance. What is the effect on the sister company?",
    options: [
      {
        id: "a",
        text: "None — deactivation removes them from this company and strips these grants; the person is not deleted and may still belong to other companies"
      },
      {
        id: "b",
        text: "They are deactivated everywhere, since the login is global"
      },
      { id: "c", text: "Their sister-company grants are reduced to view-only" },
      {
        id: "d",
        text: "The sister company is prompted to confirm before it takes effect"
      }
    ],
    answer: "a",
    explanation:
      "Membership is per company, so ending one leaves the others untouched. That is the same property that lets one login be an employee of several companies at once.",
    docsUrl: PERM
  },
  {
    slug: "admin.permissions.17",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "apply",
    kind: "single",
    prompt:
      "A machinist with no work email needs to run jobs on a shared floor tablet. How do you set them up?",
    options: [
      {
        id: "a",
        text: "Add a console operator with a name, a location and a 4-digit PIN under Settings → Users → Operators"
      },
      {
        id: "b",
        text: "Invite them using a shared departmental email address"
      },
      { id: "c", text: "Add them as a normal user and leave the email blank" },
      {
        id: "d",
        text: "Give the tablet its own Admin account that everyone shares"
      }
    ],
    answer: "a",
    explanation:
      "Carbon creates a lightweight account with no email login and assigns the Console Operator type automatically. Note the Operators screen only appears when console mode is enabled for the company.",
    docsUrl: PERM
  },
  {
    slug: "admin.permissions.18",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "apply",
    kind: "single",
    prompt:
      "A PIN operator is promoted to a scheduling role and now needs real ERP access. What is the right move?",
    options: [
      {
        id: "a",
        text: "Convert the existing account — give it an email and a full employee type, and their floor history stays on the one identity"
      },
      {
        id: "b",
        text: "Create a new user and leave the operator account for their old work"
      },
      { id: "c", text: "Raise the PIN account to the Admin employee type" },
      { id: "d", text: "Delete the operator, then invite them by email" }
    ],
    answer: "a",
    explanation:
      "Converting keeps one identity, so past floor activity remains attached. Creating a second account splits their history in two for good.",
    docsUrl: PERM
  },
  {
    slug: "admin.permissions.19",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "analyze",
    kind: "single",
    prompt:
      "An admin creates an API key for a partner and grants it no scopes, assuming it will inherit their own access. What can the key do?",
    options: [
      {
        id: "a",
        text: "It can authenticate, but read and write nothing — a key acts with exactly the scopes stored on it"
      },
      { id: "b", text: "Everything its creator can do, until scopes are set" },
      {
        id: "c",
        text: "Nothing at all; requests are rejected as unauthenticated"
      },
      { id: "d", text: "Read-only access to every module by default" }
    ],
    answer: "a",
    explanation:
      'The key is its own principal. Authentication succeeds and every scoped call is then refused with "API key lacks required permissions" until the exact `module_action` is granted.',
    docsUrl: KEYS
  },
  {
    slug: "admin.permissions.20",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "remember",
    kind: "single",
    prompt: "How does a script present an API key to Carbon?",
    options: [
      {
        id: "a",
        text: "In the `carbon-key` header on every request — there is no login step and no token to refresh"
      },
      {
        id: "b",
        text: "By exchanging it for a session token, then sending that"
      },
      { id: "c", text: "As a query parameter on the request URL" },
      { id: "d", text: "Only through the MCP endpoint" }
    ],
    answer: "a",
    explanation:
      "The header is the whole handshake, and it works for the REST API and the edge functions alike; the MCP endpoint accepts the same key as a Bearer token, resolved the same way.",
    docsUrl: KEYS
  },
  {
    slug: "admin.permissions.21",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "analyze",
    kind: "multi",
    prompt: "Which are true of an API key? (Choose all that apply.)",
    options: [
      {
        id: "a",
        text: "Carbon shows the full key once, then keeps only a hash and a five-character preview"
      },
      {
        id: "b",
        text: "It is bound to the single company it was created under"
      },
      {
        id: "c",
        text: "Tightening its scopes takes effect immediately, with no session to wait out"
      },
      { id: "d", text: "It inherits the permissions of whoever created it" },
      { id: "e", text: "Its rate limit can be raised on the key's form" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Every key allows 60 requests per minute and that limit is platform-controlled — the form has no field and the service strips any submitted value. Lose the key and your only option is to delete it and create another.",
    docsUrl: KEYS
  },

  // ----------------------------------------------------- custom fields (15)
  {
    slug: "admin.customization.01",
    unitSlug: "custom-fields",
    topic: "customization",
    bloom: "remember",
    kind: "single",
    prompt: "Where do the values of a custom field get stored?",
    options: [
      {
        id: "a",
        text: "They serialize into a single `customFields` JSONB column on the record"
      },
      {
        id: "b",
        text: "Each custom field gets its own column added to the table"
      },
      { id: "c", text: "In a separate values table joined back to the record" },
      { id: "d", text: "In the company's document storage bucket" }
    ],
    answer: "a",
    explanation:
      "One extensibility column per core table is what lets a company add fields with no schema change — and it is why the API returns the whole object at once.",
    docsUrl: CF
  },
  {
    slug: "admin.customization.02",
    unitSlug: "custom-fields",
    topic: "customization",
    bloom: "apply",
    kind: "single",
    prompt:
      'A "Lot Depth" custom field on parts was created as Text and is now being used for arithmetic. How do you make it Numeric?',
    options: [
      {
        id: "a",
        text: "Create a new Numeric field and migrate the values — the data type is locked once the field is saved"
      },
      {
        id: "b",
        text: "Edit the field and change the Data Type; Carbon converts stored values"
      },
      { id: "c", text: "Change the type after clearing every existing value" },
      { id: "d", text: "Add a second List field offering numeric options" }
    ],
    answer: "a",
    explanation:
      "Existing values are stored as-is with no in-place conversion, so Carbon disables the Data Type select on edit. Delete-and-recreate is the supported path.",
    docsUrl: CF
  },
  {
    slug: "admin.customization.03",
    unitSlug: "custom-fields",
    topic: "customization",
    bloom: "apply",
    kind: "single",
    prompt:
      'Editing a custom field, a colleague reports the Data Type dropdown is greyed out and shows "Data type cannot be changed". Is this a bug?',
    options: [
      {
        id: "a",
        text: "No — the type is deliberately locked after the field is saved"
      },
      {
        id: "b",
        text: "Yes — it should unlock when the field has no values yet"
      },
      { id: "c", text: "No — it unlocks once you also clear the List Options" },
      { id: "d", text: "Yes — it means the field definition failed to load" }
    ],
    answer: "a",
    explanation:
      "The form sets that select read-only on edit by design. Treating it as a bug leads people to look for a workaround that does not exist.",
    docsUrl: CF
  },
  {
    slug: "admin.customization.04",
    unitSlug: "custom-fields",
    topic: "customization",
    bloom: "apply",
    kind: "single",
    prompt:
      "A List custom field is refused on save even though the name and table are set. What is the most likely cause?",
    options: [
      {
        id: "a",
        text: "It has no List Options, or one of them is empty — a List needs at least one non-empty choice"
      },
      { id: "b", text: "List fields also require the Required flag" },
      { id: "c", text: "List fields must be tagged before they can be saved" },
      {
        id: "d",
        text: "The table already has a List field, and only one is allowed"
      }
    ],
    answer: "a",
    explanation:
      "List Options are required only for the List type, and the validator refuses an empty set or a blank option — otherwise the dropdown would render with nothing to pick.",
    docsUrl: CF
  },
  {
    slug: "admin.customization.05",
    unitSlug: "custom-fields",
    topic: "customization",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You flag a Boolean custom field as Required to force people to answer it, but forms still save with it untouched. Why?",
    options: [
      {
        id: "a",
        text: "Boolean fields are never treated as required, so the flag can never block a save"
      },
      {
        id: "b",
        text: "A Boolean defaults to false, which counts as filled only after an edit"
      },
      { id: "c", text: "Required is only enforced on create, not on update" },
      {
        id: "d",
        text: "The requirement applies only to records carrying one of the field's tags"
      }
    ],
    answer: "a",
    explanation:
      'A toggle always has a value, so "must be filled" is meaningless for it. If an explicit answer is genuinely mandatory, model it as a two-option List instead.',
    docsUrl: CF
  },
  {
    slug: "admin.customization.06",
    unitSlug: "custom-fields",
    topic: "customization",
    bloom: "apply",
    kind: "single",
    prompt:
      'A "PPAP Level" field should appear only on the customers your team has tagged Automotive, not on all 900. How?',
    options: [
      {
        id: "a",
        text: "Put a matching tag on the custom field — a tagged field only appears on records sharing one of its tags"
      },
      { id: "b", text: "Set the field to Required so it is skipped elsewhere" },
      {
        id: "c",
        text: "Create the field on a different table and link the two"
      },
      {
        id: "d",
        text: "It is not possible; a field always shows on every record of its table"
      }
    ],
    answer: "a",
    explanation:
      "Tags scope where the field renders. Leave the tag list empty and the field shows on every record of the table, which is the default.",
    docsUrl: CF
  },
  {
    slug: "admin.customization.07",
    unitSlug: "custom-fields",
    topic: "customization",
    bloom: "analyze",
    kind: "single",
    prompt:
      'You imported 400 suppliers from a CSV that included a column for your "Approval Tier" custom field. Every record\'s custom field is blank. Why?',
    options: [
      {
        id: "a",
        text: "Custom fields do not participate in CSV import — the importer maps built-in fields and documented side-tables only"
      },
      {
        id: "b",
        text: "The custom column was mapped to N/A during the wizard"
      },
      {
        id: "c",
        text: "Custom fields import only when the field is marked Required"
      },
      {
        id: "d",
        text: "The import wrote them, but they are hidden until the field is re-saved"
      }
    ],
    answer: "a",
    explanation:
      "There is no path from a CSV column into the `customFields` blob at all, so no mapping choice would have helped. Populate them on the record's form or through the API.",
    docsUrl: CF
  },
  {
    slug: "admin.customization.08",
    unitSlug: "custom-fields",
    topic: "customization",
    bloom: "apply",
    kind: "single",
    prompt:
      'An auditor wants a spreadsheet of every part with its "RoHS Status" custom field. Downloading the parts table gives them everything but that column. What now?',
    options: [
      {
        id: "a",
        text: "Read the records through the API — the table download does not emit custom-field columns"
      },
      {
        id: "b",
        text: "Add the column to the saved view first, then export again"
      },
      { id: "c", text: "Mark the field export-only so it is always written" },
      { id: "d", text: "Re-create the field as Text; only Text fields export" }
    ],
    answer: "a",
    explanation:
      "Export mirrors the grid's built-in columns, and custom fields are not among them. The `customFields` column is exposed on the API, which is the supported route for a bulk read.",
    docsUrl: CF
  },
  {
    slug: "admin.customization.09",
    unitSlug: "custom-fields",
    topic: "customization",
    bloom: "analyze",
    kind: "multi",
    prompt: "Which are true of custom fields? (Choose all that apply.)",
    options: [
      {
        id: "a",
        text: "Their values serialize into one JSONB column on the record"
      },
      { id: "b", text: "They do not participate in CSV import or export" },
      {
        id: "c",
        text: "The `customFields` column is readable and filterable through the API"
      },
      { id: "d", text: "Each field gets its own database column" },
      { id: "e", text: "They can be added to any table in Carbon" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Eligible entities come from a code-managed catalog, not from every table, which is why an entity missing from the Custom Fields page cannot be extended from the UI.",
    docsUrl: CF
  },
  {
    slug: "admin.customization.10",
    unitSlug: "custom-fields",
    topic: "customization",
    bloom: "apply",
    kind: "single",
    prompt:
      "The entity you want to extend has no row on the Custom Fields page. What is the correct conclusion?",
    options: [
      {
        id: "a",
        text: "It is not in the code-managed catalog of eligible entities, so it cannot take custom fields yet — there is no way to add it from the UI"
      },
      { id: "b", text: "You need the Settings create permission to see it" },
      { id: "c", text: "The entity has no records yet, so its row is hidden" },
      {
        id: "d",
        text: "It appears only after you define the first field for it"
      }
    ],
    answer: "a",
    explanation:
      "The settings page lists one row per eligible entity with its module and field count. Absence is a hard limit, not a permission or an empty-state.",
    docsUrl: CF
  },
  {
    slug: "admin.customization.11",
    unitSlug: "custom-fields",
    topic: "customization",
    bloom: "remember",
    kind: "multi",
    prompt:
      "Which custom-field data types store a reference to another Carbon record? (Choose all that apply.)",
    options: [
      { id: "a", text: "User" },
      { id: "b", text: "Customer" },
      { id: "c", text: "Supplier" },
      { id: "d", text: "List" },
      { id: "e", text: "Text" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "These three render pickers and hold a pointer to a real record, so a custom field can point at an existing entity instead of repeating its name as free text.",
    docsUrl: CF
  },
  {
    slug: "admin.customization.12",
    unitSlug: "custom-fields",
    topic: "customization",
    bloom: "analyze",
    kind: "single",
    prompt:
      'You already have a "Review Date" field on parts. Can you create a "Review Date" field on suppliers too?',
    options: [
      {
        id: "a",
        text: "Yes — a field name has to be unique per table, per company"
      },
      { id: "b", text: "No — names must be unique across the whole company" },
      { id: "c", text: "Yes, but only if both use the same data type" },
      { id: "d", text: "No — reuse the parts field and tag it for suppliers" }
    ],
    answer: "a",
    explanation:
      "Definitions are scoped to a table, so the same label can describe genuinely different things on two entities without colliding.",
    docsUrl: CF
  },
  {
    slug: "admin.customization.13",
    unitSlug: "custom-fields",
    topic: "customization",
    bloom: "analyze",
    kind: "single",
    prompt:
      'An integration reads a part through the API and gets a `customFields` object whose keys are opaque strings, not "RoHS Status". How should it resolve them?',
    options: [
      {
        id: "a",
        text: "The keys are the field ids — read the field definitions from the settings catalog and map ids back to labels"
      },
      {
        id: "b",
        text: "Request the record again with a label expansion parameter"
      },
      { id: "c", text: "Rename the fields so their ids match their labels" },
      { id: "d", text: "The labels are only available in the CSV export" }
    ],
    answer: "a",
    explanation:
      "Keying by id is what lets a field be renamed without breaking stored data, so any consumer that wants labels has to pair the read with the definitions.",
    docsUrl: CF
  },
  {
    slug: "admin.customization.14",
    unitSlug: "custom-fields",
    topic: "customization",
    bloom: "remember",
    kind: "single",
    prompt: "Which of these is NOT one of the custom-field data types?",
    options: [
      { id: "a", text: "Formula" },
      { id: "b", text: "Numeric" },
      { id: "c", text: "File" },
      { id: "d", text: "Date" }
    ],
    answer: "a",
    explanation:
      "The nine types are Boolean, Date, List, Numeric, Text, User, Customer, Supplier and File. A custom field stores a value; it does not compute one.",
    docsUrl: CF
  },
  {
    slug: "admin.customization.15",
    unitSlug: "custom-fields",
    topic: "customization",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A developer cannot find the Required rule for a custom field anywhere in the entity's own schema. Where does it live?",
    options: [
      {
        id: "a",
        text: "With the field definition — the form registers an additional validator at runtime, separate from the entity's schema"
      },
      { id: "b", text: "In a database constraint on the JSONB column" },
      {
        id: "c",
        text: "In the entity's zod schema, added when the field is created"
      },
      { id: "d", text: "Nowhere — Required is only a visual hint" }
    ],
    answer: "a",
    explanation:
      "Requiredness belongs to the per-company field definition, not the shared base form, which is how one company can make a field mandatory without affecting anyone else.",
    docsUrl: CF
  },

  // ------------------------------------------- import, export, documents (15)
  {
    slug: "admin.data.01",
    unitSlug: "import-and-documents",
    topic: "data",
    bloom: "apply",
    kind: "single",
    prompt:
      "You export the parts table expecting all 4,000 parts and 30 columns, and get a few dozen rows and 8 columns. What happened?",
    options: [
      {
        id: "a",
        text: "The export mirrors what is on screen — the current page or result set, and only the columns visible in your saved view"
      },
      {
        id: "b",
        text: "The export is capped at the first page and cannot be widened"
      },
      {
        id: "c",
        text: "You lack the Parts view permission on the remaining columns"
      },
      {
        id: "d",
        text: "The file was truncated because it exceeded the size limit"
      }
    ],
    answer: "a",
    explanation:
      "Export is a browser-side download of the rows already loaded, so filter, search and arrange your columns first — what you see is exactly what you get.",
    docsUrl: IMP
  },
  {
    slug: "admin.data.02",
    unitSlug: "import-and-documents",
    topic: "data",
    bloom: "analyze",
    kind: "multi",
    prompt: "Which are true of a table's CSV export? (Choose all that apply.)",
    options: [
      {
        id: "a",
        text: "It writes only the rows in the current page or result set"
      },
      {
        id: "b",
        text: "It writes only the columns visible in your saved view, in your order"
      },
      {
        id: "c",
        text: "For id-bearing columns it substitutes the readable name for the raw id"
      },
      { id: "d", text: "It is a full server-side dump of the table" },
      { id: "e", text: "It includes the record's custom fields" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Substituting names for ids is what makes the file legible to a human. The synthetic select, expand and actions columns never export, and custom fields never do either.",
    docsUrl: IMP
  },
  {
    slug: "admin.data.03",
    unitSlug: "import-and-documents",
    topic: "data",
    bloom: "remember",
    kind: "single",
    prompt: "What is a table export saved as?",
    options: [
      {
        id: "a",
        text: "`data.csv`, built in the browser with no server round-trip"
      },
      { id: "b", text: "A file named after the table, prepared on the server" },
      { id: "c", text: "A ZIP containing one CSV per visible column group" },
      {
        id: "d",
        text: "A file whose name you choose in a dialog before download"
      }
    ],
    answer: "a",
    explanation:
      "Every export lands under the same name, so rename each file as you go if you are exporting several tables in a row.",
    docsUrl: IMP
  },
  {
    slug: "admin.data.04",
    unitSlug: "import-and-documents",
    topic: "data",
    bloom: "remember",
    kind: "single",
    prompt: "Which of these can be bulk-imported from its own list screen?",
    options: [
      { id: "a", text: "Suppliers" },
      { id: "b", text: "Fixed assets" },
      { id: "c", text: "Sales orders" },
      { id: "d", text: "Journal entries" }
    ],
    answer: "a",
    explanation:
      "Bulk Import is deliberately scoped: customers, suppliers, the item types, work centers and processes, plus the method formats. A fixed-asset CSV is rejected outright.",
    docsUrl: IMP
  },
  {
    slug: "admin.data.05",
    unitSlug: "import-and-documents",
    topic: "data",
    bloom: "apply",
    kind: "single",
    prompt:
      "You are loading 120 new parts together with their full bills of materials and routings from one file. Which import handles that?",
    options: [
      {
        id: "a",
        text: "The combined part-with-method format — a row-typed CSV where each row is tagged PART, BOM, BOP, STEP, TOOL or PARAM"
      },
      {
        id: "b",
        text: "The Parts import, which creates methods from extra columns"
      },
      {
        id: "c",
        text: "Three separate imports, since BOM lines must be added by hand"
      },
      { id: "d", text: "The Processes import, which carries the routing" }
    ],
    answer: "a",
    explanation:
      "The importer understands three method formats — a focused BOM file, a focused Operations file, and the combined one that creates parts with their whole structure. They are driven from the method-building UI rather than a list screen.",
    docsUrl: IMP
  },
  {
    slug: "admin.data.06",
    unitSlug: "import-and-documents",
    topic: "data",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You re-import a corrected supplier file and end up with duplicate suppliers instead of updates. What most likely broke the match?",
    options: [
      {
        id: "a",
        text: "Neither the CSV's Unique ID nor the Name matched an existing record, so the rows were inserted"
      },
      {
        id: "b",
        text: "Re-importing always inserts; updates require the wizard's update mode"
      },
      {
        id: "c",
        text: "The second import ran before the first had finished writing"
      },
      { id: "d", text: "Duplicate detection only runs within a single file" }
    ],
    answer: "a",
    explanation:
      "The importer matches by the CSV's Unique ID through a stored mapping, then falls back to Name. Records created in the app have no mapping, so a renamed record is a new record.",
    docsUrl: IMP
  },
  {
    slug: "admin.data.07",
    unitSlug: "import-and-documents",
    topic: "data",
    bloom: "apply",
    kind: "single",
    prompt:
      "A colleague's customer import is refused on submit with nothing written at all. What should you check?",
    options: [
      {
        id: "a",
        text: "Whether they hold the Sales update permission — the importer bypasses row-level security, so the module permission is checked once, up front"
      },
      { id: "b", text: "Whether the CSV has more rows than the import limit" },
      { id: "c", text: "Whether any single row is missing a required field" },
      { id: "d", text: "Whether the customer sequence has been exhausted" }
    ],
    answer: "a",
    explanation:
      "Because the import writes with a privileged connection, the gate is a single up-front check — sales for customers, purchasing for suppliers, parts for items and methods, production for work centers and processes.",
    docsUrl: IMP
  },
  {
    slug: "admin.data.08",
    unitSlug: "import-and-documents",
    topic: "data",
    bloom: "analyze",
    kind: "single",
    prompt:
      'Every imported part came in with Replenishment System "Buy and Make", though your CSV said "P" for purchased. Why did nothing fail?',
    options: [
      {
        id: "a",
        text: "An unmapped enum value falls back to that field's configured default rather than erroring"
      },
      {
        id: "b",
        text: '"Buy and Make" is the only value the importer can write'
      },
      {
        id: "c",
        text: "The validate step rewrote the values to the safest option"
      },
      {
        id: "d",
        text: "The column was mapped to N/A, which sets the widest option"
      }
    ],
    answer: "a",
    explanation:
      "This is the quiet one: a wrong value is silent where a missing required field is loud. Map your raw enum values deliberately in the Map columns step — the wizard fuzzy-matches obvious ones, but it does not guess for you.",
    docsUrl: IMP
  },
  {
    slug: "admin.data.09",
    unitSlug: "import-and-documents",
    topic: "data",
    bloom: "apply",
    kind: "single",
    prompt:
      "Row 214 of a 900-row import has a blank Name. What happens to the other 899 rows?",
    options: [
      {
        id: "a",
        text: "They still import — a bad row is collected and reported with its row number, reason and original cells"
      },
      { id: "b", text: "The whole file is rolled back and nothing is written" },
      {
        id: "c",
        text: "Everything up to row 213 is written and the rest is abandoned"
      },
      { id: "d", text: "Row 214 is written with a generated placeholder name" }
    ],
    answer: "a",
    explanation:
      "Import is row-level tolerant, and the results carry each failed row's original cells so you can fix and re-import just those. Only a hard failure, like the file being unreadable, fails the whole run.",
    docsUrl: IMP
  },
  {
    slug: "admin.data.10",
    unitSlug: "import-and-documents",
    topic: "data",
    bloom: "apply",
    kind: "single",
    prompt:
      "You download the import template and it has one data row reading REQUIRED, optional, optional, REQUIRED. What do you do with it?",
    options: [
      {
        id: "a",
        text: "Overwrite that hint row with your own data — it marks which columns are required and lists valid enum values"
      },
      {
        id: "b",
        text: "Leave it in place; the importer uses it to map your columns"
      },
      {
        id: "c",
        text: "Delete it and the header row, then upload only your data"
      },
      {
        id: "d",
        text: "Fill it in as your first record and add the rest below"
      }
    ],
    answer: "a",
    explanation:
      "The header is every field label and the single row beneath it is guidance, not data. Keep the header, replace the hint row, and re-upload.",
    docsUrl: IMP
  },
  {
    slug: "admin.data.11",
    unitSlug: "import-and-documents",
    topic: "data",
    bloom: "apply",
    kind: "single",
    prompt:
      "A colleague with the Documents view permission opens a link you sent to a file in the explorer and gets nothing. What is missing?",
    options: [
      {
        id: "a",
        text: "They are not in one of the document's read groups — the same rule guards the stored file, so the link resolves to nothing"
      },
      { id: "b", text: "The file is in Trash and needs restoring" },
      { id: "c", text: "Links only work for the person who uploaded the file" },
      {
        id: "d",
        text: "They need the Documents update permission to open an attachment"
      }
    ],
    answer: "a",
    explanation:
      "Visibility takes both: membership in a read group and the view permission. Because the private bucket enforces the same rule, sharing a URL cannot route around it.",
    docsUrl: DOC
  },
  {
    slug: "admin.data.12",
    unitSlug: "import-and-documents",
    topic: "data",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Legal asks you to make sure a file is genuinely gone. Someone already moved it to Trash. Is that enough?",
    options: [
      {
        id: "a",
        text: "No — Trash only flips the file's active flag; use Permanently Delete, which cannot be undone"
      },
      {
        id: "b",
        text: "Yes — Trash removes the stored file and keeps only the row"
      },
      {
        id: "c",
        text: "Yes — items in Trash are purged automatically after a retention window"
      },
      {
        id: "d",
        text: "No — you also have to clear the file from every read group first"
      }
    ],
    answer: "a",
    explanation:
      "Move to Trash is reversible by design: the row and the stored file both stay put and Restore flips it back. Only Permanently Delete actually removes the file.",
    docsUrl: DOC
  },
  {
    slug: "admin.data.13",
    unitSlug: "import-and-documents",
    topic: "data",
    bloom: "apply",
    kind: "single",
    prompt:
      "Someone searches the explorer for a part number they know appears inside a PDF, and gets no results. Why?",
    options: [
      {
        id: "a",
        text: "The search is a case-insensitive substring match over a file's name and description only, not the contents"
      },
      {
        id: "b",
        text: "PDFs are excluded from search until they have been extracted"
      },
      { id: "c", text: "The search only covers files you uploaded yourself" },
      { id: "d", text: "Search results are limited to the Recent view" }
    ],
    answer: "a",
    explanation:
      "It is a filename and description search. Rename or describe the file, or narrow with the column filters for source document, label, type, extension and creator.",
    docsUrl: DOC
  },
  {
    slug: "admin.data.14",
    unitSlug: "import-and-documents",
    topic: "data",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Which are true of Carbon's AI document extraction? (Choose all that apply.)",
    options: [
      {
        id: "a",
        text: "Only Request for Quote and Purchase Invoice PDFs are supported"
      },
      {
        id: "b",
        text: "It extracts text and does not OCR a scanned, image-only PDF"
      },
      {
        id: "c",
        text: "Fields scoring below the confidence threshold are dropped to null"
      },
      {
        id: "d",
        text: "A completed extraction creates the invoice or RFQ on its own"
      },
      {
        id: "e",
        text: "The model invents a supplier id when it cannot match one of yours"
      }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "An extraction row is a staging area that pre-fills the normal form; the real record is still created through the usual permission-gated save. The model is handed your actual suppliers, customers and payment terms and returns a real id or nothing.",
    docsUrl: DOC
  },
  {
    slug: "admin.data.15",
    unitSlug: "import-and-documents",
    topic: "data",
    bloom: "remember",
    kind: "single",
    prompt:
      'You pin three files and label one "Q3-audit". What does a colleague see?',
    options: [
      { id: "a", text: "Neither — pins and labels are per-user" },
      { id: "b", text: "Both, since documents are a shared company library" },
      { id: "c", text: "The label but not the pins" },
      { id: "d", text: "The pins but not the label" }
    ],
    answer: "a",
    explanation:
      "The library is shared but these two organizers are personal, so your pinned view and your labels never clutter anyone else's explorer.",
    docsUrl: DOC
  }
];
