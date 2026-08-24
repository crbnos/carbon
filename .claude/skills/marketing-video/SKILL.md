---
name: marketing-video
description: Produce a Carbon feature marketing/demo video in Clueso from the user's screen recordings — grounded script, product-accurate slides, phase-by-phase capture loop, and a verified cut. Use when the user wants to make (or iterate on) a marketing or explainer video of a Carbon feature, or says "make a video", "demo video", "record this feature", "Clueso video". Do not use for reader-facing written docs — use /carbon-docs; or for browser-verifying a feature — use /test.
---

# marketing-video — Carbon feature video, built in Clueso

Turns a Carbon feature into a ~2–3 minute marketing video: designed intro/outro
slides plus the user's own screen recordings, assembled in the Clueso MCP
connector. You write the script from REAL data, build the slides, and run a
capture loop where the user records each phase, you verify the footage frame by
frame, then cut it in. Output is a finished Clueso project the user exports.

**Announce at start:** "Using the marketing-video skill — building a Clueso video for {feature}."

**Read before building:** `references/clueso-mcp.md` (the connector's traps —
every one has bitten a real build) and `references/carbon-theme.md` (exact
tokens + typography). Do not skip these; the defaults are wrong for this task.

## Prerequisites (STOP if unmet)

- Clueso MCP connector attached (tools `mcp__*__create_project` etc. present). If
  its tools are deferred, load them via ToolSearch first. If absent → STOP, tell
  the user to attach the Clueso connector.
- `ffmpeg` + `ffprobe` on PATH (`which ffmpeg ffprobe`). Needed to verify takes.
- The feature runs on the local dev stack (`crbn up`) OR the user records
  against a reachable environment. Confirm which before scripting.
- Confirm the Clueso workspace with the user before creating anything
  (`find(type='workspaces')`).

## The pipeline

```
1 Ground   → pull REAL numbers from DB/source (never invent figures)
2 Script   → cold-open → problem framing → recorded flow → payoff → close
3 Prep     → fix demo data + settings so the recording is shootable
4 Build    → create project, slides, generated backgrounds, VO scaffold
5 Capture  → LOOP per phase: user records silent → you verify frames → cut in
6 Finish   → transitions, music, retime, final render check
```

Phases 1–4 are yours. Phase 5 is a loop with the user. Do not batch-request all
recordings up front — one phase at a time, verified before the next.

---

## Step 1: Ground the script in real data

Every number on screen must be true. A plausible-but-wrong figure is the fastest
way to lose a technical audience. Before writing a word:

- Query the demo company for the actual entities you'll show (customer, item,
  order, shipment, quantities, unit price).
- For anything with an accounting claim, read the POSTED journal from the DB —
  do not compute it yourself. Postgres/edge-function math is the source of truth.

```bash
# example: the figure a returns video's ledger card must show
docker exec carbon-carbon-postgres-1 psql -U postgres -d postgres -c "
select j.\"sourceType\", jl.description, round(jl.amount::numeric,2), jl.quantity
from \"journalLine\" jl join journal j on j.id=jl.\"journalId\"
where jl.\"companyId\"='<companyId>' and j.\"sourceType\"='<type>'
order by jl.\"createdAt\" desc limit 8;"
```

Write the grounded facts into the script doc (Step 2) so every later edit checks
against them.

## Step 2: Write the script

Save to `.ai/docs/{YYYY-MM-DD}-{feature}-video-script.md` **and commit it** — this
tree has switched branches mid-session before and wiped untracked docs. A script
that only exists untracked will not survive.

Five-act spine (the shape that reads as professional — see the reference videos
in `references/story-structure.md`):

| Act | ~time | Content | Form |
|-----|-------|---------|------|
| 0 Cold open | 0:00–0:12 | The pain arrives (an email, a request) | designed slide / UI scene |
| 1 The map | 0:12–0:25 | Why it's N separate problems today → one place in Carbon | designed slide |
| 2 The flow | 0:25–~1:45 | The actual feature, step by step | **screen recording** |
| 3 The payoff | ~1:45–2:25 | What it did that matters (the accounting/result) | designed cards |
| 4 Close | 2:25–end | One-line reconciliation → product name end card | designed slide |

