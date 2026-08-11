import { IntegrationForm } from "./IntegrationForm";
import IntegrationsList from "./IntegrationsList";
import { QuickInstall } from "./QuickInstall";
import { SyncActivity } from "./SyncActivity";

// AccountMapping, PostingSyncSettings and DimensionMapping are deliberately
// NOT re-exported here: adding them to this barrel pushes unrelated supabase
// select-string parses (usePurchaseInvoiceAutoFill.ts, purchasing.service.ts)
// over TS2589's instantiation-depth limit — the same cliff SyncActivity's ee
// imports hit (see the note in SyncActivity.tsx). Their only consumer, the
// integrations.$id route, imports them directly from their files.
export { IntegrationForm, IntegrationsList, QuickInstall, SyncActivity };
