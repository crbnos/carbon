# Start with the order

> A 90-unit robot order becomes real work.

Meet the shop we'll follow through this guide: an OEM that builds humanoid robots. One customer just placed an order for 90 units. By the end, you'll have followed that order all the way from the sales desk to 90 finished robots on the shipping dock — and seen most of Carbon along the way.

Carbon spans the office and the floor: ERP for orders, purchasing, and planning; MES for the people actually building. The thread that ties them together is a single order, so that's where we start.

## The sales order

Open the sales order dashboard. There's already an order on the books: 90 robots. But the customer doesn't want all 90 at once. They want 30 this week, 30 next week, and 30 the week after. That delivery schedule is going to shape everything downstream.

Shipping part of an order doesn't close it. While any unit still has to ship, the order's status reads **"To Ship and Invoice"**. Once every unit has shipped but you haven't billed yet, it moves to **"To Invoice"**. The order closes only when everything has both shipped and been invoiced. That's what lets one order be fulfilled in batches without losing track of what's left.

Carbon has a full Quote module with quantity-break pricing, so the 90-unit price could have been negotiated in quote to cash first. We'll pick the story up at the confirmed sales order, where the build truly begins.

## Batch it into jobs

You don't build 90 robots as one monolithic job. To match the three-week delivery schedule, you split the order into three jobs of 30, one per delivery, each scheduled, released, and shipped on its own timeline.

You create those jobs from the sales order itself. On the line's **Jobs** card, click **"Make to Order"**; in the **"Convert Line to Job"** dialog, set the **Quantity** to 30 and create the first job. Repeat for the second and third. Carbon counts down the units still waiting on a job (90 → 60 → 30), so you always know how much of the order is left to batch. To build all 90 at once instead, you'd leave the **Quantity** at the full 90 and create a single job.

Three jobs of 30 let you release week one now, keep weeks two and three in planning, and ship each batch the moment it's done — instead of waiting on all 90.

## Create the job

From the sales order, create the job. Carbon carries the part, quantity, and due date across automatically. The job inherits exactly what was sold. That way, the shop floor always has the up-to-date specifications and requirements for the job.

Carbon carries one more thing across, and it's the most important: the robot's manufacturing method, its full recipe of materials and operations. The job doesn't point at the part's master recipe, though. It gets its own copy.

## Get the method

Pulling that recipe into the job is an explicit action in Carbon called Get Method. It clones the part's method, every material and every operation, into a job-specific method that belongs to this job alone.

That copy is the whole point. Say this batch needs a one-off substitution, like a different fastener or an extra inspection step. You edit the job's method, and the part master stays untouched. And when a change proves itself, you can push it back up to the part so every future job inherits it.

Editing a job never silently rewrites your part library, and updating a part never disturbs a job already in flight. Nothing flows between them automatically: you copy the recipe down when the job is created, and push improvements back up only when you choose to.

## Release or plan

Now the key decision. You'll release one job, week one, and leave the other two in planning. The difference is what each action sets in motion:

- Release: generates inventory alerts for any required material that isn't in stock, and adds the job's tasks to the shop-floor schedule. This is work the floor can start.
- Plan: generates the same inventory alerts, but does not schedule anything. It's how you see what a future job will need without the shop floor seeing it on the schedule. They are not yet notified about this job in any way.

Planning weeks two and three now means you can order materials that have a long lead time — without cluttering this week's schedule with jobs the floor can't touch yet.
