# People

> The HR master data a company sets up — employees, departments, shifts, holidays, custom attributes, and time cards.

**People** is where you manage the human side of a company: the employees who work there, how they're organized, when they're scheduled, and the custom fields you track against each one. It sits alongside identity and access — an employee record is the org-and-scheduling layer, while login, roles, and what someone is *allowed* to do live in `docs/reference/permissions`.

A person in Carbon is one record split across three tables. The `user` is the global login identity. The `employee` is that user's membership in *this* company. The `employeeJob` holds their org placement — title, location, department, shift, and manager. They share the same id and are always scoped to a company, so the same person can be an employee of more than one company with a different title and manager in each.

## Employees

The **Employees** directory (under **Manage**) lists everyone in the company. Each row shows first and last name, email, employee type, location, and a **Status** of **"Active"**, **"Invited"**, or **"Inactive"** — derived from the employee record and any pending invite, not stored as a field. Open a person to see their **Profile**, **Job**, and **Notes**, plus a tab per attribute category and a **Timecards** tab when time cards are enabled.

The **Job** section is the employee master data you edit here:

  - **Title**: The person's job title within this company. This is *not* their permission role — see the callout below.
  - **Start Date**: When they started.
  - **Location**: The site they're based at.
  - **Shift**: Their assigned work schedule (optional).
  - **Manager**: Who they report to; another employee.

"Job" here means a job *title*, not a production job. The `employeeJob` table is org placement — completely separate from the `job` table that holds work orders on the floor. And a person's title is separate again from what they can *do*: access is granted by their **employee type**, covered in `docs/reference/permissions`.

Adding and removing people (invites, deactivation) is part of the identity and access flow, not this master data. Deactivating a person tears down their membership — it removes them from the company, deletes their job placement, and revokes their access — so treat it as an access action, not an edit here.

## Departments

A **department** is an organizational unit. Each has a name and an optional Parent Department, so departments form a hierarchy you can roll headcount up through. Employees attach to a department via their job placement.

  - **Department Name**: Unique within the company.
  - **Parent Department**: The department this one rolls up under; leave empty for a top-level department.

Departments are configuration, so they live under **Configure**. Deleting a department is a hard delete — check that no one is assigned to it first, since removing it leaves those job placements without a department.

## Shifts

A **shift** is a named work schedule tied to a location: a start time, an end time, and the days of the week it runs. You assign a shift to an employee through their **Job** section, and Carbon uses shift membership to answer *who's scheduled today* — it reads each employee's shift and checks whether today's day-of-week flag is on.

  - **Shift Name**: What the schedule is called.
  - **Location**: The site the shift belongs to. Required.
  - **Start Time**: When the shift begins.
  - **End Time**: When it ends.
  - **Days**: Monday through Sunday toggles — the days the shift runs.

Shifts are an employee-and-location concept, not a work-center one. A shift is never bound to a `docs/reference/work-centers`; it schedules *people*, and a work center's load comes from the operations scheduled onto it, not from who's on shift.

Deleting a shift is a soft delete — the record is marked inactive rather than removed, so historical assignments stay intact.

## Holidays

A **holiday** is a company non-working day: a name and a date. The year is derived from the date automatically, and the list groups by year so you can review one calendar year at a time.

  - **Holiday Name**: What the day is called.
  - **Date**: The calendar date. Its year is computed from this.

## Attributes

**Attributes** are custom fields you track against people — things Carbon doesn't model natively, like a certification expiry, a badge number, or a t-shirt size. They're organized in two layers: an **attribute category** groups related fields, and each **attribute** inside it is one field with a data type.

A category carries a name, an emoji, and a Public toggle that controls whether its attributes show on a person's public profile or stay admin-only.

Each attribute defines:

  - **Name**: What the field is called.
  - **Data Type**: The kind of value it accepts. See below.
  - **List Options**: The allowed values, only when the data type is *List*.
  - **Self Managed**: When on, employees can edit this value on their own profile; otherwise only admins can.

The Data Type comes from a fixed set: **"Text"**, **"Numeric"**, **"Yes/No"**, **"Date"**, **"List"**, and **"User"** (the same list also powers customer and supplier custom fields, which add **"Customer"**, **"Supplier"**, and **"File"**). A **"List"** attribute pulls its choices from its List Options.

Pick the data type when you create the attribute — it's fixed once the attribute has recorded values. Category and attribute deletes are soft deletes (marked inactive), so an attribute you retire won't erase the values already collected against it.

## Time cards

A **time card** is a clock-in / clock-out record for an employee. Time tracking is off by default and turns on per company with a **`timeCardEnabled`** setting; once on, the **Timecards** tab appears on each person and a company-wide list shows up under **Manage**.

Each entry captures the employee, a clock-in time, an optional clock-out time, and a note. An entry with no clock-out is still open — Carbon derives its **Status** from that:

  - **Active**: Clocked in with no clock-out yet — the employee is on the clock.
  - **Complete**: Clocked out. The entry is closed and its duration is fixed.

Status is computed, not a stored field, and there is **no approval step** — a completed time card is final, not pending sign-off. Duration is calculated from clock-in to clock-out (or to *now* while still active), and weekly hours roll up from the current week's entries. You can also add, edit, or delete entries directly, so a missed punch can be corrected after the fact.

These are the office-side time card records. On the shop floor, operators clock time against specific job operations in the `docs/reference/mes` — that production time is a separate mechanism from an employee's clock-in/clock-out day.

## Related

  - Permissions Employee types, roles, and what a person is allowed to do.
  - MES Clocking time against job operations on the floor.
  - Work centers Where operations run, and how they're scheduled and costed.

## Troubleshooting

Validation and lifecycle rules for shifts, holidays, departments, and time cards.

### "Location is required"
Every shift must belong to a location — the `locationId` field is required on the shift form, unlike an employee's own shift assignment, which is optional. Pick a location before saving the shift.

### "Start time is required" / "End time is required"
A shift needs both a start and an end time; neither can be blank. Fill both time fields before saving.

### "Date is required"
Saving a holiday without a date fails. The year is derived from the date, so the date is mandatory (the name is required too — "Name is required").

### Deleting a department fails or orphans people
Department deletion is a **hard delete** — the row is removed outright. Reassign anyone whose job placement points at that department first, otherwise their placements are left with no department. This differs from shifts and attributes, which are soft-deleted (marked inactive) so historical assignments survive.

### The Timecards tab / time card list isn't showing
Time tracking is off by default. It only appears once a company turns on the `timeCardEnabled` setting; until then there is no Timecards tab on a person and no company-wide list under Manage.

### Looking for a time card approval / sign-off step
There isn't one. A time card's status ("Active" while clocked in, "Complete" once clocked out) is computed, not stored, and a completed entry is final — there is no pending-approval workflow. Correct a mistake by editing or deleting the entry directly.
