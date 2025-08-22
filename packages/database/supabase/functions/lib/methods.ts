import SupabaseClient from "https://esm.sh/v135/@supabase/supabase-js@2.33.1/dist/module/SupabaseClient.d.ts";
import { Database } from "./types.ts";

export type JobMethod = NonNullable<
  Awaited<ReturnType<typeof getJobMethodTreeArray>>["data"]
>[number];

export type JobMethodTreeItem = {
  id: string;
  data: JobMethod;
  children: JobMethodTreeItem[];
};

export async function getJobMethodTree(
  client: SupabaseClient<Database>,
  methodId: string,
  parentMaterialId: string | null = null
) {
  const items = await getJobMethodTreeArray(client, methodId);
  if (items.error) return items;

  const tree = getJobMethodTreeArrayToTree(items.data, parentMaterialId);

  return {
    data: tree,
    error: null,
  };
}

export function getJobMethodTreeArray(
  client: SupabaseClient<Database>,
  methodId: string
) {
  return client.rpc("get_job_methods_by_method_id", {
    mid: methodId,
  });
}

function getJobMethodTreeArrayToTree(
  items: JobMethod[],
  parentMaterialId: string | null = null
): JobMethodTreeItem[] {
  // function traverseAndRenameIds(node: JobMethodTreeItem) {
  //   const clone = structuredClone(node);
  //   clone.id = `node-${Math.random().toString(16).slice(2)}`;
  //   clone.children = clone.children.map((n) => traverseAndRenameIds(n));
  //   return clone;
  // }

  const rootItems: JobMethodTreeItem[] = [];
  const lookup: { [id: string]: JobMethodTreeItem } = {};

  for (const item of items) {
    const itemId = item.methodMaterialId;
    const parentId = item.parentMaterialId;

    if (!Object.prototype.hasOwnProperty.call(lookup, itemId)) {
      // @ts-ignore - we don't add data here
      lookup[itemId] = { id: itemId, children: [] };
    }

    lookup[itemId]["data"] = item;

    const treeItem = lookup[itemId];

    if (parentId === parentMaterialId || parentId === undefined) {
      rootItems.push(treeItem);
    } else {
      if (!Object.prototype.hasOwnProperty.call(lookup, parentId)) {
        // @ts-ignore - we don't add data here
        lookup[parentId] = { id: parentId, children: [] };
      }

      lookup[parentId]["children"].push(treeItem);
    }
  }
  return rootItems;
}

export function traverseJobMethod(
  node: JobMethodTreeItem,
  callback: (node: JobMethodTreeItem) => void
) {
  callback(node);

  if (node.children) {
    for (const child of node.children) {
      traverseJobMethod(child, callback);
    }
  }
}

export type QuoteMethod = NonNullable<
  Awaited<ReturnType<typeof getQuoteMethodTreeArray>>["data"]
>[number];
export type QuoteMethodTreeItem = {
  id: string;
  data: QuoteMethod;
  children: QuoteMethodTreeItem[];
};

export async function getQuoteMethodTree(
  client: SupabaseClient<Database>,
  methodId: string,
  parentMaterialId: string | null = null
) {
  const items = await getQuoteMethodTreeArray(client, methodId);
  if (items.error) return items;

  const tree = getQuoteMethodTreeArrayToTree(items.data, parentMaterialId);

  return {
    data: tree,
    error: null,
  };
}

export function getQuoteMethodTreeArray(
  client: SupabaseClient<Database>,
  methodId: string
) {
  return client.rpc("get_quote_methods_by_method_id", {
    mid: methodId,
  });
}

