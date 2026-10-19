# OEE Provider Integration Research: Best Practices Survey

## Summary

This survey covers how machine-monitoring vendors, ERP/MES products and standards attribute sensed machine time to a job. The input is a Carbon "OEE provider", such as Sense Manufacturing. It reports per-station states (Active / Idle / Alert / Offline) over a polled REST API. No surveyed product infers the job from an on/off signal. Every product keeps an explicit **active job per machine**, and a person or a system sets it. The sources are an operator "start" on a tablet, a barcode scan, an ERP clock-in, or a CNC program number.

A current clip cannot see a program number, so program matching is not available to Carbon. MachineMetrics documents the best answer for time that has no job. It records that time as an "Unknown Job" with its own record, and a person assigns it later. In most products, machine time reaches the ledger after a confirmation step. SAP lets that step be automatic, and Odoo costs the time at once.

## Competitors Surveyed

- **SAP Digital Manufacturing (DM) + S/4HANA** — the enterprise reference. Resource status model, active SFC on a resource, time records with approval.
- **Epicor Kinetic + Advanced MES (Mattec)** — the discrete-manufacturing ERP row. Machine Interface Unit (MIU), scheduled labor export.
- **Plex (Rockwell)** — a workcenter Control Panel with a "current job" that a setup loads.
- **Siemens Opcenter** — an Automation Gateway binds machine tags to the active work order operation.
- **Odoo Manufacturing** — open source, so the data model is exact. Work center productivity rows with loss types.
- **ProShop, JobBOSS², Global Shop Solutions (GSS), Fulcrum Pro** — job-shop ERPs. Each one gets machine time through a partner (MachineMetrics, Datanomix, Amper).
- **MachineMetrics** — the most complete public documentation. Operator, Program and ERP-driven job modes, the Unknown Job, and ERP connectors.
- **Guidewheel, FourJaw, Amper** — current-clamp vendors. These match Sense's hardware most closely.
- **Evocon, Vorne XL, Datanomix, Tulip, Shoplogix, Redzone** — other OEE and MES vendors.
- **Sense Manufacturing** — the first provider. Its public material covers hardware only.
- **Standards** — ISA-95 / IEC 62264, MTConnect, OPC UA (40001-1, 40501-1), ISO 22400, SEMI E10.

## Key Consensus Patterns

### 1. An explicit "active job per machine", set by a person or the ERP — never inferred from power

- **SAP**: An SFC goes to Active when an operator starts it at a resource in the POD (Production Operator Dashboard). A sensor through Plant Connectivity (PCo) can also start or complete an SFC, but the order context comes from DM.
- **MachineMetrics**: Each machine has a "Jobs selected by" mode. In Operator mode, the operator picks the job from the Dispatch Schedule, and the machine runs one job at a time. In ERP-driven mode, the ERP's clock-ins decide the job.
- **FourJaw**: The operator "books on" a work order operation from a list in priority order. On the tablet, starting a second job pauses the current one.
- **Vorne XL**: A barcode scan starts a "Part Run". A Job scan adds a Job ID to the current run.
- **Evocon**: The operator marks a "product changeover" and picks an order. A green "Active order" tag shows the current order on each station.
- **Plex**: A setup loads the job onto the workcenter. The Control Panel then shows "the current job".
- **Siemens Opcenter**: The MES dispatches the order to the station. The gateway reads the machine values during the active step.
- **Guidewheel**: The operator starts and stops a "production run" in Sidekick Runs. The API also accepts production entries.
- **Odoo**: The operator presses Start on the work order (`button_start`). That opens a `mrp.workcenter.productivity` row.
- **Rationale**: The sensor knows the state of the machine. Only the shop floor knows which job is on it. Each product therefore stores the job as a separate fact with its own start and end. The machine signal then fills that fact with run time.

### 2. Program matching is the only automatic attribution, and it needs a CNC controller

- **MachineMetrics**: Auto Production Monitoring (APM) matches the running program to open jobs "based on part numbers and program data". If several open work orders share one part operation, the result is "Suggested", not "Matched".
- **Datanomix**: It reads the part number and the G-code program comments from the CNC. It matches them to ProShop part numbers.
- **MTConnect**: `Program`, `PartId`, `PartCount` and `ProcessAggregateId.OrderNumber` carry this data.
- **OPC UA 40501-1**: The `ProductionJob` has an `OrderIdentifier`. It is visible only when the MES sent the order to the controller.
- **Rationale**: A current clip reports power only. It has no program, no part count and no order number. Carbon cannot use this pattern with Sense.

### 3. Run time with no job goes to a visible "unknown" bucket, and a person assigns it later

