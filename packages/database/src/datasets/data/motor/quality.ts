import type { NonConformanceSpec, QualityData } from "../../types.ts";

export const NON_CONFORMANCES: NonConformanceSpec[] = [
  {
    ref: "ncr:insulation",
    name: "Stator insulation resistance below spec after impregnation",
    source: "Internal",
    status: "In Progress",
    // On or after the in-progress job's released date (-297) — an NCR cannot be
    // raised against an operation that had not been handed to the floor yet.
    openDateOffset: -288,
    quantity: 1,
    priority: "High",
    // An issue raised on the floor is raised against the operation that produced
    // it. Without this link the issue page's Associations card is empty.
    jobOperation: { job: "job:in-progress" },
    items: [{ item: "MTR-9000", quantity: 1 }]
  },
  {
    ref: "ncr:magnet",
    name: "Magnet lot received with chipped nickel plating",
    source: "External",
    status: "Registered",
    openDateOffset: -281,
    quantity: 36,
    priority: "Medium"
  }
];

export const motorQuality: QualityData = {
  nonConformances: NON_CONFORMANCES
};
