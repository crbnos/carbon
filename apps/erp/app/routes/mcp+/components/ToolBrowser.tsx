import { useMemo, useState } from "react";
import { LuChevronDown } from "react-icons/lu";
import type { CatalogModule, CatalogTool } from "../catalog";
import { filterTools } from "../tools-filter";
import { FilterSelect } from "./FilterSelect";
import { ModuleCards } from "./ModuleCards";
import { Tag } from "./Tag";

const PAGE = 30;

export function ToolBrowser({
  tools,
  modules
}: {
  tools: CatalogTool[];
  modules: CatalogModule[];
}) {
  const [q, setQ] = useState("");
  const [module, setModule] = useState("");
  const [classification, setClassification] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const filtered = useMemo(
    () => filterTools(tools, { q, module, classification }),
    [tools, q, module, classification]
  );
  const shown = filtered.slice(0, limit);
  const remaining = filtered.length - shown.length;

  return (
    <div>
      <ModuleCards
        modules={modules}
        total={tools.length}
        value={module}
        onChange={(v) => {
          setModule(v);
          setLimit(PAGE);
        }}
      />
      <div className="border border-border rounded-[11px] overflow-hidden bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_26px_-18px_rgba(0,0,0,0.14)]">
        <div className="flex gap-2 items-center p-[11px] border-b border-border">
          <input
            className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground text-[0.85rem] font-[inherit] outline-none focus:border-[var(--acc)]"
            placeholder={`Search ${tools.length.toLocaleString()} tools…`}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLimit(PAGE);
            }}
          />
          <FilterSelect
            value={classification}
            placeholder="All types"
            options={[
              { value: "READ", label: "READ" },
              { value: "WRITE", label: "WRITE" },
              { value: "DESTRUCTIVE", label: "DESTRUCTIVE" }
            ]}
            onChange={(v) => {
              setClassification(v);
              setLimit(PAGE);
            }}
          />
        </div>
        {shown.map((t) => (
          <div
            className="flex items-center gap-[11px] p-[11px] border-b border-border last:border-b-0 hover:bg-muted"
            key={t.name}
          >
            <Tag kind={t.classification} />
            <span className="font-[var(--mono)] font-medium text-[0.78rem]">
              {t.name}
            </span>
            <span className="text-muted-foreground flex-1 text-[0.8rem]">
              {t.description}
            </span>
            <span className="text-muted-foreground text-[0.72rem] whitespace-nowrap">
              {t.paramCount} params
            </span>
          </div>
        ))}
        {remaining > 0 ? (
          <button
            type="button"
            onClick={() => setLimit((l) => l + PAGE)}
            className="w-full flex items-center justify-center gap-[8px] px-[11px] py-[12px] text-[0.8rem] font-semibold text-foreground bg-muted border-t border-border cursor-pointer transition-colors hover:text-[var(--acc)]"
          >
            <LuChevronDown size={15} />
            Load {Math.min(PAGE, remaining).toLocaleString()} more
            <span className="font-[var(--mono)] text-[0.7rem] font-normal text-muted-foreground tabular-nums">
              {shown.length.toLocaleString()} /{" "}
              {filtered.length.toLocaleString()}
            </span>
          </button>
        ) : (
          <div className="px-[11px] py-[10px] text-[0.75rem] text-muted-foreground bg-muted border-t border-border font-[var(--mono)] tabular-nums">
            {filtered.length === 0
              ? "No tools match your filters."
              : `All ${filtered.length.toLocaleString()} tools shown`}
          </div>
        )}
      </div>
    </div>
  );
}
