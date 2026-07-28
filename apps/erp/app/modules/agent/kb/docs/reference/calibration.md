# Gauges and calibration

> Track measurement instruments, schedule their calibrations, and flag any gauge that falls out of calibration.

A gauge is a measurement instrument you keep under control: a caliper, a micrometer, a pin gauge, a CMM. Carbon tracks each one as a record, holds it to a recurring calibration schedule, and marks it out of calibration the moment it's overdue. Every calibration you perform is logged as its own dated record, so the gauge carries its full history.

Gauges live in the quality module alongside `docs/reference/quality`. They're managed on their own, though: a gauge is not attached to an inspection you record. Carbon keeps the instrument controlled so the person taking a measurement knows the tool is trustworthy.

## The gauge record

Add a gauge under Quality → Gauges. Each gauge belongs to a **gauge type** (Caliper, Micrometer, Pin Gauge, Surface Plate, CMM, and so on) and carries a calibration schedule. A fresh company ships with about twenty pre-seeded gauge types; add your own with just a name.

  - **gaugeId**: A human-readable identifier (like `G-001`). Leave it blank and Carbon assigns the next one from a sequence.
  - **gaugeTypeId**: The gauge type — a caliper, micrometer, pin gauge, and so on. Required.
  - **gaugeRole**: Either `Master` or `Standard`. A Master gauge is the reference you calibrate other gauges against; a `Standard` gauge is one you use for routine checks. Required.
  - **calibrationIntervalInMonths**: How many months between calibrations. This drives the next-due date. Minimum 1; defaults to 6.
  - **description**: A free-text description of the instrument.
  - **modelNumber**: The manufacturer's model number.
  - **serialNumber**: The instrument's serial number.
  - **supplierId**: The supplier the gauge was acquired from.
  - **dateAcquired**: When you acquired the gauge.
  - **lastCalibrationDate**: When the gauge was last calibrated. Carbon sets this from the newest calibration record.
  - **nextCalibrationDate**: When the gauge is next due. Carbon recomputes this as *last calibration date + interval* each time you log a calibration.
  - **locationId**: Which location the gauge lives at.
  - **storageUnitId**: Which storage unit holds it.

A gauge also has a **status** of `Active` or `Inactive`. Deactivating a gauge (rather than deleting it) is the right move when it has calibration history: an inactive gauge is treated as out of calibration, and its records stay on file. Delete only a gauge that was never calibrated.

## The calibration schedule

You don't set a next-due date by hand. You set the **interval** in months on the gauge, and Carbon does the arithmetic every time you record a calibration: it stamps the calibration date as the last calibration date and sets the next-due date to that plus the interval. A caliper calibrated on the first of January against a six-month interval comes due on the first of July.

The interval and the last calibration date together are the whole schedule. Change the interval and the next calibration you log recomputes the due date from it.

## Recording a calibration

Each time a gauge is calibrated, log it as a **calibration record** under Quality → Calibrations. The record is the evidence: who signed off, against what standard, under what conditions, and the actual readings taken.

  - **gaugeId**: The gauge being calibrated. Required.
  - **dateCalibrated**: The date of the calibration. This becomes the gauge's last calibration date and the anchor for the next-due date. Required.
  - **requiresAction**: Recorded that follow-up is needed after this calibration.
  - **requiresAdjustment**: Recorded that the gauge was adjusted during calibration.
  - **requiresRepair**: Recorded that the gauge needs repair.
  - **calibrationAttempts**: The reading pairs taken during calibration — each is a reference value and the actual value measured against it.
  - **measurementStandard**: The traceable reference the readings were compared against (a NIST standard, a master gauge serial, and so on).
  - **temperature**: The ambient temperature during calibration, in degrees Celsius.
  - **humidity**: The ambient humidity during calibration, as a fraction from 0 to 1.
  - **supplierId**: The supplier that performed the calibration, if it was done externally.
  - **approvedBy**: The user who approved the calibration.
  - **notes**: Free-form notes on the calibration.

The three "requires" checkboxes decide whether the calibration passed. Tick any one of them and the calibration is a **Fail**; leave all three clear and it's a **Pass**. That result is what drives the gauge's calibration status, so recording a calibration is also how a gauge changes state.

Logging a calibration never overwrites the last one. Each record is a dated row, and the gauge shows them newest-first. What the gauge summarizes from them is the *latest* calibration date and the resulting status.

## Calibration status and going overdue

A gauge carries a calibration status with three values, and Carbon sets it for you.

  - **Pending**: The starting state. The gauge has a schedule but no passing calibration on record yet, so it's neither confirmed in nor out.
  - **In-Calibration**: The most recent calibration passed and the next-due date is still in the future. The gauge is trustworthy.
  - **Out-of-Calibration**: The most recent calibration failed, the gauge is inactive, or the next-due date has passed. The gauge needs recalibrating.

This isn't a lifecycle you step through by hand — it's derived. Record a passing calibration and the gauge moves to `In-Calibration`; record a failing one and it moves to `Out-of-Calibration`. On top of that, Carbon computes overdue on the fly: whenever a gauge is `Inactive` or its next-due date is before today, it reads as `Out-of-Calibration` regardless of the stored value. A gauge that passed calibration in January but was due in July shows overdue the moment July passes, without anyone touching it.

You never mark a gauge overdue. The out-of-calibration reading for a past-due or inactive gauge is derived at read time from the next-due date, so it flips on its own the day the schedule lapses. Bringing it back is a matter of logging a fresh passing calibration.

Carbon can also nudge you before things lapse. A scheduled job checks for gauges going out of calibration and notifies the people you've listed for calibration-expiry alerts in company settings, so an overdue gauge doesn't sit unnoticed.

## Related

  - Quality Issues, corrective-action workflows, and inbound inspection.

## Troubleshooting

Exact errors from the gauge and calibration validators, plus how pass/fail and overdue are derived.

### "Calibration interval is required"
The calibration interval must be a positive whole number of months (minimum 1). Zero, blank, or a negative value is rejected — enter how many months should pass between calibrations.

### "Type is required" / "Gauge is required" / "Date is required"
Form-validation. A gauge needs a gauge type; a calibration record needs the gauge it applies to and the date it was calibrated.

### "Failed to insert gauge" / "Failed to update gauge" / "Failed to insert gauge calibration record"
The underlying write failed — a database constraint, a sequence issue, or a permission denial. Reload and retry; confirm your role has the needed quality permission.

### A calibration recorded Pass but the gauge still reads Out-of-Calibration
Pass/fail is derived from three flags on the record — requires action, requires adjustment, requires repair. If **all three** are false the record is a **Pass** and the gauge moves to `In-Calibration`; if **any** is set it's a **Fail** and the gauge moves to `Out-of-Calibration`. Overdue is a separate, computed reading: a gauge whose next-due date is in the past (or that is Inactive) reads `Out-of-Calibration` regardless of the last stored result. Log a fresh passing calibration with a future next-due date to clear it.

### An overdue gauge is not blocking inspections
By design. Carbon computes and displays `Out-of-Calibration` and can notify the people listed for calibration-expiry alerts, but there is **no enforced block** — samples can still be recorded and lots accepted or rejected with an overdue gauge. The status is advisory; treat it as a signal, not a gate.

### Deactivate vs. delete a gauge
**Deactivate** sets the gauge to `Inactive` and preserves the record and its calibration history (and makes it read as out-of-calibration). **Delete** removes the gauge record entirely. Deactivate when you want the history; both actions require `quality` **delete** permission.
