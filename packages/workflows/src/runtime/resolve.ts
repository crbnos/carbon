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

/** All a SYNCHRONOUS reading of a record can offer: no catalog to ask which column names it,
 * no loader to fetch one. `entityText` is what names a record properly. */
const INLINE_ENTITY_COLUMNS = ["readableId", "name"];

/** The first of `columns` this row holds a non-blank value for. */
function pickDisplay(
  row: Record<string, unknown> | null | undefined,
  columns: readonly string[]
): string | undefined {
  if (row === null || row === undefined) return undefined;
  for (const column of columns) {
    const raw = row[column];
    if (raw === null || raw === undefined) continue;
    const text = String(raw).trim();
    if (text !== "") return text;
  }
  return undefined;
}

/** How one resolved value reads inside a sentence. */
export function renderValue(value: RuntimeValue): string {
  if (isNull(value)) return "";
  if (value.kind === "list") return value.items.map(renderValue).join(", ");
  if (value.kind === "entity")
    return pickDisplay(value.row, INLINE_ENTITY_COLUMNS) ?? value.id;
  // Rows have no reading as a sentence; nothing writes one into text.
  if (value.kind === "pairs") return "";
  return value.value === null ? "" : String(value.value);
}

/** How a record READS: the name a person would recognise it by — `SO000123`, not `so_x8f2`.
 * The row is fetched when the value carries no snapshot, which is most of them: a moment
 * output, a created record and a foreign key all arrive as a bare id. Reads go through the
 * loader, so they are the owner's and cached for the run; an unreadable one falls back to
 * the id rather than failing a message over a label. */
async function entityText(
  value: Extract<RuntimeValue, { kind: "entity" }>,
  ctx: RuntimeContext
): Promise<string> {
  const columns = ctx.catalog.getEntity(value.of)?.display ?? [];
  return (
    pickDisplay(value.row, columns) ??
    pickDisplay(await ctx.loader.load(value.of, value.id), columns) ??
    value.id
  );
}

/**
 * A record in prose reads as its name, and becomes a markdown link when the caller knows
 * where it lives. Every other value renders exactly as `renderValue` does — a LIST of
 * records never reaches here, because `rendersAsText` refuses one as a template part.
 */
async function renderPart(
  value: RuntimeValue,
  ctx: RuntimeContext,
  linkFor?: (of: string, id: string) => string | null
): Promise<string> {
  if (value.kind !== "entity") return renderValue(value);
  const text = await entityText(value, ctx);
  if (linkFor === undefined || text === "") return text;
  const href = linkFor(value.of, value.id);
  if (href === null) return text;
  // The link matcher's label cannot hold a `]` and honours no backslash escape, so a record
  // named `PO](…)` would end the label early and pick the destination itself. Drop the
  // brackets; a name that is nothing but brackets stays unlinked.
  const label = text.replace(/[[\]]/g, "").trim();
  return label === "" ? text : `[${label}](${href})`;
}

/** An unresolvable part fails the whole template; a blank would be a silent lie. */
export async function renderTemplate(
  template: Template,
  ctx: RuntimeContext,
  options?: { linkFor?: (of: string, id: string) => string | null }
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
    pieces.push(await renderPart(resolved.value, ctx, options?.linkFor));
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
