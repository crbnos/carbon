/**
 * Avalara integration — shared substrate for US sales-tax determination (#1044)
 * and EU e-invoicing clearance (#1054).
 *
 * Consumers import the seam from here (`getAvalaraClient`,
 * `isAvalaraFeatureEnabled`) and never read `companyIntegration` directly. This
 * barrel pulls in `service.server.ts`, so it is a server-only import; the
 * browser-safe registry entry lives in `./config` and is re-exported from
 * `@carbon/ee` without going through this barrel.
 */
export {
  Avalara,
  type AvalaraSettings,
  AvalaraSettingsSchema
} from "./config";
export { AvataxApi } from "./lib/avatax";
export {
  AvalaraError,
  type AvalaraErrorKind,
  AvalaraHttp,
  type AvalaraHttpOptions,
  toAvalaraError
} from "./lib/client";
export { EinvoicingApi } from "./lib/einvoicing";
export type { Avalara as AvalaraTypes } from "./lib/types";
export {
  type AvalaraClientBundle,
  getAvalaraClient,
  getAvalaraConfig,
  isAvalaraConfigured,
  isAvalaraFeatureEnabled,
  listAvalaraCompanies
} from "./service.server";
