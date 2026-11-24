---
paths: ["packages/database/src/datasets/bootstrap.ts"]
triggers: ["companyTimeZone", "weekBounds", "timesheetWeek", "seedCompanyReferenceData"]
promoted: null
---
# A company with time zone UTC shifts every business day

**Context:** The week views of My Time (ERP and MES) and the DCAA entry window compute the week in the company time zone (`timesheetWeek`, `datetime.weekBounds(companyTimeZone, offset)`).

**Problem:** The dev bootstrap inserted the company with no time zone, so `company.timezone` was `UTC` while its locations were `America/Chicago`. On a Sunday evening in Chicago the server's day was already Monday, and the timesheet opened on next week. It looked like a week-math bug; the math was correct for the wrong zone.

**Rule:** A company row always gets a real IANA time zone at creation (`seedCompanyReferenceData` now uses the default location's zone). When a date-bound view is off by one day or one week, check `company.timezone` and the location time zones before the date code.

**Applies to:** `packages/database/src/datasets/bootstrap.ts`, onboarding, every view that derives a business day or week from the company time zone.
