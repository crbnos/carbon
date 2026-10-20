# Onshape V2 gets its own OAuth client

The sync integration (`onshape`) and the panel (`onshape-v2`) are separate Onshape apps. Today both read `ONSHAPE_CLIENT_ID` / `ONSHAPE_CLIENT_SECRET`; only the redirect URL differs. After this change they share no variable.

## Variables

| Integration | Client id | Client secret | Redirect URL |
| --- | --- | --- | --- |
| `onshape` (sync) | `ONSHAPE_CLIENT_ID` | `ONSHAPE_CLIENT_SECRET` | `ONSHAPE_OAUTH_REDIRECT_URL` |
| `onshape-v2` (panel) | `ONSHAPE_V2_CLIENT_ID` (new) | `ONSHAPE_V2_CLIENT_SECRET` (new) | `ONSHAPE_V2_OAUTH_REDIRECT_URL` |
| `onshape-government` | integration settings | integration settings (Vault) | derived from `getAppUrl()` |

- The sync integration keeps its names, so deployments that already set them are unchanged.
- `ONSHAPE_V2_CLIENT_ID` is public (`browser: true`) like `ONSHAPE_CLIENT_ID`: `config-v2.tsx` is client-bundled and gates the card on it.
- `ONSHAPE_DEV_CACHE` stays one local-dev switch; it is not app configuration.

## Steps

- [x] `packages/env/src/schema.ts`: new group `onshapeV2` (feature label "Onshape V2"); `ONSHAPE_V2_CLIENT_ID` (`browser`, `needed`), `ONSHAPE_V2_CLIENT_SECRET` (`secret`, `needed`); move `ONSHAPE_V2_OAUTH_REDIRECT_URL` into it. Then the startup report does not call a deployment with one integration half-configured.
- [x] `packages/env/src/index.ts`: export both; add `ONSHAPE_V2_CLIENT_ID` to `getBrowserEnv()`; fix the "same Onshape app" comment.
- [x] `apps/erp/app/root.tsx`: add `ONSHAPE_V2_CLIENT_ID` to the root loader's `env`.
- [x] `packages/ee/src/onshape/lib/oauth.ts`: `getOnshapeOAuthConfig` takes client id, secret and redirect per integration id; unconfigured when any of the three is missing.
- [x] `packages/ee/src/onshape/config-v2.tsx`: `active: !!ONSHAPE_V2_CLIENT_ID`.
- [x] `packages/ee/src/onshape/lib/oauth.test.ts`: the panel uses its own client; each integration is unconfigured when only the other's variables are set.
- [x] `sst.config.ts`: add the two variables to the ERP service.
- [x] `ci/src/deploy.ts`: `onshape_v2_client_id`, `onshape_v2_client_secret` on `Workspace`, the destructure and the ERP env. The `workspaces` table needs these columns (with `onshape_v2_oauth_redirect_url`); that table is outside this repo.
- [x] Docs: `docs/content/docs/integrations/cad.mdx` setup becomes two Onshape apps (sync: one redirect URI; panel: one redirect URI plus the Element right panel extension); `docs/content/docs/platform/self-hosting/environment-variables.mdx`.
- [x] Rules and guides: `.claude/rules/onshape-panel.md` (OAuth bullet), `.claude/rules/environment-configuration.md`, `packages/ee/AGENTS.md`. The comment in `packages/ee/src/onshape/lib/connection.ts` names only the sync connections, so it stays as it is.
- [x] Verify: `@carbon/ee` and `@carbon/env` tests, typecheck `erp` and `@carbon/ee`, Biome on changed files.

## Not in this change

- `packages/env/src/vercel-production.json` records what Vercel holds. Add the new names to it when someone adds them in Vercel.
- The MES service in `sst.config.ts` already carries Onshape variables it does not use. This change does not touch them.
- Token refresh still refuses without the redirect URL variable (`getOnshapeOAuthConfig`); separate fix.
- The Redis API-call counter `onshape:api-calls:<year>` still counts every Onshape app together; separate fix.

## Effect on existing connections

A connection's refresh token belongs to the app that issued it. A panel connection made with the shared client keeps working only if `ONSHAPE_V2_CLIENT_*` hold that same client; otherwise it must reconnect. Production has no panel connections yet.