- **MachineMetrics**: A run with no match "is tracked as an Unknown Job with its own labor ticket, so the time and parts are not lost". The operator can assign a job, reassign, split or merge tickets before submission. A supervisor can use "Add Production Run" to create a run for a past period.
- **Evocon**: The operator can put a product changeover on a past signal or a past stop.
- **Guidewheel**: A manual production entry has a machine, a start time, a stop time and a product. The API accepts `POST`/`PUT` on production entries.
- **Amper**: It recommends a "No Job to Run" downtime code. It also recommends a report of unlabeled events one hour before the shift ends, so supervisors can correct them.
- **GSS (through MachineMetrics)**: Operations with an unknown work center go to a synthetic "UNASSIGNED" resource.
- **SAP, Epicor, Plex, Opcenter**: The public documentation does not say what happens to run time with no active order.
- **Rationale**: If the system drops this time, the job is under-costed and nobody sees the gap. If the system guesses, the cost goes to the wrong job. A queue that a person clears keeps the cost and the audit trail.

### 4. Machine time posts after a confirmation step, and the step can be automatic

- **SAP**: DM writes time records. A user adjusts and approves them in Manage Time Records. "Enable Auto-Approval for Time Records" makes the approval automatic. In S/4HANA, the confirmation carries machine time, and the activity type (for example Machine Hours) carries the rate.
- **MachineMetrics**: A labor ticket goes from Draft to Confirmed to Closed. Draft and Confirmed tickets stay editable. "Submission is the point of no return." Connectors to JobBOSS², ProShop and GSS write the ticket to the ERP only on submission.
- **Epicor Advanced MES**: It exports labor details to Kinetic on a schedule. Users report a 15-minute schedule.
- **Odoo**: `_cal_cost` sums `duration * workcenter_id.costs_hour` over the productivity rows. It needs no confirmation.
- **Rationale**: Sensed time is a measurement, not a decision. A short review window lets a person fix a wrong job before the cost reaches the job and the GL.

### 5. One external machine maps to one resource, and many machines can share one resource

- **SAP**: A resource belongs to only one work center. Each machine (an asset, or "digital twin") maps to a resource.
- **MachineMetrics**: "Only one resource per machine" applies. "Multiple machines can map labor to the same ERP resource." ERP-driven mode needs an individual resource, not a group.
- **Epicor**: An Advanced MES machine maps to a Kinetic resource. Two physical machines can share one machine record if you only need run and down state.
- **MRPeasy**: A workstation belongs to exactly one workstation group.
- **ISA-95**: A work center is "the grouping of equipment scheduled by Level 4 or Level 3". The work unit is the lowest level that Level 3 schedules.
- **Rationale**: The ERP resource carries the cost rate and the schedule. The machine carries the signal. Many-to-one keeps the cost model simple. Attribution must still use the machine, because two machines in one group run different jobs.

### 6. A small fixed state set, and only "running" is productive time

- **SAP DM**: Resource statuses are Productive, Standby, Scheduled Down, Unscheduled Down, Unknown, Enabled and Disabled. These follow SEMI E10. "The system logs the time … in Productive status as the utilized machine time."
- **Guidewheel**: The API states are online, idle, offline, planned downtime and nodata. Thresholds on load (kW) separate running, idle and offline.
- **FourJaw**: The API classes are `UPTIME`, `DOWNTIME` ("stopped while staffed") and `OFFLINE` ("outside planned production").
- **Vorne XL**: Down, Changeover and Maintenance count in OEE. Not Scheduled, No Production and Not Monitored do not.
- **OPC UA 40001-1**: `MachineryItemState` is NotAvailable, OutOfService, NotExecuting or Executing.
- **Odoo**: `loss_type` is `productive`, `performance`, `availability` or `quality`.
- **Rationale**: A current clip can tell running from not running, and it can tell power from no power. Any finer state (setup, starved, feed hold) needs a person or a controller.

### 7. A minimum state duration filters noise and micro-stops

- **MachineMetrics**: "Microstop Duration" is 60 s by default. Shorter stops "typically [are] not categorized". The edge `debounce` transform filters "brief changes … less [than] the specified window".
- **Tulip**: An example trigger holds "Running" until 30 consecutive seconds pass below the threshold.
- **Vorne XL**: The Down threshold is 3 minutes with no signal by default. A shorter gap is a small stop.
- **FourJaw**: A stop needs no reason for 5 minutes by default.
- **Guidewheel**: An issue opens when, for example, the load is "below the idle threshold for more than 2 minutes".
- **Rationale**: Raw current crosses the threshold many times in one cycle. Without a minimum duration, a single run becomes hundreds of short events.

## Answers to Research Questions

