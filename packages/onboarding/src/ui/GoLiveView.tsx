import { Button, cn, IconButton } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCheck, LuPlus, LuTrash } from "react-icons/lu";
import { COLLECTIONS, PAGE_COPY } from "../content";
import {
  CUTOVER_STEPS,
  HYPERCARE,
  HYPERCARE_WEEKS_DEFAULT,
  SUPPORT_CHANNELS
} from "../content/golive";
import { checkKey } from "../logic";
import type { ImplementationRowData } from "../types";
import { EditableField } from "./EditableField";
import { ProgressPill } from "./ProgressPill";
import {
  EditableInput,
  PageHeader,
  Panel,
  Section,
  SectionList
} from "./primitives";
import {
  useCanEdit,
  useCheckMap,
  useFieldMap,
  useHubActions,
  useRows,
  useTier
} from "./state";

const cutoverKey = (id: string) => checkKey("cutover", id);

export function GoLiveView() {
  const { t, i18n } = useLingui();
  const map = useCheckMap();
  const fields = useFieldMap();
  const tier = useTier();
  const canEdit = useCanEdit();
  const customSteps = useRows("golive");
  const { setCheck, addRow } = useHubActions();

  const cutoverDone = CUTOVER_STEPS.filter(
    (s) => map.get(cutoverKey(s.key)) === "1"
  ).length;
  const supportChannels = SUPPORT_CHANNELS.filter(
    (c) => !c.tiers || c.tiers.includes(tier)
  );

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6">
      <PageHeader
        title={i18n._(PAGE_COPY["go-live"].title)}
        lead={i18n._(PAGE_COPY["go-live"].lead)}
        aside={
          <ProgressPill
            done={cutoverDone}
            total={CUTOVER_STEPS.length}
            label="cutover"
          />
        }
      />

      <Section title={t`Cutover checklist`}>
        <SectionList>
          {CUTOVER_STEPS.map((step) => {
            const key = cutoverKey(step.key);
            const done = map.get(key) === "1";
            return (
              <li key={step.key}>
                <button
                  type="button"
                  onClick={() => setCheck(key, "check", done ? "0" : "1")}
                  className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-muted/40 transition-colors"
                >
                  <CutoverBox done={done} />
                  <span
                    className={cn(
                      "text-sm",
                      done && "line-through text-muted-foreground"
                    )}
                  >
                    {i18n._(step.label)}
                  </span>
                </button>
              </li>
            );
          })}
          {customSteps.map((row) => (
            <CustomCutoverRow key={row.id} row={row} />
          ))}
        </SectionList>
        {canEdit ? (
          <div className="px-5 py-3 border-t">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<LuPlus />}
              onClick={() => addRow("golive", COLLECTIONS.golive.newPayload())}
            >
              {i18n._(COLLECTIONS.golive.addLabel)}
            </Button>
          </div>
        ) : null}
      </Section>

      {tier !== "self_serve" ? (
        <Panel title={t`Hypercare`}>
          <div className="flex items-center gap-2 mb-3 text-sm">
            <span className="text-muted-foreground shrink-0">
              <Trans>Window:</Trans>
            </span>
            <EditableField
              fieldKey="golive.hypercareWeeks"
              value={fields.get("golive.hypercareWeeks")}
              defaultValue={HYPERCARE_WEEKS_DEFAULT}
              placeholder={t`e.g. the first 3 to 4 weeks`}
              className="font-medium max-w-[260px]"
            />
          </div>
          <ul className="flex flex-col gap-2">
            {HYPERCARE.map((h, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm">
                <span className="shrink-0 mt-1.5 size-1.5 rounded-full bg-emerald-500" />
                {i18n._(h)}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title={t`How to reach us`}>
        <ul className="divide-y -my-2">
          {supportChannels.map((s) => (
            <li key={s.key} className="flex items-center gap-3 py-2.5">
              <span className="text-sm font-medium w-36 shrink-0">
                {i18n._(s.channel)}
              </span>
              <EditableField
                fieldKey={`golive.support.${s.key}`}
                value={fields.get(`golive.support.${s.key}`)}
                defaultValue={s.detail}
                className="text-sm text-muted-foreground flex-1"
              />
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function CutoverBox({ done }: { done: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 size-5 rounded border flex items-center justify-center transition-colors",
        done
          ? "bg-emerald-500 border-emerald-500 text-white"
          : "bg-card border-input"
      )}
    >
      {done ? <LuCheck className="size-3" /> : null}
    </span>
  );
}

function CustomCutoverRow({ row }: { row: ImplementationRowData }) {
  const { t } = useLingui();
  const map = useCheckMap();
  const canEdit = useCanEdit();
  const { setCheck, updateRow, deleteRow } = useHubActions();

  const label = typeof row.payload.label === "string" ? row.payload.label : "";
  const key = cutoverKey(row.id);
  const done = map.get(key) === "1";

  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <button
        type="button"
        aria-label={done ? t`Mark not done` : t`Mark done`}
        onClick={() => setCheck(key, "check", done ? "0" : "1")}
        className="shrink-0 active:scale-[0.96]"
      >
        <CutoverBox done={done} />
      </button>
      {canEdit ? (
        <EditableInput
          value={label}
          placeholder={t`Cutover step`}
          className="flex-1 min-w-0"
          onCommit={(next) => updateRow(row.id, { label: next })}
        />
      ) : (
        <span
          className={cn(
            "flex-1 text-sm",
            done && "line-through text-muted-foreground"
          )}
        >
          {label}
        </span>
      )}
      {canEdit ? (
        <IconButton
          aria-label={t`Delete step`}
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
