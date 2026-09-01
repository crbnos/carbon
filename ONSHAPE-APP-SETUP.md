# Running the Carbon app for Onshape

The Carbon panel lives inside Onshape's element right panel. You work in Onshape and
push to Carbon when something is ready — Carbon never pulls on its own. It offers three
pushes: a part, an assembly with its bill of materials, and a release.

This is the whole path from nothing to a first push, against **your own** Onshape
account and a Carbon instance you run yourself. Allow an hour, most of it Onshape-side.

Product documentation for the panel itself is `docs/content/docs/integrations/cad.mdx`;
the Onshape registration below is also published as
`docs/content/docs/integrations/onshape-setup.mdx`.

## Before you start

- An Onshape account on a plan with **dev portal** access, and an Onshape **company**.
  Release management is a company feature — without one, the release push has nothing
  to act on.
- Onshape company settings → Release management → **managed workflows enabled**, if you
  intend to test releases.
- **Docker**, **Node 22**, **pnpm** (via Corepack), and **Chrome**.
- An Onshape document worth pushing. One that exercises everything has: a Part Studio
  with three or more parts, two of them with **Part number** and **Revision** set and
  one without; an assembly of those parts including one subassembly; and a drawing of
  one part.

> The panel is implemented under `packages/ee`, which the repository LICENSE places
> behind a commercial license, and it only renders when `CARBON_EDITION` is
> `enterprise`. Confirm your license position before setting it.

## Why you register your own Onshape application

You cannot be handed one. An Onshape extension renders only for users **subscribed** to
its application, and a private store entry is scoped to the Onshape company that
published it — so a shared application would be invisible to you. Registering your own
also means the API quota it spends is yours, not someone else's.

## 1. Register the application

In the Onshape dev portal, create an application:

| Field | Value |
| --- | --- |
| Application type | **Integrated Cloud App** |
| OAuth redirect URL | `http://localhost:3000/api/integrations/onshape/oauth` |
| Permissions | **OAuth2Read** *and* **OAuth2Write** |

Keep the client id and secret for step 4.

**Connected Desktop App** is the wrong type — it cannot carry the extensions added
next, and switching type afterwards needs a confirmation dialog that a stray click
will not produce.

**Write is not optional.** It creates the model-export jobs and manages the release
webhook subscription. With read alone, asset sync cannot be enabled at all.

## 2. Add the three panel extensions

Add three extensions, identical but for their context, so the panel opens from every
place it should:

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
placeholder with nothing to resolve to — `partNumber` in a Part Studio, say — arrives
as literal text and is read as absent, so every placeholder can be listed
unconditionally.

The portal accepts an action URL beginning with `https://` **or** `http://localhost`,
which is why running Carbon on your own machine needs no tunnel and no public
hostname. `localhost:3000` here is *your* machine.

## 3. Publish it to yourself, then subscribe

This step has no visible failure mode. Skip it and everything looks configured, and no
icon ever appears.

1. Create a **store entry** for the application in the dev portal — category, vendor
   name, version. Leave it unpublished; it stays visible only to you.
2. Open the entry's App Store URL and choose **Subscribe** → **Get for free**. App
   Store *search* does not list private entries, so reach it by URL.

An OAuth grant is not a subscription.

## 4. Get Carbon running

```bash
git clone https://github.com/crbnos/carbon.git
cd carbon
git checkout onshape-staging-app

corepack enable
nvm use            # Node 22
pnpm install
source ./setup.sh  # puts the `crbn` dev CLI on your PATH
```

Create `.env` in the repository root. `crbn up` generates ports, URLs, Supabase keys,
Redis and Inngest settings into `.env.local` on top of this, so only these are yours to
set:

```bash
SESSION_SECRET="any-long-random-string"
CARBON_EDITION="enterprise"

# Required at boot — the app will not start without them.
POSTHOG_API_HOST="https://us.posthog.com"
POSTHOG_PROJECT_PUBLIC_KEY="…"
RESEND_API_KEY="re_placeholder"

# From step 1.
ONSHAPE_CLIENT_ID="…"
ONSHAPE_CLIENT_SECRET="…"
ONSHAPE_OAUTH_REDIRECT_URL="http://localhost:3000/api/integrations/onshape/oauth"
```

`RESEND_API_KEY` is read at module load, so it must be non-empty even if you never send
mail — any placeholder works. The PostHog pair is genuinely required; a free project
covers it. `.env.example` documents everything else.

Then boot:

```bash
crbn up --no-portless
```

**`--no-portless` matters.** The default mode serves the app on a random port at a
`*.dev` hostname, so Carbon sends Onshape a `redirect_uri` pointing at a port nothing
is listening on, and OAuth dies after you consent. Both URLs you registered are
`localhost:3000`.

## 5. Connect, and push

1. **Settings → Integrations → Onshape → Install.** The OAuth popup closes itself and
   the card flips to Installed.
2. Check the company has at least one **unit of measure**. Onboarding seeds a standard
   set, so normally this is already true — but a push assigns a unit from that list and
   has nothing to fall back on if it is empty.
3. Open a Part Studio in Onshape and click the Carbon icon in the right strip.
4. **Sign in to Carbon** in the panel — it opens a popup, which closes itself. The
   panel then lists the element's parts and what each already has in Carbon.
5. Push. Every push shows a review of exactly what would be written, and writes nothing
   until you confirm it.

## When it doesn't work

| What you see | What it is |
| --- | --- |
| No Carbon icon in Onshape's right strip | Not subscribed to the application — step 3 |
| Onshape card reads "Coming soon", Install disabled | `ONSHAPE_CLIENT_ID` not set |
| Every enterprise integration shows an upgrade prompt | `CARBON_EDITION` is not `enterprise` |
| OAuth fails after you consent | `redirect_uri` mismatch — usually portless mode, see step 4 |
| Panel opens blank inside Onshape | A browser refusing to frame `http://localhost` from an `https://` page. Use Chrome |
| A part missing from the panel's list | No **Part number** set on it in Onshape |
| "Review expired", or a push rejected after a pause | A review is held 15 minutes, then has to be opened again |
| A push refused, naming a part | That part's make method is released. Released methods are never written |
| A release you just made not listed | `ONSHAPE_DEV_CACHE=1` caches reads for 10 minutes. Unset it |

## What this costs, and what to watch

- **API quota is yours.** A private application debits its owner's annual Onshape quota
  on every read. Building the whole panel spent roughly 115 live calls; a determined
  test session will spend more. Live calls are counted in Redis under
  `onshape:api-calls:<year>` — worth reading before and after a session.
- **`ONSHAPE_DEV_CACHE=1`** serves repeated reads from a 10-minute cache and saves
  quota, at the cost of showing you stale data. Leave it off when you are testing what
  the app actually does.
- **Configurations are not carried, anywhere.** A part or assembly in a non-default
  configuration resolves to the *default* bill of materials and lands on the *default*
  item, overwriting its model file, with nothing in the UI saying so. Push configured
  geometry only once you have checked what it maps to. This is the sharpest edge in the
  app today.
- **A review spends its Onshape reads whether or not you push.** Cancelling costs the
  same as confirming.
