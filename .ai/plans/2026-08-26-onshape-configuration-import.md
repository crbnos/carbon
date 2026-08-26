# Onshape Configuration Import — implementation plan

**Spec:** `.ai/specs/2026-08-26-onshape-configuration-import.md`
**Research:** `.ai/research/2026-08-26-onshape-configuration-import.md`
**Branch:** `claude/onshape-config-import-atpi1d`

Adds a configuration selector to the existing Onshape BOM import. After the user picks an
assembly, Carbon asks Onshape whether that element has configuration parameters and — **iff
it does** — renders one control per parameter. No migration, no schema change, no
`generate:types`.

## Progress

- [ ] Task 1: Add configuration types + tolerant reader + `getElementConfiguration` to the ee client
- [ ] Task 2: Add `encodeConfiguration` and thread `configuration` through `getBillOfMaterials`
- [ ] Task 3: New configuration loader route + path helper
- [ ] Task 4: Accept and encode a configuration on the BOM route
- [ ] Task 5: Persist the configuration on sync
- [ ] Task 6: Render the configuration controls in `OnshapeSync`
- [ ] Task 7: Extract and fill i18n strings
- [ ] Task 8: Browser-verify the feature
- [ ] Task 9 (Phase 2, separable): Surface `configuration` on released revisions

## Dependencies

- Task 2 needs Task 1 (shares the same file; Task 1's exported helpers are the precedent for Task 2's).
- Task 3 needs Task 1 (`getElementConfiguration`).
- Task 4 needs Task 2 (`encodeConfiguration`, `getBillOfMaterials` signature).
- Task 5 needs Task 2 (`encodeConfiguration`).
- Task 6 needs Tasks 3, 4, 5 (all three route contracts).
- Task 7 needs Task 6 (the strings must exist).
- Task 8 needs Task 7.
- **Tasks 3, 4 and 5 are independent of each other** once Task 2 lands — `/execute` may run
  them as parallel subagents. Everything else is strictly sequential.
- **Task 9 is independent of Tasks 1–8** and may be run at any point, or dropped entirely
  without affecting the rest of the plan.

## A note on the live probe

The spec records three items that need one authenticated request each against a real
configured Onshape document. **You are not expected to have an Onshape tenant.** Every task
below is written so the code is correct under either resolution of those items:

- Task 1 reads `configurationParameters` **and** falls back to `parameters`, so the field-name
  ambiguity cannot break detection.
- Task 2 sends QUANTITY values as `"{value} {units}"`, which is the documented string form.
  If a live probe later rejects that format, only `formatParameterValue` in Task 1 changes.

Do **not** attempt to reach `cad.onshape.com` from a sandboxed environment — outbound
egress to it is blocked. Rely on the unit tests, which use committed fixtures.

---

## Task 1: Add configuration types + tolerant reader + `getElementConfiguration` to the ee client

**Depends on:** none

**Files:**
- Modify: `packages/ee/src/onshape/lib/client.ts` — add the parameter type union, two
  exported pure helpers, and one client method
- Create: `packages/ee/src/onshape/lib/client.test.ts` — unit tests for the two pure helpers
- Copy from (precedent): the existing `OnshapeRevision` / `OnshapeTranslation` interfaces in
  the same file (comment style: explain *why*, cite the Onshape behavior); test style from
  `packages/ee/src/paperless-parts/lib/utils.test.ts`

**Steps:**

1. In `packages/ee/src/onshape/lib/client.ts`, above the `OnshapeApiError` class, add the
   parameter type union. Onshape discriminates on `btType`; Carbon discriminates on the
   friendlier `parameterType`, which every variant also carries:

```ts
// A configuration parameter definition for an element. Onshape discriminates these on
// `btType` (BTMConfigurationParameterEnum-105 etc.); `parameterType` carries the same
// distinction in a readable form, so that is what Carbon switches on.
export type OnshapeConfigurationParameter =
  | {
      parameterType: "ENUM";
      parameterId: string;
      parameterName: string;
      defaultValue?: string;
      // `option` is the value the encoder wants; `optionName` is what the author typed.
      options: { option: string; optionName: string }[];
    }
  | {
      parameterType: "BOOLEAN";
      parameterId: string;
      parameterName: string;
      defaultValue?: boolean;
    }
  | {
      parameterType: "STRING";
      parameterId: string;
      parameterName: string;
      defaultValue?: string;
    }
  | {
      parameterType: "QUANTITY";
      parameterId: string;
      parameterName: string;
      quantityType?: string;
      rangeAndDefault?: {
        minValue?: number;
        maxValue?: number;
        defaultValue?: number;
        units?: string;
      };
    };
```