Script rules that survived real review (`references/story-structure.md` has the
full list):

- **Write for the ear, and for a human.** "add lines from **the** document", not
  "add lines from document". "click Confirm", not "Confirm". Full sentences.
- **Every action states its business meaning.** Not "Post" — "click Post, and the
  bikes are back in inventory at what they originally cost us".
- **Introduce every acronym once**, then reuse it.
- **Never charge the customer in a sympathetic story** (no restocking fee on a
  defect) — it reads as the product being unfair.
- One narrator voice for the whole video (Step 4 sets it).

## Step 3: Prep the demo data (STOP-gated)

The recording is only shootable if the data cooperates. Check and fix BEFORE the
user records — a blocker found mid-take wastes their reshoot.

Common blockers (returns example; generalise):

| Check | Fix |
|-------|-----|
| Money renders `$1899` not `$1,899.00` | `companySettings.hideCurrencyTrailingZeros = false` |
| Source quantity already consumed by old test rows | cancel/clear the stale docs so the "from document" list shows a returnable qty |
| Serial/lot picker empty (`readableId` null on tracked entities) | set a real `readableId` on the entities you'll show |
| Feature not checked out | `git checkout <feature-branch>` + restart dev server |

Hand the user the exact `docker exec … psql` commands and the verification query.
Do NOT run schema/data writes that the permission layer blocks — give them the
command. Re-verify state after they run it.

## Step 4: Build the project (slides + scaffold)

Read `references/carbon-theme.md` first. Then:

1. `create_project`, title `Carbon — {Feature}`.
2. `add_clips(kind='blank')` for every slide act (0, 1, 3-cards, 4). Leave a
   GAP in the numbering where the recorded phases will slot in.
3. Backgrounds: one generated `animation` per slide (aurora / drift / bokeh).
   **The grain trap:** always forbid grain explicitly — "Absolutely NO film
   grain, NO noise, NO dithering, NO speckle — clean continuous gradients only".
   Generated backgrounds otherwise render as visible static. Group each behind
   content per the two-phase rule in `references/clueso-mcp.md`.
4. `set_voice` ONE voice across all clips (e.g. `set_voice(voice_name='Jeff',
   voice_engine='eleven')`). Mixed voices are the #1 "it sounds AI" tell.
