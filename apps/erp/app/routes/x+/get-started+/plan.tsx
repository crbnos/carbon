import { BoardTable, PlanView } from "@carbon/onboarding/ui";
import { cn } from "@carbon/react";
import { useEffect } from "react";
import { LuClipboardList, LuListChecks } from "react-icons/lu";
import { useLocation, useSearchParams } from "react-router";

const VIEWS = [
  { key: "plan", label: "Plan", icon: <LuListChecks /> },
  { key: "board", label: "Board", icon: <LuClipboardList /> }
] as const;

// Plan and Board are two views of the same tasks (status is shared state, no
// drift). One route hosts both; `?view=board` switches. The hub's "View in
// project plan" deep-links here with no param, so Plan stays the default.
// State + mutations come from <HubProvider> in the layout.
export default function GetStartedPlanRoute() {
  const { hash } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get("view") === "board" ? "board" : "plan";

  // Scroll to (and briefly highlight) the step card linked from the hub. Plan
  // view only — the anchors live on the plan cards.
  useEffect(() => {
    if (view !== "plan" || !hash) return;
    const el = document.getElementById(hash.slice(1));
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("ring-2", "ring-primary");
    const t = setTimeout(
      () => el.classList.remove("ring-2", "ring-primary"),
      1600
    );
    return () => clearTimeout(t);
  }, [hash, view]);

  const selectView = (next: (typeof VIEWS)[number]["key"]) => {
    setSearchParams(
      (prev) => {
        if (next === "plan") prev.delete("view");
        else prev.set("view", next);
        return prev;
      },
      { replace: true, preventScrollReset: true }
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="w-full max-w-4xl mx-auto flex justify-center">
        <div className="inline-flex items-center gap-1 rounded-full border bg-card p-1 shadow-button-base">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => selectView(v.key)}
              aria-pressed={view === v.key}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors active:scale-[0.97]",
                view === v.key
                  ? "bg-primary text-primary-foreground shadow-button-base"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {v.icon}
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {view === "plan" ? <PlanView /> : <BoardTable />}
    </div>
  );
}