2. Directly below it, add the tolerant reader as an **exported module-level function** (not
   a method — it must be unit-testable without a network or a client instance):

```ts
// The two published descriptions of this endpoint disagree on the field name: the 1.113
// OpenAPI declares `parameters`, api-generator declares `configurationParameters`. Every
// field name observed in the wild matches the latter, so prefer it — but a reader that
// accepts both costs nothing and is the difference between "no configurations" and a
// broken picker. Anything unrecognizable reads as an unconfigured element, which is
// exactly Carbon's pre-existing behavior.
export function readConfigurationParameters(
  response: unknown
): OnshapeConfigurationParameter[] {
  if (!response || typeof response !== "object") return [];
  const body = response as Record<string, unknown>;
  const raw = body.configurationParameters ?? body.parameters;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (parameter): parameter is OnshapeConfigurationParameter =>
      !!parameter &&
      typeof parameter === "object" &&
      typeof (parameter as { parameterId?: unknown }).parameterId === "string" &&
      ["ENUM", "BOOLEAN", "STRING", "QUANTITY"].includes(
        (parameter as { parameterType?: unknown }).parameterType as string
      )
  );
}
```

3. Below that, add the value formatter — also exported and pure:

```ts
// Onshape's encoder takes every parameterValue as a STRING. A QUANTITY is unit-ambiguous
// as a bare number, so its unit rides along ("500 mm"); the encoder normalizes from there.
// Booleans are "true"/"false"; enums and strings pass through.
export function formatParameterValue(
  parameter: OnshapeConfigurationParameter,
  value: string | number | boolean
): string {
  if (parameter.parameterType === "QUANTITY") {
    const units = parameter.rangeAndDefault?.units;
    return units ? `${value} ${units}` : String(value);
  }
  return String(value);
}
```

4. Add the client method, placed next to `getElements` (it is an element read). Note the
   `/elements/` form — NOT `/partstudios/` — because it must also serve assemblies:

```ts
  // Configuration definition for ONE element at a version. An element with no
  // configurations returns an empty parameter list — that emptiness is the signal the
  // BOM picker uses to decide whether to render configuration controls at all. `{wvm}`
  // accepts `v`, so this works at the released version the picker is scoped to; only the
  // POST *update* form is workspace-only. Use the `/elements/` path rather than
  // `/partstudios/` — it is the general form and is what covers assemblies.
  async getElementConfiguration(
    documentId: string,
    versionId: string,
    elementId: string
  ): Promise<OnshapeConfigurationParameter[]> {
    const response = await this.request<unknown>(
      "GET",
      `/api/v10/elements/d/${documentId}/v/${versionId}/e/${elementId}/configuration`
    );
    return readConfigurationParameters(response);
  }
```

5. Create `packages/ee/src/onshape/lib/client.test.ts` with `describe`/`it` from `vitest`
   covering, at minimum:
   - `readConfigurationParameters` returns `[]` for `null`, `undefined`, `{}`, `[]`,
     `{ configurationParameters: "nope" }`.
   - It reads a `configurationParameters` array (api-generator shape).
   - It reads a `parameters` array when `configurationParameters` is absent (OpenAPI shape).
   - It drops entries missing `parameterId` or carrying an unknown `parameterType`.
   - `formatParameterValue` appends units for QUANTITY with `rangeAndDefault.units`,
     omits them when `units` is absent, and passes ENUM/BOOLEAN/STRING through as strings.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- client.test
