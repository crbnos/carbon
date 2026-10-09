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
