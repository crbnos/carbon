import { Badge, Button, IconButton } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCheck, LuPlus, LuTrash } from "react-icons/lu";
import { GUIDED_MOMENTS, PAGE_COPY } from "../content";
import type { CrewStatus } from "../content/crew";
import { GuidedMomentCard } from "./GuidedMomentCard";
import {
  CREW_AREAS,
  CREW_STATUS_LABEL,
  CREW_STATUS_ORDER,
  FLOOR_CHECKS,
  FLOOR_WAVES_NOTE
} from "../content/crew";
import { checkKey, isModuleExcluded } from "../logic";
import type { ImplementationRowData } from "../types";
import { ProgressPill } from "./ProgressPill";
import {
  EditableInput,
  PageHeader,
  Panel,
  Section,
  SectionList
} from "./primitives";
import {
  useCheckMap,
  useContacts,
  useExclusions,
  useHubActions,
  useRows,
  useSignals
} from "./state";

// Ready Your Team — Your Crew (the lineup: owner on top, one champion per
// in-scope area; the same name may hold several areas) and the floor rollout.
// Training that ends in doing, witnessed by the person accountable.

interface CrewRowPayload {
  area: string;
  name: string;
  email: string;
  status: CrewStatus;
}

const readPayload = (row: ImplementationRowData): CrewRowPayload => ({
  area: typeof row.payload.area === "string" ? row.payload.area : "",
  name: typeof row.payload.name === "string" ? row.payload.name : "",
  email: typeof row.payload.email === "string" ? row.payload.email : "",
  status:
    row.payload.status === "in-progress" || row.payload.status === "signed-off"
      ? row.payload.status
      : "invited"
});

export function CrewView() {
  const { t, i18n } = useLingui();
  const map = useCheckMap();
  const rows = useRows("crew");
  const contacts = useContacts();
  const exclusions = useExclusions();
  const signals = useSignals();
  const { addRow, updateRow, deleteRow, toggleFlag } = useHubActions();

  const areas = CREW_AREAS.filter(
    (area) => !isModuleExcluded(area.moduleTags, exclusions.modules)
  );
  const crew = rows.map((row) => ({ rowId: row.id, ...readPayload(row) }));
  const signedOff = crew.filter((member) => member.status === "signed-off").length;

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6">
      <PageHeader
        title={i18n._(PAGE_COPY.crew.title)}
        lead={i18n._(PAGE_COPY.crew.lead)}
        aside={
          <ProgressPill
            done={signedOff}
            total={Math.max(crew.length, 1)}
            label={t`signed off`}
          />
        }
      />

      {/* The lineup */}
      <Section
        title={<Trans>Your Crew</Trans>}
        subtitle={
          contacts.owner ? (
            <Trans>Owner: {contacts.owner}</Trans>
          ) : (
            <Trans>Name the owner on the How You Run page.</Trans>
          )
        }
      >
        <SectionList>
          {areas.map((area) => {
            const members = crew.filter((member) => member.area === area.key);
            return (
              <li key={area.key} className="flex flex-col gap-2 px-5 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="text-sm font-medium">
                    {i18n._(area.label)}
                  </div>
                  {members.length === 0 ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<LuPlus />}
                      onClick={() =>
                        addRow("crew", {
                          area: area.key,
                          name: "",
                          email: "",
                          status: "invited"
                        })
                      }
                    >
                      <Trans>Name a champion</Trans>
                    </Button>
                  ) : null}
                </div>

                {members.map((member) => (
                  <div
                    key={member.rowId}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <div className="flex-1 min-w-40">
                      <EditableInput
                        value={member.name}
                        placeholder={t`Name`}
                        onCommit={(next) =>
                          updateRow(member.rowId, {
                            area: member.area,
                            name: next,
                            email: member.email,
                            status: member.status
                          })
                        }
                      />
                    </div>
                    <div className="flex-1 min-w-48">
                      <EditableInput
                        value={member.email}
                        placeholder={t`Email`}
                        variant="muted"
                        onCommit={(next) =>
                          updateRow(member.rowId, {
                            area: member.area,
                            name: member.name,
                            email: next,
                            status: member.status
                          })
                        }
                      />
                    </div>
                    <Button
                      variant={
                        member.status === "signed-off" ? "primary" : "secondary"
                      }
                      size="sm"
                      leftIcon={
                        member.status === "signed-off" ? <LuCheck /> : undefined
                      }
                      onClick={() => {
                        const nextIndex =
                          (CREW_STATUS_ORDER.indexOf(member.status) + 1) %
                          CREW_STATUS_ORDER.length;
                        updateRow(member.rowId, {
                          area: member.area,
                          name: member.name,
                          email: member.email,
                          status: CREW_STATUS_ORDER[nextIndex]
                        });
                      }}
                    >
                      {i18n._(CREW_STATUS_LABEL[member.status])}
                    </Button>
                    <IconButton
                      aria-label={t`Remove champion`}
                      icon={<LuTrash />}
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      onClick={() => deleteRow(member.rowId)}
                    />
                  </div>
                ))}

                {/* Their area in Carbon: watch → do → sign off */}
                {members.length > 0 ? (
                  <ul className="text-xs text-muted-foreground list-disc ml-5">
                    {area.tasks.map((task, i) => (
                      <li key={i}>{i18n._(task)}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </SectionList>
      </Section>

      <GuidedMomentCard {...GUIDED_MOMENTS.crew} />

      {/* The floor rollout */}
      <Section
        title={<Trans>The floor rollout — where adoption is decided</Trans>}
        subtitle={i18n._(FLOOR_WAVES_NOTE)}
      >
        <SectionList>
          {FLOOR_CHECKS.map((check) => {
            const key = checkKey("crew.floor", check.key);
            const autoDone =
              check.key === "pilot-station" && signals.hasProductionEvent;
            const done = autoDone || map.get(key) === "1";
            return (
              <li key={check.key} className="flex items-center gap-4 px-5 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">
                    {i18n._(check.label)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {i18n._(check.detail)}
                  </div>
                </div>
                {done ? (
                  <Badge variant="secondary">
                    <LuCheck className="size-3 mr-1" />
                    {autoDone ? (
                      <Trans>Verified itself</Trans>
                    ) : (
                      <Trans>Done</Trans>
                    )}
                  </Badge>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => toggleFlag(key, "check", true)}
                  >
                    <Trans>Mark done</Trans>
                  </Button>
                )}
              </li>
            );
          })}
        </SectionList>
      </Section>
    </div>
  );
}