# Expected: all tests pass, "Test Files  1 passed", 0 failed
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exits 0, no TS errors
```

**Out of scope:** Do not touch `getBillOfMaterials` (Task 2), the translation methods, or
`OnshapeRevision` (Task 9). Do not add a `decodeConfiguration` method — the spec keeps it
out of v1 by persisting the parameter map.

---

## Task 2: Add `encodeConfiguration` and thread `configuration` through `getBillOfMaterials`

**Depends on:** Task 1

**Files:**
- Modify: `packages/ee/src/onshape/lib/client.ts` — one exported pure helper, one client
  method, one changed method signature
- Modify: `packages/ee/src/onshape/lib/client.test.ts` — add tests for the path builder

**Steps:**

1. Extract the BOM query string into an **exported pure function** so it is testable
   without mocking axios. Place it beside the other exported helpers from Task 1:

```ts
// The BOM path, built separately from the request so the configuration handling is
// unit-testable without a network. Every flag here is the pre-existing behavior — only
// `configuration` is new, and it is appended ONLY when non-empty so an unconfigured
// import produces a byte-identical URL to the one Carbon has always sent.
export function buildBillOfMaterialsPath(
  documentId: string,
  versionId: string,
  elementId: string,
  configuration?: string
): string {
  const base = `/api/v10/assemblies/d/${documentId}/v/${versionId}/e/${elementId}/bom?indented=true&multiLevel=true&generateIfAbsent=true&onlyVisibleColumns=false&includeItemMicroversions=false&includeTopLevelAssemblyRow=true&thumbnail=false`;
  return configuration
    ? `${base}&configuration=${encodeURIComponent(configuration)}`
    : base;
}
```

2. Rewrite `getBillOfMaterials` (currently at `packages/ee/src/onshape/lib/client.ts:255-262`)
   to take an options bag and delegate to the builder. Keep the existing JSDoc/comment if
   one is present:

```ts
  async getBillOfMaterials(
    documentId: string,
    versionId: string,
    elementId: string,
    options: { configuration?: string } = {}
  ): Promise<any> {
    return this.request(
      "GET",
      buildBillOfMaterialsPath(
        documentId,
        versionId,
        elementId,
        options.configuration
      )
    );
  }
```

   The fourth argument is optional, so the one existing call site
   (`apps/erp/app/routes/api+/integrations.onshape.d.$did.v.$vid.e.$eid.bom.ts`) keeps
   compiling untouched. Task 4 updates it.

3. Add the encoder method next to `getElementConfiguration`:

```ts
  // Turn a parameter map into the encoded configuration string Onshape's own APIs expect.
  // NEVER hand-build this string: parameter ids are generated (List_sCW2T7xBCmN6an=) and
  // values with non-alphanumeric characters get encoding beyond plain URL-encoding.
  // NOTE the path shape — it takes did/eid but NOT wvm/wvmid; the version is a QUERY param.
  // `queryParam` is for appending to GET URLs; `encodedId` is for POST bodies
  // (BTTranslateFormatParams.configuration).
  async encodeConfiguration(
    documentId: string,
    elementId: string,
    parameters: { parameterId: string; parameterValue: string }[],
    versionId?: string
  ): Promise<{ encodedId: string; queryParam: string }> {
    const query = versionId
      ? `?versionId=${encodeURIComponent(versionId)}`
      : "";
    return this.request<{ encodedId: string; queryParam: string }>(
      "POST",
      `/api/v10/elements/d/${documentId}/e/${elementId}/configurationencodings${query}`,
      { parameters }
    );
  }
```

4. Add tests to `client.test.ts`:
   - `buildBillOfMaterialsPath` with no configuration produces a string **identical** to
     the literal currently in `client.ts` (paste today's literal into the test as the
     expected value — this is the backward-compatibility guarantee).
   - With a configuration it appends `&configuration=` with the value URL-encoded
     (test one containing `=` and `;`, e.g. `List_abc=Default;Bool_x=true`).

**Verify:**
```bash
pnpm --filter @carbon/ee test -- client.test
# Expected: all tests pass, including the byte-identical no-configuration path assertion
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=erp
# Expected: exits 0 — erp must still compile with the un-updated 3-arg BOM call site
```

**Out of scope:** Do not update the BOM route call site here (Task 4). Do not set
`configuration` on the translation methods — the asset-sync path is Phase 2 and is not in
this plan beyond Task 9.

---

## Task 3: New configuration loader route + path helper

**Depends on:** Task 1

**Files:**
- Create: `apps/erp/app/routes/api+/integrations.onshape.d.$did.v.$vid.e.$eid.configuration.ts`
- Modify: `apps/erp/app/utils/path.ts` — add `onShapeElementConfiguration` in the `api`
  block, alphabetically between `onShapeDocuments` and `onShapeElements`
- Copy from (precedent): `apps/erp/app/routes/api+/integrations.onshape.d.$did.versions.ts`
  (the smallest sibling — same `shouldRevalidate`, same `requirePermissions(request, {})`,
  same `{ data, error }` envelope, same `getLogger` naming)

**Steps:**

1. Create the route. It differs from its precedent in exactly one way that matters: **a
   failure returns an empty parameter list, not an error.** Detection failing must degrade
   to today's UI, never break an import that works.

```ts
import { requirePermissions } from "@carbon/auth/auth.server";
import type { OnshapeConfigurationParameter } from "@carbon/ee/onshape";
import { getOnshapeClient } from "@carbon/ee/onshape";
import { getLogger } from "@carbon/logger";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";

