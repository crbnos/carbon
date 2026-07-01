# Onboarding Checklist Toggle (optimistic, no flicker)

Last tested: 2026-06-27
Route: /x/get-started/plan (Plan & Board, "Plan" tab)

## Prerequisites
- Company must be ENROLLED in the implementation hub, else /x/get-started
  redirects to /x (loader throws redirect when getImplementationHub has no row).
  Enroll via the "Enroll" button on the /x dashboard (creates the hub row).

## Steps

### 1. Login
- /login skill (DEV_BYPASS_EMAIL=test@carbon.ms). networkidle times out on this
  app — use `agent-browser snapshot -i` directly after open instead of waiting.

### 2. Enroll (one-time)
- /x dashboard → click "Enroll". Sidebar then shows "Get Started" with sub-links
  Start Here / Scope Summary / Plan & Board / Setup Map / Training Plan / Go-Live.

### 3. Open Plan & Board
- Click "Plan & Board" link. Ensure the "Plan" tab is [pressed] (not "Board").
- Task rows render as buttons with the task label, e.g.
  "Set up sites, users, and roles", "Configure-to-order options and pricing".

### 4. Toggle a task
- Click a task button. The leading <span> checkbox flips emerald (done) /
  bg-card (todo); the label gets line-through when done.

### 5. Verify (no flicker)
- The checkbox state must change exactly ONCE per click (todo->done or
  done->todo) and hold — no done->todo->done bounce.

## Selector Notes
- Task checkbox state: the button's first child <span>; done == className
  contains "bg-emerald-500" / "emerald".
- Refs (@eN) churn between snapshots and React replaces nodes on re-render, so:
  - Re-query by text each time: `[...document.querySelectorAll("button")].find(b => b.textContent.includes("<label>"))`.
  - Click via `btn.click()` in eval to avoid stale refs.

## How to catch a flicker (transient revert)
agent-browser eval contexts are torn down after each call, killing pending
rAF/setInterval — so sample WITHIN A SINGLE eval that returns a Promise:

```
agent-browser eval '
new Promise((resolve) => {
  const find=()=>[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Set up sites, users, and roles"));
  const read=()=>{const b=find(),s=b&&b.querySelector("span");return s?(s.className.includes("emerald")?"done":"todo"):"gone";};
  const log=[];let last=read();log.push({t:0,s:last});const t0=performance.now();
  const id=setInterval(()=>{const s=read();if(s!==last){log.push({t:Math.round(performance.now()-t0),s});last=s;}
    if(performance.now()-t0>2500){clearInterval(id);resolve(JSON.stringify(log));}},8);
  setTimeout(()=>{const b=find();if(b)b.click();},300);
})'
```
PASS = log has exactly 2 entries (initial + one transition). FAIL (flicker) =
3+ entries showing a revert.

## Result (2026-06-27)
- Toggle on:  [{t:0,todo},{t:357,done}]  -> single transition, held. PASS
- Toggle off: [{t:0,done},{t:327,todo}]  -> single transition, held. PASS
- Fix: optimistic overlay in packages/onboarding/src/ui/state/hubStore.ts
  (optimisticChecks held until loader confirms the written value).
