import type { CatalogInput, WorkflowCatalog } from "./catalog";
import { integrationStepId } from "./catalog";
import { linkState } from "./links";
import { workflowDefinitionSchema } from "./schema";
import type { ValueOrRef } from "./types";
import { liveDefinition } from "./validate";
import { createContext } from "./variables";

export type WorkflowNoticeCode = "LINKS_UNSUPPORTED" | "LINKS_CONDITIONAL";

/**
 * Advisory, never blocking — deliberately NOT a `WorkflowIssue`, whose every entry is
 * fatal. The package emits codes and parameters; the app owns the translated copy,
 * which is what keeps prose out of this bundle.
 */
export interface WorkflowNotice {
  code: WorkflowNoticeCode;
  nodeId: string;
  /** `inputs.<name>` — the addressing `issueForField` already resolves. */
  field: string;
  /** LINKS_CONDITIONAL: which sibling input turns links on, and the value that does. */
  params?: { input: string; equals: string };
}

/** A record dropped INTO prose, whatever shape holds it. A plain string variable is
 * not a record; a literal never is. */
function holdsRecord(
  value: ValueOrRef,
  nodeId: string,
  typeOf: (value: ValueOrRef, atNodeId: string) => { kind: string } | undefined
): boolean {
  if (value.kind === "template") {
    return value.parts.some(
      (part) => part.kind !== "text" && typeOf(part, nodeId)?.kind === "entity"
    );
  }
  if (value.kind === "ref" || value.kind === "item") {
    return typeOf(value, nodeId)?.kind === "entity";
  }
  return false;
}

/**
 * Where a record in an integration step's prose will NOT come out as a link: either the
 * destination never renders one (`LINKS_UNSUPPORTED`), or it would if a sibling input
 * held the right value (`LINKS_CONDITIONAL` — the params name that fix). Integration
 * nodes only: Carbon's own inputs either link (Notify) or are machine payloads
 * (webhook), and a hint on the latter is noise.
 */
export function fieldNotices(
  definition: unknown,
  catalog: WorkflowCatalog
): WorkflowNotice[] {
  const parsed = workflowDefinitionSchema.safeParse(definition);
  if (!parsed.success) return [];
  const live = liveDefinition(parsed.data);
  const { context } = createContext(live, catalog);

  const notices: WorkflowNotice[] = [];
  for (const node of live.nodes) {
    if (node.type !== "integration") continue;
    const step = catalog.getIntegration(
      integrationStepId(node.data.piece, node.data.action)
    );
    if (step === undefined) continue;
    const declared: Record<string, CatalogInput> = {
      ...step.inputs,
      ...step.advancedInputs
    };

    for (const [name, value] of Object.entries(node.data.inputs)) {
      const input = declared[name];
      if (input === undefined) continue;
      if (!(input.type.kind === "primitive" && input.type.of === "string")) {
        continue;
      }
      if (!holdsRecord(value, node.id, context.typeOf)) continue;

      const state = linkState(node, declared, name);
      if (state.kind === "linked") continue;
      notices.push(
        state.kind === "gated"
          ? {
              code: "LINKS_CONDITIONAL",
              nodeId: node.id,
              field: `inputs.${name}`,
              params: {
                input: state.gate.input,
                equals: String(state.gate.equals[0] ?? "")
              }
            }
          : {
              code: "LINKS_UNSUPPORTED",
              nodeId: node.id,
              field: `inputs.${name}`
            }
      );
    }
  }
  return notices;
}