const logger = getLogger(
  "erp",
  "integrations-onshape-d-did-v-vid-e-eid-configuration"
);

export const shouldRevalidate: ShouldRevalidateFunction = () => {
  return false;
};

// Configuration parameter definitions for one element. An element with no configurations
// returns an empty list, and so does EVERY failure path — the picker treats "no
// parameters" as "render the panel exactly as it did before this feature existed", which
// is always safe because Carbon's pre-existing behavior IS the default configuration.
// Never surface an error here: a detection failure must not block a working BOM import.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const empty: { data: { parameters: OnshapeConfigurationParameter[] }; error: null } = {
    data: { parameters: [] },
    error: null
  };

  const { did, vid, eid } = params;
  if (!did || !vid || !eid) {
    return empty;
  }

  const result = await getOnshapeClient(client, companyId, userId);
  if (result.error || !result.client) {
    logger.error("Failed to get Onshape client for element configuration", {
      error: result.error
    });
    return empty;
  }

  try {
    const parameters = await result.client.getElementConfiguration(
      did,
      vid,
      eid
    );
    return { data: { parameters }, error: null };
  } catch (error) {
    logger.error("Failed to get element configuration from Onshape", { error });
    return empty;
  }
}
```

2. In `apps/erp/app/utils/path.ts`, add to the `api` object (the existing `onShapeBom`
   helper at line 180 is the shape to mirror):

```ts
      onShapeElementConfiguration: (
        documentId: string,
        versionId: string,
        elementId: string
      ) =>
        generatePath(
          `${api}/integrations/onshape/d/${documentId}/v/${versionId}/e/${elementId}/configuration`
        ),
```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0, no TS errors
grep -n "onShapeElementConfiguration" apps/erp/app/utils/path.ts
# Expected: one match inside the api block
```

**Out of scope:** Do not add a stricter permission scope — all four sibling Onshape read
routes use `requirePermissions(request, {})` and the spec fixed this deliberately. Do not
add caching or revalidation beyond the `shouldRevalidate: () => false` the siblings use.

---

## Task 4: Accept and encode a configuration on the BOM route

**Depends on:** Task 2

**Files:**
- Modify: `apps/erp/app/routes/api+/integrations.onshape.d.$did.v.$vid.e.$eid.bom.ts` —
  read + encode + pass through
- Modify: `apps/erp/app/utils/path.ts` — `onShapeBom` gains an optional 4th argument
- Copy from (precedent): the file's own existing structure; the encoding call shape from
  Task 2's `encodeConfiguration` signature

**Steps:**

1. In `apps/erp/app/utils/path.ts`, widen `onShapeBom` (line 180). The map is sent as
   JSON in a search param, since a loader has no body:

```ts
      onShapeBom: (
        documentId: string,
        versionId: string,
        elementId: string,
        configuration?: Record<string, string | number | boolean>
      ) =>
        generatePath(
          `${api}/integrations/onshape/d/${documentId}/v/${versionId}/e/${elementId}/bom${
            configuration && Object.keys(configuration).length > 0
              ? `?configuration=${encodeURIComponent(JSON.stringify(configuration))}`
              : ""
          }`
        ),
```

2. In the BOM route's `loader`, after `const onshapeClient = result.client;` and **before**
   the `try` block that calls `getBillOfMaterials`, resolve the configuration. Add this
   helper block:

