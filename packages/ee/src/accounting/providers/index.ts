import type { QboProvider } from "./quickbooks-online";
import type { RilletProvider } from "./rillet";
import type { XeroProvider } from "./xero";

export type AccountingProvider = XeroProvider | QboProvider | RilletProvider;

export * from "./quickbooks-online";
export * from "./rillet";
export * from "./xero";
