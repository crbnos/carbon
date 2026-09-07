import { describe, expect, it } from "vitest";
import type {
  ProjectionAssignment,
  ProjectionCertificate,
  ProjectionMember
} from "./projection";
import { computeTeamStatus } from "./projection";

const TODAY = "2026-09-06";

const members: Record<string, ProjectionMember> = {
  u1: { id: "u1", name: "Ada Lovelace", avatarUrl: null },
  u2: { id: "u2", name: "Grace Hopper", avatarUrl: null }
};

const assignment = (
  over: Partial<ProjectionAssignment> = {}
): ProjectionAssignment => ({
  id: "a1",
  trackSlug: "purchasing",
  trackTitle: "Purchasing",
  dueDate: null,
  memberIds: ["u1"],
  ...over
});

const cert = (
  over: Partial<ProjectionCertificate> = {}
): ProjectionCertificate => ({
  id: "c1",
  userId: "u1",
  trackSlug: "purchasing",
  expiresAt: "2027-09-06",
  revokedAt: null,
  ...over
});

const run = (over: Partial<Parameters<typeof computeTeamStatus>[0]> = {}) =>
  computeTeamStatus({
    assignments: [assignment()],
    members,
    progress: [],
    certificates: [],
    unitCounts: { purchasing: 10 },
    today: TODAY,
    ...over
  });

describe("computeTeamStatus", () => {
  it("reports Not started with no progress", () => {
    const [row] = run();
    expect(row.status).toBe("Not started");
    expect(row.percent).toBe(0);
  });

  it("reports In progress with a percentage", () => {
    const [row] = run({
      progress: [{ userId: "u1", trackSlug: "purchasing", completedUnits: 3 }]
    });
    expect(row.status).toBe("In progress");
    expect(row.percent).toBe(30);
  });

  it("reports Certified with the expiry when the certificate is live", () => {
    const [row] = run({ certificates: [cert()] });
    expect(row.status).toBe("Certified");
    expect(row.expiresAt).toBe("2027-09-06");
    expect(row.certificateId).toBe("c1");
  });

  it("reports Expired once the certificate's expiry has passed", () => {
    const [row] = run({ certificates: [cert({ expiresAt: "2026-09-05" })] });
    expect(row.status).toBe("Expired");
  });

  it("reports Revoked regardless of the expiry date", () => {
    const [row] = run({
      certificates: [cert({ revokedAt: "2026-08-01T00:00:00.000Z" })]
    });
    expect(row.status).toBe("Revoked");
  });

  it("reports Overdue when the due date has passed and nothing is certified", () => {
    const [row] = run({ assignments: [assignment({ dueDate: "2026-09-01" })] });
    expect(row.status).toBe("Overdue");
  });

  it("prefers Certified over Overdue", () => {
    const [row] = run({
      assignments: [assignment({ dueDate: "2026-09-01" })],
      certificates: [cert()]
    });
    expect(row.status).toBe("Certified");
  });

  it("keeps the newest certificate when a track was certified twice", () => {
    const [row] = run({
      certificates: [
        cert({ id: "old", expiresAt: "2026-01-01" }),
        cert({ id: "new" })
      ]
    });
    expect(row.certificateId).toBe("new");
    expect(row.status).toBe("Certified");
  });

  it("emits one row per member and sorts by name", () => {
    const rows = run({
      assignments: [assignment({ memberIds: ["u2", "u1"] })]
    });
    expect(rows.map((r) => r.name)).toEqual(["Ada Lovelace", "Grace Hopper"]);
  });

  it("never exposes XP, streaks, or answers", () => {
    const [row] = run({ certificates: [cert()] });
    expect(Object.keys(row).sort()).toEqual([
      "avatarUrl",
      "certificateId",
      "dueDate",
      "expiresAt",
      "name",
      "percent",
      "status",
      "trackSlug",
      "trackTitle",
      "userId"
    ]);
  });

  it("skips members it has no record for", () => {
    const rows = run({ assignments: [assignment({ memberIds: ["ghost"] })] });
    expect(rows).toHaveLength(0);
  });
});
