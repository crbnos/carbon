import { IconButton } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuArrowUpRight, LuTrash } from "react-icons/lu";
import { COLLECTIONS, PAGE_COPY } from "../content";
import { SETUP_GROUPS } from "../content/setup";
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
import {
  useCanEdit,
  useCheckMap,
  useExclusions,
  useHubActions,
  useResolveScreenUrl
} from "./state";

const DEF = COLLECTIONS.setup;
const FLAG = DEF.flag!;

const configuredKey = (id: string) => flagKey(`setup.${id}`);

export function SetupMapView() {
  const { t, i18n } = useLingui();
  const exclusions = useExclusions();
  const map = useCheckMap();
  const { toggleFlag } = useHubActions();
  const resolveScreenUrl = useResolveScreenUrl();

  const visibleRows = SETUP_GROUPS.flatMap((g) =>
    filterByModule(g.rows, exclusions.modules)
  );
  const configured = visibleRows.filter(
    (r) => map.get(configuredKey(r.key)) === "1"
  ).length;

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6">
      <PageHeader
        title={i18n._(PAGE_COPY.setup.title)}
        lead={i18n._(PAGE_COPY.setup.lead)}
        aside={
          <ProgressPill
            done={configured}
            total={visibleRows.length}
            label={t`configured`}
          />
        }
      />

      {SETUP_GROUPS.map((group) => {
        const rows = filterByModule(group.rows, exclusions.modules);
        if (rows.length === 0) return null;
        return (
          <Section
            key={group.n}
            number={group.n}
            title={i18n._(group.title)}
            subtitle={i18n._(group.desc)}
          >
            <SectionList>
              {rows.map((row) => {
                const key = configuredKey(row.key);
                const url = resolveScreenUrl(row.key);
                return (
                  <li
                    key={row.key}
                    className="flex items-center gap-4 px-5 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      {url ? (
                        <a
                          href={url}
                          className="group inline-flex items-center gap-1 text-sm font-medium hover:text-primary transition-colors"
                        >
                          {i18n._(row.object)}
                          <LuArrowUpRight className="size-3.5 shrink-0 text-muted-foreground/50 transition group-hover:text-primary group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                        </a>
                      ) : (
                        <div className="text-sm font-medium">
                          {i18n._(row.object)}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {i18n._(row.detail)}
                      </div>
                    </div>
                    <StatusToggle
                      active={map.get(key) === "1"}
                      activeLabel={i18n._(FLAG.active)}
                      inactiveLabel={i18n._(FLAG.inactive)}
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

      <CustomRowSection collection="setup">
        {(row) => <CustomSetupRow row={row} />}
      </CustomRowSection>
    </div>
  );
}

function CustomSetupRow({ row }: { row: ImplementationRowData }) {
  const { t, i18n } = useLingui();
  const canEdit = useCanEdit();
  const map = useCheckMap();
  const { toggleFlag, updateRow, deleteRow } = useHubActions();

  const payload: CustomDataPayload = {
    object: typeof row.payload.object === "string" ? row.payload.object : "",
    today: typeof row.payload.today === "string" ? row.payload.today : "",
    url: typeof row.payload.url === "string" ? row.payload.url : undefined
  };
  const key = configuredKey(row.id);
  const configured = map.get(key) === "1";

  const [object, setObject] = useState(payload.object);
  const [today, setToday] = useState(payload.today);
  const [url, setUrl] = useState(payload.url ?? "");
  useEffect(() => setObject(payload.object), [payload.object]);
  useEffect(() => setToday(payload.today), [payload.today]);
  useEffect(() => setUrl(payload.url ?? ""), [payload.url]);

  // Merge all three cells on every commit (never send a stale sibling). An empty
  // URL is dropped so the row falls back to plain text.
  const commit = (next: Partial<CustomDataPayload>) => {
    const merged = { object, today, url: url || undefined, ...next };
    if (!merged.url) merged.url = undefined;
    updateRow(row.id, merged);
  };

  return (
    <li className="flex items-center gap-4 px-5 py-3">
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        {canEdit ? (
          <>
            <EditableInput
              value={object}
              placeholder={t`What to set up`}
              onCommit={(next) => {
                setObject(next);
                commit({ object: next });
              }}
            />
            <EditableInput
              value={today}
              placeholder={t`What it is`}
              variant="muted"
              onCommit={(next) => {
                setToday(next);
                commit({ today: next });
              }}
            />
            <EditableInput
              value={url}
              placeholder={t`Link (optional) — e.g. /x/settings/…`}
              variant="muted"
              onCommit={(next) => {
                setUrl(next);
                commit({ url: next || undefined });
              }}
            />
          </>
        ) : (
          <>
            {payload.url ? (
              <a
                href={payload.url}
                className="group inline-flex items-center gap-1 text-sm font-medium hover:text-primary transition-colors"
              >
                {payload.object}
                <LuArrowUpRight className="size-3.5 shrink-0 text-muted-foreground/50 transition group-hover:text-primary group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </a>
            ) : (
              <div className="text-sm font-medium">{payload.object}</div>
            )}
            <div className="text-xs text-muted-foreground">{payload.today}</div>
          </>
        )}
      </div>
      <StatusToggle
        active={configured}
        activeLabel={i18n._(FLAG.active)}
        inactiveLabel={i18n._(FLAG.inactive)}
        onToggle={() => toggleFlag(key, "scopeFlag", !configured)}
      />
      {canEdit ? (
        <IconButton
          aria-label={t`Delete row`}
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
