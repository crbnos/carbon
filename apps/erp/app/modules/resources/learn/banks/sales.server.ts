/**
 * Sales — question bank. SERVER ONLY.
 *
 * The questions lean on the places the sales flow refuses to behave like a form:
 * an order's status is computed from its lines rather than typed, a quote locks
 * the moment it leaves Draft, discounts never stack while markups always do, and
 * posting is the only event that moves anything — a shipment does not bill, and
 * a posted invoice is not a paid one.
 */

import type { LearnQuestion } from "../types";

const D = "https://docs.carbon.ms";
const Q = `${D}/docs/reference/quotes`;
const PR = `${D}/docs/reference/pricing`;
const SO = `${D}/docs/reference/sales-orders`;
const SHP = `${D}/docs/reference/shipments`;
const INV = `${D}/docs/reference/invoices`;
const G_QTC = `${D}/guides/quote-to-cash`;
const G_OTC = `${D}/guides/order-to-cash`;
const G_SHIP = `${D}/guides/ship`;

export const questions: LearnQuestion[] = [
  // -------------------------------------------------------------- quotes (21)
  {
    slug: "sales.quotes.01",
    unitSlug: "quote-anatomy",
    topic: "quotes",
    bloom: "apply",
    kind: "single",
    prompt:
      "A customer clicks Accept Quote on the share link you sent. What has happened in Carbon a moment later?",
    options: [
      {
        id: "a",
        text: "A sales order was built from the quote's lines at the negotiated price, and the quote reads Ordered"
      },
      {
        id: "b",
        text: "The quote reads Sent and waits for someone internally to convert it"
      },
      { id: "c", text: "A production job was raised for each quoted line" },
      { id: "d", text: "Nothing, until you post the quote yourself" }
    ],
    answer: "a",
    explanation:
      "Customer acceptance is a real conversion, not a notification: Carbon builds the sales order from the quoted lines and flips the quote to Ordered.",
    docsUrl: Q
  },
  {
    slug: "sales.quotes.02",
    unitSlug: "quote-anatomy",
    topic: "quotes",
    bloom: "apply",
    kind: "single",
    prompt:
      "A five-line quote is converted, but only three lines were selected for the order. What status does the quote land on?",
    options: [
      { id: "a", text: "Ordered" },
      { id: "b", text: "Partial" },
      { id: "c", text: "Sent" },
      { id: "d", text: "Lost" }
    ],
    answer: "b",
    explanation:
      "Partial is the status for a quote whose lines converted piecemeal — Ordered means every line went across.",
    docsUrl: Q
  },
  {
    slug: "sales.quotes.03",
    unitSlug: "quote-anatomy",
    topic: "quotes",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You convert a quote whose only lines are service work — nothing physical leaves the building. What status does the new sales order open at?",
    options: [
      { id: "a", text: "To Ship and Invoice" },
      { id: "b", text: "To Invoice" },
      { id: "c", text: "To Ship" },
      { id: "d", text: "Completed" }
    ],
    answer: "b",
    explanation:
      "The opening status reflects what is actually owed. With nothing to ship, the order opens straight at To Invoice rather than To Ship and Invoice.",
    docsUrl: Q
  },
  {
    slug: "sales.quotes.04",
    unitSlug: "quote-anatomy",
    topic: "quotes",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Converting a quote into a sales order does which of the following? (Choose all that apply.)",
    options: [
      {
        id: "a",
        text: "Carries the negotiated net unit price onto the order lines"
      },
      { id: "b", text: "Reuses the quote's opportunity for the new order" },
      { id: "c", text: "Moves the quote to Ordered, or Partial" },
      { id: "d", text: "Raises a production job for every converted line" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Conversion is a commercial handoff: the price and the opportunity carry across and the quote's status updates. Jobs come later, and only from make-to-order order lines.",
    docsUrl: G_QTC
  },
  {
    slug: "sales.quotes.05",
    unitSlug: "quote-anatomy",
    topic: "quotes",
    bloom: "apply",
    kind: "single",
    prompt:
      "Editing a quote fails with 'Cannot modify a locked quote. Reopen it first.' The quote reads Sent. What is going on?",
    options: [
      { id: "a", text: "Only the quote's owner may edit it" },
      {
        id: "b",
        text: "A quote is read-only in every status except Draft — reopen it to Draft to edit"
      },
      { id: "c", text: "The quote has expired and must be re-created" },
      { id: "d", text: "Sent quotes can be edited only from the share link" }
    ],
    answer: "b",
    explanation:
      "The lock is on leaving Draft, not on Sent specifically. Any non-Draft status is read-only, and reopen is the way back.",
    docsUrl: Q
  },
  {
    slug: "sales.quotes.06",
    unitSlug: "quote-anatomy",
    topic: "quotes",
    bloom: "analyze",
    kind: "single",
    prompt:
      "The customer accepted, then asked for a different quantity. On the quote, Reopen is disabled. Why?",
    options: [
      {
        id: "a",
        text: "Reopen is disabled once the quote has become an order — the order is now the live document"
      },
      { id: "b", text: "Reopen needs the sales delete permission" },
      { id: "c", text: "The quote's expiration date has passed" },
      { id: "d", text: "Reopen only works on quotes with a single line" }
    ],
    answer: "a",
    explanation:
      "Once a quote is an order, reopening it would let the two disagree. Change the order instead, while it is still Draft.",
    docsUrl: Q
  },
  {
    slug: "sales.quotes.07",
    unitSlug: "quote-anatomy",
    topic: "quotes",
    bloom: "apply",
    kind: "single",
    prompt:
      "You finalize a quote with four lines, one of which you marked No Quote. What does finalizing do to the lines?",
    options: [
      { id: "a", text: "All four lines become Complete" },
      {
        id: "b",
        text: "The three bid lines become Complete; the No Quote line is left as it is"
      },
      { id: "c", text: "The No Quote line is deleted" },
      { id: "d", text: "Nothing — line statuses are only set by hand" }
    ],
    answer: "b",
    explanation:
      "Finalizing moves the quote to Sent and marks its lines Complete, but a No Quote line is a deliberate refusal to bid and is left alone.",
    docsUrl: Q
  },
  {
    slug: "sales.quotes.08",
    unitSlug: "quote-anatomy",
    topic: "quotes",
    bloom: "remember",
    kind: "single",
    prompt:
      "Which quote line status records a line you are deliberately declining to bid?",
    options: [
      { id: "a", text: "Not Started" },
      { id: "b", text: "In Progress" },
      { id: "c", text: "No Quote" },
      { id: "d", text: "Lost" }
    ],
    answer: "c",
    explanation:
      "No Quote is a line-level outcome, not a quote-level one. Lost is the quote status for a customer declining the whole offer.",
    docsUrl: Q
  },
  {
    slug: "sales.quotes.09",
    unitSlug: "quote-anatomy",
    topic: "quotes",
    bloom: "apply",
    kind: "single",
    prompt:
      "A customer asks about six parts; you can price five and will not bid the sixth. What is the cleanest way to send the quote?",
    options: [
      { id: "a", text: "Delete the sixth line before finalizing" },
      { id: "b", text: "Price the sixth line at zero" },
      {
        id: "c",
        text: "Mark the sixth line No Quote and finalize — the other five go Complete"
      },
      { id: "d", text: "Raise two quotes and send only the priced one" }
    ],
    answer: "c",
    explanation:
      "Line statuses exist so a mixed inquiry can be answered honestly on one document: five priced, one openly declined, and the record keeps both.",
    docsUrl: Q
  },
  {
    slug: "sales.quotes.10",
    unitSlug: "quote-anatomy",
    topic: "quotes",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A Draft quote shows no customer share link. What are the two conditions for digital acceptance?",
    options: [
      {
        id: "a",
        text: "The quote must be Sent and the company must have digital quotes enabled"
      },
      { id: "b", text: "The customer must have a portal login" },
      {
        id: "c",
        text: "The quote must have an expiration date and a PO number"
      },
      { id: "d", text: "The quote must be Sent and every line Complete" }
    ],
    answer: "a",
    explanation:
      "Digital acceptance is gated twice — a company setting plus the Sent status. The share link needs no customer login at all.",
    docsUrl: Q
  },
  {
    slug: "sales.quotes.11",
    unitSlug: "quote-anatomy",
    topic: "quotes",
    bloom: "apply",
    kind: "multi",
    prompt:
      "Which are true of the customer-facing quote share link? (Choose all that apply.)",
    options: [
      { id: "a", text: "It requires no login" },
      {
        id: "b",
        text: "Internal notes are stripped before anything reaches the customer"
      },
      { id: "c", text: "Rejecting from the link moves the quote to Lost" },
      { id: "d", text: "The customer can edit the unit price on a line" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "The link is an unguessable, login-free view that records a real decision. The customer accepts or rejects — they never edit your pricing.",
    docsUrl: Q
  },
  {
    slug: "sales.quotes.12",
    unitSlug: "quote-anatomy",
    topic: "quotes",
    bloom: "remember",
    kind: "single",
    prompt:
      "What can the customer supply as part of accepting a quote from the share link?",
    options: [
      { id: "a", text: "Their PO number" },
      { id: "b", text: "A revised delivery date" },
      { id: "c", text: "A different currency" },
      { id: "d", text: "A counter-price for each line" }
    ],
    answer: "a",
    explanation:
      "Acceptance optionally captures the buyer's own PO number, so your order carries their reference from the moment it is created.",
    docsUrl: Q
  },
  {
    slug: "sales.quotes.13",
    unitSlug: "quote-anatomy",
    topic: "quotes",
    bloom: "remember",
    kind: "single",
    prompt:
      "An estimator wants to start building against a quote before the customer answers. What does Carbon allow?",
    options: [
      { id: "a", text: "Raise a job directly from the quote line" },
      {
        id: "b",
        text: "Nothing — a job is raised from a sales order line, so the sequence is always quote, order, job"
      },
      { id: "c", text: "Raise a job from the quote's opportunity" },
      { id: "d", text: "Raise a job once the quote reaches Sent" }
    ],
    answer: "b",
    explanation:
      "There is no quote-to-job path. The order is the commitment the floor builds against, which is what keeps unsold work off the schedule.",
    docsUrl: Q
  },
  {
    slug: "sales.quotes.14",
    unitSlug: "quote-anatomy",
    topic: "quotes",
    bloom: "apply",
    kind: "single",
    prompt:
      "A customer pushes back on price and you need to re-issue. What preserves the negotiation history?",
    options: [
      { id: "a", text: "Copying the quote to a new document" },
      { id: "b", text: "Editing the sent quote in place" },
      {
        id: "c",
        text: "Raising a new revision — the revision number bumps and the prior terms stay on the record"
      },
      { id: "d", text: "Marking the quote Lost and starting over" }
    ],
    answer: "c",
    explanation:
      "Revisions exist so a three-round negotiation leaves three readable versions rather than three disconnected quotes.",
    docsUrl: G_QTC
  },
  {
    slug: "sales.quotes.15",
    unitSlug: "quote-anatomy",
    topic: "quotes",
    bloom: "apply",
    kind: "single",
    prompt:
      "You pull a quote off the table yourself before the customer has answered. Which status records that?",
    options: [
      { id: "a", text: "Lost" },
      { id: "b", text: "Expired" },
      { id: "c", text: "Cancelled" },
      { id: "d", text: "Closed" }
    ],
    answer: "c",
    explanation:
      "Cancelled is withdrawal before a decision. Lost is the customer declining and Expired is the validity date lapsing — each ending has its own status.",
    docsUrl: Q
  },
  {
    slug: "sales.quotes.16",
    unitSlug: "quote-anatomy",
    topic: "quotes",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A customer emails to say they are buying elsewhere, and a rep marks the quote Cancelled. Why is that the wrong status?",
    options: [
      { id: "a", text: "Cancelled is reserved for expired quotes" },
      {
        id: "b",
        text: "A customer declining is Lost; Cancelled means you withdrew the offer before any decision"
      },
      { id: "c", text: "Cancelled cannot be set on a Sent quote" },
      { id: "d", text: "It is fine — the two statuses are interchangeable" }
    ],
    answer: "b",
    explanation:
      "The endings are not synonyms. Reporting on why deals die only works if a decline is Lost and a withdrawal is Cancelled.",
    docsUrl: Q
  },
  {
    slug: "sales.quotes.17",
    unitSlug: "quote-anatomy",
    topic: "quotes",
    bloom: "remember",
    kind: "single",
    prompt:
      "What ties a request for quote, a quote, and the eventual sales order together as one deal?",
    options: [
      { id: "a", text: "A shared opportunity with a slot for each document" },
      { id: "b", text: "A foreign key from the order back to the quote" },
      { id: "c", text: "The customer's PO number" },
      { id: "d", text: "The quote's revision number" }
    ],
    answer: "a",
    explanation:
      "The opportunity is the thread, holding a slot for the RFQ, the quote, and the order — and any slot may be empty.",
    docsUrl: G_QTC
  },
  {
    slug: "sales.quotes.18",
    unitSlug: "quote-anatomy",
    topic: "quotes",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A repeat customer phones an order in. Must you raise a quote first so the order has something to convert from?",
    options: [
      { id: "a", text: "Yes — an order always requires a source quote" },
      {
        id: "b",
        text: "No — an order can be raised cold; the opportunity threads the documents rather than forcing a sequence"
      },
      { id: "c", text: "Yes, unless the customer has a price override" },
      { id: "d", text: "No, but the order will open at Draft and stay there" }
    ],
    answer: "b",
    explanation:
      "None of the steps are mandatory. You can enter the flow wherever the deal actually starts, because the link is the opportunity, not a required chain.",
    docsUrl: G_QTC
  },
  {
    slug: "sales.quotes.19",
    unitSlug: "quote-anatomy",
    topic: "quotes",
    bloom: "apply",
    kind: "single",
    prompt:
      "The customer wants pricing for 1, 25, and 100 of the same part on one quote. What does Carbon support?",
    options: [
      {
        id: "a",
        text: "Quantity breaks on the line, so the price for one can differ from the price for a hundred"
      },
      { id: "b", text: "Three separate quotes, one per quantity" },
      { id: "c", text: "One price with a note describing the others" },
      { id: "d", text: "Three lines for the same item, priced individually" }
    ],
    answer: "a",
    explanation:
      "Quote lines carry quantity-break pricing, and the number you settle on is what carries forward to the order.",
    docsUrl: Q
  },
  {
    slug: "sales.quotes.20",
    unitSlug: "quote-anatomy",
    topic: "quotes",
    bloom: "apply",
    kind: "single",
    prompt:
      "Saving a quote line's bill of materials fails with 'An item cannot be added to itself.' What did you do?",
    options: [
      { id: "a", text: "Added the same component twice" },
      {
        id: "b",
        text: "Selected the item being made as one of its own components"
      },
      { id: "c", text: "Left the component quantity blank" },
      { id: "d", text: "Used an inactive item as a component" }
    ],
    answer: "b",
    explanation:
      "A part cannot consume itself — that would be an infinite explosion. Pick a different item for the sub-assembly or material line.",
    docsUrl: Q
  },
  {
    slug: "sales.quotes.21",
    unitSlug: "quote-anatomy",
    topic: "quotes",
    bloom: "analyze",
    kind: "single",
    prompt:
      "'Failed to convert quote to order' appears after you pick the lines. What is worth checking before retrying?",
    options: [
      { id: "a", text: "That the customer has accepted the quote digitally" },
      {
        id: "b",
        text: "That the selected lines have valid quantities and pricing, then retry with the lines re-selected"
      },
      { id: "c", text: "That the quote is still in Draft" },
      { id: "d", text: "That the quote has no No Quote lines" }
    ],
    answer: "b",
    explanation:
      "The failure comes after line selection, so the lines themselves are the first suspect — a missing quantity or price is the usual cause.",
    docsUrl: Q
  },

  // ------------------------------------------------------------- pricing (18)
  {
    slug: "sales.pricing.01",
    unitSlug: "pricing",
    topic: "pricing",
    bloom: "analyze",
    kind: "single",
    prompt:
      "An item has an override for this customer, one for their customer type, and one for all customers. All three have a break at or below the ordered quantity. Which sets the starting price?",
    options: [
      { id: "a", text: "The all-customers override — it is the widest match" },
      { id: "b", text: "The customer override, and it never falls through" },
      { id: "c", text: "The lowest of the three prices" },
      { id: "d", text: "All three, applied in sequence" }
    ],
    answer: "b",
    explanation:
      "Scope precedence is strict: customer, then customer type, then all customers. Carbon commits to the first scope that yields a break and stops looking.",
    docsUrl: PR
  },
  {
    slug: "sales.pricing.02",
    unitSlug: "pricing",
    topic: "pricing",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A customer override's smallest break is 10, and the line is for 3. There is also a customer-type override starting at 1. What happens?",
    options: [
      {
        id: "a",
        text: "The customer scope does not match, so Carbon tries the customer-type override next"
      },
      { id: "b", text: "The customer override's 10-rung price is used anyway" },
      { id: "c", text: "The line falls straight back to the base price" },
      { id: "d", text: "The line errors until a smaller break is added" }
    ],
    answer: "a",
    explanation:
      "A quantity below a scope's smallest break means that scope simply does not match — which is the only way precedence ever moves down a rung.",
    docsUrl: PR
  },
  {
    slug: "sales.pricing.03",
    unitSlug: "pricing",
    topic: "pricing",
    bloom: "apply",
    kind: "single",
    prompt:
      "An override has breaks at 1, 5, and 10. The customer orders 8. Which rung prices the line?",
    options: [
      { id: "a", text: "The 1-rung" },
      { id: "b", text: "The 5-rung" },
      { id: "c", text: "The 10-rung" },
      { id: "d", text: "An interpolation between the 5- and 10-rungs" }
    ],
    answer: "b",
    explanation:
      "Carbon takes the highest break at or below the ordered quantity. Eight does not reach the 10-rung, so the 5-rung price stands.",
    docsUrl: PR
  },
  {
    slug: "sales.pricing.04",
    unitSlug: "pricing",
    topic: "pricing",
    bloom: "apply",
    kind: "single",
    prompt:
      "A line matches both a 10% discount rule and a 15% discount rule. What discount does the customer get?",
    options: [
      { id: "a", text: "25%, the two combined" },
      { id: "b", text: "23.5%, applied in sequence" },
      {
        id: "c",
        text: "15% only — the highest-priority discount wins and the rest are discarded"
      },
      { id: "d", text: "10%, because the lower discount is safer" }
    ],
    answer: "c",
    explanation:
      "Discounts never stack. Carbon ranks matching discounts by priority, ties broken by the larger effective amount, and applies exactly one.",
    docsUrl: PR
  },
  {
    slug: "sales.pricing.05",
    unitSlug: "pricing",
    topic: "pricing",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A line matches a 20% markup rule and a 10% markup rule. How do they combine?",
    options: [
      { id: "a", text: "Only the highest-priority markup applies" },
      { id: "b", text: "They add to 30% of the starting price" },
      {
        id: "c",
        text: "Both apply in priority order, each computed against the already-adjusted running price, so they compound"
      },
      { id: "d", text: "They average to 15%" }
    ],
    answer: "c",
    explanation:
      "Markups are the mirror image of discounts: every matching one applies, and each is calculated on the running price, so the effect compounds.",
    docsUrl: PR
  },
  {
    slug: "sales.pricing.06",
    unitSlug: "pricing",
    topic: "pricing",
    bloom: "remember",
    kind: "single",
    prompt: "In what order does the engine apply rules to the starting price?",
    options: [
      {
        id: "a",
        text: "Discounts, then the markup stack, then the zero floor"
      },
      { id: "b", text: "Markups, then discounts, then the zero floor" },
      { id: "c", text: "Whichever rule has the highest priority, alone" },
      { id: "d", text: "Alphabetically by rule name" }
    ],
    answer: "a",
    explanation:
      "One discount lands first, then every matching markup compounds on top, and finally a negative result is floored at zero.",
    docsUrl: PR
  },
  {
    slug: "sales.pricing.07",
    unitSlug: "pricing",
    topic: "pricing",
    bloom: "apply",
    kind: "single",
    prompt:
      "You enter 15 in the Amount field of a Percentage discount rule and get 'Percentage must be between 0% and 100%'. What should you enter?",
    options: [
      { id: "a", text: "15.0" },
      {
        id: "b",
        text: "0.15 — a percentage is stored as a fraction from 0 to 1"
      },
      { id: "c", text: "1.15" },
      { id: "d", text: "-15, since a discount lowers the price" }
    ],
    answer: "b",
    explanation:
      "The field holds a fraction, so 15 would be a 1500% adjustment and the validator refuses it. Ten percent is 0.10.",
    docsUrl: PR
  },
  {
    slug: "sales.pricing.08",
    unitSlug: "pricing",
    topic: "pricing",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A customer has a negotiated override price and also qualifies for an active 10% discount rule, but the line shows the override price untouched. What explains it?",
    options: [
      {
        id: "a",
        text: "The winning override has Apply rules on top switched off, so rules are skipped for it"
      },
      { id: "b", text: "Overrides always suppress rules" },
      { id: "c", text: "Discounts never apply to a customer-scoped override" },
      {
        id: "d",
        text: "A company setting disables rules whenever an override wins"
      }
    ],
    answer: "a",
    explanation:
      "Whether rules layer onto an override price is a per-override flag, not a global one — turn Apply rules on top back on if you want the discount.",
    docsUrl: PR
  },
  {
    slug: "sales.pricing.09",
    unitSlug: "pricing",
    topic: "pricing",
    bloom: "analyze",
    kind: "multi",
    prompt: "Which are true of a price override? (Choose all that apply.)",
    options: [
      {
        id: "a",
        text: "It replaces the base price outright rather than adjusting it"
      },
      {
        id: "b",
        text: "It targets exactly one scope: customer, customer type, or all customers"
      },
      { id: "c", text: "It needs at least one quantity break to save" },
      {
        id: "d",
        text: "Several overrides can combine on the same line, cheapest first"
      }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "An override is a price list, not a discount. One scope wins outright and sets the starting price; overrides never stack with one another.",
    docsUrl: PR
  },
  {
    slug: "sales.pricing.10",
    unitSlug: "pricing",
    topic: "pricing",
    bloom: "apply",
    kind: "single",
    prompt:
      "Saving an override fails with 'Cannot set both Customer and Customer Type'. What is the fix?",
    options: [
      {
        id: "a",
        text: "Clear one of them — leave both blank only for an all-customers override"
      },
      { id: "b", text: "Create two overrides with the same breaks" },
      { id: "c", text: "Set the customer type to match the customer's type" },
      { id: "d", text: "Clear the quantity breaks and re-add them" }
    ],
    answer: "a",
    explanation:
      "The scope is exclusive and the database enforces it. Blank on both is not an error — that is how you write an all-customers override.",
    docsUrl: PR
  },
  {
    slug: "sales.pricing.11",
    unitSlug: "pricing",
    topic: "pricing",
    bloom: "apply",
    kind: "single",
    prompt:
      "An override's break table is rejected with 'Duplicate quantity across breaks'. What is wrong?",
    options: [
      { id: "a", text: "Two rungs share the same quantity" },
      { id: "b", text: "Two rungs share the same price" },
      { id: "c", text: "The quantities are not in ascending order" },
      { id: "d", text: "A rung has a quantity of zero" }
    ],
    answer: "a",
    explanation:
      "Each rung must have a unique quantity, otherwise the highest-break-at-or-below rule would have two answers for the same order quantity.",
    docsUrl: PR
  },
  {
    slug: "sales.pricing.12",
    unitSlug: "pricing",
    topic: "pricing",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A discount rule is active and the customer matches it, but no discount appears on the line and no error is shown. What should you check first?",
    options: [
      {
        id: "a",
        text: "Whether the line quantity is inside the rule's min/max and the date inside its valid window"
      },
      { id: "b", text: "Whether the customer has a price override" },
      { id: "c", text: "Whether the rule's priority is above zero" },
      { id: "d", text: "Whether the item has a unit sale price" }
    ],
    answer: "a",
    explanation:
      "A rule only fires when every set condition holds — quantity range, date window, and item/customer restrictions. Falling outside one is silently skipped, not an error.",
    docsUrl: PR
  },
  {
    slug: "sales.pricing.13",
    unitSlug: "pricing",
    topic: "pricing",
    bloom: "remember",
    kind: "single",
    prompt:
      "A pricing rule's Customers and Items lists are both left empty. What does that mean?",
    options: [
      { id: "a", text: "The rule never fires" },
      { id: "b", text: "The rule applies to all customers and all items" },
      { id: "c", text: "The rule applies only to items with no posting group" },
      { id: "d", text: "The rule is invalid and cannot be saved" }
    ],
    answer: "b",
    explanation:
      "Empty means unrestricted. Restrictions narrow a rule; leaving them off is how you write a company-wide adjustment.",
    docsUrl: PR
  },
  {
    slug: "sales.pricing.14",
    unitSlug: "pricing",
    topic: "pricing",
    bloom: "remember",
    kind: "single",
    prompt:
      "A seasonal discount rule is finished with, but finance wants it retrievable for audit. What do you do?",
    options: [
      { id: "a", text: "Delete it — the price trace on old lines is enough" },
      {
        id: "b",
        text: "Set Active off; inactive rules are skipped but retained"
      },
      { id: "c", text: "Set its amount to zero" },
      {
        id: "d",
        text: "Set its valid-to date to yesterday and delete it next year"
      }
    ],
    answer: "b",
    explanation:
      "The Active flag exists precisely so a rule can stop firing without disappearing from the record.",
    docsUrl: PR
  },
  {
    slug: "sales.pricing.15",
    unitSlug: "pricing",
    topic: "pricing",
    bloom: "analyze",
    kind: "single",
    prompt:
      "The engine resolves £14.20 on a line, but the customer was verbally promised £13.50. What can you do?",
    options: [
      {
        id: "a",
        text: "Type £13.50 over it — resolution fills in a suggested price, it does not lock the field"
      },
      { id: "b", text: "Nothing; the resolved price is final once written" },
      {
        id: "c",
        text: "Delete the line and re-add it with a different quantity"
      },
      {
        id: "d",
        text: "Create a one-off override before the line will accept an edit"
      }
    ],
    answer: "a",
    explanation:
      "Price resolution is a value, not a lock. It runs when the item or quantity changes and records a trace of how it got there; the number stays editable.",
    docsUrl: PR
  },
  {
    slug: "sales.pricing.16",
    unitSlug: "pricing",
    topic: "pricing",
    bloom: "apply",
    kind: "multi",
    prompt: "Where does this same pricing engine run? (Choose all that apply.)",
    options: [
      { id: "a", text: "On a quote line, during cost rollup and re-price" },
      {
        id: "b",
        text: "On a sales order line, when you pick an item or change the quantity"
      },
      { id: "c", text: "On a purchase order line, to price what you buy" },
      {
        id: "d",
        text: "Inside a database trigger, so the price is set on write"
      }
    ],
    answer: ["a", "b"],
    explanation:
      "One engine prices both sell-side surfaces, and it runs in the application rather than the database — which is why both line types carry the same trace.",
    docsUrl: PR
  },
  {
    slug: "sales.pricing.17",
    unitSlug: "pricing",
    topic: "pricing",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A new hire asks where to find a customer's price list document. What do you tell them?",
    options: [
      { id: "a", text: "It is generated when the first quote is sent" },
      {
        id: "b",
        text: "There is no such document — a price list is simply the set of overrides scoped to that customer or their type"
      },
      { id: "c", text: "It lives on the customer record as a file attachment" },
      { id: "d", text: "It is the set of pricing rules naming that customer" }
    ],
    answer: "b",
    explanation:
      "Carbon has no price-list entity. The overrides scoped to a customer are the price list, which is why Duplicate price list copies overrides between scopes.",
    docsUrl: PR
  },
  {
    slug: "sales.pricing.18",
    unitSlug: "pricing",
    topic: "pricing",
    bloom: "apply",
    kind: "single",
    prompt:
      "You can edit an override's breaks but its Valid To and Active fields are greyed out. Why?",
    options: [
      { id: "a", text: "The override has already been used on a posted order" },
      {
        id: "b",
        text: "Those lifecycle fields lock after creation unless you hold the sales delete permission"
      },
      { id: "c", text: "The override is scoped to all customers" },
      { id: "d", text: "The valid window has already closed" }
    ],
    answer: "b",
    explanation:
      "Retiring an override is treated as a destructive act: editing needs sales update, but the lifecycle fields need sales delete.",
    docsUrl: PR
  },

  // ---------------------------------------------------- orders — anatomy (11)
  {
    slug: "sales.orders.01",
    unitSlug: "order-anatomy",
    topic: "orders",
    bloom: "apply",
    kind: "single",
    prompt:
      "A line reads: sale quantity 100, quantity sent 40, quantity invoiced 0. What are the remainders?",
    options: [
      { id: "a", text: "60 to send, 100 to invoice" },
      { id: "b", text: "60 to send, 60 to invoice" },
      { id: "c", text: "40 to send, 40 to invoice" },
      {
        id: "d",
        text: "60 to send, nothing to invoice until shipping finishes"
      }
    ],
    answer: "a",
    explanation:
      "The two counters are independent. Nothing has been billed, so the whole 100 is still to invoice even though only 40 has gone out.",
    docsUrl: SO
  },
  {
    slug: "sales.orders.02",
    unitSlug: "order-anatomy",
    topic: "orders",
    bloom: "remember",
    kind: "single",
    prompt: "When does a sales order line finally close?",
    options: [
      { id: "a", text: "When it is fully shipped" },
      { id: "b", text: "When it is fully invoiced" },
      { id: "c", text: "When it is both fully sent and fully invoiced" },
      { id: "d", text: "When someone marks it complete" }
    ],
    answer: "c",
    explanation:
      "Both counters must land. That single rule is what lets one order ship and bill in pieces without ever losing the remainder.",
    docsUrl: G_OTC
  },
  {
    slug: "sales.orders.03",
    unitSlug: "order-anatomy",
    topic: "orders",
    bloom: "apply",
    kind: "single",
    prompt:
      "A line reads: sold 100, sent 100, invoiced 60. What is still outstanding on it?",
    options: [
      { id: "a", text: "Nothing — it shipped in full" },
      { id: "b", text: "40 to invoice; the line stays open" },
      { id: "c", text: "40 to send and 40 to invoice" },
      { id: "d", text: "The line closed when the last shipment posted" }
    ],
    answer: "b",
    explanation:
      "Shipping in full only satisfies half the line. Until the invoiced quantity also reaches 100 the line is still owed.",
    docsUrl: SO
  },
  {
    slug: "sales.orders.04",
    unitSlug: "order-anatomy",
    topic: "orders",
    bloom: "remember",
    kind: "single",
    prompt: "Which are the three fulfillment methods on a sales order line?",
    options: [
      {
        id: "a",
        text: "Make to Order, Pull from Inventory, Purchase to Order"
      },
      { id: "b", text: "Make, Buy, Transfer" },
      { id: "c", text: "Stock, Job, Drop Ship" },
      { id: "d", text: "Inventory, Job, Service" }
    ],
    answer: "a",
    explanation:
      "The method decides where the goods come from — built, picked from stock, or bought in for this order — and drop-ship is a variant of Purchase to Order.",
    docsUrl: SO
  },
  {
    slug: "sales.orders.05",
    unitSlug: "order-anatomy",
    topic: "orders",
    bloom: "apply",
    kind: "single",
    prompt:
      "You select every line on an order and run convert-lines-to-jobs, and get 'No jobs were created'. What is the likely cause?",
    options: [
      { id: "a", text: "The order is still in Draft" },
      {
        id: "b",
        text: "None of the selected lines uses the Make method — Pull from Inventory and Purchase to Order lines never produce jobs"
      },
      { id: "c", text: "The items have no on-hand quantity" },
      { id: "d", text: "The order has no location set" }
    ],
    answer: "b",
    explanation:
      "Only make lines are eligible. A stocked or bought-in line has nothing to build, so the action finds nothing to convert.",
    docsUrl: SO
  },
  {
    slug: "sales.orders.06",
    unitSlug: "order-anatomy",
    topic: "orders",
    bloom: "apply",
    kind: "single",
    prompt:
      "A customer wants a bought-in accessory sent directly from your supplier to their site. Which line setup does that?",
    options: [
      { id: "a", text: "Pull from Inventory, with a note for the warehouse" },
      { id: "b", text: "Make to Order, with the supplier as a partner" },
      {
        id: "c",
        text: "Purchase to Order in its drop-ship variant — the goods never touch your dock"
      },
      { id: "d", text: "A Comment line naming the supplier" }
    ],
    answer: "c",
    explanation:
      "Drop-ship is the Purchase to Order variant where the supplier ships straight to your customer, so no receipt or shipment passes through your building.",
    docsUrl: G_OTC
  },
  {
    slug: "sales.orders.07",
    unitSlug: "order-anatomy",
    topic: "orders",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Which downstream documents trace back to a sales order line? (Choose all that apply.)",
    options: [
      { id: "a", text: "Shipments" },
      { id: "b", text: "Invoices" },
      { id: "c", text: "Make-to-order jobs" },
      { id: "d", text: "The customer record itself" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "The order is the document fulfillment keys off. Shipments, invoices, and jobs all point back at its lines, which is what makes the line a scoreboard.",
    docsUrl: SO
  },
  {
    slug: "sales.orders.08",
    unitSlug: "order-anatomy",
    topic: "orders",
    bloom: "remember",
    kind: "single",
    prompt:
      "You need a packing instruction printed on the order that must not be charged for. Which line type?",
    options: [
      { id: "a", text: "Service" },
      { id: "b", text: "Comment" },
      { id: "c", text: "Consumable" },
      { id: "d", text: "Fixed Asset" }
    ],
    answer: "b",
    explanation:
      "A Comment line is a non-charged note that rides along with the order. Service is a real, billable item type.",
    docsUrl: SO
  },
  {
    slug: "sales.orders.09",
    unitSlug: "order-anatomy",
    topic: "orders",
    bloom: "apply",
    kind: "single",
    prompt:
      "Adding a line to a confirmed order fails with 'Cannot add lines to a locked sales order. Reopen it first.' What is the honest path forward?",
    options: [
      { id: "a", text: "Raise a second order for the extra line" },
      {
        id: "b",
        text: "Reopen the order to Draft — fulfillment that already happened stays on the books"
      },
      { id: "c", text: "Cancel the order and re-enter it" },
      { id: "d", text: "Ask an admin to unlock the order's status field" }
    ],
    answer: "b",
    explanation:
      "An order is locked from confirmation onward; only Draft is freely editable. Reopening does not undo posted shipments or invoices.",
    docsUrl: SO
  },
  {
    slug: "sales.orders.10",
    unitSlug: "order-anatomy",
    topic: "orders",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Converting a make line to a job fails with 'Failed to insert job'. What are the usual causes?",
    options: [
      {
        id: "a",
        text: "The item has no active make method, or no valid location is set"
      },
      { id: "b", text: "The order is not yet confirmed" },
      { id: "c", text: "The line has already been partially shipped" },
      { id: "d", text: "The customer has no default location" }
    ],
    answer: "a",
    explanation:
      "A job needs something to build to and somewhere to build it. Check the item's method status and the order's location, then retry.",
    docsUrl: SO
  },
  {
    slug: "sales.orders.11",
    unitSlug: "order-anatomy",
    topic: "orders",
    bloom: "remember",
    kind: "single",
    prompt:
      "However a line was sourced, a shipment posts against one of only two fulfillment kinds. Which two?",
    options: [
      { id: "a", text: "Inventory or a job" },
      { id: "b", text: "Stock or a purchase order" },
      { id: "c", text: "A job or a drop-ship" },
      { id: "d", text: "A warehouse or a work center" }
    ],
    answer: "a",
    explanation:
      "Make, pull, and purchase all resolve down to goods coming from stock or from a production job — and that is what the shipment line records.",
    docsUrl: G_OTC
  },

  // -------------------------------------------- orders — status computed (10)
  {
    slug: "sales.orders.12",
    unitSlug: "order-status-is-computed",
    topic: "orders",
    bloom: "analyze",
    kind: "single",
    prompt:
      "An order has one line for 3 units. A shipment posts for 2 of them and you invoice that 2. What status does the order show?",
    options: [
      { id: "a", text: "To Invoice" },
      { id: "b", text: "Completed" },
      {
        id: "c",
        text: "To Ship and Invoice — the remaining unit is still owed on both counters"
      },
      { id: "d", text: "Partial" }
    ],
    answer: "c",
    explanation:
      "Status follows the remainder, not the last event. One unit is still to ship and to bill, so the order stays where it was and carries the remainder forward.",
    docsUrl: G_SHIP
  },
  {
    slug: "sales.orders.13",
    unitSlug: "order-status-is-computed",
    topic: "orders",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Every line on an order has now shipped in full, and nothing has been billed. What status does the order read?",
    options: [
      { id: "a", text: "To Ship" },
      { id: "b", text: "To Invoice" },
      { id: "c", text: "Completed" },
      { id: "d", text: "Closed" }
    ],
    answer: "b",
    explanation:
      "To Invoice means fully shipped and still owing an invoice. The status names what is outstanding, not what has been done.",
    docsUrl: SO
  },
  {
    slug: "sales.orders.14",
    unitSlug: "order-status-is-computed",
    topic: "orders",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A customer is billed up front and the order is invoiced in full before anything leaves the building. What status does the order read?",
    options: [
      { id: "a", text: "To Ship" },
      { id: "b", text: "To Invoice" },
      { id: "c", text: "To Ship and Invoice" },
      { id: "d", text: "Needs Approval" }
    ],
    answer: "a",
    explanation:
      "To Ship is the mirror of To Invoice: fully invoiced, still owes shipment. Bill-on-order is a first-class path, not an edge case.",
    docsUrl: SO
  },
  {
    slug: "sales.orders.15",
    unitSlug: "order-status-is-computed",
    topic: "orders",
    bloom: "apply",
    kind: "single",
    prompt:
      "The last outstanding quantity on an order has now both shipped and been invoiced. What happens to the order's status?",
    options: [
      { id: "a", text: "It stays at To Invoice until someone closes it" },
      { id: "b", text: "It becomes Completed on its own" },
      { id: "c", text: "It becomes Closed" },
      { id: "d", text: "It stays open until payment is received" }
    ],
    answer: "b",
    explanation:
      "Completed is reached, not typed — it is what the line counters add up to. Payment is settled on the invoice and does not move the order.",
    docsUrl: SO
  },
  {
    slug: "sales.orders.16",
    unitSlug: "order-status-is-computed",
    topic: "orders",
    bloom: "analyze",
    kind: "single",
    prompt:
      "The order list shows 'In Progress' but the order record reads 'To Ship and Invoice'. Which is wrong?",
    options: [
      { id: "a", text: "The list — it is showing a stale cached value" },
      { id: "b", text: "The record — the status write failed" },
      {
        id: "c",
        text: "Neither. In Progress is a computed display status meaning a make-to-order line still has unfinished jobs"
      },
      { id: "d", text: "Neither, but the record will catch up overnight" }
    ],
    answer: "c",
    explanation:
      "There are two layers: the stored status says what is owed commercially, and the display status reports what the floor is doing.",
    docsUrl: SO
  },
  {
    slug: "sales.orders.17",
    unitSlug: "order-status-is-computed",
    topic: "orders",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A manager asks you to just set an order to Completed because the customer is happy. What do you tell them?",
    options: [
      {
        id: "a",
        text: "Completed is computed from the lines' shipped and invoiced counters; to end an order early you Close it instead"
      },
      { id: "b", text: "Only an admin can set Completed" },
      { id: "c", text: "You must post a zero-quantity shipment first" },
      {
        id: "d",
        text: "Set it to Completed, then reopen it if anything is missed"
      }
    ],
    answer: "a",
    explanation:
      "The status is a consequence, not an input. Closed exists precisely so an order can be ended early without pretending it was fulfilled.",
    docsUrl: SO
  },
  {
    slug: "sales.orders.18",
    unitSlug: "order-status-is-computed",
    topic: "orders",
    bloom: "remember",
    kind: "single",
    prompt: "What is the difference between Completed and Closed on an order?",
    options: [
      {
        id: "a",
        text: "Completed is set by the system, Closed by an overnight job"
      },
      {
        id: "b",
        text: "Completed means every line shipped and invoiced; Closed means the order was ended early"
      },
      { id: "c", text: "Completed means shipped; Closed means invoiced" },
      { id: "d", text: "They are the same, kept for backwards compatibility" }
    ],
    answer: "b",
    explanation:
      "One is fulfillment reaching its end, the other is a decision to stop. Reporting depends on being able to tell those two apart.",
    docsUrl: SO
  },
  {
    slug: "sales.orders.19",
    unitSlug: "order-status-is-computed",
    topic: "orders",
    bloom: "remember",
    kind: "single",
    prompt: "What does the Needs Approval status on a sales order mean?",
    options: [
      { id: "a", text: "The customer has not accepted the quote yet" },
      { id: "b", text: "It is held for sign-off, gated on the order amount" },
      { id: "c", text: "The customer's credit check failed" },
      { id: "d", text: "A line is missing a price" }
    ],
    answer: "b",
    explanation:
      "Needs Approval is a branch off Draft for orders above the approval threshold — an internal gate, not a customer-side one.",
    docsUrl: SO
  },
  {
    slug: "sales.orders.20",
    unitSlug: "order-status-is-computed",
    topic: "orders",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Which events move a sales order's status without anyone editing the order? (Choose all that apply.)",
    options: [
      { id: "a", text: "Posting a shipment against it" },
      { id: "b", text: "Posting a sales invoice against it" },
      { id: "c", text: "Changing the customer's payment terms" },
      { id: "d", text: "Adding an internal note to the order" }
    ],
    answer: ["a", "b"],
    explanation:
      "Only posted fulfillment moves the counters, and the counters are what the status is read from. Notes and customer settings change nothing.",
    docsUrl: G_OTC
  },
  {
    slug: "sales.orders.21",
    unitSlug: "order-status-is-computed",
    topic: "orders",
    bloom: "apply",
    kind: "single",
    prompt:
      "You filter the order list for 'To Ship and Invoice' and an order a colleague swears reads 'In Progress' appears. Which status does filtering use?",
    options: [
      { id: "a", text: "The display status, so the result is a bug" },
      {
        id: "b",
        text: "The stored status — it drives filtering and the flow, while the display status is presentation"
      },
      { id: "c", text: "Whichever was written most recently" },
      { id: "d", text: "Both, joined together" }
    ],
    answer: "b",
    explanation:
      "The raw status is the one the system reasons about. In Progress is layered on top for the reader and never changes what a filter matches.",
    docsUrl: G_OTC
  },

  // ------------------------------------------------------------ shipping (15)
  {
    slug: "sales.shipping.01",
    unitSlug: "shipments",
    topic: "shipping",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You created a shipment against an order an hour ago, and the item's on-hand quantity has not moved. Why?",
    options: [
      { id: "a", text: "Inventory updates on an overnight schedule" },
      {
        id: "b",
        text: "Creating a shipment changes nothing on hand — posting is the event that relieves inventory"
      },
      { id: "c", text: "The item is not tracked, so it never moves" },
      { id: "d", text: "The shipment lines have no fulfillment set" }
    ],
    answer: "b",
    explanation:
      "A Draft shipment is a plan. Nothing about stock, the order, or the ledger changes until someone posts it.",
    docsUrl: SHP
  },
  {
    slug: "sales.shipping.02",
    unitSlug: "shipments",
    topic: "shipping",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "You post a shipment against a sales order. What happens? (Choose all that apply.)",
    options: [
      { id: "a", text: "Inventory is relieved" },
      { id: "b", text: "The source line's sent quantity rises" },
      { id: "c", text: "A sales invoice is created for what shipped" },
      {
        id: "d",
        text: "With accounting enabled, the cost of what left is booked"
      }
    ],
    answer: ["a", "b", "d"],
    explanation:
      "Posting moves stock, advances the order, and writes the cost journal. Billing is deliberately a separate step you take yourself.",
    docsUrl: G_OTC
  },
  {
    slug: "sales.shipping.03",
    unitSlug: "shipments",
    topic: "shipping",
    bloom: "apply",
    kind: "single",
    prompt:
      "A customer calls a week after delivery asking why they have had no invoice. The shipment is Posted. What went wrong?",
    options: [
      { id: "a", text: "The invoice failed to post and needs retrying" },
      {
        id: "b",
        text: "Nothing failed — posting a shipment never creates the invoice; billing is a separate step nobody has taken"
      },
      { id: "c", text: "The order was not confirmed before shipping" },
      { id: "d", text: "The invoice is waiting on the customer's PO number" }
    ],
    answer: "b",
    explanation:
      "Fulfillment and billing are decoupled on purpose, so a shipped order sitting at To Invoice is a queue to work, not an error.",
    docsUrl: SHP
  },
  {
    slug: "sales.shipping.04",
    unitSlug: "shipments",
    topic: "shipping",
    bloom: "apply",
    kind: "single",
    prompt:
      "An order line for 10 has had shipments post for 4 and then 3. What is true of the line's sent-complete flag?",
    options: [
      { id: "a", text: "It flipped on the first posted shipment" },
      {
        id: "b",
        text: "It is still off — it flips only when the cumulative shipped quantity reaches 10"
      },
      { id: "c", text: "It flipped on the second shipment, since two posted" },
      { id: "d", text: "It only flips when the line is also invoiced" }
    ],
    answer: "b",
    explanation:
      "The flag tracks the cumulative total, not the number of shipments, which is what makes repeated partial shipments first-class.",
    docsUrl: SHP
  },
  {
    slug: "sales.shipping.05",
    unitSlug: "shipments",
    topic: "shipping",
    bloom: "remember",
    kind: "single",
    prompt: "What are the two values of a shipment line's Fulfillment field?",
    options: [
      { id: "a", text: "Inventory or Job" },
      { id: "b", text: "Stock or Drop Ship" },
      { id: "c", text: "Make or Buy" },
      { id: "d", text: "Warehouse or Supplier" }
    ],
    answer: "a",
    explanation:
      "A shipment line either draws from stock or from a production job — the two kinds every fulfillment method resolves down to.",
    docsUrl: SHP
  },
  {
    slug: "sales.shipping.06",
    unitSlug: "shipments",
    topic: "shipping",
    bloom: "remember",
    kind: "single",
    prompt: "Which source documents does the one shipment model serve?",
    options: [
      { id: "a", text: "Sales orders only" },
      { id: "b", text: "Sales orders and outbound transfers only" },
      {
        id: "c",
        text: "Sales orders, purchase orders, and outbound transfers, each tagged by source"
      },
      {
        id: "d",
        text: "Any document, with a separate posting routine per type"
      }
    ],
    answer: "c",
    explanation:
      "One model and one posting routine serve every kind of goods-out, with the source tag recording which document a shipment advances.",
    docsUrl: SHP
  },
  {
    slug: "sales.shipping.07",
    unitSlug: "shipments",
    topic: "shipping",
    bloom: "apply",
    kind: "single",
    prompt:
      "The post dialog refuses with 'Shipment is empty', even though the shipment has three lines. What is missing?",
    options: [
      { id: "a", text: "A shipped quantity above zero on at least one line" },
      { id: "b", text: "A carrier and tracking number" },
      { id: "c", text: "A posting date" },
      { id: "d", text: "A confirmed source order" }
    ],
    answer: "a",
    explanation:
      "Lines drafted from what is outstanding still start at zero shipped. Enter what actually went on the truck before posting.",
    docsUrl: SHP
  },
  {
    slug: "sales.shipping.08",
    unitSlug: "shipments",
    topic: "shipping",
    bloom: "apply",
    kind: "single",
    prompt:
      "Posting fails with 'Tracked entity is not available' for a batch that is physically on the shelf. What does that mean?",
    options: [
      {
        id: "a",
        text: "The batch is not in Available status — it may be Reserved, On Hold, Consumed, or Rejected"
      },
      { id: "b", text: "The batch is in a different warehouse" },
      { id: "c", text: "The batch has no expiration date" },
      { id: "d", text: "The item is not batch tracked" }
    ],
    answer: "a",
    explanation:
      "Availability is a status, not a location. A batch held pending inspection is on the shelf and still cannot ship until the hold clears.",
    docsUrl: SHP
  },
  {
    slug: "sales.shipping.09",
    unitSlug: "shipments",
    topic: "shipping",
    bloom: "apply",
    kind: "single",
    prompt:
      "'Cannot post shipment with expired batch' names a batch on your shipment. Which are legitimate ways forward?",
    options: [
      {
        id: "a",
        text: "Allocate a different batch, or correct the expiration date with a reason, or change the company rule to Warn"
      },
      { id: "b", text: "Delete the tracked entity and re-create it" },
      { id: "c", text: "Post the shipment from the source order instead" },
      { id: "d", text: "Reduce the shipped quantity below the batch quantity" }
    ],
    answer: "a",
    explanation:
      "The block comes from the company's expired-stock rule. You either ship different stock, correct a wrong date on the record, or change the policy deliberately.",
    docsUrl: SHP
  },
  {
    slug: "sales.shipping.10",
    unitSlug: "shipments",
    topic: "shipping",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A shipment posts successfully and a 'Posted shipment with expired batch' message appears. What should you do?",
    options: [
      {
        id: "a",
        text: "Void the shipment immediately — it should not have posted"
      },
      {
        id: "b",
        text: "Nothing is broken: the company rule is Warn, so it posted and told you. Switch to Block if it should have stopped"
      },
      { id: "c", text: "Re-post it against a different batch" },
      { id: "d", text: "Ignore it; the message is only ever cosmetic" }
    ],
    answer: "b",
    explanation:
      "Warn and Block are the same check with different consequences. This is the Warn counterpart, and the fix if you wanted a stop is the setting.",
    docsUrl: SHP
  },
  {
    slug: "sales.shipping.11",
    unitSlug: "shipments",
    topic: "shipping",
    bloom: "apply",
    kind: "single",
    prompt:
      "You posted a shipment for the wrong quantity. Can you delete it and start again?",
    options: [
      { id: "a", text: "Yes, if nothing has been invoiced against it" },
      {
        id: "b",
        text: "No — a posted shipment cannot be deleted; void it, which writes reversing entries"
      },
      { id: "c", text: "Yes, deletion is allowed on the day it posted" },
      { id: "d", text: "No, and there is no way to reverse it" }
    ],
    answer: "b",
    explanation:
      "Posting has already moved inventory and the ledger. Voiding undoes it by writing the opposite entries, so the history survives.",
    docsUrl: SHP
  },
  {
    slug: "sales.shipping.12",
    unitSlug: "shipments",
    topic: "shipping",
    bloom: "apply",
    kind: "single",
    prompt:
      "Voiding a Draft shipment fails with 'Can only void posted shipments'. What should you do instead?",
    options: [
      { id: "a", text: "Post it, then void it" },
      {
        id: "b",
        text: "Edit or delete it — voiding is only for a shipment that posted"
      },
      { id: "c", text: "Move it to Pending first" },
      { id: "d", text: "Ask an admin to force the void" }
    ],
    answer: "b",
    explanation:
      "Nothing has entered the books yet, so there is nothing to reverse. Draft and Pending shipments can simply be changed or removed.",
    docsUrl: SHP
  },
  {
    slug: "sales.shipping.13",
    unitSlug: "shipments",
    topic: "shipping",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A shipment that looks correct fails with the generic 'Failed to post shipment'. What are the common underlying causes?",
    options: [
      {
        id: "a",
        text: "The accounting period for the posting date is closed or locked, or default accounts are missing"
      },
      { id: "b", text: "The customer is inactive" },
      { id: "c", text: "The source order has more than one line" },
      { id: "d", text: "The shipment has no carrier assigned" }
    ],
    answer: "a",
    explanation:
      "Posting writes to the ledger, so an accounting problem surfaces as a shipment failure. Ask for the full error text before hunting in the shipment itself.",
    docsUrl: SHP
  },
  {
    slug: "sales.shipping.14",
    unitSlug: "shipments",
    topic: "shipping",
    bloom: "remember",
    kind: "single",
    prompt: "Which shipment status means the shipment is queued to post?",
    options: [
      { id: "a", text: "Draft" },
      { id: "b", text: "Pending" },
      { id: "c", text: "Posted" },
      { id: "d", text: "Voided" }
    ],
    answer: "b",
    explanation:
      "Pending is the branch between preparing and posting. Only Posted means inventory has actually moved.",
    docsUrl: SHP
  },
  {
    slug: "sales.shipping.15",
    unitSlug: "shipments",
    topic: "shipping",
    bloom: "apply",
    kind: "single",
    prompt:
      "An order line is for 3 units and only 2 are built. You create a shipment against the order. What do you expect?",
    options: [
      {
        id: "a",
        text: "Lines drafted from what is outstanding — reduce the shipped quantity to 2 and post, leaving 1 outstanding"
      },
      { id: "b", text: "A block until all 3 are finished" },
      { id: "c", text: "An automatic split into two shipments" },
      { id: "d", text: "Lines drafted at zero, which you must add by hand" }
    ],
    answer: "a",
    explanation:
      "The shipment drafts what is still owed and you ship what actually exists. The order carries the remaining unit forward.",
    docsUrl: G_SHIP
  },

  // ------------------------------------------------------------- billing (15)
  {
    slug: "sales.billing.01",
    unitSlug: "sales-invoices",
    topic: "billing",
    bloom: "remember",
    kind: "single",
    prompt: "What can a sales invoice be raised from?",
    options: [
      { id: "a", text: "A sales order, or a posted shipment" },
      { id: "b", text: "A posted shipment only" },
      { id: "c", text: "A quote, an order, or a shipment" },
      { id: "d", text: "A sales order only" }
    ],
    answer: "a",
    explanation:
      "Bill-on-order and bill-on-ship are both supported, which is what lets you invoice before or after the goods leave.",
    docsUrl: INV
  },
  {
    slug: "sales.billing.02",
    unitSlug: "sales-invoices",
    topic: "billing",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You raise the invoice from a posted shipment of 2 rather than from the order for 3. What does that change?",
    options: [
      { id: "a", text: "Nothing — both routes bill the full ordered quantity" },
      {
        id: "b",
        text: "The invoice links back to that shipment and the billed quantity is clamped to what actually shipped"
      },
      { id: "c", text: "The order closes as soon as the invoice posts" },
      { id: "d", text: "The invoice skips Draft and posts immediately" }
    ],
    answer: "b",
    explanation:
      "The shipment path is the safeguard against billing for goods that never went out — the shipment sets the ceiling.",
    docsUrl: G_OTC
  },
  {
    slug: "sales.billing.03",
    unitSlug: "sales-invoices",
    topic: "billing",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You post a sales invoice and the customer has not paid yet. What status does it read?",
    options: [
      { id: "a", text: "Paid" },
      { id: "b", text: "Open" },
      { id: "c", text: "Submitted" },
      { id: "d", text: "Pending" }
    ],
    answer: "c",
    explanation:
      "Posting lands a sales invoice on Submitted: in the ledger, awaiting payment. Posting never marks an invoice Paid.",
    docsUrl: INV
  },
  {
    slug: "sales.billing.04",
    unitSlug: "sales-invoices",
    topic: "billing",
    bloom: "remember",
    kind: "single",
    prompt:
      "A sales invoice reads Submitted and a purchase invoice reads Open. What is the relationship between the two states?",
    options: [
      {
        id: "a",
        text: "They mean the same thing — posted to the ledger, awaiting payment"
      },
      { id: "b", text: "Submitted is posted; Open is still editable" },
      { id: "c", text: "Open means partially paid; Submitted means unpaid" },
      { id: "d", text: "Submitted is a sales-only draft state" }
    ],
    answer: "a",
    explanation:
      "The two sides name the posted state differently but behave identically — both are locked, in the books, and waiting to be settled.",
    docsUrl: INV
  },
  {
    slug: "sales.billing.05",
    unitSlug: "sales-invoices",
    topic: "billing",
    bloom: "analyze",
    kind: "multi",
    prompt: "What does posting a sales invoice do? (Choose all that apply.)",
    options: [
      {
        id: "a",
        text: "Writes receivables against sales in the ledger, when accounting is enabled"
      },
      { id: "b", text: "Bumps the invoiced quantity on each order line" },
      { id: "c", text: "Stamps the posting date" },
      { id: "d", text: "Marks the invoice Paid" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Posting records the receivable and advances the order's billing counter. Settlement is a separate posted document applied afterwards.",
    docsUrl: INV
  },
  {
    slug: "sales.billing.06",
    unitSlug: "sales-invoices",
    topic: "billing",
    bloom: "apply",
    kind: "single",
    prompt:
      "A posted sales invoice has the wrong amount on a line. What are your options?",
    options: [
      {
        id: "a",
        text: "Edit the line — invoices stay editable until they are paid"
      },
      { id: "b", text: "Delete it and raise a new one" },
      {
        id: "c",
        text: "Void it and raise a new one, or issue a credit note — it locked the moment it left Draft"
      },
      { id: "d", text: "Reopen it to Draft, as you would a sales order" }
    ],
    answer: "c",
    explanation:
      "Numbers that have entered the books cannot be changed in place, and a posted invoice cannot be deleted. Voiding writes reversing entries instead.",
    docsUrl: INV
  },
  {
    slug: "sales.billing.07",
    unitSlug: "sales-invoices",
    topic: "billing",
    bloom: "remember",
    kind: "single",
    prompt:
      "Which invoice statuses are never set by hand, but computed from the invoice's settlements and due date?",
    options: [
      { id: "a", text: "Draft and Pending" },
      { id: "b", text: "Overdue, Partially Paid, and Paid" },
      { id: "c", text: "Submitted and Voided" },
      { id: "d", text: "Credit Note Issued and Voided" }
    ],
    answer: "b",
    explanation:
      "Those three are derived, so the ledger and the balance always agree — an unpaid invoice past its due date reads Overdue on its own.",
    docsUrl: INV
  },
  {
    slug: "sales.billing.08",
    unitSlug: "sales-invoices",
    topic: "billing",
    bloom: "apply",
    kind: "single",
    prompt:
      "A customer's cheque arrives for a Submitted invoice. How is it recorded?",
    options: [
      {
        id: "a",
        text: "As a payment of type Receipt, applied to the invoice through a settlement"
      },
      { id: "b", text: "As a payment of type Disbursement" },
      { id: "c", text: "By ticking Paid on the invoice" },
      { id: "d", text: "As a debit memo against the customer" }
    ],
    answer: "a",
    explanation:
      "A Receipt is money in from a customer and settles sales invoices; a Disbursement is money out to a supplier. Neither is a field on the invoice.",
    docsUrl: INV
  },
  {
    slug: "sales.billing.09",
    unitSlug: "sales-invoices",
    topic: "billing",
    bloom: "remember",
    kind: "single",
    prompt:
      "You want to bill freight straight to a ledger account on a sales invoice, with no item behind it. What does Carbon offer?",
    options: [
      { id: "a", text: "A G/L Account line" },
      {
        id: "b",
        text: "No G/L Account line on the sales side — that type exists only on purchase invoices"
      },
      { id: "c", text: "A Comment line with an account code" },
      { id: "d", text: "A Fixed Asset line pointed at the freight account" }
    ],
    answer: "b",
    explanation:
      "The two sides differ in exactly one place: purchase invoices get G/L Account lines, sales invoices get Fixed Asset lines instead.",
    docsUrl: INV
  },
  {
    slug: "sales.billing.10",
    unitSlug: "sales-invoices",
    topic: "billing",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A customer sends 5,000 against a single open invoice of 4,200. What does Carbon do?",
    options: [
      { id: "a", text: "Rejects the payment as an overpayment" },
      {
        id: "b",
        text: "Applies 4,200 to that invoice and leaves 800 on the customer's account as an unapplied credit"
      },
      {
        id: "c",
        text: "Applies all 5,000 and shows the invoice with a negative balance"
      },
      { id: "d", text: "Splits the excess into a new invoice" }
    ],
    answer: "b",
    explanation:
      "A settlement can never exceed one invoice's open balance, but the payment's cash total may exceed what it applies — the excess waits for a later invoice.",
    docsUrl: INV
  },
  {
    slug: "sales.billing.11",
    unitSlug: "sales-invoices",
    topic: "billing",
    bloom: "apply",
    kind: "single",
    prompt:
      "Applying a credit memo to a customer's invoice fails with 'Only posted credits can be applied'. What is wrong?",
    options: [
      {
        id: "a",
        text: "The memo is still Draft (or has been voided) — post it first"
      },
      { id: "b", text: "The memo belongs to a supplier" },
      { id: "c", text: "The invoice is not yet overdue" },
      { id: "d", text: "The memo has no bank account set" }
    ],
    answer: "a",
    explanation:
      "Only a posted balance can settle anything. A memo moves Draft to Posted to Voided just as an invoice does.",
    docsUrl: INV
  },
  {
    slug: "sales.billing.12",
    unitSlug: "sales-invoices",
    topic: "billing",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You post a credit memo applied against a customer's Submitted invoice. What does the invoice read afterwards?",
    options: [
      { id: "a", text: "Voided" },
      { id: "b", text: "Credit Note Issued" },
      { id: "c", text: "Debit Note Issued" },
      { id: "d", text: "Draft, so it can be corrected" }
    ],
    answer: "b",
    explanation:
      "Credit Note Issued is the customer-side memo status; Debit Note Issued is its supplier-side counterpart. The invoice is settled, not erased.",
    docsUrl: INV
  },
  {
    slug: "sales.billing.13",
    unitSlug: "sales-invoices",
    topic: "billing",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Which amounts can an invoice settlement carry? (Choose all that apply.)",
    options: [
      { id: "a", text: "Applied — cash or credit that reduces the balance" },
      {
        id: "b",
        text: "Discount — an early-payment discount you are granting"
      },
      {
        id: "c",
        text: "Write-off — a small remainder forgiven to the write-off account"
      },
      { id: "d", text: "Tax — the portion of the invoice's tax being settled" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "A settlement carries three amounts and at least one must be positive. A memo-sourced settlement can only carry the applied amount.",
    docsUrl: INV
  },
  {
    slug: "sales.billing.14",
    unitSlug: "sales-invoices",
    topic: "billing",
    bloom: "apply",
    kind: "single",
    prompt:
      "After a payment posts, an invoice is left with a balance of 0.004. Does it sit unpaid forever?",
    options: [
      { id: "a", text: "Yes, until someone writes off the remainder" },
      {
        id: "b",
        text: "No — a balance under one cent is forgiven as dust; the invoice reads Paid with a zero balance"
      },
      { id: "c", text: "No, it is rounded up on the next statement run" },
      {
        id: "d",
        text: "Yes, and it will be flagged Overdue after the due date"
      }
    ],
    answer: "b",
    explanation:
      "Dust below the smallest unit the currency can represent is treated as settled, rather than leaving an invoice a fraction of a cent short forever.",
    docsUrl: INV
  },
  {
    slug: "sales.billing.15",
    unitSlug: "sales-invoices",
    topic: "billing",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Voiding a posted sales invoice is refused because payments are applied to it. What is the correct sequence?",
    options: [
      {
        id: "a",
        text: "Void the invoice, then the payments reverse automatically"
      },
      {
        id: "b",
        text: "Reverse or unapply the payments first, then void the invoice"
      },
      { id: "c", text: "Edit the payment's applications to zero, then void" },
      { id: "d", text: "Delete the invoice instead" }
    ],
    answer: "b",
    explanation:
      "Settlements have to come off before the thing they settle can be reversed. A posted payment's applications are frozen, so void the payment and re-enter it.",
    docsUrl: INV
  }
];