5. Slide text + motion: distinct entrance per beat, sequential timing (never two
   texts occupying one slot — that's the "getting in the way" defect). Estimate
   VO length with `estimate_duration`, generate speech, then read REAL durations
   back with `get_clip` before timing elements (see `references/clueso-mcp.md`).
6. Verify every slide by rendering a frame (`get_clip(render:{timestamp})`) — the
   ONLY way to catch a tofu glyph, a grain field, or a failed reveal.

## Step 5: The capture loop (per phase, with the user)

For each recorded phase, in order:

1. **Give the user the shot list** — a decision table of click → expect, with the
   exact ids/values they must see. Include recording setup (see below) and a
   STOP line naming what "wrong" looks like (e.g. "if returnable shows 0, stop").
2. **User records silent** and gives you a LOCAL FILE PATH (not an upload — you
   must read frames).
3. **Verify with ffmpeg** before uploading:
   ```bash
   ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate -show_entries format=duration -of default=noprint_wrappers=1 <file>
   ffprobe -v error -select_streams a -show_entries stream=codec_name -of csv=p=0 <file>   # empty = silent, good
   ffmpeg -y -v error -i <file> -vf "fps=1/2,scale=640:-1,tile=4x4" -frames:v 1 <scratch>/sheet.png   # contact sheet
   ffmpeg -y -v error -ss <t> -i <file> -frames:v 1 -vf "scale=1600:-1" <scratch>/frame.png           # full-res beat
   ```
   Read the frames. Confirm: right theme/mode, the key value legible, correct
   ids, no error toast, no competitor chrome (browser AI buttons, extensions),
   cursor parked at ends. For accounting beats, ALSO re-query the DB to confirm
   the posted figure matches the payoff card.
4. **Verdict:** accept, or name the single blocking defect and what to change.
   Cheap fixes (a different customer/shipment) beat a reshoot — offer them.
5. **On accept:** upload (`upload_file` → curl the returned command), then
   `add_clips(kind='video', mcp_upload_id, after_clip_id, cuts:[…])`. Use `cuts`
   to drop dead time (module switches, page loads). Poll `get_project` until the
   clip lands (transcode is async).
6. **Caption + VO the clip:** lower-third caption pills (card-black, hairline,
   sequential, `width` hugging the text) + `voiceover_batch set_and_generate`.
   Video clips do NOT auto-fit to audio, so the footage is safe; slide clips DO.
7. Renumber clip titles so the timeline reads in order.

Recording setup to hand the user every time:

- App theme matched to the slides (dark + the product's theme; see
  `references/carbon-theme.md`). A light app between dark slides reads as broken.
- Window 1512×945, browser zoom 125%, bookmarks + competitor AI buttons hidden,
  clean profile.
- Record **silent** — VO is added from the script; live narration makes clicks
  hesitant and fights the script voice.
- Screen-recorder auto-zoom + cursor smoothing on; keep the window off the screen
  edge so auto-zoom never crops the hero value.

## Step 6: Finish

- **Transitions:** dissolve ~0.45s within a continuous flow; fade through the
  background colour ~0.7s at every slide↔footage boundary (a cross-dissolve
  between a slide and raw UI looks like a mistake). Set on the OUTGOING clip.
- **Music:** `add_audio` a restrained bed at **20–30% volume** (house spec),
  loop on, fade in ~1.5s / out ~3s. **Pass `guide_end_time` explicitly** past the
  current length — it does NOT auto-extend for clips added later. After the LAST
  clip is in, set `guide_end_time` to the true final length so the fade lands on
  the end card.
- **Retime after any VO regen:** a slide clip auto-fits to new audio; re-read
  `get_clip` durations and re-time its elements.
- **Final pass:** render a frame from every clip; confirm no grain, no tofu, no
  empty reveal, captions hug their text, ledger figures match the DB.

## Iterate

Reviewers give notes in batches ("it's jumpy here", "that sounds like a
computer", "zoom in on the PDF"). Apply them as: script edits (regen VO +
resync captions), motion/timing fixes, and file any PRODUCT defects the video
exposes (a broken PDF header, an empty picker) as separate tasks — the video
surfacing a real bug is a feature of this process, not a detour.

## Done when

- [ ] Script committed at `.ai/docs/{date}-{feature}-video-script.md`.
- [ ] Every recorded phase verified against real frames + DB figures, then cut in.
- [ ] One voice across all clips; music bed at 20–30% with `guide_end_time` at the
      true final length.
- [ ] A rendered frame from every clip shows correct theme, legible values, no
      grain/tofu/empty reveals.
- [ ] User has the Clueso project URL to export.

## Failure → action

| Symptom | Action |
|---------|--------|
| Generated background renders as static/grain | Regen with grain/noise/dither explicitly forbidden (Step 4). |
| Slide text invisible though data is correct | Two causes: async bg on top (group it `bg`), or keyframe+mask conflict — see `references/clueso-mcp.md`. |
| `get_clip` render is flat white over footage | Expected — Clueso doesn't composite the video track. Verify overlays only; the user scrubs footage in the editor. |
| Clip durations don't match after TTS | Read durations from `get_clip`, not `get_project`; retime elements. |
| Recorded value wrong / theme wrong / competitor chrome visible | Name the single defect; prefer a data-side fix over a reshoot; only then ask for a new take. |
| Accounting figure on card ≠ posted journal | Re-query the DB; rebuild the card to the real number — never ship an invented figure. |
