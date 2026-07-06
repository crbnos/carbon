import { useMode } from "@carbon/react";
import { LuMoon, LuSun } from "react-icons/lu";
import { useFetcher } from "react-router";
import { startModeTransition } from "~/utils/dom";
import { path } from "~/utils/path";

export function ThemeToggle() {
  const fetcher = useFetcher();
  const mode = useMode();
  const next = mode === "dark" ? "light" : "dark";

  const onClick = () => {
    // Persist host-only (no domain) so it survives regardless of the configured
    // cookie domain. The server's setMode adds a domain attribute that won't match
    // local/preview hosts, so its cookie gets dropped and the theme reverts on
    // revalidation — this host-only cookie is what getMode() reads instead.
    document.cookie = `mode=${next}; path=/; max-age=31536000; samesite=lax`;

    const formData = new FormData();
    formData.append("mode", next);
    startModeTransition(next, () => {
      fetcher.submit(formData, { method: "post", action: path.to.root });
    });
  };

  return (
    <button
      type="button"
      aria-label={
        mode === "dark" ? "Switch to light mode" : "Switch to dark mode"
      }
      onClick={onClick}
      className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-border bg-card text-foreground hover:border-muted-foreground transition-[transform,border-color] duration-150 active:scale-[0.96]"
    >
      {mode === "dark" ? <LuSun size={16} /> : <LuMoon size={16} />}
    </button>
  );
}
