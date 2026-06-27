import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { Mod } from "../types";

export interface TrainingCourse {
  key: string; // stable, for the format toggle state
  course: MessageDescriptor;
  audience: MessageDescriptor;
  format: "Self-paced" | "Hands-on";
  length: MessageDescriptor;
  // trainingConfig key (ERP) → resolved to an Academy course / video URL via
  // useResolveVideoUrl. Omitted when no matching Academy content exists yet.
  videoKey?: string;
}

export interface TrainingTrack {
  title: MessageDescriptor;
  moduleTags?: Mod[];
  courses: TrainingCourse[];
}

// Train-the-trainer plan by module. Module-tagged tracks drop out when excluded.
export const TRAINING_TRACKS: TrainingTrack[] = [
  {
    title: msg`Foundation (everyone)`,
    courses: [
      {
        key: "found-1",
        course: msg`Getting around Carbon`,
        audience: msg`All users`,
        format: "Self-paced",
        length: msg`2h`
      },
      {
        key: "found-2",
        course: msg`How your company's process maps to Carbon`,
        audience: msg`Champions`,
        format: "Hands-on",
        length: msg`2h`
      }
    ]
  },
  {
    title: msg`Sales & Quoting`,
    moduleTags: ["sal"],
    courses: [
      {
        key: "sal-1",
        course: msg`Quoting and sales orders`,
        audience: msg`Sales, Estimator`,
        format: "Hands-on",
        length: msg`3h`,
        videoKey: "quotes"
      },
      {
        key: "sal-2",
        course: msg`Configure-to-order`,
        audience: msg`Sales`,
        format: "Hands-on",
        length: msg`2h`,
        videoKey: "quotes"
      }
    ]
  },
  {
    title: msg`Purchasing & Inventory`,
    moduleTags: ["pur", "inv"],
    courses: [
      {
        key: "pur-1",
        course: msg`Purchasing and auto-planning`,
        audience: msg`Buyer, Planner`,
        format: "Hands-on",
        length: msg`3h`,
        videoKey: "purchaseOrders"
      },
      {
        key: "inv-1",
        course: msg`Inventory control and counts`,
        audience: msg`Warehouse, Ops`,
        format: "Hands-on",
        length: msg`3h`,
        videoKey: "inventory"
      }
    ]
  },
  {
    title: msg`Items & Production`,
    moduleTags: ["itm", "prd"],
    courses: [
      {
        key: "itm-1",
        course: msg`Item master, BOMs and Bill of Process`,
        audience: msg`Engineering`,
        format: "Hands-on",
        length: msg`4h`,
        videoKey: "bom"
      },
      {
        key: "itm-2",
        course: msg`Engineering changes and CAD`,
        audience: msg`Engineering`,
        format: "Hands-on",
        length: msg`3h`
      },
      {
        key: "prd-1",
        course: msg`Shop-floor app and scheduling`,
        audience: msg`Shop Floor leads, Planner`,
        format: "Hands-on",
        length: msg`3h`,
        videoKey: "jobs"
      }
    ]
  },
  {
    title: msg`Quality`,
    moduleTags: ["qms"],
    courses: [
      {
        key: "qms-1",
        course: msg`Inspections, nonconformance, and CAPA`,
        audience: msg`Quality`,
        format: "Hands-on",
        length: msg`3h`,
        videoKey: "quality"
      }
    ]
  },
  {
    title: msg`Accounting`,
    moduleTags: ["acc"],
    courses: [
      {
        key: "acc-1",
        course: msg`General Ledger and month-end close`,
        audience: msg`Controller, Accountant`,
        format: "Hands-on",
        length: msg`4h`
      },
      {
        key: "acc-2",
        course: msg`Accounts Receivable`,
        audience: msg`AR Clerk`,
        format: "Hands-on",
        length: msg`3h`
      },
      {
        key: "acc-3",
        course: msg`Accounts Payable`,
        audience: msg`AP Clerk`,
        format: "Hands-on",
        length: msg`3h`
      }
    ]
  }
];
