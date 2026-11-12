# Onshape V2 Government: the panel through a customer-owned private app

Sibling: `onshape-government` (#1759, #1765) is to `onshape` what
`onshape-v2-government` is to `onshape-v2`. Onshape Government has no public App
Store, so the panel's app cannot be installed there; the customer's Enterprise
admin creates a private OAuth app with the panel extension and enters its client
in Carbon. Everything past authorization is the existing panel runtime.

## Decisions (mirroring the Government sync)

- New integration id `onshape-v2-government`: its own `companyIntegration` row,
  vaulted `clientSecret` and tokens, `baseUrl` and `clientId` in metadata.
  Always offered (`active: true`), `internalOnly` like `onshape-v2`.
- The panel's mapping namespace stays `onshape-v2` for both grants, as the sync
  keeps `onshape` for both: mappings name the source system, not the connection.
  Every `.eq("integration", ONSHAPE_V2_INTEGRATION_ID)` stays.
- A company holds one active panel connection at a time
  (`getConflictingOnshapePanelIntegration`), checked at save, authorization
  start and callback. The panel sits beside either sync connection, as today.
- Connecting is the settings save (as `onshape-government`): saving with no
  token, a changed URL or client ID, or a typed secret sends the admin to the
  tenant's consent screen. The save path's Government checks become a
  customer-owned-app set (`isOnshapeCustomerAppIntegrationId`).
- Panel reads resolve the company's active panel row
  (`getOnshapePanelIntegration`), as sync reads use `getOnshapeIntegration`.
  `getOnshapeClient(…, ONSHAPE_V2_INTEGRATION_ID)` resolves whichever panel row
  is active, so the panel routes and jobs keep passing the same id.
- Framing: the panel route also allows a `server` origin equal to the Onshape URL
  of an active `onshape-v2-government` connection, in `frame-ancestors` and for
  postMessage. Onshape does not publish the Government host format; when it is
  a `*.onshape.com` host this changes nothing.
- Open in Onshape on the item card uses the connection's `baseUrl`.

## Tasks

- [x] Migration: `integration` row `onshape-v2-government` (jsonschema = v2's keys
      plus `baseUrl`, `clientId` required).
- [x] `lib/integration-id.ts`: id, `ONSHAPE_PANEL_INTEGRATION_IDS`,
      `isOnshapePanelIntegrationId`, callback path.
- [x] `lib/connection.ts`: `getOnshapePanelIntegration`,
      `getConflictingOnshapePanelIntegration`, `getConflictingOnshapeConnection`
      and the customer-app id set. `lib/panel-origin.server.ts`:
      `getConfiguredOnshapePanelOrigin`.
- [x] `lib/oauth.ts`: customer-owned app branch for both Government ids.
- [x] `lib/client.ts`: panel id resolves the active panel row.
- [x] `lib/state.ts`, `integrations/secrets.ts`, `hooks.server.ts`,
      `index.ts`, `config-v2.tsx` (descriptor + setup instructions).
- [x] `oauth.server.ts` and `completeOnshapeAuthorization`: panel conflict.
- [x] `integrations.$id.tsx`: customer-owned app save path for both ids.
- [x] Callback route `api+/integrations.onshape-v2-government.oauth.ts`.
- [x] Panel row reads: `panel-plan-data.ts`, Fields route and save,
      `getOnshapePanelCompanies`, webhook route, `ExternalSource.tsx`.
- [x] Panel route: allowed Government origin.
- [x] Error copy, conformance id list.
- [x] Tests: the OAuth config of the Government panel, and the id sets.
- [x] Docs (`cad.mdx`, which the in-app agent also reads), rule
      `onshape-panel.md`, `packages/ee/AGENTS.md`, locale extract and
      translations.
- [x] Typecheck ee, erp, jobs; ee tests; checks; Biome.
- [x] Apply the migration on a local stack. Panel framing checked with curl:
      an active Government `baseUrl` is allowed; a trailing slash, another
      host, or the same row inactive is refused.
- [ ] Test the settings save and the consent against a private app on a commercial
      Enterprise, with `baseUrl` set to its tenant.

## Not verified

- No Onshape Government tenant was available. The consent, the extension in a
  Government Enterprise and the tenant domain are untested.
- The panel's company switcher lists every company with an active panel row.
  A company on another Onshape host reads no documents from this tenant.
