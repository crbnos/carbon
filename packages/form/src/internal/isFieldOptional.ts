import { type ZodSchema, z } from "zod";
import { stringToPathArray } from "../utils";

type UnwrapResult = {
  schema: ZodSchema;
  isOptional: boolean;
  hasDefault: boolean;
};

function unwrapSchema(
  schema: ZodSchema,
  io: "input" | "output" = "output"
): UnwrapResult {
  let current = schema;
  let isOptional = false;
  let hasDefault = false;
  const seen = new Set<ZodSchema>();

  while (true) {
    if (seen.has(current)) return { schema: current, isOptional, hasDefault };
    seen.add(current);

    const def: any = (current as any)._zod?.def ?? (current as any)._def;
    const type: string | undefined = def?.type ?? def?.typeName;

    switch (type) {
      // optionality wrappers
      case "optional":
      case "ZodOptional":
        isOptional = true;
        current = def.innerType;
        continue;

      case "default":
      case "ZodDefault":
        isOptional = true;
        hasDefault = true;
        current = def.innerType;
        continue;

      case "prefault":
        isOptional = true;
        hasDefault = true;
        current = def.innerType;
        continue;

      case "catch":
      case "ZodCatch":
        isOptional = true;
        current = def.innerType;
        continue;

      // nullable — semantically distinct from optional
      case "nullable":
      case "ZodNullable":
        current = def.innerType;
        continue;

      // transparent wrappers
      case "readonly":
      case "ZodReadonly":
        current = def.innerType;
        continue;

      case "nonoptional":
        isOptional = false;
        current = def.innerType;
        continue;

      case "promise":
      case "ZodPromise":
        current = def.innerType;
        continue;

      case "ZodBranded":
        current = def.type;
        continue;

      // lazy — resolve the thunk
      case "lazy":
      case "ZodLazy": {
        const inner = (current as any)._zod?.innerType ?? def.getter?.();
        if (!inner) return { schema: current, isOptional, hasDefault };
        current = inner;
        continue;
      }

      // pipe — direction matters
      case "pipe":
      case "ZodPipeline":
        current = io === "input" ? def.in : def.out;
        continue;

      // effects (v3 refine/transform/preprocess)
      case "ZodEffects":
        current = def.schema;
        continue;

      default:
        return { schema: current, isOptional, hasDefault };
    }
  }
}

function getChildSchema(
  schema: ZodSchema,
  segment: string | number
): ZodSchema | null {
  // Read the schema def the same v3/v4-agnostic way `unwrapSchema` does — v4 moved
  // tuple items / record value onto `_zod.def` and changed the element/value types
  // to the `$ZodType` core interface, so go through `def` and cast to `ZodSchema`.
  const def: any = (schema as any)._zod?.def ?? (schema as any)._def;

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, ZodSchema>;
    if (typeof segment !== "string") return null;
    return shape[segment] ?? null;
  }

  if (schema instanceof z.ZodArray) {
    return (schema.element as unknown as ZodSchema) ?? null;
  }

  if (schema instanceof z.ZodTuple) {
    const index =
      typeof segment === "number"
        ? segment
        : Number.isNaN(Number(segment))
          ? null
          : Number(segment);
    if (index === null) return null;
    return (def?.items?.[index] as ZodSchema) ?? null;
  }

  if (schema instanceof z.ZodRecord) {
    return (def?.valueType as ZodSchema) ?? null;
  }

  return null;
}

export function isFieldOptional(
  schema: ZodSchema | undefined,
  fieldName: string
): boolean | undefined {
  const dir = "input"; // Can be a param

  if (!schema || !fieldName) return undefined;

  const path = stringToPathArray(fieldName);
  let current: ZodSchema | null = schema;
  let optionalFromParent = false;

  for (const segment of path) {
    if (!current) return undefined;

    const unwrapped = unwrapSchema(current, dir);
    current = unwrapped.schema;
    optionalFromParent = optionalFromParent || unwrapped.isOptional;

    current = getChildSchema(current, segment);
  }

  if (!current) return undefined;

  const final = unwrapSchema(current, dir);
  return optionalFromParent || final.isOptional;
}
