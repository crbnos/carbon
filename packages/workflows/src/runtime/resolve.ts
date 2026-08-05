import type {
  ItemRef,
  Pairs,
  Template,
  ValueOrRef,
  VariableRef
} from "../definition/types";
import type { Resolution, RuntimeContext, RuntimeValue } from "./types";
import {
  fromColumn,
  fromLiteral,
  isNull,
  pairsValue,
  primitiveValue
} from "./values";

export async function resolveValue(
  value: ValueOrRef,
  ctx: RuntimeContext
): Promise<Resolution> {
  if (value.kind === "literal") return { ok: true, value: fromLiteral(value) };
  if (value.kind === "item") return resolveItem(value, ctx);
  if (value.kind === "template") return renderTemplate(value, ctx);
  if (value.kind === "pairs") return resolvePairs(value, ctx);
  return resolveRef(value, ctx);
}

/** How one resolved value reads inside a sentence. */
export function renderValue(value: RuntimeValue): string {
  if (isNull(value)) return "";
  if (value.kind === "list") return value.items.map(renderValue).join(", ");
  if (value.kind === "entity") {
    const readable = value.row?.readableId ?? value.row?.name;
    return readable === undefined || readable === null
      ? value.id
      : String(readable);
  }
  // Rows have no reading as a sentence; nothing writes one into text.
  if (value.kind === "pairs") return "";
  return value.value === null ? "" : String(value.value);
}

/** An unresolvable part fails the whole template; a blank would be a silent lie. */
export async function renderTemplate(
  template: Template,
  ctx: RuntimeContext
): Promise<Resolution> {
  const pieces: string[] = [];
  for (const part of template.parts) {
    if (part.kind === "text") {
      pieces.push(part.text);
      continue;
    }
    const resolved =
      part.kind === "item"
        ? await resolveItem(part, ctx)
        : await resolveRef(part, ctx);
    if (!resolved.ok) return resolved;
    pieces.push(renderValue(resolved.value));
  }
  return { ok: true, value: primitiveValue("string", pieces.join("")) };
}

/** One unresolvable row fails the whole set, exactly as one bad part fails a template:
 * a request sent with a header quietly missing is worse than one not sent at all. */
export async function resolvePairs(
  pairs: Pairs,
  ctx: RuntimeContext
): Promise<Resolution> {
  const entries: { name: string; value: RuntimeValue }[] = [];
  for (const entry of pairs.entries) {
    if (entry.name.trim() === "") continue;
    const resolved = await resolveValue(entry.value, ctx);
    if (!resolved.ok) return resolved;
    entries.push({ name: entry.name.trim(), value: resolved.value });
  }
  return { ok: true, value: pairsValue(entries) };
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
