import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SYNC_CONFIG } from "../../../core/models";
import { AccountingApiError } from "../../../core/utils";
import {
  buildRilletFieldTarget,
  parseRilletFieldTarget,
  RILLET_API_VERSION,
  RilletProvider
} from "../provider";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function makeProvider() {
  return new RilletProvider({
    companyId: "company-1",
    credentials: {
      type: "apiKey",
      apiKey: "rillet-key",
      environment: "production"
    },
    syncConfig: DEFAULT_SYNC_CONFIG
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

// Verified v4 surface (spec changelog 2026-08-04): GET /fields returns
// { fields: [{ id, name, values: [{ id, name, deactivated }], settings,
// updated_at }] }; POST /fields/{id}/values { name } upserts by name and
// returns the FULL Field including the value's uuid.
const DEPARTMENT_FIELD = {
  id: "f1d10000-0000-0000-0000-000000000001",
  name: "Department",
  values: [
    {
      id: "fv100000-0000-0000-0000-000000000001",
      name: "Operations",
      deactivated: false
    }
  ],
  settings: { EXPENSES: { mandatory: false, display: "STANDALONE" } },
  updated_at: "2026-08-01T00:00:00.000Z"
};

describe("RilletProvider.listFields", () => {
  it("lists field definitions with their pick-list values", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ fields: [DEPARTMENT_FIELD] })
    );

    const fields = await makeProvider().listFields();

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.rillet.com/fields"
    );
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(headers["X-Rillet-API-Version"]).toBe(RILLET_API_VERSION);
    expect(fields).toEqual([DEPARTMENT_FIELD]);
  });

  it("defensively follows a cursor if the endpoint ever paginates", async () => {
    const secondField = { ...DEPARTMENT_FIELD, id: "f2", name: "Region" };
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          fields: [DEPARTMENT_FIELD],
          pagination: { next_cursor: "abc" }
        })
      )
      .mockResolvedValueOnce(jsonResponse({ fields: [secondField] }));

    const fields = await makeProvider().listFields();

    expect(fields.map((field) => field.id)).toEqual([
      DEPARTMENT_FIELD.id,
      "f2"
    ]);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://api.rillet.com/fields?cursor=abc"
    );
  });

  it("throws a structured error on API failure", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { type: "about:blank", title: "Server error", status: 500 },
        500
      )
    );

    await expect(makeProvider().listFields()).rejects.toBeInstanceOf(
      AccountingApiError
    );
  });
});

describe("RilletProvider.upsertFieldValue", () => {
  it("upserts a value BY NAME and extracts its uuid from the returned full Field", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        field: {
          ...DEPARTMENT_FIELD,
          values: [
            ...DEPARTMENT_FIELD.values,
            {
              id: "fv100000-0000-0000-0000-000000000002",
              name: "Engineering",
              deactivated: false
            }
          ]
        }
      })
    );

    const value = await makeProvider().upsertFieldValue(
      DEPARTMENT_FIELD.id,
      "Engineering"
    );

    expect(value.id).toBe("fv100000-0000-0000-0000-000000000002");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `https://api.rillet.com/fields/${DEPARTMENT_FIELD.id}/values`
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      name: "Engineering"
    });
  });

  it("reuses the EXISTING value uuid when the name is already on the field (upsert semantics)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ field: DEPARTMENT_FIELD }));

    const value = await makeProvider().upsertFieldValue(
      DEPARTMENT_FIELD.id,
      "Operations"
    );

    expect(value.id).toBe("fv100000-0000-0000-0000-000000000001");
  });

  it("accepts a bare (unwrapped) Field response body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(DEPARTMENT_FIELD));

    const value = await makeProvider().upsertFieldValue(
      DEPARTMENT_FIELD.id,
      "Operations"
    );
    expect(value.id).toBe("fv100000-0000-0000-0000-000000000001");
  });

  it("fails loudly when the upserted name is missing from the returned field (contract drift)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ field: DEPARTMENT_FIELD }));

    await expect(
      makeProvider().upsertFieldValue(DEPARTMENT_FIELD.id, "Not There")
    ).rejects.toThrowError(/not on the returned field/);
  });
});

describe("RilletProvider.journalDimensionTargets", () => {
  it("declares one field:<fieldId> target per Rillet Field", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ fields: [DEPARTMENT_FIELD] })
    );

    const targets = await makeProvider().journalDimensionTargets();
    expect(targets).toEqual([
      {
        id: `field:${DEPARTMENT_FIELD.id}`,
        label: "Department",
        capacity: 1
      }
    ]);
  });

  it("returns [] on failure (forgiving settings-surface contract)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ title: "Server error" }, 500)
    );
    await expect(makeProvider().journalDimensionTargets()).resolves.toEqual([]);
  });
});

describe("Rillet field targets", () => {
  it("builds and parses field:<fieldId> targets", () => {
    expect(buildRilletFieldTarget("f1")).toBe("field:f1");
    expect(parseRilletFieldTarget("field:f1")).toBe("f1");
    expect(parseRilletFieldTarget("class")).toBeNull();
    expect(parseRilletFieldTarget("field:")).toBeNull();
  });
});
