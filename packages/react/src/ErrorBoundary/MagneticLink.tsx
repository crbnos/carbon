import { type ReactNode, useRef, useState } from "react";
import { Link } from "react-router";
import { cn } from "../utils/cn";

type MagneticProps = {
  children: ReactNode;
  variant?: "solid" | "ghost";
  to?: string;
  onClick?: () => void;
};

function isExternal(to?: string) {
  return !!to && /^(https?:)?\/\//.test(to);
}

export function MagneticLink({
  to,
  onClick,
  children,
  variant = "solid"
}: MagneticProps) {
  const ref = useRef<HTMLAnchorElement & HTMLButtonElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  function onMove(e: React.PointerEvent) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - (rect.left + rect.width / 2);
    const y = e.clientY - (rect.top + rect.height / 2);
    setPos({ x: x * 0.35, y: y * 0.35 });
  }

  const className = cn(
    "group relative inline-flex items-center gap-3 px-7 py-4 font-mono text-xs uppercase tracking-[0.25em] transition-colors duration-200",
    variant === "solid"
      ? "bg-foreground text-background hover:bg-background hover:text-foreground border border-foreground"
      : "border border-border text-foreground hover:border-foreground"
  );

  const inner = (
    <>
      <span
        className="inline-block transition-transform duration-200 group-hover:-translate-x-1"
        aria-hidden="true"
      >
        [
      </span>
      {children}
      <span
        className="inline-block transition-transform duration-200 group-hover:translate-x-1"
        aria-hidden="true"
      >
        ]
      </span>
    </>
  );

  const sharedProps = {
    ref,
    onPointerMove: onMove,
    onPointerLeave: () => setPos({ x: 0, y: 0 }),
    className,
    style: {
      transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
      transition: pos.x === 0 && pos.y === 0 ? "transform 0.35s ease" : "none"
    }
  };

  // Action button (e.g. retry / reset)
  if (onClick) {
    return (
      <button type="button" onClick={onClick} {...sharedProps}>
        {inner}
      </button>
    );
  }

  // External link -> plain anchor
  if (isExternal(to)) {
    return (
      <a href={to} {...sharedProps}>
        {inner}
      </a>
    );
  }

  // Internal navigation -> React Router Link.
  // Full document load: navigating out of a root error state can leave the
  // boundary rendered (or hydration may have failed entirely), so never let the
  // router intercept this click.
  return (
    <Link to={to ?? "/"} reloadDocument {...sharedProps}>
      {inner}
    </Link>
  );
}