1. **How do OEE vendors attribute machine time to a job?** — With an explicit active job per machine. No vendor infers the job from the dispatch order. 4 sources set the active job:
   - An operator on a tablet: MachineMetrics Operator mode, FourJaw, Guidewheel Sidekick Runs, Evocon, Tulip.
   - A barcode scan: Vorne XL, MachineMetrics ShopPulse.
   - ERP clock-ins: MachineMetrics ERP-driven mode.
   - The CNC program number: MachineMetrics APM, Datanomix.

   The ERP pushes the job list in: FourJaw by CSV or API, Evocon by API, Vorne by the XL API, Redzone by schedule import. FourJaw prompts the operator when the machine runs and nobody has booked on. It also books the job off by itself when the machine stops being productive.
2. **How do ERP/MES products ingest machine signals?**
   - (a) **Connector abstraction.** Every enterprise product has a connector layer:
     - SAP: PCo and the production connector.
     - Epicor: the MIU (CF-MIU) and Epicor IoT.
     - Plex: Kepware with Automation & Orchestration.
     - Siemens: the Automation Gateway and Industrial Edge connectors.

     Job-shop ERPs (ProShop, JobBOSS², GSS, Fulcrum) have no connector layer of their own. They rely on fixed partners: MachineMetrics, Datanomix and Amper.
   - (b) **Mapping.** One machine maps to one resource. Many machines can map to one resource or group (SAP, MachineMetrics, Epicor, MRPeasy).
   - (c) **Unattributed time.** MachineMetrics uses the Unknown Job. GSS uses an "UNASSIGNED" resource. Amper uses a "No Job to Run" code. SAP, Epicor, Plex and Opcenter do not document it.
   - (d) **Posting.** SAP posts after approval, which can be automatic. MachineMetrics posts on ticket submission. Epicor posts on a scheduled export. Odoo costs at once.
   - (e) **States.** SAP uses the SEMI E10 states, and availability = net production time ÷ loading time. Scheduled Down is outside loading time. Odoo has 4 loss types and computes OEE as productive time ÷ (productive + blocked).
3. **Standards.**
   - ISA-95 records "which job ran on which equipment" as a Job Response with an Equipment Actual. Level 3 (the MES) writes it, not the equipment.
   - MTConnect has `Execution` (ACTIVE, READY, INTERRUPTED, FEED_HOLD, STOPPED and 4 more), `ControllerMode`, `Availability`, `Program`, `PartCount`, `PartId` and `ProcessAggregateId.OrderNumber`.
   - A current clip can give only ACTIVE versus not active, plus a link state close to MTConnect `Availability`. It cannot give the program, the part count, the controller mode or the order number.
   - OPC UA `MachineryItemState` (4 states) carries no job. OPC 40501-1 `ProductionJob.OrderIdentifier` carries a job only when the MES sent it.
   - ISO 22400 defines availability as APT ÷ PBT. Planned down time (PDOT) is outside PBT.
4. **Practical concerns.**
   - **Debounce.** See pattern 7: 30 s (Tulip) to 3 min (Vorne), with micro-stops at 60 s (MachineMetrics).
   - **Offline gaps.** The MachineMetrics edge device buffers during an internet outage and backfills over "several minutes to a few hours". A power loss loses data. The Evocon device stores 5 days to 2 weeks. FourJaw shows "Awaiting data", and more than 10 minutes means a fault.
   - **Gaps and availability.** No vendor documents whether gap time counts against availability. Guidewheel and the MachineMetrics API report the gap as its own state (`nodata`, `UNAVAILABLE`).
   - **Timezone and shifts.** MachineMetrics has one timezone and a Start of Day per company. Vorne sets a timezone and a weekly schedule per device. Evocon sets shift templates per station. FourJaw Classic has one timezone per account. MachineMetrics treats a machine with no shifts as scheduled 24/7.
   - **Polling.** Guidewheel allows 1000 calls/day and 50 per minute. FourJaw allows 100 requests per minute per key. MachineMetrics GraphQL allows 1000 requests per minute per company. The MachineMetrics JobBOSS² connector polls every 5 minutes.
   - **Idempotency.** MachineMetrics identifies a state by `machineRef` + `metricKey` + `eventTime`, with no event id. Its data "can contain records of unchanged states". MTConnect clients page by sequence number and reset when `instanceId` changes.
   - **Threshold changes.** A Guidewheel threshold change applies only from that point on. Support can backfill the history.
   - **Sense API.** The Sense API (`bifrost.sensemfg.com/docs`) did not load, and no archive copy exists. Its states, cadence, limits and event ids are **unanswered**.

## Competitor-Specific Details

### SAP Digital Manufacturing / S/4HANA

- The resource status is the unit of state. Down and Unknown block an SFC start.
- DM can set Unscheduled Down by itself when a machine stops. It can also finish an SFC when a status tag changes.
- The Time Tracking service writes resource usage records with start and stop events. Records reach S/4HANA only if "Report duration of Production time to ERP" is on.
- The S/4HANA confirmation proposes routing standard values. The actual machine time can replace them.

