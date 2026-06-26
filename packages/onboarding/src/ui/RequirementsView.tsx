import { cn, IconButton } from "@carbon/react";
import { LuTrash } from "react-icons/lu";
import { COLLECTIONS, PAGE_COPY, REQUIREMENTS } from "../content";
import { flagKey } from "../logic";
import type { ImplementationRowData } from "../types";
import { ProgressPill } from "./ProgressPill";
import {
  CustomRowSection,
  EditableInput,
  PageHeader,
  Section,
  SectionList,
  StatusToggle
} from "./primitives";
import { useCanEdit, useCheckMap, useExclusions, useHubActions } from "./state";

const FLAG = COLLECTIONS.requirement.flag!;

// A requirement is in scope unless explicitly toggled off (default "1").
const isInScope = (map: Map<string, string>, key: string) =>
  (map.get(key) ?? "1") === "1";

export function RequirementsView() {
  const exclusions = useExclusions();
  const map = useCheckMap();
  const { toggleFlag } = useHubActions();

  const modules = REQUIREMENTS.filter(
    (m) => !exclusions.modules.includes(m.mod)
  );
  const rows = modules.flatMap((m) => m.areas.flatMap((a) => a.rows));
  const inScope = rows.filter((r) => isInScope(map, flagKey(r.code))).length;

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6">
      <PageHeader
        title={PAGE_COPY.requirements.title}
        lead={PAGE_COPY.requirements.lead}
        aside={
          <ProgressPill done={inScope} total={rows.length} label="in scope" />
        }
      />

      {modules.map((module) => (
        <Section
          key={module.code}
          title={
            <span className="flex items-center gap-2">
              <span className="text-xs font-mono font-semibold rounded bg-foreground text-background px-1.5 py-0.5">
                {module.code}
              </span>
              {module.name}
            </span>
          }
        >
          {module.areas.map((area) => (
            <div key={area.code}>
              <div className="px-5 pt-3 pb-1 flex items-baseline gap-2">
                <span className="text-xs font-mono text-blue-600 dark:text-blue-400">
                  {area.code}
                </span>
                <span className="text-xs font-medium text-muted-foreground">
                  {area.name}
                </span>
              </div>
              <SectionList>
                {area.rows.map((row) => {
                  const key = flagKey(row.code);
                  const inScope = isInScope(map, key);
                  return (
                    <li
                      key={row.code}
                      className="flex items-center gap-4 px-5 py-2.5"
                    >
                      <span className="text-xxs font-mono text-muted-foreground shrink-0 w-20">
                        {row.code}
                      </span>
                      <span
                        className={cn(
                          "flex-1 text-sm",
                          !inScope && "text-muted-foreground line-through"
                        )}
                      >
                        {row.requirement}
                      </span>
                      <StatusToggle
                        active={inScope}
                        activeLabel={FLAG.active}
                        inactiveLabel={FLAG.inactive}
                        withIcon={false}
                        onToggle={() => toggleFlag(key, "scopeFlag", !inScope)}
                      />
                    </li>
                  );
                })}
              </SectionList>
            </div>
          ))}
        </Section>
      ))}

      <CustomRowSection collection="requirement">
        {(row) => <CustomRequirementRow row={row} />}
      </CustomRowSection>
    </div>
  );
}

function CustomRequirementRow({ row }: { row: ImplementationRowData }) {
  const canEdit = useCanEdit();
  const map = useCheckMap();
  const { toggleFlag, updateRow, deleteRow } = useHubActions();

  const requirement =
    typeof row.payload.requirement === "string" ? row.payload.requirement : "";
  const key = flagKey(row.id);
  const inScope = isInScope(map, key);

  return (
    <li className="flex items-center gap-4 px-5 py-2.5">
      <span className="text-xxs font-mono text-muted-foreground shrink-0 w-20">
        CUSTOM
      </span>
      {canEdit ? (
        <EditableInput
          value={requirement}
          placeholder="Requirement"
          className="flex-1 min-w-0 text-sm font-normal"
          onCommit={(next) => updateRow(row.id, { requirement: next })}
        />
      ) : (
        <span
          className={cn(
            "flex-1 text-sm",
            !inScope && "text-muted-foreground line-through"
          )}
        >
          {requirement}
        </span>
      )}
      <StatusToggle
        active={inScope}
        activeLabel={FLAG.active}
        inactiveLabel={FLAG.inactive}
        withIcon={false}
        onToggle={() => toggleFlag(key, "scopeFlag", !inScope)}
      />
      {canEdit ? (
        <IconButton
          aria-label="Delete requirement"
          icon={<LuTrash />}
          variant="ghost"
          size="sm"
          className="text-muted-foreground shrink-0"
          onClick={() => deleteRow(row.id)}
        />
      ) : null}
    </li>
  );
}