function getQuoteMethodTreeArrayToTree(
  items: QuoteMethod[],
  parentMaterialId: string | null = null
): QuoteMethodTreeItem[] {
  const rootItems: QuoteMethodTreeItem[] = [];
  const lookup: { [id: string]: QuoteMethodTreeItem } = {};

  for (const item of items) {
    const itemId = item.methodMaterialId;
    const parentId = item.parentMaterialId;

    if (!Object.prototype.hasOwnProperty.call(lookup, itemId)) {
      lookup[itemId] = { id: itemId, children: [], data: item };
    } else {
      lookup[itemId].data = item;
    }

    const treeItem = lookup[itemId];

    if (parentId === parentMaterialId || parentId === undefined) {
      rootItems.push(treeItem);
    } else {
      if (!Object.prototype.hasOwnProperty.call(lookup, parentId)) {
        lookup[parentId] = {
          id: parentId,
          children: [],
          data: {} as QuoteMethod,
        };
      }

      lookup[parentId].children.push(treeItem);
    }
  }
  return rootItems;
}

export async function traverseQuoteMethod(
  node: QuoteMethodTreeItem,
  callback: (node: QuoteMethodTreeItem) => void | Promise<void>
) {
  await callback(node);

  if (node.children) {
    for await (const child of node.children) {
      await traverseQuoteMethod(child, callback);
    }
  }
}

export const getRatesFromWorkCenters =
  (workCenters: Database["public"]["Views"]["workCenters"]["Row"][] | null) =>
  (
    processId: string,
    workCenterId: string | null
  ): { overheadRate: number; laborRate: number; machineRate: number } => {
    if (!workCenters) {
      return {
        laborRate: 0,
        machineRate: 0,
        overheadRate: 0,
      };
    }

    if (workCenterId) {
      const workCenter = workCenters?.find(
        (wc) => wc.id === workCenterId && wc.active
      );

      if (workCenter) {
        return {
          laborRate: workCenter.laborRate ?? 0,
          machineRate: workCenter.machineRate ?? 0,
          overheadRate: workCenter.overheadRate ?? 0,
        };
      }
    }

    const relatedWorkCenters = workCenters.filter((wc) => {
      const processes = wc.processes ?? [];
      return wc.active && processes.some((p) => p === processId);
    });

    if (relatedWorkCenters.length > 0) {
      const laborRate =
        relatedWorkCenters.reduce((acc, workCenter) => {
          return (acc += workCenter.laborRate ?? 0);
        }, 0) / relatedWorkCenters.length;

      const machineRate =
        relatedWorkCenters.reduce((acc, workCenter) => {
          return (acc += workCenter.machineRate ?? 0);
        }, 0) / relatedWorkCenters.length;

      const overheadRate =
        relatedWorkCenters.reduce((acc, workCenter) => {
          return (acc += workCenter.overheadRate ?? 0);
        }, 0) / relatedWorkCenters.length;

      return {
        laborRate,
        machineRate,
        overheadRate,
      };
    }

    return {
      laborRate: 0,
      machineRate: 0,
      overheadRate: 0,
    };
  };

export const getRatesFromSupplierProcesses =
  (
    processes: Database["public"]["Tables"]["supplierProcess"]["Row"][] | null
  ) =>
  (
    processId: string,
    supplierProcessId: string | null
  ): {
    operationMinimumCost: number;
    operationLeadTime: number;
  } => {
    if (!processes) {
      return {
        operationMinimumCost: 0,
        operationLeadTime: 0,
      };
    }

    if (supplierProcessId) {
      const supplierProcess = processes?.find(
        (sp) => sp.id === supplierProcessId
      );

      if (supplierProcess) {
        return {
          operationMinimumCost: supplierProcess.minimumCost,
          operationLeadTime: supplierProcess.leadTime,
        };
      }
    }

    const relatedProcesses = processes.filter((p) => p.processId === processId);

    if (relatedProcesses.length > 0) {
      const operationMinimumCost =
        relatedProcesses.reduce((acc, process) => {
          return (acc += process.minimumCost ?? 0);
        }, 0) / relatedProcesses.length;
      const operationLeadTime =
        relatedProcesses.reduce((acc, process) => {
          return (acc += process.leadTime ?? 0);
        }, 0) / relatedProcesses.length;

      return {
        operationMinimumCost,
        operationLeadTime,
      };
    }

    return {
      operationMinimumCost: 0,
      operationLeadTime: 0,
    };
  };
