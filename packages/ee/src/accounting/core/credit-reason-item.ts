import type { ExternalIntegrationMappingService } from "./external-mapping";

/**
 * `externalIntegrationMapping.entityType` for the provider-side item a memo's
 * reason account is bound to.
 *
 * QBO and Rillet both refuse an account-coded AR credit line: a QBO `CreditMemo`
 * only accepts `SalesItemLine` (and an item-less line has its `Amount` SILENTLY
 * ignored), and a Rillet `/credit-memos` item requires a `product_id`. Both bind
 * the GL account to the item/product instead, so a customer credit needs one
 * provider-side item per reason account.
 *
 * That item is a PROVIDER-SIDE ARTIFACT ONLY. It is not a Carbon `item`, has no
 * `itemType`, and never appears in Carbon's UI — GL-mapping placeholders must not
 * leak into item lists, BOMs, inventory or MRP. This mirrors how the Ramp
 * integration creates provider-side coding objects keyed by `account.id`.
 *
 * Xero does not need any of this: its credit-note lines take an `AccountCode`
 * directly.
 */
export const CREDIT_REASON_ITEM_ENTITY_TYPE = "creditReasonItem";

/**
 * Resolve (or lazily create) the provider-side item bound to a memo's reason
 * account, keyed by the Carbon `account.id`.
 *
 * The mapping row is the ONLY lookup. Never query the provider to find an
 * existing item: Rillet's `GET /products` cannot filter on `external_references`,
 * so a provider-side search would either miss and duplicate, or require draining
 * every page.
 */
export async function resolveCreditReasonItem(args: {
  mapping: ExternalIntegrationMappingService;
  /** ProviderID — the `integration` column on the mapping row. */
  integration: string;
  /** Carbon `account.id` of the memo's reason account. */
  accountId: string;
  /** Creates the provider-side item and returns its remote id. Called at most once. */
  createItem: (accountId: string) => Promise<string>;
}): Promise<string> {
  const existing = await args.mapping.getExternalId(
    CREDIT_REASON_ITEM_ENTITY_TYPE,
    args.accountId,
    args.integration
  );
  if (existing) return existing;

  const externalId = await args.createItem(args.accountId);

  await args.mapping.link(
    CREDIT_REASON_ITEM_ENTITY_TYPE,
    args.accountId,
    args.integration,
    externalId
  );

  return externalId;
}
