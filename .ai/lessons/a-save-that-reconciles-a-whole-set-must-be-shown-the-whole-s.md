---
paths: ["apps/erp/app/modules/production/ui/Schedule/People/*"]
triggers: ["setPeopleDay", "editorDayRows"]
promoted: null
---
# A save that reconciles a whole set must be shown the whole set, whatever the page filters

**Context:** The People board's day editor (`PeopleHoursModal` → `setPeopleDay`) saves a person's day: it updates the rows it is sent and DELETES the rows of the save's shift it is not sent (2026-10-28).

**Problem:** The editor opened with the rows the page showed. The department filter hid rows at other stations, and the shift filter hid rows of other shifts, while the save was scoped to the person's own shift (or every shift, for a person with none). Saving deleted rows the user never saw, or inserted a second row for a station the person already held in another shift.

**Rule:** A save that reconciles a set (deletes what it is not sent) gets that set from the same scope the server deletes by, never from what the page filtered. Pass the unfiltered rows next to the filtered ones and select the save's scope in one pure helper (`editorDayRows`, `peopleShared.ts`), with a test.

**Applies to:** `apps/erp/app/modules/production/ui/Schedule/People/*` (Board and Matrix editors), `setPeopleDay` and any other "make these rows the whole day/week" write in `production.service.ts`.
