// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";
import {
  createContext,
  forwardRef,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from "react";
import { createPortal } from "react-dom";
import { cn } from "./utils/cn";
import { mergeRefs, type ReactRef, reactNodeToString } from "./utils/react";
import { useViewport } from "./Viewport";

/**
 * Base UI Tooltip wrapped to preserve the Radix-compatible API the codebase
 * already uses (`Tooltip` / `TooltipTrigger asChild` / `TooltipContent side=…`).
 *
 * Why Base UI: Radix's Tooltip swallowed the first click on a trigger that was
 * also a modal Dialog/Drawer trigger (tooltip open → focus/pointer fight on
 * close), so hovering an icon button then clicking it did nothing. Base UI's
 * tooltip composes cleanly with other triggers.
 *
 * Delay: the old Radix wrapper forced `delayDuration = 0` on every tooltip
 * (instant). Base UI's Trigger defaults to 600ms, so each Root is wrapped in a
 * Provider whose `delay` defaults to 0 to keep the original snappy behavior.
 */

const DEFAULT_DELAY = 50;

type ProviderProps = TooltipPrimitive.Provider.Props & {
  /** Radix-compat alias for Base UI's `delay`. */
  delayDuration?: number;
};

const TooltipProvider = ({ delayDuration, delay, ...props }: ProviderProps) => (
  <TooltipPrimitive.Provider
    delay={delay ?? delayDuration ?? DEFAULT_DELAY}
    {...props}
  />
);
TooltipProvider.displayName = "TooltipProvider";

type RootProps = TooltipPrimitive.Root.Props & {
  /** Radix-compat alias; mapped to the surrounding Provider's `delay`. */
  delayDuration?: number;
};

/**
 * Phones cannot hover. On compact an uncontrolled tooltip opens on tap
 * instead, but only when the tap does not land on a control the trigger wraps,
 * so icons, badges and ⓘ reveal their text while buttons and links keep doing
 * their job and keep their aria-label. Desktop is unchanged.
 */
const TapToggleContext = createContext<{
  id: string;
  toggle: () => void;
} | null>(null);

const INTERACTIVE =
  'a[href],button,input,select,textarea,[role="button"],[role="link"],[role="menuitem"],[role="checkbox"],[role="switch"],[role="tab"],[role="combobox"]';

const TapToggleRoot = ({
  onOpenChange,
  ...props
}: TooltipPrimitive.Root.Props) => {
  const id = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest?.(`[data-tooltip-tap="${id}"]`)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [id, open]);

  return (
    <TapToggleContext.Provider value={{ id, toggle: () => setOpen((o) => !o) }}>
      <TooltipPrimitive.Root
        {...props}
        open={open}
        onOpenChange={(next, ...rest) => {
          // Only a tap opens it; dismissals (Escape, blur) still close it.
          if (!next) setOpen(false);
          onOpenChange?.(next, ...rest);
        }}
      />
    </TapToggleContext.Provider>
  );
};

const TooltipRoot = (props: TooltipPrimitive.Root.Props) => {
  const { isPhone } = useViewport();
  return isPhone && props.open === undefined ? (
    <TapToggleRoot {...props} />
  ) : (
    <TooltipPrimitive.Root {...props} />
  );
};

/**
 * Base UI's tooltip popup has no role="tooltip", is unmounted while closed and
 * leaves the trigger without aria-describedby, so its text never reaches the
 * accessibility tree. Every TooltipContent therefore also renders a hidden copy
 * of its text (`TooltipText`), and the trigger points at it: as its
 * description, or — when the trigger has no name of its own (an icon) — as its
 * name. Hidden elements still count for aria-labelledby/-describedby.
 */
const TooltipTextContext = createContext<{
  id: string;
  /** The hidden copy's text; `null` while no TooltipContent is mounted. */
  value: string | null;
  setValue: (value: string | null) => void;
} | null>(null);

/** True inside the hidden copy, where popup-only parts (the arrow) render nothing. */
const HiddenCopyContext = createContext(false);

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

const noop = () => undefined;
const subscribeNothing = () => noop;
const useIsClient = () =>
  useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false
  );

const TooltipText = ({ children }: { children: ReactNode }) => {
  const text = useContext(TooltipTextContext);
  const isClient = useIsClient();
  const copy = useRef<HTMLSpanElement>(null);
  const setValue = text?.setValue;
  // Publish the rendered text so the trigger re-checks its name only when the
  // text changes, not on every render. Same value → React bails out.
  useIsomorphicLayoutEffect(() => {
    if (!setValue || !copy.current) return;
    setValue(copy.current.textContent?.trim() ?? "");
  });
  useEffect(() => {
    if (!setValue) return;
    return () => setValue(null);
  }, [setValue]);
  // Portalled to <body> so the copy never sits among the trigger's siblings,
  // where it would break `space-x-*`, `:last-child` or table markup.
  if (!text || !isClient) return null;
  return createPortal(
    <HiddenCopyContext.Provider value={true}>
      <span ref={copy} id={text.id} hidden>
        {children}
      </span>
    </HiddenCopyContext.Provider>,
    document.body
  );
};

