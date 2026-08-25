import type { NonConformanceSpec, QualityData } from "../../types.ts";

export const NON_CONFORMANCES: NonConformanceSpec[] = [
  {
    ref: "ncr:harness",
    name: "Arm harness short detected during continuity test",
    source: "Internal",
    status: "In Progress",
    // On or after the in-progress job's released date (-297) — an NCR cannot be
    // raised against an operation that had not been handed to the floor yet.
    openDateOffset: -290,
    quantity: 1,
    priority: "High",
    // An issue raised on the floor is raised against the operation that produced
    // it. Without this link the issue page's Associations card is empty.
    jobOperation: { job: "job:in-progress" },
    items: [{ item: "ROB-2000", quantity: 1 }]
  },
  {
    ref: "ncr:torque",
    name: "J1 gearbox fastener torque below spec on base assembly",
    source: "Internal",
    status: "Registered",
    openDateOffset: -285,
    quantity: 12,
    priority: "Medium"
  }
];

export const roboticsQuality: QualityData = {
  nonConformances: NON_CONFORMANCES
};
