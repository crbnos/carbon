import { Badge, Button, cn } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuCheck, LuPencil } from "react-icons/lu";
import { DECISIONS, type DecisionDef } from "../content/decisions";
import { currentAnswers } from "../logic";
import { Panel } from "./primitives";
import { useHubActions, useIntakeState, useRows } from "./state";

// The Decisions Log — five small cards at the top of Set Up the Basics. Each
// records who decided and when, and stays visible from then on ("Decided
// Sep 3 by Maria · change"). A decision made out loud beats an argument later.

interface DecisionRowPayload {
  key: string;
  value: string;
  decidedBy: string;
  decidedAt: string; // ISO
}

export function DecisionsLog({ userName }: { userName: string }) {
  const rows = useRows("decisions");

  const decided = new Map<string, { rowId: string; payload: DecisionRowPayload }>();
  for (const row of rows) {
    const payload = row.payload as Partial<DecisionRowPayload>;
    if (typeof payload.key === "string" && typeof payload.value === "string") {
      decided.set(payload.key, {
        rowId: row.id,
        payload: payload as DecisionRowPayload
      });
    }
  }

  return (
    <Panel title={<Trans>The five decisions</Trans>}>
      <p className="text-sm text-muted-foreground mb-3">
        <Trans>
          The ones that cause expensive rework when they're made silently and
          wrong. About two minutes each — every one has a recommended default.
        </Trans>
      </p>
      <ul className="flex flex-col divide-y">
        {DECISIONS.map((decision) => (
          <DecisionCard
            key={decision.key}
            decision={decision}
            existing={decided.get(decision.key) ?? null}
            userName={userName}
          />
        ))}
      </ul>
    </Panel>
  );
}

function DecisionCard({
  decision,
  existing,
  userName
}: {
  decision: DecisionDef;
  existing: { rowId: string; payload: DecisionRowPayload } | null;
  userName: string;
}) {
  const { i18n } = useLingui();
  const { addRow, updateRow } = useHubActions();
  const intake = useIntakeState();
  const [editing, setEditing] = useState(false);

  const answers = currentAnswers(intake);
  const intakeDefault = decision.intakeDefault?.(answers);
  const chosenValue = existing?.payload.value;
  const chosenOption = decision.options.find((o) => o.value === chosenValue);

  const record = (value: string) => {
    const payload: DecisionRowPayload = {
      key: decision.key,
      value,
      decidedBy: userName,
      decidedAt: new Date().toISOString()
    };
    if (existing) {
      updateRow(existing.rowId, { ...payload });
    } else {
      addRow("decisions", { ...payload });
    }
    setEditing(false);
  };

  const showOptions = editing || !chosenOption;

  return (
    <li className="py-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium">{i18n._(decision.title)}</div>
          <div className="text-xs text-muted-foreground">
            {i18n._(decision.why)}
          </div>
        </div>
        {chosenOption && !editing ? (
          <button
            type="button"
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            onClick={() => setEditing(true)}
          >
            <LuPencil className="size-3" />
            <Trans>Change</Trans>
          </button>
        ) : null}
      </div>

      {chosenOption && !editing ? (
        <div className="flex items-center gap-2 text-sm">
          <LuCheck className="size-4 text-primary" />
          <span className="font-medium">{i18n._(chosenOption.label)}</span>
          <span className="text-xs text-muted-foreground">
            <Trans>
              Decided {existing!.payload.decidedAt.slice(0, 10)} by{" "}
              {existing!.payload.decidedBy}
            </Trans>
          </span>
        </div>
      ) : null}

      {showOptions ? (
        <div className="flex flex-wrap gap-2">
          {decision.options.map((option) => {
            const highlight =
              option.value === chosenValue ||
              (!chosenValue &&
                (option.value === intakeDefault ||
                  (intakeDefault === undefined && option.recommended)));
            return (
              <Button
                key={option.value}
                size="sm"
                variant={highlight ? "primary" : "secondary"}
                className={cn(!highlight && "font-normal")}
                onClick={() => record(option.value)}
              >
                {i18n._(option.label)}
                {option.recommended ? (
                  <Badge variant="secondary" className="ml-2">
                    <Trans>Recommended</Trans>
                  </Badge>
                ) : null}
              </Button>
            );
          })}
        </div>
      ) : null}
    </li>
  );
}
