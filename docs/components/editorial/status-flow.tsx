"use client";

/* Status lifecycle as one interactive widget — the warm-paper replacement for a linear
 * `| Status | Meaning |` table. A single bordered card: the happy-path states as selectable
 * badges joined by arrows, off-track states (branch like Paused, terminal like Cancelled) on a
 * second row, and an integrated detail footer showing the selected state's meaning. Selecting a
 * badge (click, or arrow keys within the group) updates the footer.
 *
 * The badges are styled to MATCH the real Carbon `<Status>` badge (@carbon/react) — light colored
 * fill, dark same-hue text, uppercase, with the same lucide status icon per color — so a reader
 * builds the same visual memory as the app. The color for each status is the real ERP color,
 * resolved from `@carbon/utils/status-colors` via the `entity` prop, so the docs can't drift. The
 * badge classes are duplicated here (not imported as strings) so the docs' Tailwind scanner emits
 * them. Meanings are authored MDX (so <Term>/`code`/*italics* render); the footer uses `[&>p]:m-0`
 * because MDX wraps the text child in a <p>. */

import {
  STATUS_COLOR_HEX,
  statusColor,
  type StatusColor,
  type StatusEntity,
} from "@carbon/utils/status-colors";
import {
  Children,
  type ComponentType,
  Fragment,
  isValidElement,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useRef,
  useState,
} from "react";

type StatusProps = {
  name: string;
  accent?: boolean;
  branch?: boolean;
  terminal?: boolean;
  children?: ReactNode;
};

/* Pure data carrier — StatusFlow reads its props; it renders nothing itself. */
export function Status(_props: StatusProps): null {
  return null;
}

type Item = StatusProps & { idx: number };

/* Inline lucide-style status icons (same glyphs as the app's @carbon/react Status) — drawn here
 * so the docs don't take a lucide-react dependency. 24-box, currentColor stroke. */
type IconProps = { className?: string };
function CircleCheck({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
function CircleAlert({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}
function CircleSlash({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M9 15 15 9" />
    </svg>
  );
}
function Clock({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}
function LoaderCircle({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
function CircleDashed({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2.7 3.2" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}
function Star({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2.5l2.7 5.92 6.3.5-4.8 4.06 1.5 6.02L12 16.9l-5.7 3.1 1.5-6.02-4.8-4.06 6.3-.5z" />
    </svg>
  );
}

/* Mirror of the @carbon/react Status/Badge variants (light mode) — fill + text + border + icon
 * per semantic color. Kept in this file so Tailwind sees the class names. */
const BADGE: Record<StatusColor, { cls: string; Icon: ComponentType<{ className?: string }> }> = {
  green: { cls: "bg-emerald-100 text-emerald-800 border-emerald-500/20", Icon: CircleCheck },
  yellow: { cls: "bg-yellow-100 text-yellow-800 border-yellow-500/20", Icon: Clock },
  orange: { cls: "bg-orange-100 text-orange-800 border-orange-500/20", Icon: CircleAlert },
  red: { cls: "bg-red-100 text-red-800 border-red-500/20", Icon: CircleSlash },
  blue: { cls: "bg-blue-100 text-blue-800 border-blue-500/20", Icon: LoaderCircle },
  gray: { cls: "bg-ed-warm-300/50 text-[#32302c] border-transparent", Icon: CircleDashed },
  purple: { cls: "bg-violet-100 text-violet-800 border-violet-500/20", Icon: Star },
};

const BADGE_BASE =
  "inline-flex items-center gap-[5px] rounded-md border px-2 py-1 text-ed-11 font-bold uppercase tracking-tight leading-none whitespace-nowrap";

export function StatusFlow({
  children,
  label,
  entity,
}: {
  children?: ReactNode;
  label?: string;
  /** ERP entity id — resolves each status's real UI color (matching the app badge) from @carbon/utils. */
  entity?: StatusEntity;
}) {
  const items: Item[] = Children.toArray(children)
    .filter((c): c is ReactElement<StatusProps> => isValidElement(c))
    .map((c, idx) => ({ idx, ...c.props }));

  const mainItems = items.filter((s) => !s.branch && !s.terminal);
  const offItems = items.filter((s) => s.branch || s.terminal);

  const accentIdx = items.findIndex((s) => s.accent);
  const [sel, setSel] = useState(accentIdx >= 0 ? accentIdx : 0);
  const selected = items[sel] ?? items[0];

  const colorOf = (s: StatusProps): StatusColor =>
    (entity ? statusColor(entity, s.name) : undefined) ?? "gray";

  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (dir: 1 | -1) => {
    const next = Math.min(items.length - 1, Math.max(0, sel + dir));
    setSel(next);
    refs.current[next]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      setSel(0);
      refs.current[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      setSel(items.length - 1);
      refs.current[items.length - 1]?.focus();
    }
  };

  const ariaLabel =
    label ??
    `Status lifecycle: ${mainItems.map((s) => s.name).join(" → ")}` +
      (offItems.length ? `; off-track states: ${offItems.map((s) => s.name).join(", ")}` : "");

  const pill = (s: Item) => {
    const color = colorOf(s);
    const { cls, Icon } = BADGE[color];
    const isSel = sel === s.idx;
    return (
      <button
        key={s.idx}
        type="button"
        ref={(el) => {
          refs.current[s.idx] = el;
        }}
        aria-pressed={isSel}
        tabIndex={isSel ? 0 : -1}
        onClick={() => setSel(s.idx)}
        className={`${BADGE_BASE} ${cls} cursor-pointer focus-visible:outline-none`}
        // Selection = a ring in the status's real color (paper gap then color), tying it to the app.
        style={
          isSel
            ? { boxShadow: `0 0 0 2px var(--color-ed-paper), 0 0 0 3.5px ${STATUS_COLOR_HEX[color]}` }
            : undefined
        }
      >
        <Icon className="h-3 w-3 shrink-0" />
        {s.name}
      </button>
    );
  };

  if (!selected) return null;

  const selColor = colorOf(selected);
  const SelIcon = BADGE[selColor].Icon;

  return (
    <figure className="my-9 overflow-hidden rounded-[14px] border border-ed-hairline bg-ed-paper">
      <div
        role="group"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        className="flex flex-col gap-3 px-[18px] pt-[18px] pb-4"
      >
        <div className="flex flex-wrap items-center gap-x-1 gap-y-2.5">
          {mainItems.map((s, j) => (
            <Fragment key={s.idx}>
              {j > 0 && (
                <span aria-hidden="true" className="px-0.5 text-ed-14 leading-none text-ed-ink-45">
                  →
                </span>
              )}
              {pill(s)}
            </Fragment>
          ))}
        </div>
        {offItems.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-ed-10 font-semibold uppercase tracking-[0.08em] text-ed-ink-45">
              Off-track
            </span>
            {offItems.map((s) => pill(s))}
          </div>
        )}
      </div>

      {/* Integrated detail footer — one card, not a separate callout */}
      <div aria-live="polite" className="border-t border-ed-hairline bg-ed-inset px-[18px] py-[15px]">
        <div key={sel} className="animate-in fade-in-0 duration-200 motion-reduce:animate-none">
          <span className={`${BADGE_BASE} ${BADGE[selColor].cls}`}>
            <SelIcon className="h-3 w-3 shrink-0" />
            {selected.name}
          </span>
          <div className="mt-2.5 text-ed-13 leading-[1.6] text-ed-ink-66 [&>p]:m-0 [&>p]:text-ed-13 [&>p]:leading-[1.6]">
            {selected.children}
          </div>
        </div>
      </div>
    </figure>
  );
}
