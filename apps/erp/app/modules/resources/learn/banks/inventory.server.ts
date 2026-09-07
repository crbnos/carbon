/**
 * Inventory — question bank. SERVER ONLY.
 *
 * The questions lean on the rules the docs flag as counterintuitive, because
 * those are the ones stores gets wrong on the floor: on hand is a ledger and it
 * can go negative, a pick moves stock without consuming it, moving between bins
 * posts no journal, a count reconciles against a frozen snapshot rather than
 * live on hand, and the number on a lot is an attribute of a tracked entity —
 * which is the only thing an expiry date can be stamped on.
 */

import type { LearnQuestion } from "../types";

const D = "https://docs.carbon.ms";
const INV = `${D}/docs/reference/inventory`;
const RULES = `${D}/docs/reference/storage-rules`;
const PICK = `${D}/docs/reference/picking`;
const SCRAP = `${D}/docs/reference/scrap`;
const COUNT = `${D}/docs/reference/inventory-count`;
const TRACE = `${D}/docs/reference/traceability`;
const SHELF = `${D}/docs/reference/shelf-life`;

export const questions: LearnQuestion[] = [
  // ------------------------------------------------- stock-and-storage (11)
  {
    slug: "inventory.stock.01",
    unitSlug: "stock-and-storage",
    topic: "stock",
    bloom: "remember",
    kind: "single",
    prompt:
      "A storage unit is attached to a work center so material can be staged at the point of use. What does Carbon call that bin?",
    options: [
      { id: "a", text: "A lineside bin" },
      { id: "b", text: "A warehouse bin" },
      { id: "c", text: "A quarantine bin" },
      { id: "d", text: "A transit bin" }
    ],
    answer: "a",
    explanation:
      "A storage unit attached to a work center is a lineside bin — the staging point production draws from. Every other storage unit is a warehouse bin.",
    docsUrl: `${INV}#locations-and-storage-units`
  },
  {
    slug: "inventory.stock.02",
    unitSlug: "stock-and-storage",
    topic: "stock",
    bloom: "apply",
    kind: "single",
    prompt:
      "A report built from the item ledger shows 40 on hand, but the cached per-location quantity says 42. Which figure is authoritative, and why?",
    options: [
      { id: "a", text: "The cached quantity, because it is written last" },
      {
        id: "b",
        text: "The ledger sum, because on hand is derived from signed movements and the cache exists only for quick reads"
      },
      { id: "c", text: "Whichever is higher, to avoid understating stock" },
      { id: "d", text: "Neither — on hand is an editable field on the item" }
    ],
    answer: "b",
    explanation:
      "On hand is the sum of the item ledger's signed movements. The cached per-location quantity is a convenience for fast reads; the ledger is the source of truth and it is status-aware, so it can separate stock on hold or rejected from what is genuinely available.",
    docsUrl: `${INV}#on-hand-is-a-ledger`
  },
  {
    slug: "inventory.stock.03",
    unitSlug: "stock-and-storage",
    topic: "stock",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A bin shows −3 on hand for a part. Which explanation is consistent with how Carbon posts movements?",
    options: [
      {
        id: "a",
        text: "It is impossible — Carbon blocks any movement that would overdraw a bin"
      },
      {
        id: "b",
        text: "A shipment, a job issue, or a pick posted without checking availability first"
      },
      { id: "c", text: "Someone edited the ledger row by hand" },
      {
        id: "d",
        text: "A manual negative adjustment was allowed to overdraw the bin"
      }
    ],
    answer: "b",
    explanation:
      "Shipping, issuing to a job, and picking all post their movements without first checking availability — Carbon would rather let the work proceed and reconcile later than block the floor. The manual negative adjustment is the one movement guarded against overdraw, and the ledger is append-only, so a hand edit is not a possible cause.",
    docsUrl: `${INV}#on-hand-is-a-ledger`
  },
  {
    slug: "inventory.stock.04",
    unitSlug: "stock-and-storage",
    topic: "stock",
    bloom: "remember",
    kind: "single",
    prompt: "How are storage units organised within a location?",
    options: [
      {
        id: "a",
        text: "They nest (aisle › shelf › bin) and can be typed, e.g. cold, hazardous, returns"
      },
      { id: "b", text: "They are a flat list of bins with no hierarchy" },
      { id: "c", text: "One storage unit per item, created on first receipt" },
      { id: "d", text: "They belong to the company rather than to a location" }
    ],
    answer: "a",
    explanation:
      "Storage units nest into a hierarchy and carry a type, which is what lets a storage rule test something like 'this item must sit in a cold-storage bin'. Parent and child must share a location.",
    docsUrl: `${INV}#locations-and-storage-units`
  },
  {
    slug: "inventory.stock.05",
    unitSlug: "stock-and-storage",
    topic: "stock",
    bloom: "apply",
    kind: "multi",
    prompt:
      "Which item-ledger entry types increase the quantity on hand? (Choose two.)",
    options: [
      { id: "a", text: "Purchase" },
      { id: "b", text: "Assembly Output" },
      { id: "c", text: "Consumption" },
      { id: "d", text: "Sale" }
    ],
    answer: ["a", "b"],
    explanation:
      "Receipts and production output add to stock (Purchase, Output, Assembly Output). Sales and consumption subtract (Sale, Consumption, Assembly Consumption). Transfers move stock without changing the total, and adjustments correct it in either direction.",
    docsUrl: `${INV}#on-hand-is-a-ledger`
  },
  {
    slug: "inventory.stock.06",
    unitSlug: "stock-and-storage",
    topic: "stock",
    bloom: "apply",
    kind: "single",
    prompt:
      "Stores move 200 units from bin A-01 to bin A-07 inside the same location, and the company has accounting enabled. What journal posts?",
    options: [
      {
        id: "a",
        text: "A debit to the inventory adjustment account and a credit to inventory"
      },
      {
        id: "b",
        text: "None — the value never left the location, so a storage-unit move posts no journal"
      },
      { id: "c", text: "A transfer journal between two inventory accounts" },
      { id: "d", text: "A debit to work-in-process and a credit to inventory" }
    ],
    answer: "b",
    explanation:
      "Journals accompany movements that change how much inventory the company owns — adjustments, count variances, scrap. Moving stock between storage units changes only where it sits, so there is nothing to post.",
    docsUrl: `${INV}#movements`
  },
  {
    slug: "inventory.stock.07",
    unitSlug: "stock-and-storage",
    topic: "stock",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Stock needs to move from the Dallas warehouse to the Austin warehouse. What does Carbon actually execute?",
    options: [
      { id: "a", text: "A stock transfer between the two storage units" },
      {
        id: "b",
        text: "A warehouse transfer, carried out as a shipment out of Dallas and a receipt into Austin"
      },
      {
        id: "c",
        text: "A negative adjustment in Dallas and a positive adjustment in Austin"
      },
      { id: "d", text: "A single Transfer entry with no documents behind it" }
    ],
    answer: "b",
    explanation:
      "A warehouse transfer crosses locations and is executed as real documents — a shipment out and a receipt in — so the stock in transit is accounted for. A stock transfer is the within-one-location version that just moves between storage units.",
    docsUrl: `${INV}#movements`
  },
  {
    slug: "inventory.stock.08",
    unitSlug: "stock-and-storage",
    topic: "stock",
    bloom: "apply",
    kind: "single",
    prompt:
      "A storage rule with severity `error` fires as a receipt posts. What has been written to the database at that point?",
    options: [
      { id: "a", text: "The stock movement, but no journal" },
      {
        id: "b",
        text: "Nothing — a blocked transaction writes nothing at all"
      },
      { id: "c", text: "The journal, but no stock movement" },
      { id: "d", text: "The receipt header, with the lines rolled back" }
    ],
    answer: "b",
    explanation:
      "Rules are evaluated server-side as the transaction posts, before any accounting or stock movement is written, so a block leaves no partial trace to clean up.",
    docsUrl: `${RULES}#where-rules-fire`
  },
  {
    slug: "inventory.stock.09",
    unitSlug: "stock-and-storage",
    topic: "stock",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A `warn`-severity storage rule fires on a large inventory adjustment. What does the user experience?",
    options: [
      {
        id: "a",
        text: "The adjustment posts silently and the message is logged"
      },
      {
        id: "b",
        text: "The message is shown and the submit is held until the user acknowledges it, then the same submit goes through"
      },
      {
        id: "c",
        text: "The adjustment is rejected until the condition is met"
      },
      { id: "d", text: "The message is shown only to administrators" }
    ],
    answer: "b",
    explanation:
      "A warn is an 'are you sure?' guardrail: it blocks only until the person acknowledges it, then lets the same submit through. An error is the one that blocks until the condition itself is satisfied.",
    docsUrl: `${RULES}#block-or-warn`
  },
  {
    slug: "inventory.stock.10",
    unitSlug: "stock-and-storage",
    topic: "stock",
    bloom: "apply",
    kind: "single",
    prompt:
      "A storage rule tests a field, and on this particular line that field has no value at all. What does Carbon do?",
    options: [
      {
        id: "a",
        text: "Skips the condition — an empty field cannot be compared"
      },
      {
        id: "b",
        text: "Reports a violation ending '…is required', which is how rules double as presence checks"
      },
      { id: "c", text: "Passes the rule, because absent is not 'not equal'" },
      {
        id: "d",
        text: "Blocks every line for that item type until the field is filled"
      }
    ],
    answer: "b",
    explanation:
      "Aside from `isSet` and `isNotSet`, a condition pointing at a field with no value fails as a '…is required' violation. That is exactly what lets one rule demand a lot number before a shipment can post.",
    docsUrl: `${RULES}#what-a-rule-checks`
  },
  {
    slug: "inventory.stock.11",
    unitSlug: "stock-and-storage",
    topic: "stock",
    bloom: "apply",
    kind: "single",
    prompt:
      "A colleague wants a storage rule that automatically puts received chemicals into the cold-storage bin. Can a rule do that?",
    options: [
      { id: "a", text: "Yes — set the destination field in the rule's action" },
      {
        id: "b",
        text: "No — a rule is a validation layer, and its only output is a message and a severity"
      },
      { id: "c", text: "Yes, but only on the receipt and place surfaces" },
      { id: "d", text: "Yes, if the severity is set to `warn`" }
    ],
    answer: "b",
    explanation:
      "Storage rules never transform data, set defaults, or compute anything. The closest they get is stopping the wrong put-away with a message that names the offending line.",
    docsUrl: `${RULES}#what-a-rule-checks`
  },

  // -------------------------------------------------------- picking (10)
  {
    slug: "inventory.stock.12",
    unitSlug: "picking",
    topic: "stock",
    bloom: "remember",
    kind: "single",
    prompt: "What does posting a pick do to the quantity on hand?",
    options: [
      { id: "a", text: "Reduces it — the material is consumed by the job" },
      {
        id: "b",
        text: "Leaves the total unchanged: a negative at the warehouse source bin and an equal positive at the lineside bin"
      },
      { id: "c", text: "Reserves it, with no ledger entry written" },
      { id: "d", text: "Reduces it and posts a work-in-process journal" }
    ],
    answer: "b",
    explanation:
      "A pick is a transfer, never a consumption. The two balanced ledger entries relocate stock to the point of use; on hand only drops when production actually issues or backflushes it.",
    docsUrl: `${PICK}#what-posting-a-pick-does-to-stock`
  },
  {
    slug: "inventory.stock.13",
    unitSlug: "picking",
    topic: "stock",
    bloom: "apply",
    kind: "single",
    prompt:
      "A shipping clerk asks you to generate a picking list to pull a sales order. What does Carbon offer?",
    options: [
      { id: "a", text: "A list generated from the sales order lines" },
      {
        id: "b",
        text: "Nothing — picking is driven by production, from job operations with unstaged material"
      },
      { id: "c", text: "A list, but only for stocked item types" },
      { id: "d", text: "A list generated from the shipment once it exists" }
    ],
    answer: "b",
    explanation:
      "Picking stages raw and component material into a job; every line ties back to a job, a job material, and usually a job operation. Getting finished goods out to a customer is the shipment's job, and it is a separate document.",
    docsUrl: `${PICK}#what-a-picking-list-picks-against`
  },
  {
    slug: "inventory.stock.14",
    unitSlug: "picking",
    topic: "stock",
    bloom: "analyze",
    kind: "single",
    prompt:
      "An operation's material is missing from a freshly generated picking list, even though the job material record points at the warehouse. What is the most likely reason?",
    options: [
      { id: "a", text: "The operation is on a cancelled picking list" },
      {
        id: "b",
        text: "The operation's own lineside bin already holds enough on hand to cover the issue quantity"
      },
      {
        id: "c",
        text: "The material is untracked, so it is backflushed instead"
      },
      { id: "d", text: "The job has not been released yet" }
    ],
    answer: "b",
    explanation:
      "Carbon tests the actual on hand at the operation's lineside bin, not where the job material record happens to point. Material already line-stocked at the work center is staged, so there is nothing outstanding to pick. A cancelled list is the opposite case — it stops blocking re-generation.",
    docsUrl: `${PICK}#what-a-picking-list-picks-against`
  },
  {
    slug: "inventory.stock.15",
    unitSlug: "picking",
    topic: "stock",
    bloom: "apply",
    kind: "single",
    prompt:
      "One line is marked Short after pulling 6 of the 10 required. Every other line is Picked. What is the header status?",
    options: [
      { id: "a", text: "Completed — the shortage has been acknowledged" },
      {
        id: "b",
        text: "In Progress — a Short line that is not fully picked still counts as outstanding"
      },
      { id: "c", text: "Cancelled" },
      { id: "d", text: "Draft, until someone re-picks the short line" }
    ],
    answer: "b",
    explanation:
      "Short means a human acknowledged the shortage, not that the requirement is gone. The header stays In Progress and only closes through the explicit Complete action, so a shortage is always signed off by a person rather than finalized in the background.",
    docsUrl: `${PICK}#short-picks-dont-silently-close-the-list`
  },
  {
    slug: "inventory.stock.16",
    unitSlug: "picking",
    topic: "stock",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A list is stuck In Progress on one line the warehouse simply cannot fill, and the requirement has been dropped by planning. Which action makes the header stop counting that line as outstanding?",
    options: [
      { id: "a", text: "Mark the line Short" },
      { id: "b", text: "Cancel the line" },
      { id: "c", text: "Set the line back to Pending" },
      { id: "d", text: "Delete the picking list" }
    ],
    answer: "b",
    explanation:
      "A Cancelled line's requirement is gone, so it no longer holds the list open. A Short line is the opposite: it records a real, still-outstanding shortage. Delete is not available either — it needs a Draft list with no picked lines.",
    docsUrl: `${PICK}#short-picks-dont-silently-close-the-list`
  },
  {
    slug: "inventory.stock.17",
    unitSlug: "picking",
    topic: "stock",
    bloom: "apply",
    kind: "single",
    prompt:
      "An operator finishes a list at the station too early and needs to pick one more line. What does the MES tell them?",
    options: [
      { id: "a", text: "Tap Start again to move it back to In Progress" },
      {
        id: "b",
        text: "Reopen it from the ERP — reopening needs the inventory delete permission, so the floor cannot do it"
      },
      { id: "c", text: "Cancel the list and generate a replacement" },
      { id: "d", text: "The list is locked permanently; raise a new job" }
    ],
    answer: "b",
    explanation:
      "A Completed or Cancelled list locks against further picks and unpicks. Keeping reopen in the ERP behind the inventory delete permission is what stops a finalized pick being quietly reworked at the station.",
    docsUrl: `${PICK}#where-picking-happens`
  },
  {
    slug: "inventory.stock.18",
    unitSlug: "picking",
    topic: "stock",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Half of a batch-tracked lot is picked to lineside. Which two things happen on top of the ordinary transfer pair? (Choose two.)",
    options: [
      {
        id: "a",
        text: "The lot splits — the picked quantity moves to lineside and the remainder stays behind as a new lot"
      },
      {
        id: "b",
        text: "A tracked-entity movement is recorded for the exact lot"
      },
      { id: "c", text: "The whole lot moves and the excess is written off" },
      { id: "d", text: "The lot is flipped to Consumed" }
    ],
    answer: ["a", "b"],
    explanation:
      "Serial and batch picks record the tracked-entity movement as well as the ledger pair, which is what keeps the lot traceable end to end. Consumed would be wrong — a pick never consumes anything.",
    docsUrl: `${PICK}#what-posting-a-pick-does-to-stock`
  },
  {
    slug: "inventory.stock.19",
    unitSlug: "picking",
    topic: "stock",
    bloom: "remember",
    kind: "single",
    prompt: "What does an unpick do?",
    options: [
      { id: "a", text: "Consumes the material at the lineside bin" },
      {
        id: "b",
        text: "Reverses the transfer, restores the warehouse source as the consumption point, and returns the line to Pending"
      },
      { id: "c", text: "Cancels the line so it stops being outstanding" },
      { id: "d", text: "Deletes the two ledger entries the pick wrote" }
    ],
    answer: "b",
    explanation:
      "Unpick undoes all three effects of the pick — the stock movement, the job material's repointing at the lineside bin, and the line status. The ledger entries are never deleted; the reversal is itself a movement.",
    docsUrl: `${PICK}#what-posting-a-pick-does-to-stock`
  },
  {
    slug: "inventory.stock.20",
    unitSlug: "picking",
    topic: "stock",
    bloom: "apply",
    kind: "single",
    prompt:
      "A job completes with 30 units picked to the lineside bin that were never consumed. What happens to them?",
    options: [
      {
        id: "a",
        text: "They stay at the lineside bin until someone transfers them back"
      },
      {
        id: "b",
        text: "They are walked back to the warehouse automatically at job complete"
      },
      { id: "c", text: "They are scrapped against the job" },
      { id: "d", text: "They are consumed so the job material closes cleanly" }
    ],
    answer: "b",
    explanation:
      "Picked-but-unconsumed remainder is returned from the lineside bin to the warehouse when the job completes, so staged stock is never stranded at the line where nobody is looking for it.",
    docsUrl: `${PICK}#what-posting-a-pick-does-to-stock`
  },
  {
    slug: "inventory.stock.21",
    unitSlug: "picking",
    topic: "stock",
    bloom: "remember",
    kind: "single",
    prompt: "Who sets a picking list's header status?",
    options: [
      { id: "a", text: "The picker, from a dropdown on the header" },
      {
        id: "b",
        text: "A database trigger derives it from the lines, and it never overrides a Cancelled header"
      },
      { id: "c", text: "The scheduler, when the operation is sequenced" },
      { id: "d", text: "It is fixed at generation and never changes" }
    ],
    answer: "b",
    explanation:
      "Because the header is derived from the lines, it recomputes as lines are picked and unpicked — and it only reaches Completed once no line is still outstanding. Cancelled is the one state the trigger will not overwrite.",
    docsUrl: `${PICK}#header-and-line-status`
  },

  // ---------------------------------------------- adjustments-and-scrap (18)
  {
    slug: "inventory.movement.01",
    unitSlug: "adjustments-and-scrap",
    topic: "movement",
    bloom: "remember",
    kind: "single",
    prompt:
      "Which item-ledger entry types does a manual inventory adjustment write?",
    options: [
      { id: "a", text: "Positive Adjmt. or Negative Adjmt." },
      { id: "b", text: "Transfer" },
      { id: "c", text: "Consumption" },
      { id: "d", text: "Purchase" }
    ],
    answer: "a",
    explanation:
      "Manual corrections are their own pair of entry types, which is what keeps them separable from real purchases, sales, and transfers when you read the ledger back.",
    docsUrl: `${INV}#on-hand-is-a-ledger`
  },
  {
    slug: "inventory.movement.02",
    unitSlug: "adjustments-and-scrap",
    topic: "movement",
    bloom: "apply",
    kind: "single",
    prompt:
      "With accounting enabled, a negative adjustment writes off 5 units. Which journal posts?",
    options: [
      {
        id: "a",
        text: "Debit inventory, credit the inventory adjustment account"
      },
      {
        id: "b",
        text: "Debit the inventory adjustment account, credit inventory, valued at the item's current cost"
      },
      { id: "c", text: "Debit work-in-process, credit inventory" },
      { id: "d", text: "None — adjustments only move quantity" }
    ],
    answer: "b",
    explanation:
      "A loss debits the inventory adjustment account and credits inventory; a gain is the mirror image. Either way the value comes from the item's current cost, not from anything typed on the adjustment.",
    docsUrl: `${INV}#movements`
  },
  {
    slug: "inventory.movement.03",
    unitSlug: "adjustments-and-scrap",
    topic: "movement",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A negative adjustment of 40 fails with 'Insufficient quantity for negative adjustment', yet a shipment of 40 from the same bin would have posted. Why the difference?",
    options: [
      { id: "a", text: "Shipments are evaluated before storage rules run" },
      {
        id: "b",
        text: "Manual adjustments are the one movement guarded against overdraw; shipping, issuing, and picking post without checking availability"
      },
      { id: "c", text: "The shipment reserves the stock before it posts" },
      {
        id: "d",
        text: "The bin is lineside, and lineside bins allow negative on hand"
      }
    ],
    answer: "b",
    explanation:
      "Carbon deliberately lets real work proceed into a negative balance and reconcile later. A manual adjustment is not real work — it is somebody asserting a number — so it is the one place the overdraw check is applied.",
    docsUrl: `${INV}#on-hand-is-a-ledger`
  },
  {
    slug: "inventory.movement.04",
    unitSlug: "adjustments-and-scrap",
    topic: "movement",
    bloom: "apply",
    kind: "single",
    prompt:
      "A negative adjustment on a batch item returns 'Multiple tracked entities in this storage unit — select a specific row to adjust'. What resolves it?",
    options: [
      { id: "a", text: "Split the adjustment across several bins" },
      {
        id: "b",
        text: "Select the specific tracked-entity row, or enter its number, so Carbon knows which lot to reduce"
      },
      { id: "c", text: "Change the item to untracked and adjust again" },
      { id: "d", text: "Use a Set Quantity adjustment instead" }
    ],
    answer: "b",
    explanation:
      "Several lots of the same item can sit in one bin, so 'take 5 out of this bin' is ambiguous for a tracked item. Naming the lot is what makes the movement traceable afterwards.",
    docsUrl: `${INV}#movements`
  },
  {
    slug: "inventory.movement.05",
    unitSlug: "adjustments-and-scrap",
    topic: "movement",
    bloom: "apply",
    kind: "single",
    prompt:
      "A storekeeper is certain the shelf holds exactly 12, but has no idea what the system thinks. Which adjustment fits?",
    options: [
      { id: "a", text: "A positive adjustment of 12" },
      { id: "b", text: "A Set Quantity adjustment targeting 12" },
      { id: "c", text: "A negative adjustment of 12" },
      { id: "d", text: "A stock transfer of 12 into the bin" }
    ],
    answer: "b",
    explanation:
      "A manual adjustment can post a signed delta or a Set Quantity target. The target books whatever difference is needed to land on the number you entered, so you never have to compute the delta yourself.",
    docsUrl: `${INV}#movements`
  },
  {
    slug: "inventory.movement.06",
    unitSlug: "adjustments-and-scrap",
    topic: "movement",
    bloom: "apply",
    kind: "single",
    prompt:
      "A posted stock movement recorded 500 where it should have been 450. How do you fix it?",
    options: [
      { id: "a", text: "Edit the ledger entry to 450" },
      { id: "b", text: "Delete it and re-post the document" },
      {
        id: "c",
        text: "Use Correct Quantity on the movement and enter 450; Carbon books one opposite movement for the difference"
      },
      { id: "d", text: "Post a fresh negative adjustment of 50 dated today" }
    ],
    answer: "c",
    explanation:
      "The ledger is append-only, so a posted movement is never edited or deleted. The correction is its own row, badged as a Correction, linked to the original and dated with the original's posting date so both land in the right period — which a fresh adjustment dated today would not.",
    docsUrl: `${INV}#correcting-a-movement`
  },
  {
    slug: "inventory.movement.07",
    unitSlug: "adjustments-and-scrap",
    topic: "movement",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Correcting a movement returns 'The original movement's accounting period is closed — its movements can no longer be corrected.' What is the remedy?",
    options: [
      { id: "a", text: "Unlock the period and correct it again" },
      {
        id: "b",
        text: "There is none — closing is permanent, so the movement stays as posted"
      },
      { id: "c", text: "Re-date the correction into the current open period" },
      { id: "d", text: "Ask an administrator to delete the original movement" }
    ],
    answer: "b",
    explanation:
      "A correction posts its journal into the original movement's period, so it inherits that period's state. The locked variant of this message is the recoverable one — unlock and correct. Closed has no reopening.",
    docsUrl: `${INV}#correcting-a-movement`
  },
  {
    slug: "inventory.movement.08",
    unitSlug: "adjustments-and-scrap",
    topic: "movement",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A movement of 100 was corrected once to 90. Someone now corrects the same movement to 95. What does Carbon book?",
    options: [
      { id: "a", text: "An opposite movement of 5" },
      { id: "b", text: "An opposite movement of 95" },
      { id: "c", text: "A correction of −10, stacking on the first" },
      { id: "d", text: "Nothing — a movement can only be corrected once" }
    ],
    answer: "a",
    explanation:
      "A correction measures against what the movement currently nets to, not against the original figure. Since it already nets to 90, correcting to 95 books the +5 difference, and repeated corrections converge on the number you typed instead of stacking.",
    docsUrl: `${INV}#correcting-a-movement`
  },
  {
    slug: "inventory.movement.09",
    unitSlug: "adjustments-and-scrap",
    topic: "movement",
    bloom: "remember",
    kind: "single",
    prompt:
      "Scrapping warehouse stock is a negative adjustment with a reason. Where does its offset land?",
    options: [
      {
        id: "a",
        text: "The inventory adjustment account, like any other adjustment"
      },
      { id: "b", text: "The scrap account, instead of the adjustment account" },
      { id: "c", text: "Cost of goods sold" },
      { id: "d", text: "Work-in-process" }
    ],
    answer: "b",
    explanation:
      "The reason is what separates scrap from an ordinary correction, and the offset follows: scrap posts to the scrap account (which falls back to the inventory adjustment variance account if none is configured).",
    docsUrl: `${SCRAP}#accounting-for-scrap`
  },
  {
    slug: "inventory.movement.10",
    unitSlug: "adjustments-and-scrap",
    topic: "movement",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "With accounting enabled, which two scrap paths credit work-in-process rather than inventory? (Choose two.)",
    options: [
      { id: "a", text: "A unit scrapped on the floor at an operation" },
      {
        id: "b",
        text: "A Consumed subcomponent scrapped from the issue-material dialog"
      },
      { id: "c", text: "An Available subcomponent scrapped out of its bin" },
      {
        id: "d",
        text: "Warehouse stock scrapped from the storage-unit adjustment form"
      }
    ],
    answer: ["a", "b"],
    explanation:
      "Every scrap path debits the same scrap account; only the credit varies, and it follows where the value already was. Value issued into the job sits in WIP; value still sitting in a bin is inventory.",
    docsUrl: `${SCRAP}#accounting-for-scrap`
  },
  {
    slug: "inventory.movement.11",
    unitSlug: "adjustments-and-scrap",
    topic: "movement",
    bloom: "analyze",
    kind: "single",
    prompt:
      "The Scrap tab lists the same component twice: one row Available, one row Consumed. What differs when you scrap each?",
    options: [
      { id: "a", text: "Nothing — both relieve WIP at the unit cost" },
      {
        id: "b",
        text: "Available scraps out of its bin as a negative adjustment and leaves the issued quantity alone; Consumed relieves WIP and decrements the issued quantity so the requirement reopens"
      },
      { id: "c", text: "Only the Consumed row can be scrapped" },
      { id: "d", text: "The Available row always spawns a rework row" }
    ],
    answer: "b",
    explanation:
      "The entity's state decides the posting, not the item's method. That is why scrapping a Consumed part reopens the material requirement — the job still needs a part it no longer has — while scrapping an Available one simply removes stock.",
    docsUrl: `${SCRAP}#scrapping-a-subcomponent`
  },
  {
    slug: "inventory.movement.12",
    unitSlug: "adjustments-and-scrap",
    topic: "movement",
    bloom: "apply",
    kind: "single",
    prompt:
      "An operator logs scrap on a serial unit at an operation that had just been completed. What happens to that operation?",
    options: [
      {
        id: "a",
        text: "The scrap counts against the target and the operation stays Completed"
      },
      {
        id: "b",
        text: "The scrapped quantity never counts toward the target, the operation reopens to Ready, and a replacement serial is spawned"
      },
      { id: "c", text: "The job's planned quantity is rewritten downward" },
      { id: "d", text: "The operation is cancelled and a rework job is raised" }
    ],
    answer: "b",
    explanation:
      "A scrapped unit is not output, so the routing reopens and keeps producing until the good quantity meets the target. The planned quantity itself is never rewritten — Carbon only tops up the operation's run quantity once cumulative scrap runs past the allowance you planned for.",
    docsUrl: `${SCRAP}#scrapping-a-unit-on-the-floor`
  },
  {
    slug: "inventory.movement.13",
    unitSlug: "adjustments-and-scrap",
    topic: "movement",
    bloom: "remember",
    kind: "single",
    prompt: "What does Log Scrap on an operation require before it will post?",
    options: [
      { id: "a", text: "An open quality issue to attach it to" },
      { id: "b", text: "A quantity and a Scrap Reason" },
      { id: "c", text: "An inventory count covering the bin" },
      { id: "d", text: "A replacement job already created" }
    ],
    answer: "b",
    explanation:
      "The reason is mandatory on every scrap path. It is also what makes scrap reportable: each scrap journal line is tagged with the ScrapReason dimension, read live from your scrap-reason list.",
    docsUrl: `${SCRAP}#scrapping-a-unit-on-the-floor`
  },
  {
    slug: "inventory.movement.14",
    unitSlug: "adjustments-and-scrap",
    topic: "movement",
    bloom: "apply",
    kind: "single",
    prompt:
      "Half of a batch sitting in a warehouse bin is scrapped. What is the state of the lot afterwards?",
    options: [
      { id: "a", text: "The whole lot is flipped to Scrapped" },
      {
        id: "b",
        text: "The lot splits, and only the scrapped portion becomes Scrapped"
      },
      { id: "c", text: "The lot is flipped to Rejected" },
      { id: "d", text: "The lot is flipped to Consumed" }
    ],
    answer: "b",
    explanation:
      "Scrapping part of a batch splits the lot so the surviving portion stays Available and usable. A serial is different — it is a single unit, so it flips to Scrapped and keeps its quantity as the record of what was lost.",
    docsUrl: `${SCRAP}#scrapping-stock`
  },
  {
    slug: "inventory.movement.15",
    unitSlug: "adjustments-and-scrap",
    topic: "movement",
    bloom: "apply",
    kind: "single",
    prompt:
      "A tracked entity was scrapped last month at a cost of 12.40. It is unscrapped today, when the item's current cost is 15.00. At what cost does it come back?",
    options: [
      { id: "a", text: "15.00, the item's current cost" },
      {
        id: "b",
        text: "12.40, read back from the original scrap's cost layers"
      },
      { id: "c", text: "13.70, the average of the two" },
      { id: "d", text: "Zero — an unscrap restores quantity only" }
    ],
    answer: "b",
    explanation:
      "Unscrap reverses at the exact cost the entity was scrapped from, so a scrap-then-unscrap nets to nothing in the ledger. Untracked stock is the single exception: it has no entity to read a layer from, so it returns at current cost and needs a location.",
    docsUrl: `${SCRAP}#unscrap`
  },
  {
    slug: "inventory.movement.16",
    unitSlug: "adjustments-and-scrap",
    topic: "movement",
    bloom: "remember",
    kind: "single",
    prompt: "What does the Unscrap dialog ask you for?",
    options: [
      { id: "a", text: "A new scrap reason and an approving manager" },
      { id: "b", text: "Only an optional comment" },
      { id: "c", text: "A destination location for every entity" },
      { id: "d", text: "The original scrap's journal number" }
    ],
    answer: "b",
    explanation:
      "Carbon inherits the reason from the scrap movement it is reversing and links the restoring entry back to it, so there is nothing to re-enter. The entity returns to Available at the same bin it left.",
    docsUrl: `${SCRAP}#unscrap`
  },
  {
    slug: "inventory.movement.17",
    unitSlug: "adjustments-and-scrap",
    topic: "movement",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A quality issue is closed with a Scrap disposition. How does the result differ from scrapping the same part from the Scrap tab?",
    options: [
      {
        id: "a",
        text: "It does not — both end at Scrapped and both can be unscrapped"
      },
      {
        id: "b",
        text: "The disposition writes the material off to a cost-of-quality account and flips the entity to Rejected, which Unscrap cannot reverse"
      },
      { id: "c", text: "The disposition posts no journal at all" },
      { id: "d", text: "The disposition requires a scrap reason as well" }
    ],
    answer: "b",
    explanation:
      "The two look alike and are not: a quality disposition of Scrap ends at Rejected, a terminal status, and hits cost-of-quality rather than the scrap account. Only the Scrapped status is reversible.",
    docsUrl: `${SCRAP}#accounting-for-scrap`
  },
  {
    slug: "inventory.movement.18",
    unitSlug: "adjustments-and-scrap",
    topic: "movement",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Carbon posts all scrap to a single scrap account. Which dimensions does it tag on the journal line so you can still slice it in reporting? (Choose three.)",
    options: [
      { id: "a", text: "ScrapReason" },
      { id: "b", text: "WorkCenter" },
      { id: "c", text: "Employee" },
      { id: "d", text: "Item group" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Tagging beats proliferating accounts: one scrap account, sliced by reason, cell, and operator. WorkCenter is only present where there is an operation behind the scrap, so warehouse scrap carries reason and employee alone.",
    docsUrl: `${SCRAP}#accounting-for-scrap`
  },

  // ------------------------------------------------- inventory-counts (18)
  {
    slug: "inventory.counting.01",
    unitSlug: "inventory-counts",
    topic: "counting",
    bloom: "remember",
    kind: "single",
    prompt: "What is the status sequence of an inventory count?",
    options: [
      { id: "a", text: "Draft → Pending → Posted" },
      { id: "b", text: "Draft → Released → Closed" },
      { id: "c", text: "Open → Counted → Approved" },
      { id: "d", text: "Draft → Posted" }
    ],
    answer: "a",
    explanation:
      "Pending is the review step: counting is confirmed and the quantities are locked in, but nothing has hit the ledger yet. Posting is the pivotal transition and it is atomic, so a count is never left half-applied.",
    docsUrl: `${COUNT}#the-count-lifecycle`
  },
  {
    slug: "inventory.counting.02",
    unitSlug: "inventory-counts",
    topic: "counting",
    bloom: "apply",
    kind: "single",
    prompt:
      "A blind count is posted and the counted quantity is 3 below the frozen system figure. What does Carbon write?",
    options: [
      {
        id: "a",
        text: "A Negative Adjmt. of 3 on the item ledger, with document type Inventory Count"
      },
      { id: "b", text: "A Transfer of 3 out of the storage unit" },
      { id: "c", text: "It overwrites on hand with the counted number" },
      { id: "d", text: "A Consumption of 3 against the location" }
    ],
    answer: "a",
    explanation:
      "The variance is counted − systemQuantity, and it posts as a single adjustment per line: a shortfall as a Negative Adjmt., an overage as a Positive Adjmt. Nothing is ever overwritten — the count leaves a movement behind like everything else.",
    docsUrl: `${COUNT}#what-posting-does`
  },
  {
    slug: "inventory.counting.03",
    unitSlug: "inventory-counts",
    topic: "counting",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A counter finds an empty shelf and leaves the counted quantity blank. What happens at post?",
    options: [
      { id: "a", text: "The line is zeroed, as intended" },
      {
        id: "b",
        text: "The line is skipped as 'not counted' and that stock is left untouched"
      },
      { id: "c", text: "The post is blocked until every line has a number" },
      {
        id: "d",
        text: "A negative adjustment for the full system quantity posts"
      }
    ],
    answer: "b",
    explanation:
      "Blank and 0 mean different things: blank is 'I did not count this', and 0 is a real count that zeroes the line. Leaving an empty shelf blank silently preserves the phantom stock you were trying to remove.",
    docsUrl: `${COUNT}#counting`
  },
  {
    slug: "inventory.counting.04",
    unitSlug: "inventory-counts",
    topic: "counting",
    bloom: "apply",
    kind: "single",
    prompt:
      "A 400-line count posts in a company with accounting enabled. How many journals are written?",
    options: [
      { id: "a", text: "One per line with a non-zero variance" },
      {
        id: "b",
        text: "One for the whole post, against the inventory adjustment variance account"
      },
      { id: "c", text: "One per storage unit in the count" },
      { id: "d", text: "None — counts post quantities only" }
    ],
    answer: "b",
    explanation:
      "Posting is a single atomic transaction and it writes a single journal for the whole post, valued at each item's current cost. The quantity variances are still per line.",
    docsUrl: `${COUNT}#what-posting-does`
  },
  {
    slug: "inventory.counting.05",
    unitSlug: "inventory-counts",
    topic: "counting",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A receipt of 20 posts into a bin while a count is open. The counter counted 50 against a frozen system quantity of 45. What does posting the count do?",
    options: [
      { id: "a", text: "Sets on hand to 50, erasing the receipt" },
      { id: "b", text: "Posts a Positive Adjmt. of 5" },
      { id: "c", text: "Posts a Negative Adjmt. of 15" },
      {
        id: "d",
        text: "Blocks the post because on hand changed after the snapshot"
      }
    ],
    answer: "b",
    explanation:
      "The variance is measured against the frozen snapshot, never live on hand, so the correction is applied on top of the receipt instead of erasing it. What posts is exactly the difference the counter reviewed.",
    docsUrl: `${COUNT}#what-posting-does`
  },
  {
    slug: "inventory.counting.06",
    unitSlug: "inventory-counts",
    topic: "counting",
    bloom: "apply",
    kind: "single",
    prompt:
      "For a tracked lot, how is the count variance applied to the entity's quantity?",
    options: [
      { id: "a", text: "The counted quantity replaces the entity's quantity" },
      { id: "b", text: "The delta is added to the entity's quantity" },
      {
        id: "c",
        text: "The entity is deleted and recreated at the counted quantity"
      },
      { id: "d", text: "Tracked lots are excluded from counts entirely" }
    ],
    answer: "b",
    explanation:
      "Adding the delta rather than setting the number is the same principle as reconciling against the snapshot: any receipt or shipment that posted between the snapshot and the post survives the count instead of being clobbered.",
    docsUrl: `${COUNT}#what-posting-does`
  },
  {
    slug: "inventory.counting.07",
    unitSlug: "inventory-counts",
    topic: "counting",
    bloom: "remember",
    kind: "single",
    prompt: "When Carbon generates count lines, which stock does it leave out?",
    options: [
      { id: "a", text: "Rejected and Consumed lots" },
      { id: "b", text: "Every batch-tracked lot" },
      { id: "c", text: "Anything sitting in a lineside bin" },
      { id: "d", text: "Anything received in the current period" }
    ],
    answer: "a",
    explanation:
      "A count never lists stock that has already been scrapped, rejected, or used up — asking someone to find it on a shelf would only generate false variances.",
    docsUrl: `${COUNT}#creating-a-count`
  },
  {
    slug: "inventory.counting.08",
    unitSlug: "inventory-counts",
    topic: "counting",
    bloom: "remember",
    kind: "single",
    prompt: "At what grain does Carbon aggregate on hand into count lines?",
    options: [
      { id: "a", text: "One line per item" },
      { id: "b", text: "One line per item, storage unit, and lot" },
      { id: "c", text: "One line per location" },
      { id: "d", text: "One line per item-ledger entry" }
    ],
    answer: "b",
    explanation:
      "The line grain is the grain a counter can actually verify: a specific lot, in a specific bin. Each line freezes its own system quantity, and that snapshot is what the variance is measured against.",
    docsUrl: `${COUNT}#creating-a-count`
  },
  {
    slug: "inventory.counting.09",
    unitSlug: "inventory-counts",
    topic: "counting",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A warehouse decides to count one aisle a week rather than stopping for a wall-to-wall inventory. How does the resulting document differ?",
    options: [
      {
        id: "a",
        text: "It is a separate document type with its own lifecycle"
      },
      {
        id: "b",
        text: "It does not — scope is only used at creation to decide which lines to generate"
      },
      { id: "c", text: "A cycle count skips the Pending status" },
      { id: "d", text: "A cycle count cannot write a journal" }
    ],
    answer: "b",
    explanation:
      "A cycle count is just a full count narrowed to some bins or one item type. Same lifecycle, same variances, same journal — the only difference is how much of the location you asked for.",
    docsUrl: `${COUNT}#creating-a-count`
  },
  {
    slug: "inventory.counting.10",
    unitSlug: "inventory-counts",
    topic: "counting",
    bloom: "remember",
    kind: "single",
    prompt: "Which item types can a count be restricted to?",
    options: [
      { id: "a", text: "Part, Material, Tool, or Consumable" },
      { id: "b", text: "Any item type, including Service" },
      { id: "c", text: "Part only" },
      { id: "d", text: "Serial- and Batch-tracked items only" }
    ],
    answer: "a",
    explanation:
      "Those four are the stockable item types. Services hold no inventory, so there is nothing on a shelf to count and they are never offered.",
    docsUrl: `${COUNT}#creating-a-count`
  },
  {
    slug: "inventory.counting.11",
    unitSlug: "inventory-counts",
    topic: "counting",
    bloom: "apply",
    kind: "multi",
    prompt:
      "Which two entries will Carbon refuse on a count line? (Choose two.)",
    options: [
      { id: "a", text: "A negative counted quantity" },
      { id: "b", text: "A serial-tracked line counted as 3" },
      { id: "c", text: "A counted quantity of 0" },
      { id: "d", text: "A blank counted quantity" }
    ],
    answer: ["a", "b"],
    explanation:
      "Counted quantities are non-negative, so a count can never drive on hand below zero, and a serial number is one unique unit — present (1) or not (0). A 0 is a legitimate count and a blank legitimately means 'not counted'.",
    docsUrl: `${COUNT}#counting`
  },
  {
    slug: "inventory.counting.12",
    unitSlug: "inventory-counts",
    topic: "counting",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A count was posted last week and one of its lines turns out to have been wrong. What do you do?",
    options: [
      { id: "a", text: "Reopen the count and post it again" },
      {
        id: "b",
        text: "Correct that movement from the stock-movements screen — a Posted count is never reopened"
      },
      { id: "c", text: "Delete the count so the adjustments unwind" },
      {
        id: "d",
        text: "Run a second count of the same bins and let the newer one win"
      }
    ],
    answer: "b",
    explanation:
      "Posting is final. Correcting the movement books an opposite movement for the difference, dated with the original's posting date, so the original count and its fix both stay visible in the right period.",
    docsUrl: `${COUNT}#the-count-lifecycle`
  },
  {
    slug: "inventory.counting.13",
    unitSlug: "inventory-counts",
    topic: "counting",
    bloom: "apply",
    kind: "single",
    prompt:
      "Posting fails with 'Only a confirmed (pending) count can be made effective'. What is the fix?",
    options: [
      { id: "a", text: "Regenerate the lines and count again" },
      {
        id: "b",
        text: "Confirm the count first, moving it from Draft to Pending, then post"
      },
      { id: "c", text: "Enable accounting for the company" },
      { id: "d", text: "Grant the user the inventory delete permission" }
    ],
    answer: "b",
    explanation:
      "The post action only accepts a Pending count. Confirming is the deliberate step that locks the entered quantities in for review before anything reaches the ledger.",
    docsUrl: `${COUNT}#the-count-lifecycle`
  },
  {
    slug: "inventory.counting.14",
    unitSlug: "inventory-counts",
    topic: "counting",
    bloom: "apply",
    kind: "single",
    prompt:
      "A count is in Pending and a counter needs to change one of the numbers. Which action does Carbon allow?",
    options: [
      {
        id: "a",
        text: "Edit the quantity in place while the count is Pending"
      },
      {
        id: "b",
        text: "Reopen the count from Pending back to Draft, then edit"
      },
      {
        id: "c",
        text: "Reopen it after posting, which is the only reopen that exists"
      },
      { id: "d", text: "Regenerate the lines from Pending" }
    ],
    answer: "b",
    explanation:
      "Reopen only works from Pending, and it goes back to Draft. Regenerating lines from scratch is a Draft-only action too, and a Posted count has no reopen at all.",
    docsUrl: `${COUNT}#the-count-lifecycle`
  },
  {
    slug: "inventory.counting.15",
    unitSlug: "inventory-counts",
    topic: "counting",
    bloom: "apply",
    kind: "single",
    prompt:
      "A company has accounting turned off. What does posting a count still do?",
    options: [
      {
        id: "a",
        text: "Nothing — the post is blocked until accounting is enabled"
      },
      {
        id: "b",
        text: "Books the quantity variances and maintains cost layers, just without the GL entry"
      },
      { id: "c", text: "Writes the journal but leaves quantities alone" },
      { id: "d", text: "Updates only the cached per-location quantity" }
    ],
    answer: "b",
    explanation:
      "Stock and cost layers move regardless of whether the books are on; the GL entry is the only thing accounting gates. This is the same split scrap follows.",
    docsUrl: `${COUNT}#what-posting-does`
  },
  {
    slug: "inventory.counting.16",
    unitSlug: "inventory-counts",
    topic: "counting",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Which two things are true of an inventory count but not of a manual adjustment? (Choose two.)",
    options: [
      {
        id: "a",
        text: "It freezes a system quantity to measure the variance against"
      },
      {
        id: "b",
        text: "It has a Draft → Pending → Posted lifecycle with a review step"
      },
      {
        id: "c",
        text: "It ends in a Positive or Negative Adjustment on the item ledger"
      },
      { id: "d", text: "It writes a journal when accounting is enabled" }
    ],
    answer: ["a", "b"],
    explanation:
      "Both land in exactly the same place on the ledger and post the same journal. What a count adds is the snapshot, the review, and the atomic bulk post — reach for a count to reconcile a shelf, and an adjustment when you already know one number is wrong.",
    docsUrl: `${COUNT}#count-vs-a-direct-adjustment`
  },
  {
    slug: "inventory.counting.17",
    unitSlug: "inventory-counts",
    topic: "counting",
    bloom: "apply",
    kind: "single",
    prompt: "Why would you turn Blind count on?",
    options: [
      { id: "a", text: "To hide the count document from other users" },
      {
        id: "b",
        text: "So the counter cannot see the expected quantity and the system number cannot bias what they write down"
      },
      {
        id: "c",
        text: "To skip the Pending status and post straight from Draft"
      },
      { id: "d", text: "To exclude tracked lots from the generated lines" }
    ],
    answer: "b",
    explanation:
      "A visible expected quantity quietly turns a count into a confirmation exercise. Blind counting is what makes the variance evidence rather than agreement.",
    docsUrl: `${COUNT}#creating-a-count`
  },
  {
    slug: "inventory.counting.18",
    unitSlug: "inventory-counts",
    topic: "counting",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Two supervisors post the same count at nearly the same moment and one gets 'Inventory count is no longer pending'. What happened?",
    options: [
      { id: "a", text: "The count was deleted mid-post" },
      {
        id: "b",
        text: "The other post already moved the count out of Pending, so this one refused rather than double-posting"
      },
      { id: "c", text: "The lines were regenerated underneath them" },
      { id: "d", text: "The accounting period closed between the two attempts" }
    ],
    answer: "b",
    explanation:
      "Because posting is atomic and only accepts a Pending count, the second attempt refuses instead of booking the variances twice. Reload the count to see its real state before acting again.",
    docsUrl: `${COUNT}#the-count-lifecycle`
  },

  // ---------------------------------------------------- traceability (18)
  {
    slug: "inventory.traceability.01",
    unitSlug: "traceability",
    topic: "traceability",
    bloom: "remember",
    kind: "single",
    prompt:
      "How many tracked entities does Carbon create for a Serial item, versus a Batch item?",
    options: [
      {
        id: "a",
        text: "One entity per unit for Serial (quantity 1); one entity per lot for Batch"
      },
      { id: "b", text: "One entity per lot for both" },
      { id: "c", text: "One entity per unit for both" },
      {
        id: "d",
        text: "One entity per receipt line, whichever the tracking type"
      }
    ],
    answer: "a",
    explanation:
      "A tracked entity is a tracked quantity of an item. Serial means that quantity is always 1; Batch means it is the size of the lot. Everything else — status, expiry, genealogy — hangs off that one record.",
    docsUrl: `${TRACE}#tracked-entities`
  },
  {
    slug: "inventory.traceability.02",
    unitSlug: "traceability",
    topic: "traceability",
    bloom: "analyze",
    kind: "single",
    prompt: "Where does Carbon store serial numbers and batch numbers?",
    options: [
      {
        id: "a",
        text: "In a serial-number table and a separate batch-number table"
      },
      {
        id: "b",
        text: "On the tracked entity's attributes — one model represents both, and the number is an attribute"
      },
      { id: "c", text: "On the item master, as a list of issued numbers" },
      { id: "d", text: "On the receipt line that created them" }
    ],
    answer: "b",
    explanation:
      "There are no separate serial or batch tables. That is why the same screens, statuses, and actions work for both, and why a Serial is really just an entity whose quantity happens to be 1.",
    docsUrl: `${TRACE}#tracked-entities`
  },
  {
    slug: "inventory.traceability.03",
    unitSlug: "traceability",
    topic: "traceability",
    bloom: "apply",
    kind: "single",
    prompt:
      "A batch-tracked part is received. What status do its entities carry when they are created, and after the receipt posts?",
    options: [
      { id: "a", text: "Available, then Consumed" },
      {
        id: "b",
        text: "On Hold on creation, released to Available when the receipt posts — unless the item needs inspection"
      },
      { id: "c", text: "Reserved, then Available" },
      { id: "d", text: "Rejected, then Available once accepted" }
    ],
    answer: "b",
    explanation:
      "Receiving creates entities On Hold and posting the receipt is what releases them. Requiring inspection keeps them On Hold past the post, so nothing gets picked before it has been cleared.",
    docsUrl: `${TRACE}#where-entities-come-from`
  },
  {
    slug: "inventory.traceability.04",
    unitSlug: "traceability",
    topic: "traceability",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A received lot needs inspection. What are its two possible outcomes?",
    options: [
      {
        id: "a",
        text: "It stays On Hold until inspection clears, or becomes Rejected if it fails"
      },
      {
        id: "b",
        text: "It becomes Available immediately and is flagged for follow-up"
      },
      { id: "c", text: "It becomes Scrapped if it fails" },
      { id: "d", text: "It becomes Reserved until an inspector is assigned" }
    ],
    answer: "a",
    explanation:
      "Inspection is what stands between On Hold and Available. A failure lands on Rejected, which is terminal — unlike Scrapped, it cannot be reversed.",
    docsUrl: `${TRACE}#where-entities-come-from`
  },
  {
    slug: "inventory.traceability.05",
    unitSlug: "traceability",
    topic: "traceability",
    bloom: "apply",
    kind: "single",
    prompt:
      "A job will produce a serial-tracked part. What does Carbon do with the output entity before the unit physically exists?",
    options: [
      {
        id: "a",
        text: "Nothing — the entity appears when the unit is produced"
      },
      {
        id: "b",
        text: "Reserves it up front, then flips it to Available when the unit is produced"
      },
      { id: "c", text: "Creates it On Hold, like a receipt does" },
      { id: "d", text: "Creates it Consumed against the job" }
    ],
    answer: "b",
    explanation:
      "Reserved is the allocated state — a job's output before it is made is the canonical example. Reserving up front is what gives downstream demand something to point at before the unit exists.",
    docsUrl: `${TRACE}#where-entities-come-from`
  },
  {
    slug: "inventory.traceability.06",
    unitSlug: "traceability",
    topic: "traceability",
    bloom: "remember",
    kind: "single",
    prompt: "Which terminal tracked-entity status can be reversed?",
    options: [
      { id: "a", text: "Consumed" },
      { id: "b", text: "Rejected" },
      { id: "c", text: "Scrapped" },
      { id: "d", text: "None of them" }
    ],
    answer: "c",
    explanation:
      "Scrapped keeps its quantity as the record of what was lost and can be reversed with Unscrap, which restores it to Available at the same bin. Consumed and Rejected stand.",
    docsUrl: `${TRACE}#tracked-entities`
  },
  {
    slug: "inventory.traceability.07",
    unitSlug: "traceability",
    topic: "traceability",
    bloom: "analyze",
    kind: "single",
    prompt: "How does Carbon answer 'what went into this finished unit?'",
    options: [
      { id: "a", text: "It reads a stored parent pointer on the entity" },
      {
        id: "b",
        text: "It walks the activity graph outward — every consume, produce, split, and ship is an activity with inputs and outputs"
      },
      { id: "c", text: "It reads the item's bill of material" },
      { id: "d", text: "It reads the receipt the material arrived on" }
    ],
    answer: "b",
    explanation:
      "Genealogy is not a stored pointer; it is reconstructed by walking activities recorded as the work happened. The BOM says what was supposed to go in — the activity graph says what actually did.",
    docsUrl: `${TRACE}#genealogy`
  },
  {
    slug: "inventory.traceability.08",
    unitSlug: "traceability",
    topic: "traceability",
    bloom: "apply",
    kind: "single",
    prompt:
      "Half of a batch is consumed by a job. What does Carbon record so the remainder stays traceable?",
    options: [
      {
        id: "a",
        text: "A split, linking the original lot to both the consumed portion and the remainder"
      },
      { id: "b", text: "A brand-new lot with no link back to the original" },
      { id: "c", text: "A negative adjustment against the original lot" },
      { id: "d", text: "Nothing — the lot's quantity is simply decremented" }
    ],
    answer: "a",
    explanation:
      "A split is recorded as an activity like any other event, so both halves keep their ancestry. Without it, the surviving remainder would look like stock that appeared out of nowhere.",
    docsUrl: `${TRACE}#genealogy`
  },
  {
    slug: "inventory.traceability.09",
    unitSlug: "traceability",
    topic: "traceability",
    bloom: "apply",
    kind: "multi",
    prompt:
      "Which material events are recorded as genealogy activities? (Choose three.)",
    options: [
      { id: "a", text: "Consume" },
      { id: "b", text: "Produce" },
      { id: "c", text: "Split" },
      { id: "d", text: "A change to the item's standard cost" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Consume, produce, split, and ship are all activities, each with inputs and outputs, and the parent-child link runs through the activity. A cost change moves no material, so it leaves no genealogy behind.",
    docsUrl: `${TRACE}#genealogy`
  },
  {
    slug: "inventory.traceability.10",
    unitSlug: "traceability",
    topic: "traceability",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A component in the bill of material is a plain untracked item. What can genealogy prove about which of it went into a given unit?",
    options: [
      { id: "a", text: "Which lot was consumed, from the ledger entry" },
      {
        id: "b",
        text: "Nothing at that grain — only Serial and Batch items get tracked entities to link"
      },
      {
        id: "c",
        text: "It is recorded as a Reserved entity and traced that way"
      },
      { id: "d", text: "It is traced back through the receipt it arrived on" }
    ],
    answer: "b",
    explanation:
      "Genealogy links tracked entities, so a chain is only as complete as the tracking on the items in it. An untracked component is the usual place a trace stops — it has no per-lot record to link to.",
    docsUrl: `${TRACE}#tracked-entities`
  },
  {
    slug: "inventory.traceability.11",
    unitSlug: "traceability",
    topic: "traceability",
    bloom: "remember",
    kind: "single",
    prompt: "What does a Reserved tracked entity represent?",
    options: [
      {
        id: "a",
        text: "Stock allocated — for example a job's output before it is made"
      },
      { id: "b", text: "Stock received but awaiting inspection" },
      { id: "c", text: "Stock past its expiration date" },
      { id: "d", text: "Stock staged at a lineside bin" }
    ],
    answer: "a",
    explanation:
      "Reserved means allocated, not physically restricted. Awaiting inspection is On Hold, and staging at a lineside bin does not change an entity's status at all — a pick just moves it.",
    docsUrl: `${TRACE}#tracked-entities`
  },
  {
    slug: "inventory.traceability.12",
    unitSlug: "traceability",
    topic: "traceability",
    bloom: "apply",
    kind: "single",
    prompt:
      "A receipt posted this morning, but one lot from it is still On Hold. What is the likely reason?",
    options: [
      {
        id: "a",
        text: "The item requires inspection and it has not cleared yet"
      },
      { id: "b", text: "The lot is allocated to a job" },
      { id: "c", text: "The lot has passed its expiration date" },
      { id: "d", text: "The destination storage unit is full" }
    ],
    answer: "a",
    explanation:
      "Posting the receipt normally releases On Hold entities to Available. The one thing that keeps them there is an inspection that has not been cleared — after which they go Available or Rejected.",
    docsUrl: `${TRACE}#where-entities-come-from`
  },
  {
    slug: "inventory.traceability.13",
    unitSlug: "traceability",
    topic: "traceability",
    bloom: "analyze",
    kind: "single",
    prompt: "A tracked entity shows Consumed. What does that tell you?",
    options: [
      { id: "a", text: "It failed inspection" },
      { id: "b", text: "It was issued to a job or shipped out" },
      { id: "c", text: "It was written off as unrecoverable, with a reason" },
      { id: "d", text: "It is reserved for a job that has not started" }
    ],
    answer: "b",
    explanation:
      "Consumed covers both ways stock legitimately leaves: into a job, or out to a customer. Failed inspection is Rejected, and a reasoned write-off is Scrapped.",
    docsUrl: `${TRACE}#tracked-entities`
  },
  {
    slug: "inventory.traceability.14",
    unitSlug: "traceability",
    topic: "traceability",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Which statuses mean an entity is NOT free to pick or consume? (Choose three.)",
    options: [
      { id: "a", text: "On Hold" },
      { id: "b", text: "Rejected" },
      { id: "c", text: "Consumed" },
      { id: "d", text: "Available" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Available is the only status described as in stock and free to pick or consume. This is also why reading on hand from the ledger matters: it is status-aware, so it can separate held and rejected stock from what you can actually use.",
    docsUrl: `${TRACE}#tracked-entities`
  },
  {
    slug: "inventory.traceability.15",
    unitSlug: "traceability",
    topic: "traceability",
    bloom: "apply",
    kind: "single",
    prompt:
      "Two lots of the same batch item are Available in the same bin. Which does Carbon offer first when picking?",
    options: [
      { id: "a", text: "The one received first" },
      { id: "b", text: "The one expiring earliest" },
      { id: "c", text: "The larger lot, to avoid fragmenting stock" },
      { id: "d", text: "The one already closest to the work center" }
    ],
    answer: "b",
    explanation:
      "Picking is earliest-expiry-first (FEFO), so the stock most at risk of aging out leaves first. Receipt order only matches that when nothing carries a date.",
    docsUrl: `${TRACE}#shelf-life`
  },
  {
    slug: "inventory.traceability.16",
    unitSlug: "traceability",
    topic: "traceability",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A supplier reports a defect in a batch you received six weeks ago. Which way does the genealogy walk run to find everything it touched?",
    options: [
      { id: "a", text: "Backwards, through the lot's own ancestry" },
      {
        id: "b",
        text: "Forwards, through the activity graph to the lot's descendants"
      },
      { id: "c", text: "Neither — you search the item ledger by date range" },
      { id: "d", text: "Through the bill of material of every open job" }
    ],
    answer: "b",
    explanation:
      "The same graph is walked in both directions: ancestry answers 'what went into this unit', descendants answer 'where did this lot end up'. A recall is the forward walk.",
    docsUrl: `${TRACE}#genealogy`
  },
  {
    slug: "inventory.traceability.17",
    unitSlug: "traceability",
    topic: "traceability",
    bloom: "remember",
    kind: "single",
    prompt: "Which items can carry an expiration date?",
    options: [
      { id: "a", text: "Any stocked item" },
      { id: "b", text: "Serial- and Batch-tracked items only" },
      { id: "c", text: "Batch items only" },
      { id: "d", text: "Purchased items only" }
    ],
    answer: "b",
    explanation:
      "The date is stamped on the tracked entity, so there has to be a per-unit or per-lot record to stamp it on. A fungible item has none, which is why shelf life is not offered for it.",
    docsUrl: `${TRACE}#shelf-life`
  },
  {
    slug: "inventory.traceability.18",
    unitSlug: "traceability",
    topic: "traceability",
    bloom: "apply",
    kind: "single",
    prompt:
      "A quality engineer needs to know which supplier lot a specific serial came from. Where does Carbon hold that?",
    options: [
      { id: "a", text: "On the item master, as the last supplier used" },
      {
        id: "b",
        text: "On the tracked entity's attributes, alongside its number"
      },
      { id: "c", text: "Only on the receipt document it arrived on" },
      { id: "d", text: "Nowhere — provenance is inferred from receipt dates" }
    ],
    answer: "b",
    explanation:
      "The number and where the entity came from both live on the entity's attributes, so provenance travels with the physical lot rather than depending on finding the paperwork that created it.",
    docsUrl: `${TRACE}#tracked-entities`
  },

  // ------------------------------------------------------ shelf-life (15)
  {
    slug: "inventory.shelf-life.01",
    unitSlug: "shelf-life",
    topic: "shelf-life",
    bloom: "remember",
    kind: "single",
    prompt:
      "Which set of modes does a shelf-life policy choose between to decide how an expiration date is computed?",
    options: [
      { id: "a", text: "Fixed Duration, Calculated, Set on Receipt" },
      { id: "b", text: "Days, Months, Years" },
      { id: "c", text: "FIFO, FEFO, LIFO" },
      { id: "d", text: "Warn, Block, BlockWithOverride" }
    ],
    answer: "a",
    explanation:
      "NotManaged is the fourth mode and the default — choosing it removes any existing policy. The other three are the ways a date actually gets computed. Warn/Block/BlockWithOverride is a different setting: what happens to stock once it has expired.",
    docsUrl: `${SHELF}#how-a-date-gets-set-the-three-modes`
  },
  {
    slug: "inventory.shelf-life.02",
    unitSlug: "shelf-life",
    topic: "shelf-life",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A planner asks you to 'just set the shelf-life days' on an item whose policy is Calculated. What is wrong with the request?",
    options: [
      { id: "a", text: "Nothing — Days applies to every mode" },
      {
        id: "b",
        text: "Only Fixed Duration is a day count; Calculated inherits the earliest expiry of the components consumed"
      },
      { id: "c", text: "Calculated takes its days from the receipt instead" },
      { id: "d", text: "Calculated items cannot carry a policy at all" }
    ],
    answer: "b",
    explanation:
      "The 'received date + N days' mental model is wrong for two of the three modes: Calculated inherits the soonest expiry of its inputs, and Set on Receipt captures the supplier's printed date by hand. Neither has a days figure to set.",
    docsUrl: `${SHELF}#how-a-date-gets-set-the-three-modes`
  },
  {
    slug: "inventory.shelf-life.03",
    unitSlug: "shelf-life",
    topic: "shelf-life",
    bloom: "apply",
    kind: "single",
    prompt:
      "A bought adhesive has a 180-day Fixed Duration policy. The receipt's posting date is 1 March, but it was keyed into Carbon on 5 March. When does the lot expire?",
    options: [
      { id: "a", text: "180 days from 5 March, when the receipt was entered" },
      { id: "b", text: "180 days from 1 March, the receipt's posting date" },
      { id: "c", text: "180 days from the purchase order date" },
      { id: "d", text: "180 days from the first time it is issued" }
    ],
    answer: "b",
    explanation:
      "For bought items the clock starts at the receipt's posting date, not 'today'. Backdating a receipt therefore backdates the expiry, which is what makes a late-keyed receipt safe.",
    docsUrl: `${SHELF}#when-the-clock-starts`
  },
  {
    slug: "inventory.shelf-life.04",
    unitSlug: "shelf-life",
    topic: "shelf-life",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A made item has a Fixed Duration policy with a trigger process of Pasteurise and timing After. When does its clock start?",
    options: [
      { id: "a", text: "When the job is released" },
      { id: "b", text: "When the Pasteurise operation finishes" },
      { id: "c", text: "When the finished unit is received into stock" },
      { id: "d", text: "When the earliest-dated component was received" }
    ],
    answer: "b",
    explanation:
      "Made items start the clock at a job operation, optionally gated to a named trigger process with Before or After timing. Leaving the trigger process blank means any operation starts it, and sub-assemblies stamp their own batches from their own operations.",
    docsUrl: `${SHELF}#when-the-clock-starts`
  },
  {
    slug: "inventory.shelf-life.05",
    unitSlug: "shelf-life",
    topic: "shelf-life",
    bloom: "apply",
    kind: "single",
    prompt:
      "A Calculated item is built from three dated lots expiring 1 June, 12 July, and 3 September. What expiry does the finished batch get?",
    options: [
      { id: "a", text: "3 September, the latest of the three" },
      { id: "b", text: "1 June, the earliest of the three" },
      { id: "c", text: "12 July, the middle value" },
      { id: "d", text: "The company's default shelf-life days from today" }
    ],
    answer: "b",
    explanation:
      "Calculated takes the minimum expiration date across the tracked components consumed, so a build can never outlive its shortest-dated ingredient.",
    docsUrl: `${SHELF}#when-the-clock-starts`
  },
  {
    slug: "inventory.shelf-life.06",
    unitSlug: "shelf-life",
    topic: "shelf-life",
    bloom: "analyze",
    kind: "single",
    prompt:
      "One input to a Calculated item carries a date but has no shelf-life policy of its own. What decides whether its date counts toward the result?",
    options: [
      { id: "a", text: "The parent item's mode" },
      {
        id: "b",
        text: "The company's calculated input scope: AllInputs or ManagedInputsOnly"
      },
      { id: "c", text: "The expired-entity policy" },
      { id: "d", text: "The near-expiry warning lead time" }
    ],
    answer: "b",
    explanation:
      "AllInputs is the default and spans every dated input; ManagedInputsOnly narrows the minimum to inputs that themselves carry a policy. It is a company-wide setting, not a per-item one.",
    docsUrl: `${SHELF}#when-the-clock-starts`
  },
  {
    slug: "inventory.shelf-life.07",
    unitSlug: "shelf-life",
    topic: "shelf-life",
    bloom: "remember",
    kind: "single",
    prompt: "What is the default company-wide expired-entity policy?",
    options: [
      { id: "a", text: "Warn — allowed, with a warning" },
      { id: "b", text: "Block — rejected outright" },
      {
        id: "c",
        text: "BlockWithOverride — rejected unless a reason is supplied"
      },
      { id: "d", text: "There is no default; it must be chosen at setup" }
    ],
    answer: "b",
    explanation:
      "Expiry is enforced rather than cosmetic, so the safe option is the default: consuming or transferring expired stock is rejected with 'Cannot consume expired tracked entit(y/ies)' until somebody deliberately relaxes the rule.",
    docsUrl: `${SHELF}#what-happens-to-expired-stock`
  },
  {
    slug: "inventory.shelf-life.08",
    unitSlug: "shelf-life",
    topic: "shelf-life",
    bloom: "apply",
    kind: "multi",
    prompt:
      "A material issue is rejected with 'Cannot consume expired tracked entity'. Which two actions will let the work proceed? (Choose two.)",
    options: [
      {
        id: "a",
        text: "Pick a non-expired lot, which FEFO ordering surfaces first anyway"
      },
      {
        id: "b",
        text: "Correct the entity's expiration date, supplying a reason"
      },
      { id: "c", text: "Move the lot into a different storage unit" },
      { id: "d", text: "Re-post the receipt that created the lot" }
    ],
    answer: ["a", "b"],
    explanation:
      "The block is on the date, not on where the stock sits, so moving it changes nothing. The third route is to relax the company policy to Warn or BlockWithOverride in Settings → Inventory.",
    docsUrl: `${SHELF}#what-happens-to-expired-stock`
  },
  {
    slug: "inventory.shelf-life.09",
    unitSlug: "shelf-life",
    topic: "shelf-life",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Which operations does the expired-entity policy govern? (Choose two.)",
    options: [
      { id: "a", text: "Material issues" },
      { id: "b", text: "Stock transfers" },
      { id: "c", text: "Inventory counts" },
      { id: "d", text: "Purchase order approval" }
    ],
    answer: ["a", "b"],
    explanation:
      "The check runs wherever stock is consumed or moved — material issues, stock transfers, and maintenance work — so it holds whether the action comes from the office or the floor. Shipments have their own counterpart block.",
    docsUrl: `${SHELF}#what-happens-to-expired-stock`
  },
  {
    slug: "inventory.shelf-life.10",
    unitSlug: "shelf-life",
    topic: "shelf-life",
    bloom: "apply",
    kind: "single",
    prompt:
      "A company sets the expired-entity policy to BlockWithOverride. What does a user need in order to consume an expired lot?",
    options: [
      { id: "a", text: "Nothing — it behaves the same as Warn" },
      { id: "b", text: "An override reason" },
      { id: "c", text: "The inventory delete permission" },
      { id: "d", text: "An unexpired duplicate of the same lot" }
    ],
    answer: "b",
    explanation:
      "BlockWithOverride sits between the other two: Warn lets it through with a message, Block refuses outright, and BlockWithOverride refuses until someone puts a reason on the record.",
    docsUrl: `${SHELF}#what-happens-to-expired-stock`
  },
  {
    slug: "inventory.shelf-life.11",
    unitSlug: "shelf-life",
    topic: "shelf-life",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A batch already carries an expiration date, and a policy recalculation runs over it. What happens to the date?",
    options: [
      { id: "a", text: "It is recomputed and overwritten with the new result" },
      {
        id: "b",
        text: "It stands — a date is only ever written where it was blank"
      },
      { id: "c", text: "It is cleared so it can be re-entered" },
      { id: "d", text: "It is averaged with the newly computed date" }
    ],
    answer: "b",
    explanation:
      "Carbon never silently overwrites a date a batch already carries, because that date may be the supplier's printed one. Changing it is possible, but only through a manual override that requires a reason, kept on the entity's history.",
    docsUrl: `${SHELF}#policy-fields`
  },
  {
    slug: "inventory.shelf-life.12",
    unitSlug: "shelf-life",
    topic: "shelf-life",
    bloom: "apply",
    kind: "single",
    prompt: "Editing the expiry of a Consumed tracked entity is refused. Why?",
    options: [
      { id: "a", text: "The reason field was left blank" },
      {
        id: "b",
        text: "Expiry can only be overridden on live stock; a Consumed entity's date is history"
      },
      {
        id: "c",
        text: "The entity is Serial-tracked rather than Batch-tracked"
      },
      {
        id: "d",
        text: "The accounting period the consumption fell in is closed"
      }
    ],
    answer: "b",
    explanation:
      "Only live entities — Available or On Hold — accept an expiry override. Once stock has been issued or shipped, its date is part of the record of what was used and stays as recorded.",
    docsUrl: `${SHELF}#what-happens-to-expired-stock`
  },
  {
    slug: "inventory.shelf-life.13",
    unitSlug: "shelf-life",
    topic: "shelf-life",
    bloom: "remember",
    kind: "single",
    prompt: "Where is an item's shelf-life policy configured?",
    options: [
      { id: "a", text: "On the item master's general tab" },
      {
        id: "b",
        text: "On the item's pick method (item ↔ location), under its shelf-life fields"
      },
      { id: "c", text: "In Settings → Inventory, alongside the company rules" },
      { id: "d", text: "On each receipt line as the stock arrives" }
    ],
    answer: "b",
    explanation:
      "The per-item policy — mode, days, trigger process, timing — lives on the pick method. Settings → Inventory holds the company-wide rules instead: the expired-entity policy, near-expiry days, default days, and calculated input scope.",
    docsUrl: `${SHELF}#where-you-set-it`
  },
  {
    slug: "inventory.shelf-life.14",
    unitSlug: "shelf-life",
    topic: "shelf-life",
    bloom: "remember",
    kind: "single",
    prompt:
      "The near-expiry warning days setting is left blank. What is the effect?",
    options: [
      { id: "a", text: "It falls back to the default shelf-life days" },
      { id: "b", text: "The amber 'expiring soon' badges are turned off" },
      { id: "c", text: "Expired stock stops being blocked" },
      { id: "d", text: "FEFO ordering is disabled in picking" }
    ],
    answer: "b",
    explanation:
      "The near-expiry lead time only drives the warning badges in the tracked-entity lists. Blocking expired stock is the separate expired-entity policy, and FEFO ordering is unconditional.",
    docsUrl: `${SHELF}#company-settings`
  },
  {
    slug: "inventory.shelf-life.15",
    unitSlug: "shelf-life",
    topic: "shelf-life",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Setting a shelf-life policy on a fungible Inventory item is not offered. Why not?",
    options: [
      { id: "a", text: "Fungible items are never held in stock" },
      { id: "b", text: "There is no tracked entity to carry the date" },
      {
        id: "c",
        text: "Its mode defaults to NotManaged and cannot be changed"
      },
      { id: "d", text: "Shelf life requires the Business plan" }
    ],
    answer: "b",
    explanation:
      "The expiration date lives on the tracked entity, not on the item master, so only Serial and Batch items have somewhere to put it. Making the item tracked is the prerequisite, not a setting.",
    docsUrl: `${SHELF}#how-a-date-gets-set-the-three-modes`
  }
];
