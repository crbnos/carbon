import {
  type IntegrationDeclarationLike,
  integrationStepId
} from "@carbon/workflows";
import { PIECE_ALLOWLIST } from "./allowlist";
import { CONNECTION_INPUT, CONNECTION_PROVIDER } from "./options";
import { toOutputTypes, UnmappableOutputError } from "./outputs";
import { toValueType } from "./properties";
import { getPieceActions } from "./registry";
import { assertHiddenPropIsSatisfied, visibilityOf } from "./visibility";

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

      // Hidden inputs are emitted SEPARATELY rather than flagged in place: every
      // `required` check and the validator itself iterate `inputs`, so a
      // hidden-but-present required input would have the validator demand a field
      // the author was never shown.
      const advancedInputs: IntegrationDeclarationLike["inputs"] = {};

      for (const [propName, property] of Object.entries(action.props)) {
        const mapped = toValueType(pieceName, actionName, propName, property);
        const declared = {
          type: mapped.type,
          required: mapped.required,
          label: mapped.label,
          ...(mapped.choices === undefined ? {} : { choices: mapped.choices }),
          ...(mapped.options === undefined ? {} : { options: mapped.options }),
          ...(mapped.defaultValue === undefined
            ? {}
            : {
                defaultValue: mapped.defaultValue as
                  | string
                  | number
                  | boolean
                  | string[]
              }),
          ...(mapped.description === undefined
            ? {}
            : { description: mapped.description })
        };

        const visibility = visibilityOf(
          property,
          entry.props?.[actionName]?.[propName]
        );
        assertHiddenPropIsSatisfied(
          pieceName,
          actionName,
          propName,
          property,
          visibility
        );

        if (visibility.show) inputs[propName] = declared;
        // A hidden input is never REQUIRED of the author — it is satisfied by a
        // pinned value or the piece's own default — but it stays editable under
        // Advanced for anyone who needs it.
        else {
          advancedInputs[propName] = {
            ...declared,
            required: false,
            // The EFFECTIVE default — an allowlist pin beats the piece's own —
            // so an untouched Advanced toggle displays what the run will send.
            ...(visibility.value !== undefined
              ? {
                  defaultValue: visibility.value as
                    | string
                    | number
                    | boolean
                    | string[]
                }
              : {})
          };
        }
      }

      // An action that does not describe what it returns is REFUSED, not exposed
      // with an opaque blob: the author would wire it up, see one `result` string,
      // and only discover at run time that nothing can read it. Coverage is
      // all-or-nothing per piece, so this fails when the piece is allowlisted —
      // never in front of a customer.
      if (action.outputSchema === undefined) {
        throw new UnmappableOutputError(pieceName, actionName);
      }

      const declared = toOutputTypes(action.outputSchema);
      for (const reserved of ["count", "result"]) {
        if (reserved in declared) {
          throw new Error(
            `${pieceName}.${actionName} declares an output named "${reserved}", which Carbon adds itself.`
          );
        }
      }

      declarations[integrationStepId(pieceName, actionName)] = {
        label: `${entry.label}: ${action.displayName}`,
        permission: { module: "workflows", action: "update" },
        inputs,
        ...(Object.keys(advancedInputs).length === 0 ? {} : { advancedInputs }),
        outputs: {
          ...declared,
          // `compare` has no "is empty" operator on a list, so "did anything come
          // back?" would otherwise be inexpressible.
          count: { kind: "primitive", of: "number" },
          // The raw JSON. Kept so every already-saved workflow reading `result`
          // still works, and so a field the schema missed stays reachable.
          result: { kind: "primitive", of: "string" }
        },
        batchable: false,
        piece: { name: pieceName, action: actionName, label: entry.label }
      };
    }
  }

  return declarations;
}
