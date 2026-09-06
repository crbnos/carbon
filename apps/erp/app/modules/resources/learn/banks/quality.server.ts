/**
 * Quality — question bank. SERVER ONLY.
 *
 * Leans on the rules the quality docs flag as counterintuitive, because those are
 * the ones people get wrong on the floor: containment status is derived, a sampling
 * plan is snapshotted at receipt, an overdue gauge warns rather than blocks, going
 * Active is exclusive by name, and severity and likelihood are never multiplied.
 */

import type { LearnQuestion } from "../types";

const D = "https://docs.carbon.ms";
const QUAL = `${D}/docs/reference/quality`;
const ISS = `${D}/docs/reference/issues`;
const INSP = `${D}/docs/reference/inspections`;
const CAL = `${D}/docs/reference/calibration`;
const QDOC = `${D}/docs/reference/quality-documents`;
const RISK = `${D}/docs/reference/risks`;
const G_SHIP = `${D}/guides/ship`;

export const questions: LearnQuestion[] = [
  // -------------------------------------------------------------- issues (24)
  {
    slug: "quality.issues.01",
    unitSlug: "issues",
    topic: "issues",
    bloom: "remember",
    kind: "single",
    prompt: "Which three statuses does a Carbon issue move through?",
    options: [
      { id: "a", text: "Registered, In Progress, Closed" },
      { id: "b", text: "Draft, Active, Archived" },
      { id: "c", text: "Open, Mitigating, Accepted" },
      { id: "d", text: "Pending, In Progress, Passed" }
    ],
    answer: "a",
    explanation:
      "The `nonConformanceStatus` enum has exactly three values. Draft/Active/Archived belongs to quality documents, and Open/Mitigating/Accepted to the risk register — different records, different lifecycles.",
    docsUrl: ISS
  },
  {
    slug: "quality.issues.02",
    unitSlug: "issues",
    topic: "issues",
    bloom: "apply",
    kind: "single",
    prompt:
      "You try to change a disposition and Carbon answers 'Cannot modify a closed issue. Reopen it first.' What state is the issue in, and what unblocks the edit?",
    options: [
      {
        id: "a",
        text: "It is Closed — the only locked state; use Reopen, make the change, then close it again"
      },
      {
        id: "b",
        text: "It is In Progress — complete the outstanding action tasks first"
      },
      {
        id: "c",
        text: "It is Registered — click Start before editing dispositions"
      },
      {
        id: "d",
        text: "It is locked by another user — wait for their session to end"
      }
    ],
    answer: "a",
    explanation:
      "`isIssueLocked(status)` returns true only for Closed, and it freezes the issue's fields, tasks, and entity moves. Registered and In Progress are both fully editable.",
    docsUrl: ISS
  },
  {
    slug: "quality.issues.03",
    unitSlug: "issues",
    topic: "issues",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A Closed issue turns out to need more investigation. You press Reopen. Where does the issue land?",
    options: [
      { id: "a", text: "Back at Registered" },
      { id: "b", text: "Back at In Progress, keeping its assignee" },
      { id: "c", text: "A new issue is created and the old one stays Closed" },
      { id: "d", text: "It stays Closed; Reopen only unlocks the fields" }
    ],
    answer: "a",
    explanation:
      "Reopen sends the issue back to Registered, not to In Progress — closing already cleared the assignee, so the record genuinely restarts its lifecycle rather than resuming mid-flight. That is why Closed is a locked state but not a dead end.",
    docsUrl: ISS
  },
  {
    slug: "quality.issues.04",
    unitSlug: "issues",
    topic: "issues",
    bloom: "apply",
    kind: "single",
    prompt:
      "An issue is sitting at Registered. An investigator types a note into one of its action tasks. What happens to the issue status?",
    options: [
      {
        id: "a",
        text: "It auto-advances to In Progress — the same transition the Start button makes"
      },
      { id: "b", text: "Nothing; only the Start button changes the status" },
      { id: "c", text: "It advances only once every task is In Progress" },
      { id: "d", text: "It moves to In Progress and stamps a close date" }
    ],
    answer: "a",
    explanation:
      "An issue auto-advances to In Progress the first time someone types into a task note while still Registered. Start is the explicit route to the same place — the point is that a Registered issue nobody has picked up should not stay Registered once work begins.",
    docsUrl: ISS
  },
  {
    slug: "quality.issues.05",
    unitSlug: "issues",
    topic: "issues",
    bloom: "apply",
    kind: "single",
    prompt:
      "Closing an issue fails with 'Cannot close: Disposition is still Pending'. What do you do?",
    options: [
      {
        id: "a",
        text: "Open each affected-material row with linked entities and choose a final disposition — Rework, Scrap, Use As Is, or Return to Supplier"
      },
      { id: "b", text: "Set the issue's priority to Low so the gate relaxes" },
      {
        id: "c",
        text: "Delete the affected-material rows and close the header"
      },
      { id: "d", text: "Complete every action task; the disposition follows" }
    ],
    answer: "a",
    explanation:
      "Pending is the disposition default and it blocks closing on any row that has linked tracked entities. Every such row needs a real outcome, because closing is what stamps each entity's fate.",
    docsUrl: ISS
  },
  {
    slug: "quality.issues.06",
    unitSlug: "issues",
    topic: "issues",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "`closeIssue` runs a preflight over every affected-item row that has linked tracked entities. Which conditions make it refuse to close? (Select all that apply.)",
    options: [
      { id: "a", text: "A row's disposition is still Pending" },
      {
        id: "b",
        text: "The linked entity quantities do not sum to the row quantity"
      },
      { id: "c", text: "A linked entity is missing or already Consumed" },
      { id: "d", text: "An action task is still Pending" },
      { id: "e", text: "The issue has no due date" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "The preflight is about material, not paperwork: a Pending disposition, a quantity mismatch (usually stale after a split or move), and an entity that is gone or already consumed. An unfinished action task does not block closing — an outstanding MRB approval is the separate thing that holds an issue open.",
    docsUrl: ISS
  },
  {
    slug: "quality.issues.07",
    unitSlug: "issues",
    topic: "issues",
    bloom: "remember",
    kind: "single",
    prompt:
      "You raise a new issue and leave priority and source untouched. What do they default to?",
    options: [
      { id: "a", text: "Medium priority, Internal source" },
      { id: "b", text: "High priority, External source" },
      { id: "c", text: "Low priority, Internal source" },
      { id: "d", text: "Critical priority, External source" }
    ],
    answer: "a",
    explanation:
      "Priority defaults to Medium (Low / Medium / High / Critical) and source to Internal. External is for supplier- and customer-side non-conformances.",
    docsUrl: ISS
  },
  {
    slug: "quality.issues.08",
    unitSlug: "issues",
    topic: "issues",
    bloom: "apply",
    kind: "multi",
    prompt:
      "A new issue refuses to save. Which fields does `issueValidator` require before it will? (Select all that apply.)",
    options: [
      { id: "a", text: "A name summarising the problem" },
      { id: "b", text: "A location" },
      { id: "c", text: "An issue type" },
      { id: "d", text: "An open date" },
      { id: "e", text: "A due date" },
      { id: "f", text: "A workflow" }
    ],
    answer: ["a", "b", "c", "d"],
    explanation:
      "Name, location, type, and open date are required. The due date is optional and the close date is stamped for you on close; a workflow is an optional template that pre-seeds presets, not a requirement.",
    docsUrl: ISS
  },
  {
    slug: "quality.issues.09",
    unitSlug: "issues",
    topic: "issues",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A quality manager asks you to set an issue's containment status to 'Contained'. What do you tell them?",
    options: [
      {
        id: "a",
        text: "There is no field to set — the issues view derives it from the Containment action task's own state"
      },
      { id: "b", text: "It is a picker on the issue header, next to priority" },
      {
        id: "c",
        text: "It is set by choosing a disposition of Use As Is on the affected material"
      },
      {
        id: "d",
        text: "Only a Material Review Board reviewer can set it, from the approval task"
      }
    ],
    answer: "a",
    explanation:
      "Containment status is computed, not stored. It follows the work: the view reads the Containment-type action task and reports Contained, Uncontained, or N/A. Trying to set it directly means you are looking for a field that does not exist.",
    docsUrl: ISS
  },
  {
    slug: "quality.issues.10",
    unitSlug: "issues",
    topic: "issues",
    bloom: "apply",
    kind: "single",
    prompt:
      "An issue's workflow attached a Containment Action task, but nobody has started it. What does the issue's containment status read?",
    options: [
      { id: "a", text: "Uncontained" },
      { id: "b", text: "N/A" },
      { id: "c", text: "Contained" },
      { id: "d", text: "Pending" }
    ],
    answer: "a",
    explanation:
      "A Containment task that exists but has not started reads Uncontained. It flips to Contained once that task is In Progress or Completed, and reads N/A only when the issue has no containment task at all — which is why 'no containment task' and 'containment not done' are deliberately different readings.",
    docsUrl: ISS
  },
  {
    slug: "quality.issues.11",
    unitSlug: "issues",
    topic: "issues",
    bloom: "remember",
    kind: "single",
    prompt:
      "Carbon classifies required actions with five system categories. Which of these is NOT one of them?",
    options: [
      { id: "a", text: "Disposition" },
      { id: "b", text: "Containment" },
      { id: "c", text: "Verification" },
      { id: "d", text: "Communication" }
    ],
    answer: "a",
    explanation:
      "The five system types are Containment, Corrective, Preventive, Verification, and Communication. A disposition is the decision about the affected material, recorded on the affected-item row — not a category of action task.",
    docsUrl: G_SHIP
  },
  {
    slug: "quality.issues.12",
    unitSlug: "issues",
    topic: "issues",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A user tries to delete the seeded 'Corrective Action' required action and the database refuses. Why does Carbon protect it?",
    options: [
      {
        id: "a",
        text: "The five system actions carry a `systemType` that other logic keys off, so a trigger blocks deleting them or changing that type"
      },
      { id: "b", text: "Only company admins may delete required actions" },
      {
        id: "c",
        text: "It is in use by an open issue; it can be deleted once that issue closes"
      },
      { id: "d", text: "Required actions can never be deleted, seeded or not" }
    ],
    answer: "a",
    explanation:
      "The five system actions are seeded per company, unique per company, and guarded by a database trigger against deletion and `systemType` changes — containment status alone depends on that classification surviving. Actions you add yourself have no `systemType` and are fully editable.",
    docsUrl: ISS
  },
  {
    slug: "quality.issues.13",
    unitSlug: "issues",
    topic: "issues",
    bloom: "remember",
    kind: "single",
    prompt:
      "An action task on an issue runs its own small lifecycle. What is it?",
    options: [
      {
        id: "a",
        text: "Pending → In Progress → Completed, with Skipped off-path"
      },
      { id: "b", text: "Registered → In Progress → Closed" },
      { id: "c", text: "Draft → Active → Archived" },
      { id: "d", text: "Open → Mitigating → Closed, with Accepted off-path" }
    ],
    answer: "a",
    explanation:
      "Tasks start Pending and do not auto-start; completing one stamps its completed date, and Skipped is the off-path exit. A completed or skipped task can be reopened back to Pending.",
    docsUrl: ISS
  },
  {
    slug: "quality.issues.14",
    unitSlug: "issues",
    topic: "issues",
    bloom: "apply",
    kind: "single",
    prompt:
      "You add the MRB approval requirement to an issue, then remove it again after adding a third reviewer by hand. What is left on the issue?",
    options: [
      {
        id: "a",
        text: "The reviewer you added by hand — the two seeded Engineering and Quality reviewers are cleared"
      },
      { id: "b", text: "Nothing; removing MRB clears every reviewer" },
      {
        id: "c",
        text: "All three reviewers; removing MRB never touches the reviewer list"
      },
      {
        id: "d",
        text: "Only the seeded Engineering and Quality reviewers, since hand-added ones are transient"
      }
    ],
    answer: "a",
    explanation:
      "Requiring MRB materializes an approval task and seeds two reviewers titled Engineering and Quality. Removing MRB cleans up only what it seeded — a reviewer a human deliberately added is left alone.",
    docsUrl: ISS
  },
  {
    slug: "quality.issues.15",
    unitSlug: "issues",
    topic: "issues",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Which dispositions return the linked tracked entities to Available when the issue closes? (Select all that apply.)",
    options: [
      { id: "a", text: "Rework" },
      { id: "b", text: "Use As Is" },
      { id: "c", text: "Scrap" },
      { id: "d", text: "Return to Supplier" },
      { id: "e", text: "Pending" }
    ],
    answer: ["a", "b"],
    explanation:
      "Rework and Use As Is both keep the material as stock, so the entities go back to Available. Scrap and Return to Supplier flip them to Rejected and write a Negative Adjustment ledger entry. Pending is not an outcome at all — it blocks the close.",
    docsUrl: ISS
  },
  {
    slug: "quality.issues.16",
    unitSlug: "issues",
    topic: "issues",
    bloom: "apply",
    kind: "single",
    prompt:
      "A batch of non-conforming assemblies is held against an issue that requires MRB approval. An operator wants to put them straight back into the build. What has to happen first?",
    options: [
      {
        id: "a",
        text: "A disposition has to be chosen and the review signed off — held material does not move on a hunch"
      },
      {
        id: "b",
        text: "Nothing; held material is available to consume while the issue is open"
      },
      { id: "c", text: "The issue's priority has to be raised to Critical" },
      {
        id: "d",
        text: "The operator has to open a second issue for the same batch"
      }
    ],
    answer: "a",
    explanation:
      "The review step gates what happens to the material: use as is, rework, scrap, or return to supplier. Adding an MRB approval means the issue cannot close until a disposition is chosen, and the decision is recorded against the issue alongside its actions.",
    docsUrl: G_SHIP
  },
  {
    slug: "quality.issues.17",
    unitSlug: "issues",
    topic: "issues",
    bloom: "analyze",
    kind: "single",
    prompt:
      "With accounting enabled, you close an issue whose material was dispositioned Scrap. What does Carbon post, and why that way?",
    options: [
      {
        id: "a",
        text: "Debit Scrap / Cost of Quality, credit Inventory — so written-off value lands on a cost-of-quality account instead of distorting on-hand inventory"
      },
      {
        id: "b",
        text: "Debit Inventory, credit Scrap / Cost of Quality — the material is returning to stock"
      },
      {
        id: "c",
        text: "Nothing; scrap is recorded as a quantity movement with no ledger impact"
      },
      {
        id: "d",
        text: "Debit Accounts Payable, credit Inventory — the supplier is charged back"
      }
    ],
    answer: "a",
    explanation:
      "Scrap and Return to Supplier both relieve the material's inventory cost layers and post debit Scrap / Cost of Quality, credit Inventory. Putting the value on a dedicated cost-of-quality account is what keeps the on-hand inventory figure honest.",
    docsUrl: QUAL
  },
  {
    slug: "quality.issues.18",
    unitSlug: "issues",
    topic: "issues",
    bloom: "analyze",
    kind: "single",
    prompt:
      "An issue closed last month and posted its disposition entries to the general ledger. The disposition turns out to have been wrong. What is the correct move?",
    options: [
      {
        id: "a",
        text: "Book the correction forward as a new adjustment — an issue that has posted these entries can no longer be reopened"
      },
      {
        id: "b",
        text: "Reopen the issue, change the disposition, and close it again to reverse the entries"
      },
      {
        id: "c",
        text: "Delete the issue so the ledger entries are removed with it"
      },
      {
        id: "d",
        text: "Edit the posted journal lines directly on the accounting side"
      }
    ],
    answer: "a",
    explanation:
      "Once an issue has posted its disposition movements it is no longer reopenable. Corrections go forward as a new adjustment rather than by unwinding history, which is what keeps the ledger auditable.",
    docsUrl: QUAL
  },
  {
    slug: "quality.issues.19",
    unitSlug: "issues",
    topic: "issues",
    bloom: "apply",
    kind: "single",
    prompt:
      "An issue has an affected-item row for a part, but no serials or batches were ever linked to it. Does that row block closing?",
    options: [
      {
        id: "a",
        text: "No — the disposition gate only applies to rows with linked tracked entities"
      },
      { id: "b", text: "Yes — every row must carry a final disposition" },
      { id: "c", text: "Yes, unless the row quantity is zero" },
      { id: "d", text: "No, but only if the issue's source is Internal" }
    ],
    answer: "a",
    explanation:
      "The preflight walks rows that have linked tracked entities. A row with no linked material is not gated — you do not have to disposition what you never traced.",
    docsUrl: ISS
  },
  {
    slug: "quality.issues.20",
    unitSlug: "issues",
    topic: "issues",
    bloom: "apply",
    kind: "single",
    prompt:
      "You try to move a batch from a row on NCR000012 onto a row on NCR000031 and get 'Cannot move entities between different NCRs'. How do you handle that material under the second issue?",
    options: [
      {
        id: "a",
        text: "Add the item to NCR000031 and assign the entities to a row there"
      },
      { id: "b", text: "Close NCR000012 first, then the move is allowed" },
      { id: "c", text: "Split the entity, which bypasses the same-issue rule" },
      { id: "d", text: "Merge the two issues from the issue header" }
    ],
    answer: "a",
    explanation:
      "Entity moves are only valid between two different rows on the same issue. To handle material under another NCR you add the item there and assign the entities on that issue.",
    docsUrl: ISS
  },
  {
    slug: "quality.issues.21",
    unitSlug: "issues",
    topic: "issues",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Your auditor asks where Carbon's 8D process is configured. What is the accurate answer?",
    options: [
      {
        id: "a",
        text: "Nowhere special — an 8D is just a workflow whose required actions cover the eight disciplines, composed from the same building blocks as any other workflow"
      },
      {
        id: "b",
        text: "It is a hard-coded state machine with eight mandatory stages"
      },
      {
        id: "c",
        text: "It is a separate module you enable in company settings"
      },
      {
        id: "d",
        text: "It is the fixed default for every issue whose source is External"
      }
    ],
    answer: "a",
    explanation:
      "A workflow is a reusable template — a rich-text issue template plus preset priority, source, required actions, and approval requirements. Nothing about 8D is hard-coded; a lighter containment-only workflow is built exactly the same way.",
    docsUrl: ISS
  },
  {
    slug: "quality.issues.22",
    unitSlug: "issues",
    topic: "issues",
    bloom: "remember",
    kind: "single",
    prompt: "Which of these does NOT open an issue in Carbon?",
    options: [
      { id: "a", text: "A gauge going past its next calibration date" },
      { id: "b", text: "An inbound inspection rejecting a lot" },
      { id: "c", text: "An operator raising one from the shop floor in MES" },
      { id: "d", text: "A message from Slack" }
    ],
    answer: "a",
    explanation:
      "Issues open by hand, from MES, from Slack, or automatically when an inbound inspection rejects a lot. An overdue gauge is surfaced and notified but raises nothing on its own.",
    docsUrl: ISS
  },
  {
    slug: "quality.issues.23",
    unitSlug: "issues",
    topic: "issues",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A buyer wants a supplier quality score. Where does that number come from in Carbon?",
    options: [
      {
        id: "a",
        text: "It is derived by counting the issues linked to that supplier — there is no separate scorecard record"
      },
      {
        id: "b",
        text: "From a supplier scorecard you maintain on the supplier record"
      },
      { id: "c", text: "From the supplier's on-time receipt percentage only" },
      {
        id: "d",
        text: "From the risk register entries filed against the supplier"
      }
    ],
    answer: "a",
    explanation:
      "Carbon has no dedicated supplier scorecard. Because an issue can associate to a supplier (one of ten association types), supplier quality is a metric read off the issues themselves — which is also why linking an issue to the right supplier actually matters.",
    docsUrl: QUAL
  },
  {
    slug: "quality.issues.24",
    unitSlug: "issues",
    topic: "issues",
    bloom: "apply",
    kind: "single",
    prompt:
      "A disposition row carries 40 pieces. You try to split off 40 into a new row and Carbon refuses. What is the rule?",
    options: [
      {
        id: "a",
        text: "A split has to leave something behind — the split-off amount must be less than the row's current quantity"
      },
      { id: "b", text: "Splits are only allowed on serial-tracked material" },
      { id: "c", text: "A split can only ever move one entity at a time" },
      { id: "d", text: "The row must be dispositioned before it can be split" }
    ],
    answer: "a",
    explanation:
      "Splitting 40 off a 40-piece row would leave an empty original, so the split quantity must be strictly less than the current quantity. Splitting more than the linked entity carries, or selecting the same entity twice, is refused for the same integrity reason.",
    docsUrl: ISS
  },

  // --------------------------------------------------------- inspections (21)
  {
    slug: "quality.inspections.01",
    unitSlug: "inspections",
    topic: "inspections",
    bloom: "remember",
    kind: "single",
    prompt: "What is the full status set of an inbound inspection lot?",
    options: [
      { id: "a", text: "Pending, In Progress, Passed, Failed, Partial" },
      { id: "b", text: "Pending, In Progress, Passed, Failed" },
      { id: "c", text: "Registered, In Progress, Closed" },
      { id: "d", text: "Draft, In Progress, Accepted, Rejected" }
    ],
    answer: "a",
    explanation:
      "Five values: two working states and three disposition outcomes. Partial is the middle outcome for when part of the lot is good and part is not.",
    docsUrl: INSP
  },
  {
    slug: "quality.inspections.02",
    unitSlug: "inspections",
    topic: "inspections",
    bloom: "analyze",
    kind: "single",
    prompt:
      "An inspector records the last sample of a lot and every unit passed. The lot still reads In Progress. Is something broken?",
    options: [
      {
        id: "a",
        text: "No — Passed, Failed, and Partial are disposition outcomes, so someone still has to press Accept Lot"
      },
      {
        id: "b",
        text: "Yes — the lot should recompute to Passed once the sample size is met"
      },
      {
        id: "c",
        text: "Yes — a passing sample releases the entities and the status follows"
      },
      {
        id: "d",
        text: "No — the status updates on the nightly job that recomputes lots"
      }
    ],
    answer: "a",
    explanation:
      "Finishing the samples never moves the lot to a terminal state on its own. The inspector records results, then presses Accept Lot, Reject Lot, or Partial — the disposition is a deliberate human act, and it is what stamps `dispositionedBy` and `dispositionedAt`.",
    docsUrl: INSP
  },
  {
    slug: "quality.inspections.03",
    unitSlug: "inspections",
    topic: "inspections",
    bloom: "apply",
    kind: "single",
    prompt:
      "An AQL plan resolved a sample size of 32 with an acceptance number of 1. After 12 units the inspector has found 2 defects. What can they do?",
    options: [
      {
        id: "a",
        text: "Reject the lot now — Reject Lot unlocks the moment failures exceed the acceptance number, without finishing the sample"
      },
      {
        id: "b",
        text: "Nothing until all 32 are inspected; only then does a decision unlock"
      },
      {
        id: "c",
        text: "Accept the lot, because 2 defects in 12 is under the 32-unit AQL rate"
      },
      {
        id: "d",
        text: "Re-resolve the plan at Tightened severity and restart the sample"
      }
    ],
    answer: "a",
    explanation:
      "Accept Lot needs the full sample inspected with failures at or below the acceptance number; Reject Lot needs only that failures exceed it. You do not have to finish inspecting a lot that is already clearly bad.",
    docsUrl: INSP
  },
  {
    slug: "quality.inspections.04",
    unitSlug: "inspections",
    topic: "inspections",
    bloom: "apply",
    kind: "single",
    prompt:
      "A receipt posts for an item flagged `requiresInspection`. A planner immediately tries to consume the units on a job and cannot. Why?",
    options: [
      {
        id: "a",
        text: "The tracked entities were posted On Hold, not Available — they are received but not stock you can sell or consume"
      },
      { id: "b", text: "The receipt has not been posted to the ledger yet" },
      {
        id: "c",
        text: "The units are in a quarantine bin the job's method does not reference"
      },
      { id: "d", text: "The item's sampling plan has not been created yet" }
    ],
    answer: "a",
    explanation:
      "Inspection-required stock is not on-hand until dispositioned. Posting the receipt opens the inspection and puts the entities On Hold; only accepting the lot (or the per-sample passes) releases them to Available.",
    docsUrl: INSP
  },
  {
    slug: "quality.inspections.05",
    unitSlug: "inspections",
    topic: "inspections",
    bloom: "apply",
    kind: "single",
    prompt:
      "A lot has a sample size of 20 and an acceptance number of 2. The inspector has recorded 20 results with 2 failures. Which buttons are available?",
    options: [
      { id: "a", text: "Accept Lot and Partial" },
      { id: "b", text: "Reject Lot only" },
      { id: "c", text: "Accept Lot only — Partial needs an untouched lot" },
      { id: "d", text: "None; a lot with any failure must be re-inspected" }
    ],
    answer: "a",
    explanation:
      "Accept Lot unlocks once the inspected count reaches the sample size and failures are at or below the acceptance number — 2 is not more than 2. Partial is available as soon as any unit has been inspected. Reject Lot stays locked because failures never exceeded the acceptance number.",
    docsUrl: INSP
  },
  {
    slug: "quality.inspections.06",
    unitSlug: "inspections",
    topic: "inspections",
    bloom: "apply",
    kind: "single",
    prompt:
      "Half a received lot is visibly contaminated and half is clean. You disposition it Partial. What happens to the units?",
    options: [
      {
        id: "a",
        text: "Some clear and the rest stay On Hold — Partial is the middle outcome, and the lot is now terminal"
      },
      {
        id: "b",
        text: "Every unit is released to Available and an issue is opened"
      },
      {
        id: "c",
        text: "Every unit flips to Rejected and the receipt is reversed"
      },
      {
        id: "d",
        text: "The lot returns to Pending so a second inspector can re-sample it"
      }
    ],
    answer: "a",
    explanation:
      "Partial clears some units and leaves the rest On Hold. Like Passed and Failed it is terminal — the lot locks and takes no further samples, so re-inspecting would mean a fresh inspection.",
    docsUrl: INSP
  },
  {
    slug: "quality.inspections.07",
    unitSlug: "inspections",
    topic: "inspections",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A lot was received last week under a Percentage plan. You now change the item's sampling plan to AQL 1.0. What happens to the lot already on the dock?",
    options: [
      {
        id: "a",
        text: "Nothing — the resolved plan was snapshotted onto the lot at receipt, so the edit only affects future lots"
      },
      {
        id: "b",
        text: "It re-resolves on next open and the sample size changes"
      },
      { id: "c", text: "It is voided and a new inspection is created" },
      {
        id: "d",
        text: "Its sample size changes but the acceptance number is kept"
      }
    ],
    answer: "a",
    explanation:
      "Sample size, acceptance and rejection numbers, standard, code letter, AQL, level, and severity are all copied onto the `inboundInspection` row when the receipt posts. Freezing them is what stops a later plan edit from silently rewriting the history of a lot someone already inspected.",
    docsUrl: INSP
  },
  {
    slug: "quality.inspections.08",
    unitSlug: "inspections",
    topic: "inspections",
    bloom: "remember",
    kind: "single",
    prompt:
      "Carbon offers four sampling plan types. Which one draws its sample size and accept/reject numbers from a published statistical standard?",
    options: [
      { id: "a", text: "AQL" },
      { id: "b", text: "Inspect All" },
      { id: "c", text: "Inspect First N" },
      { id: "d", text: "Percentage" },
      { id: "e", text: "None — all four use the same table" }
    ],
    answer: "a",
    explanation:
      "Only AQL walks the ANSI/ASQ Z1.4 or ISO 2859-1 tables. Inspect All, Inspect First N, and Percentage are simple counts with a fixed zero-defect rule.",
    docsUrl: INSP
  },
  {
    slug: "quality.inspections.09",
    unitSlug: "inspections",
    topic: "inspections",
    bloom: "apply",
    kind: "single",
    prompt:
      "An item is on a Percentage plan: 10% of the lot. A 200-piece lot arrives and the first sampled unit fails. What is the outcome?",
    options: [
      {
        id: "a",
        text: "The lot can be rejected immediately — Percentage plans carry an acceptance number of 0 and a rejection number of 1"
      },
      {
        id: "b",
        text: "The inspector must finish all 20 samples before anything unlocks"
      },
      {
        id: "c",
        text: "One failure in 20 is within a 10% plan, so the lot still passes"
      },
      {
        id: "d",
        text: "The plan escalates to AQL because a defect was found"
      }
    ],
    answer: "a",
    explanation:
      "Inspect All, Inspect First N, and Percentage all use accept 0 / reject 1, so a single defect fails the lot. The percentage decides how many you look at, never how many defects you tolerate.",
    docsUrl: INSP
  },
  {
    slug: "quality.inspections.10",
    unitSlug: "inspections",
    topic: "inspections",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Resolving an AQL plan into a sample size and accept/reject numbers is a two-step table walk. Which inputs does the resolver use? (Select all that apply.)",
    options: [
      { id: "a", text: "The lot size" },
      { id: "b", text: "The inspection level" },
      { id: "c", text: "The AQL value" },
      { id: "d", text: "The inspection severity" },
      { id: "e", text: "The supplier's on-time delivery rate" },
      { id: "f", text: "The item's unit cost" }
    ],
    answer: ["a", "b", "c", "d"],
    explanation:
      "Step one maps lot size to a code letter (A–R) for the chosen inspection level. Step two takes that code letter with the AQL value and the severity to pick the cell giving n, Ac, and Re. Nothing commercial about the supplier or the part enters the arithmetic.",
    docsUrl: INSP
  },
  {
    slug: "quality.inspections.11",
    unitSlug: "inspections",
    topic: "inspections",
    bloom: "apply",
    kind: "single",
    prompt:
      "A supplier's quality has been slipping and you want to inspect their incoming lots harder without changing the AQL you accept. What do you change?",
    options: [
      { id: "a", text: "The inspection severity, from Normal to Tightened" },
      { id: "b", text: "The plan type, from AQL to Inspect All" },
      { id: "c", text: "The sampling standard, from ANSI Z1.4 to ISO 2859-1" },
      { id: "d", text: "The acceptance number, typed directly on the lot" }
    ],
    answer: "a",
    explanation:
      "Severity switches which table the code letter is read against: Normal, Tightened (stricter — exactly the slipping-supplier case), or Reduced. Switching standards would not help, since ISO 2859-1 cells match Z1.4 for the plans Carbon exposes.",
    docsUrl: INSP
  },
  {
    slug: "quality.inspections.12",
    unitSlug: "inspections",
    topic: "inspections",
    bloom: "remember",
    kind: "single",
    prompt:
      "Which inspection level is the general default, and what are S1–S4 for?",
    options: [
      {
        id: "a",
        text: "Level II is the general default; S1–S4 are special small-sample levels"
      },
      {
        id: "b",
        text: "Level I is the general default; S1–S4 are the tightened levels"
      },
      {
        id: "c",
        text: "Level III is the general default; S1–S4 are the reduced levels"
      },
      {
        id: "d",
        text: "There is no default; a level must be chosen on every lot"
      }
    ],
    answer: "a",
    explanation:
      "Level II is the general default, with I and III trading sample size against confidence. S1–S4 are the special levels for small samples — a different axis from severity, which is Normal / Tightened / Reduced.",
    docsUrl: INSP
  },
  {
    slug: "quality.inspections.13",
    unitSlug: "inspections",
    topic: "inspections",
    bloom: "apply",
    kind: "single",
    prompt:
      "You want one item inspected against ISO 2859-1 while everything else stays on ANSI Z1.4. Can you?",
    options: [
      {
        id: "a",
        text: "No — the standard is a company-wide setting on company settings, not a per-item field"
      },
      { id: "b", text: "Yes — set it on the item's sampling plan" },
      { id: "c", text: "Yes — set it on the supplier record" },
      { id: "d", text: "Yes — choose it when dispositioning each lot" }
    ],
    answer: "a",
    explanation:
      "`companySettings.samplingStandard` is company-wide and defaults to ANSI Z1.4. In practice it changes little today, because the ISO 2859-1 cells match Z1.4 for the plans Carbon exposes — the per-item knobs are the plan type, AQL, level, and severity.",
    docsUrl: INSP
  },
  {
    slug: "quality.inspections.14",
    unitSlug: "inspections",
    topic: "inspections",
    bloom: "apply",
    kind: "single",
    prompt:
      "An inspector recorded every sample on a lot but cannot press Accept Lot, while a colleague can. The company has `enforceInspectionFourEyes` turned on. What is happening?",
    options: [
      {
        id: "a",
        text: "Four-eyes sign-off means the person who recorded a sample cannot be the one who dispositions the lot"
      },
      { id: "b", text: "The inspector lacks the quality view permission" },
      {
        id: "c",
        text: "Four-eyes requires two inspectors to record every sample twice"
      },
      {
        id: "d",
        text: "The lot is already terminal and the button is inert for everyone"
      }
    ],
    answer: "a",
    explanation:
      "The four-eyes setting deliberately separates recording from dispositioning, so the person who took the readings cannot also be the one who clears the lot. It is a company setting, not a permission problem.",
    docsUrl: INSP
  },
  {
    slug: "quality.inspections.15",
    unitSlug: "inspections",
    topic: "inspections",
    bloom: "apply",
    kind: "single",
    prompt:
      "An item is flagged `requiresInspection` but nobody ever configured a sampling plan for it. A 500-piece receipt posts. What plan does the lot get?",
    options: [
      {
        id: "a",
        text: "Inspect All at level II, Normal severity — the post-receipt default"
      },
      {
        id: "b",
        text: "No inspection is created; the units go straight to Available"
      },
      { id: "c", text: "AQL 2.5 at level II, Normal severity" },
      { id: "d", text: "The receipt fails to post until a plan is configured" }
    ],
    answer: "a",
    explanation:
      "With no plan configured, `post-receipt` falls back to Inspect All, level II, Normal — the most conservative option, so a missing configuration errs toward inspecting everything rather than silently skipping the gate.",
    docsUrl: INSP
  },
  {
    slug: "quality.inspections.16",
    unitSlug: "inspections",
    topic: "inspections",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Why does a sample recorded against a Batch-tracked item leave `trackedEntityId` null, while a Serial item's sample does not?",
    options: [
      {
        id: "a",
        text: "There is no discrete unit to scan for Batch, Inventory, or Non-Inventory items, so the sample records just a Pass/Fail"
      },
      {
        id: "b",
        text: "Batch items are never tracked, so they have no entities at all"
      },
      { id: "c", text: "Batch samples are written later by a background job" },
      {
        id: "d",
        text: "Batch items skip sampling entirely and are always Inspect All"
      }
    ],
    answer: "a",
    explanation:
      "Serial inspection scans or selects a specific tracked entity per sample. Batch, Inventory, and Non-Inventory items have no discrete unit to point at, so the same modal records only the result — the serial path just adds a Scan/Select step.",
    docsUrl: INSP
  },
  {
    slug: "quality.inspections.17",
    unitSlug: "inspections",
    topic: "inspections",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "You press Reject Lot on an inbound inspection and leave the dialog's defaults alone. What is true afterwards? (Select all that apply.)",
    options: [
      { id: "a", text: "Every entity in the lot flips to Rejected" },
      {
        id: "b",
        text: "An issue is created and linked back to the inspection — the 'Open an NCR' checkbox is on by default"
      },
      {
        id: "c",
        text: "The lot is terminal and will not accept any further samples"
      },
      {
        id: "d",
        text: "Un-sampled entities are released to Available since they were never found defective"
      },
      {
        id: "e",
        text: "The item's sampling plan automatically switches to Tightened severity"
      }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Rejecting flips the whole lot to Rejected, opens the linked NCR by default, and locks the lot. Releasing un-sampled entities is what Accept does, not Reject. The disposition is appended to `inboundInspectionHistory`, but that log exists for *future* plan auto-switching — nothing changes the plan today.",
    docsUrl: INSP
  },
  {
    slug: "quality.inspections.18",
    unitSlug: "inspections",
    topic: "inspections",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Rejecting a non-tracked Inventory lot also posts a compensating negative adjustment to the item ledger, under the 'Inbound Inspection' document type. Why is that needed here but not for a serial lot?",
    options: [
      {
        id: "a",
        text: "Non-tracked quantity has no per-entity status, so nothing else would keep the rejected units out of on-hand"
      },
      { id: "b", text: "Non-tracked items are always valued differently" },
      {
        id: "c",
        text: "It reverses the receipt so the supplier can be re-invoiced"
      },
      {
        id: "d",
        text: "It is what triggers the automatic NCR for non-tracked items"
      }
    ],
    answer: "a",
    explanation:
      "A serial or batch lot excludes rejected units from on-hand by flipping each entity's status. Non-tracked Inventory has no such per-entity flag, so the only way to take the rejected quantity back out of stock is an explicit compensating ledger adjustment.",
    docsUrl: INSP
  },
  {
    slug: "quality.inspections.19",
    unitSlug: "inspections",
    topic: "inspections",
    bloom: "apply",
    kind: "multi",
    prompt:
      "You are building a ballooned FAI drawing. Which fields does a balloon feature require? (Select all that apply.)",
    options: [
      { id: "a", text: "balloonNumber" },
      { id: "b", text: "description" },
      { id: "c", text: "nominalValue" },
      { id: "d", text: "tolerancePlus and toleranceMinus" },
      { id: "e", text: "unitOfMeasureCode" }
    ],
    answer: ["a", "b"],
    explanation:
      "Only the balloon number stamped on the drawing and a description of the characteristic are required. Nominal, tolerances, and unit are optional — a balloon can legitimately be a checkbox-style characteristic with nothing to measure.",
    docsUrl: INSP
  },
  {
    slug: "quality.inspections.20",
    unitSlug: "inspections",
    topic: "inspections",
    bloom: "apply",
    kind: "single",
    prompt:
      "A lot was dispositioned Passed yesterday. Today someone finds a bad unit and wants to record it against that inspection. What can they do?",
    options: [
      {
        id: "a",
        text: "Nothing on that lot — a terminal lot locks; re-inspecting means a fresh inspection, and the defect belongs on an issue"
      },
      { id: "b", text: "Add the sample; the lot recomputes to Failed" },
      {
        id: "c",
        text: "Reopen the lot from the disposition menu and add the sample"
      },
      { id: "d", text: "Edit the acceptance number so the lot re-evaluates" }
    ],
    answer: "a",
    explanation:
      "Passed, Failed, and Partial all lock the lot — no further samples, no recompute. Defects found after disposition are handled as an issue, which is the record built for investigation and material disposition.",
    docsUrl: INSP
  },
  {
    slug: "quality.inspections.21",
    unitSlug: "inspections",
    topic: "inspections",
    bloom: "remember",
    kind: "single",
    prompt: "What actually opens an inbound inspection lot?",
    options: [
      {
        id: "a",
        text: "Posting a purchase-order receipt line for an item flagged to require inspection, with a received quantity above zero"
      },
      { id: "b", text: "Creating the purchase order for such an item" },
      {
        id: "c",
        text: "Posting any receipt, including a transfer or a customer return"
      },
      { id: "d", text: "Finishing a job operation of type Inspection" }
    ],
    answer: "a",
    explanation:
      "Inbound inspection is a receiving-side gate: `post-receipt` reads `item.requiresInspection` per received line. The flag's checkbox only appears on purchased (Buy) items, so it is one inspection per received line, not per order and not per item everywhere.",
    docsUrl: INSP
  },

  // --------------------------------------------------------- calibration (15)
  {
    slug: "quality.calibration.01",
    unitSlug: "calibration",
    topic: "calibration",
    bloom: "remember",
    kind: "single",
    prompt:
      "What is the difference between a Master gauge and a Standard gauge?",
    options: [
      {
        id: "a",
        text: "A Master is the reference you calibrate other gauges against; a Standard is one you use for routine checks"
      },
      {
        id: "b",
        text: "A Master is owned by the company; a Standard is leased from a supplier"
      },
      {
        id: "c",
        text: "A Master never needs calibration; a Standard does"
      },
      {
        id: "d",
        text: "A Master is used for first-article inspection only; a Standard is used in-process"
      }
    ],
    answer: "a",
    explanation:
      "`gaugeRole` is required and has exactly these two values. Both are on a calibration schedule — being a Master does not exempt an instrument from being calibrated itself.",
    docsUrl: CAL
  },
  {
    slug: "quality.calibration.02",
    unitSlug: "calibration",
    topic: "calibration",
    bloom: "apply",
    kind: "single",
    prompt:
      "A quality lead wants to push a caliper's next calibration date out by a month. Where do they type the new date?",
    options: [
      {
        id: "a",
        text: "Nowhere — the next-due date is computed as last calibration date plus the interval; you change the interval or log a calibration"
      },
      { id: "b", text: "On the gauge record's next calibration date field" },
      { id: "c", text: "On the newest calibration record's date field" },
      {
        id: "d",
        text: "In company settings, on the calibration-expiry alert list"
      }
    ],
    answer: "a",
    explanation:
      "The interval in months and the last calibration date are the whole schedule. Carbon recomputes the next-due date every time a calibration is logged, so there is no next-due field to hand-edit.",
    docsUrl: CAL
  },
  {
    slug: "quality.calibration.03",
    unitSlug: "calibration",
    topic: "calibration",
    bloom: "apply",
    kind: "single",
    prompt:
      "A caliper on a six-month interval is calibrated on 1 January. When does it come due?",
    options: [
      { id: "a", text: "1 July — the calibration date plus the interval" },
      { id: "b", text: "31 December — the end of the calibration year" },
      {
        id: "c",
        text: "1 June — the interval counts from the previous due date"
      },
      {
        id: "d",
        text: "It has no due date until a second calibration is logged"
      }
    ],
    answer: "a",
    explanation:
      "Recording a calibration stamps its date as the gauge's last calibration date and sets next-due to that date plus the interval. The clock always restarts from the calibration you actually performed, not from the old schedule.",
    docsUrl: CAL
  },
  {
    slug: "quality.calibration.04",
    unitSlug: "calibration",
    topic: "calibration",
    bloom: "remember",
    kind: "multi",
    prompt:
      "Which flags on a calibration record make that calibration a Fail? (Select all that apply.)",
    options: [
      { id: "a", text: "requiresAction" },
      { id: "b", text: "requiresAdjustment" },
      { id: "c", text: "requiresRepair" },
      { id: "d", text: "An ambient temperature outside 20 °C ± 2" },
      { id: "e", text: "A missing measurement standard" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Three checkboxes decide the result: tick any one and the calibration is a Fail; leave all three clear and it is a Pass. Temperature, humidity, and the measurement standard are recorded as evidence but do not grade the calibration.",
    docsUrl: CAL
  },
  {
    slug: "quality.calibration.05",
    unitSlug: "calibration",
    topic: "calibration",
    bloom: "apply",
    kind: "single",
    prompt:
      "A micrometer was adjusted during its calibration and every reading afterwards was in tolerance. The technician ticks 'requires adjustment'. What is the gauge's status?",
    options: [
      {
        id: "a",
        text: "Out-of-Calibration — any one of the three flags makes the record a Fail"
      },
      {
        id: "b",
        text: "In-Calibration — the readings were good once it was adjusted"
      },
      {
        id: "c",
        text: "Pending — an adjusted gauge needs a second calibration to confirm"
      },
      { id: "d", text: "Unchanged — adjustment flags are informational only" }
    ],
    answer: "a",
    explanation:
      "Pass/fail is derived from the flags, not from the readings. Ticking requires-adjustment says the instrument was not right as found, so the record grades as a Fail and the gauge moves to Out-of-Calibration until a clean calibration is logged.",
    docsUrl: CAL
  },
  {
    slug: "quality.calibration.06",
    unitSlug: "calibration",
    topic: "calibration",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A gauge passed calibration in January with a six-month interval. Nobody has touched the record since. It is now August. What does the gauge read, and who changed it?",
    options: [
      {
        id: "a",
        text: "Out-of-Calibration, and nobody — overdue is derived at read time from the next-due date"
      },
      {
        id: "b",
        text: "In-Calibration, until someone marks it overdue"
      },
      {
        id: "c",
        text: "Out-of-Calibration, set by the nightly calibration-expiry job"
      },
      { id: "d", text: "Pending, because the schedule has lapsed" }
    ],
    answer: "a",
    explanation:
      "Overdue is computed, not stored: whenever a gauge is Inactive or its next-due date is before today, it reads Out-of-Calibration regardless of the stored result. The scheduled job only notifies the people on the calibration-expiry alert list — it is not what flips the status.",
    docsUrl: CAL
  },
  {
    slug: "quality.calibration.07",
    unitSlug: "calibration",
    topic: "calibration",
    bloom: "analyze",
    kind: "single",
    prompt:
      "An inspector notices the gauge listed on the bench is Out-of-Calibration, but they were still able to record samples and accept a lot. Is that a bug?",
    options: [
      {
        id: "a",
        text: "No — the calibration status is advisory. Carbon displays it and can notify, but there is no enforced block on inspections"
      },
      {
        id: "b",
        text: "Yes — an overdue gauge should have blocked the disposition"
      },
      {
        id: "c",
        text: "No — recording samples is allowed, but accepting the lot should have been blocked"
      },
      {
        id: "d",
        text: "Yes — the gauge should have been auto-deactivated, which would have blocked it"
      }
    ],
    answer: "a",
    explanation:
      "This is the rule people most often assume backwards. Carbon keeps the instrument controlled and surfaces the status as a signal, but it is not a gate — samples can still be recorded and lots accepted or rejected with an overdue gauge. Treat the status as a process control you enforce, not one the software enforces for you.",
    docsUrl: CAL
  },
  {
    slug: "quality.calibration.08",
    unitSlug: "calibration",
    topic: "calibration",
    bloom: "apply",
    kind: "single",
    prompt:
      "A pin gauge set is retired from service but has years of calibration history you must keep. What do you do with the record?",
    options: [
      {
        id: "a",
        text: "Deactivate it — the history stays on file, and an Inactive gauge reads as out of calibration"
      },
      {
        id: "b",
        text: "Delete it; the calibration records survive on their own"
      },
      {
        id: "c",
        text: "Set its interval to zero so it never comes due again"
      },
      { id: "d", text: "Leave it Active but clear its next calibration date" }
    ],
    answer: "a",
    explanation:
      "Deactivate preserves the gauge and its calibration history and makes it read Out-of-Calibration, which is honest — a retired instrument is not trustworthy. Delete only a gauge that was never calibrated. An interval of zero is rejected anyway; the minimum is one month.",
    docsUrl: CAL
  },
  {
    slug: "quality.calibration.09",
    unitSlug: "calibration",
    topic: "calibration",
    bloom: "remember",
    kind: "single",
    prompt: "What does a calibration status of Pending mean?",
    options: [
      {
        id: "a",
        text: "The gauge has a schedule but no passing calibration on record yet, so it is neither confirmed in nor out"
      },
      {
        id: "b",
        text: "A calibration has been requested and is awaiting an external supplier"
      },
      { id: "c", text: "The gauge is overdue but within a grace period" },
      { id: "d", text: "A calibration record was entered but not yet approved" }
    ],
    answer: "a",
    explanation:
      "Pending is the starting state of a brand-new gauge. It is a genuinely distinct reading from In-Calibration and Out-of-Calibration: nothing has been proven either way yet.",
    docsUrl: CAL
  },
  {
    slug: "quality.calibration.10",
    unitSlug: "calibration",
    topic: "calibration",
    bloom: "apply",
    kind: "multi",
    prompt:
      "An auditor asks what evidence a calibration record carries. Which of these are fields you fill in on the record? (Select all that apply.)",
    options: [
      {
        id: "a",
        text: "The reading pairs taken — each a reference value and the actual value measured against it"
      },
      {
        id: "b",
        text: "The measurement standard the readings were traced to"
      },
      { id: "c", text: "The ambient temperature and humidity" },
      { id: "d", text: "The resulting calibration status" },
      { id: "e", text: "The gauge's next calibration date" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "The record is the evidence: who signed off, against what standard, under what conditions, and the actual readings. The resulting status and the next-due date are both derived — the record supplies the inputs, Carbon supplies the conclusions.",
    docsUrl: CAL
  },
  {
    slug: "quality.calibration.11",
    unitSlug: "calibration",
    topic: "calibration",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Why does Carbon write each calibration as its own dated row rather than updating the gauge's fields in place?",
    options: [
      {
        id: "a",
        text: "So the gauge carries its full history — the record is the audit evidence, and the gauge only summarizes the latest date and status from it"
      },
      {
        id: "b",
        text: "Because a gauge can be calibrated by several suppliers at once"
      },
      {
        id: "c",
        text: "Because the next-due date cannot be computed from a single row"
      },
      {
        id: "d",
        text: "Because calibration records belong to a different company scope"
      }
    ],
    answer: "a",
    explanation:
      "Logging a calibration never overwrites the last one. The gauge shows them newest-first and summarizes only the latest calibration date and the resulting status — the same instinct as a controlled document: never destroy the prior evidence.",
    docsUrl: CAL
  },
  {
    slug: "quality.calibration.12",
    unitSlug: "calibration",
    topic: "calibration",
    bloom: "remember",
    kind: "single",
    prompt:
      "Saving a gauge fails with 'Calibration interval is required'. What value does the field accept?",
    options: [
      {
        id: "a",
        text: "A positive whole number of months, minimum 1 (it defaults to 6)"
      },
      { id: "b", text: "Any number of days, including zero for 'no schedule'" },
      { id: "c", text: "A number of months from 0 to 12" },
      { id: "d", text: "A date, from which Carbon derives the interval" }
    ],
    answer: "a",
    explanation:
      "`calibrationIntervalInMonths` is required with a minimum of 1 and a default of 6. Zero, blank, or a negative value is refused — there is no way to put a gauge on the books with no schedule at all.",
    docsUrl: CAL
  },
  {
    slug: "quality.calibration.13",
    unitSlug: "calibration",
    topic: "calibration",
    bloom: "analyze",
    kind: "single",
    prompt:
      "An inspector asks which gauge was used on a particular inbound inspection. What can Carbon tell them?",
    options: [
      {
        id: "a",
        text: "Nothing — a gauge is not attached to the inspection you record; gauges are managed on their own so the tool is known to be trustworthy"
      },
      { id: "b", text: "The gauge is stored on the inspection's sample rows" },
      {
        id: "c",
        text: "The gauge is stored on the balloon feature that was measured"
      },
      {
        id: "d",
        text: "The gauge is inferred from the inspector's default work centre"
      }
    ],
    answer: "a",
    explanation:
      "Gauges live in the quality module alongside issues and inbound inspection, but they are managed separately and are not linked to a recorded inspection. Carbon's job is keeping the instrument controlled, not recording which one touched which sample.",
    docsUrl: CAL
  },
  {
    slug: "quality.calibration.14",
    unitSlug: "calibration",
    topic: "calibration",
    bloom: "apply",
    kind: "single",
    prompt:
      "You want the quality supervisor warned before gauges lapse rather than after. What does Carbon offer?",
    options: [
      {
        id: "a",
        text: "A scheduled job that checks for gauges going out of calibration and notifies the people listed for calibration-expiry alerts in company settings"
      },
      {
        id: "b",
        text: "A hard block that prevents using a gauge in its final month"
      },
      {
        id: "c",
        text: "An automatic issue raised against the gauge's supplier"
      },
      {
        id: "d",
        text: "Nothing — the only signal is the status on the gauge list"
      }
    ],
    answer: "a",
    explanation:
      "The alert list in company settings is the proactive half of calibration control. It notifies rather than blocks, which is consistent with the status itself being advisory.",
    docsUrl: CAL
  },
  {
    slug: "quality.calibration.15",
    unitSlug: "calibration",
    topic: "calibration",
    bloom: "apply",
    kind: "single",
    prompt:
      "A gauge on a 12-month interval is overdue. You shorten its interval to 6 months and save. What does its next-due date become?",
    options: [
      {
        id: "a",
        text: "Unchanged until you log a calibration — the next calibration recorded recomputes the due date from the new interval"
      },
      { id: "b", text: "Immediately six months from today" },
      {
        id: "c",
        text: "Immediately six months from the last calibration date, clearing the overdue reading"
      },
      { id: "d", text: "Cleared, and the gauge returns to Pending" }
    ],
    answer: "a",
    explanation:
      "Changing the interval alone does not recompute anything. The arithmetic runs when a calibration is logged — so bringing an overdue gauge back is always a matter of recording a fresh passing calibration, never of editing the schedule.",
    docsUrl: CAL
  },

  // ---------------------------------------------------------- documents (15)
  {
    slug: "quality.documents.01",
    unitSlug: "quality-documents",
    topic: "documents",
    bloom: "remember",
    kind: "single",
    prompt: "Which three states does a quality document have?",
    options: [
      { id: "a", text: "Draft, Active, Archived" },
      { id: "b", text: "Draft, Published, Retired" },
      { id: "c", text: "Registered, In Progress, Closed" },
      { id: "d", text: "Pending, Approved, Superseded" }
    ],
    answer: "a",
    explanation:
      "Draft is editable and not yet authoritative, Active is the in-force revision, and Archived is a retired revision that stays readable and can be reactivated.",
    docsUrl: QDOC
  },
  {
    slug: "quality.documents.02",
    unitSlug: "quality-documents",
    topic: "documents",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You publish V2 of 'Incoming Inspection Procedure' while V1 is still Active. What happens to V1, and what enforces it?",
    options: [
      {
        id: "a",
        text: "A database trigger archives every other Active document sharing that name in the company, so exactly one row is live"
      },
      { id: "b", text: "V1 stays Active until someone archives it by hand" },
      { id: "c", text: "V1 is deleted, since V2 replaces it" },
      { id: "d", text: "Publishing V2 is refused while V1 is Active" }
    ],
    answer: "a",
    explanation:
      "Going Active is exclusive by name and enforced in the database, not just the UI. That is what makes 'the current procedure' always a single row, so you can never end up with two live copies of the same instruction on the floor.",
    docsUrl: QDOC
  },
  {
    slug: "quality.documents.03",
    unitSlug: "quality-documents",
    topic: "documents",
    bloom: "apply",
    kind: "single",
    prompt:
      "A corrective action changes step 4 of a published work instruction. What is the controlled way to make the change?",
    options: [
      {
        id: "a",
        text: "Versions → New Version, which copies the body, steps, and tags into a fresh Draft at the next version number; edit and publish that"
      },
      { id: "b", text: "Edit the Active document in place and save" },
      {
        id: "c",
        text: "Archive the Active version, then create a brand-new document"
      },
      {
        id: "d",
        text: "Revert the Active version to Draft, edit it, and publish it again"
      }
    ],
    answer: "a",
    explanation:
      "Editing a live procedure in place destroys the paper trail. New Version leaves the old revision untouched and publishes a successor, so an auditor can see exactly what V1 said and when V2 took over.",
    docsUrl: QDOC
  },
  {
    slug: "quality.documents.04",
    unitSlug: "quality-documents",
    topic: "documents",
    bloom: "remember",
    kind: "single",
    prompt:
      "How are the revisions of one quality document identified and numbered?",
    options: [
      {
        id: "a",
        text: "By a shared name, with each revision a separate row stamped with a version number starting at 0"
      },
      {
        id: "b",
        text: "By a shared id, with the version stored as a suffix on the name"
      },
      { id: "c", text: "By a revision letter, starting at A" },
      { id: "d", text: "By the publish date; there is no version number" }
    ],
    answer: "a",
    explanation:
      "A document is identified by its name, and the name is unique per version — so 'Incoming Inspection Procedure' can exist at V0, V1, and V2 side by side, all queryable together.",
    docsUrl: QDOC
  },
  {
    slug: "quality.documents.05",
    unitSlug: "quality-documents",
    topic: "documents",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Someone asks you to delete the old V1 row because it 'duplicates' the new V2. What do you tell them?",
    options: [
      {
        id: "a",
        text: "V1 is the version history, not a duplicate — the prior revision is never deleted, which is the whole point of a controlled record"
      },
      { id: "b", text: "Delete it; only the Active version is ever audited" },
      { id: "c", text: "Delete it once it has been Archived for a full year" },
      { id: "d", text: "Merge V1 into V2 so only one row remains" }
    ],
    answer: "a",
    explanation:
      "Versioning copies rather than edits in place, so all revisions share the same name and are queryable together. The retired revision is exactly what you point an auditor at.",
    docsUrl: QDOC
  },
  {
    slug: "quality.documents.06",
    unitSlug: "quality-documents",
    topic: "documents",
    bloom: "apply",
    kind: "single",
    prompt:
      "A Draft quality document's header button reads 'Submit for approval' rather than 'Publish'. What does pressing it do?",
    options: [
      {
        id: "a",
        text: "Creates an approval request; the document stays Draft until a qualified approver approves it, which moves it to Active in one transaction"
      },
      {
        id: "b",
        text: "Publishes it to Active and notifies the approvers afterwards"
      },
      {
        id: "c",
        text: "Archives the current Active version immediately, before approval"
      },
      { id: "d", text: "Locks the document so nobody can revert it" }
    ],
    answer: "a",
    explanation:
      "The button changes because an approval rule covers quality documents. Until an approver signs off, the document has not gone Active — which is the usual answer to 'why is activating stuck in Draft?'.",
    docsUrl: QDOC
  },
  {
    slug: "quality.documents.07",
    unitSlug: "quality-documents",
    topic: "documents",
    bloom: "apply",
    kind: "single",
    prompt:
      "Your company has no approval rule covering quality documents. What does Publish do on a Draft?",
    options: [
      { id: "a", text: "Flips it straight to Active" },
      {
        id: "b",
        text: "Creates an approval request that auto-approves overnight"
      },
      { id: "c", text: "Moves it to Archived first, then Active" },
      { id: "d", text: "Nothing until at least one approver is configured" }
    ],
    answer: "a",
    explanation:
      "Approval is optional and driven by the shared approval engine. Without a rule, Publish is a direct transition to Active — and the exclusive-by-name trigger still archives any other Active version.",
    docsUrl: QDOC
  },
  {
    slug: "quality.documents.08",
    unitSlug: "quality-documents",
    topic: "documents",
    bloom: "apply",
    kind: "single",
    prompt:
      "An Archived revision needs to come back into force, and approval is required for quality documents. You submit it for approval. What state is it in while the request is open?",
    options: [
      { id: "a", text: "Draft" },
      { id: "b", text: "Archived, until approved" },
      { id: "c", text: "Active, pending confirmation" },
      { id: "d", text: "It cannot be submitted; only Drafts can" }
    ],
    answer: "a",
    explanation:
      "Submitting an Archived version for approval moves it back to Draft while the request is open. Publish, Reactivate, and Submit for approval are three labels on one journey toward Active.",
    docsUrl: QDOC
  },
  {
    slug: "quality.documents.09",
    unitSlug: "quality-documents",
    topic: "documents",
    bloom: "remember",
    kind: "single",
    prompt:
      "How many pending approval requests can one quality document have at a time?",
    options: [
      { id: "a", text: "One" },
      { id: "b", text: "One per approver" },
      { id: "c", text: "One per version" },
      { id: "d", text: "Unlimited" }
    ],
    answer: "a",
    explanation:
      "Exactly one pending request exists per document at a time. Acting on a stale one gives 'Approval request not found' — reload and act on the current request.",
    docsUrl: QDOC
  },
  {
    slug: "quality.documents.10",
    unitSlug: "quality-documents",
    topic: "documents",
    bloom: "apply",
    kind: "single",
    prompt:
      "A colleague submitted a revision for approval and has gone home. You want to pull it back to Draft to fix a typo. Can you?",
    options: [
      {
        id: "a",
        text: "Only if you are the person who requested it or a designated approver — reverting a version with a pending approval request is restricted"
      },
      { id: "b", text: "Yes — anyone with quality update can revert it" },
      {
        id: "c",
        text: "No — a pending request can never be reverted by anyone"
      },
      { id: "d", text: "Yes, but it archives the pending request's history" }
    ],
    answer: "a",
    explanation:
      "Reverting to Draft is normally available, but a pending approval request narrows it to the requester and designated approvers — otherwise anyone could quietly change what an approver is about to sign off on.",
    docsUrl: QDOC
  },
  {
    slug: "quality.documents.11",
    unitSlug: "quality-documents",
    topic: "documents",
    bloom: "apply",
    kind: "multi",
    prompt:
      "Which constraints does Carbon enforce when you save a quality document step? (Select all that apply.)",
    options: [
      { id: "a", text: "A Measurement step must name a unit of measure" },
      { id: "b", text: "A List step must supply at least one option" },
      {
        id: "c",
        text: "When both are set, a Measurement step's maximum must be greater than or equal to its minimum"
      },
      { id: "d", text: "A File step must declare which file types it accepts" },
      { id: "e", text: "A Task step must capture a value" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "These three are the type-specific rules the step validator enforces. A File step's file-type restriction is optional, and a Task step is precisely the type that captures nothing beyond done/not-done.",
    docsUrl: QDOC
  },
  {
    slug: "quality.documents.12",
    unitSlug: "quality-documents",
    topic: "documents",
    bloom: "remember",
    kind: "single",
    prompt:
      "Saving a Measurement step fails with 'Maximum value must be greater than or equal to minimum value'. What is wrong?",
    options: [
      { id: "a", text: "The min/max range is inverted — swap the two values" },
      { id: "b", text: "The step is missing its unit of measure" },
      { id: "c", text: "A Measurement step cannot have a range at all" },
      { id: "d", text: "The maximum must be strictly greater than the minimum" }
    ],
    answer: "a",
    explanation:
      "The bound is greater-than-or-equal, so an equal min and max is legal (a single target value). The error means the maximum was entered below the minimum.",
    docsUrl: QDOC
  },
  {
    slug: "quality.documents.13",
    unitSlug: "quality-documents",
    topic: "documents",
    bloom: "analyze",
    kind: "single",
    prompt:
      "An engineer wants the steps of a controlled SOP to appear on a job's operation. What are they actually asking for?",
    options: [
      {
        id: "a",
        text: "A procedure — the versioned work instruction copied onto a job's operation. It shares the step model but lives in the production method, not the quality library"
      },
      { id: "b", text: "An inspection document — the ballooned drawing" },
      { id: "c", text: "A quality document with its 'process' field set" },
      { id: "d", text: "A required action on an issue workflow" }
    ],
    answer: "a",
    explanation:
      "The three neighbours are easy to conflate. A quality document is a standalone controlled record; a procedure gives a job operation its steps and run parameters; an inspection document is a ballooned drawing with its own tables.",
    docsUrl: QDOC
  },
  {
    slug: "quality.documents.14",
    unitSlug: "quality-documents",
    topic: "documents",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You want the 'Incoming Inspection Procedure' quality document to fire automatically whenever a receipt is inspected. What does Carbon support?",
    options: [
      {
        id: "a",
        text: "Nothing — a quality document is a standalone controlled record with no link on it to a process, item, or inspection"
      },
      { id: "b", text: "Set the document's item field to the received part" },
      { id: "c", text: "Attach it to the item's sampling plan" },
      { id: "d", text: "Add it as a required action on the auto-created NCR" }
    ],
    answer: "a",
    explanation:
      "Quality documents are deliberately standalone. What an inbound inspection actually runs against is the item's inspection document and its sampling plan — expecting the SOP to be wired in is the most common mismodelling here.",
    docsUrl: QDOC
  },
  {
    slug: "quality.documents.15",
    unitSlug: "quality-documents",
    topic: "documents",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You publish V2 of a procedure while three jobs are mid-build against V1. What are those jobs built to?",
    options: [
      {
        id: "a",
        text: "V1 — in-flight jobs never shift mid-build, and each unit's record pins the revision it was actually built to; only new jobs pick up V2"
      },
      { id: "b", text: "V2, from the next operation onward" },
      { id: "c", text: "V2, retroactively for the whole job" },
      {
        id: "d",
        text: "Neither; the jobs are blocked until an engineer re-releases them"
      }
    ],
    answer: "a",
    explanation:
      "Publishing a revision changes the floor going forward without rewriting work in progress. Because each unit's record pins the exact revision it was built to, the as-built history stays true even after the procedure moves on.",
    docsUrl: G_SHIP
  },

  // --------------------------------------------------------------- risk (15)
  {
    slug: "quality.risk.01",
    unitSlug: "risk",
    topic: "risk",
    bloom: "remember",
    kind: "single",
    prompt: "What are the five statuses of a risk register entry?",
    options: [
      { id: "a", text: "Open, In Review, Mitigating, Closed, Accepted" },
      { id: "b", text: "Open, Assigned, In Progress, Completed, Cancelled" },
      {
        id: "c",
        text: "Registered, In Progress, Mitigating, Closed, Accepted"
      },
      { id: "d", text: "Draft, Open, Mitigating, Archived, Accepted" }
    ],
    answer: "a",
    explanation:
      "Open is the default for a new entry, In Review and Mitigating are the working states, and an entry lands on Closed (treated) or Accepted (deliberately tolerated).",
    docsUrl: RISK
  },
  {
    slug: "quality.risk.02",
    unitSlug: "risk",
    topic: "risk",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A user sets a risk straight from Open to Accepted, skipping In Review and Mitigating. Carbon allows it. Why?",
    options: [
      {
        id: "a",
        text: "Risk status is a free-set enum, not a state machine — any value can be set from any other and nothing enforces an order"
      },
      { id: "b", text: "Accepted is the only status reachable from any other" },
      {
        id: "c",
        text: "Because the entry had no assignee, which relaxes the workflow"
      },
      { id: "d", text: "It is a bug; the transition should have been refused" }
    ],
    answer: "a",
    explanation:
      "Unlike an issue, the register enforces no transitions — deciding to simply live with a newly raised risk is a legitimate outcome. If a status 'is not sticking', that is a save or permission failure, never a workflow rule.",
    docsUrl: RISK
  },
  {
    slug: "quality.risk.03",
    unitSlug: "risk",
    topic: "risk",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A manager asks you to sort the risk register by risk score, severity times likelihood. What do you tell them?",
    options: [
      {
        id: "a",
        text: "There is no such number — severity and likelihood are two independent 1–5 integers and Carbon never multiplies them into a score or a matrix cell"
      },
      { id: "b", text: "The score is on the row but hidden by default" },
      { id: "c", text: "The score is computed in the riskRegisters view only" },
      {
        id: "d",
        text: "Sort by severity; likelihood is only shown on the entity card"
      }
    ],
    answer: "a",
    explanation:
      "There is deliberately no combined score and no `score` column. The UI shows the two ratings side by side so a rare-but-catastrophic risk and a frequent nuisance read honestly instead of collapsing to the same middle number — you decide how to weigh them.",
    docsUrl: RISK
  },
  {
    slug: "quality.risk.04",
    unitSlug: "risk",
    topic: "risk",
    bloom: "remember",
    kind: "single",
    prompt: "How are severity and likelihood rated on a risk entry?",
    options: [
      {
        id: "a",
        text: "Two independent integers from 1 to 5, each enforced by a database CHECK constraint"
      },
      { id: "b", text: "A single 1–25 score derived from a matrix" },
      { id: "c", text: "Three bands: Low, Medium, High" },
      { id: "d", text: "A percentage from 0 to 100" }
    ],
    answer: "a",
    explanation:
      "Both are required and constrained to 1 through 5 inclusive at the database level. A value outside that range, or a non-integer, is refused.",
    docsUrl: RISK
  },
  {
    slug: "quality.risk.05",
    unitSlug: "risk",
    topic: "risk",
    bloom: "remember",
    kind: "single",
    prompt: "What does the `type` field on a risk entry hold?",
    options: [
      {
        id: "a",
        text: "Risk or Opportunity — the register tracks upside as well as downside"
      },
      { id: "b", text: "Internal or External, like an issue's source" },
      { id: "c", text: "A configurable category you define per company" },
      { id: "d", text: "Strategic, Operational, or Financial" }
    ],
    answer: "a",
    explanation:
      "Type is required and defaults to Risk. An Opportunity is the same record shape pointed the other way — something worth pursuing rather than something to treat.",
    docsUrl: RISK
  },
  {
    slug: "quality.risk.06",
    unitSlug: "risk",
    topic: "risk",
    bloom: "apply",
    kind: "single",
    prompt:
      "You add a risk from a supplier's Risks tab. What is its `source`, and who set it?",
    options: [
      {
        id: "a",
        text: "Supplier, set automatically — the entity page mounts the shared card with a fixed source so new entries inherit it"
      },
      {
        id: "b",
        text: "General, until you pick Supplier from the source field"
      },
      { id: "c", text: "Supplier, but only if the supplier has an open issue" },
      { id: "d", text: "It has no source; source only applies to items" }
    ],
    answer: "a",
    explanation:
      "Source is required and names the kind of entity the risk is tied to — Customer, General, Item, Job, Quote Line, Supplier, or Work Center. Each entity page passes the fixed source and record id, so the card shows only that entity's risks. A standalone risk raised from Quality → Risks is General.",
    docsUrl: RISK
  },
  {
    slug: "quality.risk.07",
    unitSlug: "risk",
    topic: "risk",
    bloom: "apply",
    kind: "single",
    prompt:
      "You want to raise a risk against a work centre and cannot find a Risks card on its page. How do you create it?",
    options: [
      {
        id: "a",
        text: "From the company-wide list at Quality → Risks — Work Center is a valid source with no dedicated card"
      },
      { id: "b", text: "You cannot; Work Center is not a valid source" },
      {
        id: "c",
        text: "From the maintenance dispatch page for that work centre"
      },
      {
        id: "d",
        text: "By raising it as General and editing the source afterwards"
      }
    ],
    answer: "a",
    explanation:
      "Work Center is one of the seven sources but is the one without a wired entity card. Those entries are created from the company-wide list and joined into the `riskRegisters` view, which brings the work centre's name onto the row for display.",
    docsUrl: RISK
  },
  {
    slug: "quality.risk.08",
    unitSlug: "risk",
    topic: "risk",
    bloom: "apply",
    kind: "multi",
    prompt:
      "An operator can raise a risk but gets an error trying to edit one. Which statements about risk-register permissions are true? (Select all that apply.)",
    options: [
      {
        id: "a",
        text: "Creating a risk requires only that you are an employee of the company"
      },
      {
        id: "b",
        text: "Editing a risk requires the quality update permission"
      },
      {
        id: "c",
        text: "Deleting a risk requires the quality delete permission"
      },
      {
        id: "d",
        text: "Creating a risk requires the quality create permission"
      },
      {
        id: "e",
        text: "Row-level security is bypassed for the risk register, so route gates are the only check"
      }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "The split is deliberate: anyone on the floor can raise a concern, but changing or removing one is restricted. Both restrictions are enforced again at the database by row-level security, not just at the route.",
    docsUrl: RISK
  },
  {
    slug: "quality.risk.09",
    unitSlug: "risk",
    topic: "risk",
    bloom: "apply",
    kind: "single",
    prompt:
      "You re-save a risk entry after fixing a typo in its description, leaving the assignee alone. Does the assignee get pinged?",
    options: [
      {
        id: "a",
        text: "No — on edit Carbon only fires a RiskAssignment notification when the assignee actually changed"
      },
      { id: "b", text: "Yes — every save notifies the assignee" },
      { id: "c", text: "Yes, but only if the status also changed" },
      { id: "d", text: "No — assignment notifications only fire on create" }
    ],
    answer: "a",
    explanation:
      "Setting or changing an assignee fires a RiskAssignment notification through a background job, and the edit path compares before notifying so re-saving does not re-ping the same owner. An entry left blank defaults its assignee to whoever created it.",
    docsUrl: RISK
  },
  {
    slug: "quality.risk.10",
    unitSlug: "risk",
    topic: "risk",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A supplier shipped a bad lot last week, and you also think their financial position makes future failures likely. Which records do you create?",
    options: [
      {
        id: "a",
        text: "An issue for the bad lot that already happened, and a risk register entry for the failure that might happen"
      },
      { id: "b", text: "One issue; the risk is derived from it automatically" },
      {
        id: "c",
        text: "One risk entry, which spawns the issue when it is mitigated"
      },
      {
        id: "d",
        text: "An issue only — the risk register does not accept Supplier as a source"
      }
    ],
    answer: "a",
    explanation:
      "They are complementary and not linked in code: an issue records a defect that already happened and drives it to closure through workflow tasks; a risk entry is forward-looking, so you can weigh and treat something before it happens.",
    docsUrl: RISK
  },
  {
    slug: "quality.risk.11",
    unitSlug: "risk",
    topic: "risk",
    bloom: "analyze",
    kind: "single",
    prompt:
      "An issue raised against an item is closed with a Scrap disposition. What happens to that item's open risk entries?",
    options: [
      {
        id: "a",
        text: "Nothing — the risk register is its own table and is not linked to non-conformances or their corrective actions in code"
      },
      { id: "b", text: "They close along with the issue" },
      { id: "c", text: "They move to Mitigating automatically" },
      { id: "d", text: "A new risk is opened citing the closed issue" }
    ],
    answer: "a",
    explanation:
      "A risk does not spawn an issue and closing an issue does not touch a risk. Keeping the proactive register independent of the reactive record means neither silently rewrites the other's history.",
    docsUrl: RISK
  },
  {
    slug: "quality.risk.12",
    unitSlug: "risk",
    topic: "risk",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Risk A is severity 5, likelihood 1. Risk B is severity 1, likelihood 5. How does the register present them?",
    options: [
      {
        id: "a",
        text: "As two clearly different entries — the ratings are shown side by side as colored bars rather than collapsed into one number"
      },
      { id: "b", text: "Identically, since both would score 5" },
      {
        id: "c",
        text: "Risk A is auto-escalated because severity outranks likelihood"
      },
      {
        id: "d",
        text: "Risk B is filtered out of the default list as low severity"
      }
    ],
    answer: "a",
    explanation:
      "This is exactly why there is no combined score. A rare but catastrophic failure and a frequent nuisance are different problems needing different responses, and multiplying them would hide that.",
    docsUrl: RISK
  },
  {
    slug: "quality.risk.13",
    unitSlug: "risk",
    topic: "risk",
    bloom: "apply",
    kind: "single",
    prompt:
      "A work centre's name appears on rows in the company-wide risk list but not on the per-entity risk cards. Why?",
    options: [
      {
        id: "a",
        text: "The list reads the `riskRegisters` view, which joins the work centre name on; the cards and the edit page read the base `riskRegister` table"
      },
      { id: "b", text: "The cards drop the name to save space" },
      {
        id: "c",
        text: "Only risks with source General carry a work centre name"
      },
      { id: "d", text: "The name is only populated once the risk is Closed" }
    ],
    answer: "a",
    explanation:
      "Same data, two read paths. The company-wide list goes through the view; the entity cards and the single-record edit page query the base table filtered by source and entity id.",
    docsUrl: RISK
  },
  {
    slug: "quality.risk.14",
    unitSlug: "risk",
    topic: "risk",
    bloom: "remember",
    kind: "single",
    prompt: "Which fields must a risk entry have before it will save?",
    options: [
      { id: "a", text: "Title, severity, and likelihood" },
      { id: "b", text: "Title, assignee, and description" },
      { id: "c", text: "Title, notes, and a linked entity" },
      { id: "d", text: "Severity, likelihood, and a due date" }
    ],
    answer: "a",
    explanation:
      "The validator requires a title, a severity, and a likelihood. Type, status, and source are also required but carry defaults (Risk, Open, and the entity you raised it from); the assignee falls back to the creator and description and notes are optional.",
    docsUrl: RISK
  },
  {
    slug: "quality.risk.15",
    unitSlug: "risk",
    topic: "risk",
    bloom: "apply",
    kind: "single",
    prompt:
      "A team decides a supply risk is not worth treating and they will live with it. Which status records that, and how is the treatment itself tracked?",
    options: [
      {
        id: "a",
        text: "Accepted — and treatment is tracked by moving the status through In Review and Mitigating with detail in the notes, since there is no separate mitigation-action entity"
      },
      { id: "b", text: "Closed — Accepted is only for opportunities" },
      { id: "c", text: "Mitigating, with a mitigation action record attached" },
      { id: "d", text: "Open with severity lowered to 1" }
    ],
    answer: "a",
    explanation:
      "Accepted is the deliberate decision to tolerate a risk as-is, an off-path resolution distinct from Closed (mitigated away or no longer applies). There is no mitigation-action table — the status plus the notes field is the whole treatment record.",
    docsUrl: RISK
  }
];
