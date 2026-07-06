import { cn } from "@carbon/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LuChevronDown } from "react-icons/lu";

export interface FilterOption {
  value: string;
  label: string;
}

// The menu renders in a portal so it isn't clipped by the ToolBrowser card's
// `overflow-hidden` (used to round the row corners). Closes on outside-click,
// scroll, or resize.
export function FilterSelect({
  value,
  options,
  placeholder,
  onChange
}: {
  value: string;
  options: FilterOption[];
  placeholder: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t))
        return;
      setOpen(false);
    };
    const dismiss = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  const toggle = () => {
    if (!open) setRect(triggerRef.current?.getBoundingClientRect() ?? null);
    setOpen((o) => !o);
  };
  const select = (v: string) => {
    onChange(v);
    setOpen(false);
  };
  const current = options.find((o) => o.value === value);

  const optionClass = (selected: boolean) =>
    cn(
      "block w-full text-left px-[10px] py-[7px] border-none bg-transparent rounded-md text-[0.8rem] text-foreground cursor-pointer font-[inherit] whitespace-nowrap transition-[background,color] duration-[120ms] hover:bg-muted",
      selected && "text-[var(--acc)] bg-[var(--acc-tint-strong)] font-semibold"
    );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          "inline-flex items-center gap-2 h-[38px] px-[11px] border bg-card rounded-lg text-[0.8rem] font-semibold text-foreground cursor-pointer whitespace-nowrap transition-[border-color,box-shadow] duration-150",
          open
            ? "border-[var(--acc)] shadow-[0_0_0_3px_var(--acc-ring)]"
            : "border-border hover:border-muted-foreground"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className={cn(!current && "text-muted-foreground font-medium")}>
          {current ? current.label : placeholder}
        </span>
        <LuChevronDown
          size={14}
          className={cn(
            "text-muted-foreground shrink-0 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={{
              position: "fixed",
              top: rect.bottom + 6,
              left: rect.left,
              minWidth: rect.width
            }}
            className="max-h-[280px] overflow-auto bg-card border border-border rounded-[10px] shadow-[0_1px_2px_rgba(0,0,0,0.05),0_14px_30px_-12px_rgba(0,0,0,0.22)] p-[5px] z-[1000] flex flex-col gap-px"
          >
            <button
              type="button"
              role="option"
              aria-selected={!value}
              className={optionClass(!value)}
              onClick={() => select("")}
            >
              {placeholder}
            </button>
            {options.map((o) => (
              <button
                type="button"
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                className={optionClass(o.value === value)}
                onClick={() => select(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
