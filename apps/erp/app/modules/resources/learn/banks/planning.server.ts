/**
 * Planning — question bank. SERVER ONLY.
 *
 * Planning is arithmetic-shaped, so most of these make you work a number out:
 * the distractors are the answers you land on by forgetting one modifier. The
 * rest lean on the two boundaries the docs keep drawing — MRP suggests but
 * never orders, and planning sizes but never schedules.
 */

import type { LearnQuestion } from "../types";

const D = "https://docs.carbon.ms";
const PLAN = `${D}/docs/reference/planning`;
const FCST = `${D}/docs/reference/forecast`;
const REORD = `${D}/docs/reference/reordering`;
const G_PLAN = `${D}/guides/plan`;

export const questions: LearnQuestion[] = [
  // ------------------------------------------------------------- demand (24)
  {
    slug: "planning.demand.01",
    unitSlug: "how-demand-accumulates",
    topic: "demand",
    bloom: "remember",
    kind: "single",
    prompt: "Where does customer demand come from when planning runs?",
    options: [
      { id: "a", text: "Open sales-order lines, by their promised date" },
      { id: "b", text: "Every sales order ever raised, by order date" },
      { id: "c", text: "Customer part records" },
      { id: "d", text: "Posted sales invoices" }
    ],
    answer: "a",
    explanation:
      "Only open sales-order lines are still owed, and the promised date is the date the customer expects them — that is the week the demand lands in.",
    docsUrl: `${PLAN}#what-feeds-it`
  },
  {
    slug: "planning.demand.02",
    unitSlug: "how-demand-accumulates",
    topic: "demand",
    bloom: "remember",
    kind: "single",
    prompt: "What supplies production demand to planning?",
    options: [
      { id: "a", text: "Every material on every job, issued or not" },
      { id: "b", text: "Job material still to issue, offset by lead time" },
      { id: "c", text: "The routing's operation times" },
      { id: "d", text: "Completed job quantities" }
    ],
    answer: "b",
    explanation:
      "Material already issued has come out of stock and is no longer owed. What is still to issue is the real remaining need, dated earlier by the part's lead time.",
    docsUrl: `${PLAN}#what-feeds-it`
  },
  {
    slug: "planning.demand.03",
    unitSlug: "how-demand-accumulates",
    topic: "demand",
    bloom: "remember",
    kind: "single",
    prompt: "Forecast demand reaches planning from which source?",
    options: [
      { id: "a", text: "A statistical model built from shipment history" },
      { id: "b", text: "Manually entered demand projections" },
      { id: "c", text: "Open supplier quotes" },
      { id: "d", text: "The item's average weekly usage" }
    ],
    answer: "b",
    explanation:
      "Carbon has no forecasting engine. Forecast demand is exactly the numbers a person typed into the Projections grid, nothing more.",
    docsUrl: `${PLAN}#what-feeds-it`
  },
  {
    slug: "planning.demand.04",
    unitSlug: "how-demand-accumulates",
    topic: "demand",
    bloom: "remember",
    kind: "single",
    prompt: "What does planning read as a part's on-hand quantity?",
    options: [
      { id: "a", text: "The item ledger balance" },
      { id: "b", text: "The last physical count entered" },
      { id: "c", text: "The quantity on the newest receipt" },
      { id: "d", text: "The maximum inventory quantity" }
    ],
    answer: "a",
    explanation:
      "On hand is the item ledger balance — the running total of every posted movement, so planning and inventory can never disagree about what is in stock.",
    docsUrl: `${PLAN}#what-feeds-it`
  },
  {
    slug: "planning.demand.05",
    unitSlug: "how-demand-accumulates",
    topic: "demand",
    bloom: "remember",
    kind: "single",
    prompt: "Which records count as open supply?",
    options: [
      { id: "a", text: "Open jobs and open purchase-order lines" },
      { id: "b", text: "Open sales-order lines and demand projections" },
      { id: "c", text: "Draft requisitions and supplier quotes" },
      { id: "d", text: "Posted receipts only" }
    ],
    answer: "a",
    explanation:
      "Supply is what is already coming: work you have started and goods you have ordered. Sales orders and projections point the other way — they are demand.",
    docsUrl: `${PLAN}#what-feeds-it`
  },
  {
    slug: "planning.demand.06",
    unitSlug: "how-demand-accumulates",
    topic: "demand",
    bloom: "remember",
    kind: "single",
    prompt:
      "Open a week's demand on a part's planning page. Which sources can it be broken down into?",
    options: [
      { id: "a", text: "Sales Order, Job Material, Demand Projection" },
      { id: "b", text: "Sales Order, Purchase Order, Receipt" },
      { id: "c", text: "Forecast, Safety Stock, Reorder Point" },
      { id: "d", text: "Customer, Supplier, Location" }
    ],
    answer: "a",
    explanation:
      "Every unit of demand is tagged with where it came from, so an unexplained week can be traced back to the exact projections, orders, and parent jobs behind it.",
    docsUrl: `${FCST}#how-planning-consumes-it`
  },
  {
    slug: "planning.demand.07",
    unitSlug: "how-demand-accumulates",
    topic: "demand",
    bloom: "apply",
    kind: "multi",
    prompt:
      "Which of these feed the gross-demand tally? (Select all that apply.)",
    options: [
      { id: "a", text: "Open sales-order lines" },
      { id: "b", text: "Job material still to issue" },
      { id: "c", text: "Demand projections" },
      { id: "d", text: "Open purchase-order lines" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Actual demand (sales orders, job material) and projected demand are added together into gross demand. An open purchase-order line is supply — it gets netted against that tally, not added to it.",
    docsUrl: `${FCST}#how-planning-consumes-it`
  },
  {
    slug: "planning.demand.08",
    unitSlug: "how-demand-accumulates",
    topic: "demand",
    bloom: "apply",
    kind: "multi",
    prompt:
      "MRP nets demand against what you already have. Which three make up that other side? (Select all that apply.)",
    options: [
      { id: "a", text: "On hand" },
      { id: "b", text: "Open jobs" },
      { id: "c", text: "Open purchase orders" },
      { id: "d", text: "The reorder point" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Netting compares what you owe against stock plus work and goods already in flight. The reorder point is not supply — and the MRP run does not even look at it.",
    docsUrl: `${PLAN}#two-stages`
  },
  {
    slug: "planning.demand.09",
    unitSlug: "how-demand-accumulates",
    topic: "demand",
    bloom: "apply",
    kind: "single",
    prompt:
      "A part shows demand in week 9, but there is no sales order and no job that needs it that week. What is the most likely source?",
    options: [
      { id: "a", text: "A demand projection entered for that week" },
      { id: "b", text: "An open purchase order for that week" },
      { id: "c", text: "The part's reorder point" },
      { id: "d", text: "A posted receipt from last month" }
    ],
    answer: "a",
    explanation:
      "Projections are demand with no order behind them yet — that is their whole purpose. Purchase orders are supply, and the reorder point is applied later, by the planning view.",
    docsUrl: `${PLAN}#what-feeds-it`
  },
  {
    slug: "planning.demand.10",
    unitSlug: "how-demand-accumulates",
    topic: "demand",
    bloom: "apply",
    kind: "single",
    prompt:
      "A customer pushes a sales-order line's promised date out by three weeks. What happens to that line's demand?",
    options: [
      { id: "a", text: "Nothing — demand is dated by the order's entry date" },
      {
        id: "b",
        text: "It moves into the later week, because open lines are dated by their promised date"
      },
      { id: "c", text: "It stops counting until the line is re-confirmed" },
      {
        id: "d",
        text: "It stays where it was and a second demand appears in the later week"
      }
    ],
    answer: "b",
    explanation:
      "The promised date is the date planning buckets the line into, so moving it moves the demand — and with it, whatever suggestion that week was driving.",
    docsUrl: `${PLAN}#what-feeds-it`
  },
  {
    slug: "planning.demand.11",
    unitSlug: "how-demand-accumulates",
    topic: "demand",
    bloom: "apply",
    kind: "single",
    prompt:
      "You shipped and closed a sales order last week. Does it still create demand for planning?",
    options: [
      { id: "a", text: "Yes, until the invoice is posted" },
      { id: "b", text: "Yes, for the rest of the fiscal period" },
      { id: "c", text: "No — only open sales-order lines are demand" },
      { id: "d", text: "No, but the shipped quantity becomes supply" }
    ],
    answer: "c",
    explanation:
      "Demand is what you still owe. A closed line has been satisfied, so it drops out of the tally — and it certainly does not turn into supply.",
    docsUrl: `${PLAN}#what-feeds-it`
  },
  {
    slug: "planning.demand.12",
    unitSlug: "how-demand-accumulates",
    topic: "demand",
    bloom: "apply",
    kind: "single",
    prompt:
      "A job needs 200 of a component. 150 have already been issued to it. How much demand does that job contribute?",
    options: [
      { id: "a", text: "200 — the full job requirement" },
      { id: "b", text: "150 — the quantity already issued" },
      { id: "c", text: "50 — the material still to issue" },
      { id: "d", text: "0 — issued material cancels the requirement" }
    ],
    answer: "c",
    explanation:
      "Only material still to issue is demand. The 150 already issued came out of stock and is reflected in the ledger balance; counting it again would order it twice.",
    docsUrl: `${PLAN}#what-feeds-it`
  },
  {
    slug: "planning.demand.13",
    unitSlug: "how-demand-accumulates",
    topic: "demand",
    bloom: "apply",
    kind: "single",
    prompt:
      "You raised a purchase order for 500 units that has not been received yet. How does planning treat it?",
    options: [
      { id: "a", text: "As demand, until the goods arrive" },
      { id: "b", text: "As open supply, netted against demand" },
      { id: "c", text: "As on-hand stock" },
      { id: "d", text: "It is ignored until it is received and posted" }
    ],
    answer: "b",
    explanation:
      "An open purchase-order line is coverage already arranged. Ignoring it until receipt is what makes planners order the same shortfall twice.",
    docsUrl: `${PLAN}#what-feeds-it`
  },
  {
    slug: "planning.demand.14",
    unitSlug: "how-demand-accumulates",
    topic: "demand",
    bloom: "apply",
    kind: "single",
    prompt:
      "A job will consume a component in week 10, and that component has a three-week lead time. Which week does planning date the demand into?",
    options: [
      { id: "a", text: "Week 13" },
      { id: "b", text: "Week 10" },
      { id: "c", text: "Week 7" },
      { id: "d", text: "Week 1, the current week" }
    ],
    answer: "c",
    explanation:
      "Job-material demand is offset by lead time, so the need is dated three weeks earlier than the consumption. Dating it at week 10 would have you start ordering the week it is already needed.",
    docsUrl: `${PLAN}#what-feeds-it`
  },
  {
    slug: "planning.demand.15",
    unitSlug: "how-demand-accumulates",
    topic: "demand",
    bloom: "apply",
    kind: "single",
    prompt:
      "A purchased bearing has no projection of its own. Will planning ever suggest ordering it?",
    options: [
      {
        id: "a",
        text: "Yes — it inherits demand through the BOM explosion of the make parts that use it"
      },
      { id: "b", text: "No — a part without a projection is never planned" },
      {
        id: "c",
        text: "Only if someone raises a sales order for the bearing itself"
      },
      { id: "d", text: "Only if it is switched to a Make replenishment system" }
    ],
    answer: "a",
    explanation:
      "You project the things you build; their components pick up demand when MRP explodes the parent's method down the bill of materials.",
    docsUrl: `${FCST}#how-planning-consumes-it`
  },
  {
    slug: "planning.demand.16",
    unitSlug: "how-demand-accumulates",
    topic: "demand",
    bloom: "apply",
    kind: "single",
    prompt:
      "The same part is consumed at two plants at very different rates. How does Carbon handle that?",
    options: [
      { id: "a", text: "Demand is company-wide; the plants share one number" },
      {
        id: "b",
        text: "Demand is scoped per location, so the part can carry different numbers at each plant"
      },
      { id: "c", text: "You must create a separate item for each plant" },
      { id: "d", text: "Only the default location is planned" }
    ],
    answer: "b",
    explanation:
      "Projections and planning are both location-scoped, so one part can be planned aggressively at a busy site and lightly at a quiet one.",
    docsUrl: `${FCST}#fields`
  },
  {
    slug: "planning.demand.17",
    unitSlug: "how-demand-accumulates",
    topic: "demand",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Why is job-material demand offset by lead time instead of dated on the day the job consumes it?",
    options: [
      {
        id: "a",
        text: "So the need surfaces early enough for the component to be there when the job reaches it"
      },
      { id: "b", text: "To delay the demand until the job is finished" },
      { id: "c", text: "To convert the demand into supply" },
      { id: "d", text: "To round the quantity up to a lot size" }
    ],
    answer: "a",
    explanation:
      "A shortfall you learn about on the day you need it is not actionable. The offset is what turns a requirement into an order you can still place in time.",
    docsUrl: `${PLAN}#what-feeds-it`
  },
  {
    slug: "planning.demand.18",
    unitSlug: "how-demand-accumulates",
    topic: "demand",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Why does a shortfall on a top-level assembly turn into demand on parts nobody ordered?",
    options: [
      {
        id: "a",
        text: "Because every part shares the assembly's reorder point"
      },
      {
        id: "b",
        text: "Because MRP explodes the demand through the bill of materials, offsetting each component for its own lead time"
      },
      {
        id: "c",
        text: "Because the assembly's sales order is copied to each component"
      },
      {
        id: "d",
        text: "Because components inherit the assembly's on-hand balance"
      }
    ],
    answer: "b",
    explanation:
      "The explosion is the whole point of MRP: one gap at the top becomes the right quantity of every component, each dated by its own lead time.",
    docsUrl: PLAN
  },
  {
    slug: "planning.demand.19",
    unitSlug: "how-demand-accumulates",
    topic: "demand",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You expect to consume 100 next quarter and already have a job for 30 in flight. A colleague says to project 70 so it is not planned twice. Why is that wrong?",
    options: [
      {
        id: "a",
        text: "A projection enters gross demand at face value, and the in-flight job is credited once during the BOM explosion — projecting 70 understates the demand"
      },
      {
        id: "b",
        text: "Projections are always doubled, so 50 is the right entry"
      },
      {
        id: "c",
        text: "Open jobs are ignored by planning, so 70 would be under-ordered by 30"
      },
      {
        id: "d",
        text: "Projections cannot be edited once entered, so the number must be exact"
      }
    ],
    answer: "a",
    explanation:
      "Netting is planning's job, not yours. Type what you expect to consume; firm job and purchase-order supply is credited exactly once in the running balance.",
    docsUrl: `${FCST}#how-planning-consumes-it`
  },
  {
    slug: "planning.demand.20",
    unitSlug: "how-demand-accumulates",
    topic: "demand",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Which of these is NOT one of the sources a unit of demand can be traced back to?",
    options: [
      { id: "a", text: "Sales Order" },
      { id: "b", text: "Job Material" },
      { id: "c", text: "Demand Projection" },
      { id: "d", text: "Purchase Order" }
    ],
    answer: "d",
    explanation:
      "A purchase order is supply — it covers demand rather than creating it, so it never appears as a demand source in the lineage.",
    docsUrl: `${FCST}#how-planning-consumes-it`
  },
  {
    slug: "planning.demand.21",
    unitSlug: "how-demand-accumulates",
    topic: "demand",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A planner sees 240 units of demand in week 6 and cannot account for it. What is the quickest way to find out where it came from?",
    options: [
      { id: "a", text: "Re-run MRP and see whether the number changes" },
      {
        id: "b",
        text: "Open that week's demand on the part's planning page and read the projections, orders, and parent jobs that make it up"
      },
      {
        id: "c",
        text: "Compare the part's on-hand balance against the reorder point"
      },
      { id: "d", text: "Export the item ledger for the last six weeks" }
    ],
    answer: "b",
    explanation:
      "Every unit is tagged with its source, so the breakdown answers the question directly. Re-running MRP just rebuilds the same number.",
    docsUrl: `${FCST}#how-planning-consumes-it`
  },
  {
    slug: "planning.demand.22",
    unitSlug: "how-demand-accumulates",
    topic: "demand",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A part has 500 on hand and planning still suggests ordering more. Which explanation actually fits how planning works?",
    options: [
      { id: "a", text: "Planning ignores on-hand stock" },
      {
        id: "b",
        text: "The planning view projects stock week by week, and demand later in the horizon drives the balance below where it should sit"
      },
      {
        id: "c",
        text: "On hand only counts once it has been physically counted"
      },
      { id: "d", text: "Sales-order demand is counted twice for safety" }
    ],
    answer: "b",
    explanation:
      "Planning is forward-looking. A comfortable balance today says nothing about week 9, which is exactly the shortfall a week-by-week projection is meant to catch.",
    docsUrl: `${PLAN}#two-stages`
  },
  {
    slug: "planning.demand.23",
    unitSlug: "how-demand-accumulates",
    topic: "demand",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Which two statements about how planning dates demand are correct? (Select all that apply.)",
    options: [
      {
        id: "a",
        text: "Open sales-order lines are dated by their promised date"
      },
      { id: "b", text: "Job material still to issue is offset by lead time" },
      { id: "c", text: "All demand is dated on the day MRP runs" },
      {
        id: "d",
        text: "Demand projections are dated by the supplier's ship date"
      }
    ],
    answer: ["a", "b"],
    explanation:
      "Each source carries its own dating rule, which is why demand lands in the right weekly bucket instead of piling up on the run date.",
    docsUrl: `${PLAN}#what-feeds-it`
  },
  {
    slug: "planning.demand.24",
    unitSlug: "how-demand-accumulates",
    topic: "demand",
    bloom: "analyze",
    kind: "single",
    prompt:
      "What is the drawback of planning against confirmed sales orders alone?",
    options: [
      {
        id: "a",
        text: "Confirmed orders cannot be exploded through a bill of materials"
      },
      {
        id: "b",
        text: "You are always reacting — long-lead parts are only ordered once the order exists, which may be too late"
      },
      { id: "c", text: "Sales orders do not carry dates" },
      { id: "d", text: "Reorder policies stop working without a projection" }
    ],
    answer: "b",
    explanation:
      "A pipeline that is real but unbooked is still demand. Projecting it is what gets long-lead parts on order before the order that needs them lands.",
    docsUrl: `${G_PLAN}#demand-forecasting`
  },

  // ----------------------------------------------------------- forecast (21)
  {
    slug: "planning.forecast.01",
    unitSlug: "forecast",
    topic: "forecast",
    bloom: "remember",
    kind: "single",
    prompt: "Where do you enter demand projections?",
    options: [
      { id: "a", text: "Production → Projections" },
      { id: "b", text: "Sales → Forecast" },
      { id: "c", text: "Inventory → Planning" },
      { id: "d", text: "On each purchase order line" }
    ],
    answer: "a",
    explanation:
      "Projections live under Production because you project the parts you build; their components inherit the demand through the bill of materials.",
    docsUrl: FCST
  },
  {
    slug: "planning.forecast.02",
    unitSlug: "forecast",
    topic: "forecast",
    bloom: "remember",
    kind: "single",
    prompt: "How far forward does the projection grid run?",
    options: [
      { id: "a", text: "12 weeks" },
      { id: "b", text: "26 weeks" },
      { id: "c", text: "52 weeks" },
      { id: "d", text: "As far as the longest lead time on the part" }
    ],
    answer: "c",
    explanation:
      "The grid is a fixed 52 weekly buckets, grouped into four quarter tabs, so a full year of expected demand can be entered in one pass.",
    docsUrl: `${FCST}#how-you-enter-one`
  },
  {
    slug: "planning.forecast.03",
    unitSlug: "forecast",
    topic: "forecast",
    bloom: "remember",
    kind: "single",
    prompt:
      "Which permission is required to create, edit, or delete a projection?",
    options: [
      { id: "a", text: "sales" },
      { id: "b", text: "purchasing" },
      { id: "c", text: "inventory" },
      { id: "d", text: "production" }
    ],
    answer: "d",
    explanation:
      "Projections are a production input, so all three actions sit behind the production permission — without it, the form's actions are blocked.",
    docsUrl: `${FCST}#how-you-enter-one`
  },
  {
    slug: "planning.forecast.04",
    unitSlug: "forecast",
    topic: "forecast",
    bloom: "remember",
    kind: "single",
    prompt: "What does week 1 of the projection grid represent?",
    options: [
      { id: "a", text: "The current week" },
      { id: "b", text: "The first week of the fiscal year" },
      { id: "c", text: "The week after the next MRP run" },
      { id: "d", text: "The first week with an open sales order" }
    ],
    answer: "a",
    explanation:
      "The grid always starts at the current week and walks forward, so the same cell means a different calendar week depending on when you open it — the list view labels it 'Present Week'.",
    docsUrl: `${FCST}#how-you-enter-one`
  },
  {
    slug: "planning.forecast.05",
    unitSlug: "forecast",
    topic: "forecast",
    bloom: "remember",
    kind: "single",
    prompt:
      "Demand that came from a projection is tagged with which source in the lineage?",
    options: [
      { id: "a", text: "Forecast" },
      { id: "b", text: "Demand Projection" },
      { id: "c", text: "MRP" },
      { id: "d", text: "Planned" }
    ],
    answer: "b",
    explanation:
      "Naming the source exactly lets a planner separate the demand somebody guessed at from the demand a customer actually committed to.",
    docsUrl: `${FCST}#how-planning-consumes-it`
  },
  {
    slug: "planning.forecast.06",
    unitSlug: "forecast",
    topic: "forecast",
    bloom: "remember",
    kind: "single",
    prompt: "Which items can you enter a projection for?",
    options: [
      { id: "a", text: "Any item in the company" },
      { id: "b", text: "Parts with a Make replenishment system" },
      { id: "c", text: "Parts with a Buy replenishment system" },
      { id: "d", text: "Only parts that already have a sales order" }
    ],
    answer: "b",
    explanation:
      "The item picker is fixed to Make parts. Purchased parts are deliberately excluded because their demand arrives through the BOM explosion instead.",
    docsUrl: `${FCST}#fields`
  },
  {
    slug: "planning.forecast.07",
    unitSlug: "forecast",
    topic: "forecast",
    bloom: "apply",
    kind: "single",
    prompt: "Two tables look alike. Which describes the difference correctly?",
    options: [
      {
        id: "a",
        text: "demandProjection is your typed input; demandForecast is planning's output, rebuilt on every MRP run"
      },
      {
        id: "b",
        text: "demandForecast is your typed input; demandProjection is planning's output"
      },
      { id: "c", text: "They are the same table under two names" },
      {
        id: "d",
        text: "demandProjection holds sales orders; demandForecast holds jobs"
      }
    ],
    answer: "a",
    explanation:
      "Input versus output is the whole distinction. The Projections screen only ever writes the input; the forecast is regenerated from scratch by each run.",
    docsUrl: `${FCST}#what-a-projection-is`
  },
  {
    slug: "planning.forecast.08",
    unitSlug: "forecast",
    topic: "forecast",
    bloom: "apply",
    kind: "single",
    prompt:
      "Someone edited the demand forecast directly and their change disappeared. What should they have done?",
    options: [
      { id: "a", text: "Re-saved the edit after the MRP run finished" },
      { id: "b", text: "Locked the forecast row before editing" },
      {
        id: "c",
        text: "Edited the projection on the Projections screen and re-run MRP"
      },
      { id: "d", text: "Raised a sales order for the difference" }
    ],
    answer: "c",
    explanation:
      "The forecast is planning's output and is rebuilt on every run, so any hand edit is transient by design. The projection is the only editable input.",
    docsUrl: `${FCST}#what-a-projection-is`
  },
  {
    slug: "planning.forecast.09",
    unitSlug: "forecast",
    topic: "forecast",
    bloom: "apply",
    kind: "single",
    prompt:
      "You type 0 into week 9 to say 'we expect nothing that week', and save. What is stored?",
    options: [
      { id: "a", text: "A row with a quantity of 0" },
      {
        id: "b",
        text: "Nothing — a blank or zero cell is deleted rather than stored"
      },
      { id: "c", text: "A row flagged as suppressed" },
      { id: "d", text: "The previous value, unchanged" }
    ],
    answer: "b",
    explanation:
      "Only non-zero weeks become rows, which keeps the grid sparse. A zero cell and an empty cell are the same thing to Carbon.",
    docsUrl: `${FCST}#how-you-enter-one`
  },
  {
    slug: "planning.forecast.10",
    unitSlug: "forecast",
    topic: "forecast",
    bloom: "apply",
    kind: "single",
    prompt:
      "One week of a part's projection is wrong, so you use Delete on the Projections list. What actually happens?",
    options: [
      { id: "a", text: "Only the visible quarter tab is cleared" },
      { id: "b", text: "Only the current week is cleared" },
      {
        id: "c",
        text: "Every future week for that item and location is cleared"
      },
      { id: "d", text: "The item is removed from planning entirely" }
    ],
    answer: "c",
    explanation:
      "Delete is an all-or-nothing clear per item and location, not a per-cell edit. To fix one week, edit that cell and save instead.",
    docsUrl: `${FCST}#how-you-enter-one`
  },
  {
    slug: "planning.forecast.11",
    unitSlug: "forecast",
    topic: "forecast",
    bloom: "apply",
    kind: "single",
    prompt:
      "You save a new projection at 4pm. When does it start affecting suggestions?",
    options: [
      {
        id: "a",
        text: "Immediately — the planning pages read projections directly"
      },
      {
        id: "b",
        text: "On the next MRP run, which reads the projection as a demand source"
      },
      { id: "c", text: "Only after a purchase order is raised" },
      { id: "d", text: "At the start of the next fiscal period" }
    ],
    answer: "b",
    explanation:
      "The run is what turns a projection into exploded, per-component demand. Until it happens, the planning pages are still reading the previous run's output.",
    docsUrl: `${FCST}#how-planning-consumes-it`
  },
  {
    slug: "planning.forecast.12",
    unitSlug: "forecast",
    topic: "forecast",
    bloom: "apply",
    kind: "single",
    prompt:
      "You expect 40 a week of a part at the Denver plant and 5 a week at Reno. How do you enter that?",
    options: [
      {
        id: "a",
        text: "One projection per location, since projections are keyed by item, location, and week"
      },
      { id: "b", text: "One projection of 45 and let planning split it" },
      { id: "c", text: "One projection at the default location only" },
      { id: "d", text: "Two separate items, one per plant" }
    ],
    answer: "a",
    explanation:
      "The location is part of the projection's key, so the same part carries genuinely different numbers per plant rather than one blended figure.",
    docsUrl: `${FCST}#fields`
  },
  {
    slug: "planning.forecast.13",
    unitSlug: "forecast",
    topic: "forecast",
    bloom: "apply",
    kind: "single",
    prompt:
      "The schema has forecastMethod and confidence columns. What does the Projections form write into them?",
    options: [
      { id: "a", text: "forecastMethod only" },
      { id: "b", text: "confidence only" },
      { id: "c", text: "Both, from the chart" },
      {
        id: "d",
        text: "Neither — they are reserved and the form writes neither"
      }
    ],
    answer: "d",
    explanation:
      "They are reserved for a forecasting engine that does not exist yet. Every projection is a hand-entered number with no method or confidence behind it.",
    docsUrl: `${FCST}#fields`
  },
  {
    slug: "planning.forecast.14",
    unitSlug: "forecast",
    topic: "forecast",
    bloom: "apply",
    kind: "multi",
    prompt:
      "Which statements about a saved demand projection are true? (Select all that apply.)",
    options: [
      { id: "a", text: "It is keyed by item, location, and weekly period" },
      { id: "b", text: "The MRP run reads it directly as a demand source" },
      { id: "c", text: "It creates a job automatically once saved" },
      { id: "d", text: "It is recalculated from sales history on each run" }
    ],
    answer: ["a", "b"],
    explanation:
      "A projection is a hand-entered demand row that the run consumes. It never creates anything by itself, and nothing regenerates it from history.",
    docsUrl: `${FCST}#what-a-projection-is`
  },
  {
    slug: "planning.forecast.15",
    unitSlug: "forecast",
    topic: "forecast",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Why does Carbon refuse to let you project demand for a purchased fastener?",
    options: [
      { id: "a", text: "Purchased parts have no lead time" },
      {
        id: "b",
        text: "Its demand should come from the BOM explosion of the make parts that consume it, not from a second, hand-typed number"
      },
      { id: "c", text: "Purchased parts cannot carry a reorder policy" },
      { id: "d", text: "Purchasing planning does not read forecasts" }
    ],
    answer: "b",
    explanation:
      "Projecting a component alongside its parent would double-count it. Restricting projections to Make parts keeps one source of truth per level of the BOM.",
    docsUrl: `${FCST}#fields`
  },
  {
    slug: "planning.forecast.16",
    unitSlug: "forecast",
    topic: "forecast",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You expect to build 100 units in week 12. A job for 30 of them is already released. What do you type into the week-12 cell?",
    options: [
      { id: "a", text: "70, so the in-flight job is not planned twice" },
      {
        id: "b",
        text: "100 — the projection's full quantity enters gross demand at face value"
      },
      { id: "c", text: "130, to cover both" },
      { id: "d", text: "0, because a released job replaces the projection" }
    ],
    answer: "b",
    explanation:
      "Projections are not pre-netted. Firm job and purchase-order supply is credited once through the explosion's running balance, so typing 70 would quietly lose 30 units of real demand.",
    docsUrl: `${FCST}#how-planning-consumes-it`
  },
  {
    slug: "planning.forecast.17",
    unitSlug: "forecast",
    topic: "forecast",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A planner asks Carbon to generate next year's projections from three years of shipment history. What can they expect?",
    options: [
      { id: "a", text: "Carbon fits a seasonality model and fills the grid" },
      { id: "b", text: "Carbon copies last year's actuals into the grid" },
      {
        id: "c",
        text: "Nothing — there is no statistical or ML forecasting engine; every projection is hand-entered"
      },
      {
        id: "d",
        text: "Carbon fills the grid but flags each cell with a confidence score"
      }
    ],
    answer: "c",
    explanation:
      "The value here is in the netting and BOM explosion downstream, not in the forecasting. The numbers themselves are always a human's judgement.",
    docsUrl: `${FCST}#fields`
  },
  {
    slug: "planning.forecast.18",
    unitSlug: "forecast",
    topic: "forecast",
    bloom: "analyze",
    kind: "single",
    prompt: "Why does Carbon delete a zero cell instead of storing a zero row?",
    options: [
      {
        id: "a",
        text: "Because zero is not a valid quantity anywhere in Carbon"
      },
      {
        id: "b",
        text: "So the grid stays sparse — only weeks with real expected demand become rows"
      },
      { id: "c", text: "Because a zero would be read as 'block this week'" },
      { id: "d", text: "To keep the 52 columns aligned in the list view" }
    ],
    answer: "b",
    explanation:
      "A zero and a blank say the same thing — nothing expected — so storing 52 rows per part per location would be noise the planning run has to read every time.",
    docsUrl: `${FCST}#how-you-enter-one`
  },
  {
    slug: "planning.forecast.19",
    unitSlug: "forecast",
    topic: "forecast",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Your pipeline says four satellite buses a week from week six, but nothing is booked. What does entering that as a projection buy you?",
    options: [
      { id: "a", text: "It reserves stock against the future orders" },
      {
        id: "b",
        text: "It puts the expected demand into the plan now, so long-lead parts are ordered before the orders land"
      },
      {
        id: "c",
        text: "It creates draft sales orders for the expected quantity"
      },
      { id: "d", text: "It raises the part's reorder point automatically" }
    ],
    answer: "b",
    explanation:
      "Lead time is the reason forecasting exists. Waiting for the order to appear means the parts start arriving after the customer needed the finished goods.",
    docsUrl: `${G_PLAN}#demand-forecasting`
  },
  {
    slug: "planning.forecast.20",
    unitSlug: "forecast",
    topic: "forecast",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "What does the MRP run do with a projection once it reads it? (Select all that apply.)",
    options: [
      { id: "a", text: "Adds its full quantity to gross demand for that week" },
      {
        id: "b",
        text: "Explodes the part's method to push demand down to its components"
      },
      { id: "c", text: "Deletes the projection so it is not read twice" },
      { id: "d", text: "Places the purchase orders the projection implies" }
    ],
    answer: ["a", "b"],
    explanation:
      "The run reads and explodes; it never consumes or commits. The projection stays exactly as you typed it, and nothing is ordered until you act on a suggestion.",
    docsUrl: `${FCST}#how-planning-consumes-it`
  },
  {
    slug: "planning.forecast.21",
    unitSlug: "forecast",
    topic: "forecast",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You projected 100 but the suggestion that came back was far smaller. Which explanation is consistent with how projections are consumed?",
    options: [
      {
        id: "a",
        text: "Projections are capped at the part's reorder quantity"
      },
      {
        id: "b",
        text: "In-flight job and purchase-order supply was credited during the explosion, so planning acted on the shortfall"
      },
      { id: "c", text: "Only the first quarter tab is read by the run" },
      { id: "d", text: "Projections are halved because they are unconfirmed" }
    ],
    answer: "b",
    explanation:
      "The projection was not reduced — the coverage you already had was netted off it. That is the difference between gross demand and what still needs ordering.",
    docsUrl: `${FCST}#how-planning-consumes-it`
  },

  // ------------------------------------------------- reordering: policies (12)
  {
    slug: "planning.reordering.01",
    unitSlug: "reordering-policies",
    topic: "reordering",
    bloom: "remember",
    kind: "single",
    prompt: "Which reordering policy suggests nothing at all?",
    options: [
      { id: "a", text: "Manual Reorder" },
      { id: "b", text: "Demand-Based Reorder" },
      { id: "c", text: "Fixed Reorder Quantity" },
      { id: "d", text: "Maximum Quantity" }
    ],
    answer: "a",
    explanation:
      "Manual Reorder never triggers automatically — the part is ordered by hand, which is exactly what you want for anything a person should always eyeball.",
    docsUrl: `${REORD}#policies`
  },
  {
    slug: "planning.reordering.02",
    unitSlug: "reordering-policies",
    topic: "reordering",
    bloom: "remember",
    kind: "single",
    prompt: "Which reordering policy is the default?",
    options: [
      { id: "a", text: "Manual Reorder" },
      { id: "b", text: "Demand-Based Reorder" },
      { id: "c", text: "Fixed Reorder Quantity" },
      { id: "d", text: "Maximum Quantity" }
    ],
    answer: "b",
    explanation:
      "Demand-Based Reorder is the default because ordering what demand actually needs, when it needs it, is the safest starting point for a part nobody has tuned yet.",
    docsUrl: `${PLAN}#reorder-policy`
  },
  {
    slug: "planning.reordering.03",
    unitSlug: "reordering-policies",
    topic: "reordering",
    bloom: "remember",
    kind: "single",
    prompt: "Under Maximum Quantity, how much does a triggered order cover?",
    options: [
      { id: "a", text: "A fixed reorder quantity" },
      { id: "b", text: "Enough to reach the maximum inventory quantity" },
      { id: "c", text: "The accumulation window's demand plus safety stock" },
      { id: "d", text: "Exactly the reorder point" }
    ],
    answer: "b",
    explanation:
      "Maximum Quantity is classic min/max: the reorder point is the floor that triggers, the maximum inventory quantity is the level you top back up to.",
    docsUrl: `${REORD}#policies`
  },
  {
    slug: "planning.reordering.04",
    unitSlug: "reordering-policies",
    topic: "reordering",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Which policies trigger when on-hand falls to the reorder point? (Select all that apply.)",
    options: [
      { id: "a", text: "Fixed Reorder Quantity" },
      { id: "b", text: "Maximum Quantity" },
      { id: "c", text: "Demand-Based Reorder" },
      { id: "d", text: "Manual Reorder" }
    ],
    answer: ["a", "b"],
    explanation:
      "Only the two stock-level policies watch the reorder point. Demand-Based Reorder triggers on demand appearing in a window, and Manual Reorder never triggers.",
    docsUrl: `${REORD}#policies`
  },
  {
    slug: "planning.reordering.05",
    unitSlug: "reordering-policies",
    topic: "reordering",
    bloom: "apply",
    kind: "single",
    prompt:
      "A shelf-stock washer is used constantly and you simply want the bin topped back up whenever it runs low. Which policy?",
    options: [
      { id: "a", text: "Manual Reorder" },
      { id: "b", text: "Demand-Based Reorder" },
      { id: "c", text: "Fixed Reorder Quantity" },
      { id: "d", text: "Maximum Quantity" }
    ],
    answer: "d",
    explanation:
      "Maximum Quantity is the classic min/max for shelf stock: fall to the reorder point, top back up to the maximum inventory quantity.",
    docsUrl: `${G_PLAN}#reordering-policy`
  },
  {
    slug: "planning.reordering.06",
    unitSlug: "reordering-policies",
    topic: "reordering",
    bloom: "apply",
    kind: "single",
    prompt:
      "Your supplier prices a component best in batches of 500 and you want every order to be that predictable batch. Which policy?",
    options: [
      { id: "a", text: "Fixed Reorder Quantity" },
      { id: "b", text: "Maximum Quantity" },
      { id: "c", text: "Demand-Based Reorder" },
      { id: "d", text: "Manual Reorder" }
    ],
    answer: "a",
    explanation:
      "Fixed Reorder Quantity orders the same amount every time it triggers, which is what makes it supplier-friendly and predictable to receive.",
    docsUrl: `${G_PLAN}#reordering-policy`
  },
  {
    slug: "planning.reordering.07",
    unitSlug: "reordering-policies",
    topic: "reordering",
    bloom: "apply",
    kind: "single",
    prompt:
      "An expensive custom casting should only ever be ordered when a job actually needs it, with a week's worth of pulls grouped into one order. Which policy?",
    options: [
      { id: "a", text: "Maximum Quantity" },
      { id: "b", text: "Demand-Based Reorder" },
      { id: "c", text: "Fixed Reorder Quantity" },
      { id: "d", text: "Manual Reorder" }
    ],
    answer: "b",
    explanation:
      "Demand-Based Reorder orders just what demand needs, when it needs it, and the demand accumulation period is what turns a week of small pulls into one sensible order.",
    docsUrl: `${G_PLAN}#reordering-policy`
  },
  {
    slug: "planning.reordering.08",
    unitSlug: "reordering-policies",
    topic: "reordering",
    bloom: "apply",
    kind: "single",
    prompt:
      "A part is expensive, slow-moving, and a buyer wants to make the call personally every time. Which policy?",
    options: [
      { id: "a", text: "Manual Reorder" },
      { id: "b", text: "Demand-Based Reorder with a long accumulation period" },
      { id: "c", text: "Fixed Reorder Quantity with a reorder quantity of 1" },
      { id: "d", text: "Maximum Quantity with the maximum set to 0" }
    ],
    answer: "a",
    explanation:
      "Manual Reorder is the policy that means 'planning stays hands-off'. Faking it with a tiny quantity or a zero maximum still produces suggestions nobody asked for.",
    docsUrl: `${G_PLAN}#reordering-policy`
  },
  {
    slug: "planning.reordering.09",
    unitSlug: "reordering-policies",
    topic: "reordering",
    bloom: "apply",
    kind: "single",
    prompt:
      "You want a part demand-planned at your main plant but on simple min/max at a small satellite site. Is that possible?",
    options: [
      { id: "a", text: "No — a part has one policy company-wide" },
      {
        id: "b",
        text: "Yes — policies are set per part and planning can run per location, so each site can replenish its own way"
      },
      {
        id: "c",
        text: "Only by creating a second item for the satellite site"
      },
      { id: "d", text: "Only if both sites share a reorder point" }
    ],
    answer: "b",
    explanation:
      "Planning is location-aware, so the same part can behave differently at each site without duplicating the item master.",
    docsUrl: REORD
  },
  {
    slug: "planning.reordering.10",
    unitSlug: "reordering-policies",
    topic: "reordering",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Two parts share a reorder point of 100. One is Fixed Reorder Quantity, the other Maximum Quantity. What differs when both trigger?",
    options: [
      { id: "a", text: "Nothing — both order the same amount" },
      {
        id: "b",
        text: "The fixed part orders the same quantity every time; the maximum part orders however much it takes to reach its maximum inventory quantity, so its order size varies with how far it fell"
      },
      {
        id: "c",
        text: "The maximum part orders a fixed amount and the fixed part varies"
      },
      {
        id: "d",
        text: "Only the maximum part is clamped by minimum order quantity"
      }
    ],
    answer: "b",
    explanation:
      "Same trigger, different sizing rule. That is why a part that sometimes drops far below its point behaves very differently under the two policies.",
    docsUrl: `${REORD}#policies`
  },
  {
    slug: "planning.reordering.11",
    unitSlug: "reordering-policies",
    topic: "reordering",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A part is set to Maximum Quantity with a Buy replenishment system. Which statement is correct?",
    options: [
      {
        id: "a",
        text: "The policy decides when and how much; the replenishment system decides that it becomes a purchase order rather than a job"
      },
      {
        id: "b",
        text: "The replenishment system overrides the policy's quantity"
      },
      { id: "c", text: "Maximum Quantity forces the part to be made in-house" },
      { id: "d", text: "Buy parts ignore the reorder point" }
    ],
    answer: "a",
    explanation:
      "They answer different questions and never overlap: how much comes from the policy, what kind of order comes from the replenishment system.",
    docsUrl: REORD
  },
  {
    slug: "planning.reordering.12",
    unitSlug: "reordering-policies",
    topic: "reordering",
    bloom: "apply",
    kind: "single",
    prompt:
      "A part is on Fixed Reorder Quantity with a reorder point of 50 and a reorder quantity of 200. On hand is 80. What does planning suggest?",
    options: [
      { id: "a", text: "200 — the reorder quantity is always ordered" },
      { id: "b", text: "120 — enough to reach 200" },
      {
        id: "c",
        text: "Nothing — on hand has not fallen to the reorder point"
      },
      { id: "d", text: "30 — the gap between 80 and 50" }
    ],
    answer: "c",
    explanation:
      "The reorder point is a trigger, not a target. With 80 on hand and a point of 50, nothing has fired yet, so there is no suggestion to size.",
    docsUrl: `${REORD}#policies`
  },

  // ------------------------------------------ reordering: order modifiers (12)
  {
    slug: "planning.reordering.13",
    unitSlug: "order-modifiers",
    topic: "reordering",
    bloom: "remember",
    kind: "single",
    prompt: "What does the lot size do to a suggested order?",
    options: [
      { id: "a", text: "Rounds it up to a multiple" },
      { id: "b", text: "Rounds it to the nearest multiple, up or down" },
      { id: "c", text: "Caps it at a maximum" },
      { id: "d", text: "Splits it into several orders" }
    ],
    answer: "a",
    explanation:
      "Lot size is the order multiple: it only ever rounds up, because rounding down would leave you short of the quantity the policy just calculated.",
    docsUrl: `${REORD}#fields`
  },
  {
    slug: "planning.reordering.14",
    unitSlug: "order-modifiers",
    topic: "reordering",
    bloom: "remember",
    kind: "single",
    prompt: "What do the minimum and maximum order quantities do?",
    options: [
      { id: "a", text: "Set the reorder point and the reorder quantity" },
      { id: "b", text: "Clamp each suggested order into an orderable range" },
      { id: "c", text: "Define the accumulation window" },
      { id: "d", text: "Set the stock level to top back up to" }
    ],
    answer: "b",
    explanation:
      "They turn a raw calculated number into something you can actually place: never below what a supplier will accept, never above what you are willing to commit to.",
    docsUrl: `${REORD}#fields`
  },
  {
    slug: "planning.reordering.15",
    unitSlug: "order-modifiers",
    topic: "reordering",
    bloom: "apply",
    kind: "single",
    prompt:
      "Maximum Quantity. On hand 40, reorder point 50, maximum inventory quantity 200, minimum order quantity 25, lot size 25. What quantity does the suggestion land on?",
    options: [
      { id: "a", text: "150" },
      { id: "b", text: "160" },
      { id: "c", text: "175" },
      { id: "d", text: "200" }
    ],
    answer: "c",
    explanation:
      "It triggers (40 is at or below 50). Topping up to 200 needs 160, which clears the minimum of 25, and the lot size rounds 160 up to the next multiple of 25 — 175.",
    docsUrl: `${REORD}#fields`
  },
  {
    slug: "planning.reordering.16",
    unitSlug: "order-modifiers",
    topic: "reordering",
    bloom: "apply",
    kind: "single",
    prompt:
      "Fixed Reorder Quantity. On hand 12, reorder point 20, reorder quantity 100, lot size 30, no order-quantity limits. What does the suggestion land on?",
    options: [
      { id: "a", text: "90" },
      { id: "b", text: "100" },
      { id: "c", text: "108" },
      { id: "d", text: "120" }
    ],
    answer: "d",
    explanation:
      "The fixed quantity is 100, and the lot size rounds up, not to the nearest — 100 sits between 90 and 120, so the order becomes 120.",
    docsUrl: `${REORD}#fields`
  },
  {
    slug: "planning.reordering.17",
    unitSlug: "order-modifiers",
    topic: "reordering",
    bloom: "apply",
    kind: "single",
    prompt:
      "Maximum Quantity. On hand 55, reorder point 60, maximum inventory quantity 70, minimum order quantity 100, lot size 50. What does the suggestion land on?",
    options: [
      { id: "a", text: "15" },
      { id: "b", text: "50" },
      { id: "c", text: "100" },
      { id: "d", text: "150" }
    ],
    answer: "c",
    explanation:
      "Topping up to 70 needs only 15, but the minimum order quantity clamps that to 100 — and 100 is already a multiple of 50, so the lot size changes nothing.",
    docsUrl: `${REORD}#fields`
  },
  {
    slug: "planning.reordering.18",
    unitSlug: "order-modifiers",
    topic: "reordering",
    bloom: "apply",
    kind: "single",
    prompt:
      "Demand-Based Reorder. The accumulation window holds 900 of demand, safety stock is 100, nothing is on hand or on order. Maximum order quantity is 600 and the lot size is 200. What does the suggestion land on?",
    options: [
      { id: "a", text: "600" },
      { id: "b", text: "800" },
      { id: "c", text: "1,000" },
      { id: "d", text: "1,200" }
    ],
    answer: "a",
    explanation:
      "The window needs 900 plus 100 safety stock, but the maximum order quantity clamps it to 600 — already a multiple of 200. The rest of the demand stays visible for the next window.",
    docsUrl: `${REORD}#fields`
  },
  {
    slug: "planning.reordering.19",
    unitSlug: "order-modifiers",
    topic: "reordering",
    bloom: "apply",
    kind: "single",
    prompt:
      "Demand-Based Reorder with a one-week accumulation period. That week holds two sales-order lines for 30 and 45, safety stock is 20, nothing on hand or on order, lot size 25. What does the suggestion land on?",
    options: [
      { id: "a", text: "75" },
      { id: "b", text: "95" },
      { id: "c", text: "100" },
      { id: "d", text: "125" }
    ],
    answer: "c",
    explanation:
      "The window groups both lines into 75, safety stock takes it to 95, and the lot size rounds 95 up to the next multiple of 25 — 100.",
    docsUrl: `${REORD}#fields`
  },
  {
    slug: "planning.reordering.20",
    unitSlug: "order-modifiers",
    topic: "reordering",
    bloom: "apply",
    kind: "single",
    prompt:
      "Fixed Reorder Quantity with a reorder quantity of 40, a minimum order quantity of 100, and a lot size of 20. It triggers. What does the suggestion land on?",
    options: [
      { id: "a", text: "40" },
      { id: "b", text: "60" },
      { id: "c", text: "100" },
      { id: "d", text: "140" }
    ],
    answer: "c",
    explanation:
      "The minimum order quantity applies to every policy, so a 40-unit reorder quantity is clamped up to 100 — which is already a multiple of 20 and needs no further rounding.",
    docsUrl: `${REORD}#fields`
  },
  {
    slug: "planning.reordering.21",
    unitSlug: "order-modifiers",
    topic: "reordering",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Which fields apply to every reordering policy, whichever one a part is on? (Select all that apply.)",
    options: [
      { id: "a", text: "Minimum order quantity" },
      { id: "b", text: "Maximum order quantity" },
      { id: "c", text: "Lot size" },
      { id: "d", text: "Reorder point" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "The order modifiers shape whatever number a policy produces, so they are policy-agnostic. The reorder point is a trigger and only means anything to the two stock-level policies.",
    docsUrl: `${REORD}#fields`
  },
  {
    slug: "planning.reordering.22",
    unitSlug: "order-modifiers",
    topic: "reordering",
    bloom: "apply",
    kind: "multi",
    prompt:
      "Which two fields belong to Demand-Based Reorder and to no other policy? (Select all that apply.)",
    options: [
      { id: "a", text: "Demand accumulation period" },
      { id: "b", text: "Demand accumulation safety stock" },
      { id: "c", text: "Reorder quantity" },
      { id: "d", text: "Maximum inventory quantity" }
    ],
    answer: ["a", "b"],
    explanation:
      "The period is the window demand is grouped into and the safety stock is the buffer each window is topped up to. Reorder quantity belongs to Fixed Reorder Quantity, and maximum inventory quantity to Maximum Quantity.",
    docsUrl: `${REORD}#fields`
  },
  {
    slug: "planning.reordering.23",
    unitSlug: "order-modifiers",
    topic: "reordering",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A Maximum Quantity part has a maximum inventory quantity of 200 but the suggestion would put 215 on the shelf. How is that possible?",
    options: [
      {
        id: "a",
        text: "The maximum inventory quantity was ignored by planning"
      },
      {
        id: "b",
        text: "The lot size rounds the order up to a multiple, and rounding up can overshoot the level the policy was aiming at"
      },
      { id: "c", text: "The reorder point was added to the maximum" },
      { id: "d", text: "The minimum order quantity was applied twice" }
    ],
    answer: "b",
    explanation:
      "The maximum inventory quantity sizes the raw number; the lot size then makes it orderable, and it only rounds up. If the overshoot matters, change the lot size or use a maximum order quantity.",
    docsUrl: `${REORD}#fields`
  },
  {
    slug: "planning.reordering.24",
    unitSlug: "order-modifiers",
    topic: "reordering",
    bloom: "apply",
    kind: "single",
    prompt:
      "You stock a battery pack in Each but buy it in cases of ten. What reconciles the suggested quantity with what you actually order?",
    options: [
      { id: "a", text: "The lot size, set to 10" },
      {
        id: "b",
        text: "The conversion factor, applied by purchasing planning as it builds the suggestion"
      },
      { id: "c", text: "The maximum inventory quantity" },
      { id: "d", text: "The demand accumulation period" }
    ],
    answer: "b",
    explanation:
      "Purchasing planning applies conversion factors as it goes, so a stocking-unit shortfall becomes the right quantity in the unit you actually buy.",
    docsUrl: G_PLAN
  },

  // ---------------------------------------------------------------- mrp (21)
  {
    slug: "planning.mrp.01",
    unitSlug: "what-mrp-does",
    topic: "mrp",
    bloom: "remember",
    kind: "single",
    prompt: "Does an MRP run create purchase orders?",
    options: [
      { id: "a", text: "Yes, for every Buy item with a shortfall" },
      { id: "b", text: "Yes, but only in Draft status" },
      {
        id: "c",
        text: "No — it only writes forecasts; ordering is an action you take"
      },
      { id: "d", text: "Only if the item is on Manual Reorder" }
    ],
    answer: "c",
    explanation:
      "MRP suggests, it never auto-orders. Turning a suggestion into a real job or PO is always an explicit action on the planning page.",
    docsUrl: `${PLAN}#two-stages`
  },
  {
    slug: "planning.mrp.02",
    unitSlug: "what-mrp-does",
    topic: "mrp",
    bloom: "remember",
    kind: "single",
    prompt:
      "You choose Order on a planning suggestion. What status is the resulting job or purchase order created at?",
    options: [
      { id: "a", text: "Draft" },
      { id: "b", text: "Planned" },
      { id: "c", text: "Released" },
      { id: "d", text: "Suggested" }
    ],
    answer: "b",
    explanation:
      "Planned is a real, saved document that came from a suggestion and is waiting to be released — it is not a placeholder and it is not a hand-started Draft.",
    docsUrl: `${PLAN}#from-suggestion-to-order`
  },
  {
    slug: "planning.mrp.03",
    unitSlug: "what-mrp-does",
    topic: "mrp",
    bloom: "remember",
    kind: "single",
    prompt: "Where does a Make item's shortfall surface?",
    options: [
      { id: "a", text: "On the production planning page, as a suggested job" },
      {
        id: "b",
        text: "On the purchasing planning page, as a suggested purchase order"
      },
      { id: "c", text: "On the item's ledger" },
      { id: "d", text: "On the sales order that caused it" }
    ],
    answer: "a",
    explanation:
      "The replenishment system routes the shortfall: Make goes to production planning as a job, Buy goes to purchasing planning as a PO.",
    docsUrl: `${PLAN}#from-suggestion-to-order`
  },
  {
    slug: "planning.mrp.04",
    unitSlug: "what-mrp-does",
    topic: "mrp",
    bloom: "remember",
    kind: "single",
    prompt: "What does the MRP run itself write?",
    options: [
      { id: "a", text: "Jobs and purchase orders at Planned status" },
      {
        id: "b",
        text: "Period-bucketed demand forecasts, plus the demand and supply actuals it read"
      },
      { id: "c", text: "Updated reorder points on each item" },
      { id: "d", text: "Operation dates on each work center" }
    ],
    answer: "b",
    explanation:
      "The run's whole output is data: bucketed forecasts and the actuals behind them. Everything a person acts on is read back out of that by the planning views.",
    docsUrl: `${PLAN}#two-stages`
  },
  {
    slug: "planning.mrp.05",
    unitSlug: "what-mrp-does",
    topic: "mrp",
    bloom: "remember",
    kind: "single",
    prompt: "Which question does planning answer, and which does scheduling?",
    options: [
      {
        id: "a",
        text: "Planning: when and where. Scheduling: what and how much"
      },
      {
        id: "b",
        text: "Planning: what and how much. Scheduling: when and where"
      },
      { id: "c", text: "Both answer what and how much" },
      { id: "d", text: "Planning answers both; scheduling only reports" }
    ],
    answer: "b",
    explanation:
      "They are separate subsystems that meet at the job: planning finalizes what and how much, scheduling sequences the resulting operations onto the floor.",
    docsUrl: `${PLAN}#planning-vs-scheduling`
  },
  {
    slug: "planning.mrp.06",
    unitSlug: "what-mrp-does",
    topic: "mrp",
    bloom: "apply",
    kind: "multi",
    prompt: "What does the MRP run do? (Select all that apply.)",
    options: [
      { id: "a", text: "Explodes demand through bills of material" },
      {
        id: "b",
        text: "Nets demand against on-hand plus open jobs and purchase orders"
      },
      { id: "c", text: "Applies each item's reorder point" },
      { id: "d", text: "Creates jobs and purchase orders" }
    ],
    answer: ["a", "b"],
    explanation:
      "Explode and net is stage one. Reorder points belong to the planning views in stage two, and no order is ever created without someone choosing it.",
    docsUrl: `${PLAN}#two-stages`
  },
  {
    slug: "planning.mrp.07",
    unitSlug: "what-mrp-does",
    topic: "mrp",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Which of these does the MRP run deliberately NOT do? (Select all that apply.)",
    options: [
      { id: "a", text: "Apply reorder points" },
      { id: "b", text: "Create orders" },
      { id: "c", text: "Write demand forecasts" },
      { id: "d", text: "Explode demand through bills of material" }
    ],
    answer: ["a", "b"],
    explanation:
      "Conflating the two stages is the usual mistake. The run only reads, nets, and writes forecasts; sizing by policy and committing to an order both happen later.",
    docsUrl: `${PLAN}#two-stages`
  },
  {
    slug: "planning.mrp.08",
    unitSlug: "what-mrp-does",
    topic: "mrp",
    bloom: "apply",
    kind: "single",
    prompt:
      "A Buy item is short 300 units. Which page will you find it on, and as what?",
    options: [
      { id: "a", text: "Production planning, as a suggested job" },
      { id: "b", text: "Purchasing planning, as a suggested purchase order" },
      { id: "c", text: "The supplier's record, as an open requisition" },
      { id: "d", text: "The item's planning tab, as a reorder point breach" }
    ],
    answer: "b",
    explanation:
      "The item's replenishment system decides which planning page shows the shortfall, and Buy items are proposed as purchase orders.",
    docsUrl: `${PLAN}#from-suggestion-to-order`
  },
  {
    slug: "planning.mrp.09",
    unitSlug: "what-mrp-does",
    topic: "mrp",
    bloom: "apply",
    kind: "single",
    prompt:
      "Two jobs sit side by side: one Planned, one Draft. What does the difference tell you?",
    options: [
      { id: "a", text: "The Planned one is not saved yet" },
      {
        id: "b",
        text: "The Planned one came from a planning suggestion and is waiting to be released; the Draft one was started by hand"
      },
      { id: "c", text: "The Draft one has already been scheduled" },
      { id: "d", text: "Planned jobs cannot be edited" }
    ],
    answer: "b",
    explanation:
      "Both are real saved jobs. The status records their origin, so you can tell what planning proposed from what a person opened themselves.",
    docsUrl: `${PLAN}#from-suggestion-to-order`
  },
  {
    slug: "planning.mrp.10",
    unitSlug: "what-mrp-does",
    topic: "mrp",
    bloom: "apply",
    kind: "single",
    prompt:
      "Ordering a suggested job fails with 'Manufacturing is blocked for item …'. What fixes it?",
    options: [
      { id: "a", text: "Re-running MRP" },
      { id: "b", text: "Switching the item to a Buy replenishment system" },
      {
        id: "c",
        text: "Clearing the blocked flag in the item's planning settings, then ordering again"
      },
      { id: "d", text: "Raising the reorder point" }
    ],
    answer: "c",
    explanation:
      "The block is a deliberate setting on the item, not a planning fault — re-running the engine will produce the same suggestion and the same refusal.",
    docsUrl: PLAN
  },
  {
    slug: "planning.mrp.11",
    unitSlug: "what-mrp-does",
    topic: "mrp",
    bloom: "apply",
    kind: "single",
    prompt:
      "Ordering a suggested job fails with 'Manufacturing requires configuration for item …'. What should you do?",
    options: [
      {
        id: "a",
        text: "Create the job from a context that sets the configuration, such as the sales order line"
      },
      { id: "b", text: "Delete the item's configuration rules" },
      { id: "c", text: "Order it from the purchasing planning page instead" },
      { id: "d", text: "Set the item's reordering policy to Manual Reorder" }
    ],
    answer: "a",
    explanation:
      "A configurable item needs answers planning has no way to supply. Somewhere that already knows the configuration — the sales order line — can create the job.",
    docsUrl: PLAN
  },
  {
    slug: "planning.mrp.12",
    unitSlug: "what-mrp-does",
    topic: "mrp",
    bloom: "apply",
    kind: "single",
    prompt:
      "You ordered a suggestion and got 'Failed to create job method for item …'. The job exists but has no method. What is the usual cause and fix?",
    options: [
      {
        id: "a",
        text: "The item has no Active make method — activate one, then delete and re-order the job or run Get Method on it"
      },
      { id: "b", text: "The location has no default — set one in settings" },
      {
        id: "c",
        text: "The item is blocked for manufacturing — clear the flag"
      },
      { id: "d", text: "The demand projection was deleted mid-run" }
    ],
    answer: "a",
    explanation:
      "The job was created but copying the item's method into it failed, and the usual reason is that no method is Active. Activate one, then re-pull the method.",
    docsUrl: PLAN
  },
  {
    slug: "planning.mrp.13",
    unitSlug: "what-mrp-does",
    topic: "mrp",
    bloom: "apply",
    kind: "single",
    prompt:
      "The planning page reports 'Failed to load any locations'. What is missing?",
    options: [
      { id: "a", text: "An open sales order" },
      {
        id: "b",
        text: "At least one location, created in settings with a default set"
      },
      { id: "c", text: "An Active make method on the item" },
      { id: "d", text: "A completed MRP run" }
    ],
    answer: "b",
    explanation:
      "Planning is location-scoped from end to end, so with no location there is nothing to plan against — create one and set it as the default.",
    docsUrl: PLAN
  },
  {
    slug: "planning.mrp.14",
    unitSlug: "what-mrp-does",
    topic: "mrp",
    bloom: "apply",
    kind: "single",
    prompt:
      "A planner is nervous about running MRP twice in a morning. What actually happens on the second run?",
    options: [
      {
        id: "a",
        text: "Suggestions are duplicated and orders are placed twice"
      },
      {
        id: "b",
        text: "The demand forecast is rebuilt from scratch, and since the run creates no orders, nothing is committed either time"
      },
      { id: "c", text: "The projections are consumed and cleared" },
      { id: "d", text: "The reorder points are recalculated from usage" }
    ],
    answer: "b",
    explanation:
      "The forecast is output, regenerated on every run, and the run never orders anything — which together are what make re-running safe.",
    docsUrl: `${FCST}#what-a-projection-is`
  },
  {
    slug: "planning.mrp.15",
    unitSlug: "what-mrp-does",
    topic: "mrp",
    bloom: "apply",
    kind: "single",
    prompt:
      "The demand looks right but every suggested quantity is too small. Where do you go to change it?",
    options: [
      { id: "a", text: "The sales orders driving the demand" },
      {
        id: "b",
        text: "The item's reordering policy and its order modifiers, because the planning view sizes the suggestion"
      },
      {
        id: "c",
        text: "The MRP run's settings, because the run sizes the suggestion"
      },
      { id: "d", text: "The scheduling engine" }
    ],
    answer: "b",
    explanation:
      "The run only nets; sizing happens in stage two, where the policy plus minimum, maximum, and lot size turn a shortfall into a quantity.",
    docsUrl: `${PLAN}#two-stages`
  },
  {
    slug: "planning.mrp.16",
    unitSlug: "what-mrp-does",
    topic: "mrp",
    bloom: "analyze",
    kind: "single",
    prompt: "Which stage of planning applies an item's reorder point?",
    options: [
      { id: "a", text: "The MRP run, while it nets demand against supply" },
      {
        id: "b",
        text: "The planning views, when they size a suggestion from the forecasts"
      },
      {
        id: "c",
        text: "Neither — reorder points are only used by inventory counts"
      },
      { id: "d", text: "Both, so the point is checked twice" }
    ],
    answer: "b",
    explanation:
      "The run explodes and nets without ever looking at a reorder point. The planning pages project stock week by week and apply the policy on top.",
    docsUrl: `${PLAN}#two-stages`
  },
  {
    slug: "planning.mrp.17",
    unitSlug: "what-mrp-does",
    topic: "mrp",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A planner insists MRP placed a purchase order overnight. What is the most likely explanation?",
    options: [
      { id: "a", text: "MRP auto-orders anything past its reorder point" },
      {
        id: "b",
        text: "Somebody acted on a suggestion — MRP only writes forecasts and never places an order itself"
      },
      { id: "c", text: "The run converts suggestions after a delay" },
      { id: "d", text: "The supplier accepted a forecast as an order" }
    ],
    answer: "b",
    explanation:
      "Nothing is committed until a person confirms a suggestion, so an unexplained PO is a question about who clicked Order, not about the engine.",
    docsUrl: PLAN
  },
  {
    slug: "planning.mrp.18",
    unitSlug: "what-mrp-does",
    topic: "mrp",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A scheduler moves a job's operations to a different work center and later week. What happens to the job's quantity?",
    options: [
      { id: "a", text: "It is re-sized from the new dates' demand" },
      {
        id: "b",
        text: "It is unchanged — scheduling places operations and computes dates, but never changes quantities"
      },
      { id: "c", text: "It is rounded to the item's lot size again" },
      { id: "d", text: "It is split across the two work centers" }
    ],
    answer: "b",
    explanation:
      "Quantity is planning's answer and dates are scheduling's. Keeping the boundary sharp is what lets you reschedule freely without disturbing the plan.",
    docsUrl: `${PLAN}#planning-vs-scheduling`
  },
  {
    slug: "planning.mrp.19",
    unitSlug: "what-mrp-does",
    topic: "mrp",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Planning and scheduling are described as two subsystems that meet at one record. Which record, and what does each contribute?",
    options: [
      {
        id: "a",
        text: "The job: planning finalizes it, and scheduling sequences its operations onto work centers"
      },
      {
        id: "b",
        text: "The sales order: planning dates it, scheduling prices it"
      },
      {
        id: "c",
        text: "The item: planning sets its policy, scheduling sets its lead time"
      },
      {
        id: "d",
        text: "The work center: planning assigns it, scheduling staffs it"
      }
    ],
    answer: "a",
    explanation:
      "The job is the handover point. Everything before it is about what and how much; everything after it is about when and where.",
    docsUrl: `${PLAN}#planning-vs-scheduling`
  },
  {
    slug: "planning.mrp.20",
    unitSlug: "what-mrp-does",
    topic: "mrp",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Working down the purchasing planning page, at what moment does a proposal become a commitment?",
    options: [
      { id: "a", text: "When the MRP run finishes" },
      { id: "b", text: "When the suggestion appears on the page" },
      {
        id: "c",
        text: "When you confirm the suggestion and it becomes a real purchase order"
      },
      { id: "d", text: "When the goods are received" }
    ],
    answer: "c",
    explanation:
      "Everything up to that click is a proposal you can walk away from. Confirming is what turns a suggested line into a real document.",
    docsUrl: G_PLAN
  },
  {
    slug: "planning.mrp.21",
    unitSlug: "what-mrp-does",
    topic: "mrp",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You ordered a suggested job and it has no operation dates yet. Is something wrong?",
    options: [
      { id: "a", text: "Yes — MRP should have dated the operations" },
      {
        id: "b",
        text: "No — planning sized and created the job; the scheduling engine places its operations onto work centers and computes their dates"
      },
      { id: "c", text: "Yes — the job should have been created as a Draft" },
      { id: "d", text: "No — jobs from planning never get operation dates" }
    ],
    answer: "b",
    explanation:
      "Planning hands off a job with a quantity, not a timetable. Dates arrive from scheduling, which is a separate subsystem entirely.",
    docsUrl: `${PLAN}#planning-vs-scheduling`
  }
];
