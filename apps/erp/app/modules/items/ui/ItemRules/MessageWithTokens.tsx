import { useControlField, useField, useFormStateContext } from "@carbon/form";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FormControl,
  FormErrorMessage,
  FormLabel,
  HStack
} from "@carbon/react";
import {
  type Condition,
  FIELD_REGISTRY,
  type FieldDef,
  getFieldDef,
  type TransactionSurface
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { MouseEvent, ReactNode, TextareaHTMLAttributes } from "react";
import { useCallback, useMemo, useRef } from "react";
import { LuBraces } from "react-icons/lu";

type MessageWithTokensProps = {
  name: string;
  label?: string;
  /**
   * Live conditions from `RuleBuilder`. Each contributes a section with
   * `{condition[N].field|operator|value}` tokens that resolve at eval time
   * to the rule's required values rather than the runtime ctx.
   */
  conditions?: Condition[];
  /**
   * Form-field name of the surfaces multi-select (default `"surfaces"`).
   * Read live via `useControlField` so the dropdown updates when the user
   * toggles surface scope without prop drilling.
   */
  surfacesFieldName?: string;
};

type TokenItem = { token: string; description: string };
type TokenGroup = { heading: string; tokens: TokenItem[] };

/**
 * Maps each surface to the ctx-block keys whose fields will be populated
 * at eval time. Used to filter the FIELD_REGISTRY into a relevant
 * suggestion list.
 */
const CTX_KEYS_BY_SURFACE: Record<TransactionSurface, FieldDef["context"][]> = {
  receipt: ["storage", "transaction"],
  shipment: ["storage", "transaction"],
  stockTransfer: ["storage", "transaction"],
  warehouseTransfer: ["storage", "transaction"],
  inventoryAdjustment: ["storage", "transaction"]
};

const CONTEXT_LABELS: Record<FieldDef["context"], string> = {
  item: "Item",
  storage: "Storage",
  transaction: "Transaction"
};

// Index `FIELD_REGISTRY` once at module scope. The original code re-filtered
// the registry for each context on every `groups` recompute (one filter
// per ctx key on every conditions/surfaces change). One pass at load,
// bucketed by context — `O(n)` once instead of `O(n)` per ctx per render.
const FIELDS_BY_CTX: Record<FieldDef["context"], FieldDef[]> = {
  item: [],
  storage: [],
  transaction: []
};
for (const f of FIELD_REGISTRY) FIELDS_BY_CTX[f.context].push(f);

// Stable references for default values. `surfacesValue ?? []` would
// allocate a fresh `[]` every render, busting the `groups` memo — and
// re-running the per-condition token assembly even when nothing changed.
const EMPTY_SURFACES: TransactionSurface[] = [];
const ORDERED_CTX: FieldDef["context"][] = ["storage", "transaction"];

// Hoist the static icon node — re-rendering the parent doesn't need to
// reallocate the icon element (rendering-hoist-jsx).
const BRACES_ICON = <LuBraces />;

// Mirror of the runtime `TOKEN_RE` in packages/utils/src/itemRules.ts so the
// editor highlights exactly what `interpolateMessage` will substitute — no
// false greens, no missed reds. Inlined rather than re-exported to avoid a
// UI → runtime import cycle.
const TOKEN_RE =
  /\{(condition\[\d+\]\.(?:field|operator|value)|[a-zA-Z_][\w.]*)\}/g;

// Runtime accepts arbitrary suffixes under `item.customFields.*` via the
// generic dotted-path resolver. Treat any such token as known so the editor
// stops painting valid custom-field references as errors.
const CUSTOM_FIELD_PREFIX = "item.customFields.";

// Only background + ring — text stays `text-transparent` (inherited from
// the overlay) so the textarea's real glyphs show through cleanly. Adding a
// text color here would render duplicate, mis-aligned text on top of the
// caret layer.
const KNOWN_TOKEN_CLS = "rounded-sm bg-blue-500/25 ring-1 ring-blue-500/50";
const UNKNOWN_TOKEN_CLS =
  "rounded-sm bg-destructive/20 ring-1 ring-destructive/50";

export default function MessageWithTokens({
  name,
  label,
  conditions,
  surfacesFieldName = "surfaces"
}: MessageWithTokensProps) {
  const { t } = useLingui();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [surfacesValue] =
    useControlField<TransactionSurface[]>(surfacesFieldName);
  const surfaces = surfacesValue ?? EMPTY_SURFACES;

  const { getInputProps, error, defaultValue } = useField(name);
  const [value, setValue] = useControlField<string>(name);
  const text = (value ?? defaultValue ?? "") as string;

  const formState = useFormStateContext();
  const isDisabled = formState.isDisabled;
  const isReadOnly = formState.isReadOnly;
  const isLocked = isDisabled || isReadOnly;

  const insertToken = useCallback(
    (token: string) => {
      const el = textareaRef.current;
      if (!el) return;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const insertion = `{${token}}`;
      const next = el.value.slice(0, start) + insertion + el.value.slice(end);
      setValue(next);
      // Defer so React commits the new value before we move the caret.
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        const cursor = start + insertion.length;
        ta.setSelectionRange(cursor, cursor);
        ta.focus();
      });
    },
    [setValue]
  );

  // One handler for all token rows. Each item stamps its token onto
  // `data-token`; we read it off the event target instead of allocating a
  // fresh `() => insertToken(tok.token)` closure per item per render.
  const handleTokenSelect = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const token = e.currentTarget.dataset.token;
      if (token) insertToken(token);
    },
    [insertToken]
  );

  const syncScroll = useCallback(() => {
    const ta = textareaRef.current;
    const ov = overlayRef.current;
    if (!ta || !ov) return;
    ov.scrollTop = ta.scrollTop;
    ov.scrollLeft = ta.scrollLeft;
  }, []);

  const groups = useMemo<TokenGroup[]>(() => {
    const out: TokenGroup[] = [];
    const conds = conditions ?? [];

    // 1. Per-condition tokens.
    conds.forEach((c, i) => {
      const def = getFieldDef(c.field);
      out.push({
        heading: `Condition ${i + 1}: ${def?.label ?? c.field}`,
        tokens: [
          {
            token: `condition[${i}].field`,
            description: "Field name"
          },
          {
            token: `condition[${i}].operator`,
            description: "Operator"
          },
          {
            token: `condition[${i}].value`,
            description: "Required value"
          }
        ]
      });
    });

    // 2. Item ctx tokens — always populated regardless of surface.
    //    Includes display-only tokens (`item.id`, `item.name`) on top of
    //    the predicate-eligible fields from `FIELD_REGISTRY`.
    const itemTokens: TokenItem[] = [
      // `item.id` is the readable id (e.g. "PART-001"), not the UUID — see
      // `evaluateLinesForSurface` where the ctx is normalised.
      { token: "item.id", description: "Readable ID (e.g. PART-001)" },
      { token: "item.name", description: "Display name" }
    ];
    for (const f of FIELDS_BY_CTX.item)
      itemTokens.push({ token: f.path, description: f.label });
    out.push({ heading: CONTEXT_LABELS.item, tokens: itemTokens });

    // 3. Surface-relevant ctx tokens. Compute the union of ctx keys
    //    populated by any selected surface; hide groups no surface uses.
    const allowedCtx = new Set<FieldDef["context"]>();
    for (const s of surfaces) {
      const keys = CTX_KEYS_BY_SURFACE[s];
      if (!keys) continue;
      for (const k of keys) allowedCtx.add(k);
    }
    for (const ctxKey of ORDERED_CTX) {
      if (!allowedCtx.has(ctxKey)) continue;
      const fields = FIELDS_BY_CTX[ctxKey];
      if (fields.length === 0) continue;
      const tokens: TokenItem[] = [];
      for (const f of fields)
        tokens.push({ token: f.path, description: f.label });
      out.push({ heading: CONTEXT_LABELS[ctxKey], tokens });
    }

    return out;
  }, [conditions, surfaces]);

  const knownTokens = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) for (const tok of g.tokens) set.add(tok.token);
    return set;
  }, [groups]);

  // Single-pass element emit. Skips the intermediate `parts` array
  // allocation, the iterator object from `matchAll`, and the per-segment
  // shape objects. Reset `lastIndex` because `TOKEN_RE` is a shared
  // module-scope `/g` regex.
  const highlighted = useMemo<ReactNode[]>(() => {
    const out: ReactNode[] = [];
    TOKEN_RE.lastIndex = 0;
    let last = 0;
    let key = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN_RE.exec(text)) !== null) {
      const idx = m.index;
      if (idx > last) out.push(text.slice(last, idx));
      const inner = m[1] ?? "";
      const known =
        knownTokens.has(inner) || inner.startsWith(CUSTOM_FIELD_PREFIX);
      out.push(
        <mark
          key={key++}
          className={known ? KNOWN_TOKEN_CLS : UNKNOWN_TOKEN_CLS}
        >
          {m[0]}
        </mark>
      );
      last = idx + m[0].length;
      // Defensive: zero-length match would loop forever. The regex can't
      // match empty since it requires at least `{` + ident + `}`, but the
      // bump keeps a future regex change safe.
      if (m[0].length === 0) TOKEN_RE.lastIndex++;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }, [text, knownTokens]);

  // Identical typography between the overlay and the textarea — any drift
  // here desyncs the highlighted rectangles from the rendered glyphs.
  const sharedTypography =
    "px-3 py-2 text-sm leading-[1.25rem] font-sans whitespace-pre-wrap break-words";

  const inputProps = getInputProps<TextareaHTMLAttributes<HTMLTextAreaElement>>(
    {
      id: name,
      placeholder: t`Shown to the user when this rule fails.`
    }
  );

  return (
    <FormControl isInvalid={!!error}>
      {label && <FormLabel htmlFor={name}>{label}</FormLabel>}
      <div className="relative w-full">
        <div
          ref={overlayRef}
          aria-hidden="true"
          // `pb-[1lh]` reserves a trailing line so the overlay's last row
          // stays glued to the textarea's last row — without it an
          // unterminated final line gets clipped on scroll.
          className={cn(
            "pointer-events-none absolute inset-0 overflow-hidden rounded-md border border-transparent text-transparent pb-[1lh]",
            sharedTypography,
            isDisabled && "opacity-50",
            isReadOnly && "bg-muted"
          )}
        >
          {highlighted}
        </div>
        <textarea
          {...inputProps}
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setValue(e.target.value);
            inputProps.onChange?.(e);
          }}
          onBlur={(e) => inputProps.onBlur?.(e)}
          onScroll={syncScroll}
          disabled={isDisabled}
          readOnly={isReadOnly}
          className={cn(
            "relative flex min-h-[2lh] max-h-[10lh] w-full rounded-md border border-input bg-transparent ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 read-only:bg-muted read-only:cursor-not-allowed",
            sharedTypography
          )}
        />
      </div>
      {error && <FormErrorMessage>{error}</FormErrorMessage>}
      <HStack className="justify-end mt-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={BRACES_ICON}
              isDisabled={isLocked}
            >
              <Trans>Insert token</Trans>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-[420px] overflow-y-auto">
            {groups.map((group, gi) => (
              <DropdownMenuGroup key={`${group.heading}-${gi}`}>
                {gi > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider">
                  {group.heading}
                </DropdownMenuLabel>
                {group.tokens.map((tok) => (
                  <DropdownMenuItem
                    key={tok.token}
                    data-token={tok.token}
                    onClick={handleTokenSelect}
                    className="flex items-center gap-2"
                  >
                    <span className="font-mono text-xs">{`{${tok.token}}`}</span>
                    <span className="text-muted-foreground text-xs">
                      {tok.description}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </HStack>
    </FormControl>
  );
}
