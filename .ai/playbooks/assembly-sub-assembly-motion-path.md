# Assembly sub-assembly motion path + waypoint rotation

Last tested: 2026-10-08 (test@carbon.ms bypass user, "Carbon Development")
Route: /x/assembly/:id — seeded "ESPA Smallsat — Integration Sequence" (Published; "New Version" makes an editable Draft)

## Steps
1. /auth. On a fresh dev server the login's Continue button stays disabled until hydration finishes: reload and wait ~20s.
2. `agent-browser set viewport 1600 1000`. Open the instruction, click "New Version" to get a Draft.
3. Find steps with the "Search steps" box, then click the row's title element. Clicks under the sticky Save bar miss: `scrollintoview` the button first.
4. A step that fits a sub-assembly shows "{name} path" in Playback. Edit Path → drag the red start waypoint with raw mouse events (`mouse move` / `down` / several `move`s / `up`); the save lands on the HEADER row's `motion`.
5. With a waypoint selected, rotation rings show; drag along a ring the same way. Saves as `{"type":"waypoints"}` (15° snaps).
6. Replay a step: double-click its row title (on a sub-assembly row, double-click OPENS it instead). Screenshot every ~0.5s.
7. "Used in" dropdown: Radix ignores clicks here; move the mouse off the menu, then ArrowDown + Enter.
8. Check saves in the DB: `docker exec <worktree>-postgres-1 psql -U postgres -d postgres -Atc "select motion from \"assemblyInstructionStep\" where id='…'"`.

## Notes
- The 3D page grows the renderer to 3 GB+ after ~40 screenshots and snapshots hang — `agent-browser close`, reopen, log in again.
- A "Failed to fetch" route error after a long session is the dev server dropping a revalidation; "Try again" recovers.

## Build orientation (tested 2026-10-09)
1. Select a step through "Search steps", then click the row's title element. The Orientation row is the last Playback row.
2. Click the turn buttons through `aria-label` ("Flip over", "Tip toward you", "Tip away from you", "Spin left", "Spin right"). They stay disabled while each save runs, so wait about 2.5 s between clicks.
3. Read the row text: "Upright", "Upside down" or "On its side". An inherited pose reads "Upside down, from step N" or "On its side, from step N". Reset shows only on the step that set the orientation.
4. Read the Camera row. If the step had no saved view, a turn that leaves the build turned also saves the current view, so the row reads "Saved view". A turn back to the inherited orientation keeps that view. "Clear" returns the step to automatic framing. A step with only a planner hint (`camera` = `{"source":"plan",…}`) reads "Automatic" and shows no Clear.
5. Check the DB (the Draft made in step 2 of the section above): `select s."sortOrder", s.orientation, s.camera from "assemblyInstructionStep" s join "assemblyInstruction" i on i.id = s."assemblyInstructionId" and i."companyId" = s."companyId" where i.name = 'ESPA Smallsat — Integration Sequence' and i.status = 'Draft' and s.orientation is not null order by s."sortOrder"`.
6. The viewer's prev and next arrows sit at about (397, 486) and (1229, 486) at 1600×1000. Step from 7 to 8 and take screenshots at about 0.45 s to catch the turn mid-way.
7. The viewcube corner sits at about (1205, 165).
8. Reset every turned step at the end, and Clear the views the turns saved. Leave the DB with 0 orientations.
