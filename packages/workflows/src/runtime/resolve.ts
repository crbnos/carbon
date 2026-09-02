import type { LinkFormat } from "../definition/catalog";
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
  nullValue,
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
  // Neither rows nor objects have a reading as a sentence, and `rendersAsText`
  // keeps both out of a template — this is the belt to that suspenders.
  if (value.kind === "pairs" || value.kind === "record") return "";
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
  // The catalog's own display columns first, then the conventional ones: an entity
  // that declares none still reads by the name it carries rather than by its id.
  const columns = [
    ...(ctx.catalog.getEntity(value.of)?.display ?? []),
    ...INLINE_ENTITY_COLUMNS
  ];
  return (
    pickDisplay(value.row, columns) ??
    pickDisplay(await ctx.loader.load(value.of, value.id), columns) ??
    value.id
  );
}

/** One entry per destination dialect. A record's NAME is customer data, so each
 * renderer sanitises the label until it cannot break out of its own link; the href
 * is Carbon's own URL from `linkFor`, never user text. */
const LINK_RENDERERS: Record<
  LinkFormat,
  (label: string, href: string) => string
> = {
  // The link matcher's label cannot hold a `]` and honours no backslash escape, so a
  // record named `PO](…)` would end the label early and pick the destination itself.
  // Drop the brackets; a name that is nothing but brackets stays unlinked.
  markdown: (label, href) => {
    const clean = label.replace(/[[\]]/g, "").trim();
    return clean === "" ? label : `[${clean}](${href})`;
  },
  // Slack mrkdwn `<url|label>`: `&`, `<`, `>` are the only escapes and `|` would end
  // the label early, so it is dropped the way markdown drops brackets.
  slack: (label, href) => {
    const clean = label
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("|", "");
    return clean.trim() === "" ? label : `<${href}|${clean}>`;
  },
  html: (label, href) => {
    const escape = (raw: string) =>
      raw
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    return `<a href="${escape(href)}">${escape(label)}</a>`;
  }
};

/** How a template turns a record into a link: where it lives, and in whose dialect. */
export interface RenderOptions {
  linkFor?: (of: string, id: string) => string | null;
  /** Defaults to markdown — the dialect Carbon's own notification renderer reads. */
  format?: LinkFormat;
}

/**
 * A record in prose reads as its name, and becomes a link when the caller knows
 * where it lives — in the destination's own dialect. Every other value renders
 * exactly as `renderValue` does — a LIST of records never reaches here, because
 * `rendersAsText` refuses one as a template part.
 */
export async function renderPart(
  value: RuntimeValue,
  ctx: RuntimeContext,
  options?: RenderOptions
): Promise<string> {
  if (value.kind !== "entity") return renderValue(value);
  const text = await entityText(value, ctx);
  if (options?.linkFor === undefined || text === "") return text;
  const href = options.linkFor(value.of, value.id);
  if (href === null) return text;
  return LINK_RENDERERS[options.format ?? "markdown"](text, href);
}

/** An unresolvable part fails the whole template; a blank would be a silent lie. */
export async function renderTemplate(
  template: Template,
  ctx: RuntimeContext,
  options?: RenderOptions
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
    pieces.push(await renderPart(resolved.value, ctx, options));
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
export async function walk(
  start: RuntimeValue,
  path: string[],
  ctx: RuntimeContext
): Promise<Resolution> {
  let current = start;

  for (const segment of path) {
    if (isNull(current)) return { ok: true, value: current };

    // A record holds its data inline, so there is nothing to load. A field the
    // vendor did not send reads as null rather than failing the step — the schema
    // it was declared from is the vendor's, and nothing validates it.
    if (current.kind === "record") {
      current = current.fields[segment] ?? nullValue();
      continue;
    }

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
