// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  API_PREFIX,
  API_VERSION,
  authCodeResponse,
  authMfaRequest,
  authVerifyRequest,
  compareAppVersion,
  consolePinInResponse,
  consolePinOutResponse,
  consoleTerminalResponse,
  HEADERS,
  meResponse,
  operationsQuery,
  pickingListDetail,
  pickingScreen,
  pickingTrackedOptions,
  serverSpeaksApiVersion,
  timecardScreen
} from "./contract";
import { pinInBody } from "./models";

describe("compareAppVersion", () => {
  it("compares numerically, not lexicographically", () => {
    expect(compareAppVersion("1.2.0", "1.10.0")).toBe(-1);
    expect(compareAppVersion("1.10.0", "1.2.0")).toBe(1);
  });

  it("treats missing parts as zero", () => {
    expect(compareAppVersion("1.0", "1.0.0")).toBe(0);
    expect(compareAppVersion("2", "1.9.9")).toBe(1);
  });

  it("treats a non-numeric part as zero rather than NaN", () => {
    expect(compareAppVersion("1.0.0-beta", "1.0.0")).toBe(0);
  });
});

describe("serverSpeaksApiVersion", () => {
  it("accepts a header listing this version", () => {
    expect(serverSpeaksApiVersion("1")).toBe(true);
    expect(serverSpeaksApiVersion("1, 2")).toBe(true);
  });

  it("refuses a missing header or one without this version", () => {
    expect(serverSpeaksApiVersion(null)).toBe(false);
    expect(serverSpeaksApiVersion("2")).toBe(false);
  });
});

describe("constants", () => {
  it("pins the prefix and the header names the server sets", () => {
    expect(API_PREFIX).toBe("/api/v1");
    expect(API_VERSION).toBe(1);
    expect(HEADERS.company).toBe("x-carbon-company");
    expect(HEADERS.idempotencyKey).toBe("idempotency-key");
    expect(HEADERS.apiVersions).toBe("carbon-api");
  });
});

describe("auth schemas", () => {
  it("requires exactly six digits for a code", () => {
    expect(
      authVerifyRequest.safeParse({ email: "a@b.co", code: "123456" }).success
    ).toBe(true);
    expect(
      authVerifyRequest.safeParse({ email: "a@b.co", code: "12345" }).success
    ).toBe(false);
    expect(
      authVerifyRequest.safeParse({ email: "not-an-email", code: "123456" })
        .success
    ).toBe(false);
  });

  it("requires BOTH tokens for the TOTP challenge", () => {
    const ok = authMfaRequest.safeParse({
      accessToken: "a",
      refreshToken: "r",
      code: "123456"
    });
    expect(ok.success).toBe(true);
    expect(
      authMfaRequest.safeParse({ accessToken: "a", code: "123456" }).success
    ).toBe(false);
  });

  it("allows the review-account password hint but nothing else", () => {
    expect(authCodeResponse.safeParse({ ok: true }).success).toBe(true);
    expect(
      authCodeResponse.safeParse({ ok: true, method: "password" }).success
    ).toBe(true);
    expect(
      authCodeResponse.safeParse({ ok: true, method: "magic-link" }).success
    ).toBe(false);
  });
});

describe("meResponse", () => {
  const valid = {
    instance: {
      name: "localhost",
      supabaseUrl: "http://localhost:54321",
      supabaseAnonKey: "anon",
      mode: "connected",
      controlledEnvironment: false,
      idleLockMs: 900000,
      minAppVersion: "1.0.0",
      analytics: null
    },
    user: { id: "u1", email: "a@b.co", name: "Op", avatarUrl: null },
    companies: [{ id: "c1", name: "Acme" }],
    locations: [{ id: "l1", name: "Plant", companyId: "c1" }],
    defaultLocationId: "l1",
    workCenters: [{ id: "w1", name: "Assembly 2", locationId: "l1" }],
    consoleAvailable: true,
    permissions: {
      production: { view: true, create: true, update: true },
      inventory: { view: true, update: true },
      quality: { create: false },
      settings: { update: false }
    }
  };

  it("parses a complete payload", () => {
    expect(meResponse.safeParse(valid).success).toBe(true);
  });

  it("refuses a deployment mode it does not know", () => {
    const bad = {
      ...valid,
      instance: { ...valid.instance, mode: "cloud" }
    };
    expect(meResponse.safeParse(bad).success).toBe(false);
  });

  it("refuses a non-URL supabaseUrl", () => {
    const bad = {
      ...valid,
      instance: { ...valid.instance, supabaseUrl: "localhost:54321" }
    };
    expect(meResponse.safeParse(bad).success).toBe(false);
  });
});

