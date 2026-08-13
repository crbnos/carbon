# Quality, trace & ship

> Prove it's right, ship it, close the books.

Building the satellite is most of the work, but it isn't the whole job. You still have to prove it was built right, and close the loop with the customer and your books.

## Raise an issue

Say an operator flags a short in the EPS wiring harness. You open an Issue, Carbon's name for a non-conformance. It moves through a clear lifecycle, from Registered to In Progress to Closed, and it links to the part and the job operation it was found on, so the bus now carries that open issue everywhere it appears in the system.

## Workflows & actions

An issue doesn't just sit there — it runs a workflow you define. A classic 8D is one such workflow; a quick containment-only response is another. Whichever you pick, it spins up the required actions as tasks, each one started and completed on its own:

- Containment: stop the bad parts from spreading. Set it on the affected process and it surfaces on the shop floor, so the next operator can't keep building the defect.
- Corrective: find and fix the root cause.
- Preventive: change something so it can't recur.
- Verification: prove the fix actually worked.
- Communication: keep the customer in the loop.

A review step gates what happens to the non-conforming assemblies: use as is, rework, scrap, or return to the supplier. Nothing is dispositioned on a hunch; the decision is recorded against the issue alongside its actions.

## Versioned procedures

Those work instructions the operator followed didn't appear from nowhere. They're generated from versioned procedures, the same Draft / Active / Archived discipline you saw on methods. When a corrective action changes how the structural frame is assembled, you publish a new revision; every future job picks it up, and every job already running keeps the revision it started on.

New jobs pick up the latest published version; in-flight jobs never shift mid-build. And every satellite's record pins the exact procedure revision it was actually built to.

## Traceability

Because everything was captured at build time, the genealogy of a finished satellite is complete. Carbon stores it as a graph of tracked entities and the activities that link them, so from one serial you can walk backward to every ancestor (which frame, which battery lot, which plate of aluminium) or forward to every place a lot was used.

One click, or one scan of the satellite's QR label, answers the question every auditor and every recall asks: what exactly went into this unit, and where else did that lot go?

## Ship & invoice

The first finished units are ready. You create a `guides/order-to-cash` against the sales order. It drafts its lines from what's outstanding, and you ship only what's actually built: on SHP000001 the line reads 2 shipped against 3 ordered, so 1 stays outstanding. Post it, then invoice that same 2. Because the order still has a unit to ship, it stays at "To Ship and Invoice" and simply carries the remainder forward; the line's shipped count rolls up as each batch goes.

Carbon ties the invoice straight into your accounting system, so the build that started at the `guides/quote-to-cash` closes on the books — partial quantity and all.

That's the whole loop: a 90-unit promise became three jobs, a tree of made and bought parts, a forecast-aware plan, traceable work on the floor, a quality save, and a shipped, invoiced, fully-traceable satellite. Every entity you saw (methods, kits, policies, operations, issues) has its own page in the Reference when you're ready for the detail.
