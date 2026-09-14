# Onshape Configuration Import — Research

Can Carbon import a *configured* Onshape assembly (a specific variant) rather than only the
default configuration? And can the UI know, before rendering, whether a given element even
has configurations?

Grounded against the Onshape OpenAPI spec (`onshape-public/onshape-clients@master`,
`openapi.json`, Implementation-Version **1.113**), the `onshape-public/api-generator`
`apiData.json` (1.87 — older, but it carries the prose field descriptions the OpenAPI spec
omits), and Carbon's own integration code in `packages/ee/src/onshape/`,
`packages/jobs/src/inngest/functions/integrations/onshape-*.ts`, and
`apps/erp/app/routes/api+/integrations.onshape.*`.

**Verification status:** everything below is read off the published spec + Carbon's source.
Nothing here was exercised against a live Onshape tenant — the egress proxy blocks
`cad.onshape.com`, `forum.onshape.com` and `onshape-public.github.io`, and this session had
no Onshape token. The three items needing a live probe are called out in §7.

## TL;DR

1. **Yes, configurations are importable**, and the API surface needs no new capability —
   every endpoint Carbon already calls accepts a `configuration` parameter. Carbon just
   never passes one, so it silently imports whatever Onshape's default configuration is.
2. **Yes, "has configurations?" is answerable in one call**, and it is a clean boolean:
   `GET /elements/d/{did}/{wvm}/{wvmid}/e/{eid}/configuration` →
   `configurationParameters.length > 0`. There is *no* way to get it from the element
   listing Carbon already fetches, so it costs exactly one extra request, made once when
   the user picks an assembly. That is cheap enough to make "show the dropdown iff there
   are configurations" the default behavior with no feature flag.
3. The hard part is **not** the API. It is identity: Carbon joins Onshape to items on
   `readableIdWithRevision`, and N configurations of one element only become N Carbon items
   if the customer has Onshape generating a distinct part number per configuration (§6).
4. Independent of any of this, there is a **latent bug**: `BTRevisionInfo` carries a
   `configuration` field that `onshape-revision-sync.ts` discards (§5).

## 1. What a configuration is, over the wire

A configuration is a single opaque **encoded string**, passed as a `configuration` query
param on GETs and as a `configuration` body field on POSTs. It looks like:

```
List_sCW2T7xBCmN6an=_500_mm
Width=Long;Height=Tall
```

Multiple inputs are `;`-separated. The `List_…=` form is what Onshape generates when the
parameter ids are auto-generated; the human-readable form appears when the author named the
parameters. **Do not hand-build these strings** — parameter ids are generated, and values
containing non-alphanumeric characters get additional encoding that is not plain
URL-encoding. Build them through the encode endpoint (§3).

Omitting `configuration` entirely means "the element's default configuration". That is
exactly Carbon's behavior today — which is why a configured assembly imports today without
erroring, just with the wrong (default) variant if the user wanted another one.

## 2. Detecting whether an element has configurations

**The element listing does not tell you.** `getElementsInDocument`
(`GET /documents/d/{did}/{wvm}/{wvmid}/elements`) returns `BTDocumentElementInfo`, whose
complete property set is:

```
angleUnits, dataType, elementType, filename, foreignDataId, id, lengthUnits,
massUnits, microversionId, name, specifiedUnit, thumbnailInfo, thumbnails,
type, unupdatable
```

No configuration field, no `isConfigured` flag, no parameter count. This is the call
`apps/erp/app/routes/api+/integrations.onshape.d.$did.v.$vid.elements.ts` already makes to
populate the Assembly combobox, so the answer cannot be folded into it.

**The per-element configuration endpoint does tell you, definitively:**

```
GET /api/v10/elements/d/{did}/{wvm}/{wvmid}/e/{eid}/configuration
```

`{wvm}` accepts `w` | `v` | `m`, so this works at a **version** — which is what Carbon's
picker is scoped to. (The read is `{wvm}`; only the `POST` *update* form is
workspace-only. There is also a `/partstudios/…/configuration` variant; the `/elements/…`
form is the general one and is what covers assemblies.)

