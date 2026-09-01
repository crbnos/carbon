# Setting up the Carbon app for Onshape — agent runbook

**This file is written for a Claude agent to execute**, with a person beside it. If you
are that person, open Claude Code in this repository and say:

> Read ONSHAPE-APP-SETUP.md and set up the Carbon Onshape app with me.

The agent runs the machine side and verifies each phase. You do the Onshape dev-portal
clicks and the two in-browser sign-ins, because nothing else can.

Expect about an hour, most of it Onshape-side.

---

## What is being set up

The Carbon panel lives inside Onshape's element right panel. The user works in Onshape
and pushes to Carbon when something is ready — Carbon never pulls on its own. Three
pushes: a part, an assembly with its bill of materials, and a release.

Every push writes to **Carbon only**. Nothing in this setup modifies the user's CAD data.
The one exception is asset sync, which registers a webhook subscription on their Onshape
account — it is off by default, and out of scope here.

## Rules for the agent

- **Never invent a credential.** The Onshape client id and secret come from the user.
  If a value is missing, stop and ask for it.
- **Never commit `.env`**, and never echo the client secret into the transcript, a log,
  a commit message, or a file other than `.env`.
- **Verify each phase before moving on.** Every phase below ends with a gate: a command
  and the output that means it passed. A phase without a passing gate is not done.
- **Stop after two failed attempts** at the same step. Report what you ran, what you got,
  and what you think it is. Do not keep retrying or start changing unrelated
  configuration.
- **Onshape API quota is the user's**, and every panel read spends it. Do not open
  reviews to "check something" — a review spends its reads whether or not it is pushed.
- Phases 1–3 are the user's clicks. Do not fabricate progress through them; wait to be
  told each is done, and ask for the values you need.

## Who does what

| Phase | Who |
| --- | --- |
| 0. Prerequisites | agent asks, user confirms |
| 1. Register the Onshape application | user (dev portal) |
| 2. Add the three panel extensions | user (dev portal) |
| 3. Store entry, then subscribe | user (dev portal + App Store) |
| 4. Get Carbon running locally | **agent** |
| 5. Connect the integration | user clicks consent, agent verifies |
| 6. First push | user clicks in Onshape, agent watches |

If the agent has Chrome browser automation available and the user prefers it, phases 1–3
can be driven in their browser instead — ask first. Phase 6's sign-in click is inside a
cross-origin Onshape iframe and cannot be automated; a person clicks it.

---

## Phase 0 — prerequisites

Ask the user to confirm all of these. Anything missing is a blocker, not something to
work around:

- An Onshape account with **dev portal** access, and an Onshape **company**. Release
  management is a company feature, so no company means the release push cannot be tested.
- Onshape → company settings → Release management → **managed workflows enabled**, if
  releases are in scope.
- **Docker running**, **Node 22**, **pnpm** via Corepack, **Chrome**.
- An Onshape document worth pushing. One that exercises the whole app has: a Part Studio
  with three or more parts, two with **Part number** and **Revision** set and one
  without; an assembly of those parts including one subassembly; and a drawing of one
  part.
- Their license position on `packages/ee`. The panel is implemented there, the repository
  LICENSE places it behind a commercial license, and it renders only when
  `CARBON_EDITION` is `enterprise`. This is the user's call to confirm, not the agent's
  to assume.

**Gate:** `docker info` succeeds and `node --version` reports v22.

---

## Phase 1 — register the Onshape application (user)

Explain why they cannot be handed an existing one: an Onshape extension renders only for
users **subscribed** to its application, and a private store entry is scoped to the
publishing Onshape company. A shared application would be invisible to them. Their own
application also means the API quota it spends is theirs.

In the Onshape dev portal, create an application:

| Field | Value |
| --- | --- |
| Application type | **Integrated Cloud App** |
| OAuth redirect URL | `http://localhost:3000/api/integrations/onshape/oauth` |
| Permissions | **OAuth2Read** *and* **OAuth2Write** |

Two things to say out loud:

- **Connected Desktop App** is the wrong type. It cannot carry the extensions added in
  phase 2, and changing type later needs a confirmation dialog that a stray click does
  not produce.
- **Write is not optional.** It creates the model-export jobs and manages the release
  webhook subscription. Read alone cannot enable asset sync at all.

**Gate:** the user has the client id and secret in hand. The agent asks for them now and
holds them for phase 4 — do not write them anywhere yet.

---

## Phase 2 — add the three panel extensions (user)

Three extensions, identical but for context, so the panel opens everywhere it should:

| Field | Value |
| --- | --- |
| Name | `Carbon` |
| Location | **Element right panel** |
| Context | one each of **Inside part studio**, **Inside assembly**, **Selected part** |
| Icon | an SVG — the portal takes SVG only, 100 KB maximum |

All three share one action URL:

```
http://localhost:3000/onshape/panel?documentId={$documentId}&wv={$workspaceOrVersion}&wvId={$workspaceOrVersionId}&elementId={$elementId}&partNumber={$partNumber}&revision={$revision}&nodeId={$nodeId}&occurrencePath={$occurrencePath}&configuration={$configuration}
```

Onshape appends `server`, `companyId`, `userId`, `locale` and `clientId` itself. A
placeholder with nothing to resolve to — `partNumber` in a Part Studio, say — arrives as
literal text and is read as absent, so every placeholder can be listed unconditionally.

The portal accepts an action URL beginning with `https://` **or** `http://localhost`,
which is why this needs no tunnel and no public hostname. That `localhost:3000` is the
user's own machine.

**Gate:** three extensions listed on the application, each with a different context.

---

## Phase 3 — publish to themselves, then subscribe (user)