### Epicor Kinetic / Advanced MES

- Standard Kinetic MES "does not do anything with machine data". The "Machine MES" flag only syncs with Advanced MES.
- When a machine stops, Advanced MES forces the operator to pick a downtime reason, or it alerts the supervisor.
- Epicor IoT can link a device to a record. A link to a job operation needs custom BPM work.

### Plex and Siemens Opcenter

- Plex Production Monitoring needs "one simple connection to a machine's cycle counter". Cycle counts become production against the current job.
- The Opcenter gateway binds OPC UA nodes to data collection fields "on active work order operations". The order context comes from dispatch.

### Odoo

- The `mrp.workcenter.productivity` fields are `workcenter_id` (required), `workorder_id` (optional), `loss_id` (required), `loss_type`, `date_start`, `date_end`, `duration` and `user_id`.
- `workorder_id` is optional, so a row with no work order is legal. That row is Odoo's version of the unknown bucket.
- Odoo does not split time between concurrent work orders. Each work order gets its own full timeline.

### MachineMetrics

- It has three job modes per machine: Operator, Program (APM) and ERP Driven.
- The ignore list removes warmup and probe programs (for example O9xxx) from matching.
- A "stale" program that runs after its job is Complete is "not attributed to any job". The views show "Waiting for Work".
- The "Unattended Inactive Threshold" (for example 30 minutes) turns idle time on an unattended shift into unscheduled time. That time does not lower availability.
- The "Record labor as" setting points a machine at one ERP resource. "Schedule jobs as" can point at several resources.
- Through the GSS connector, it splits overlapped labor evenly across concurrent jobs. "Two jobs run in parallel from 8:00 to 12:00 are each charged two hours rather than four."
- It also posts uncovered machine time as a record for a "phantom employee with a $0 pay rate", so only the work center rate applies. "Each work center that ran carries its run window exactly once."

### Guidewheel (current clip)

- The unit is a "production entry": one production run on one device, with a start and an end.
- It can create entries from the Plant Schedule before each shift. These entries have "no product, quantity, or crew".
- A user can create a missing downtime issue by hand for a time window.

### FourJaw (current clamp)

- The work order CSV needs 5 fields: work order number, operation number, part number, quantity and machine. The machine name must match exactly.
- `booked-time-periods` returns `machine_id`, `operation_id`, start and end. The end is null while the booking is open.
- "Actual run time" is the booked tablet time, including all downtime. FourJaw does not measure performance.

### Vorne XL

- "Manual Run Detection" accepts a Run, Down or "Run + Down" digital signal. This is the closest match to an on/off clip.
- Vorne recommends a Down threshold that gives no more than 25 down events per shift.

### Sense Manufacturing

- The hardware is a clip-on Power Monitor and a stick-on Vibration Monitor. The public states are "Running, idle, or faulted".
- The control unit processes data locally and sends it over WiFi or ethernet. MTConnect is optional.
- The pricing page lists no job or work order feature. Sense has no job concept to import.

## Recommended Approach for Carbon

Carbon facts that constrain the design:

- `productionEvent.jobOperationId` is `NOT NULL`. A Machine event cannot exist without an operation.
- `productionEvent.type` is `Setup`, `Labor` or `Machine`. Costing reads `workCenter.machineRate` for `Machine` events.
- `jobOperation.status` already has `In Progress`, `Paused` and `Done`.
- The closest sibling for a pluggable provider is the accounting provider layer (`packages/ee/src/accounting/providers/`: `quickbooks-online`, `xero`, `rillet`).

Recommendations:

1. **Add a provider adapter with a narrow contract** (SAP PCo, Epicor MIU and Siemens gateway pattern). The adapter lists stations and returns state intervals since a cursor. Copy the accounting provider layout. An Inngest cron polls each connection.
2. **Map each provider state to one Carbon state**: `Running`, `Idle`, `Down` or `Offline` (pattern 6). For Sense, Active → `Running`, Idle → `Idle`, Alert → `Down`, Offline → `Offline`.
3. **Map one station to one work center, and allow many stations per work center** (SAP, MachineMetrics, Epicor). The work center keeps the machine rate. Key every interval and every attribution on the station, not on the work center. Two machines in one work center run different jobs.
4. **Keep an explicit "operation on station" binding** (MachineMetrics Operator mode, FourJaw book-on, Plex setup, SAP active SFC). An operator sets the binding when the operator starts Setup or Labor on an operation at that station in MES. The binding must outlive the operator's clock-out. This is what makes unattended run time attributable. The binding ends in 3 cases:
   1. The operator completes or pauses the operation.
   2. The operation goes to `Done`.
   3. Another operation starts on the same station. FourJaw pauses the current job in this case.

   Do not use the dispatch queue order. No surveyed product does.
