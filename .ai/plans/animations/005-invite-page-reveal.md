# 005 — Invite page: the focused Join button must be visible

- **Status**: DONE
- **Commit**: 2089c5b
- **Severity**: MEDIUM
- **Category**: Purpose & frequency / Easing & duration
- **Estimated scope**: 1 file

## Problem

The invite page is a rare, first-time moment, so it may carry delight — but the
current sequence hides the only action. The logo grows from `scale: 0.4` over 2s; the
heading and the `autoFocus` Join button stay at opacity 0 for a 1.5s delay and then
take 1.2s to fade in. For ~1.5s the focused, clickable button is invisible (Enter
submits it), it is fully visible only after ~2.7s, and the server HTML ships it at
opacity 0. The logo animation also runs only in light mode (the dark logo is a plain `<img>`).

```tsx
// apps/erp/app/routes/_public+/invite.$code.tsx:375-401 — current
<motion.img
  initial={{ opacity: 0, scale: 0.4 }}
  animate={{ opacity: 1, scale: 1 }}
  transition={{ duration: 2, ease: "easeInOut" }}
  src="/carbon-mark-light.svg" … className="w-24 dark:hidden"
/>
<img src="/carbon-mark-dark.svg" … className="w-24 hidden dark:block" />
<Heading {...fade} transition={{ duration: 1.2, ease: "easeInOut", delay: 1.5 }} …>
<Button {...fade} transition={{ duration: 1.2, ease: "easeInOut", delay: 1.5 }} size="lg" type="submit" autoFocus>
```

## Target

Keep a single, short entrance; nothing interactive waits on it:

```tsx
<motion.img
  initial={{ opacity: 0, scale: 0.9 }}
  animate={{ opacity: 1, scale: 1 }}
  transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
  src="/carbon-mark-light.svg" … className="w-24 dark:hidden"
/>
<motion.img
  initial={{ opacity: 0, scale: 0.9 }}
  animate={{ opacity: 1, scale: 1 }}
  transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
  src="/carbon-mark-dark.svg" … className="w-24 hidden dark:block"
/>
<Heading {...fade} transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1], delay: 0.15 }} …>
<Button size="lg" type="submit" autoFocus>   {/* no fade: the focused action is visible at once */}
```

Remove `{...fade}` and `transition` from the Button only. `Button` is
`motion.create(_Button)` (line 292) solely for this fade: render `_Button` there and
delete the `const Button = motion.create(_Button);` line if nothing else uses it.

## Repo conventions to follow

- Never `scale` below 0.9 on entrances (audit rule: `scale(0.9–0.97)` + opacity 0).
- Strong ease-out `[0.23, 1, 0.32, 1]` is the app's UI curve (`NavRail.tsx`).

## Steps

1. Change the light `motion.img` initial/transition as in Target.
2. Turn the dark `<img>` into the same `motion.img`.
3. Change the Heading transition as in Target.
4. Remove the fade from the Button; drop its `motion.create` wrapper if now unused.

## Boundaries

- Do NOT change the form, the action, copy or layout.
- If the file does not match (drift since 2089c5b), STOP and report.

## Verification

- **Mechanical**: `pnpm exec turbo run typecheck --filter=erp`; `pnpm exec biome check "apps/erp/app/routes/_public+/invite.\$code.tsx"`.
- **Feel check**: open an invite link (create one from Users → Invite), in light and dark mode:
  - The Join button is visible and focused on first paint; pressing Enter immediately joins.
  - The logo settles within half a second; the heading follows just after.
  - With JavaScript disabled, the button is visible.
- **Done when**: no transition in the file exceeds 0.5s and the Button has no `initial` opacity.
