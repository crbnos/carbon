import type { Mod } from "../types";

export interface TrainingCourse {
  key: string; // stable, for the format toggle state
  course: string;
  audience: string;
  format: "Self-paced" | "Hands-on";
  length: string;
  // trainingConfig key (ERP) → resolved to an Academy course / video URL via
  // useResolveVideoUrl. Omitted when no matching Academy content exists yet.
  videoKey?: string;
}

export interface TrainingTrack {
  title: string;
  moduleTags?: Mod[];
  courses: TrainingCourse[];
}

// Train-the-trainer plan by module. Module-tagged tracks drop out when excluded.
export const TRAINING_TRACKS: TrainingTrack[] = [
  {
    title: "Foundation (everyone)",
    courses: [
      {
        key: "found-1",
        course: "Getting around Carbon",
        audience: "All users",
        format: "Self-paced",
        length: "2h"
      },
      {
        key: "found-2",
        course: "How your shop's process maps to Carbon",
        audience: "Champions",
        format: "Hands-on",
        length: "2h"
      }
    ]
  },
  {
    title: "Sales & Quoting",
    moduleTags: ["sal"],
    courses: [
      {
        key: "sal-1",
        course: "Quoting and sales orders",
        audience: "Sales, Estimator",
        format: "Hands-on",
        length: "3h",
        videoKey: "quotes"
      },
      {
        key: "sal-2",
        course: "Configure-to-order",
        audience: "Sales",
        format: "Hands-on",
        length: "2h",
        videoKey: "quotes"
      }
    ]
  },
  {
    title: "Purchasing & Inventory",
    moduleTags: ["pur", "inv"],
    courses: [
      {
        key: "pur-1",
        course: "Purchasing and auto-planning",
        audience: "Buyer, Planner",
        format: "Hands-on",
        length: "3h",
        videoKey: "purchaseOrders"
      },
      {
        key: "inv-1",
        course: "Inventory control and counts",
        audience: "Warehouse, Ops",
        format: "Hands-on",
        length: "3h",
        videoKey: "inventory"
      }
    ]
  },
  {
    title: "Items & Production",
    moduleTags: ["itm", "prd"],
    courses: [
      {
        key: "itm-1",
        course: "Item master, BOMs and Bill of Process",
        audience: "Engineering",
        format: "Hands-on",
        length: "4h",
        videoKey: "bom"
      },
      {
        key: "itm-2",
        course: "Engineering changes and CAD",
        audience: "Engineering",
        format: "Hands-on",
        length: "3h"
      },
      {
        key: "prd-1",
        course: "Shop-floor app and scheduling",
        audience: "Shop Floor leads, Planner",
        format: "Hands-on",
        length: "3h",
        videoKey: "jobs"
      }
    ]
  },
  {
    title: "Quality",
    moduleTags: ["qms"],
    courses: [
      {
        key: "qms-1",
        course: "Inspections, nonconformance, and CAPA",
        audience: "Quality",
        format: "Hands-on",
        length: "3h",
        videoKey: "quality"
      }
    ]
  },
  {
    title: "Accounting",
    moduleTags: ["acc"],
    courses: [
      {
        key: "acc-1",
        course: "General Ledger and month-end close",
        audience: "Controller, Accountant",
        format: "Hands-on",
        length: "4h"
      },
      {
        key: "acc-2",
        course: "Accounts Receivable",
        audience: "AR Clerk",
        format: "Hands-on",
        length: "3h"
      },
      {
        key: "acc-3",
        course: "Accounts Payable",
        audience: "AP Clerk",
        format: "Hands-on",
        length: "3h"
      }
    ]
  }
];
