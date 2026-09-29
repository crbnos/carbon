# Assembly sub-assembly staging ("Build off to the side")

Last tested: 2026-09-28 (test@carbon.ms bypass user, "Carbon Development")
Route: /x/assembly/:id — used "Sync 4 - SA Frame test 2" (Draft, 5 steps, 70 parts)

## Steps
1. /auth, then open /x/production/assemblies and read the instruction link's href (clicking the row lands on the list).
2. `agent-browser set viewport 1600 1000` — at the default size the Details panel clips the new box.
3. Move between steps with the footer "Next step" / "Previous step" buttons. Clicking a step row can hit its status dropdown.
4. Details → "BUILD OFF TO THE SIDE": a button opens a radio menu ("No, build in place" / "Yes, joins at step N: …"). Step 1 and join steps render it as locked text.
5. Replay a step from 0 with `agent-browser dblclick @<step row ref>`. Screenshot ~0.45s and ~0.95s in to catch the glide.
6. Reorder: pointer-drag a "Drag handle" (mouse down, then several moves, then up). HTML5 `drag` doesn't drive framer-motion Reorder.
7. Restore: drag the order back and set each step to "No, build in place".