```ts
  // The client sends the human-meaningful parameter MAP; the encoded string is built here
  // through Onshape's own encoder (parameter ids are generated and values need encoding
  // beyond URL-encoding, so it is never hand-assembled). An absent, empty, or
  // unparseable map means "default configuration" — byte-identical to the request Carbon
  // sent before this feature existed.
  let configuration: string | undefined;
  const rawConfiguration = new URL(request.url).searchParams.get(
    "configuration"
  );
  if (rawConfiguration) {
    try {
      const parameterMap = JSON.parse(rawConfiguration) as Record<
        string,
        string | number | boolean
      >;
      const parameters = Object.entries(parameterMap).map(
        ([parameterId, parameterValue]) => ({
          parameterId,
          parameterValue: String(parameterValue)
        })
      );
      if (parameters.length > 0) {
        const encoded = await onshapeClient.encodeConfiguration(
          did,
          eid,
          parameters,
          vid
        );
        configuration = encoded.encodedId;
      }
    } catch (error) {
      logger.error("Failed to encode Onshape configuration for BOM", { error });
      return {
        data: [],
        error: "Failed to encode the selected configuration"
      };
    }
  }
```

   Note the asymmetry with Task 3 and it is deliberate: **detection** failing is silent,
   but **encoding** failing is a visible error. If the user picked a configuration and
   Carbon cannot honor it, returning the default configuration's BOM would be a silently
   wrong import — precisely the bug this feature exists to fix.

3. Change the call to pass it:

```ts
    const response = await onshapeClient.getBillOfMaterials(did, vid, eid, {
      configuration
    });
```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0
grep -n "encodeConfiguration" "apps/erp/app/routes/api+/integrations.onshape.d.\$did.v.\$vid.e.\$eid.bom.ts"
# Expected: one match
```

**Out of scope:** Do not change the row-flattening logic, the `itemsMap` lookup, the
`Purchasing Level` defaulting, or `includeItemMicroversions` (the spec fixes it at `false`).
If the flattener appears to need per-child configuration data, STOP and report — that is
research §7.2 and is explicitly out of scope.

---

## Task 5: Persist the configuration on sync

**Depends on:** Task 2

**Files:**
- Modify: `apps/erp/app/routes/api+/integrations.onshape.sync.ts`
- Copy from (precedent): the file's own existing `externalIntegrationMapping` insert
  (lines ~66-84)

**Steps:**

1. Read the parameter map from the form data alongside the existing fields:

```ts
  const configuration = formData.get("configuration");
```

2. Inside the existing `try` block, after `const serviceRole = await getCarbonServiceRole();`
   and before the `serviceRole.functions.invoke("sync", …)` call, resolve both persisted
   forms:

```ts
    // Persist BOTH forms. The encoded string is what re-runs Onshape API calls; the
    // parameter map is what re-hydrates the picker on reopen — which is the whole reason
    // v1 needs no decodeConfiguration endpoint. Encoding failure here is non-fatal: the
    // BOM has already been fetched and reviewed by the user, so losing the audit trail is
    // strictly better than losing the import.
    let configurationParameters:
      | Record<string, string | number | boolean>
      | undefined;
    let encodedConfiguration: string | undefined;
    if (typeof configuration === "string" && configuration.length > 0) {
      try {
        configurationParameters = JSON.parse(configuration);
        const parameters = Object.entries(configurationParameters ?? {}).map(
          ([parameterId, parameterValue]) => ({
            parameterId,
            parameterValue: String(parameterValue)
          })
        );
        if (parameters.length > 0) {
          const onshape = await getOnshapeClient(client, companyId, userId);
          if (onshape.client) {
            const encoded = await onshape.client.encodeConfiguration(
              documentId as string,
              elementId as string,
              parameters,
              versionId as string
            );
            encodedConfiguration = encoded.encodedId;
          }
        }
      } catch (error) {
        logger.error("Failed to encode Onshape configuration for mapping", {
          error
        });
      }
    }
```

   Add `import { getOnshapeClient } from "@carbon/ee/onshape";` to the file's imports
   (it currently imports only `onShapeDataValidator` from that module).

3. Extend the `externalIntegrationMapping` insert's `metadata` object. Both keys are
   conditional so an unconfigured sync writes exactly the three keys it writes today:

```ts
      metadata: {
        documentId: documentId as string,
        versionId: versionId as string,
        elementId: elementId as string,
        ...(encodedConfiguration
          ? { configuration: encodedConfiguration }
          : {}),
        ...(configurationParameters ? { configurationParameters } : {})
      },
