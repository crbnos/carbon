import type { Database } from "../types.ts";
import type {
  BaseOperation,
  DependencyGraph,
  DependencyNode,
  JobOperationDependency,
} from "./types.ts";

/**
 * Creates and manages a dependency graph for job operations
 */
export class DependencyGraphImpl implements DependencyGraph {
  nodes: Map<string, DependencyNode> = new Map();

  constructor(
    operations: BaseOperation[] = [],
    dependencies: JobOperationDependency[] = []
  ) {
    this.initializeFromOperations(operations, dependencies);
  }

  /**
   * Initialize the graph from operations and dependencies
   */
  private initializeFromOperations(
    operations: BaseOperation[],
    dependencies: JobOperationDependency[]
  ): void {
    // Initialize all operations as nodes
    for (const op of operations) {
      if (op.id) {
        this.nodes.set(op.id, {
          operationId: op.id,
          dependsOn: [],
          requiredBy: [],
        });
      }
    }

    // Build edges from dependencies
    for (const dep of dependencies) {
      this.addDependency(dep.operationId, dep.dependsOnId);
    }
  }

  /**
   * Get operations that this operation depends on
   */
  getDependencies(operationId: string): string[] {
    return this.nodes.get(operationId)?.dependsOn || [];
  }

  /**
   * Get operations that depend on this operation
   */
  getDependents(operationId: string): string[] {
    return this.nodes.get(operationId)?.requiredBy || [];
  }

  /**
   * Add a dependency relationship
   */
  addDependency(operationId: string, dependsOnId: string): void {
    const opNode = this.nodes.get(operationId);
    const depNode = this.nodes.get(dependsOnId);

    if (opNode && !opNode.dependsOn.includes(dependsOnId)) {
      opNode.dependsOn.push(dependsOnId);
    }
    if (depNode && !depNode.requiredBy.includes(operationId)) {
      depNode.requiredBy.push(operationId);
    }
  }

  /**
   * Check if an operation has any dependencies
   */
  hasDependencies(operationId: string): boolean {
    return this.getDependencies(operationId).length > 0;
  }

  /**
   * Check if an operation has any dependents
   */
  hasDependents(operationId: string): boolean {
    return this.getDependents(operationId).length > 0;
  }

  /**
   * Perform topological sort on the operations
   * @param direction "forward" starts with operations that have no dependencies (roots)
   *                  "reverse" starts with operations that have no dependents (leaves)
   */
  topologicalSort(direction: "forward" | "reverse"): string[] {
    const inDegree = new Map<string, number>();
    const queue: string[] = [];
    const result: string[] = [];

    // Calculate in-degrees based on direction
    for (const [opId, node] of this.nodes) {
      const deps = direction === "forward" ? node.dependsOn : node.requiredBy;
      inDegree.set(opId, deps.length);
      if (deps.length === 0) {
        queue.push(opId);
      }
    }

    // Process queue using BFS
    while (queue.length > 0) {
      const opId = queue.shift()!;
      result.push(opId);

      const node = this.nodes.get(opId);
      if (!node) continue;

      // Get neighbors based on direction
      const neighbors =
        direction === "forward" ? node.requiredBy : node.dependsOn;

      for (const neighborId of neighbors) {
        const degree = inDegree.get(neighborId)! - 1;
        inDegree.set(neighborId, degree);
        if (degree === 0) {
          queue.push(neighborId);
        }
      }
    }

    return result;
  }

  /**
   * Get all leaf operations (operations with no dependents)
   */
  getLeafOperations(): string[] {
    const leaves: string[] = [];
    for (const [opId, node] of this.nodes) {
      if (node.requiredBy.length === 0) {
        leaves.push(opId);
      }
    }
    return leaves;
  }

  /**
   * Get all root operations (operations with no dependencies)
   */
  getRootOperations(): string[] {
    const roots: string[] = [];
    for (const [opId, node] of this.nodes) {
      if (node.dependsOn.length === 0) {
        roots.push(opId);
      }
    }
    return roots;
  }
}

/**
 * Build dependencies for operations based on their order and operationOrder field
 * This handles "With Previous" parallel operations
 */
export function buildOperationDependencies(
  operations: BaseOperation[]
): Map<string, Set<string>> {
  const dependencies = new Map<string, Set<string>>();

  // Initialize all operations
  for (const op of operations) {
    if (op.id) {
      dependencies.set(op.id, new Set<string>());
    }
  }

  // Sort operations by order
  const sorted = [...operations].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  );

  // Calculate adjusted order for "With Previous" operations
  const adjustedOrders = new Map<string, number>();
  for (let i = 0; i < sorted.length; i++) {
    const op = sorted[i];
    if (!op.id) continue;

    if (op.operationOrder === "With Previous" && i > 0) {
      // Find the first operation before this that is NOT "With Previous"
      let adjustedOrder = i;
      for (let j = i - 1; j >= 0; j--) {
        if (sorted[j].operationOrder !== "With Previous") {
          adjustedOrder = j + 1;
          break;
        }
        if (j === 0) {
          adjustedOrder = 1;
        }
      }
      adjustedOrders.set(op.id, adjustedOrder);
    } else {
      adjustedOrders.set(op.id, i + 1);
    }
  }

  // Group operations by adjusted order
  const operationsByOrder = new Map<number, string[]>();
  for (const [opId, order] of adjustedOrders) {
    if (!operationsByOrder.has(order)) {
      operationsByOrder.set(order, []);
    }
    operationsByOrder.get(order)!.push(opId);
  }

  // Create dependencies between sequential groups
  const orderKeys = [...operationsByOrder.keys()].sort((a, b) => a - b);
  for (let i = 1; i < orderKeys.length; i++) {
    const currentOrderOps = operationsByOrder.get(orderKeys[i])!;
    const previousOrderOps = operationsByOrder.get(orderKeys[i - 1])!;

    // Each operation in current group depends on all operations in previous group
    for (const opId of currentOrderOps) {
      const deps = dependencies.get(opId);
      if (deps) {
        for (const prevOpId of previousOrderOps) {
          deps.add(prevOpId);
        }
      }
    }
  }

  return dependencies;
}

/**
 * Convert dependency map to array of JobOperationDependency records
 */
export function dependenciesToRecords(
  dependencies: Map<string, Set<string>>,
  jobId: string,
  companyId: string
): Database["public"]["Tables"]["jobOperationDependency"]["Insert"][] {
  const records: Database["public"]["Tables"]["jobOperationDependency"]["Insert"][] =
    [];

  for (const [operationId, deps] of dependencies) {
    for (const dependsOnId of deps) {
      records.push({
        jobId,
        operationId,
        dependsOnId,
        companyId,
      });
    }
  }

  return records;
}
