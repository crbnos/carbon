import type { ItemRef, ValueOrRef, VariableRef } from "../definition/types";
import type { Resolution, RuntimeContext, RuntimeValue } from "./types";
import { fromColumn, fromLiteral, isNull } from "./values";

export async function resolveValue(
  value: ValueOrRef,
  ctx: RuntimeContext
): Promise<Resolution> {
  if (value.kind === "literal") return { ok: true, value: fromLiteral(value) };
  if (value.kind === "item") return resolveItem(value, ctx);
  return resolveRef(value, ctx);
}

export async function resolveRef(
  ref: VariableRef,
  ctx: RuntimeContext
): Promise<Resolution> {
  const outputs = ctx.outputs[ref.nodeId];
  if (outputs === undefined) {
    return {
      ok: false,
      reason: "The step that produces this value did not run."
    };
  }
  const value = outputs[ref.output];
  if (value === undefined) {
    return { ok: false, reason: `This step did not produce "${ref.output}".` };
  }
  return walk(value, ref.path, ctx);
}

export async function resolveItem(
  ref: ItemRef,
  ctx: RuntimeContext
): Promise<Resolution> {
  if (ctx.item === undefined) {
    return { ok: false, reason: "There is no current item here." };
  }
  return walk(ctx.item, ref.path, ctx);
}

/** A null anywhere along the path ends the walk as null rather than failing. */
async function walk(
  start: RuntimeValue,
  path: string[],
  ctx: RuntimeContext
): Promise<Resolution> {
  let current = start;

  for (const segment of path) {
    if (isNull(current)) return { ok: true, value: current };

    if (current.kind !== "entity") {
      return {
        ok: false,
        reason: `"${segment}" is not something this value has.`
      };
    }

    const entity = ctx.catalog.getEntity(current.of);
    if (entity === undefined) {
      return {
        ok: false,
        reason: `We no longer know what a ${current.of} is.`
      };
    }

    const property = entity.properties[segment];
    if (property === undefined) {
      return { ok: false, reason: `A ${current.of} has no "${segment}".` };
    }

    const row = current.row ?? (await ctx.loader.load(current.of, current.id));
    if (row === null) {
      return {
        ok: false,
        reason: `The ${current.of} this refers to could not be read.`
      };
    }

    current = fromColumn(property, row[segment]);
  }

  return { ok: true, value: current };
}