5. **Create a Machine `productionEvent` only for `Running` time inside a binding.** The event carries the station's work center and the bound `jobOperationId`. Cost follows the existing `machineRate` path, as in Odoo.
6. **Store `Running` time with no binding as unattributed run time, never as a guess** (MachineMetrics Unknown Job). It needs its own table, because `productionEvent` requires an operation. Show a reconciliation list per work center. In that list, a supervisor assigns a block to an operation, splits it, or marks it as not job time. This list also covers late bindings (Evocon past changeover, MachineMetrics "Add Production Run").
   - Offer candidate operations from the station's work center in that window. The system proposes, and a person confirms, as with a MachineMetrics "Suggested" match.
7. **Make posting a decision for the spec.** The consensus is a confirmation step (SAP approval, MachineMetrics submission). In Carbon, the job completion function posts unposted production events as absorption journal entries. So a Machine event can change until the job completes. Automatic creation inside a binding therefore matches SAP with auto-approval.
   - Create Machine events for bound time automatically.
   - Assign unattributed time by hand.
8. **Apply a minimum state duration per connection** (MachineMetrics 60 s micro-stop, Tulip 30 s hold). Merge a `Running` → not-running → `Running` sequence when the gap is shorter than the threshold. Drop a `Running` block shorter than the threshold. Start with 60 s.
9. **Treat `Offline` as no data, never as running and never as down.** Close an open `Running` interval at the last confirmed timestamp. If the provider backfills buffered data later, re-read that window. MachineMetrics backfill takes minutes to hours.
10. **Poll with an overlapping window and write idempotently.** Key each interval on (connection, station, start time). Re-read a fixed overlap behind the cursor. A provider may send unchanged states again, and a still-open interval grows on each poll. Use a 5-minute cadence: it fits Guidewheel's 1000 calls/day limit and the MachineMetrics JobBOSS² default.
11. **Store UTC and show times in the work center location's timezone** (Vorne per device, MachineMetrics per company). Leave planned downtime and OEE availability for a later phase. Run time and job cost are the v1 value.
12. **Allow one binding per station in v1** (MachineMetrics Operator mode, FourJaw). Concurrent operations on one station need a split rule, and the products disagree. GSS splits time evenly, and Odoo gives each operation the full time. Carry this into the spec as an open question.

Open questions for the spec:

- What is the Sense API shape? This covers state names, interval or event form, an event id, the cursor, rate limits and backfill after an outage. This research could not read `bifrost.sensemfg.com/docs`.
- Does Carbon need a station entity below the work center? The other option is a provider station table that points at a work center.
- Must the binding come only from MES Setup and Labor starts, or also from a "load on machine" action that has no labor time?
- Who may reconcile unattributed time, and does it expire?
- Which rule applies to concurrent operations on one station: an even split, or full time to each?

## Sources

