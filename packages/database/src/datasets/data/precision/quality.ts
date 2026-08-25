import type { NonConformanceSpec, QualityData } from "../../types.ts";

export const NON_CONFORMANCES: NonConformanceSpec[] = [
  {
    ref: "ncr:anodize",
    name: "Hard anodize thickness below print on manifold blocks",
    source: "Internal",
    status: "In Progress",
    // On or after the in-progress job's released date (-160) — an NCR cannot be
    // raised against an operation that had not been handed to the floor yet.
    openDateOffset: -150,
    quantity: 4,
    priority: "High",
    // An issue raised on the floor is raised against the operation that produced
    // it. Without this link the issue page's Associations card is empty.
    jobOperation: { job: "job:in-progress" },
    items: [{ item: "MCH-MANI-BLK", quantity: 4 }]
  },
  {
    ref: "ncr:bore",
    name: "Pump housing bearing bore oversize at second operation",
    source: "Internal",
    status: "Registered",
    openDateOffset: -142,
    quantity: 3,
    priority: "Medium"
  }
];

export const precisionQuality: QualityData = {
  nonConformances: NON_CONFORMANCES
};
