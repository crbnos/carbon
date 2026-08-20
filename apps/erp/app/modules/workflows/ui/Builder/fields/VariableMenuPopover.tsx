import { Popover, PopoverAnchor, PopoverContent } from "@carbon/react";
import type { ItemRef, ValueType, VariableRef } from "@carbon/workflows";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { decodeTokenId } from "./tokenId";
import type { FieldContext } from "./types";
import { useVariableMenuData } from "./useVariableMenuData";
import { VariableTreeMenu } from "./VariableTreeMenu";

type Props = {
  /** Omit to accept any type. */
  accepts?: ValueType;
  context: FieldContext;
  onChange: (next: VariableRef | ItemRef) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The control the popup anchors to. */
  children: ReactNode;
};

/** The browse route into the same menu the `{` trigger opens, for controls you cannot type
 * a brace into. The search box stays mounted while you drill. */
export function VariableMenuPopover({
  accepts,
  context,
  onChange,
  open,
  onOpenChange,
  children
}: Props) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const getMenuData = useVariableMenuData(context, accepts);

  // Where focus goes when the menu closes. Radix normally returns it to its trigger, but
  // this menu is anchored rather than triggered, so it has to be remembered here.
  const returnFocusTo = useRef<HTMLElement | null>(null);

  // Built when the popup opens, not subscribed: `nodes` is replaced every drag frame.
  // Keyed off `open` rather than the open-change callback, because the control opens this
  // itself (the `{}` button, a typed brace) without Radix ever reporting a change.
  const [data, setData] = useState<ReturnType<typeof getMenuData> | null>(null);
  useEffect(() => {
    setQuery("");
    if (open) {
      returnFocusTo.current = document.activeElement as HTMLElement | null;
      setData(getMenuData());
      return;
    }
    setData(null);
    returnFocusTo.current?.focus();
    returnFocusTo.current = null;
  }, [open, getMenuData]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {/* An anchor, not a trigger: the control holds a Select and text inputs of its own,
          and a trigger would toggle the menu on every click landing in any of them. */}
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        align="start"
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        className="w-[var(--radix-popover-trigger-width)] min-w-[320px] p-0"
      >
        <input
          // The popup exists to be typed into, and it only opens on an explicit request.
          autoFocus
          className="h-10 w-full border-b border-border bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
          placeholder={t`Search variables…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {/* Remounted per open so the drill level and highlight reset with it. */}
        <VariableTreeMenu
          key={open ? "open" : "closed"}
          tree={data?.tree ?? []}
          flat={data?.flat ?? []}
          emptyReason={data?.emptyReason}
          query={query}
          onSelect={(item) => {
            const ref = decodeTokenId(item.id);
            // Never emit a malformed ref — leave the menu open instead.
            if (!ref) return;
            onChange(ref);
            onOpenChange(false);
          }}
          backspacePops
        />
      </PopoverContent>
    </Popover>
  );
}
