// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterEach, expect, it, vi } from "vitest";
import { action as complete } from "../routes/x+/inspection-lot.$id.complete-passed";
import { action as disposition } from "../routes/x+/inspection-lot.$id.disposition";
import { fakeClient, serialUnits } from "./work-unit-test-fixture";

const ports = vi.hoisted(() => ({
  authorize: vi.fn(),
  service: vi.fn(),
  close: vi.fn()
}));
vi.mock("@carbon/auth/auth.server", () => ({
  authorize: ports.authorize
}));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: ports.service
}));
vi.mock("@carbon/database/quality", () => ({
  dispositionInspection: ports.close
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each(["unsampled", "Pending", "corrected failure"])(
  "the closed lot posts its %s serial once after release",
  async (sample) => {
    const samples = [
      { id: "sample-a", trackedEntityId: "a", status: "Passed" }
    ];
    if (sample !== "unsampled") {
      samples.push({
        id: "sample-b",
        trackedEntityId: "b",
        status: sample === "corrected failure" ? "Failed" : "Pending"
      });
    }
    const lot = {
      id: "lot",
      companyId: "co",
      lotSize: 2,
      sampleSize: 1,
      status: "In Progress",
      sourceDocument: "Job Operation",
      sourceDocumentLineId: "op",
      inspectionSample: samples,
      acceptedUnitIds: null as string[] | null
    };
    const op = {
      id: "op",
      companyId: "co",
      jobId: "job",
      jobMakeMethodId: "method",
      targetQuantity: 2,
      quantityComplete: 0,
      status: "In Progress"
    };
    const entities = serialUnits("method", "op", [{ id: "a" }, { id: "b" }]);
    const held = [{ trackedEntityId: "b", companyId: "co", issueId: "issue" }];
    const client = fakeClient({
      inspection: [lot],
      jobOperation: [op],
      trackedEntity: entities,
      jobMakeMethod: [{ id: "method", requiresSerialTracking: true }],
      companySettings: [{ id: "co", holdUnitsWithOpenIssues: true }],
      unitQualityHold: held
    }).client;
    ports.authorize.mockResolvedValue({
      client,
      companyId: "co",
      userId: "operator"
    });
    ports.service.mockResolvedValue(client);
    ports.close.mockImplementation(async (_db, args) => {
      const decision = args.serialAcceptance;
      if (sample === "corrected failure" && samples[1]!.status === "Failed") {
        // Quality saved a passing verdict between the MES read and the lot lock.
        samples[1]!.status = "Passed";
        expect(decision).toEqual({
          acceptedUnitIds: ["a"],
          failedUnitIds: ["b"]
        });
        return { error: { message: "The sample verdicts changed." } };
      }
      lot.acceptedUnitIds = decision.acceptedUnitIds;
      lot.status = "Passed";
      return { error: null };
    });
    const production: { serial: string; sample: string | null }[] = [];
    vi.stubEnv("ERP_URL", "http://erp.test");
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      expect(url).toBe("http://erp.test/api/internal/postings/issue");
      const input = JSON.parse(String(init.body));
      if (input.type === "jobOperationSerialComplete") {
        production.push({
          serial: input.trackedEntityId,
          sample: input.inspectionSampleId ?? null
        });
        const unit = entities.find((e) => e.id === input.trackedEntityId)!;
        Object.assign(unit.attributes, { "Operation op": 1 });
        op.quantityComplete++;
      }
      return Response.json({ data: {}, error: null });
    });

    // Neither form submits serial IDs. MES reads the lot and its current holds.
    const submit = async (route: typeof complete) => {
      const body = new FormData();
      body.set("operationId", "op");
      if (route === disposition) body.set("decision", "Accept");
      const action = route === disposition ? "disposition" : "complete-passed";
      const url = new URL(`/x/inspection-lot/lot/${action}`, "http://mes.test");
      const response = await route({
        params: { id: "lot" },
        url,
        pattern: `/x/inspection-lot/:id/${action}`,
        context: {},
        request: new Request(url, {
          method: "POST",
          body
        })
      }).catch((response: unknown) => response);
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(302);
    };

    if (sample === "corrected failure") {
      await submit(disposition);
      expect(lot.status).toBe("In Progress");
      expect(production).toEqual([]);
    }
    await submit(disposition);
    expect(lot.acceptedUnitIds?.sort()).toEqual(["a", "b"]);
    expect(production).toEqual([{ serial: "a", sample: "sample-a" }]);
    await submit(complete);
    expect(production).toHaveLength(1);

    held.length = 0;
    entities.push(...serialUnits("method", "op", [{ id: "later" }]));
    await submit(complete);
    await submit(complete);
    expect(production).toEqual([
      { serial: "a", sample: "sample-a" },
      { serial: "b", sample: sample === "unsampled" ? null : "sample-b" }
    ]);
  }
);
