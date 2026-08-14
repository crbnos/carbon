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

  it("trims a trailing-space value and matches Rillet's trimmed store (production-event field failure)", async () => {
    // Carbon dimension labels can carry inconsistent whitespace ("Test " vs
    // "Test"); Rillet trims on write. POST must carry the trimmed name and the
    // match must be trim-tolerant, else the whole journal fails on a string miss
    // ("Test " is not on the returned field ...).
    const fieldWithTest = {
      ...DEPARTMENT_FIELD,
      values: [
        ...DEPARTMENT_FIELD.values,
        {
          id: "fv100000-0000-0000-0000-00000000000b",
          name: "Test",
          deactivated: false
        }
      ]
    };
    fetchMock.mockResolvedValueOnce(jsonResponse({ field: fieldWithTest }));

    const value = await makeProvider().upsertFieldValue(
      DEPARTMENT_FIELD.id,
      "Test "
    );

    expect(value.id).toBe("fv100000-0000-0000-0000-00000000000b");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      name: "Test"
    });
  });

  it("recovers across whitespace when Rillet 400s 'already exists' but stored the value trimmed", async () => {
    // A prior line created "Test " → Rillet stored "Test". This line upserts
    // "Test" → 400 already-exists; recovery must match the stored value by
    // trimmed name, not exact string.
    const fieldWithTest = {
      ...DEPARTMENT_FIELD,
      values: [
        ...DEPARTMENT_FIELD.values,
        {
          id: "fv100000-0000-0000-0000-00000000000c",
          name: "Test ",
          deactivated: false
        }
      ]
    };
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            title: "Bad Request",
            status: 400,
            detail: 'Value "Test" already exists.'
          },
          400
        )
      )
      .mockResolvedValueOnce(jsonResponse({ fields: [fieldWithTest] }));

    const value = await makeProvider().upsertFieldValue(
      DEPARTMENT_FIELD.id,
      "Test"
    );

    expect(value.id).toBe("fv100000-0000-0000-0000-00000000000c");
  });

  it("recovers the existing value's uuid when Rillet 400s 'already exists' (mapping lost / value seeded in Rillet)", async () => {
    // POST /fields/{id}/values rejects a name that already exists (Rillet is
    // NOT idempotent by name — the bill-sync failure in the field). The
    // recovery reads the value back by name via GET /fields.
    const fieldWithHeadquarters = {
      ...DEPARTMENT_FIELD,
      values: [
        ...DEPARTMENT_FIELD.values,
        {
          id: "fv100000-0000-0000-0000-00000000000a",
          name: "Headquarters",
          deactivated: false
        }
      ]
    };
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            title: "Bad Request",
            status: 400,
            detail: 'Value "Headquarters" already exists.'
          },
          400
        )
      )
      .mockResolvedValueOnce(jsonResponse({ fields: [fieldWithHeadquarters] }));

    const value = await makeProvider().upsertFieldValue(
      DEPARTMENT_FIELD.id,
      "Headquarters"
    );

    expect(value.id).toBe("fv100000-0000-0000-0000-00000000000a");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://api.rillet.com/fields"
    );
  });

  it("prefers a non-deactivated existing value when recovering by name", async () => {
    const fieldWithDupes = {
      ...DEPARTMENT_FIELD,
      values: [
        {
          id: "fv-deactivated",
          name: "Headquarters",
          deactivated: true
        },
        {
          id: "fv-active",
          name: "Headquarters",
          deactivated: false
        }
      ]
    };
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          { detail: 'Value "Headquarters" already exists.', status: 400 },
          400
        )
      )
      .mockResolvedValueOnce(jsonResponse({ fields: [fieldWithDupes] }));

    const value = await makeProvider().upsertFieldValue(
      DEPARTMENT_FIELD.id,
      "Headquarters"
    );

    expect(value.id).toBe("fv-active");
  });

  it("re-throws an 'already exists' 400 when the value cannot be recovered (contract drift)", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          { detail: 'Value "Headquarters" already exists.', status: 400 },
          400
        )
      )
      // GET /fields returns the field but WITHOUT the value — should not
      // swallow the error into a broken ref.
      .mockResolvedValueOnce(jsonResponse({ fields: [DEPARTMENT_FIELD] }));

    await expect(
      makeProvider().upsertFieldValue(DEPARTMENT_FIELD.id, "Headquarters")
    ).rejects.toBeInstanceOf(AccountingApiError);
  });

  it("re-throws a non-'already exists' 400 without attempting recovery", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: "Field not found.", status: 400 }, 400)
    );

    await expect(
      makeProvider().upsertFieldValue(DEPARTMENT_FIELD.id, "Headquarters")
    ).rejects.toBeInstanceOf(AccountingApiError);
    // Only the POST — no GET /fields recovery attempt.
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
