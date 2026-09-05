import { z } from "zod";
import { stringToPathArray } from "../utils";

// v4's wrapper generics default to the core `$ZodType` interface; every schema
// an app hands the form library is built with the classic API, so re-viewing an
// unwrapped child as a classic `ZodType` is sound.
const classic = (schema: z.core.$ZodType): z.ZodType => schema as z.ZodType;

type UnwrapResult = {
  schema: z.ZodType;
  isOptional: boolean;
  hasDefault: boolean;
};

function unwrapSchema(
  schema: z.ZodType,
  io: "input" | "output" = "output"
): UnwrapResult {
  let current = schema;
  let isOptional = false;
  let hasDefault = false;
  const seen = new Set<z.ZodType>();

  while (!seen.has(current)) {
    seen.add(current);

    if (current instanceof z.ZodOptional) {
      isOptional = true;
      current = classic(current.unwrap());
    } else if (
      current instanceof z.ZodDefault ||
      current instanceof z.ZodPrefault
    ) {
      isOptional = true;
      hasDefault = true;
      current = classic(current.unwrap());
    } else if (current instanceof z.ZodCatch) {
      isOptional = true;
      current = classic(current.unwrap());
    } else if (current instanceof z.ZodNonOptional) {
      isOptional = false;
      current = classic(current.unwrap());
    } else if (
      // nullable is semantically distinct from optional; the rest are transparent
      current instanceof z.ZodNullable ||
      current instanceof z.ZodReadonly ||
      current instanceof z.ZodPromise ||
      current instanceof z.ZodLazy
    ) {
      current = classic(current.unwrap());
    } else if (current instanceof z.ZodPipe) {
      // Direction matters — except that a preprocess pipe (zfd.text, zfd.numeric,
      // z.preprocess) carries a bare transform on its input side, which accepts
      // anything: whether the FIELD is required is decided by what the output
      // side demands. Walking into the transform reported every optional zfd
      // field as required.
      const side =
        io === "input" && !(current.in instanceof z.ZodTransform)
          ? current.in
          : current.out;
      current = classic(side);
    } else {
      break;
    }
  }

  return { schema: current, isOptional, hasDefault };
}

function getChildSchema(
  schema: z.ZodType,
  segment: string | number
): z.ZodType | null {
  if (schema instanceof z.ZodObject) {
    if (typeof segment !== "string") return null;
    const child = (schema.shape as Record<string, z.core.$ZodType>)[segment];
    return child ? classic(child) : null;
  }

  if (schema instanceof z.ZodArray) {
    return classic(schema.element);
  }

  if (schema instanceof z.ZodTuple) {
    const index =
      typeof segment === "number"
        ? segment
        : Number.isNaN(Number(segment))
          ? null
          : Number(segment);
    if (index === null) return null;
    const item = schema.def.items[index];
    return item ? classic(item) : null;
  }

  if (schema instanceof z.ZodRecord) {
    return classic(schema.valueType);
  }

  return null;
}

export function isFieldOptional(
  schema: z.ZodType | undefined,
  fieldName: string
): boolean | undefined {
  // Fields receive caller input, so requiredness is judged on the input side.
  const dir = "input";

  if (!schema || !fieldName) return undefined;

  const path = stringToPathArray(fieldName);
  let current: z.ZodType | null = schema;
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