const TooltipTextProvider = ({ children }: { children: ReactNode }) => {
  const id = useId();
  const [value, setValue] = useState<string | null>(null);
  const context = useMemo(() => ({ id, value, setValue }), [id, value]);
  return (
    <TooltipTextContext.Provider value={context}>
      {children}
    </TooltipTextContext.Provider>
  );
};

const NAMED_BY_CONTENT = "img,svg,picture,canvas";

/** The trigger's own accessible name: aria-label/-labelledby, title, alt or text. */
function ownName(el: HTMLElement, textId: string): string {
  const label = el.getAttribute("aria-label")?.trim();
  if (label) return label;
  const labelledBy = el
    .getAttribute("aria-labelledby")
    ?.split(/\s+/)
    .filter((id) => id && id !== textId)
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
    .join(" ")
    .trim();
  if (labelledBy) return labelledBy;
  const title = el.getAttribute("title")?.trim();
  if (title) return title;
  const fieldLabels = (el as HTMLInputElement).labels;
  if (fieldLabels?.length) return "label";
  let text = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.getAttribute("aria-hidden") === "true") return;
    const name =
      node.getAttribute("aria-label") ??
      (node.matches(NAMED_BY_CONTENT) ? node.getAttribute("alt") : null);
    if (name) {
      text += ` ${name}`;
      return;
    }
    node.childNodes.forEach(walk);
  };
  el.childNodes.forEach(walk);
  return text.trim();
}

type TextMode = "describe" | "label" | "none";

const NAME_PROPS = ["aria-label", "aria-labelledby", "title", "role"] as const;

/**
 * The props and text the trigger's name comes from, joined into one string:
 * the effect that reads the DOM re-runs only when this changes.
 */
function triggerNameSource(
  props: Record<string, unknown>,
  children: ReactNode,
  asChild: boolean | undefined
): string {
  const element =
    asChild && isValidElement<Record<string, unknown>>(children)
      ? children
      : null;
  const own = element ? { ...element.props, ...props } : props;
  return [
    ...NAME_PROPS.map((key) => String(own[key] ?? "")),
    reactNodeToString(
      (element ? element.props.children : children) as ReactNode
    )
  ].join("\u0000");
}

/**
 * Wires the trigger to the hidden tooltip text. A trigger with a name of its
 * own is described by it (unless the text only repeats that name); one without
 * is named by it, and a bare element (a span around an icon) becomes an image
 * so the name is exposed.
 */
function useTooltipTextProps(
  el: { current: HTMLElement | null },
  props: Record<string, unknown>,
  /** What the trigger's own name is built from, as a cheap string. */
  nameSource: string
) {
  const text = useContext(TooltipTextContext);
  const [mode, setMode] = useState<TextMode>("describe");
  // Decided once, before this hook may have added role="img" itself.
  const [bare, setBare] = useState<boolean | null>(null);
  const tipText = text?.value ?? null;

  // Reads the trigger's DOM, so it runs only when the tooltip text or what
  // names the trigger changes — not on every render of every trigger.
  useIsomorphicLayoutEffect(() => {
    const node = el.current;
    if (!node || tipText === null || !text) return;
    const name = ownName(node, text.id);
    const next: TextMode = !tipText
      ? "none"
      : !name
        ? "label"
        : name === tipText
          ? "none"
          : "describe";
    setMode(next);
    setBare(
      (wasBare) =>
        wasBare ??
        (!node.getAttribute("role") && /^(SPAN|DIV)$/.test(node.tagName))
    );
  }, [tipText, text?.id, nameSource]);

  if (tipText === null || !text || mode === "none") return props;
  const join = (own: unknown) =>
    [own, text.id].filter(Boolean).join(" ") || undefined;
  return mode === "label"
    ? {
        ...props,
        "aria-labelledby": join(props["aria-labelledby"]),
        ...(bare && !props.role ? { role: "img" } : {})
      }
    : { ...props, "aria-describedby": join(props["aria-describedby"]) };
}

// Without its own delay a tooltip joins the surrounding provider, so once one is
// open its neighbours open at once instead of each waiting out the delay again.
const Tooltip = ({ delayDuration, ...props }: RootProps) => (
  <TooltipTextProvider>
    {delayDuration === undefined ? (
      <TooltipRoot {...props} />
    ) : (
      <TooltipPrimitive.Provider delay={delayDuration}>
        <TooltipRoot {...props} />
      </TooltipPrimitive.Provider>
    )}
  </TooltipTextProvider>
);
Tooltip.displayName = "Tooltip";

type TriggerProps = TooltipPrimitive.Trigger.Props & {
  /** Radix-compat: render the single child as the trigger element. */
  asChild?: boolean;
};

