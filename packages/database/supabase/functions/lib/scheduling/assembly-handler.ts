import type SupabaseClient from "https://esm.sh/v135/@supabase/supabase-js@2.33.1/dist/module/SupabaseClient.d.ts";
import type { Kysely } from "kysely";
import type { DB } from "../database.ts";
import { getJobMethodTree, type JobMethodTreeItem } from "../methods.ts";
import type { Database } from "../types.ts";
import type { AssemblyNode, BaseOperation } from "./types.ts";

/**
 * Assembly Handler
 * Manages assembly hierarchy and transforms job method trees into scheduling structures
 */
export class AssemblyHandler {
  private client: SupabaseClient<Database>;
  private db: Kysely<DB>;
  private companyId: string;

  constructor(
    client: SupabaseClient<Database>,
    db: Kysely<DB>,
    companyId: string
  ) {
    this.client = client;
    this.db = db;
    this.companyId = companyId;
  }

  /**
   * Build assembly tree for a job
   */
  async buildAssemblyTree(jobId: string): Promise<AssemblyNode | null> {
    // Get the root job make method
    const rootMethod = await this.db
      .selectFrom("jobMakeMethod")
      .select(["id", "itemId"])
      .where("jobId", "=", jobId)
      .where("parentMaterialId", "is", null)
      .executeTakeFirst();

    if (!rootMethod?.id) {
      return null;
    }

    // Get the job method tree using the existing function
    const treeResult = await getJobMethodTree(this.client, rootMethod.id);
    if (treeResult.error || !treeResult.data || treeResult.data.length === 0) {
      return null;
    }

    // Get all operations for this job
    const operations = await this.db
      .selectFrom("jobOperation")
      .selectAll()
      .where("jobId", "=", jobId)
      .where("status", "not in", ["Done", "Canceled"])
      .orderBy("order")
      .execute();

    // Group operations by jobMakeMethodId
    const operationsByMethod = new Map<string, BaseOperation[]>();
    for (const op of operations) {
      if (op.jobMakeMethodId) {
        if (!operationsByMethod.has(op.jobMakeMethodId)) {
          operationsByMethod.set(op.jobMakeMethodId, []);
        }
        operationsByMethod.get(op.jobMakeMethodId)!.push(op as BaseOperation);
      }
    }

    // Transform the tree to AssemblyNode structure
    const rootItem = treeResult.data[0];
    return this.transformTreeItem(rootItem, operationsByMethod);
  }

  /**
   * Transform a JobMethodTreeItem to AssemblyNode
   */
  private transformTreeItem(
    item: JobMethodTreeItem,
    operationsByMethod: Map<string, BaseOperation[]>
  ): AssemblyNode {
    const jobMakeMethodId = item.data?.jobMaterialMakeMethodId || item.id;

    return {
      id: item.id,
      jobMakeMethodId,
      parentMaterialId: item.data?.parentMaterialId ?? null,
      itemId: item.data?.itemId ?? null,
      operations: operationsByMethod.get(jobMakeMethodId) ?? [],
      children: item.children.map((child) =>
        this.transformTreeItem(child, operationsByMethod)
      ),
    };
  }

  /**
   * Get assembly nodes in post-order traversal (children before parents)
   * This is the order in which assemblies should be scheduled for backward scheduling
   */
  getPostOrderTraversal(root: AssemblyNode): AssemblyNode[] {
    const result: AssemblyNode[] = [];

    function traverse(node: AssemblyNode) {
      // Process children first
      for (const child of node.children) {
        traverse(child);
      }
      // Then process current node
      result.push(node);
    }

    traverse(root);
    return result;
  }

  /**
   * Get assembly nodes in pre-order traversal (parents before children)
   * This is the order in which assemblies should be scheduled for forward scheduling
   */
  getPreOrderTraversal(root: AssemblyNode): AssemblyNode[] {
    const result: AssemblyNode[] = [];

    function traverse(node: AssemblyNode) {
      // Process current node first
      result.push(node);
      // Then process children
      for (const child of node.children) {
        traverse(child);
      }
    }

    traverse(root);
    return result;
  }

  /**
   * Get all operations from the assembly tree in scheduling order
   * For backward scheduling: children operations come first
   */
  getAllOperationsForBackwardScheduling(root: AssemblyNode): BaseOperation[] {
    const operations: BaseOperation[] = [];
    const traversal = this.getPostOrderTraversal(root);

    for (const node of traversal) {
      operations.push(...node.operations);
    }

    return operations;
  }

  /**
   * Get all operations from the assembly tree in scheduling order
   * For forward scheduling: parent operations come first
   */
  getAllOperationsForForwardScheduling(root: AssemblyNode): BaseOperation[] {
    const operations: BaseOperation[] = [];
    const traversal = this.getPreOrderTraversal(root);

    for (const node of traversal) {
      operations.push(...node.operations);
    }

    return operations;
  }

  /**
   * Calculate the maximum depth of the assembly tree
   */
  getAssemblyDepth(root: AssemblyNode): number {
    function getDepth(node: AssemblyNode): number {
      if (node.children.length === 0) {
        return 1;
      }
      return 1 + Math.max(...node.children.map(getDepth));
    }

    return getDepth(root);
  }

  /**
   * Get all jobMakeMethodIds in the assembly tree
   */
  getAllJobMakeMethodIds(root: AssemblyNode): string[] {
    const ids: string[] = [];

    function traverse(node: AssemblyNode) {
      ids.push(node.jobMakeMethodId);
      for (const child of node.children) {
        traverse(child);
      }
    }

    traverse(root);
    return ids;
  }
}

/**
 * Build make method dependencies for dependency creation
 * Returns tuples of [childMethodId, parentMethodId]
 */
export function buildMakeMethodDependencies(
  root: AssemblyNode
): { id: string; parentId: string | null }[] {
  const dependencies: { id: string; parentId: string | null }[] = [];

  function traverse(node: AssemblyNode, parentMethodId: string | null) {
    dependencies.push({
      id: node.jobMakeMethodId,
      parentId: parentMethodId,
    });

    for (const child of node.children) {
      traverse(child, node.jobMakeMethodId);
    }
  }

  traverse(root, null);
  return dependencies;
}
