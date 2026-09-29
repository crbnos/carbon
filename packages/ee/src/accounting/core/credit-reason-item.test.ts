import { describe, expect, it, vi } from "vitest";
import {
  CREDIT_REASON_ITEM_ENTITY_TYPE,
  resolveCreditReasonItem
} from "./credit-reason-item";
import type { ExternalIntegrationMappingService } from "./external-mapping";

/**
 * Minimal in-memory stand-in for the mapping service: only the two methods the
 * resolver touches, backed by a Map so a `link` is visible to the next
 * `getExternalId` (which is what the reuse case actually proves).
 */
function makeMapping(seed: Record<string, string> = {}) {
  const rows = new Map<string, string>(Object.entries(seed));
  const key = (entityType: string, entityId: string, integration: string) =>
    `${entityType}::${entityId}::${integration}`;

  const getExternalId = vi.fn(
    async (entityType: string, entityId: string, integration: string) =>
      rows.get(key(entityType, entityId, integration)) ?? null
  );
  const link = vi.fn(
    async (
      entityType: string,
      entityId: string,
      integration: string,
      externalId: string
    ) => {
      rows.set(key(entityType, entityId, integration), externalId);
    }
  );

  return {
    service: {
      getExternalId,
      link
    } as unknown as ExternalIntegrationMappingService,
    getExternalId,
    link,
    rows,
    key
  };
}

describe("resolveCreditReasonItem", () => {
  it("returns the mapped item without creating one", async () => {
    const m = makeMapping({
      [`${CREDIT_REASON_ITEM_ENTITY_TYPE}::acc_returns::rillet`]:
        "prod_existing"
    });
    const createItem = vi.fn(async () => "prod_SHOULD_NOT_BE_CALLED");

    const id = await resolveCreditReasonItem({
      mapping: m.service,
      integration: "rillet",
      accountId: "acc_returns",
      createItem
    });

    expect(id).toBe("prod_existing");
    expect(createItem).toHaveBeenCalledTimes(0);
    expect(m.link).toHaveBeenCalledTimes(0);
  });

  it("creates and maps the item on a miss", async () => {
    const m = makeMapping();
    const createItem = vi.fn(async () => "prod_new");

    const id = await resolveCreditReasonItem({
      mapping: m.service,
      integration: "quickbooks-online",
      accountId: "acc_allowances",
      createItem
    });

    expect(id).toBe("prod_new");
    expect(createItem).toHaveBeenCalledTimes(1);
    expect(createItem).toHaveBeenCalledWith("acc_allowances");
    expect(m.link).toHaveBeenCalledWith(
      CREDIT_REASON_ITEM_ENTITY_TYPE,
      "acc_allowances",
      "quickbooks-online",
      "prod_new"
    );
  });

  it("reuses the mapping on a second resolve — never a duplicate item", async () => {
    const m = makeMapping();
    const createItem = vi.fn(async () => "prod_once");

    const first = await resolveCreditReasonItem({
      mapping: m.service,
      integration: "rillet",
      accountId: "acc_returns",
      createItem
    });
    const second = await resolveCreditReasonItem({
      mapping: m.service,
      integration: "rillet",
      accountId: "acc_returns",
      createItem
    });

    expect(first).toBe("prod_once");
    expect(second).toBe("prod_once");
    // The whole point: product-list pollution is bounded by reason account,
    // not by memo count.
    expect(createItem).toHaveBeenCalledTimes(1);
  });

  it("keys per provider — the same account maps separately on each", async () => {
    const m = makeMapping();
    const createItem = vi.fn(async (accountId: string) => `item_${accountId}`);

    await resolveCreditReasonItem({
      mapping: m.service,
      integration: "rillet",
      accountId: "acc_returns",
      createItem
    });
    await resolveCreditReasonItem({
      mapping: m.service,
      integration: "xero",
      accountId: "acc_returns",
      createItem
    });

    expect(createItem).toHaveBeenCalledTimes(2);
  });
});
