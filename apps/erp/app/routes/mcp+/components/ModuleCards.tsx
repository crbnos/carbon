import { cn } from "@carbon/react";
import type { IconType } from "react-icons";
import {
  LuBox,
  LuCircleUser,
  LuCrown,
  LuFactory,
  LuFiles,
  LuFolderCheck,
  LuLandmark,
  LuLayers,
  LuLayoutGrid,
  LuReceipt,
  LuSettings,
  LuShield,
  LuShoppingCart,
  LuSquareStack,
  LuUsers,
  LuWrench
} from "react-icons/lu";
import type { CatalogModule } from "../catalog";

// Mirrors the ERP module icons (app/hooks/useModules.tsx). invoicing/account/
// shared have no top-level nav icon, so the closest lucide stands in.
const MODULE_ICONS: Record<string, IconType> = {
  sales: LuCrown,
  items: LuSquareStack,
  production: LuFactory,
  purchasing: LuShoppingCart,
  resources: LuWrench,
  settings: LuSettings,
  quality: LuFolderCheck,
  accounting: LuLandmark,
  inventory: LuBox,
  people: LuUsers,
  users: LuShield,
  documents: LuFiles,
  invoicing: LuReceipt,
  account: LuCircleUser,
  shared: LuLayers
};

function Card({
  icon: Icon,
  label,
  count,
  active,
  onClick
}: {
  icon: IconType;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-[9px] text-left p-[10px] rounded-lg border cursor-pointer transition-[border-color,background,transform] duration-150 active:scale-[0.97]",
        active
          ? "border-[var(--acc)] bg-[var(--acc-tint)]"
          : "border-border bg-card hover:border-muted-foreground"
      )}
    >
      <Icon
        size={16}
        className={cn(
          "shrink-0",
          active ? "text-[var(--acc)]" : "text-muted-foreground"
        )}
      />
      <span className="min-w-0">
        <span className="block font-medium text-[0.8rem] text-foreground truncate">
          {label}
        </span>
        <span className="block font-[var(--mono)] text-[0.62rem] text-muted-foreground tabular-nums">
          {count.toLocaleString()}
        </span>
      </span>
    </button>
  );
}

export function ModuleCards({
  modules,
  total,
  value,
  onChange
}: {
  modules: CatalogModule[];
  total: number;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-[8px] mb-[18px]">
      <Card
        icon={LuLayoutGrid}
        label="All modules"
        count={total}
        active={value === ""}
        onClick={() => onChange("")}
      />
      {modules.map((m) => (
        <Card
          key={m.key}
          icon={MODULE_ICONS[m.key] ?? LuBox}
          label={m.label}
          count={m.count}
          active={value === m.key}
          onClick={() => onChange(value === m.key ? "" : m.key)}
        />
      ))}
    </div>
  );
}