Response (`BTConfigurationResponse`, per api-generator's documented fields):

```jsonc
{
  "configurationParameters": [ /* BTMConfigurationParameter — see §4 */ ],
  "currentConfiguration": [ /* current parameter settings */ ],
  "serializationVersion": "…",
  "sourceMicroversion": "…"
}
```

**The detection predicate is `configurationParameters.length > 0`.** An unconfigured
element returns an empty list. Write the check defensively —
`(configurationParameters?.length ?? 0) > 0` — since the 1.113 OpenAPI schema declares the
response as `BTConfigurationInfo` (`{ isStandardContent, parameters[] }`) while
api-generator documents it as `BTConfigurationResponse` (`{ configurationParameters[],
currentConfiguration[] }`). The two disagree; api-generator's prose matches every field
name reported in the wild, so `configurationParameters` is the one to read, but a
tolerant reader costs nothing. This is the first item in §7.

### Cost and where to put the call

One request, per element, on selection — not per element in the listing. The Onshape picker
in `OnshapeSync.tsx` is already a three-step cascade (Document → Version → Assembly), each
step firing its own fetcher on the previous step's change. Configuration detection is a
fourth link in exactly that chain, fired on `elementId` change. It adds one round trip to a
flow that already costs three, and only after the user has committed to an assembly.

There is no bulk/batch form of this endpoint, so eagerly detecting configurations for every
element in the listing would cost one call per element. Don't — the picker doesn't need it,
and Onshape rate-limits.

### The UI consequence

Render the configuration controls **iff** `configurationParameters` is non-empty. For an
unconfigured assembly the panel is identical to today's, with no empty dropdown and no
"None" placeholder to explain. For a configured one, each parameter gets a control (§4)
prefilled from its `defaultValue`, so the initial state reproduces today's behavior exactly
— the user has to actively change something to get a different import.

## 3. Building the configuration string

```
POST /api/v10/elements/d/{did}/e/{eid}/configurationencodings
     ?versionId={vid}
Body: { "parameters": [ { "parameterId": "…", "parameterValue": "…" } ] }
  →   { "encodedId": "List_sCW2T7xBCmN6an=_500_mm",
        "queryParam": "configuration=List_izOjbm5HCRXEld=_500_mm" }
```

Use `queryParam` when appending to a GET URL, `encodedId` when putting it in a POST body
(e.g. `BTTranslateFormatParams.configuration`). Note the path takes `did`/`eid` but **not**
`wvm`/`wvmid` — the version goes in the optional `versionId` query param.

The inverse, for displaying a stored configuration back to the user:

```
GET /api/v10/elements/d/{did}/{wvm}/{wvmid}/e/{eid}/configurationencodings/{cid}
    ?includeDisplay=true&configurationIsId=false
  → { isStandardContent, parameters: [ { parameterId, parameterValue,
        parameterName, parameterDisplayValue, explicit } ] }
```

`includeDisplay=true` is what turns raw ids into the labels a human typed in Onshape.
`explicit` distinguishes a value the string actually encodes from one defaulted out of the
element's own configuration — useful if we ever want to show "3 of 5 parameters set".

## 4. Parameter types → UI controls

Each entry in `configurationParameters` is a `BTMConfigurationParameter` discriminated on
`btType`, with a `parameterType` of `ENUM` | `BOOLEAN` | `STRING` | `QUANTITY`. Common
fields: `parameterId`, `parameterName`, `parameterType`, `valid`.

| `parameterType` | `btType` | Type-specific fields | Carbon control |
|---|---|---|---|
| `ENUM` | `BTMConfigurationParameterEnum-105` | `options[] { option, optionName }`, `optionIds[]`, `defaultValue`, `enumName`, `namespace` | `Combobox` — `value: option`, `label: optionName` |
| `BOOLEAN` | `BTMConfigurationParameterBoolean-2550` | `defaultValue: boolean` | `Switch` |
| `QUANTITY` | `BTMConfigurationParameterQuantity-1826` | `quantityType` (`INTEGER`/`REAL`/`LENGTH`/`ANGLE`/`MASS`/…), `rangeAndDefault { minValue, maxValue, defaultValue, units }` | `Number` with min/max, unit suffix from `units` |
| `STRING` | `BTMConfigurationParameterString-872` | `defaultValue: string` | `Input` |

`ENUM` is overwhelmingly the common case in practice and is the one that maps to the
"configurations dropdown" the feature is named after. The other three are worth handling
because a single element mixes them freely — an assembly with a `List` *and* a length
parameter is ordinary — and a partially-rendered form would silently send an incomplete
configuration.

Prefill every control from its `defaultValue` / `rangeAndDefault.defaultValue`, so the
initial encoded string is the default configuration.

**Standard content** is an edge case: `BTConfigurationInfo.isStandardContent` and
`BTConfigurationParams.standardContentParametersId` exist for library parts (fasteners
etc.), which are configured through a separate parameter set. Out of scope for a first
pass — a standard-content row in a BOM is a purchased part Carbon matches by part number,
not something the user picks a configuration for.

## 5. Every Carbon call site, and whether it takes a configuration

| Call site | Accepts `configuration`? | Carbon today |
|---|---|---|
| `getBillOfMaterials` — `GET /assemblies/d/{did}/{wvm}/{wvmid}/e/{eid}/bom` | ✅ query param | **not passed** — `client.ts:260` hardcodes the query string |
| `createAssemblyTranslation` — `POST /assemblies/…/translations` | ✅ `BTTranslateFormatParams.configuration` | ✅ **already an option** (`client.ts:398`); no caller sets it |
| `createPartStudioTranslation` — `POST /partstudios/…/translations` | ✅ same | ✅ **already an option** (`client.ts:366`); no caller sets it |
| `getParts` — `GET /parts/d/{did}/{wvm}/{wvmid}/e/{eid}` | ✅ query param | not passed |
| metadata (`/metadata/…`), mass properties, bounding boxes | ✅ query param | not called |
| `getElementThumbnail` — `GET /thumbnails/d/{did}/{wv}/{wvid}/e/{eid}/s/{sz}` | ❌ — see below | used unconfigured, at a version |
| `getElements` — `GET /documents/…/elements` | ❌ (§2) | — |
| `getRevisions` / `getCompanyRevisions` | n/a (returns it) | see below |

Two findings from this table are worth pulling out.

**The configured thumbnail has no version-scoped form.** The configured variants are
`/thumbnails/d/{did}/w/{wid}/e/{eid}/c/{cid}/s/{sz}` (configuration *id*) and
`…/ac/{cid}/s/{sz}` (encoded configuration string) — both **workspace-only** (`/w/`), while
Carbon's asset sync works at a released **version** (`/v/`). So a configured asset sync
cannot get a matching thumbnail from the thumbnails API. The substitute is
`GET /assemblies/d/{did}/v/{vid}/e/{eid}/shadedviews?configuration=…`, which does take
`{wvm}` (so a version works), does take a configuration, and returns base64 images —
confirmed in the 1.113 spec's parameter list alongside `outputWidth`, `outputHeight`,
`viewMatrix`, `edges`, `useAntiAliasing`. That is a different response shape from the raw
PNG `getElementThumbnail` returns, so `syncOnshapeElementAssetsToItem`'s thumbnail branch
would need a second path rather than a parameter.

**`BTRevisionInfo` has a `configuration` field — and Carbon drops it.** Released revisions
carry the configuration they were released at. `getRevisions` / `getCompanyRevisions`
already return it, and `OnshapeRevision` in `packages/ee/src/onshape/lib/client.ts` doesn't
declare it, so `onshape-revision-sync.ts` and `onshape-backfill.ts` never see it. The
consequence: if a customer releases two configurations of one element **under the same part
number**, both resolve to the same `releaseKey(partNumber, revision)`
(`onshape-matching.ts`), match the same Carbon item, and the attach helper's
replace-not-append rule makes it last-writer-wins — the second export silently overwrites
the first, with no error and no skip reason. If the customer uses Onshape's
per-configuration part number generation (the setup Onshape itself recommends for
releasing configurations) the keys differ and nothing collides.

This is a live correctness issue **today**, independent of whether the import feature gets
built. It should at minimum be detectable: carrying `configuration` onto `OnshapeRevision`
and adding an `ambiguous-configuration` skip reason turns a silent overwrite into a visible
skip. See §6.

## 6. The real design question: identity

Carbon's Onshape join key is `readableIdWithRevision` — `readableId` + `.` + `revision`,
built by `releaseKey()` and matched in `onshape-revision-sync.ts` and the BOM route's
`itemsMap` lookup. Onshape's `partNumber` + `revision` map onto it 1:1.

A configuration does not participate in that key. So:

- **Distinct part number per configuration** (Onshape's recommended release setup): each
  configuration is already a distinct Carbon item. Everything works; the configuration
  picker is purely about *which variant's BOM you pull*, and nothing downstream changes.
- **Same part number across configurations**: N configurations collapse onto one Carbon
  item. The BOM import would overwrite the make method each time, and asset sync
  overwrites the model (§5).

Carbon cannot fix the second case by choosing a smarter key — `readableIdWithRevision` is
load-bearing across items, jobs, quotes and purchasing, and appending a configuration hash
to it would be a schema-wide change for an Onshape-specific problem.

**Recommendation: scope the feature as a configuration *selector* on the existing import,
not an "import all configurations" bulk operation.** The user picks Document → Version →
Assembly → configuration, and gets that variant's BOM into the make method they are already
on. This is honest about the identity constraint (the user is choosing which variant *this*
Carbon item represents), it is the same shape as the existing flow, and it makes the
already-present `configuration` option on the translation calls reachable so asset sync
exports geometry matching the imported BOM.

An "import every configuration as its own item" feature is a genuinely different, larger
feature that requires solving the identity problem first. It should not be smuggled into
this one.

## 7. Needs a live probe

Three things could not be confirmed without a token and an unblocked network:

1. **The exact `getConfiguration` response shape.** The 1.113 OpenAPI says
   `BTConfigurationInfo { isStandardContent, parameters[] }`; api-generator 1.87 says
   `BTConfigurationResponse { configurationParameters[], currentConfiguration[], … }`.
   Every field name observed in the wild matches the latter. Read `configurationParameters`
   and tolerate its absence. **This is the one that gates the detection predicate — probe
   it first.**
2. **Whether BOM rows expose each child's own configuration.** Per-row configuration should
   live in `rows[].itemSource` (alongside the `did`/`wid`/`eid`/`partId` that sample apps
   read from it), and may require `includeItemMicroversions=true` —
   `client.ts:260` currently pins that to `false`. Carbon's flattener in
   `integrations.onshape.d.$did.v.$vid.e.$eid.bom.ts` only reads `headerIdToValue` against
   the `headers` array, so it discards `itemSource` entirely today. This matters for a
   multi-config assembly whose BOM lists the same part twice at different configurations —
   they'd flatten to two identical rows.
3. **Whether v10 has since added a version-scoped configured thumbnail.** If
   `/thumbnails/d/{did}/v/{vid}/e/{eid}/ac/{cid}/s/{sz}` exists in v10, it is strictly
   simpler than the `shadedviews` fallback in §5.

## Implications for Carbon

Scoped to the configuration-selector feature recommended in §6:

**`packages/ee/src/onshape/lib/client.ts`**
- `getElementConfiguration(documentId, versionId, elementId)` → the §2 response. Type the
  parameter union off `btType` per §4.
- `encodeConfiguration(documentId, elementId, parameters, versionId?)` → `{ encodedId,
  queryParam }` per §3.
- Thread an optional `configuration` through `getBillOfMaterials` (append
  `&configuration=<encoded>` — the method builds its query string inline today).
- Add `configuration?: string` to the `OnshapeRevision` interface (§5) so the revision path
  at least *sees* it.

**`apps/erp/app/routes/api+/`**
- New `integrations.onshape.d.$did.v.$vid.e.$eid.configuration.ts` loader — returns the
  parameter definitions, or an empty list. Mirror the existing `.elements.ts` /
  `.bom.ts` route shape (`{ data, error }`, `shouldRevalidate: () => false`).
- New encode action, or encode server-side inside the BOM loader from a parameter map. The
  latter is one fewer round trip and keeps the encoded string off the client entirely —
  prefer it unless the UI needs to display the encoded form.
- `integrations.onshape.d.$did.v.$vid.e.$eid.bom.ts` — accept the configuration and pass it
  through.
- `integrations.onshape.sync.ts` — persist `configuration` into
  `externalIntegrationMapping.metadata` next to `documentId`/`versionId`/`elementId`, so a
  re-sync reproduces the same variant. The metadata column is untyped JSONB; no migration.

**`apps/erp/app/components/OnshapeSync.tsx`**
- A fourth fetcher in the existing cascade, on `elementId` change.
- Render controls **iff** `configurationParameters` is non-empty (§2), prefilled from
  defaults (§4). Reset them when `elementId` changes, the same way `elementId` resets on
  `versionId` change today.
- Restore the saved `configuration` from the mapping in the existing `useMount` read, so
  reopening the panel on a previously-synced item shows the variant it was synced at.

**Not touched:** the `sync` edge function and the `makeMethod` schema. The BOM rows come
back already resolved for the chosen configuration, so everything downstream of the
flattener is unchanged.

**Separable, and worth doing regardless:** the §5 revision-sync fix. It is a real
last-writer-wins overwrite affecting customers who release configurations under a shared
part number, and it has nothing to do with the import UI.
