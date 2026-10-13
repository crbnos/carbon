// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  getDatabaseErrorMessage,
  isForeignKeyViolation,
  isUniqueViolation
} from "./errors";

describe("isUniqueViolation / isForeignKeyViolation", () => {
  it("reads the SQLSTATE code off the error", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isForeignKeyViolation({ code: "23503" })).toBe(true);
    expect(isForeignKeyViolation({ code: "23505" })).toBe(false);
  });

  it("is false for anything without that code", () => {
    for (const error of [null, undefined, "23505", {}, new Error("23505")]) {
      expect(isUniqueViolation(error)).toBe(false);
      expect(isForeignKeyViolation(error)).toBe(false);
    }
  });

  it("does not read the message text", () => {
    const error = { message: "duplicate key value violates unique constraint" };
    expect(isUniqueViolation(error)).toBe(false);
  });
});

describe("getDatabaseErrorMessage", () => {
  const messages = { duplicate: "Already exists", referenced: "Still in use" };

  it("picks the caller's message for the refused constraint", () => {
    expect(getDatabaseErrorMessage({ code: "23505" }, "Failed", messages)).toBe(
      "Already exists"
    );
    expect(getDatabaseErrorMessage({ code: "23503" }, "Failed", messages)).toBe(
      "Still in use"
    );
  });

  it("falls back for any other error, and for a constraint the caller did not name", () => {
    expect(getDatabaseErrorMessage({ code: "42501" }, "Failed", messages)).toBe(
      "Failed"
    );
    expect(getDatabaseErrorMessage(null, "Failed", messages)).toBe("Failed");
    expect(
      getDatabaseErrorMessage({ code: "23505" }, "Failed", {
        referenced: "Still in use"
      })
    ).toBe("Failed");
  });
});