This step has no visible failure mode. Skipped, everything looks configured and no icon
ever appears. Do not let it be skipped, and do not accept "I did the OAuth part" as
having done it — an OAuth grant is not a subscription.

1. Create a **store entry** for the application in the dev portal — category, vendor
   name, version. Leave it unpublished; it stays visible only to them.
2. Open that entry's App Store URL and choose **Subscribe** → **Get for free**. App Store
   *search* does not list private entries, so it has to be reached by URL.

**Gate:** the application appears in their subscribed apps.

---

## Phase 4 — get Carbon running (agent)

```bash
git clone https://github.com/crbnos/carbon.git
cd carbon
git checkout onshape-staging-app

corepack enable
nvm use            # Node 22
pnpm install
source ./setup.sh  # puts the `crbn` dev CLI on PATH
```

Write `.env` in the repository root. `crbn up` generates ports, URLs, Supabase keys,
Redis and Inngest settings into `.env.local` on top of it, so only these are set by hand:

```bash
SESSION_SECRET="any-long-random-string"
CARBON_EDITION="enterprise"

# Required at boot — the app does not start without them.
POSTHOG_API_HOST="https://us.posthog.com"
POSTHOG_PROJECT_PUBLIC_KEY="…"
RESEND_API_KEY="re_placeholder"

# From phase 1.
ONSHAPE_CLIENT_ID="…"
ONSHAPE_CLIENT_SECRET="…"
ONSHAPE_OAUTH_REDIRECT_URL="http://localhost:3000/api/integrations/onshape/oauth"
```

`RESEND_API_KEY` is read at module load, so it must be non-empty even with no mail —
any placeholder works. The PostHog pair is genuinely required at boot; a free project
covers it. `.env.example` documents everything else.

Then boot:

```bash
crbn up --no-portless
```

**`--no-portless` is not optional.** The default mode serves the app on a random port at
a `*.dev` hostname, so Carbon sends Onshape a `redirect_uri` pointing at a port nothing
is listening on and OAuth dies after consent. Both URLs registered in phases 1 and 2 are
`localhost:3000`.

Leave this running. It is the user's foreground process, not a background task the agent
manages.

**Gates**, both required:

```bash
curl -sI http://localhost:3000/onshape/panel | grep -i content-security-policy
# → content-security-policy: frame-ancestors https://onshape.com https://*.onshape.com
```

```bash
grep -c ONSHAPE_CLIENT_ID .env    # → 1
```

---

## Phase 5 — connect the integration (user clicks, agent verifies)

1. Open `http://localhost:3000`, sign in.
2. **Settings → Integrations → Onshape → Install.** An OAuth popup opens; the user
   consents; the popup closes itself and the card flips to **Installed** with no reload.
3. Confirm the company has at least one **unit of measure**. Onboarding seeds a standard
   set, so this is usually already true — but a push takes the item's unit from that list
   and has nothing to fall back on if it is empty.

If the card still reads "Coming soon" with Install disabled, `ONSHAPE_CLIENT_ID` did not
reach the process — check `.env`, then restart the stack. That is not plan gating, and it
is not a license problem.

**Gate:** the Onshape card reads Installed.

---

## Phase 6 — first push (user drives)

1. Open a Part Studio in the nominated Onshape document.
2. Click the **Carbon** icon in the right strip. The panel loads and shows the document
   context.
3. Click **Sign in to Carbon**. A popup opens, the user signs in, it closes itself, and
   the panel flips to connected. **A person has to make this click** — it is inside a
   cross-origin iframe and no automation can reach it.
4. The panel lists the element's parts with what each already has in Carbon.
5. Push a part. A review appears showing exactly what would be written. Nothing is
   written until it is confirmed.
6. Confirm, then check the item in Carbon — it should carry the part number as its id,
   plus name, description, revision, a 3D model and a thumbnail.

**Gate:** the item exists in Carbon and its Onshape card offers *Open in Onshape*.

---

## When it doesn't work

| What you see | What it is |
| --- | --- |
| No Carbon icon in Onshape's right strip | Not subscribed to the application — phase 3 |
| Onshape card reads "Coming soon", Install disabled | `ONSHAPE_CLIENT_ID` not set, or set after the stack booted |
| Every enterprise integration shows an upgrade prompt | `CARBON_EDITION` is not `enterprise` |
| OAuth fails after consent | `redirect_uri` mismatch — usually portless mode, see phase 4 |
| Panel opens blank inside Onshape | A browser refusing to frame `http://localhost` from an `https://` page. Use Chrome |
| A part missing from the panel's list | No **Part number** set on it in Onshape |
| "Review expired", or a push rejected after a pause | A review is held 15 minutes, then has to be opened again |
| A push refused, naming a part | That part's make method is released. Released methods are never written |
| A release just made in Onshape not listed | `ONSHAPE_DEV_CACHE=1` caches reads for 10 minutes. Unset it |

## Tell the user these three things before they test in earnest

- **API quota is theirs.** A private application debits its owner's annual Onshape quota
  on every read. Building the whole panel spent roughly 115 live calls; a determined
  session spends more. Live calls are counted in Redis under `onshape:api-calls:<year>`
  — worth reading before and after a session.
- **Configurations are not carried, anywhere.** A part or assembly in a non-default
  configuration resolves to the *default* bill of materials and lands on the *default*
  item, overwriting its model file, with nothing in the UI saying so. Check what
  configured geometry maps to before pushing it. This is the sharpest edge in the app
  today.
- **`ONSHAPE_DEV_CACHE=1`** saves quota by serving repeated reads from a 10-minute cache,
  at the cost of showing stale data. Leave it off when testing what the app actually
  does.