```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0
grep -n "configurationParameters" "apps/erp/app/routes/api+/integrations.onshape.sync.ts"
# Expected: at least 3 matches (declaration, parse, metadata spread)
```

**Out of scope:** No migration — `externalIntegrationMapping.metadata` is `JSONB`
(`packages/database/supabase/migrations/20260128140000_external-integration-mapping.sql:20`).
Do NOT run `pnpm run generate:types`; nothing about the schema changed. Do not change the
`delete`-then-`insert` mapping upsert pattern.

---

## Task 6: Render the configuration controls in `OnshapeSync`

**Depends on:** Tasks 3, 4, 5

**Files:**
- Modify: `apps/erp/app/components/OnshapeSync.tsx` (the component's only call site is
  `apps/erp/app/modules/items/ui/Item/BoMExplorer.tsx:160` — that file needs **no** change)
- Copy from (precedent — type-switched control rendering):
  `apps/erp/app/modules/workflows/ui/Builder/fields/LiteralControl.tsx` — its `string`
  branch (lines 110-124, `Input`), `number` branch (lines 126-156,
  `NumberField`/`NumberInputGroup`/`NumberInput`/`NumberInputStepper`), and `boolean` branch
  (lines 158-168, `Switch`). Copy the composition of these controls verbatim; only the
  value plumbing differs.
- Copy from (precedent — the panel row layout): the existing Document/Version/Assembly rows
  in `OnshapeSync.tsx` itself (`flex w-full items-center justify-between gap-2`, label in a
  `text-xs text-muted-foreground` span, control in a `w-[180px]` div)

**Steps:**

1. Add the fetcher next to the three existing ones:

```tsx
  const configurationFetcher = useFetcher<{
    data: { parameters: OnshapeConfigurationParameter[] };
    error: null;
  }>({});
```

   Import the type: `import type { OnshapeConfigurationParameter } from "@carbon/ee/onshape";`

2. Load it on element change, mirroring the existing `elementsFetcher` effect exactly
   (including the `biome-ignore lint/correctness/useExhaustiveDependencies` comment the
   sibling effects carry):

```tsx
  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (documentId && versionId && elementId && !isDisabled && initialized) {
      configurationFetcher.load(
        path.to.api.onShapeElementConfiguration(documentId, versionId, elementId)
      );
    }
  }, [documentId, versionId, elementId, initialized]);
```

3. Add the value state and derive the parameter list:

```tsx
  const [configurationValues, setConfigurationValues] = useState<
    Record<string, string | number | boolean>
  >({});

  const configurationParameters = useMemo(
    () => configurationFetcher.data?.data?.parameters ?? [],
    [configurationFetcher.data]
  );
```

4. Seed the values from Onshape's defaults whenever a new parameter set arrives. This
   **must** be an effect keyed on the fetched parameters, not a `useState` initializer —
   `.ai/lessons.md` ("Seeding useState from a prop goes stale…"): the component does not
   remount when the user picks a different assembly, so a once-seeded state would carry the
   previous element's values into the new one.

```tsx
  // Re-seeded on every parameter set, so switching assemblies resets to the NEW element's
  // defaults rather than carrying the previous element's values across. Seeding this once
  // would leave stale values behind — the component never remounts between elements.
  useEffect(() => {
    const defaults: Record<string, string | number | boolean> = {};
    for (const parameter of configurationParameters) {
      switch (parameter.parameterType) {
        case "ENUM":
          defaults[parameter.parameterId] =
            parameter.defaultValue ?? parameter.options?.[0]?.option ?? "";
          break;
        case "BOOLEAN":
          defaults[parameter.parameterId] = parameter.defaultValue ?? false;
          break;
        case "QUANTITY":
          defaults[parameter.parameterId] =
            parameter.rangeAndDefault?.defaultValue ?? 0;
          break;
        case "STRING":
          defaults[parameter.parameterId] = parameter.defaultValue ?? "";
          break;
      }
    }
    setConfigurationValues(defaults);
  }, [configurationParameters]);
```

