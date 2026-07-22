import {
  Button,
  DatePicker,
  Input,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuCalendarClock, LuCheck, LuFlag, LuSignature } from "react-icons/lu";
import { CUTOVER_STEPS, PAGE_COPY } from "../content";
import { GO_LIVE_STEP_KEY } from "../content/spine";
import {
  FREEZE_FIELDS,
  HUDDLE_QUESTIONS,
  SWITCH_COPY,
  T_MINUS_ITEMS
} from "../content/switchplan";
import { checkKey, gateDateKey, gateKey } from "../logic";
import { toCalendarDate } from "./date";
import { ProgressPill } from "./ProgressPill";
import { EditableInput, PageHeader, Panel, Section, SectionList } from "./primitives";
import { useCheckMap, useFieldMap, useHubActions } from "./state";

// Make the Switch — confirm the date against reality, work the T-minus plan,
// sign the Old-System Freeze Plan (the anti-habit ritual), run the go/no-go
// huddle, then the switch-day checklist. Completing it starts the streak.

const freezeFieldKey = (key: string) => `freeze.${key}`;
const FREEZE_SIGNED_KEY = "freeze.signedName";
const LIVE_AT_KEY = "live.liveAt";

export function SwitchView() {
  const { t, i18n } = useLingui();
  const map = useCheckMap();
  const fields = useFieldMap();
  const { toggleFlag, setField, setGate } = useHubActions();
  const [pushOpen, setPushOpen] = useState(false);
  const [pushReason, setPushReason] = useState("");
  const [pushDate, setPushDate] = useState<string | undefined>(undefined);
  const [signName, setSignName] = useState("");

  const goLiveDate = fields.get(gateDateKey(GO_LIVE_STEP_KEY));
  const signedName = fields.get(FREEZE_SIGNED_KEY);
  const liveAt = fields.get(LIVE_AT_KEY);

  const cutoverDone = CUTOVER_STEPS.filter(
    (step) => map.get(checkKey("cutover", step.key)) === "1"
  ).length;
  const huddleYes = HUDDLE_QUESTIONS.filter(
    (q) => map.get(checkKey("switch.huddle", q.key)) === "1"
  ).length;
  const readyToGoLive =
    Boolean(signedName) &&
    cutoverDone === CUTOVER_STEPS.length &&
    huddleYes === HUDDLE_QUESTIONS.length;

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6">
      <PageHeader
        title={i18n._(PAGE_COPY.switch.title)}
        lead={i18n._(PAGE_COPY.switch.lead)}
        aside={
          <ProgressPill
            done={cutoverDone}
            total={CUTOVER_STEPS.length}
            label={t`switch day`}
          />
        }
      />

      {/* Picking the moment */}
      <Panel
        title={
          <span className="inline-flex items-center gap-2">
            <LuCalendarClock className="size-4" />
            <Trans>The moment</Trans>
          </span>
        }
        aside={
          <Button variant="secondary" size="sm" onClick={() => setPushOpen(true)}>
            <Trans>Push the date</Trans>
          </Button>
        }
      >
        <div className="flex flex-col gap-1 text-sm">
          {goLiveDate ? (
            <div className="font-medium">
              <Trans>Switching {goLiveDate}</Trans>
            </div>
          ) : (
            <div className="font-medium">
              <Trans>No date set yet — pick one on the How You Run page.</Trans>
            </div>
          )}
          <p className="text-muted-foreground">
            {i18n._(SWITCH_COPY.dateGuidance)}
          </p>
        </div>
      </Panel>

      {/* T-minus plan */}
      <Section
        title={<Trans>The T-minus plan</Trans>}
        subtitle={
          <Trans>Laid out automatically from your date. Honest hours, no surprises.</Trans>
        }
      >
        <SectionList>
          {T_MINUS_ITEMS.map((item) => {
            const key = checkKey("switch", item.key);
            const done = map.get(key) === "1";
            return (
              <li key={item.key} className="flex items-center gap-4 px-5 py-3">
                <span className="text-xs text-muted-foreground w-24 shrink-0 tabular-nums">
                  {i18n._(item.offset)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{i18n._(item.label)}</div>
                  <div className="text-xs text-muted-foreground">
                    {i18n._(item.detail)}
                  </div>
                </div>
                <Button
                  variant={done ? "primary" : "secondary"}
                  size="sm"
                  leftIcon={done ? <LuCheck /> : undefined}
                  onClick={() => toggleFlag(key, "check", !done)}
                >
                  {done ? <Trans>Done</Trans> : <Trans>Mark done</Trans>}
                </Button>
              </li>
            );
          })}
        </SectionList>
      </Section>

      {/* The Old-System Freeze Plan */}
      <Panel
        title={
          <span className="inline-flex items-center gap-2">
            <LuSignature className="size-4" />
            <Trans>The Old-System Freeze Plan</Trans>
          </span>
        }
      >
        <div className="flex flex-col gap-3">
          {FREEZE_FIELDS.map((field) => (
            <div key={field.key} className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">
                {i18n._(field.label)}
              </label>
              <EditableInput
                value={fields.get(freezeFieldKey(field.key)) ?? ""}
                placeholder={i18n._(field.placeholder)}
                onCommit={(next) => setField(freezeFieldKey(field.key), next)}
              />
            </div>
          ))}

          {signedName ? (
            <div className="rounded-lg border bg-primary/5 border-primary/30 px-4 py-3 text-sm flex items-center gap-2">
              <LuCheck className="size-4 text-primary" />
              <Trans>Signed by {signedName}</Trans>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                value={signName}
                onChange={(e) => setSignName(e.target.value)}
                placeholder={t`Type your name to sign`}
              />
              <Button
                isDisabled={!signName.trim()}
                onClick={() => {
                  setField(FREEZE_SIGNED_KEY, signName.trim());
                  toggleFlag(checkKey("switch", "freeze-signed"), "check", true);
                }}
              >
                <Trans>Sign the freeze plan</Trans>
              </Button>
            </div>
          )}
        </div>
      </Panel>

      {/* The go/no-go huddle */}
      <Panel title={<Trans>The go / no-go huddle</Trans>}>
        <p className="text-sm text-muted-foreground mb-2">
          <Trans>
            Four plain questions the owner reads out loud. Four yeses is a go.
          </Trans>
        </p>
        <ul className="flex flex-col gap-2">
          {HUDDLE_QUESTIONS.map((q) => {
            const key = checkKey("switch.huddle", q.key);
            const yes = map.get(key) === "1";
            return (
              <li key={q.key} className="flex items-center justify-between gap-4 text-sm">
                {i18n._(q.label)}
                <Button
                  variant={yes ? "primary" : "secondary"}
                  size="sm"
                  leftIcon={yes ? <LuCheck /> : undefined}
                  onClick={() => toggleFlag(key, "check", !yes)}
                >
                  {yes ? <Trans>Yes</Trans> : <Trans>Not yet</Trans>}
                </Button>
              </li>
            );
          })}
        </ul>
      </Panel>

      {/* Switch day */}
      <Section title={<Trans>Switch day — work it in order</Trans>}>
        <SectionList>
          {CUTOVER_STEPS.map((step, index) => {
            const key = checkKey("cutover", step.key);
            const done = map.get(key) === "1";
            return (
              <li key={step.key} className="flex items-center gap-4 px-5 py-3">
                <span className="size-6 rounded-full border flex items-center justify-center text-xs tabular-nums shrink-0">
                  {index + 1}
                </span>
                <div className="flex-1 text-sm font-medium">
                  {i18n._(step.label)}
                </div>
                <Button
                  variant={done ? "primary" : "secondary"}
                  size="sm"
                  leftIcon={done ? <LuCheck /> : undefined}
                  onClick={() => toggleFlag(key, "check", !done)}
                >
                  {done ? <Trans>Done</Trans> : <Trans>Mark done</Trans>}
                </Button>
              </li>
            );
          })}
        </SectionList>
      </Section>

      {/* The gate */}
      {!liveAt ? (
        <Panel>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {i18n._(SWITCH_COPY.liveReframe)}
            </p>
            <Button
              leftIcon={<LuFlag />}
              isDisabled={!readyToGoLive}
              onClick={() => {
                const today = new Date().toISOString().slice(0, 10);
                setField(LIVE_AT_KEY, today);
                setGate(gateKey("switch"), "done");
              }}
            >
              <Trans>We're live on Carbon</Trans>
            </Button>
          </div>
        </Panel>
      ) : (
        <Panel>
          <p className="text-sm font-medium flex items-center gap-2">
            <LuCheck className="size-4 text-primary" />
            <Trans>
              Switched on {liveAt}. The streak to activation is running — see
              Live on Carbon.
            </Trans>
          </p>
        </Panel>
      )}

      {/* Push-the-date dialog: moving is allowed; it just asks why. */}
      <Modal open={pushOpen} onOpenChange={setPushOpen}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>
              <Trans>Push the date</Trans>
            </ModalTitle>
            <ModalDescription>{i18n._(SWITCH_COPY.pushDate)}</ModalDescription>
          </ModalHeader>
          <div className="flex flex-col gap-3 px-6 pb-2">
            <DatePicker
              value={toCalendarDate(pushDate ?? goLiveDate)}
              onChange={(date) => setPushDate(date ? date.toString() : undefined)}
            />
            <Input
              value={pushReason}
              onChange={(e) => setPushReason(e.target.value)}
              placeholder={t`Why is it moving?`}
            />
          </div>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setPushOpen(false)}>
              <Trans>Keep the date</Trans>
            </Button>
            <Button
              isDisabled={!pushDate || !pushReason.trim()}
              onClick={() => {
                if (pushDate) {
                  setField(gateDateKey(GO_LIVE_STEP_KEY), pushDate);
                  setField("switch.dateMovedReason", pushReason.trim());
                }
                setPushOpen(false);
                setPushReason("");
              }}
            >
              <Trans>Move it</Trans>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
