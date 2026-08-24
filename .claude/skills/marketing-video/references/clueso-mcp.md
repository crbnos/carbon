# Clueso MCP connector — traps and mechanics

Every item here cost a real build. Read before touching the connector.

## Verification limits

- **`get_clip(render:{...})` does NOT composite the screen-recording track.** On a
  `video_clip` the footage area comes back flat white; only the clip background
  edge and burned-in subtitles render. You can verify OVERLAYS (text, shapes,
  generated backgrounds on slide clips) but never an overlay against the UI
  beneath it. Place captions conservatively and have the user scrub footage in
  the Clueso editor.
- To verify the footage itself, work from the LOCAL file with ffmpeg before
  upload (SKILL.md Step 5). Once it's a Clueso video clip you can't frame-inspect
  the recording through the connector.
- **Subtitle style is not settable over MCP.** `update_clips` has no
  `subtitle_settings`; `get_clip` reports it read-only. Font, highlight colour,
  the on/off toggle are editor-only. Do not promise subtitle styling changes.

## Timing / async

- **`get_project` clip durations go stale after TTS.** `voiceover_batch` retimes
  each clip to the spoken length asynchronously; `get_project` keeps reporting
  pre-TTS durations while `get_clip` already returns the real one. Always read
  durations from `get_clip` before timing elements against them.
- **Slide clips auto-fit to their VO length; video clips do NOT.** So generating
  speech on a slide clip changes its duration (retime its elements afterward),
  but generating a scratch VO on a recorded clip leaves the footage intact —
  safe to do.
- **`estimate_duration` is a planning aid only** (~150 wpm). Real ElevenLabs
  timing differs; size final element timings against `get_clip` word timings,
  not the estimate.
- **`add_clips(kind='video')` transcodes async.** The call returns before the
  clip exists. Poll `get_project` until `clip_count` grows / the clip appears
  before doing anything that references it.
- **`add_clips` rewrites the whole project — serialize it.** Never run two
  `add_clips` calls (or `add_clips` alongside element/voiceover/audio edits) at
  once. Insert one recording, wait, then the next.

## Generated `animation` elements

- **Grain trap.** The generator turns any hint of texture into visible static.
  ALWAYS include: "Absolutely NO film grain, NO noise texture, NO dithering, NO
  speckle, NO static, NO visible pixel pattern — render clean continuous
  gradients only." Even "faint 4% grain" comes back as heavy dither.
- **Z-order is a two-phase job.** An `animation` cannot be grouped at add time
  ("generated in the background, so it cannot be grouped as it is added"), AND
  `update_elements(group:…)` fails ("ApplyEntityPatches returned no result for
  this op") until generation COMPLETES. So: add it, poll
  `get_clip(select:['elements.name'])` until it appears (the generator RENAMES
  it, e.g. "Aurora Blur Ambient BG"), THEN `update_elements(group:'bg')`. Budget
  a few minutes per generation.
- **Why grouping fixes it:** async animations are appended when generation
  finishes, so they land ON TOP of text you added earlier and the clip renders
  background-only. `reorder_elements` refuses on any clip that has groups. Joining
  the `bg` group drops the animation to the group's slot, behind the content.
- Use `animation` for real UI mockups too (an email client, a "questions" panel).
  Prompt with exact hex, exact copy, exact layout and explicit per-second motion.
  No brand names/logos — build a GENERIC app (a real product's UI is a trademark
  problem and looks cheaper than a clean unbranded one).

## Keyframes

- **A track with only two entries interpolates across the WHOLE span**, not the
  segment you meant. A loader with `scale 1` at t=0 and `scale 2.6` at exit grows
  the entire time. Add an explicit HOLD keyframe just before the change.
- **`strokeColor` keyframes DROP the alpha channel.** A keyframe to `#31DD8D29`
  renders as solid `#31DD8D` — a loud outline instead of a hairline. Pre-blend
  the accent over the element's own fill and pass an OPAQUE hex. Static
  `strokeColor` in `type_data` honours alpha fine; only the keyframe path strips
  it.
- **`letterSpacing` keyframes + a `masked_reveal` entry = text never renders.**
  The element exists with correct data and passes layout QA, but the frame is
  empty. Clear the keyframes; the entry preset alone is fine. Suspect ANY text
  property keyframe combined with a mask-based entry.
- Use entry PRESETS or transform keyframes on a given element, not both.

## Text

- **No glyph fallback.** Arrows like `→` render as tofu in Geist — use "to". The
  middle dot `·` is safe. Verify any non-ASCII glyph with a render.
- Entry presets: `slide | fade | pop | scale | masked_reveal | typewriter | none`
  × unit `char | word | line | box` × 8 directions. `typewriter` on `char` suits
  ledger/data rows (reads like the entry being posted). Give each beat a DISTINCT
  preset so the intro doesn't feel like one move repeated.
- Caption pills: `background_setting.show=true`, colour = card token, hairline
  border, and set `width` to just wider than the rendered `text_width_px` (the
  pill fills the element box, so a wide box = a wide pill). Lower third ~y=930.

## Audio

- **`add_audio` `guide_end_time` is captured at call time and does NOT
  re-extend** when clips are added/resized later. Always pass it explicitly, and
  after the final clip lands, `update_audio` it to the true project length so the
  fade-out lands on the end card, not in empty space.
- Music bed volume **20–30%** under a 100% VO (house `get_design_guide` spec).
  `loop:true`, `fade_in ~1.5`, `fade_out ~3`.

## House style (`get_design_guide`, overrides general instinct)

- On-screen text is a 3–6 word distillation, **replaced, never stacked**.
- Bans mono all-caps eyebrows and decorative bars/underlines that animate in.
- Call `get_design_guide` when composing from scratch (not from a clueprint).

## When starting a video

`find(type='clueprints', query='<what the video is>')` FIRST — a matching
template beats composing from scratch. Only build bespoke (as this skill's
default assumes) when matches are weak or the user wants a custom design.
