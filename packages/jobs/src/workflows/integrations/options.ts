/** The two options providers integration actions name, and the input every one of
 * them depends on.
 *
 * These strings are the whole contract between the committed catalog and the app's
 * options registry (`apps/erp/app/modules/workflows/options-providers.server.ts`).
 * The builder never reads them — it forwards whatever `provider` an input names —
 * so adding a provider for Carbon's own data touches the registry and nothing here.
 */

/** Which of the company's connections the step acts as. Declared in `@carbon/workflows`
 * because the builder reads it too — it must know whether an app is connected before it
 * can offer any of that app's steps. */
export { INTEGRATION_CONNECTION_INPUT as CONNECTION_INPUT } from "@carbon/workflows";

/** Lists the company's connections for one piece. */
export const CONNECTION_PROVIDER = "integration.connection";

/** Runs one piece property's own `options()` against a chosen connection. */
export const PROPERTY_PROVIDER = "integration.property";
