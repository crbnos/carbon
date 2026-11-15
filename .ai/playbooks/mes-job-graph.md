# MES Job Graph (winding / left to right / top to bottom)

Last tested: 2026-11-15
Route: MES `/x/job/<jobId>`

## Prerequisites
- A job with operations and `jobOperationDependency` rows. The dev seed has two
  12-operation straight chains (J000001, J000002 in Carbon Development). It has
  no branching job, so stacked operations and skip edges are not covered here.
- Read `MES_URL` from `.env.local` AFTER `crbn up`: it rewrites the hostnames
  (`DOMAIN`, `ERP_URL`, `MES_URL`) to the current branch. A hostname from an
  older `.env.local` still serves the app, but the session cookie is set for
  the new `DOMAIN`, so `/x` loops with `ERR_TOO_MANY_REDIRECTS`.

## Steps
### 1. Navigate
Sign in at `${MES_URL}/login` with the dev bypass email, then open
`${MES_URL}/x/job/<job id>` (find one with
`select id from job` joined to `jobOperationDependency`).

### 2. Opening view
Desktop: toolbar reads "Winding"; the first row is at full size (viewport
`scale(1)`), rows alternate direction, and each wrap is a U-turn outside the
last or first column with its quantity pill beside the source.

### 3. Fit and direction
- "Fit" shows the whole graph.
- The direction button cycles Winding → Left to Right → Top to Bottom, and each
  one is fitted. The minimap shows in the last two only.

### 4. Node click
Click an operation card: MES requests `/x/operation/<id>?from=…`. (That route
may redirect on to `/x/operations`; the request is the proof.)

### 5. Phone width
Below the phone breakpoint the default is "Top to Bottom" at `scale(0.6)`.
Winding is offered while two columns fit (it was at 572px).

## Selector Notes
- Direction button: the toolbar button whose text is one of the three labels.
- Viewport: `.react-flow__viewport` inline `transform`.
- Cards: `.react-flow__node a`; the link's computed `pointer-events` is `auto`
  while its node wrapper's is `none`.

## Common Failures
- Chrome's window resize lags the tool call by a few seconds; read `innerWidth`
  before trusting a screenshot taken right after a resize.