- https://docs.machinemetrics.com/docs/product-guides/production-tracking/job-tracking-guide
- https://docs.machinemetrics.com/docs/product-guides/production-tracking/operations-production-runs-guide
- https://docs.machinemetrics.com/docs/product-guides/production-tracking/apm-guide
- https://docs.machinemetrics.com/docs/product-guides/production-tracking/machine-production-settings
- https://docs.machinemetrics.com/docs/product-guides/mes/erp-driven-mes
- https://docs.machinemetrics.com/docs/product-guides/mes/mes-admin-guide/
- https://docs.machinemetrics.com/docs/product-guides/downtime/downtime-guide
- https://docs.machinemetrics.com/docs/product-guides/downtime/automatic-downtime-categorization-guide
- https://docs.machinemetrics.com/docs/integrations/erp-connectors/
- https://docs.machinemetrics.com/docs/integrations/erp-connectors/jobboss2-connector
- https://docs.machinemetrics.com/docs/integrations/erp-connectors/proshop-connector
- https://docs.machinemetrics.com/docs/integrations/erp-connectors/global-shop-solutions-connector/
- https://docs.machinemetrics.com/docs/security-compliance/edge-device-security
- https://docs.machinemetrics.com/docs/getting-started/edge-device-setup-guide
- https://docs.machinemetrics.com/docs/system-settings/machine-schedules
- https://docs.machinemetrics.com/docs/system-settings/company
- https://developers.machinemetrics.com/docs/adapter-scripts/transforms/debounce
- https://developers.machinemetrics.com/docs/adapter-scripts/transforms/off-delay
- https://developers.machinemetrics.com/docs/adapter-scripts/transforms/threshold
- https://developers.machinemetrics.com/docs/adapter-scripts/transforms/when-unavailable
- https://developers.machinemetrics.com/docs/data-and-apis/graphql/limits
- https://developers.machinemetrics.com/docs/data-and-apis/graphql/examples
- https://developers.machinemetrics.com/docs/data-and-apis/graphql/reference/operations/queries/state-intervals
- https://developers.machinemetrics.com/docs/data-and-apis/data-catalog/machine-data
- https://www.machinemetrics.com/production-scheduling-software
- https://support.guidewheel.app/en/articles/16925627-start-and-stop-a-production-run-in-sidekick-runs
- https://support.guidewheel.app/en/articles/9290142-how-to-add-manual-production-entries
- https://support.guidewheel.app/en/articles/15696169-guidewheel-api-cmms-erp-integration-guide
- https://support.guidewheel.app/en/articles/12384073-automatically-create-production-entries-from-your-plant-schedule
- https://support.guidewheel.app/en/articles/7829820-oee-calculation-settings
- https://support.guidewheel.app/en/articles/8006558-how-to-set-thresholds-for-machine-states
- https://support.guidewheel.app/en/articles/11773806-what-s-the-difference-between-an-alert-and-an-issue
- https://support.guidewheel.app/en/articles/16925686-create-a-missing-downtime-issue-in-sidekick-runs
- https://support.guidewheel.app/en/articles/8880065-how-to-set-up-and-track-planned-downtime
- https://support.guidewheel.app/en/articles/11773727-will-my-runtime-percentage-automatically-recalculate-when-i-update-my-thresholds
- https://support.guidewheel.app/en/articles/11773757-no-data-available-error-on-the-uptime-page
- https://support.guidewheel.app/en/articles/11492347-how-to-create-and-manage-shifts
- https://support.guidewheel.app/en/articles/6732403-api-integrate-with-guidewheel
- https://support.guidewheel.app/en/articles/12749717-understanding-device-lists-vs-device-groups-in-guidewheel
- https://github.com/api-evangelist/guidewheel
- https://help.fourjaw.com/knowledge/operate-book-jobs-on-and-off-fourjaw-classic
- https://fourjaw.com/blog/intelligent-shop-floor-data-capture-with-the-power-of-machine-monitoring
- https://help.fourjaw.com/knowledge/finding-and-starting-jobs-on-the-tablet
- https://help.fourjaw.com/knowledge/importing-work-orders
- https://fourjaw.app/api/v1/openapi.json
- https://help.fourjaw.com/knowledge/work-order-auto-csv-import
- https://help.fourjaw.com/knowledge/managing-work-orders
- https://help.fourjaw.com/knowledge/how-does-fourjaw-machinelink-work
- https://help.fourjaw.com/knowledge/what-does-no-reason-provided-or-no-reason-required-mean
- https://help.fourjaw.com/knowledge/tablet-downtime-auto-labeller
- https://help.fourjaw.com/knowledge/what-is-the-difference-between-productive-and-unproductive-downtime
- https://help.fourjaw.com/knowledge/how-does-fourjaw-calculate-oee
- https://help.fourjaw.com/knowledge/signal-calibration
- https://help.fourjaw.com/knowledge/what-does-awaiting-data-mean
- https://help.fourjaw.com/knowledge/what-happens-if-the-fourjaw-hardware-is-unplugged
- https://help.fourjaw.com/knowledge/what-happens-if-our-wi-fi-goes-down
- https://help.fourjaw.com/knowledge/timezone-settings-fourjaw-classic
- https://help.fourjaw.com/knowledge/fourjaw-api-documentation
- http://web.archive.org/web/20250323022749/https://www.amper.xyz/features/job-tracking
- https://www.ecisolutions.com/products/amper/
- https://www.ecisolutions.com/products/amper/amper-for-eci-customers/
- http://web.archive.org/web/20230206184038/https://blog.amper.xyz/how-to-label-machine-downtime-using-amper
- https://www.moldmakingtechnology.com/articles/oee-monitoring-system-addresses-root-cause-of-machine-downtime-
- https://support.evocon.com/ (Help Desk articles: "Marking product changeovers", "Adding and managing products", "Evocon API Integrations", "Shift View colors", "Marking reasons for production stops", "Shift scheduling", "Downtime auto-commenting", "Setting maximum duration for stop reasons", "For how many days can the Evocon device keep stored data?", "Live/offline indicator", "Evocon Advanced Analytics & reporting API access", "Managing stations")
- https://evocon.com/articles/evocon-sap-erp-integration/
- https://evocon.com/articles/evocon-erp-integrations/
- https://evocon.com/articles/feature/shift-view-real-time-production-monitoring-system
- https://evocon.com/kb/the-six-big-losses-in-manufacturing
- https://evocon.com/enterprise-package/
- https://evocon.com/articles/track-monitor-machine-working-time/
- https://www.sensemfg.com/how-it-works
- https://www.sensemfg.com/resources/a-text-alert-saved-atlas-tool-works-from-12-hours-of-lost-machine-time
- https://www.sensemfg.com/resources
- https://www.sensemfg.com/pricing
- https://www.vorne.com/support/product-manuals/configure-xl.pdf
- https://www.vorne.com/support/product-manuals/meet-xl.pdf
- https://www.vorne.com/support/deploy-xl-manual-run-detection.pdf
- https://www.vorne.com/products/xl-past-software-versions/
- https://www.vorne.com/support/product-manuals/xl-api/
- https://datanomix.io/production-monitoring/
- https://datanomix.io/2022/09/09/proshop-mms/
- https://datanomix.io/data_faq/
- https://datanomix.io/2025/09/30/datanomix-launches-universal-erp-connector/
- https://datanomix.io/2022/06/21/datanomix-announces-automated-downtime-insights/
- https://datanomix.io/fulcrum/
- https://support.tulip.co/docs/machine-monitoring-data-model
- https://support.tulip.co/docs/machine-attributes-downtime-reasons-and-states
- https://support.tulip.co/docs/machine-monitoring-app-based-architecture-patterns
- https://support.tulip.co/docs/create-your-first-machine-trigger
- https://support.tulip.co/docs/machine-monitoring-performance-scalability
- https://support.tulip.co/docs/machine-monitoring-terminal-1
- https://support.tulip.co/docs/machine-monitoring-troubleshooting
- https://shoplogix.com/pricing-platform/
- https://shoplogix.com/core-products/
- https://www.rzsoftware.com/product/integrations
- https://www.rzsoftware.com/product/productivity
- https://www.rzsoftware.com/product/scheduling
- https://www.igz.com/en/competences/sap-manufacturing/machine-connection/
- https://learning.sap.com/courses/implementing-machine-integration-in-sap-digital-manufacturing/describing-sap-digital-manufacturing-machine-integration-architecture
- https://learning.sap.com/courses/exploring-customization-in-sap-digital-manufacturing/different-ways-to-trigger-production-processes-in-sap-dm
- https://help.sap.com/docs/sap-digital-manufacturing/execution/manage-work-centers
- https://help.sap.com/docs/sap-digital-manufacturing/execution/sfcs
- https://community.sap.com/t5/product-lifecycle-management-blog-posts-by-members/auto-start-complete-with-pco-in-sap-digital-manufacturing/ba-p/13574025
- https://help.sap.com/docs/sap-digital-manufacturing/apis/time-tracking
- https://help.sap.com/docs/sap-digital-manufacturing/execution/manage-time-records
- https://community.sap.com/t5/product-lifecycle-management-q-a/labor-tracking-hours-posting-to-erp-from-digital-manufacturing/qaq-p/13755236
- https://learning.sap.com/courses/exploring-business-processes-in-sap-s4-hana-discrete-shopfloor-control/confirming-production-orders_d5811bf4-fb07-411d-8bdb-0f9cec11e4db
- https://erpcorp.com/sap-controlling-blog/activity-postings-1-activity-types-in-review
- https://learning.sap.com/courses/configuring-sap-digital-manufacturing-for-execution-basic-data-and-configuration/creating-resources
- https://help.sap.com/docs/sap-digital-manufacturing/execution/tool-status
- https://learning.sap.com/courses/analyzing-manufacturing-data-in-sap-digital-manufacturing/oee-calculation-in-dm
- https://www.e3s-conferences.org/articles/e3sconf/pdf/2018/13/e3sconf_icemee2018_02027.pdf
- https://www.top10erp.org/products/epicor-mattec-advanced-mes
- https://encompass-inc.com/advanced-mes-connected-factory-machine-interface-unit-epicor-kinetic/
- https://www.gingerhelp.com/knowledgebase-epicor-erp/integrating-iiot-devices-with-epicor
- https://www.epiusers.help/t/mes-machine-utilization/91778
- https://www.epiusers.help/t/mattec-advanced-mes-machines/81080
- https://www.epiusers.help/t/mattec-mes/84042
- https://support.machinemetrics.com/hc/en-us/articles/360026062834-Epicor-Installation-and-Integration-ERP-Systems-
- https://scaledsolutionsgroup.com/deep-dive-how-epicor-kinetic-advanced-mes-transforms-shop-floor-control/
- https://www.epicor.com/en-us/products/manufacturing-execution-software-mes/advanced-mes/data-exchange/
- https://www.rockwellautomation.com/en-us/products/software/factorytalk/operationsuite/mes/plex-production-monitoring.html
- https://plex.rockwellautomation.com/en-us/resources/10285-m-e-s-automation-orchestration-brochure-2.html
- https://blog.themerlanos.com/2026/06/production-monitoring-in-plex-erp.html
- https://www.vanmeterinc.com/rockwell-plex/production-monitoring
- https://www.cumulus-erp.com/plex-ao-apm/
- https://www.siemens.com/en-us/content/architecture-hub/op-center/
- https://blogs.sw.siemens.com/opcenter/the-essentials-of-siemens-opcenter-execution-process-3-0/
- https://www.connectedmanufacturing.com/knowledge-topics/opcenter-and-sap-integration
- https://www.siemens.com/en-us/products/opcenter/execution/foundation-oee/
- https://github.com/industrial-edge/Performance-Insight-OEE-Dashboard
- https://github.com/odoo/odoo/blob/18.0/addons/mrp/models/mrp_workcenter.py
- https://github.com/odoo/odoo/blob/18.0/addons/mrp/models/mrp_workorder.py
- https://github.com/odoo/odoo/blob/18.0/addons/mrp/data/mrp_data.xml
- https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/manufacturing/advanced_configuration/using_work_centers.html
- https://www.odoo.com/documentation/16.0/applications/productivity/iot/devices/footswitch.html
- https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/manufacturing/reporting/oee.html
- https://www.sensflo.ai/articles/how-sensflo-helps-high-value-job-shops-measure-monitor-spindle-hours
- https://proshoperp.com/blog/keep-making-chips/
- https://proshoperp.com/blog/cost-accounting/
- https://supergood.ai/docs/e2-shop-system-api
- https://www.globalshopsolutions.com/shop-floor-data-collection-for-manufacturing
- https://fulcrumpro.com/fulcrum-integrations
- https://fulcrumpro.com/c/operations
- https://fulcrumpro.com/article/streamline-production-with-work-orders-in-fulcrum
- https://fulcrumpro.com/manufacturing-software/job-tracking
- https://www.mrpeasy.com/blog/overall-equipment-effectiveness/
- https://www.mrpeasy.com/resources/user-manual/production-planning/work-station-types/reports/
- https://www.mrpeasy.com/resources/user-manual/production-planning/work-stations/
- https://katanamrp.com/features/manufacturing/
- https://reference.opcfoundation.org/ISA-95/v100/docs/7.4.1
- https://reference.opcfoundation.org/specs/OPC-10030/8.2
- https://reference.opcfoundation.org/ISA95JOBCONTROL/v200/docs/4
- https://reference.opcfoundation.org/ISA95JOBCONTROL/v200/docs/4.3
- https://reference.opcfoundation.org/specs/OPC-10031-4/6.2.1.1
- https://github.com/MESAInternational/B2MML-BatchML/tree/master/Schema
- https://reference.opcfoundation.org/specs/OPC-30050/6.3.8
- https://beckhoff-usa-community.github.io/SPT-Libraries/References/PackML.html
- https://model.mtconnect.org/Version2.6/Profile/DataTypes/ExecutionEnum/
- https://model.mtconnect.org/Version2.6/Profile/DataTypes/ControllerModeEnum/
- https://model.mtconnect.org/Version2.6/Profile/DataTypes/AvailabilityEnum/
- https://model.mtconnect.org/Version2.6/ObservationInformationModel/ObservationTypes/EventTypes/ProgramHeader/
- https://model.mtconnect.org/Version2.6/ObservationInformationModel/ObservationTypes/EventTypes/PartCount/
- https://model.mtconnect.org/Version2.6/ObservationInformationModel/ObservationTypes/EventTypes/PartId/
- https://model.mtconnect.org/Version2.6/ObservationInformationModel/ObservationTypes/EventTypes/WorkOffset/
- https://model.mtconnect.org/Version2.6/ObservationInformationModel/ObservationTypes/EventTypes/ProcessAggregateIdOrderNumber/
- https://model.mtconnect.org/Version2.6/ObservationInformationModel/ObservationTypes/EventTypes/PartUniqueId/
- https://model.mtconnect.org/Version2.6/ObservationInformationModel/ObservationTypes/EventTypes/ProcessOccurrenceId/
- https://docs.mtconnect.org/MTC_Part_1_Overview+V1.2.pdf
- https://reference.opcfoundation.org/specs/OPC-40001-1/12.2
- https://reference.opcfoundation.org/specs/OPC-40001-1/13
- https://reference.opcfoundation.org/specs/OPC-40501-1/8.4
- https://reference.opcfoundation.org/specs/OPC-40001-3/7
- https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=919754
- https://standards.iteh.ai/catalog/standards/iso/8a9efc01-6c74-42a2-ad8f-ec19e84b48f0/iso-22400-2-2014
- https://www.oee.com/oee-glossary/
