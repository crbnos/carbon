# Quality, trace & ship

> Prove it's right, ship it, close the books.

Building the robot is most of the work, but it isn't the whole job. You still have to prove it was built right, and close the loop with the customer and your books.

## Raise an issue

Say an operator flags a defect on an arm. You open an Issue, Carbon's name for a non-conformance. It moves through a clear lifecycle, from Registered to In Progress to Closed, and it links to the part itself, so the arm now carries that open issue everywhere it appears in the system.

## Workflows & actions

An issue doesn't just sit there — it runs a workflow you define. A classic 8D is one such workflow; a quick containment-only response is another. Whichever you pick, it spins up the required actions as tasks, each one started and completed on its own:

- Containment: stop the bad parts from spreading. Set it on the affected process and it surfaces on the shop floor, so the next operator can't keep building the defect.
- Corrective: find and fix the root cause.
- Preventive: change something so it can't recur.
- Verification: prove the fix actually worked.
- Communication: keep the customer in the loop.

A review step gates what happens to the non-conforming arms: use, rework, or scrap. Nothing is dispositioned on a hunch; the decision is recorded against the issue alongside its actions.

## Versioned procedures

Those work instructions the operator followed didn't appear from nowhere. They're generated from versioned procedures, the same Draft / Active / Archived discipline you saw on methods. When a corrective action changes how the arm is assembled, you publish a new revision; every future job picks it up, and every job already running keeps the revision it started on.

New jobs pick up the latest published version; in-flight jobs never shift mid-build. And every robot's record pins the exact procedure revision it was actually built to.

## Traceability

Because everything was captured at build time, the genealogy of a finished robot is complete. Carbon stores it as a graph of tracked entities and the activities that link them, so from one serial you can walk backward to every ancestor (which arm, which motor lot, which raw material) or forward to every place a lot was used.

One click, or one scan of the robot's QR label, answers the question every auditor and every recall asks: what exactly went into this unit, and where else did that lot go?

## Ship & invoice

Week one's 30 robots are done. You create a `guides/order-to-cash` against the sales order. It drafts its lines from what's outstanding, you pick and post it, then invoice that same 30. Because the order line stays open at "To Ship and Invoice," it simply carries the remaining 60 forward; the completed count rolls up as each batch ships.

Carbon ties the invoice straight into your accounting system, so the build that started at the `guides/quote-to-cash` closes on the books — partial quantity and all.

That's the whole loop: a 90-unit promise became three jobs, a tree of made and bought parts, a forecast-aware plan, traceable work on the floor, a quality save, and a shipped, invoiced, fully-traceable robot. Every entity you saw (methods, kits, policies, operations, issues) has its own page in the Reference when you're ready for the detail.
