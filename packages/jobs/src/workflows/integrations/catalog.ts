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

      declarations[integrationStepId(pieceName, actionName)] = {
        label: `${entry.label}: ${action.displayName}`,
        permission: { module: "workflows", action: "update" },
        inputs,
        outputs: { result: { kind: "primitive", of: "string" } },
        batchable: false,
        piece: { name: pieceName, action: actionName, label: entry.label }
      };
    }
  }

  return declarations;
}
