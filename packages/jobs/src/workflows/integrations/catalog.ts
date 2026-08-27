import {
  type IntegrationDeclarationLike,
  integrationStepId
} from "@carbon/workflows";
import { PIECE_ALLOWLIST } from "./allowlist";
import { CONNECTION_INPUT, CONNECTION_PROVIDER } from "./options";
import { toValueType } from "./properties";
import { getPieceActions } from "./registry";

/** Turns the allowlist into workflow integration-step declarations, one per exposed
 * piece action. Read at BUILD time by scripts/generate-workflow-catalog.ts — the list
 * is static under a curated allowlist, so it belongs in the committed catalog rather
 * than a per-company runtime lookup. It is emitted as its OWN catalog: an integration
 * step is a distinct node kind, not an action. */

export const INTEGRATION_ACTION_PREFIX = "integration.";

/** Delegates, so the id shape lives in exactly one place (`@carbon/workflows`). */
export const integrationActionId = integrationStepId;

/** Splits `integration.<piece>.<action>` back apart. The action name may contain
 * dots in principle, so only the first two segments are fixed. */
export function parseIntegrationActionId(
  id: string
): { piece: string; action: string } | undefined {
  if (!id.startsWith(INTEGRATION_ACTION_PREFIX)) return undefined;
  const rest = id.slice(INTEGRATION_ACTION_PREFIX.length);
  const separator = rest.indexOf(".");
  if (separator <= 0) return undefined;
  return {
    piece: rest.slice(0, separator),
    action: rest.slice(separator + 1)
  };
}

export async function buildPieceActionDeclarations(): Promise<
  Record<string, IntegrationDeclarationLike>
> {
  const declarations: Record<string, IntegrationDeclarationLike> = {};

  for (const [pieceName, entry] of Object.entries(PIECE_ALLOWLIST)) {
    const actions = await getPieceActions(pieceName);

    for (const [actionName, action] of Object.entries(actions)) {
      const inputs: IntegrationDeclarationLike["inputs"] = {
        // Always first: which of the company's connections to act as. It is an
        // ordinary fetched-choices input — the builder has no notion of a
        // connection, only of an input whose values come from a provider.
        [CONNECTION_INPUT]: {
          type: { kind: "primitive", of: "string" },
          required: true,
          label: "connection",
          options: {
            provider: CONNECTION_PROVIDER,
            params: { piece: pieceName }
          }
        }
      };

      for (const [propName, property] of Object.entries(action.props)) {
        const mapped = toValueType(pieceName, actionName, propName, property);
        inputs[propName] = {
          type: mapped.type,
          required: mapped.required,
          label: mapped.label,
          ...(mapped.choices === undefined ? {} : { choices: mapped.choices }),
          ...(mapped.options === undefined ? {} : { options: mapped.options })
        };
      }

      declarations[integrationActionId(pieceName, actionName)] = {
        label: `${entry.label}: ${action.displayName}`,
        permission: { module: "workflows", action: "update" },
        inputs,
        outputs: { result: { kind: "primitive", of: "string" } },
        batchable: false,
        piece: { name: pieceName, action: actionName }
      };
    }
  }

  return declarations;
}