describe("operationsQuery", () => {
  it("defaults both lists to empty", () => {
    expect(operationsQuery.parse({})).toEqual({
      workCenterIds: [],
      filter: []
    });
  });
});

describe("pickingScreen", () => {
  it("parses a list the `pickingLists` view returns with its aggregates", () => {
    const parsed = pickingScreen.safeParse({
      pickingLists: [
        {
          id: "pl_1",
          pickingListId: "PL000012",
          status: "In Progress",
          locationId: "loc_1",
          locationName: "Plant 1",
          dueDate: "2026-10-05",
          lineCount: 4,
          completedLineCount: 1,
          assignee: "user_1"
        }
      ]
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts the nullable columns the view declares", () => {
    expect(
      pickingScreen.safeParse({
        pickingLists: [
          { id: "pl_1", dueDate: null, locationName: null, status: null }
        ]
      }).success
    ).toBe(true);
  });

  it("refuses a status outside `pickingListStatus`", () => {
    expect(
      pickingScreen.safeParse({
        pickingLists: [{ id: "pl_1", status: "Reopened" }]
      }).success
    ).toBe(false);
  });
});

describe("pickingListDetail", () => {
  const valid = {
    pickingList: {
      id: "pl_1",
      pickingListId: "PL000012",
      status: "In Progress",
      locationId: "loc_1",
      lines: [
        {
          id: "pll_1",
          itemId: "item_1",
          pickingListId: "pl_1",
          jobOperationId: "jo_1",
          quantityToPick: 4,
          quantityPicked: 1,
          quantityReturned: 0,
          status: "Pending",
          storageUnitId: "su_1",
          toStorageUnitId: "su_line",
          availableQuantity: 9,
          item: {
            name: "Bracket",
            readableId: "BRK-100",
            unitOfMeasureCode: "EA"
          },
          trackedEntities: [
            { trackedEntityId: "te_1", quantity: 1, quantityPicked: 1 }
          ]
        }
      ]
    },
    recommendations: {
      pll_1: [{ trackedEntityId: "te_2", readableId: "LOT-2" }]
    }
  };

  it("parses a list with its lines and resolved recommendations", () => {
    expect(pickingListDetail.safeParse(valid).success).toBe(true);
  });

  it("accepts an untracked list — no lots to recommend, no lots picked", () => {
    expect(
      pickingListDetail.safeParse({
        pickingList: {
          id: "pl_1",
          lines: [
            {
              id: "pll_1",
              itemId: "item_1",
              quantityToPick: 4,
              quantityPicked: 0,
              item: null
            }
          ]
        },
        recommendations: {}
      }).success
    ).toBe(true);
  });

  it("refuses a line status outside `pickingListLineStatus`", () => {
    const bad = structuredClone(valid);
    (bad.pickingList.lines[0] as { status: string }).status = "Staged";
    expect(pickingListDetail.safeParse(bad).success).toBe(false);
  });
});

describe("pickingTrackedOptions", () => {
  const valid = {
    entities: [
      {
        trackedEntityId: "te_1",
        readableId: "LOT-1",
        availableQuantity: 12,
        storageUnitId: "su_1",
        storageUnitName: "A-01",
        expirationDate: "2027-01-31",
        status: "Available",
        createdAt: "2026-09-01T00:00:00.000Z"
      }
    ],
    trackingType: "Batch",
    quantityRequired: 3,
    nearExpiryWarningDays: 30,
    expiredEntityPolicy: "Warn",
    defaultOrder: "FEFO"
  };

  it("parses what `get_available_tracked_entities` returns", () => {
    expect(pickingTrackedOptions.safeParse(valid).success).toBe(true);
  });

  it("accepts an item with no lots at the location", () => {
    expect(
      pickingTrackedOptions.safeParse({ ...valid, entities: [] }).success
    ).toBe(true);
  });

  it("refuses a pick order or expiry policy it does not know", () => {
    expect(
      pickingTrackedOptions.safeParse({ ...valid, defaultOrder: "Smart" })
        .success
    ).toBe(false);
    expect(
      pickingTrackedOptions.safeParse({
        ...valid,
        expiredEntityPolicy: "Allow"
      }).success
    ).toBe(false);
  });
});

describe("timecardScreen", () => {
  const entry = {
    id: "tce_1",
    employeeId: "user_1",
    clockIn: "2026-09-28T13:00:00.000Z",
    clockOut: "2026-09-28T21:30:00.000Z",
    note: null
  };

  it("parses a finished week", () => {
    expect(
      timecardScreen.safeParse({
        entries: [entry],
        openEntry: null,
        weekOffset: -1,
        weekStart: "2026-09-21",
        weekEnd: "2026-09-27"
      }).success
    ).toBe(true);
  });

  it("accepts an open entry — a null clockOut IS the clocked-in signal", () => {
    expect(
      timecardScreen.safeParse({
        entries: [{ ...entry, clockOut: null }],
        openEntry: { ...entry, clockOut: null },
        weekOffset: 0,
        weekStart: "2026-09-28",
        weekEnd: "2026-10-04"
      }).success
    ).toBe(true);
  });

  it("refuses an entry with no clockIn — there is nothing to total", () => {
    expect(
      timecardScreen.safeParse({
        entries: [{ id: "tce_1", employeeId: "user_1", clockOut: null }],
        openEntry: null,
        weekOffset: 0,
        weekStart: "2026-09-28",
        weekEnd: "2026-10-04"
      }).success
    ).toBe(false);
  });
});

describe("console (shared tablet) responses", () => {
  it("pins the two header names the tokens travel in", () => {
    expect(HEADERS.terminal).toBe("x-carbon-terminal");
    expect(HEADERS.operator).toBe("x-carbon-operator");
  });

  it("accepts a minted terminal token", () => {
    expect(
      consoleTerminalResponse.safeParse({ terminalToken: "a.b.c" }).success
    ).toBe(true);
  });

  it("refuses an empty terminal token — the app would send a blank header", () => {
    expect(
      consoleTerminalResponse.safeParse({ terminalToken: "" }).success
    ).toBe(false);
  });

  it("accepts a pin-in with the operator the header will render", () => {
    expect(
      consolePinInResponse.safeParse({
        operatorToken: "a.b.c",
        operator: { userId: "user_2", name: "Op Two", avatarUrl: null },
        expiresAt: 1790935200000
      }).success
    ).toBe(true);
  });

  it("refuses a pin-in with no token or no operator to attribute work to", () => {
    expect(
      consolePinInResponse.safeParse({
        operatorToken: "",
        operator: { userId: "user_2", name: "Op Two", avatarUrl: null },
        expiresAt: 1790935200000
      }).success
    ).toBe(false);
    expect(
      consolePinInResponse.safeParse({
        operatorToken: "a.b.c",
        operator: { name: "Op Two", avatarUrl: null },
        expiresAt: 1790935200000
      }).success
    ).toBe(false);
  });

  it("never carries the PIN back out", () => {
    const parsed = consolePinInResponse.parse({
      operatorToken: "a.b.c",
      operator: { userId: "user_2", name: "Op Two", avatarUrl: null },
      expiresAt: 1790935200000,
      pin: "1234"
    });
    expect(parsed).not.toHaveProperty("pin");
  });

  it("pins pin-out as a plain acknowledgement", () => {
    expect(consolePinOutResponse.safeParse({ ok: true }).success).toBe(true);
    expect(consolePinOutResponse.safeParse({ ok: false }).success).toBe(false);
  });
});

describe("pinInBody", () => {
  it("accepts a 4-to-8 digit PIN", () => {
    expect(pinInBody.safeParse({ userId: "user_2", pin: "1234" }).success).toBe(
      true
    );
    expect(
      pinInBody.safeParse({ userId: "user_2", pin: "12345678" }).success
    ).toBe(true);
  });

  it("refuses anything that is not a bare PIN, so nothing odd reaches the verifier", () => {
    for (const pin of ["123", "123456789", "12a4", "", " 1234", "1234 "]) {
      expect(pinInBody.safeParse({ userId: "user_2", pin }).success).toBe(
        false
      );
    }
    expect(pinInBody.safeParse({ userId: "", pin: "1234" }).success).toBe(
      false
    );
  });
});
