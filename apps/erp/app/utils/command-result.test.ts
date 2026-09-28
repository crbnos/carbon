import { describe, expect, it } from "vitest";
import { SERVICE_RULE_ERROR_CODE } from "~/utils/supabase";
import { commandError, toToolResult } from "./command-result";

describe("commandError", () => {
  it("keeps the route's flash text and adds an application refusal's reason for API callers", () => {
    const { error } = commandError(
      "Failed to register asset",
      new Error("Asset is no longer in Draft status")
    );
    expect(error.flash).toBe("Failed to register asset");
    expect(error.message).toBe(
      "Failed to register asset: Asset is no longer in Draft status"
    );
  });

  it("never spells out a database error (it carries a code)", () => {
    const dbError = Object.assign(new Error('relation "x" violates …'), {
      code: "23503"
    });
    expect(
      commandError("Failed to post asset disposal", dbError).error
    ).toEqual(
      expect.objectContaining({ message: "Failed to post asset disposal" })
    );
    // A PostgREST error object is not an Error instance either.
    expect(
      commandError("Failed to get asset", { message: "JSON object requested" })
        .error.message
    ).toBe("Failed to get asset");
  });
});

describe("toToolResult", () => {
  it("returns a command failure as a rule error carrying only the message", () => {
    const result = toToolResult(
      commandError("Run is not in Draft status", { code: "PGRST116" })
    );
    expect(result).toEqual({
      data: null,
      error: {
        code: SERVICE_RULE_ERROR_CODE,
        message: "Run is not in Draft status"
      }
    });
  });

  it("passes data through on success", () => {
    expect(toToolResult({ data: { id: "a" }, error: null })).toEqual({
      data: { id: "a" },
      error: null
    });
  });
});
