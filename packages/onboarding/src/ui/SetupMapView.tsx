import { Badge, Button, IconButton } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import {
  LuArrowUpRight,
  LuCheckCheck,
  LuEyeOff,
  LuFileText,
  LuPlay,
  LuTrash
} from "react-icons/lu";
import { COLLECTIONS, PAGE_COPY } from "../content";
import { setupGroupKey } from "../content/board";
import { SETUP_GROUPS } from "../content/setup";
import {
  chipForSetupRow,
  filterByModule,
  flagKey,
  setupAnchorId,
  type SetupChip,
  type Tailoring
} from "../logic";
import type { CustomDataPayload, ImplementationRowData } from "../types";
import { MODULE_NAME } from "../types";
import { DecisionsLog } from "./DecisionsLog";
import { ProgressPill } from "./ProgressPill";
import {
  CustomRowSection,
  EditableInput,
  LearnLink,
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
  useResolveScreenUrl,
  useTailoring
} from "./state";

// Required / Recommended / Later chip on every row. "Later" items collect
// automatically into the after-you're-live backlog — deferral is a feature of
// the plan, never a failure of the customer.
function RowChip({ chip }: { chip: SetupChip }) {
  if (chip === "required") {
    return (
      <Badge variant="destructive" className="shrink-0">
        <Trans>Required</Trans>
      </Badge>
    );
  }
  if (chip === "later") {
    return (
      <Badge variant="outline" className="shrink-0 text-muted-foreground">
        <Trans>Later</Trans>
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="shrink-0">
      <Trans>Recommended</Trans>
    </Badge>
  );
}

// Everything the answers hid explains itself here in one line tied to those
// answers. Nothing in the hub is ever mysteriously absent.
function HiddenReceipts({ tailoring }: { tailoring: Tailoring }) {
  const { i18n } = useLingui();
  const hiddenRows = SETUP_GROUPS.flatMap((group) =>
    group.rows.filter((row) => tailoring.hiddenSetup.has(row.key))
  );
  if (tailoring.excludeModules.length === 0 && hiddenRows.length === 0) {
    return null;
  }
  return (
    <Section
      title={<Trans>Hidden from your plan — and why</Trans>}
      subtitle={
        <Trans>
          Everything here follows from your answers. Change an answer on the How
          You Run page and these come back.
        </Trans>
      }
    >
      <ul className="flex flex-col gap-2 px-5 py-4">
        {tailoring.excludeModules.map((exclusion) => (
          <li
            key={exclusion.mod}
            className="flex items-start gap-2 text-sm text-muted-foreground"
          >
            <LuEyeOff className="size-4 shrink-0 mt-0.5" />
            <span>
              <span className="font-medium text-foreground">
                {i18n._(MODULE_NAME[exclusion.mod])}
              </span>{" "}
              — {i18n._(exclusion.reason)}
            </span>
          </li>
        ))}
        {hiddenRows.map((row) => (
          <li
            key={row.key}
            className="flex items-start gap-2 text-sm text-muted-foreground"
          >
            <LuEyeOff className="size-4 shrink-0 mt-0.5" />
            <span>
              <span className="font-medium text-foreground">
                {i18n._(row.object)}
              </span>{" "}
              — {i18n._(tailoring.hiddenSetup.get(row.key)!)}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// Docs/Video badges for a whole module, shown on the group header — the same
// two-button pattern the Plan page uses for its phase resources. Carbon's docs
// and academy are organised per module, so the links live at the group level.
function GroupLearnLinks({
  docsUrl,
  academyUrl
}: {
  docsUrl?: string;
  academyUrl?: string;
}) {
  if (!docsUrl && !academyUrl) return null;
  return (
    <div className="flex items-center gap-2 text-xs">
      {docsUrl ? (
        <LearnLink href={docsUrl} icon={<LuFileText className="size-3" />}>
          <Trans>Docs</Trans>
        </LearnLink>
      ) : null}
      {academyUrl ? (
        <LearnLink href={academyUrl} icon={<LuPlay className="size-3" />}>
          <Trans>Video</Trans>
        </LearnLink>
      ) : null}
    </div>
  );
}

const DEF = COLLECTIONS.setup;
const FLAG = DEF.flag!;

const configuredKey = (id: string) => flagKey(`setup.${id}`);

export function SetupMapView({ userName }: { userName?: string }) {
  const { t, i18n } = useLingui();
  const exclusions = useExclusions();
  const map = useCheckMap();
  const tailoring = useTailoring();
  const { toggleFlag, toggleFlags } = useHubActions();
  const resolveScreenUrl = useResolveScreenUrl();

  const rowsForGroup = (rows: (typeof SETUP_GROUPS)[number]["rows"]) =>
    filterByModule(rows, exclusions.modules).filter(
      (row) => !tailoring.hiddenSetup.has(row.key)
    );

  const visibleRows = SETUP_GROUPS.flatMap((g) => rowsForGroup(g.rows));
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

      {userName ? <DecisionsLog userName={userName} /> : null}

      {SETUP_GROUPS.map((group) => {
        const rows = rowsForGroup(group.rows);
        if (rows.length === 0) return null;
        const allConfigured = rows.every(
          (r) => map.get(configuredKey(r.key)) === "1"
        );
        return (
          <Section
            key={group.n}
            id={setupAnchorId(setupGroupKey(group.n))}
            className="scroll-mt-6"
            number={group.n}
            title={i18n._(group.title)}
            subtitle={i18n._(group.desc)}
            aside={
              <div className="flex flex-wrap items-center justify-end gap-2">
                <GroupLearnLinks
                  docsUrl={group.docsUrl}
                  academyUrl={group.academyUrl}
                />
                {/* Speed lane: one click configures the whole group (one
                    batched write). Hidden once there's nothing left to mark. */}
                {allConfigured ? null : (
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<LuCheckCheck />}
                    onClick={() =>
                      toggleFlags(
                        rows.map((r) => configuredKey(r.key)),
                        "scopeFlag",
                        true
                      )
                    }
                  >
                    <Trans>Mark all as configured</Trans>
                  </Button>
                )}
              </div>
            }
          >
            <SectionList>
              {rows.map((row) => {
                const key = configuredKey(row.key);
                const url = resolveScreenUrl(row.key);
                const chip = chipForSetupRow(row.key, tailoring);
                const laterReason = tailoring.laterSetup.get(row.key);
                return (
                  <li
                    key={row.key}
                    className="flex items-center gap-4 px-5 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      {url ? (
                        // New tab (the ↗ arrow signals it): the ERP screen opens
                        // alongside the map so the user keeps their place here.
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
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
                        {laterReason ? i18n._(laterReason) : i18n._(row.detail)}
                      </div>
                    </div>
                    <RowChip chip={chip} />
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

      <HiddenReceipts tailoring={tailoring} />

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
                target="_blank"
                rel="noreferrer"
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
