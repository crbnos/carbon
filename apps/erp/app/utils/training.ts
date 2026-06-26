export type VideoType = "loom" | "youtube";

export type TrainingVideo = {
  title: string;
  description: string;
  videoUrl: string;
  videoType: VideoType;
  academyUrl?: string;
};

/**
 * Central training config: submodule key → video data.
 * This is the ONLY place you need to edit to add/change training content.
 */
export const trainingConfig: Record<string, TrainingVideo> = {
  quotes: {
    title: "Quotes in Carbon",
    description:
      "Learn how to record and manage quotes from customers in Carbon.",
    videoUrl:
      "https://www.loom.com/share/881c83e9df8044db848aee8c2ea782bd?sid=f4ca14ef-bc59-4a8f-94a6-d6e120ee3bb3",
    videoType: "loom",
    academyUrl: "https://learn.carbon.ms/course/selling/quoting-estimating"
  },
  salesOrders: {
    title: "Sales Orders in Carbon",
    description: "Learn how to create and manage sales orders in Carbon.",
    videoUrl:
      "https://www.loom.com/share/c5fa13046aaa445a99c43c24434ff2b0?sid=21e5dcc9-cc76-4098-b97e-069212095616",
    videoType: "loom",
    academyUrl: "https://learn.carbon.ms/course/selling/sales-shipment"
  },
  salesInvoices: {
    title: "Sales Invoices in Carbon",
    description: "Master the creation and management of sales invoices.",
    videoUrl:
      "https://www.loom.com/share/45713271bd444f939dcde717ca720faa?sid=9c45d855-b6fe-4b27-99f9-c019dc28d386",
    videoType: "loom",
    academyUrl: "https://learn.carbon.ms/course/selling/sales-shipment"
  },
  jobs: {
    title: "Production Jobs in Carbon",
    description:
      "Learn the fundamentals of job management and how jobs drive production in Carbon.",
    videoUrl:
      "https://www.loom.com/share/ad79b6a529fb43ff864f4908eeaf1511?sid=2a041ddf-50be-4e13-9885-694c253af623",
    videoType: "loom",
    academyUrl:
      "https://learn.carbon.ms/course/manufacturing/managing-production"
  },
  suppliers: {
    title: "Purchasing in Carbon",
    description:
      "Learn about the complete purchasing process from supplier selection to payment.",
    videoUrl:
      "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
    videoType: "loom",
    academyUrl: "https://learn.carbon.ms/course/buying/purchasing-basics"
  },
  purchaseOrders: {
    title: "Purchase Orders in Carbon",
    description: "Learn how to create and manage purchase orders effectively.",
    videoUrl:
      "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
    videoType: "loom",
    academyUrl: "https://learn.carbon.ms/course/buying/purchasing-basics"
  },
  bom: {
    title: "Bill of Materials in Carbon",
    description:
      "Learn how to bring a bill of materials into Carbon and structure it for manufacturing.",
    videoUrl:
      "https://www.loom.com/share/acad6206adde4d1185e83f57393f36e9?sid=3cec60b1-91e3-454b-a6dd-f08fe1035ef2",
    videoType: "loom",
    academyUrl: "https://learn.carbon.ms/lesson/bill-of-materials"
  },
  parts: {
    title: "Parts & Materials in Carbon",
    description:
      "Learn the differences between item types and when to use each one in your business processes.",
    videoUrl:
      "https://www.loom.com/share/acad6206adde4d1185e83f57393f36e9?sid=3cec60b1-91e3-454b-a6dd-f08fe1035ef2",
    videoType: "loom",
    academyUrl: "https://learn.carbon.ms/course/parts-materials/defining-item"
  },
  inventory: {
    title: "Inventory in Carbon",
    description:
      "Learn how to monitor and manage inventory levels, set reorder points, and handle stock movements.",
    videoUrl:
      "https://www.loom.com/share/66045f3ef31c4d93b734fad7df0006dc?sid=5f896ab7-1765-411c-afd2-c320a4df18a7",
    videoType: "loom",
    academyUrl:
      "https://learn.carbon.ms/course/parts-materials/replenishing-item"
  },
  quality: {
    title: "Quality in Carbon",
    description:
      "Learn how to track and manage non-conforming materials and quality issues.",
    videoUrl:
      "https://www.loom.com/share/51e0c6dd053b4a3e904fc795d4fc298f?sid=0bb2081d-6bc4-4efb-8361-d2717dda9781",
    videoType: "loom",
    academyUrl: "https://learn.carbon.ms/course/quality/tracking-quality"
  }
};

/**
 * Maps pathname prefixes → submodule keys.
 * Each submodule can have multiple prefixes (list page + detail page).
 */
const routeToSubmodule: Array<{ prefixes: string[]; key: string }> = [
  { prefixes: ["/x/sales/quotes", "/x/quote/"], key: "quotes" },
  { prefixes: ["/x/sales/orders", "/x/sales-order/"], key: "salesOrders" },
  {
    prefixes: ["/x/sales/invoices", "/x/sales-invoice/"],
    key: "salesInvoices"
  },
  { prefixes: ["/x/production/jobs", "/x/job/"], key: "jobs" },
  {
    prefixes: ["/x/purchasing/suppliers", "/x/supplier/"],
    key: "suppliers"
  },
  {
    prefixes: ["/x/purchasing/orders", "/x/purchase-order/"],
    key: "purchaseOrders"
  },
  { prefixes: ["/x/items/parts", "/x/part/"], key: "parts" },
  {
    prefixes: [
      "/x/inventory/receipts",
      "/x/inventory/shipments",
      "/x/inventory/inventory",
      "/x/inventory/stock-transfers",
      "/x/receipt/",
      "/x/shipment/",
      "/x/stock-transfer/"
    ],
    key: "inventory"
  },
  {
    prefixes: ["/x/quality/issues", "/x/quality/actions", "/x/issue/"],
    key: "quality"
  }
];

/** Resolves current pathname to a TrainingVideo (or null). */
export function getTrainingForPath(pathname: string): TrainingVideo | null {
  for (const { prefixes, key } of routeToSubmodule) {
    if (prefixes.some((p) => pathname.startsWith(p))) {
      return trainingConfig[key] ?? null;
    }
  }
  return null;
}

/** Returns submodule key for localStorage dismiss tracking. */
export function getTrainingKey(pathname: string): string | null {
  for (const { prefixes, key } of routeToSubmodule) {
    if (prefixes.some((p) => pathname.startsWith(p))) {
      return key;
    }
  }
  return null;
}

/** Converts a share URL to an embeddable iframe URL. */
export function getVideoEmbedUrl(
  videoUrl: string,
  videoType: VideoType
): string {
  if (videoType === "loom") {
    const match = videoUrl.match(/loom\.com\/share\/([a-zA-Z0-9]+)/);
    return match
      ? `https://www.loom.com/embed/${match[1]}?hideEmbedTopBar=true`
      : videoUrl;
  }
  if (videoType === "youtube") {
    const match = videoUrl.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/
    );
    return match ? `https://www.youtube.com/embed/${match[1]}` : videoUrl;
  }
  return videoUrl;
}