5. Restore a previously-synced configuration in the existing `useMount` block, alongside
   the `documentId`/`versionId`/`elementId` reads. Add a `savedConfiguration` state and
   apply it in the seeding effect **after** the defaults, so a saved value wins but a
   parameter the saved map does not mention still gets its default:

```tsx
  const [savedConfiguration, setSavedConfiguration] = useState<Record<
    string,
    string | number | boolean
  > | null>(null);
```

   In `useMount`'s `.then(({ data }) => { … })`:
```tsx
        setSavedConfiguration(
          (metadata?.configurationParameters as Record<
            string,
            string | number | boolean
          > | null) ?? null
        );
```

   And at the end of the seeding effect from step 4, before `setConfigurationValues`:
```tsx
    // A saved map wins over the defaults, but only for parameters that still exist —
    // the element's configuration may have changed in Onshape since the last sync.
    if (savedConfiguration) {
      for (const parameter of configurationParameters) {
        const saved = savedConfiguration[parameter.parameterId];
        if (saved !== undefined) defaults[parameter.parameterId] = saved;
      }
    }
```
   Add `savedConfiguration` to that effect's dependency array.

6. Render the controls inside the existing `disclosure.isOpen && (<>…</>)` block, **after**
   the Assembly row and before the closing fragment. Guard on
   `configurationParameters.length > 0` — an unconfigured assembly renders nothing at all:
   no header, no empty state, no placeholder.

   Each row copies the existing three rows' layout. Per `parameterType`:
   - `ENUM` → `Combobox` with `options={parameter.options.map((o) => ({ value: o.option, label: o.optionName }))}`
   - `BOOLEAN` → `Switch` (`checked` / `onCheckedChange`)
   - `QUANTITY` → `NumberField` + `NumberInputGroup` + `NumberInput` + `NumberInputStepper`,
     with `minValue={parameter.rangeAndDefault?.minValue}` and
     `maxValue={parameter.rangeAndDefault?.maxValue}`. **Do not pass `step`** and **do not
     pass `formatOptions`** — an Onshape quantity has an externally-defined range, and
     `.claude/rules/numeric-precision.md` permits omitting `step`; a bare `NumberField`
     defaults to the quantity kind. Show `parameter.rangeAndDefault?.units` as a plain text
     suffix next to the field, not as a format option.
   - `STRING` → `Input` (`value` / `onChange={(e) => …e.target.value}`)

   The label for every row is `{parameter.parameterName}` — Onshape's own display name, so
   it is NOT wrapped in `<Trans>` (it is data, not UI copy). Every control gets
   `disabled`/`isDisabled` from the existing `isDisabled` prop, matching the three rows above.

7. Pass the values through both submit paths:

```tsx
  const loadBom = () => {
    if (isReadyForSync) {
      bomFetcher.load(
        path.to.api.onShapeBom(
          documentId,
          versionId,
          elementId,
          configurationValues
        )
      );
    }
  };
```

   and in `saveBom`, alongside the existing `formData.append` calls:
```tsx
    formData.append("configuration", JSON.stringify(configurationValues));
```

8. Leave `isReadyForSync` **unchanged**. Configuration is always optional and always has
   defaults, so it can never gate the Sync button.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0
