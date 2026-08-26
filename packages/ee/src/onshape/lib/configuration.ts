// Pure configuration helpers for the Onshape integration: the parameter-definition types,
// the tolerant response reader, the encoder's value formatter and the BOM path builder.
//
// These live HERE rather than in `client.ts` on purpose. `client.ts` imports `@carbon/env`
// at module scope (ONSHAPE_CLIENT_ID / ONSHAPE_CLIENT_SECRET), which transitively evaluates
// INNGEST_SIGNING_KEY and THROWS on import — so anything defined there cannot be unit-tested
// without a fully populated environment. Same reasoning, and same shape, as
// `packages/jobs/src/inngest/functions/integrations/onshape-matching.ts`.

// A configuration parameter definition for an element. Onshape discriminates these on
// `btType` (BTMConfigurationParameterEnum-105 etc.); `parameterType` carries the same
// distinction in a readable form, so that is what Carbon switches on.
export type OnshapeConfigurationParameter =
  | {
      parameterType: "ENUM";
      parameterId: string;
      parameterName: string;
      defaultValue?: string;
      // `option` is the value the encoder wants; `optionName` is what the author typed.
      options: { option: string; optionName: string }[];
    }
  | {
      parameterType: "BOOLEAN";
      parameterId: string;
      parameterName: string;
      defaultValue?: boolean;
    }
  | {
      parameterType: "STRING";
      parameterId: string;
      parameterName: string;
      defaultValue?: string;
    }
  | {
      parameterType: "QUANTITY";
      parameterId: string;
      parameterName: string;
      quantityType?: string;
      rangeAndDefault?: {
        minValue?: number;
        maxValue?: number;
        defaultValue?: number;
        units?: string;
      };
    };

// The two published descriptions of this endpoint disagree on the field name: the 1.113
// OpenAPI declares `parameters`, api-generator declares `configurationParameters`. Every
// field name observed in the wild matches the latter, so prefer it — but a reader that
// accepts both costs nothing and is the difference between "no configurations" and a
// broken picker. Anything unrecognizable reads as an unconfigured element, which is
// exactly Carbon's pre-existing behavior.
export function readConfigurationParameters(
  response: unknown
): OnshapeConfigurationParameter[] {
  if (!response || typeof response !== "object") return [];
  const body = response as Record<string, unknown>;
  const raw = body.configurationParameters ?? body.parameters;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (parameter): parameter is OnshapeConfigurationParameter =>
      !!parameter &&
      typeof parameter === "object" &&
      typeof (parameter as { parameterId?: unknown }).parameterId ===
        "string" &&
      ["ENUM", "BOOLEAN", "STRING", "QUANTITY"].includes(
        (parameter as { parameterType?: unknown }).parameterType as string
      )
  );
}

// Onshape's encoder takes every parameterValue as a STRING. A QUANTITY is unit-ambiguous
// as a bare number, so its unit rides along ("500 mm"); the encoder normalizes from there.
// Booleans are "true"/"false"; enums and strings pass through.
export function formatParameterValue(
  parameter: OnshapeConfigurationParameter,
  value: string | number | boolean
): string {
  if (parameter.parameterType === "QUANTITY") {
    const units = parameter.rangeAndDefault?.units;
    return units ? `${value} ${units}` : String(value);
  }
  return String(value);
}
