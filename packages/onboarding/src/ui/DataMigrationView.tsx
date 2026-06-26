import { IconButton } from "@carbon/react";
import { useEffect, useState } from "react";
import { LuTrash } from "react-icons/lu";
import { COLLECTIONS, PAGE_COPY } from "../content";
import { DATA_GROUPS } from "../content/data";
import { filterByModule, flagKey } from "../logic";
import type { CustomDataPayload, ImplementationRowData } from "../types";
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

const DEF = COLLECTIONS.data;
const FLAG = DEF.flag!;

// Per-company key for a data row's "validated" flag (template rows key off their
// stable `key`, custom rows off their row id).
const validatedKey = (id: string) => flagKey(`data.${id}`);

export function DataMigrationView() {
  const exclusions = useExclusions();
  const map = useCheckMap();
  const { toggleFlag } = useHubActions();

  const visibleRows = DATA_GROUPS.flatMap((g) =>
    filterByModule(g.rows, exclusions.modules)
  );
  const validated = visibleRows.filter(
    (r) => map.get(validatedKey(r.key)) === "1"
  ).length;

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6">
      <PageHeader
        title={PAGE_COPY.data.title}
        lead={PAGE_COPY.data.lead}
        aside={
          <ProgressPill
            done={validated}
            total={visibleRows.length}
            label="validated"
          />
        }
      />

      {DATA_GROUPS.map((group) => {
        const rows = filterByModule(group.rows, exclusions.modules);
        if (rows.length === 0) return null;
        return (
          <Section
            key={group.n}
            number={group.n}
            title={group.title}
            subtitle={group.desc}
          >
            <SectionList>
              {rows.map((row) => {
                const key = validatedKey(row.key);
                return (
                  <li
                    key={row.key}
                    className="flex items-center gap-4 px-5 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{row.object}</div>
                      <div className="text-xs text-muted-foreground">
                        Today: {row.today}
                      </div>
                    </div>
                    <StatusToggle
                      active={map.get(key) === "1"}
                      activeLabel={FLAG.active}
                      inactiveLabel={FLAG.inactive}
                      onToggle={() =>
                        toggleFlag(key, "scopeFlag", map.get(key) !== "1")
                      }
                    />
                  </li>
                );
              })}
            </SectionList>
          </Section>
        );
      })}

      <CustomRowSection collection="data">
        {(row) => <CustomDataRow row={row} />}
      </CustomRowSection>
    </div>
  );
}

function CustomDataRow({ row }: { row: ImplementationRowData }) {
  const canEdit = useCanEdit();
  const map = useCheckMap();
  const { toggleFlag, updateRow, deleteRow } = useHubActions();

  const payload: CustomDataPayload = {
    object: typeof row.payload.object === "string" ? row.payload.object : "",
    today: typeof row.payload.today === "string" ? row.payload.today : ""
  };
  const key = validatedKey(row.id);
  const validated = map.get(key) === "1";

  // Mirror both cells locally so committing one always sends the other's live
  // value (never a stale server copy that could revert an in-flight edit).
  const [object, setObject] = useState(payload.object);
  const [today, setToday] = useState(payload.today);
  useEffect(() => setObject(payload.object), [payload.object]);
  useEffect(() => setToday(payload.today), [payload.today]);

  return (
    <li className="flex items-center gap-4 px-5 py-3">
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        {canEdit ? (
          <>
            <EditableInput
              value={object}
              placeholder="What data"
              onCommit={(next) => {
                setObject(next);
                updateRow(row.id, { object: next, today });
              }}
            />
            <EditableInput
              value={today}
              placeholder="Where it lives today"
              variant="muted"
              onCommit={(next) => {
                setToday(next);
                updateRow(row.id, { object, today: next });
              }}
            />
          </>
        ) : (
          <>
            <div className="text-sm font-medium">{payload.object}</div>
            <div className="text-xs text-muted-foreground">
              Today: {payload.today}
            </div>
          </>
        )}
      </div>
      <StatusToggle
        active={validated}
        activeLabel={FLAG.active}
        inactiveLabel={FLAG.inactive}
        onToggle={() => toggleFlag(key, "scopeFlag", !validated)}
      />
      {canEdit ? (
        <IconButton
          aria-label="Delete row"
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