pnpm run lint
# Expected: no new Biome errors in OnshapeSync.tsx
```

**Out of scope:** Do not convert `OnshapeSync` to a `ValidatedForm` — it is a fetcher-driven
panel and the twin-`ValidatedForm` hydration trap in `.ai/lessons.md` is a reason not to add
one gratuitously. Do not touch `BoMExplorer.tsx`. Do not add a "Configuration" section
header or any empty state. If `@carbon/ee/onshape` types are not importable from the ERP
client bundle, STOP and report — do not duplicate the type by hand.

---

## Task 7: Extract and fill i18n strings

**Depends on:** Task 6

**Files:**
- Modify: `packages/locale/locales/*/*.po` (generated — do not hand-edit)

**Steps:**

1. Run the repo's translate pipeline, which extracts new strings and fills empty `msgstr`
   entries via the `/translate` skill's Haiku fan-out:

```bash
pnpm run translate
```

2. Confirm no empty `msgstr` entries remain for the new strings.

**Verify:**
```bash
pnpm run lingui:extract
# Expected: completes; the summary table shows 0 missing for every locale
```

**Out of scope:** Do not add new locales. Do not hand-edit `.po` files. Onshape's
`parameterName` values are data, not UI copy — they must NOT appear in the catalogs.

---

## Task 8: Browser-verify the feature

**Depends on:** Task 7

**Files:** none (verification only)

**Steps:**

1. Confirm a dev stack is running (`crbn up`). If it is not, or if the local company has no
   connected Onshape integration, **STOP and report** — this task needs a real Onshape OAuth
   connection and cannot be faked.
2. Invoke `/test` scoped to this branch's diff, covering the spec's acceptance criteria:
   - an **unconfigured** assembly renders no configuration controls and syncs as before;
   - a **configured** assembly renders one control per parameter, prefilled with Onshape's
     defaults;
   - changing a value and pressing Sync returns a BOM that differs from the default's;
   - after Save, reopening the panel restores the chosen values;
   - switching to a different assembly resets the controls.
3. Record the outcome in `.ai/runs/2026-08-26-onshape-configuration-import.md`.

**Verify:**
```bash
ls .ai/playbooks/ | grep -i onshape
# Expected: a cached playbook for this flow, written by /test on success
```

**Out of scope:** Do not mock the Onshape API to make this pass. If no Onshape tenant is
reachable, report the tasks as code-complete-but-unverified rather than claiming a green
browser check — `AGENTS.md`: evidence before assertions.

---

## Task 9 (Phase 2, separable): Surface `configuration` on released revisions

**Depends on:** none (independent of Tasks 1–8; may be dropped without affecting them)

**Files:**
- Modify: `packages/ee/src/onshape/lib/client.ts` — one field on `OnshapeRevision`
- Modify: `packages/jobs/src/inngest/functions/integrations/onshape-revision-sync.ts` —
  new skip reason
- Modify: `packages/jobs/src/inngest/functions/integrations/onshape-matching.test.ts` —
  cover it
- Copy from (precedent): the existing `skippedReason` union and its `ambiguous-item` branch
  in `onshape-revision-sync.ts` (lines ~50-58 for the union, ~142-145 for a skip return)

**Steps:**

1. Add the field to `OnshapeRevision`, with the reason it matters:

```ts
  // The configuration this revision was released at. Two configurations released under the
  // SAME part number collapse onto one releaseKey(partNumber, revision), match the same
  // Carbon item, and the attach helper's replace-not-append rule makes it last-writer-wins
  // — a silent geometry overwrite. Carrying the field is what makes that detectable.
  configuration?: string | null;
```

2. In `runOnshapeRevisionSync`, add `"ambiguous-configuration"` to the `skippedReason`
   union. After `releasedRevision` is resolved and before the element-type branches, detect
   the collision: if `releasedRevision.configuration` is a non-empty string **and** more
   than one entry in `revisionList` shares this revision's `partNumber` + `revision` with a
   *different* non-empty `configuration`, return
   `{ synced: false, skippedReason: "ambiguous-configuration", releaseKey: releaseKey(input.partNumber, revision) }`
   and `console.warn` with the part number, revision, and the competing configuration
   strings.

   A single configured revision with no competitor is **not** ambiguous and must sync
   normally — this guard exists to stop a silent overwrite, not to refuse configured CAD.

3. Add a unit test to `onshape-matching.test.ts` covering: two revisions, same part number,
   same revision letter, different non-empty `configuration` → the collision predicate
   returns true; the same pair with identical configurations, or with only one revision →
   false. Extract the predicate as a pure exported helper in `onshape-matching.ts` (that
   file exists precisely to hold "pure helpers that form the Onshape→Carbon matching
   contract… kept free of heavy imports so they stay unit-testable").

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- onshape-matching
# Expected: all tests pass, including the new collision cases
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs
# Expected: exits 0
```

**Out of scope:** Do **not** pass a configuration into the translation calls or attempt a
configured thumbnail in this task. The configured thumbnail has no version-scoped endpoint
(the substitute is `assemblies/…/v/{vid}/…/shadedviews?configuration=…`, which returns
base64 rather than a raw PNG and needs its own code path), and exporting configured
geometry is a behavior change to the release pipeline that needs its own spec. This task
makes the collision **visible**, nothing more.
