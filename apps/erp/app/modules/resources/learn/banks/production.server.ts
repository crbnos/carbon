/**
 * Production — question bank. SERVER ONLY.
 *
 * The questions lean on the rules the docs flag as counterintuitive, because
 * those are the ones planners get wrong in a live shop: a job's method is a
 * frozen copy, scheduling is finite and always forward, a work center's rates
 * are a snapshot for the estimate but live for the actual, the MES board never
 * reschedules, and a kanban is a signal rather than a plan.
 */

import type { LearnQuestion } from "../types";

const D = "https://docs.carbon.ms";
const JOBS = `${D}/docs/reference/jobs`;
const ROUT = `${D}/docs/reference/routings`;
const WC = `${D}/docs/reference/work-centers`;
const SCH = `${D}/docs/reference/scheduling`;
const KAN = `${D}/docs/reference/kanban`;
const MES = `${D}/docs/reference/mes`;
const G_BUILD = `${D}/guides/build`;
const G_FLOOR = `${D}/guides/floor`;
const G_FINISH = `${D}/guides/job-finish-close`;

export const questions: LearnQuestion[] = [
  // ------------------------------------------------- jobs · job-anatomy (11)
  {
    slug: "production.jobs.01",
    unitSlug: "job-anatomy",
    topic: "jobs",
    bloom: "apply",
    kind: "single",
    prompt:
      "A job for 200 brackets was released last week. Engineering then adds a washer to the part's method on the item master. What does the running job consume?",
    options: [
      {
        id: "a",
        text: "The method it was released with — the washer is not on it"
      },
      {
        id: "b",
        text: "The updated method, including the washer, from its next operation onward"
      },
      {
        id: "c",
        text: "The updated method, but only once someone re-releases the job"
      },
      {
        id: "d",
        text: "Nothing until the job closes, then the washer backflushes"
      }
    ],
    answer: "a",
    explanation:
      "A job carries its own copy of the method, taken when it is released. Editing the part master never reaches work already in flight — that is exactly what lets the floor build from a fixed recipe.",
    docsUrl: JOBS
  },
  {
    slug: "production.jobs.02",
    unitSlug: "job-anatomy",
    topic: "jobs",
    bloom: "apply",
    kind: "single",
    prompt:
      "A job is raised for 100 good units with a scrap quantity of 5. What is its production quantity?",
    options: [
      { id: "a", text: "105" },
      { id: "b", text: "100" },
      { id: "c", text: "95" },
      { id: "d", text: "5" }
    ],
    answer: "a",
    explanation:
      "Production quantity is quantity plus scrap quantity. The floor has to start enough units to still land 100 good ones after the expected loss.",
    docsUrl: JOBS
  },
  {
    slug: "production.jobs.03",
    unitSlug: "job-anatomy",
    topic: "jobs",
    bloom: "remember",
    kind: "single",
    prompt:
      "The Jobs list shows a job as 'Released'. Which status value is actually stored on it?",
    options: [
      { id: "a", text: "Ready" },
      { id: "b", text: "Released" },
      { id: "c", text: "In Progress" },
      { id: "d", text: "Planned" }
    ],
    answer: "a",
    explanation:
      "'Released' is only the list's label for the Ready status — the same value under a friendlier word. Filtering or scripting against a literal 'Released' status finds nothing.",
    docsUrl: JOBS
  },
  {
    slug: "production.jobs.04",
    unitSlug: "job-anatomy",
    topic: "jobs",
    bloom: "apply",
    kind: "single",
    prompt:
      "A job has six operations. An operator starts the second one; the other five have not been touched. What is the job's status?",
    options: [
      { id: "a", text: "In Progress" },
      { id: "b", text: "Ready, until a majority of operations have started" },
      { id: "c", text: "Planned" },
      { id: "d", text: "Paused, because five operations are idle" }
    ],
    answer: "a",
    explanation:
      "A job reads In Progress the moment any single operation does. It is a roll-up of whether the floor has started, not a count of how far it has got.",
    docsUrl: JOBS
  },
  {
    slug: "production.jobs.05",
    unitSlug: "job-anatomy",
    topic: "jobs",
    bloom: "remember",
    kind: "single",
    prompt:
      "Which operation type opens a guided, step-by-step build view with 3D animated work instructions for the operator?",
    options: [
      { id: "a", text: "Assembly" },
      { id: "b", text: "Process" },
      { id: "c", text: "Inspection" },
      { id: "d", text: "Outside Processing" }
    ],
    answer: "a",
    explanation:
      "The operation type decides which execution view the floor sees: Process runs the standard view, Assembly the animated step-by-step build, Inspection a measured-feature check, and Outside Processing goes to a supplier.",
    docsUrl: JOBS
  },
  {
    slug: "production.jobs.06",
    unitSlug: "job-anatomy",
    topic: "jobs",
    bloom: "analyze",
    kind: "single",
    prompt:
      "An Outside Processing operation was pointed at a supplier process three months ago. The supplier has since raised their price, but the operation still shows the old cost and lead time. Why, and what refreshes it?",
    options: [
      {
        id: "a",
        text: "Cost and lead time were copied when the supplier process was set, not linked live — re-select the supplier process"
      },
      {
        id: "b",
        text: "Supplier pricing is cached for 90 days and refreshes on its own"
      },
      {
        id: "c",
        text: "Outside operations carry no cost until the purchase order is received"
      },
      {
        id: "d",
        text: "The job must be cancelled and re-raised to pick up the new price"
      }
    ],
    answer: "a",
    explanation:
      "Setting the supplier process copies that supplier's cost and lead time onto the operation. It is a snapshot, so a later price change stays invisible until you re-select the process.",
    docsUrl: JOBS
  },
  {
    slug: "production.jobs.07",
    unitSlug: "job-anatomy",
    topic: "jobs",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Operations 20 and 30 on a job have no dependency declared between them. What does that allow?",
    options: [
      {
        id: "a",
        text: "Both can be Ready at the same time and run in parallel"
      },
      {
        id: "b",
        text: "30 stays Waiting until 20 is Done, because 20 has the lower order"
      },
      {
        id: "c",
        text: "Nothing — the job refuses to schedule until a dependency is added"
      },
      { id: "d", text: "30 is cancelled automatically as unreachable" }
    ],
    answer: "a",
    explanation:
      "The order field positions operations, but explicit dependencies are what gate a start. With none declared between them, two operations can be Ready at once and run side by side.",
    docsUrl: JOBS
  },
  {
    slug: "production.jobs.08",
    unitSlug: "job-anatomy",
    topic: "jobs",
    bloom: "apply",
    kind: "multi",
    prompt:
      "An operation on a released job sits at Waiting. Which statements are true? (Select all that apply.)",
    options: [
      {
        id: "a",
        text: "Every operation it depends on must be Done before it can reach Ready"
      },
      {
        id: "b",
        text: "It flips to Ready on its own once the last dependency completes"
      },
      { id: "c", text: "A supervisor has to promote it to Ready by hand" },
      {
        id: "d",
        text: "It is waiting because its work center is currently busy"
      },
      { id: "e", text: "Waiting means the whole job has been paused" }
    ],
    answer: ["a", "b"],
    explanation:
      "Waiting means an upstream dependency is unfinished. Completing that dependency re-checks everything downstream and promotes this one automatically — no manual step, and nothing to do with work-center load.",
    docsUrl: JOBS
  },
  {
    slug: "production.jobs.09",
    unitSlug: "job-anatomy",
    topic: "jobs",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A colleague insists method type and replenishment system are the same setting under two names. Why are they not?",
    options: [
      {
        id: "a",
        text: "Method type answers how a part gets into its parent; replenishment system answers how it is stocked overall and which planning queue it lands in"
      },
      {
        id: "b",
        text: "Method type applies only to purchased parts, replenishment system only to made parts"
      },
      {
        id: "c",
        text: "Method type is a job field; replenishment system is a BoM field"
      },
      { id: "d", text: "They are the same, except one is read-only" }
    ],
    answer: "a",
    explanation:
      "They are two different questions. Make to Order, Purchase to Order, and Pull from Inventory describe the parent relationship; Buy, Make, and Buy and Make describe how the part is stocked and planned.",
    docsUrl: G_BUILD
  },
  {
    slug: "production.jobs.10",
    unitSlug: "job-anatomy",
    topic: "jobs",
    bloom: "apply",
    kind: "single",
    prompt:
      "A cluster of six fasteners always goes into the frame together, and nobody wants a separate build to track. How should that group sit on the bill of materials?",
    options: [
      {
        id: "a",
        text: "As a Kit — its components are issued together straight into the parent, with no kit job and no kit operation"
      },
      {
        id: "b",
        text: "As a Subassembly — built as its own job with its own routing and completion"
      },
      { id: "c", text: "As six separate Purchase to Order lines" },
      { id: "d", text: "As a single Outside Processing operation" }
    ],
    answer: "a",
    explanation:
      "Reach for a subassembly when the thing is genuinely manufactured and worth releasing on its own. A kit is just a grouping: the parts are issued into the parent as a set, and a separate build would be ceremony.",
    docsUrl: G_BUILD
  },
  {
    slug: "production.jobs.11",
    unitSlug: "job-anatomy",
    topic: "jobs",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A method is Active and jobs are running against it. Engineering needs to change one of its operations. What is the right move?",
    options: [
      {
        id: "a",
        text: "Publish a new version — an Active method is frozen, and changes flow forward into the next version and the next job"
      },
      {
        id: "b",
        text: "Edit the Active method; running jobs pick the change up at their next operation"
      },
      { id: "c", text: "Archive it, edit it, then un-archive it" },
      { id: "d", text: "Set every running job back to Draft first, then edit" }
    ],
    answer: "a",
    explanation:
      "Draft is the workbench, Active is the published locked recipe, Archived is history. Only a Draft is editable, so live work never shifts under the floor's feet.",
    docsUrl: G_BUILD
  },

  // --------------------------------------------- jobs · finishing-a-job (10)
  {
    slug: "production.jobs.12",
    unitSlug: "finishing-a-job",
    topic: "jobs",
    bloom: "apply",
    kind: "single",
    prompt:
      "You open the Complete Job dialog and want to raise the Quantity Completed it shows. What is true?",
    options: [
      {
        id: "a",
        text: "It is derived from the serials and batches completed in MES and cannot be typed in here"
      },
      {
        id: "b",
        text: "It defaults to the job's quantity and is freely editable"
      },
      { id: "c", text: "It comes from the linked sales order line" },
      { id: "d", text: "It can be overridden as long as you supply a reason" }
    ],
    answer: "a",
    explanation:
      "The completed quantity is what the floor actually reported, not a number the office chooses. Raising it means going back to MES and reporting the units.",
    docsUrl: G_FINISH
  },
  {
    slug: "production.jobs.13",
    unitSlug: "finishing-a-job",
    topic: "jobs",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A job accumulated noticeably more work-in-process cost than the item's standard cost. At what value are the finished goods received into inventory?",
    options: [
      { id: "a", text: "At the job's actual accumulated WIP cost" },
      {
        id: "b",
        text: "At standard, with the difference booked to a purchase price variance"
      },
      {
        id: "c",
        text: "At standard, with the difference booked to Production Variance"
      },
      { id: "d", text: "At the item's average cost across its existing layers" }
    ],
    answer: "a",
    explanation:
      "Carbon does not receive finished goods at standard and book a variance. The receipt is simply the sum of what the job spent; the item's costing method only decides how that cost is carried forward.",
    docsUrl: G_FINISH
  },
  {
    slug: "production.jobs.14",
    unitSlug: "finishing-a-job",
    topic: "jobs",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Why does completing a job post no variance, even for a job that ran badly over its estimate?",
    options: [
      {
        id: "a",
        text: "Completion moves the whole WIP balance into inventory one-for-one — equal debit and credit"
      },
      {
        id: "b",
        text: "Variance is deferred until the accounting period closes"
      },
      {
        id: "c",
        text: "Overruns are written off to overhead as they are logged"
      },
      { id: "d", text: "Completion posts variance only on make-to-stock jobs" }
    ],
    answer: "a",
    explanation:
      "Debit inventory, credit work-in-process, the same number on both sides. There is nothing left over to be a variance at finish — the only job variance Carbon posts is the residual swept at close.",
    docsUrl: G_FINISH
  },
  {
    slug: "production.jobs.15",
    unitSlug: "finishing-a-job",
    topic: "jobs",
    bloom: "apply",
    kind: "multi",
    prompt:
      "Completing a job does which of the following? (Select all that apply.)",
    options: [
      { id: "a", text: "Backflushes any untracked material still owed" },
      { id: "b", text: "Catches up labor that has not posted yet" },
      {
        id: "c",
        text: "Receives the finished goods into inventory, debiting inventory and crediting WIP"
      },
      {
        id: "d",
        text: "Backflushes serial- and batch-tracked material the floor never scanned"
      },
      {
        id: "e",
        text: "Sweeps the remaining WIP balance to Production Variance"
      }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Tracked material has to be scanned on the floor and is never backflushed, and the variance sweep belongs to Close rather than Complete.",
    docsUrl: G_FINISH
  },
  {
    slug: "production.jobs.16",
    unitSlug: "finishing-a-job",
    topic: "jobs",
    bloom: "apply",
    kind: "single",
    prompt:
      "A batch-tracked adhesive is on the job's material list but was never issued on the floor. What does completing the job do with it?",
    options: [
      {
        id: "a",
        text: "Nothing — tracked material is never backflushed; it has to be scanned in on the floor"
      },
      {
        id: "b",
        text: "Backflushes it at the job's quantity like any other material"
      },
      {
        id: "c",
        text: "Backflushes it, picking the oldest available batch automatically"
      },
      {
        id: "d",
        text: "Blocks completion until a purchase order is raised for it"
      }
    ],
    answer: "a",
    explanation:
      "Backflush only covers untracked material. Serial- and batch-tracked material is deliberate, so if nobody scanned it the job simply never consumed it.",
    docsUrl: G_FINISH
  },
  {
    slug: "production.jobs.17",
    unitSlug: "finishing-a-job",
    topic: "jobs",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A job was raised for one specific sales order line. How does its cost reach cost of goods sold?",
    options: [
      {
        id: "a",
        text: "WIP moves to inventory when the job completes; the shipment then relieves inventory to COGS"
      },
      { id: "b", text: "WIP posts straight to COGS when the job completes" },
      {
        id: "c",
        text: "WIP posts to COGS when the shipment is posted, bypassing inventory"
      },
      {
        id: "d",
        text: "WIP stays open until the invoice posts, then moves to COGS"
      }
    ],
    answer: "a",
    explanation:
      "Make-to-order costs exactly like make-to-stock. There is no path that ships finished goods off a job: it receives into inventory, and the sale is a separate posting out of inventory.",
    docsUrl: G_FINISH
  },
  {
    slug: "production.jobs.18",
    unitSlug: "finishing-a-job",
    topic: "jobs",
    bloom: "apply",
    kind: "single",
    prompt:
      "A completed job still has a few dollars sitting in work-in-process from a late material posting. What does closing the job do?",
    options: [
      {
        id: "a",
        text: "Debits Production Variance and credits work-in-process, tagged Job Close"
      },
      {
        id: "b",
        text: "Debits inventory and credits work-in-process, raising the finished goods' cost"
      },
      { id: "c", text: "Leaves it — WIP is only cleared at period close" },
      { id: "d", text: "Debits cost of goods sold and credits work-in-process" }
    ],
    answer: "a",
    explanation:
      "Closing sums whatever remains in WIP and sweeps anything above a rounding sliver to Production Variance. That is what makes a closed job's work-in-process provably zero.",
    docsUrl: G_FINISH
  },
  {
    slug: "production.jobs.19",
    unitSlug: "finishing-a-job",
    topic: "jobs",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A supervisor asks where to find a job's manufacturing variance. What do you tell them?",
    options: [
      {
        id: "a",
        text: "At close — the residual WIP sweep is the only variance Carbon posts for a job"
      },
      {
        id: "b",
        text: "At completion, as the difference between actual and standard cost"
      },
      {
        id: "c",
        text: "On each production event, as the gap between estimated and actual hours"
      },
      {
        id: "d",
        text: "On the shipment, as the difference between cost and price"
      }
    ],
    answer: "a",
    explanation:
      "Finish is at actual, so no standard-cost variance is booked along the way. The only job variance in the ledger is whatever was left in WIP when the job closed.",
    docsUrl: G_FINISH
  },
  {
    slug: "production.jobs.20",
    unitSlug: "finishing-a-job",
    topic: "jobs",
    bloom: "apply",
    kind: "multi",
    prompt:
      "A planner needs to change a job's quantity. In which of these statuses is the job locked against that edit? (Select all that apply.)",
    options: [
      { id: "a", text: "Completed" },
      { id: "b", text: "Closed" },
      { id: "c", text: "Cancelled" },
      { id: "d", text: "Paused" },
      { id: "e", text: "In Progress" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Completed, Closed, and Cancelled jobs are locked: method, quantity, and dates are all frozen. Paused and In Progress are live jobs and stay editable.",
    docsUrl: JOBS
  },
  {
    slug: "production.jobs.21",
    unitSlug: "finishing-a-job",
    topic: "jobs",
    bloom: "remember",
    kind: "single",
    prompt:
      "Posting the shipment of finished goods produces which entry, tagged Sales Shipment?",
    options: [
      { id: "a", text: "Debit cost of goods sold, credit inventory" },
      { id: "b", text: "Debit cost of goods sold, credit work-in-process" },
      { id: "c", text: "Debit inventory, credit work-in-process" },
      { id: "d", text: "Debit Production Variance, credit inventory" }
    ],
    answer: "a",
    explanation:
      "By the time a unit sells, its WIP was long since relieved at completion. The sale reads the inventory cost layers, so COGS always comes out of inventory.",
    docsUrl: G_FINISH
  },

  // ------------------------------------------------ routings · routings (18)
  {
    slug: "production.routings.01",
    unitSlug: "routings",
    topic: "routings",
    bloom: "remember",
    kind: "single",
    prompt: "What is a routing, in Carbon's terms?",
    options: [
      {
        id: "a",
        text: "The ordered list of operations and the work center each one runs on"
      },
      { id: "b", text: "The list of materials a part consumes" },
      { id: "c", text: "The sequence of purchase orders that supply a part" },
      { id: "d", text: "The path stock takes between storage units" }
    ],
    answer: "a",
    explanation:
      "A routing is the how-it-gets-made half of a method: operations in order, each pointing at the work center that runs it. Materials are the other half.",
    docsUrl: ROUT
  },
  {
    slug: "production.routings.02",
    unitSlug: "routings",
    topic: "routings",
    bloom: "apply",
    kind: "single",
    prompt:
      "A job for a made part sits in Planned and will not schedule. Its routing has no operations on it. What is going on?",
    options: [
      {
        id: "a",
        text: "A routing with no operations cannot be scheduled — the job waits in Planned until at least one exists"
      },
      {
        id: "b",
        text: "The job needs a due date before it will leave Planned"
      },
      {
        id: "c",
        text: "Planned is the resting status; scheduling happens at completion"
      },
      { id: "d", text: "The item is missing a costing method" }
    ],
    answer: "a",
    explanation:
      "With no operations there is nothing to place on the board and nothing to estimate run time from, so the job can be neither scheduled nor costed.",
    docsUrl: ROUT
  },
  {
    slug: "production.routings.03",
    unitSlug: "routings",
    topic: "routings",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A job's quantity is raised from 50 to 100. Which of the routing's time estimates roughly doubles?",
    options: [
      {
        id: "a",
        text: "Labor and machine time, which are per unit — setup is fixed and does not move"
      },
      { id: "b", text: "All three: setup, labor, and machine" },
      {
        id: "c",
        text: "Setup only, because a bigger batch needs a longer set-up"
      },
      { id: "d", text: "None — routing times are stated per job, not per unit" }
    ],
    answer: "a",
    explanation:
      "Setup time is the fixed cost of preparing the operation, independent of quantity. Labor and machine time are quoted per unit in the operation's standard factor unit, so they scale.",
    docsUrl: ROUT
  },
  {
    slug: "production.routings.04",
    unitSlug: "routings",
    topic: "routings",
    bloom: "apply",
    kind: "multi",
    prompt:
      "Which routing values scale with the quantity being made? (Select all that apply.)",
    options: [
      { id: "a", text: "Labor time" },
      { id: "b", text: "Machine time" },
      { id: "c", text: "Setup time" },
      { id: "d", text: "Sequence" },
      { id: "e", text: "The work center's overhead rate" }
    ],
    answer: ["a", "b"],
    explanation:
      "Labor and machine time are per-unit figures. Setup is a fixed preparation cost, sequence is only ordering, and a rate is money per hour rather than a quantity.",
    docsUrl: ROUT
  },
  {
    slug: "production.routings.05",
    unitSlug: "routings",
    topic: "routings",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Engineering releases a new item revision with a reworked routing. A job released last week against the previous revision is halfway done. Which routing is it running?",
    options: [
      {
        id: "a",
        text: "The one it was released with — routings are per revision, so history is not rewritten"
      },
      {
        id: "b",
        text: "The new routing, from its next unstarted operation onward"
      },
      { id: "c", text: "The new routing, once the location reschedules" },
      { id: "d", text: "Neither; the revision cancels the job" }
    ],
    answer: "a",
    explanation:
      "Routings are defined per item revision precisely so a design change cannot reshuffle work already on the floor. New revision, new jobs.",
    docsUrl: ROUT
  },
  {
    slug: "production.routings.06",
    unitSlug: "routings",
    topic: "routings",
    bloom: "remember",
    kind: "single",
    prompt: "What does an operation's Sequence field control?",
    options: [
      { id: "a", text: "The order of operations — lower runs first" },
      { id: "b", text: "How many units run per cycle" },
      { id: "c", text: "The dispatch priority shown on the shop-floor board" },
      { id: "d", text: "Which revision the operation belongs to" }
    ],
    answer: "a",
    explanation:
      "Sequence is position within the routing, lowest first. Dispatch priority on the floor is a separate value the scheduler computes from placement.",
    docsUrl: ROUT
  },
  {
    slug: "production.routings.07",
    unitSlug: "routings",
    topic: "routings",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A work center's labor rate is raised from $60 to $75 after an operation was planned but before it is run. Which figures move?",
    options: [
      {
        id: "a",
        text: "The actual cost posted to the ledger uses the live $75 rate; the estimate keeps the $60 snapshot copied when the work center was picked"
      },
      { id: "b", text: "Both the estimate and the actual use $75" },
      { id: "c", text: "Both stay at $60 until the job is closed" },
      { id: "d", text: "The estimate updates to $75; the actual keeps $60" }
    ],
    answer: "a",
    explanation:
      "Rates live at two layers. Picking a work center copies its rates onto the operation as the estimate, while the ledger reads the work center's live rate at the moment each production event is logged — so the two can legitimately diverge.",
    docsUrl: WC
  },
  {
    slug: "production.routings.08",
    unitSlug: "routings",
    topic: "routings",
    bloom: "remember",
    kind: "single",
    prompt:
      "Where does an operation's estimated labor and machine cost rate come from?",
    options: [
      {
        id: "a",
        text: "A snapshot of the work center's rates, copied onto the operation when the work center was chosen"
      },
      { id: "b", text: "The company's default hourly rate" },
      { id: "c", text: "The assigned operator's payroll rate" },
      { id: "d", text: "The item's standard cost divided by its routing time" }
    ],
    answer: "a",
    explanation:
      "The estimate is a copy taken at planning time, which is why it can sit alongside an actual computed from a different, later rate.",
    docsUrl: WC
  },
  {
    slug: "production.routings.09",
    unitSlug: "routings",
    topic: "routings",
    bloom: "remember",
    kind: "multi",
    prompt: "Which rates does a work center carry? (Select all that apply.)",
    options: [
      { id: "a", text: "Labor rate" },
      { id: "b", text: "Machine rate" },
      { id: "c", text: "Overhead rate" },
      { id: "d", text: "Supplier rate" },
      { id: "e", text: "Sales tax rate" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Cost per labor hour, per machine hour, and per hour of overhead. Supplier pricing belongs to an outside process, and tax is nowhere near a work center.",
    docsUrl: WC
  },
  {
    slug: "production.routings.10",
    unitSlug: "routings",
    topic: "routings",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Finance wants the CNC mill work center linked to the CNC mill fixed asset so depreciation follows how hard it is run. What do you tell them?",
    options: [
      {
        id: "a",
        text: "They are independent records with no link, even when they describe the same physical machine"
      },
      { id: "b", text: "The link lives on the work center's Department field" },
      {
        id: "c",
        text: "Creating a work center creates the matching fixed asset automatically"
      },
      {
        id: "d",
        text: "A work center is a fixed asset; the two are one record with two views"
      }
    ],
    answer: "a",
    explanation:
      "The machine you schedule production on and the machine you depreciate are deliberately separate records in Carbon, with no relationship to read between them.",
    docsUrl: WC
  },
  {
    slug: "production.routings.11",
    unitSlug: "routings",
    topic: "routings",
    bloom: "apply",
    kind: "single",
    prompt:
      "A plating step has to be subcontracted to a vendor. What must be true of the process it uses?",
    options: [
      {
        id: "a",
        text: "It must be marked Outside — a process is Inside, Outside, or both, and suppliers attach to outside processes"
      },
      { id: "b", text: "It must be deactivated so the scheduler skips it" },
      {
        id: "c",
        text: "It must be assigned to every work center at the location"
      },
      {
        id: "d",
        text: "Nothing — any process can be subcontracted at job level"
      }
    ],
    answer: "a",
    explanation:
      "Outside processes are the subcontracted ones, and they are where suppliers attach for outside-processing purchase orders.",
    docsUrl: WC
  },
  {
    slug: "production.routings.12",
    unitSlug: "routings",
    topic: "routings",
    bloom: "analyze",
    kind: "single",
    prompt:
      "An operation is set to run With Previous, but it also carries an explicit dependency on that previous operation. When can it start?",
    options: [
      {
        id: "a",
        text: "Not until the previous operation is Done — explicit dependencies are what gate a start"
      },
      {
        id: "b",
        text: "Alongside the previous operation; operation order wins"
      },
      {
        id: "c",
        text: "Never — the two settings conflict and the job will not release"
      },
      { id: "d", text: "As soon as the previous operation reaches In Progress" }
    ],
    answer: "a",
    explanation:
      "Operation order describes the intended relationship, but dependencies are the gate: an operation cannot reach Ready until every operation it depends on is Done.",
    docsUrl: JOBS
  },
  {
    slug: "production.routings.13",
    unitSlug: "routings",
    topic: "routings",
    bloom: "remember",
    kind: "single",
    prompt:
      "An operation's labor time is expressed in its standard factor unit, for example Minutes/Piece. Where does that unit come from?",
    options: [
      { id: "a", text: "The work center's Default unit" },
      { id: "b", text: "The item's unit of measure" },
      { id: "c", text: "A company-wide base time unit setting" },
      { id: "d", text: "The length of the location's shift" }
    ],
    answer: "a",
    explanation:
      "A work center declares the standard factor its times are quoted in, so every operation running on it is read the same way.",
    docsUrl: WC
  },
  {
    slug: "production.routings.14",
    unitSlug: "routings",
    topic: "routings",
    bloom: "analyze",
    kind: "single",
    prompt:
      "An item has a complete bill of materials but no routing at all. What can you not do with a job for it?",
    options: [
      {
        id: "a",
        text: "Schedule it or cost it — there is nothing to place on the board and nothing to estimate run time from"
      },
      { id: "b", text: "Issue material to it" },
      { id: "c", text: "Link it to a sales order line" },
      { id: "d", text: "Give it a due date" }
    ],
    answer: "a",
    explanation:
      "The routing is the bridge between what you are making and how it gets made. Without operations there is no work to place and no time to price.",
    docsUrl: ROUT
  },
  {
    slug: "production.routings.15",
    unitSlug: "routings",
    topic: "routings",
    bloom: "apply",
    kind: "single",
    prompt:
      "You tie a process to a supplier and mark an operation Outside. What happens when the job is released?",
    options: [
      {
        id: "a",
        text: "An Outside Processing purchase order is raised for that step at the supplier's rate, and its lead time takes its place in the routing"
      },
      { id: "b", text: "The operation is skipped and the routing shortens" },
      {
        id: "c",
        text: "The operation is placed on the nearest work center that runs the process"
      },
      { id: "d", text: "A receipt is created and the step is marked Done" }
    ],
    answer: "a",
    explanation:
      "An outside step leaves the floor, raises its own purchase order, and rejoins the routing afterwards — so the schedule knows the part is away being processed.",
    docsUrl: G_FLOOR
  },
  {
    slug: "production.routings.16",
    unitSlug: "routings",
    topic: "routings",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A procedure attached to an operation is revised, bumping its version. What happens to a job already released with the old version?",
    options: [
      {
        id: "a",
        text: "It keeps the version it was built with, so instructions on work in flight never change"
      },
      {
        id: "b",
        text: "It picks up the new version at the operator's next step"
      },
      {
        id: "c",
        text: "Its next step check fails until the job is re-released"
      },
      {
        id: "d",
        text: "It picks up the new version only if the operation has not started"
      }
    ],
    answer: "a",
    explanation:
      "Procedures are versioned for the same reason methods are: a change to the master must not rewrite the instructions the floor is already working from.",
    docsUrl: JOBS
  },
  {
    slug: "production.routings.17",
    unitSlug: "routings",
    topic: "routings",
    bloom: "remember",
    kind: "multi",
    prompt:
      "A procedure's steps are typed. Which of these are real step types an operator completes? (Select all that apply.)",
    options: [
      { id: "a", text: "A measurement with a min/max range" },
      { id: "b", text: "A checkbox" },
      { id: "c", text: "A file" },
      { id: "d", text: "A ledger posting" },
      { id: "e", text: "A purchase order line" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Steps capture what the operator did — values, bounded measurements, checkboxes, list choices, timestamps, people, and files. They record work; they do not post documents.",
    docsUrl: JOBS
  },
  {
    slug: "production.routings.18",
    unitSlug: "routings",
    topic: "routings",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Why can a material or tool be assigned to a single procedure step rather than to the whole operation?",
    options: [
      {
        id: "a",
        text: "So an assembly view can show the operator exactly the parts and tools that step needs as they advance"
      },
      {
        id: "b",
        text: "So the material is costed to the step rather than to the job"
      },
      {
        id: "c",
        text: "Because operation-level materials are backflushed and step-level ones are not"
      },
      {
        id: "d",
        text: "Because tools cannot otherwise be shared between steps"
      }
    ],
    answer: "a",
    explanation:
      "Scoping to a step is what makes guided work instructions useful: the operator sees the parts and tools in front of them right now, not the whole operation's list at once.",
    docsUrl: JOBS
  },

  // -------------------------------------------- scheduling · scheduling (18)
  {
    slug: "production.scheduling.01",
    unitSlug: "scheduling",
    topic: "scheduling",
    bloom: "apply",
    kind: "single",
    prompt:
      "An operation is scheduled onto a work center with no shifts assigned, at a location that also has no shifts, and the work center is not flagged Always on. When can it run?",
    options: [
      {
        id: "a",
        text: "Inside a stock Monday–Friday, 8-hour week — the last rung of the availability ladder"
      },
      {
        id: "b",
        text: "Around the clock; with no shifts there is nothing to constrain it"
      },
      {
        id: "c",
        text: "Never — it is flagged unschedulable until a shift exists"
      },
      { id: "d", text: "Only after someone creates a shift" }
    ],
    answer: "a",
    explanation:
      "Hours come from a ladder, first rule wins: Always on, then the work center's own shifts, then the location's, then a stock Mon–Fri 8-hour week. Even a zero-config shop is bounded by real hours.",
    docsUrl: SCH
  },
  {
    slug: "production.scheduling.02",
    unitSlug: "scheduling",
    topic: "scheduling",
    bloom: "apply",
    kind: "single",
    prompt:
      "A work center is flagged Always on, and its location also has two shifts defined. Which hours does the scheduler use for it?",
    options: [
      {
        id: "a",
        text: "Continuously open, 24×7 — Always on is the first rung and wins"
      },
      { id: "b", text: "The location's two shifts" },
      { id: "c", text: "The overlap between 24×7 and the two shifts" },
      { id: "d", text: "A stock Monday–Friday, 8-hour week" }
    ],
    answer: "a",
    explanation:
      "The availability ladder is first-rule-wins, so a lights-out flag short-circuits every lower rung. Open maintenance downtime still subtracts, lights-out machines included.",
    docsUrl: WC
  },
  {
    slug: "production.scheduling.03",
    unitSlug: "scheduling",
    topic: "scheduling",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Your only CNC mill is already booked solid this week when another job's milling operation is released. What does the engine do with it?",
    options: [
      {
        id: "a",
        text: "Pushes it out to the mill's next open capacity — a work center holds one operation at a time"
      },
      {
        id: "b",
        text: "Books it alongside the existing work; the dates come out the same"
      },
      { id: "c", text: "Refuses to schedule the job and reports an error" },
      {
        id: "d",
        text: "Shortens each operation's run time so everything fits the week"
      }
    ],
    answer: "a",
    explanation:
      "Scheduling is finite. A full machine genuinely delays the operation instead of pretending everything fits, and the delay is visible and explained on the Forecast.",
    docsUrl: SCH
  },
  {
    slug: "production.scheduling.04",
    unitSlug: "scheduling",
    topic: "scheduling",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A job carries a Hard Deadline of next Tuesday. Does the engine work backward from that date to decide when its first operation starts?",
    options: [
      {
        id: "a",
        text: "No — placement is always forward from now, and the projected finish that falls out is the forecast"
      },
      {
        id: "b",
        text: "Yes; it back-schedules from the due date through the routing's lead times"
      },
      {
        id: "c",
        text: "Only for Hard Deadline jobs; other deadline types schedule forward"
      },
      {
        id: "d",
        text: "Yes, and it errors if the backward pass lands in the past"
      }
    ],
    answer: "a",
    explanation:
      "There is no backward pass anchoring work on the due date. The due date ranks capacity claims and measures lateness, which is what makes the slack in a forecast real.",
    docsUrl: SCH
  },
  {
    slug: "production.scheduling.05",
    unitSlug: "scheduling",
    topic: "scheduling",
    bloom: "apply",
    kind: "multi",
    prompt:
      "Which statements about a job's deadline type are true? (Select all that apply.)",
    options: [
      {
        id: "a",
        text: "It ranks which job claims capacity first, ahead of due date"
      },
      {
        id: "b",
        text: "The classes rank ASAP, then Hard Deadline, then Soft Deadline, then No Deadline"
      },
      { id: "c", text: "It never blocks or gates placement" },
      { id: "d", text: "A No Deadline job is left unscheduled" },
      { id: "e", text: "It sets the operation's projected start directly" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Deadline type is purely a ranking signal. Jobs claim capacity in deadline-class order and then by due date, but no deadline type stops an operation from being placed.",
    docsUrl: SCH
  },
  {
    slug: "production.scheduling.06",
    unitSlug: "scheduling",
    topic: "scheduling",
    bloom: "apply",
    kind: "single",
    prompt:
      "A make-to-stock job is raised with no due date at all. What happens when the location reschedules?",
    options: [
      {
        id: "a",
        text: "It schedules normally — the due date is the yardstick lateness is measured against, not a placement anchor"
      },
      { id: "b", text: "It is skipped until someone sets a due date" },
      { id: "c", text: "It is placed at the front of every queue" },
      { id: "d", text: "It is flagged as a conflict" }
    ],
    answer: "a",
    explanation:
      "A missing due date costs the job its ranking edge and its lateness measure, but placement itself only needs capacity.",
    docsUrl: SCH
  },
  {
    slug: "production.scheduling.07",
    unitSlug: "scheduling",
    topic: "scheduling",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A deburr process can run on three different work centers, one of which is badly backed up. How does the engine choose?",
    options: [
      {
        id: "a",
        text: "It picks the candidate that finishes earliest, so work routes around the backed-up machine on its own"
      },
      {
        id: "b",
        text: "It always uses the first work center listed on the process"
      },
      { id: "c", text: "It splits the operation across all three" },
      { id: "d", text: "It uses whichever has the lowest labor rate" }
    ],
    answer: "a",
    explanation:
      "Earliest-finish selection is what makes a multi-capable process self-balancing: a queued or unstaffed machine simply stops winning the work.",
    docsUrl: SCH
  },
  {
    slug: "production.scheduling.08",
    unitSlug: "scheduling",
    topic: "scheduling",
    bloom: "apply",
    kind: "single",
    prompt:
      "An operation is half finished when a regeneration runs. What does the engine reserve for it?",
    options: [
      {
        id: "a",
        text: "Only the remaining work, on the same work center — labor and machine time scale to the open quantity, and setup counts as done"
      },
      {
        id: "b",
        text: "The full original setup, labor, and machine time again"
      },
      {
        id: "c",
        text: "Nothing; started operations are excluded from the schedule"
      },
      {
        id: "d",
        text: "The full time, but on whichever work center now finishes earliest"
      }
    ],
    answer: "a",
    explanation:
      "A started operation stays put and is re-reserved for what is genuinely left. Setup counts as done once any production event exists, so it is not booked twice.",
    docsUrl: SCH
  },
  {
    slug: "production.scheduling.09",
    unitSlug: "scheduling",
    topic: "scheduling",
    bloom: "analyze",
    kind: "single",
    prompt:
      "One person holds the ability the weld process requires, and a supervisor mans them to the paint station for the week. What happens to the weld operations?",
    options: [
      {
        id: "a",
        text: "They become unschedulable and the Forecast flags them, rather than double-booking the person"
      },
      {
        id: "b",
        text: "The engine quietly pulls the person back whenever a weld operation comes up"
      },
      { id: "c", text: "They are placed anyway, on an unmanned night shift" },
      {
        id: "d",
        text: "They are moved to a work center that does not require the ability"
      }
    ],
    answer: "a",
    explanation:
      "A person manned to a station is committed to it. Rather than double-book them or invent coverage, the engine surfaces the gap as 'can't be scheduled' so you can fix the manning.",
    docsUrl: SCH
  },
  {
    slug: "production.scheduling.10",
    unitSlug: "scheduling",
    topic: "scheduling",
    bloom: "apply",
    kind: "single",
    prompt:
      "A location has Staffing required turned on. Which work centers still receive work when nobody is manned to them?",
    options: [
      {
        id: "a",
        text: "Only lights-out (Always on) work centers, which are exempt from the policy"
      },
      { id: "b", text: "Any work center whose operations need no ability" },
      {
        id: "c",
        text: "All of them; the policy only affects ability-gated processes"
      },
      { id: "d", text: "None, lights-out work centers included" }
    ],
    answer: "a",
    explanation:
      "With Staffing required on, the floater fallback is off and even ability-free operations need a manned station. Lights-out work centers are the single exemption.",
    docsUrl: SCH
  },
  {
    slug: "production.scheduling.11",
    unitSlug: "scheduling",
    topic: "scheduling",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Three qualified operators are manned to a station and run one operation as a team. Which of the operation's times shortens?",
    options: [
      {
        id: "a",
        text: "Labor time, which parallelizes across the present members — setup and machine time never compress"
      },
      { id: "b", text: "All three, proportionally to headcount" },
      { id: "c", text: "Machine time only" },
      { id: "d", text: "None; team manning changes cost, not duration" }
    ],
    answer: "a",
    explanation:
      "More hands cut hands-on work. A machine still runs at its own speed and a setup is still a setup, so neither is divided by headcount.",
    docsUrl: SCH
  },
  {
    slug: "production.scheduling.12",
    unitSlug: "scheduling",
    topic: "scheduling",
    bloom: "analyze",
    kind: "single",
    prompt:
      "An operation renders its projected date in amber with a 'Behind target by 3 day(s)' tooltip. What does that mean for the job?",
    options: [
      {
        id: "a",
        text: "The projected finish is later than that operation's need-by target; it is an early warning and the job may still be on time"
      },
      { id: "b", text: "The job will definitely miss its due date" },
      { id: "c", text: "The operation could not be placed at all" },
      { id: "d", text: "The operation's start date has fallen into the past" }
    ],
    answer: "a",
    explanation:
      "Amber compares one operation's projected finish against its own need-by target. A red conflict is the different, stronger claim that placement finishes after the job's due date.",
    docsUrl: SCH
  },
  {
    slug: "production.scheduling.13",
    unitSlug: "scheduling",
    topic: "scheduling",
    bloom: "remember",
    kind: "single",
    prompt:
      "The Forecast header counts 'Conflicts'. What exactly is being counted?",
    options: [
      {
        id: "a",
        text: "Placed operations that finish after the job's due date"
      },
      { id: "b", text: "Operations whose start date is in the past" },
      { id: "c", text: "Operations booked onto two work centers at once" },
      { id: "d", text: "Operations with no procedure attached" }
    ],
    answer: "a",
    explanation:
      "A conflict is a lateness claim against the job's due date, with a stored reason naming the cause. The older 'start date is in the past' definition is gone.",
    docsUrl: SCH
  },
  {
    slug: "production.scheduling.14",
    unitSlug: "scheduling",
    topic: "scheduling",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You pinned an operation's due date, and after the next run its projected start had moved again. Is something broken?",
    options: [
      {
        id: "a",
        text: "No — a pin owns the need-by target, not the placement; only a pinned outside operation keeps its stored window"
      },
      { id: "b", text: "Yes; a pin should freeze both dates" },
      { id: "c", text: "No, but only because a pin expires after one run" },
      {
        id: "d",
        text: "Yes; pinning is valid only on the first operation of a routing"
      }
    ],
    answer: "a",
    explanation:
      "Pinning says a human owns the target, and upstream operations derive their targets from it. The engine still re-projects where the work will actually happen on every run.",
    docsUrl: SCH
  },
  {
    slug: "production.scheduling.15",
    unitSlug: "scheduling",
    topic: "scheduling",
    bloom: "apply",
    kind: "multi",
    prompt: "Which of these queue a reschedule? (Select all that apply.)",
    options: [
      {
        id: "a",
        text: "Moving an operation to a different work center on the Work Centers view"
      },
      {
        id: "b",
        text: "Changing a manning assignment on the Resource Planning board"
      },
      {
        id: "c",
        text: "Dragging a job card to a new day on Priorities, which writes its due date"
      },
      {
        id: "d",
        text: "Reordering two cards within the same work-center column"
      },
      { id: "e", text: "Dragging a card on the MES Schedule board" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Reordering inside a column writes dispatch position only, and the MES board writes nothing at all. Moving to another machine, changing manning, or changing a due date are all real scheduling inputs.",
    docsUrl: SCH
  },
  {
    slug: "production.scheduling.16",
    unitSlug: "scheduling",
    topic: "scheduling",
    bloom: "apply",
    kind: "single",
    prompt:
      "You changed several due dates and the new projected dates did not appear straight away. What is happening?",
    options: [
      {
        id: "a",
        text: "The edits stamped the jobs schedule outdated and queued a replan wave, debounced about 30 seconds after the last change"
      },
      { id: "b", text: "Scheduling only runs overnight" },
      { id: "c", text: "The edits failed silently and need re-saving" },
      {
        id: "d",
        text: "Projected dates only refresh when the Forecast page is opened"
      }
    ],
    answer: "a",
    explanation:
      "Debouncing means a burst of edits triggers one regeneration instead of one per keystroke. Releasing a job or changing its status is the exception that reschedules immediately.",
    docsUrl: SCH
  },
  {
    slug: "production.scheduling.17",
    unitSlug: "scheduling",
    topic: "scheduling",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Two planners run a regeneration on the same location minutes apart with no edits in between, and get identical dates. Why?",
    options: [
      {
        id: "a",
        text: "A regeneration re-places every open job at the location in deadline-class then due-date order, so the same inputs always produce the same schedule"
      },
      { id: "b", text: "The second run is served from a cache" },
      {
        id: "c",
        text: "Regeneration is a no-op unless a job is stamped outdated"
      },
      { id: "d", text: "Only the first run writes; the second is read-only" }
    ],
    answer: "a",
    explanation:
      "The pass is whole-location and deterministic — each job claims capacity ahead of the ones behind it in a fixed order, which is what makes the answer reproducible.",
    docsUrl: SCH
  },
  {
    slug: "production.scheduling.18",
    unitSlug: "scheduling",
    topic: "scheduling",
    bloom: "remember",
    kind: "single",
    prompt:
      "An operation found no feasible slot at all. What does the Forecast show for it?",
    options: [
      {
        id: "a",
        text: "A non-binding placeholder bar with an 'Unschedulable' chip, holding no capacity against other jobs"
      },
      { id: "b", text: "Nothing — the lane is left empty" },
      { id: "c", text: "A red conflict bar that reserves capacity anyway" },
      { id: "d", text: "A bar on the next work center with room" }
    ],
    answer: "a",
    explanation:
      "Scheduling never fails; it explains. The placeholder marks where the work would run so the gap is visible, but it does not compete for real capacity.",
    docsUrl: SCH
  },

  // -------------------------------------------- shop-floor · shop-floor (18)
  {
    slug: "production.shop-floor.01",
    unitSlug: "shop-floor",
    topic: "shop-floor",
    bloom: "apply",
    kind: "single",
    prompt:
      "An operator's shift is ending. They want the clock stopped but the operation left exactly where it is for the next person. Which control?",
    options: [
      {
        id: "a",
        text: "End Operations — it closes all their active production events without completing or finishing anything"
      },
      {
        id: "b",
        text: "Finish, which stops the clock and leaves the work open"
      },
      { id: "c", text: "Pause on each operation, then Finish on the last one" },
      { id: "d", text: "Log Completed with a quantity of zero" }
    ],
    answer: "a",
    explanation:
      "End Operations is the clean end-of-shift stop, and it clocks the operator out when time cards are on. Finish is final: it flips the operation to Done.",
    docsUrl: MES
  },
  {
    slug: "production.shop-floor.02",
    unitSlug: "shop-floor",
    topic: "shop-floor",
    bloom: "apply",
    kind: "single",
    prompt:
      "An operator presses Finish on an operation that is still 20 units short of its target. What happens?",
    options: [
      {
        id: "a",
        text: "Carbon warns 'Insufficient quantity' and offers 'Finish Anyways'"
      },
      {
        id: "b",
        text: "Finish is silently blocked until the quantity is reported"
      },
      {
        id: "c",
        text: "The remaining quantity is auto-reported and the operation closes"
      },
      { id: "d", text: "The operation is cancelled" }
    ],
    answer: "a",
    explanation:
      "The guards inform rather than trap, because the floor sometimes genuinely finishes short. Once acknowledged, Finish ends any open events and flips the operation to Done.",
    docsUrl: MES
  },
  {
    slug: "production.shop-floor.03",
    unitSlug: "shop-floor",
    topic: "shop-floor",
    bloom: "apply",
    kind: "single",
    prompt:
      "Serial-tracked material on an operation was never issued, and the operator hits Finish. What does Carbon require?",
    options: [
      {
        id: "a",
        text: "An explicit acknowledgement — 'I understand and want to complete without issuing'"
      },
      { id: "b", text: "A supervisor password" },
      {
        id: "c",
        text: "Nothing; tracked material is backflushed at Finish like anything else"
      },
      { id: "d", text: "A scrap reason covering the missing material" }
    ],
    answer: "a",
    explanation:
      "Tracked material is never backflushed, so finishing without it is a real decision. Carbon makes the operator own it rather than closing quietly.",
    docsUrl: MES
  },
  {
    slug: "production.shop-floor.04",
    unitSlug: "shop-floor",
    topic: "shop-floor",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Five units came off an operation needing extra work at that same station, and two more need to go back to the milling step. Which controls?",
    options: [
      {
        id: "a",
        text: "Log Rework for the five reworked in place, and Create Rework for the two, choosing the operation to go back to"
      },
      {
        id: "b",
        text: "Log Rework for both; the operation is chosen at the next scan"
      },
      { id: "c", text: "Log Scrap for the five and Create Rework for the two" },
      {
        id: "d",
        text: "Create Rework for both, naming the current operation for the five"
      }
    ],
    answer: "a",
    explanation:
      "Log Rework records units reworked in place at this operation. Create Rework sends units upstream and re-runs every operation from that point forward to the current one.",
    docsUrl: MES
  },
  {
    slug: "production.shop-floor.05",
    unitSlug: "shop-floor",
    topic: "shop-floor",
    bloom: "apply",
    kind: "single",
    prompt:
      "An operator logs scrap on an operation. What does Carbon require, and what follows?",
    options: [
      {
        id: "a",
        text: "A Scrap Reason is required; the unit flips to Scrapped, a replacement is spawned, and the routing reopens"
      },
      { id: "b", text: "No reason is needed; the quantity simply reduces" },
      { id: "c", text: "A supervisor must approve before the quantity moves" },
      {
        id: "d",
        text: "The job's quantity is permanently reduced by the scrapped amount"
      }
    ],
    answer: "a",
    explanation:
      "Scrap is attributable by design, and spawning a replacement keeps the job's promised good quantity intact instead of quietly shrinking it.",
    docsUrl: MES
  },
  {
    slug: "production.shop-floor.06",
    unitSlug: "shop-floor",
    topic: "shop-floor",
    bloom: "analyze",
    kind: "single",
    prompt:
      "An operation targets 100 good units. The operator has reported 100 completed and 6 scrapped. Is the operation finished on quantity?",
    options: [
      {
        id: "a",
        text: "Yes — scrapped units never counted toward the target, so 100 good units meets it"
      },
      { id: "b", text: "No — only 94 count as good; 6 more are needed" },
      { id: "c", text: "No — the target rises to 106" },
      { id: "d", text: "Yes, but only if the scrap reason is operator error" }
    ],
    answer: "a",
    explanation:
      "Quantity reporting keeps good, scrapped, and reworked units separate so yield stays honest. The operation keeps going until the good quantity is met, whatever the scrap.",
    docsUrl: JOBS
  },
  {
    slug: "production.shop-floor.07",
    unitSlug: "shop-floor",
    topic: "shop-floor",
    bloom: "remember",
    kind: "single",
    prompt:
      "Pressing Start on an operation opens what, and what does the toggle beside it choose?",
    options: [
      { id: "a", text: "A production event, typed Setup, Labor, or Machine" },
      { id: "b", text: "A time card entry, typed by department" },
      { id: "c", text: "A material issue, typed by adjustment" },
      { id: "d", text: "A quality inspection, typed by feature" }
    ],
    answer: "a",
    explanation:
      "Start opens a production event and Pause closes it. The three event types are what let a job separate set-up, hands-on, and machine hours.",
    docsUrl: MES
  },
  {
    slug: "production.shop-floor.08",
    unitSlug: "shop-floor",
    topic: "shop-floor",
    bloom: "analyze",
    kind: "single",
    prompt:
      "An operator clocks out at the end of a shift with an operation still running. What has that done to the job's cost?",
    options: [
      {
        id: "a",
        text: "Nothing on its own — time cards are payroll and presence time, separate from the production events that drive job costing"
      },
      { id: "b", text: "It closed the production event and posted the labor" },
      { id: "c", text: "It moved the labor from the job to overhead" },
      { id: "d", text: "It finished the operation and posted the labor" }
    ],
    answer: "a",
    explanation:
      "The two clocks answer different questions. Only production events land on the job, which is what End Operations exists to close at shift end.",
    docsUrl: MES
  },
  {
    slug: "production.shop-floor.09",
    unitSlug: "shop-floor",
    topic: "shop-floor",
    bloom: "apply",
    kind: "single",
    prompt:
      "An operator sees their station swamped while the mill next door sits idle, and tries to drag a card across on the MES Schedule board. What happens?",
    options: [
      {
        id: "a",
        text: "Nothing — the MES board is display and filter only; rebalancing happens on the ERP scheduling boards"
      },
      { id: "b", text: "The operation moves and reschedules immediately" },
      { id: "c", text: "The operation moves but keeps its old dates" },
      { id: "d", text: "The card moves for that operator's view only" }
    ],
    answer: "a",
    explanation:
      "What reaches the floor is the result of the plan. A planner owns the sequence in the ERP, so the floor cannot quietly reshuffle it.",
    docsUrl: G_FLOOR
  },
  {
    slug: "production.shop-floor.10",
    unitSlug: "shop-floor",
    topic: "shop-floor",
    bloom: "apply",
    kind: "multi",
    prompt:
      "What can an operator actually do on the MES Schedule board? (Select all that apply.)",
    options: [
      {
        id: "a",
        text: "Filter the queue by work center, process, tag, or assignee"
      },
      { id: "b", text: "Toggle whether empty work centers are shown" },
      {
        id: "c",
        text: "Show or hide card fields such as customer, due date, and thumbnail"
      },
      { id: "d", text: "Drag a card to another work center to reschedule it" },
      { id: "e", text: "Change a job's due date" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "The Display popover and the filters let each station tune its own view. Neither touches a single scheduling record.",
    docsUrl: MES
  },
  {
    slug: "production.shop-floor.11",
    unitSlug: "shop-floor",
    topic: "shop-floor",
    bloom: "remember",
    kind: "single",
    prompt:
      "In console mode, how does an operator identify themselves at a shared station?",
    options: [
      { id: "a", text: "With a 4-digit PIN" },
      { id: "b", text: "With their full email login, every time" },
      { id: "c", text: "With a passkey registered on the shared tablet" },
      {
        id: "d",
        text: "By picking their name from a list, with no verification"
      }
    ],
    answer: "a",
    explanation:
      "A shared kiosk cannot ask everyone to log in and out all shift. The PIN attributes the work to a person; it is not a substitute for their real account.",
    docsUrl: MES
  },
  {
    slug: "production.shop-floor.12",
    unitSlug: "shop-floor",
    topic: "shop-floor",
    bloom: "apply",
    kind: "single",
    prompt:
      "A station shows 'No PIN set. Please set a PIN in your account settings.' What is wrong?",
    options: [
      {
        id: "a",
        text: "That operator has never configured a console PIN, so console mode cannot attribute work to them"
      },
      {
        id: "b",
        text: "The station's console session has expired and needs re-enabling"
      },
      { id: "c", text: "The company setting consoleEnabled is off" },
      { id: "d", text: "The operator's login password was recently reset" }
    ],
    answer: "a",
    explanation:
      "The message names a missing per-person PIN, not a station or company problem — they set one in their account settings in the ERP. A missing consoleEnabled setting would hide the Console Mode toggle entirely.",
    docsUrl: MES
  },
  {
    slug: "production.shop-floor.13",
    unitSlug: "shop-floor",
    topic: "shop-floor",
    bloom: "apply",
    kind: "single",
    prompt:
      "A job consumes serialized frames and untracked thread-locker. How does each leave inventory?",
    options: [
      {
        id: "a",
        text: "The frames are issued or scanned to the operation; the thread-locker is backflushed automatically when the operation or job reports complete"
      },
      { id: "b", text: "Both are backflushed on completion" },
      { id: "c", text: "Both must be issued by hand" },
      {
        id: "d",
        text: "The frames are backflushed; the thread-locker is issued"
      }
    ],
    answer: "a",
    explanation:
      "The bill of materials decides which route each component takes: trace what genuinely needs tracing, and let the everyday consumables update themselves.",
    docsUrl: G_FLOOR
  },
  {
    slug: "production.shop-floor.14",
    unitSlug: "shop-floor",
    topic: "shop-floor",
    bloom: "remember",
    kind: "single",
    prompt:
      "An operator is consuming material onto the job from the Issue action. Which Adjustment Type do they pick?",
    options: [
      { id: "a", text: "Pull from Inventory, a Negative Adjmt." },
      { id: "b", text: "Add to Inventory, a Positive Adjmt." },
      {
        id: "c",
        text: "Either; the direction is inferred from the quantity's sign"
      },
      { id: "d", text: "Neither; consumption goes through the Unconsume tab" }
    ],
    answer: "a",
    explanation:
      "Pull from Inventory takes stock onto the job. Add to Inventory is the opposite move for returning material, and Unconsume reverses tracked material already issued.",
    docsUrl: MES
  },
  {
    slug: "production.shop-floor.15",
    unitSlug: "shop-floor",
    topic: "shop-floor",
    bloom: "remember",
    kind: "single",
    prompt: "Which policies govern issuing expired stock on the floor?",
    options: [
      {
        id: "a",
        text: "Warn, Block, or BlockWithOverride — the overridable block asks for a reason"
      },
      { id: "b", text: "Allow or Deny" },
      { id: "c", text: "Warn or Block only" },
      { id: "d", text: "Quarantine or Scrap" }
    ],
    answer: "a",
    explanation:
      "The three-way policy lets a shop choose between a nudge, a hard stop, and a stop a person can consciously override with a recorded reason.",
    docsUrl: MES
  },
  {
    slug: "production.shop-floor.16",
    unitSlug: "shop-floor",
    topic: "shop-floor",
    bloom: "remember",
    kind: "single",
    prompt:
      "Which procedure step type records a numeric reading and warns when it falls outside configured bounds?",
    options: [
      { id: "a", text: "Measurement" },
      { id: "b", text: "Value" },
      { id: "c", text: "Checkbox" },
      { id: "d", text: "Inspection" }
    ],
    answer: "a",
    explanation:
      "Measurement carries a min and a max for its unit of measure. Value is a free reading, Checkbox is a yes/no, and Inspection is a pass/fail gate.",
    docsUrl: MES
  },
  {
    slug: "production.shop-floor.17",
    unitSlug: "shop-floor",
    topic: "shop-floor",
    bloom: "apply",
    kind: "single",
    prompt:
      "An operator raises a maintenance dispatch from the floor and sets its OEE impact to 'Down'. What happens at that work center?",
    options: [
      {
        id: "a",
        text: "Its active production events are ended, because the center cannot produce while it is under repair"
      },
      { id: "b", text: "Its queued operations are cancelled" },
      {
        id: "c",
        text: "Nothing until a maintenance worker starts the dispatch"
      },
      {
        id: "d",
        text: "Its operations move to another work center automatically"
      }
    ],
    answer: "a",
    explanation:
      "Declaring the machine down is a statement about production, so Carbon stops the clocks that would otherwise claim it is still running.",
    docsUrl: MES
  },
  {
    slug: "production.shop-floor.18",
    unitSlug: "shop-floor",
    topic: "shop-floor",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A station tablet loses its network connection mid-shift. What can the operator still do in the MES?",
    options: [
      {
        id: "a",
        text: "Nothing that changes anything — there is no offline mode, so they cannot start, report, or issue"
      },
      {
        id: "b",
        text: "Everything; the app queues writes and syncs on reconnect"
      },
      { id: "c", text: "Report quantities, but not issue material" },
      { id: "d", text: "Only clock in and out" }
    ],
    answer: "a",
    explanation:
      "Every mutation hits the network. The IndexedDB cache exists to keep the item and people pickers snappy for reads, not to buffer work for later.",
    docsUrl: MES
  },

  // ---------------------------------------------------- kanban · kanban (15)
  {
    slug: "production.kanban.01",
    unitSlug: "kanban",
    topic: "kanban",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A cell empties a bin of clips several times a week and wants the refill to be one action, with no planning run in between. Kanban or a reordering policy?",
    options: [
      {
        id: "a",
        text: "A kanban — the scan itself creates a real purchase order or job on the spot"
      },
      {
        id: "b",
        text: "A reordering policy, because it reacts faster than a manual scan"
      },
      {
        id: "c",
        text: "A reordering policy, because kanbans only work for made parts"
      },
      { id: "d", text: "Neither; use a standing purchase order" }
    ],
    answer: "a",
    explanation:
      "A reordering policy is evaluated by the planning engine from on-hand, demand, and reorder points. A kanban skips all of that: it is a signal, not a plan.",
    docsUrl: KAN
  },
  {
    slug: "production.kanban.02",
    unitSlug: "kanban",
    topic: "kanban",
    bloom: "apply",
    kind: "single",
    prompt:
      "A Buy kanban is scanned and that supplier already has a Draft purchase order open. What does the scan do?",
    options: [
      {
        id: "a",
        text: "Adds a line for the kanban's quantity to the existing open order and drops you on it"
      },
      {
        id: "b",
        text: "Creates a second draft purchase order for the same supplier"
      },
      { id: "c", text: "Refuses, reporting that an order already exists" },
      {
        id: "d",
        text: "Increases the existing line's quantity instead of adding one"
      }
    ],
    answer: "a",
    explanation:
      "The order scan looks for an open Draft or Planned order for that supplier first and only creates a new draft when there is none, so a busy bin does not litter the buyer's queue.",
    docsUrl: KAN
  },
  {
    slug: "production.kanban.03",
    unitSlug: "kanban",
    topic: "kanban",
    bloom: "apply",
    kind: "single",
    prompt:
      "A scan returns 'Supplier is required'. Which kanban is it, and what fixes it?",
    options: [
      {
        id: "a",
        text: "A Buy kanban with no supplier — the order scan needs to know who to raise the purchase order against"
      },
      {
        id: "b",
        text: "A Make kanban missing the supplier for its Auto Release step"
      },
      {
        id: "c",
        text: "Any kanban whose item has no default supplier on the item master"
      },
      { id: "d", text: "A Buy kanban whose supplier record is inactive" }
    ],
    answer: "a",
    explanation:
      "Supplier is a required field specifically for Buy kanbans, because the whole point of that order scan is to produce a purchase order for someone.",
    docsUrl: KAN
  },
  {
    slug: "production.kanban.04",
    unitSlug: "kanban",
    topic: "kanban",
    bloom: "analyze",
    kind: "single",
    prompt:
      "An order scan fails with '… is not supported'. The kanban's replenishment system is Buy and Make. Why is that rejected?",
    options: [
      {
        id: "a",
        text: "A single card fires one clear action, so only Buy and Make are supported at scan — set it to one of them"
      },
      { id: "b", text: "Buy and Make requires a second supplier to be named" },
      { id: "c", text: "The item is not stocked at that location" },
      {
        id: "d",
        text: "Buy and Make is only valid when the output mode is Label"
      }
    ],
    answer: "a",
    explanation:
      "The replenishment enum has three values because it is shared with the item master, but a card has to mean one unambiguous thing when somebody scans it on the floor.",
    docsUrl: KAN
  },
  {
    slug: "production.kanban.05",
    unitSlug: "kanban",
    topic: "kanban",
    bloom: "remember",
    kind: "single",
    prompt: "What does the order scan on a Make kanban create?",
    options: [
      {
        id: "a",
        text: "A job for the item at the kanban's quantity, with the item's method copied onto it and the job linked back to the card"
      },
      { id: "b", text: "A transfer order between storage units" },
      { id: "c", text: "A planning suggestion for the next MRP run" },
      { id: "d", text: "A purchase order for the item's default supplier" }
    ],
    answer: "a",
    explanation:
      "Make kanbans produce real jobs, method and all, and the link back to the card is what later start and complete scans resolve.",
    docsUrl: KAN
  },
  {
    slug: "production.kanban.06",
    unitSlug: "kanban",
    topic: "kanban",
    bloom: "apply",
    kind: "multi",
    prompt:
      "Which statements about Auto Release and Auto Start Job are true? (Select all that apply.)",
    options: [
      {
        id: "a",
        text: "Auto Release runs planning and scheduling and marks the created job Ready instead of leaving it in draft"
      },
      {
        id: "b",
        text: "Auto Start Job sends the operator straight into the first operation in MES"
      },
      { id: "c", text: "Auto Start Job requires Auto Release" },
      { id: "d", text: "Both settings also apply to Buy kanbans" },
      {
        id: "e",
        text: "Auto Release skips copying the item's method onto the job"
      }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Both are Make-only conveniences, and starting an operation presupposes a released job — which is exactly why one depends on the other.",
    docsUrl: KAN
  },
  {
    slug: "production.kanban.07",
    unitSlug: "kanban",
    topic: "kanban",
    bloom: "analyze",
    kind: "single",
    prompt:
      "An operator scans the order code on a Make kanban whose previous job is still open. What does Carbon do?",
    options: [
      {
        id: "a",
        text: "Routes them to a collision screen showing the existing job, offering to remove the link so a fresh scan can start over"
      },
      { id: "b", text: "Creates a second job for the same quantity" },
      { id: "c", text: "Adds the kanban's quantity to the existing job" },
      { id: "d", text: "Reports 'Kanban is not active'" }
    ],
    answer: "a",
    explanation:
      "The card links to the job it created, so a re-scan is far more likely to be a mistake than a genuine second order. Carbon shows the job rather than silently duplicating it.",
    docsUrl: KAN
  },
  {
    slug: "production.kanban.08",
    unitSlug: "kanban",
    topic: "kanban",
    bloom: "apply",
    kind: "single",
    prompt: "How does a Make kanban's card become free to fire again?",
    options: [
      {
        id: "a",
        text: "The link clears automatically once its job is completed or cancelled"
      },
      { id: "b", text: "Someone has to reprint the card" },
      { id: "c", text: "The link clears at the end of each day" },
      { id: "d", text: "The kanban must be deactivated and re-created" }
    ],
    answer: "a",
    explanation:
      "A card is bound to one open job at a time. Finishing or cancelling that job releases the binding with no extra housekeeping on the floor.",
    docsUrl: KAN
  },
  {
    slug: "production.kanban.09",
    unitSlug: "kanban",
    topic: "kanban",
    bloom: "apply",
    kind: "single",
    prompt: "A start scan returns 'No job found for kanban'. What went wrong?",
    options: [
      {
        id: "a",
        text: "Start and complete only work on Make kanbans after an order scan has created the job — scan order first"
      },
      {
        id: "b",
        text: "The card was rendered in URL mode, which cannot start jobs"
      },
      { id: "c", text: "The job exists but has not reached Ready yet" },
      { id: "d", text: "The operator is not the assignee on the operation" }
    ],
    answer: "a",
    explanation:
      "Start and complete resolve the linked job's active operation, so there has to be a linked job. On a Buy kanban those actions do not exist at all.",
    docsUrl: KAN
  },
  {
    slug: "production.kanban.10",
    unitSlug: "kanban",
    topic: "kanban",
    bloom: "remember",
    kind: "single",
    prompt:
      "How many scan targets does a kanban card carry, and what are they?",
    options: [
      { id: "a", text: "Three — order, start, and complete" },
      { id: "b", text: "Two — order and receive" },
      { id: "c", text: "One — the order signal" },
      { id: "d", text: "Four — order, start, pause, and complete" }
    ],
    answer: "a",
    explanation:
      "Each action has its own colour-coded code so the right one is obvious on the floor: order is black, start emerald, complete blue.",
    docsUrl: KAN
  },
  {
    slug: "production.kanban.11",
    unitSlug: "kanban",
    topic: "kanban",
    bloom: "remember",
    kind: "single",
    prompt: "Which affordances does the list view surface for a Buy kanban?",
    options: [
      { id: "a", text: "Only the order signal — there is no job to start" },
      { id: "b", text: "Order and complete" },
      {
        id: "c",
        text: "Order, start, and complete, the same as a Make kanban"
      },
      {
        id: "d",
        text: "None; Buy kanbans can only be scanned from the printed card"
      }
    ],
    answer: "a",
    explanation:
      "Start and complete hand off to a job's MES screens, so they only make sense once a Make kanban has created one.",
    docsUrl: KAN
  },
  {
    slug: "production.kanban.12",
    unitSlug: "kanban",
    topic: "kanban",
    bloom: "remember",
    kind: "single",
    prompt:
      "The per-company Kanban Output setting renders a card in which three modes?",
    options: [
      { id: "a", text: "QR code, Label, or URL" },
      { id: "b", text: "QR code, Barcode, or NFC tag" },
      { id: "c", text: "Label, Email, or URL" },
      { id: "d", text: "QR code or Label only" }
    ],
    answer: "a",
    explanation:
      "QR is the default; Label prints six PDF cards to a page with the item thumbnail, storage unit, quantity, and supplier; URL is a copyable link to the same scan endpoint.",
    docsUrl: KAN
  },
  {
    slug: "production.kanban.13",
    unitSlug: "kanban",
    topic: "kanban",
    bloom: "remember",
    kind: "single",
    prompt: "What is the smallest reorder quantity a kanban may carry?",
    options: [
      { id: "a", text: "One" },
      { id: "b", text: "Zero" },
      { id: "c", text: "The item's minimum order quantity" },
      { id: "d", text: "There is no minimum" }
    ],
    answer: "a",
    explanation:
      "Each scan reorders a fixed amount, so a quantity below one has nothing to fire — the scan reports 'Quantity must be at least 1'.",
    docsUrl: KAN
  },
  {
    slug: "production.kanban.14",
    unitSlug: "kanban",
    topic: "kanban",
    bloom: "apply",
    kind: "single",
    prompt:
      "A kanban is created with its Storage unit left blank. Where does the reordered stock land?",
    options: [
      {
        id: "a",
        text: "In the bin from the item's pick method for that location, which the blank field defaults from"
      },
      { id: "b", text: "Nowhere — the scan fails until a storage unit is set" },
      {
        id: "c",
        text: "In the location's default receiving bin, ignoring the item's pick method"
      },
      { id: "d", text: "In whichever bin the operator scans at receipt" }
    ],
    answer: "a",
    explanation:
      "The field defaults rather than blocking, so a card can be created quickly and still lands stock where the item is normally picked from.",
    docsUrl: KAN
  },
  {
    slug: "production.kanban.15",
    unitSlug: "kanban",
    topic: "kanban",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You buy a fastener in boxes of 500 but stock it in each. Which kanban fields carry that, and where do they end up?",
    options: [
      {
        id: "a",
        text: "Purchase unit of measure and conversion factor, applied to the purchase order line the order scan writes"
      },
      {
        id: "b",
        text: "Quantity and storage unit, applied to the item master"
      },
      {
        id: "c",
        text: "The supplier's own unit of measure, resolved at receipt"
      },
      { id: "d", text: "Nothing — kanbans always order in stock units" }
    ],
    answer: "a",
    explanation:
      "The order scan applies the kanban's conversion factor, purchase unit, and storage unit to the line it creates, so what the buyer sees matches how you actually purchase.",
    docsUrl: KAN
  }
];
