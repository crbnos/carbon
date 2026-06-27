import { Button, cn, IconButton } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuPlus, LuTrash } from "react-icons/lu";
import { COLLECTIONS, PAGE_COPY } from "../content";
import { BOARD_TASKS } from "../content/board";
import { SPINE } from "../content/spine";
import {
  boardTasksForTier,
  ownerForTier,
  spineForTier,
  taskKey,
  taskStatus,
  tasksForStep
} from "../logic";
import type {
  CustomTaskPayload,
  ImplementationRowData,
  Owner,
  TaskValue
} from "../types";
import { ProgressPill } from "./ProgressPill";
import {
  EditableInput,
  OWNER_TOKENS,
  PageHeader,
  TASK_STATUS_TOKENS
} from "./primitives";
import {
  useCanEdit,
  useCheckMap,
  useHubActions,
  useRows,
  useTier
} from "./state";

const TASK_ORDER: TaskValue[] = ["todo", "prog", "blocked", "done"];
const NEXT_TASK: Record<TaskValue, TaskValue> = {
  todo: "prog",
  prog: "blocked",
  blocked: "done",
  done: "todo"
};
const NEXT_OWNER: Record<Owner, Owner> = {
  carbon: "you",
  you: "shared",
  shared: "carbon"
};

// The single task list for the whole project, grouped by the six steps. Status
// is the shared source of truth the Plan page derives from. Carbon staff can add
// deal-specific tasks below.
export function BoardTable() {
  const { t, i18n } = useLingui();
  const map = useCheckMap();
  const tier = useTier();
  const canEdit = useCanEdit();
  const customTasks = useRows("board");
  const { setCheck, addRow } = useHubActions();

  const steps = spineForTier(SPINE, tier);
  const tasks = boardTasksForTier(BOARD_TASKS, tier);
  const orderedTasks = steps.flatMap((s) => tasksForStep(tasks, s.key));
  const tasksDone = orderedTasks.filter(
    (t) => taskStatus(t, map) === "done"
  ).length;
  const nextTask = orderedTasks.find((t) => taskStatus(t, map) !== "done");

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-6">
      <PageHeader
        title={i18n._(PAGE_COPY.board.title)}
        lead={i18n._(PAGE_COPY.board.lead)}
        aside={
          <ProgressPill
            done={tasksDone}
            total={orderedTasks.length}
            label={t`tasks`}
          />
        }
      />

      {nextTask ? (
        <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm flex items-center gap-2 flex-wrap">
          <span className="text-xxs uppercase tracking-wide font-medium text-primary">
            <Trans>Next task</Trans>
          </span>
          <span className="font-medium">{i18n._(nextTask.label)}</span>
        </div>
      ) : null}

      <div className="rounded-2xl border bg-card shadow-button-base overflow-hidden">
        {steps.map((step) => {
          const stepTasks = tasksForStep(tasks, step.key);
          if (stepTasks.length === 0) return null;
          return (
            <section key={step.key}>
              <div className="px-5 py-2 border-y first:border-t-0">
                <span className="text-xxs uppercase tracking-wide font-medium text-muted-foreground">
                  {step.n} · {i18n._(step.title)}
                </span>
              </div>
              <ul>
                {stepTasks.map((task) => {
                  const status = taskStatus(task, map);
                  const pill = TASK_STATUS_TOKENS[status];
                  return (
                    <li
                      key={task.key}
                      className="flex items-center gap-4 px-5 py-3 border-b last:border-b-0"
                    >
                      <span
                        className={cn(
                          "flex-1 min-w-0 text-sm",
                          status === "done" &&
                            "line-through text-muted-foreground"
                        )}
                      >
                        {i18n._(task.label)}
                      </span>
                      {tier !== "self_serve" ? (
                        <span className="text-xxs uppercase tracking-wide rounded px-1.5 py-0.5 border text-muted-foreground font-medium shrink-0">
                          {i18n._(
                            OWNER_TOKENS[ownerForTier(task.owner, tier)].label
                          )}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        title={t`Click to change status`}
                        onClick={() =>
                          setCheck(taskKey(task.key), "task", NEXT_TASK[status])
                        }
                        className={cn(
                          "shrink-0 inline-flex items-center gap-1.5 rounded-full pl-2 pr-2.5 py-1 text-xs font-medium active:scale-[0.96] transition-transform",
                          pill.cls
                        )}
                      >
                        <span
                          className={cn("size-1.5 rounded-full", pill.dot)}
                        />
                        {i18n._(pill.label)}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      {customTasks.length || canEdit ? (
        <div className="rounded-2xl border bg-card shadow-button-base overflow-hidden">
          <div className="px-5 py-2 border-b flex items-center justify-between">
            <span className="text-xxs uppercase tracking-wide font-medium text-muted-foreground">
              <Trans>Added for this customer</Trans>
            </span>
            {canEdit ? (
              <span className="text-xxs text-muted-foreground">
                <Trans>Carbon-only</Trans>
              </span>
            ) : null}
          </div>
          {customTasks.length ? (
            <ul>
              {customTasks.map((row) => (
                <CustomTaskRow key={row.id} row={row} />
              ))}
            </ul>
          ) : (
            <div className="px-5 py-4 text-sm text-muted-foreground">
              {i18n._(COLLECTIONS.board.emptyText)}
            </div>
          )}
          {canEdit ? (
            <div className="px-5 py-3 border-t">
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<LuPlus />}
                onClick={() => addRow("board", COLLECTIONS.board.newPayload())}
              >
                {i18n._(COLLECTIONS.board.addLabel)}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CustomTaskRow({ row }: { row: ImplementationRowData }) {
  const { t, i18n } = useLingui();
  const canEdit = useCanEdit();
  const { updateRow, deleteRow } = useHubActions();

  const payload: CustomTaskPayload = {
    label: typeof row.payload.label === "string" ? row.payload.label : "",
    owner: (row.payload.owner as Owner) ?? "shared",
    status: (row.payload.status as TaskValue) ?? "todo"
  };
  const pill = TASK_STATUS_TOKENS[payload.status];

  return (
    <li className="flex items-center gap-3 px-5 py-3 border-b last:border-b-0">
      {canEdit ? (
        <EditableInput
          value={payload.label}
          placeholder={t`Task`}
          className="flex-1 min-w-0"
          onCommit={(label) => updateRow(row.id, { ...payload, label })}
        />
      ) : (
        <span
          className={cn(
            "flex-1 min-w-0 text-sm",
            payload.status === "done" && "line-through text-muted-foreground"
          )}
        >
          {payload.label}
        </span>
      )}
      <button
        type="button"
        disabled={!canEdit}
        onClick={() =>
          updateRow(row.id, { ...payload, owner: NEXT_OWNER[payload.owner] })
        }
        className={cn(
          "text-xxs uppercase tracking-wide rounded px-1.5 py-0.5 border text-muted-foreground font-medium shrink-0",
          canEdit && "hover:bg-accent"
        )}
      >
        {i18n._(OWNER_TOKENS[payload.owner].label)}
      </button>
      <button
        type="button"
        title={t`Click to change status`}
        onClick={() =>
          updateRow(row.id, { ...payload, status: NEXT_TASK[payload.status] })
        }
        className={cn(
          "shrink-0 inline-flex items-center gap-1.5 rounded-full pl-2 pr-2.5 py-1 text-xs font-medium active:scale-[0.96] transition-transform",
          pill.cls
        )}
      >
        <span className={cn("size-1.5 rounded-full", pill.dot)} />
        {i18n._(pill.label)}
      </button>
      {canEdit ? (
        <IconButton
          aria-label={t`Delete task`}
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

export { TASK_ORDER };
