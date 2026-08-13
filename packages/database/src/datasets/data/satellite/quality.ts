import type { NonConformanceSpec, QualityData } from "../../types.ts";

export const NON_CONFORMANCES: NonConformanceSpec[] = [
  {
    ref: "ncr:eps",
    name: "EPS wiring harness short detected",
    source: "Internal",
    status: "In Progress",
    openDateOffset: -312,
    quantity: 1,
    priority: "High",
    // An issue raised on the floor is raised against the operation that produced
    // it. Without this link the issue page's Associations card is empty.
    jobOperation: { job: "job:in-progress" },
    items: [{ item: "SAT-1000", quantity: 1 }]
  },
  {
    ref: "ncr:fastener",
    name: "Fastener torque below spec on panel section 4C",
    source: "Internal",
    status: "Registered",
    openDateOffset: -285,
    quantity: 12,
    priority: "Medium"
  }
];

export const satelliteQuality: QualityData = {
  nonConformances: NON_CONFORMANCES
};
