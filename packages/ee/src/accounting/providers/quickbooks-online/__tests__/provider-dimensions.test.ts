import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SYNC_CONFIG } from "../../../core/models";
import {
  QBO_DIMENSION_TARGET_CLASS,
  QBO_DIMENSION_TARGET_DEPARTMENT,
  QboProvider
} from "../provider";

const REALM_ID = "9130357849328710";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function faultResponse(): Response {
  return jsonResponse(
    {
      Fault: {
        Error: [
          {
            Message: "Feature Not Supported",
            Detail: "Class tracking is not enabled for this company.",
            code: "500"
          }
        ],
        type: "ValidationFault"
      }
    },
    400
  );
}

function makeProvider() {
  return new QboProvider({
    companyId: "company-1",
    clientId: "client-id",
    clientSecret: "client-secret",
    accessToken: "token",
    refreshToken: "refresh",
    realmId: REALM_ID,
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

describe("QboProvider dimension entities (Class / Department)", () => {
  it("declares the 2-slot structural cap (one ClassRef + one DepartmentRef per line)", () => {
    expect(makeProvider().capabilities.maxJournalDimensionSlots).toBe(2);
  });

  it("lists active classes via /query", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        QueryResponse: {
          Class: [{ Id: "300", SyncToken: "0", Name: "Atlanta", Active: true }]
        }
      })
    );

    const classes = await makeProvider().listClasses();
    expect(classes).toEqual([
      { Id: "300", SyncToken: "0", Name: "Atlanta", Active: true }
    ]);
    expect(decodeURIComponent(String(fetchMock.mock.calls[0]?.[0]))).toContain(
      "SELECT * FROM Class WHERE Active = true"
    );
  });

  it("returns [] instead of hard-failing when the Intuit plan has the feature off", async () => {
    fetchMock.mockResolvedValueOnce(faultResponse());
    await expect(makeProvider().listClasses()).resolves.toEqual([]);

    fetchMock.mockResolvedValueOnce(faultResponse());
    await expect(makeProvider().listDepartments()).resolves.toEqual([]);
  });

  it("creates a Class by NAME (dimension autoCreate)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ Class: { Id: "301", SyncToken: "0", Name: "Boston" } })
    );

    const created = await makeProvider().createClass({ Name: "Boston" });
    expect(created.Id).toBe("301");

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain(`/v3/company/${REALM_ID}/class`);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      Name: "Boston"
    });
  });

  it("creates a Department by NAME (dimension autoCreate)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        Department: { Id: "500", SyncToken: "0", Name: "Operations" }
      })
    );

    const created = await makeProvider().createDepartment({
      Name: "Operations"
    });
    expect(created.Id).toBe("500");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `/v3/company/${REALM_ID}/department`
    );
  });
});

describe("QboProvider.journalDimensionTargets", () => {
  it("offers class + department when both probe queries succeed (even with zero values yet)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ QueryResponse: {} })) // Class probe: feature on, no rows
      .mockResolvedValueOnce(jsonResponse({ QueryResponse: {} })); // Department probe

    const targets = await makeProvider().journalDimensionTargets();
    expect(targets).toEqual([
      { id: QBO_DIMENSION_TARGET_CLASS, label: "Class" },
      { id: QBO_DIMENSION_TARGET_DEPARTMENT, label: "Department" }
    ]);
  });

  it("omits a target whose feature the org does not have (query error, not hard-fail)", async () => {
    fetchMock
      .mockResolvedValueOnce(faultResponse()) // Class probe fails
      .mockResolvedValueOnce(jsonResponse({ QueryResponse: {} }));

    const targets = await makeProvider().journalDimensionTargets();
    expect(targets).toEqual([
      { id: QBO_DIMENSION_TARGET_DEPARTMENT, label: "Department" }
    ]);
  });
});
