import type { WorkflowDefinition } from "./schema";

/** Every node id in reading order: the trigger first, then breadth-first over
 * edges, then anything unreachable, ties broken by position in the definition
 * so the order is stable across renders. */
export function topologicalNodeOrder(definition: WorkflowDefinition): string[] {
  const index = new Map<string, number>();
  definition.nodes.forEach((node, i) => {
    index.set(node.id, i);
  });

  const outgoing = new Map<string, string[]>();
  for (const edge of definition.edges) {
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge.target);
    outgoing.set(edge.source, list);
  }

  const seen = new Set<string>();
  const order: string[] = [];

  const roots = definition.nodes
    .filter((node) => node.type === "trigger")
    .map((node) => node.id);
  const queue = roots.length > 0 ? [...roots] : [];

  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    const next = (outgoing.get(id) ?? [])
      .filter((target) => index.has(target))
      .sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0));
    queue.push(...next);
  }

  // Anything the edges never reach still has to be listed.
  for (const node of definition.nodes) {
    if (!seen.has(node.id)) order.push(node.id);
  }

  return order;
}