const TooltipTrigger = forwardRef<HTMLButtonElement, TriggerProps>(
  ({ asChild, children, ...ownProps }, forwardedRef) => {
    const tap = useContext(TapToggleContext);
    const el = useRef<HTMLElement | null>(null);
    const ref = useMemo(
      () =>
        mergeRefs<HTMLButtonElement>(
          forwardedRef as ReactRef<HTMLButtonElement>,
          el as never
        ),
      [forwardedRef]
    );
    const rest = useTooltipTextProps(
      el,
      ownProps as Record<string, unknown>,
      triggerNameSource(ownProps as Record<string, unknown>, children, asChild)
    ) as typeof ownProps;
    const props = tap
      ? {
          ...rest,
          "data-tooltip-tap": tap.id,
          onClick: (
            event: Parameters<NonNullable<TriggerProps["onClick"]>>[0]
          ) => {
            rest.onClick?.(event);
            const hit = (event.target as Element).closest(INTERACTIVE);
            // Base UI's own trigger button (no asChild) is not a wrapped control.
            const isOwnButton = !asChild && hit === event.currentTarget;
            if (hit && !isOwnButton && event.currentTarget.contains(hit))
              return;
            tap.toggle();
          }
        }
      : rest;
    if (asChild && isValidElement(children)) {
      return (
        <TooltipPrimitive.Trigger
          ref={ref}
          render={children as ReactElement}
          {...props}
        />
      );
    }
    return (
      <TooltipPrimitive.Trigger ref={ref} {...props}>
        {children}
      </TooltipPrimitive.Trigger>
    );
  }
);
TooltipTrigger.displayName = "TooltipTrigger";

/**
 * `anchor` positions the popup against a different element than the trigger.
 * Use it when one tooltip serves many small hover targets inside its trigger
 * (a strip of bars): the content follows the hovered target, not the strip.
 */
type ContentProps = TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "side" | "sideOffset" | "align" | "alignOffset" | "anchor"
  > & {
    /**
     * Portal to `document.body` and paint above other overlays. Opt in only for a
     * tooltip inside a popover that already sits above the default layer — the
     * default `z-50` deliberately stays below modals, drawers and the palette.
     */
    elevated?: boolean;
  };

/** Anchor arrow pointing at the trigger; render as a child of TooltipContent. */
const TooltipArrow = (props: TooltipPrimitive.Arrow.Props) =>
  useContext(HiddenCopyContext) ? null : (
    <TooltipPrimitive.Arrow
      {...props}
      className={cn(
        "flex data-[side=bottom]:top-[-8px] data-[side=left]:right-[-13px] data-[side=left]:rotate-90 data-[side=right]:left-[-13px] data-[side=right]:-rotate-90 data-[side=top]:bottom-[-8px] data-[side=top]:rotate-180",
        props.className as string
      )}
    >
      <svg
        aria-hidden="true"
        width="20"
        height="10"
        viewBox="0 0 20 10"
        fill="none"
      >
        <path
          d="M9.66437 2.60207L4.80758 6.97318C4.07308 7.63423 3.11989 8 2.13172 8H0V10H20V8H18.5349C17.5468 8 16.5936 7.63423 15.8591 6.97318L11.0023 2.60207C10.622 2.2598 10.0447 2.25979 9.66437 2.60207Z"
          className="fill-popover"
        />
        <path
          d="M10.3333 3.34539L5.47654 7.71648C4.55842 8.54279 3.36693 9 2.13172 9H0V8H2.13172C3.11989 8 4.07308 7.63423 4.80758 6.97318L9.66437 2.60207C10.0447 2.25979 10.622 2.2598 11.0023 2.60207L15.8591 6.97318C16.5936 7.63423 17.5468 8 18.5349 8H20V9H18.5349C17.2997 9 16.1082 8.54278 15.1901 7.71648L10.3333 3.34539Z"
          className="fill-border"
        />
      </svg>
    </TooltipPrimitive.Arrow>
  );
TooltipArrow.displayName = "TooltipArrow";

const TooltipContent = forwardRef<HTMLDivElement, ContentProps>(
  (
    {
      className,
      side = "top",
      sideOffset = 4,
      align = "center",
      alignOffset = 0,
      anchor,
      elevated = false,
      ...props
    },
    ref
  ) => {
    // Phones have no hover: a tooltip shows only when tapped open (see
    // TapToggleRoot); controlled tooltips stay hidden.
    const { isPhone } = useViewport();
    const tap = useContext(TapToggleContext);
    const copy = <TooltipText>{props.children as ReactNode}</TooltipText>;
    if (isPhone && !tap) return copy;
    return (
      <>
        {copy}
        <TooltipPrimitive.Portal
          container={
            elevated && typeof document !== "undefined"
              ? document.body
              : undefined
          }
        >
          <TooltipPrimitive.Positioner
            side={side}
            sideOffset={sideOffset}
            align={align}
            alignOffset={alignOffset}
            anchor={anchor}
            className={elevated ? "z-[9999]" : "z-50"}
          >
            <TooltipPrimitive.Popup
              ref={ref}
              data-tooltip-tap={tap?.id}
              className={cn(
                "z-50 w-fit max-w-xs overflow-hidden rounded-md border border-border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md",
                "origin-[var(--transform-origin)] transition-[transform,opacity] duration-150 ease-out",
                "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
                "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
                "max-md:max-w-[calc(100vw-32px)] max-md:text-[0.9375rem]",
                className
              )}
              {...props}
            />
          </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
      </>
    );
  }
);
TooltipContent.displayName = "TooltipContent";

export {
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
};
