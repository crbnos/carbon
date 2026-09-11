import { describe, expect, it } from "vitest";
import { RampIntegrationMetadataSchema } from "../models";

// Minimal oauth2 credentials — the shape a fresh "Connect to Ramp" install stores.
const credentials = {
  type: "oauth2" as const,
  accessToken: "token",
  environment: "production" as const
};

describe("RampIntegrationMetadataSchema — flat sync flags → runtime sync", () => {
  it("defaults every family ON when no flat flags are present (fresh OAuth install)", () => {
    const parsed = RampIntegrationMetadataSchema.parse({ credentials });
    expect(parsed.sync).toEqual({
      pullTransactions: true,
      pullBills: true,
      pullReimbursements: true,
      pushPurchaseOrders: true,
      pushInvoices: true
    });
  });

  it('disables only the family whose flat flag is the string "false"', () => {
    const parsed = RampIntegrationMetadataSchema.parse({
      credentials,
      pushInvoices: "false",
      pushPurchaseOrders: "true"
    });
    expect(parsed.sync.pushInvoices).toBe(false);
    expect(parsed.sync.pushPurchaseOrders).toBe(true);
    // Unspecified families stay on.
    expect(parsed.sync.pullTransactions).toBe(true);
  });

  it("treats a boolean false the same as the string (defensive)", () => {
    const parsed = RampIntegrationMetadataSchema.parse({
      credentials,
      pullBills: false
    });
    expect(parsed.sync.pullBills).toBe(false);
  });
});
