// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The priority set questionnaire, in the parts a document page places: the
// questions (the page's column) and the company's live set (its side panel).
// `PrioritySetProvider` holds what both read; the ERP route puts them in a
// `DocumentPage`. Every answer moves features between categories; Carbon staff
// can set any feature by hand, which wins over every answer. The set itself is
// computed by logic/priority-set.ts from the hub's field values.
//
// Answers are saved as hub field values through the shared hub fetcher. Quick
// clicks would cancel each other there, so every save carries all writes the
// loader has not confirmed yet: a cancelled save loses nothing, and the page
// shows the answer at once instead of after the round-trip.

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChoiceCardGroup,
  type ChoiceCardOption,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Count,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  IconButton,
  Input,
  Label,
  MENU_ITEM_SHORTCUTS,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  MultiChoiceCardGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Subheading,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  toast
} from "@carbon/react";
import { getLocalTimeZone, today } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  createContext,
  Fragment,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  LuBookOpen,
  LuChevronDown,
  LuClock,
  LuEllipsisVertical,
  LuInfo,
  LuPencil,
  LuPlug,
  LuPlus,
  LuSparkles,
  LuTrash2,
  LuTriangleAlert,
  LuX
} from "react-icons/lu";
import {
  PRIORITY_CATEGORIES,
  PRIORITY_CATEGORY_NAME,
  PRIORITY_FEATURE_GROUP_NAME,
  PRIORITY_FEATURES,
  PRIORITY_SYSTEM_CHOICE_LABEL,
  type PriorityCategory,
  type PriorityFeature,
  type PriorityQuestion,
  type PrioritySection,
  type PrioritySystemChoice,
  type PrioritySystemRow
} from "../content/priority-set";
import {
  computePrioritySet,
  encodeTools,
  PRIORITY_MAX_TOOLS,
  PRIORITY_NOT_SURE,
  PRIORITY_TOOLS_KEY,
  type PriorityFunction,
  type PriorityReason,
  type PrioritySet,
  type PriorityState,
  type PriorityToolAnswer,
  priorityAnswerKey,
  priorityFeaturesIn,
  priorityFunctionEntries,
  priorityMaybe,
  priorityOverrideKey,
  priorityProgress,
  priorityQuestion,
  priorityQuestionNumbers,
  prioritySectionAsked,
  prioritySections,
  prioritySetMarkdown,
  priorityStateFromFields,
  priorityToolSupport,
  withFunctionRenamed,
  withFunctionTool
} from "../logic/priority-set";
import { LearnLink } from "./primitives";
import {
  useFieldMap,
  useHub,
  useIsInternal,
  usePeopleById,
  usePreviewing
} from "./state";

type Write = (entries: [fieldKey: string, value: string][]) => void;

const featureByKey = new Map(PRIORITY_FEATURES.map((f) => [f.key, f]));
const PRIORITY_SYSTEM_CHOICES: PrioritySystemChoice[] = [
  "retire",
  "later",
  "connect",
  "keep"
];

// The server stamps who set an override and when, so a saved override is
// confirmed when its category and reason match, not the exact text.
function confirmed(fieldKey: string, stored: string, written: string) {
  if (!fieldKey.startsWith("priority.override.") || !stored || !written)
    return stored === written;
  try {
    const a = JSON.parse(stored);
    const b = JSON.parse(written);
    return a.category === b.category && (a.reason ?? "") === (b.reason ?? "");
  } catch {
    return stored === written;
  }
}

// Hub field values with the writes the loader has not confirmed laid on top.
function usePriorityFields() {
  const fieldMap = useFieldMap();
  const dispatch = useHub((s) => s.dispatch);
  const pendingRef = useRef(new Map<string, string>());
  const [pending, setPending] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    let changed = false;
    for (const [key, value] of pendingRef.current) {
      if (confirmed(key, fieldMap.get(key) ?? "", value)) {
        pendingRef.current.delete(key);
        changed = true;
      }
    }
    if (changed) setPending(new Map(pendingRef.current));
  }, [fieldMap]);

  const fields = useMemo(() => {
    const merged = new Map(fieldMap);
    for (const [key, value] of pending) {
      if (value === "") merged.delete(key);
      else merged.set(key, value);
    }
    return merged;
  }, [fieldMap, pending]);

  const write: Write = useCallback(
    (entries) => {
      for (const [key, value] of entries) pendingRef.current.set(key, value);
      setPending(new Map(pendingRef.current));
      dispatch({
        intent: "setPriority",
        writes: Array.from(pendingRef.current, ([fieldKey, value]) => ({
          fieldKey,
          value
        }))
      });
    },
    [dispatch]
  );

  return { fields, write, saving: pending.size > 0 };
}

type PrioritySetContextValue = {
  state: PriorityState;
  set: PrioritySet;
  numbers: Map<string, string>;
  progress: { answered: number; total: number };
  write: Write;
  saving: boolean;
  canOverride: boolean;
  copyMarkdown: () => void;
  downloadMarkdown: () => void;
};

const PrioritySetContext = createContext<PrioritySetContextValue | null>(null);

// What the questions, the panel and the page header share. Render inside the
// hub's `HubProvider`.
export function PrioritySetProvider({
  companyName,
  children
}: {
  companyName?: string;
  children: ReactNode;
}) {
  const { t, i18n } = useLingui();
  const isInternal = useIsInternal();
  const previewing = usePreviewing();
  const peopleById = usePeopleById();
  const { fields, write, saving } = usePriorityFields();

  const state = useMemo(() => priorityStateFromFields(fields), [fields]);
  const set = useMemo(() => computePrioritySet(state), [state]);
  const numbers = useMemo(
    () => priorityQuestionNumbers(state.start),
    [state.start]
  );

  const markdown = () =>
    prioritySetMarkdown(state, set, {
      company: companyName ?? "",
      date: today(getLocalTimeZone()).toString(),
      answeredBy: t`questionnaire`,
      label: (m) => i18n._(m),
      personName: (id) => peopleById.get(id)?.name
    });

  const value: PrioritySetContextValue = {
    state,
    set,
    numbers,
    progress: priorityProgress(state),
    write,
    saving,
    canOverride: isInternal && !previewing,
    copyMarkdown: () =>
      navigator.clipboard
        ?.writeText(markdown())
        .then(() => toast.success(t`Copied the priority set`))
        .catch(() => toast.error(t`Could not copy. Use Download.`)),
    downloadMarkdown: () => {
      const url = URL.createObjectURL(
        new Blob([markdown()], { type: "text/markdown" })
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "priority-set.md";
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <PrioritySetContext.Provider value={value}>
      {children}
    </PrioritySetContext.Provider>
  );
}

export function usePrioritySet(): PrioritySetContextValue {
  const context = useContext(PrioritySetContext);
  if (!context) {
    throw new Error("usePrioritySet must be used within <PrioritySetProvider>");
  }
  return context;
}

// The page's column: how answering works, then the questions. Every company
// starts blank; the answered count is in the page header, which stays in view.
// `after` places something right below a question, keyed by the question:
// what follows from its answer appears there, so nothing above the person's
// cursor moves.
export function PrioritySetQuestions({
  after
}: {
  after?: Partial<Record<string, ReactNode>>;
} = {}) {
  const { state, numbers, write } = usePrioritySet();

  return (
    <>
      <p className="text-sm text-muted-foreground text-pretty">
        <Trans>
          Answer what you can. Each answer moves Carbon features between
          categories, and the panel beside the questions shows what your company
          needs before go-live. "Not sure" moves nothing and is kept as an open
          question.
        </Trans>
      </p>
      {prioritySections(state.start).map((section) => (
        <SectionView
          key={section.key}
          section={section}
          state={state}
          numbers={numbers}
          write={write}
          after={after}
        />
      ))}
      <ToolFollowUps />
    </>
  );
}

function SectionView({
  section,
  state,
  numbers,
  write,
  after
}: {
  section: PrioritySection;
  state: PriorityState;
  numbers: Map<string, string>;
  write: Write;
  after?: Partial<Record<string, ReactNode>>;
}) {
  const { t, i18n } = useLingui();
  const asked = prioritySectionAsked(section, state);
  const condition = section.condition;
  const conditionText = condition
    ? (() => {
        const question = priorityQuestion(condition.question);
        const options = condition.options
          .map((key) => {
            const option = question?.options.find((o) => o.key === key);
            return option ? i18n._(option.label).replace(/\.$/, "") : key;
          })
          .join(" / ");
        const number = numbers.get(condition.question) ?? "";
        return condition.type === "when"
          ? t`Asked when ${number} is ${options}.`
          : t`Not asked when ${number} is ${options}.`;
      })()
    : null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5 mt-4">
        <Subheading as="h2" variant="light">
          {i18n._(section.title)}
        </Subheading>
        {conditionText ? (
          <p className="text-xs text-muted-foreground">{conditionText}</p>
        ) : null}
      </div>
      {asked ? (
        section.questions.map((question) => (
          <Fragment key={question.key}>
            <QuestionView
              question={question}
              number={numbers.get(question.key) ?? ""}
              state={state}
              write={write}
            />
            {after?.[question.key] ?? null}
          </Fragment>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">
          <Trans>Skipped for now.</Trans>
        </p>
      )}
    </section>
  );
}

function QuestionView({
  question,
  number,
  state,
  write
}: {
  question: PriorityQuestion;
  number: string;
  state: PriorityState;
  write: Write;
}) {
  const { t, i18n } = useLingui();
  const chosen = state.answers[question.key] ?? [];
  const answerKey = priorityAnswerKey(question.key);
  // Answered over MCP by the company's AI assistant; answering here clears it.
  const viaAssistant = state.viaAssistant.includes(question.key);

  // An option is its answer alone; what it moves shows in the side panel.
  const options: ChoiceCardOption[] = [
    ...question.options.map((option) => ({
      value: option.key,
      title: i18n._(option.label)
    })),
    { value: PRIORITY_NOT_SURE, title: t`Not sure` }
  ];

  // "Not sure" stands alone: choosing it clears the other answers, and
  // choosing an answer clears it.
  const chooseMany = (next: string[]) => {
    const added = next.find((option) => !chosen.includes(option));
    const answers =
      added === PRIORITY_NOT_SURE
        ? [PRIORITY_NOT_SURE]
        : added
          ? next.filter((option) => option !== PRIORITY_NOT_SURE)
          : next;
    write([[answerKey, answers.length ? JSON.stringify(answers) : ""]]);
  };

  return (
    <Card>
      <CardHeader>
        {/* A question is read in full: no two-line clamp. */}
        <CardTitle className="text-sm leading-snug line-clamp-none">
          <span className="text-muted-foreground tabular-nums mr-1.5">
            {number}
          </span>
          {i18n._(question.label)}
          {viaAssistant ? (
            <span className="ml-2 inline-flex items-center gap-1 align-middle text-xs font-normal text-muted-foreground whitespace-nowrap">
              <LuSparkles className="size-3" aria-hidden />
              <Trans>Entered by your AI assistant</Trans>
            </span>
          ) : null}
        </CardTitle>
        {question.help || question.multiple ? (
          <CardDescription className="text-pretty">
            {question.help ? i18n._(question.help) : null}
            {question.help && question.multiple ? " " : null}
            {question.multiple ? <Trans>Pick all that apply.</Trans> : null}
          </CardDescription>
        ) : null}
        <QuestionWhy question={question} />
      </CardHeader>
      <CardContent>
        {question.systems ? (
          <ToolList state={state} write={write} />
        ) : question.multiple ? (
          <MultiChoiceCardGroup
            value={chosen}
            onChange={chooseMany}
            options={options}
          />
        ) : (
          <ChoiceCardGroup
            value={chosen[0] ?? ""}
            onChange={(option) =>
              write([[answerKey, JSON.stringify([option])]])
            }
            options={options}
          />
        )}
      </CardContent>
    </Card>
  );
}

// Why the answer matters, in Carbon's words, with the docs pages that show the
// features at work. Closed by default, so the question stays one glance.
function QuestionWhy({ question }: { question: PriorityQuestion }) {
  const { i18n } = useLingui();
  if (!question.why) return null;
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="group inline-flex w-fit items-center gap-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <LuInfo className="size-3" aria-hidden />
          <Trans>Why it matters</Trans>
          <LuChevronDown
            className="size-3 transition-transform group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 pt-2">
        <p className="text-sm text-muted-foreground text-pretty">
          {i18n._(question.why)}
        </p>
        {question.learnMore?.length ? (
          <div className="flex flex-wrap gap-1.5 text-xs">
            {question.learnMore.map((link) => (
              <LearnLink
                key={link.url}
                href={link.url}
                icon={<LuBookOpen className="size-3" />}
              >
                {i18n._(link.title)}
              </LearnLink>
            ))}
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

// What happens to one tool. A tool covering an area Carbon never replaces (CAD)
// is only kept, connected or separate.
function PlanSelect({
  value,
  choices,
  onChange
}: {
  value?: string;
  choices: PrioritySystemChoice[];
  onChange: (choice: string) => void;
}) {
  const { t, i18n } = useLingui();
  return (
    <Select value={value ?? ""} onValueChange={onChange}>
      <SelectTrigger size="sm" aria-label={t`Plan`} className="w-56">
        <SelectValue placeholder={t`Choose`} />
      </SelectTrigger>
      <SelectContent>
        {choices.map((choice) => (
          <SelectItem key={choice} value={choice}>
            {i18n._(PRIORITY_SYSTEM_CHOICE_LABEL[choice])}
          </SelectItem>
        ))}
        <SelectItem value={PRIORITY_NOT_SURE}>
          <Trans>Not sure</Trans>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

// The systems question: a tool for each starter function, then a row for each
// other function (another area, or one in the company's own words) and each
// tool named without one. One tool can cover several functions; how each is
// used is asked at the end of the questionnaire (`ToolFollowUps`).
function ToolList({ state, write }: { state: PriorityState; write: Write }) {
  const { t, i18n } = useLingui();
  const [drafts, setDrafts] = useState<string[]>([]);
  const rows = priorityQuestion("systems")?.systems ?? [];
  const entries = priorityFunctionEntries(state);
  const save = (tools: PriorityToolAnswer[]) =>
    write([[PRIORITY_TOOLS_KEY, encodeTools(tools)]]);
  const newId = () => crypto.randomUUID();
  const nameOf = (func: PriorityFunction) => {
    if (!("row" in func)) return func.text;
    const row = rows.find((r) => r.key === func.row);
    return row ? i18n._(row.area) : func.row;
  };
  // A function typed with an area's name is that area.
  const functionFor = (value: string): PriorityFunction => {
    const typed = value.trim();
    const row = rows.find(
      (r) => i18n._(r.area).toLowerCase() === typed.toLowerCase()
    );
    return row ? { row: row.key } : { text: typed };
  };
  const dropDraft = (id: string) =>
    setDrafts((current) => current.filter((draft) => draft !== id));

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_2rem] items-center gap-x-2 gap-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          <Trans>Function</Trans>
        </span>
        <span className="text-xs font-medium text-muted-foreground">
          <Trans>Tool you use today</Trans>
        </span>
        <span />
        {entries.map((entry) => (
          <Fragment key={entry.key}>
            {entry.starter ? (
              <span className="text-sm">{nameOf(entry.func)}</span>
            ) : (
              <Input
                size="sm"
                aria-label={t`Function`}
                placeholder={t`Function, e.g. Shipping`}
                defaultValue={nameOf(entry.func)}
                onBlur={(event) => {
                  const to = functionFor(event.currentTarget.value);
                  if (nameOf(to) === nameOf(entry.func) || !entry.toolId)
                    return;
                  save(
                    withFunctionRenamed(
                      state.tools,
                      entry.toolId,
                      entry.func,
                      to
                    )
                  );
                }}
              />
            )}
            <Input
              // Remounts with the stored name once saved: a name typed in
              // another case joins the tool already listed under that name.
              key={`${entry.toolId ?? ""}:${entry.tool}`}
              size="sm"
              aria-label={t`Tool for ${nameOf(entry.func) || t`this function`}`}
              placeholder={entry.starter ? t`None, or a tool` : t`Tool`}
              defaultValue={entry.tool}
              onBlur={(event) => {
                if (event.currentTarget.value.trim() === entry.tool) return;
                save(
                  withFunctionTool(
                    state.tools,
                    entry.func,
                    entry.toolId,
                    event.currentTarget.value,
                    newId
                  )
                );
              }}
            />
            {entry.starter ? (
              <span />
            ) : (
              <IconButton
                aria-label={t`Remove row`}
                icon={<LuTrash2 />}
                variant="ghost"
                size="sm"
                onClick={() =>
                  save(
                    withFunctionTool(
                      state.tools,
                      entry.func,
                      entry.toolId,
                      "",
                      newId
                    )
                  )
                }
              />
            )}
          </Fragment>
        ))}
        {drafts.map((id) => (
          <FunctionDraft
            key={id}
            onSave={(func, tool) => {
              save(
                withFunctionTool(
                  state.tools,
                  functionFor(func),
                  undefined,
                  tool,
                  newId
                )
              );
              dropDraft(id);
            }}
            onRemove={() => dropDraft(id)}
          />
        ))}
      </div>
      <Button
        variant="secondary"
        size="sm"
        leftIcon={<LuPlus />}
        isDisabled={state.tools.length >= PRIORITY_MAX_TOOLS}
        onClick={() => setDrafts((current) => [...current, newId()])}
      >
        <Trans>Add Row</Trans>
      </Button>
    </div>
  );
}

// A new row: a function and its tool, saved once the tool is named.
function FunctionDraft({
  onSave,
  onRemove
}: {
  onSave: (func: string, tool: string) => void;
  onRemove: () => void;
}) {
  const { t } = useLingui();
  const [func, setFunc] = useState("");
  return (
    <>
      <Input
        size="sm"
        autoFocus
        aria-label={t`Function`}
        placeholder={t`Function, e.g. Shipping`}
        value={func}
        onChange={(event) => setFunc(event.currentTarget.value)}
      />
      <Input
        size="sm"
        aria-label={t`Tool`}
        placeholder={t`Tool`}
        onBlur={(event) => {
          const tool = event.currentTarget.value.trim();
          if (tool) onSave(func, tool);
        }}
      />
      <IconButton
        aria-label={t`Remove row`}
        icon={<LuTrash2 />}
        variant="ghost"
        size="sm"
        onClick={onRemove}
      />
    </>
  );
}

// Each tool's follow-up, asked once the set has taken shape: what the company
// does in it, how it is set up, whether it stays, and how it should work with
// Carbon. Every tool named is kept, supported or not: the list informs which
// integrations Carbon builds.
function ToolFollowUps() {
  const { state, write } = usePrioritySet();
  if (!state.tools.length) return null;
  const rows = priorityQuestion("systems")?.systems ?? [];
  // One tool covers an area; another tool's area cannot be ticked.
  const owner = new Map<string, PriorityToolAnswer>();
  for (const tool of state.tools)
    for (const row of tool.rows ?? [])
      if (!owner.has(row)) owner.set(row, tool);
  const save = (id: string, patch: Partial<PriorityToolAnswer>) =>
    write([
      [
        PRIORITY_TOOLS_KEY,
        encodeTools(
          state.tools.map((tool) =>
            tool.id === id ? { ...tool, ...patch } : tool
          )
        )
      ]
    ]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5 mt-4">
        <Subheading as="h2" variant="light">
          <Trans>Your tools</Trans>
        </Subheading>
        <p className="text-xs text-muted-foreground text-pretty">
          <Trans>
            How you use each tool today, so Carbon can plan what to replace and
            what to connect.
          </Trans>
        </p>
      </div>
      {state.tools.map((tool) => (
        <ToolFollowUp
          key={tool.id}
          tool={tool}
          rows={rows}
          owner={owner}
          onChange={(patch) => save(tool.id, patch)}
        />
      ))}
    </section>
  );
}

function ToolFollowUp({
  tool,
  rows,
  owner,
  onChange
}: {
  tool: PriorityToolAnswer;
  rows: PrioritySystemRow[];
  owner: Map<string, PriorityToolAnswer>;
  onChange: (patch: Partial<PriorityToolAnswer>) => void;
}) {
  const { t, i18n } = useLingui();
  const selected = tool.rows ?? [];
  // The plans every ticked area takes; an area that cannot take the plan
  // chosen cannot be ticked.
  const choices = PRIORITY_SYSTEM_CHOICES.filter((choice) =>
    rows
      .filter((row) => selected.includes(row.key))
      .every((row) => row.choices.includes(choice))
  );
  const takes = (row: PrioritySystemRow) =>
    !tool.plan ||
    tool.plan === PRIORITY_NOT_SURE ||
    row.choices.includes(tool.plan);
  const note =
    (field: "other" | "setup" | "integration") =>
    (event: { currentTarget: { value: string } }) => {
      const value = event.currentTarget.value.trim();
      if (value !== (tool[field] ?? "")) onChange({ [field]: value });
    };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm leading-snug line-clamp-none">
          {tool.name}
        </CardTitle>
        <ToolSupport tool={tool.name} />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            <Trans>What do you do in it?</Trans>
          </span>
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            className="flex-wrap justify-start"
            aria-label={t`What do you do in it?`}
            value={selected}
            onValueChange={(next) => onChange({ rows: next })}
          >
            {rows.map((row) => {
              const other = owner.get(row.key);
              const elsewhere = other && other.id !== tool.id;
              return (
                <ToggleGroupItem
                  key={row.key}
                  value={row.key}
                  disabled={!!elsewhere || !takes(row)}
                  title={
                    elsewhere
                      ? t`Covered by ${other.name}`
                      : takes(row)
                        ? undefined
                        : t`Carbon does not replace this tool: keep it, connected or separate`
                  }
                  className="text-xs"
                >
                  {i18n._(row.area)}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
          {tool.functions?.length ? (
            <p className="text-xs text-muted-foreground">
              <Trans>Also:</Trans> {tool.functions.join(", ")}
            </p>
          ) : null}
          <Input
            size="sm"
            aria-label={t`Anything else you use it for`}
            placeholder={t`Anything else, in your own words`}
            defaultValue={tool.other ?? ""}
            onBlur={note("other")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            <Trans>
              Anything set up or customised in it that we should know?
            </Trans>
          </span>
          <Textarea
            rows={2}
            aria-label={t`How it is set up`}
            placeholder={t`Custom fields, reports, scripts, workflows`}
            defaultValue={tool.setup ?? ""}
            onBlur={note("setup")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            <Trans>Are you planning to move off it?</Trans>
          </span>
          <PlanSelect
            value={tool.plan}
            choices={choices}
            onChange={(plan) =>
              onChange({ plan: plan as PriorityToolAnswer["plan"] })
            }
          />
        </div>
        {tool.plan === "connect" ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              <Trans>How should it work with Carbon?</Trans>
            </span>
            <Textarea
              rows={2}
              aria-label={t`How it should work with Carbon`}
              placeholder={t`Which records, and which way, e.g. invoices out, payments back`}
              defaultValue={tool.integration ?? ""}
              onBlur={note("integration")}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// What Carbon offers for a named tool: its integration, one not available yet,
// an import from CSV, or the general answer for a tool Carbon has no support
// for. Carbon staff also see Carbon's own notes on the tool.
function ToolSupport({ tool }: { tool: string }) {
  const { t, i18n } = useLingui();
  const { canOverride } = usePrioritySet();
  const support = priorityToolSupport(tool);
  const docs = support ? support.docs : IMPORT_DOCS;
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <p className="flex items-start gap-1.5 text-pretty">
        {support?.support === "integration" ? (
          <LuPlug className="mt-0.5 size-3 shrink-0" aria-hidden />
        ) : support?.support === "unavailable" ? (
          <LuClock className="mt-0.5 size-3 shrink-0" aria-hidden />
        ) : (
          <LuInfo className="mt-0.5 size-3 shrink-0" aria-hidden />
        )}
        <span>
          {support
            ? i18n._(support.summary)
            : t`Carbon has no integration with ${tool} yet. Items, bills of material, customers, suppliers and opening stock import from CSV, and anything else can connect over Carbon's API or MCP.`}{" "}
          {docs ? (
            <LearnLink href={docs} icon={<LuBookOpen className="size-3" />}>
              {support ? (
                <Trans>How it works</Trans>
              ) : (
                <Trans>Importing data</Trans>
              )}
            </LearnLink>
          ) : null}
        </span>
      </p>
      {canOverride && support?.staffNote ? (
        <p className="text-pretty">
          <Trans>Carbon staff:</Trans> {i18n._(support.staffNote)}
        </p>
      ) : null}
    </div>
  );
}

const IMPORT_DOCS = "https://docs.carbon.ms/docs/reference/import-export";

// The document page's side panel: the company's set as it stands, by category.
export function PrioritySetPanel() {
  const { t, i18n } = useLingui();
  const { set, state, numbers, canOverride, write } = usePrioritySet();
  const [open, setOpen] = useState<Record<string, boolean>>({
    "0": true,
    "1": true
  });
  const [editing, setEditing] = useState<string | null>(null);
  const blank = state.start === "blank";
  const nameOf = (key: string) => {
    const feature = featureByKey.get(key);
    return feature ? i18n._(feature.name) : key;
  };
  const areaOf = (row: string) => {
    const found = priorityQuestion("systems")?.systems?.find(
      (r) => r.key === row
    );
    return found ? i18n._(found.area) : row;
  };
  const toolOf = (id: string) =>
    state.tools.find((tool) => tool.id === id)?.name ?? id;

  // Maybe: features a "not sure" answer could still place, listed once, with
  // the unsure questions that would settle them. They leave "Not placed".
  const waitingOn = new Map<string, string[]>();
  for (const { key, features } of priorityMaybe(state, set)) {
    const label = key.startsWith("tools.")
      ? `${numbers.get("systems") ?? "systems"} ${toolOf(key.slice("tools.".length))}`
      : (numbers.get(key) ?? key);
    for (const feature of features)
      waitingOn.set(feature, [...(waitingOn.get(feature) ?? []), label]);
  }
  const lists: { id: string; title: string; features: PriorityFeature[] }[] = [
    ...PRIORITY_CATEGORIES.map((category) => ({
      id: String(category),
      title: i18n._(PRIORITY_CATEGORY_NAME[category]),
      features: priorityFeaturesIn(set, category)
    })),
    {
      id: "maybe",
      title: t`Maybe`,
      features: PRIORITY_FEATURES.filter((f) => waitingOn.has(f.key))
    },
    ...(blank
      ? [
          {
            id: "none",
            title: t`Not placed`,
            features: priorityFeaturesIn(set, null).filter(
              (f) => !waitingOn.has(f.key)
            )
          }
        ]
      : [])
  ];

  const setOverride = (
    feature: string,
    category: PriorityCategory | null,
    reason?: string
  ) => {
    // A feature set by hand into a closed category stays in view.
    if (category !== null) {
      setOpen((current) => ({ ...current, [String(category)]: true }));
    }
    write([
      [
        priorityOverrideKey(feature),
        category === null
          ? ""
          : JSON.stringify({ category, ...(reason ? { reason } : {}) })
      ]
    ]);
  };

  const editingFeature = editing ? featureByKey.get(editing) : undefined;

  return (
    <div className="flex flex-col h-full min-h-0">
      <h2 className="shrink-0 px-4 pt-5 pb-3 text-sm font-medium">
        <Trans>Your Carbon Setup</Trans>
      </h2>
      <div className="flex flex-col gap-6 min-h-0 overflow-y-auto px-4 pb-8">
        <Warnings set={set} areaOf={areaOf} nameOf={nameOf} />
        {lists.map(({ id, title, features }) => {
          if (!features.length && (blank || id === "maybe")) return null;
          const groups = [...new Set(features.map((f) => f.group))];
          const isOpen = open[id] ?? false;
          return (
            <Collapsible
              key={id}
              open={isOpen}
              onOpenChange={(next) =>
                setOpen((current) => ({ ...current, [id]: next }))
              }
            >
              <section className="flex flex-col gap-3">
                <h3 className="flex">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex flex-1 items-center gap-2 rounded-md text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      {title}
                      <Count count={features.length} />
                      <LuChevronDown
                        className={cn(
                          "ml-auto size-4 shrink-0 text-muted-foreground transition-transform",
                          isOpen && "rotate-180"
                        )}
                      />
                    </button>
                  </CollapsibleTrigger>
                </h3>
                <CollapsibleContent className="flex flex-col gap-4">
                  {groups.map((group) => (
                    <section key={group} className="flex flex-col gap-2">
                      <h4 className="text-xs font-medium text-muted-foreground">
                        {i18n._(PRIORITY_FEATURE_GROUP_NAME[group])}
                      </h4>
                      <ul className="flex flex-col rounded-lg border bg-card divide-y overflow-hidden">
                        {features
                          .filter((feature) => feature.group === group)
                          .map((feature) => (
                            <FeatureRow
                              key={feature.key}
                              feature={feature}
                              set={set}
                              state={state}
                              numbers={numbers}
                              canOverride={canOverride}
                              nameOf={nameOf}
                              waitingOn={waitingOn.get(feature.key)}
                              onEdit={() => setEditing(feature.key)}
                              onClear={() => setOverride(feature.key, null)}
                            />
                          ))}
                      </ul>
                    </section>
                  ))}
                </CollapsibleContent>
              </section>
            </Collapsible>
          );
        })}
      </div>
      {editingFeature ? (
        <OverrideModal
          feature={editingFeature}
          current={set.category[editingFeature.key] ?? null}
          override={state.overrides[editingFeature.key]}
          onClose={() => setEditing(null)}
          onSave={(category, reason) => {
            setOverride(editingFeature.key, category, reason);
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Warnings({
  set,
  areaOf,
  nameOf
}: {
  set: PrioritySet;
  areaOf: (row: string) => string;
  nameOf: (key: string) => string;
}) {
  const { t } = useLingui();
  const lines = [
    ...set.unmetNeeds.map(({ feature, anyOf }) => {
      const name = nameOf(feature);
      const options = anyOf.map(nameOf).join(", ");
      return t`${name} needs one of: ${options}.`;
    }),
    ...set.overriddenNeeds.map(({ feature, need }) => {
      const name = nameOf(feature);
      const needed = nameOf(need);
      return t`${name} needs ${needed}, which is set by hand to a later category.`;
    }),
    ...set.adoptionRisks.map(({ row, tool }) => {
      const area = areaOf(row);
      const current = tool ?? t`the current tool`;
      return t`${area}: keeping ${current} next to Carbon is an adoption risk.`;
    })
  ];
  if (!lines.length) return null;
  return (
    <Alert variant="warning">
      <LuTriangleAlert className="h-4 w-4" />
      <AlertTitle>
        <Trans>Needs attention</Trans>
      </AlertTitle>
      <AlertDescription>
        <ul className="list-disc pl-4">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function useReasonTag(
  numbers: Map<string, string>,
  nameOf: (key: string) => string
) {
  const { t } = useLingui();
  return (reason: PriorityReason): string => {
    switch (reason.type) {
      case "answer":
        return numbers.get(reason.question) ?? reason.question;
      case "lower":
        return `${numbers.get(reason.question) ?? reason.question} ↓`;
      case "system":
        return numbers.get("systems") ?? "systems";
      case "assumed":
        return t`assumed`;
      case "needed": {
        const feature = nameOf(reason.by);
        return t`needed by ${feature}`;
      }
      case "override":
        return t`set by hand`;
    }
  };
}

// One feature in the panel, shaped like a related-document row: its name, with
// what it covers and why it sits here in a hover card, and for Carbon staff a
// menu to set its category by hand.
function FeatureRow({
  feature,
  set,
  state,
  numbers,
  canOverride,
  nameOf,
  waitingOn,
  onEdit,
  onClear
}: {
  feature: PriorityFeature;
  set: PrioritySet;
  state: PriorityState;
  numbers: Map<string, string>;
  canOverride: boolean;
  nameOf: (key: string) => string;
  // The unsure questions that would settle a feature listed under Maybe.
  waitingOn?: string[];
  onEdit: () => void;
  onClear: () => void;
}) {
  const { t, i18n } = useLingui();
  const reasonTag = useReasonTag(numbers, nameOf);
  const reasons = set.reasons[feature.key] ?? [];
  const at = set.category[feature.key] ?? null;
  const override = state.overrides[feature.key];
  const name = i18n._(feature.name);
  const moved =
    at !== null && at !== feature.defaultCategory && state.start !== "blank";
  const usual = i18n._(PRIORITY_CATEGORY_NAME[feature.defaultCategory]);

  return (
    <li className="group flex items-center gap-3 px-3 py-2.5">
      <div className="flex flex-1 min-w-0">
        <HoverCard>
          <HoverCardTrigger asChild>
            <span
              tabIndex={0}
              className="w-full truncate whitespace-nowrap rounded-sm text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {name}
            </span>
          </HoverCardTrigger>
          <HoverCardContent className="w-80">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">{name}</p>
              <p className="text-xs text-muted-foreground text-pretty">
                {i18n._(feature.covers)}
              </p>
              {reasons.length ? (
                <p className="text-xs text-pretty">
                  <Trans>Here because:</Trans>{" "}
                  {reasons.map(reasonTag).join(", ")}
                </p>
              ) : null}
              {override?.reason ? (
                <p className="text-xs text-pretty">
                  <Trans>Set by hand:</Trans> {override.reason}
                </p>
              ) : null}
              {waitingOn?.length ? (
                <p className="text-xs text-pretty">
                  <Trans>Not sure on:</Trans> {waitingOn.join(", ")}
                </p>
              ) : null}
              {moved ? (
                <p className="text-xs text-muted-foreground">
                  {t`Usually ${usual}.`}
                </p>
              ) : null}
            </div>
          </HoverCardContent>
        </HoverCard>
      </div>
      {canOverride ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              aria-label={t`More options`}
              icon={<LuEllipsisVertical />}
              variant="ghost"
              size="sm"
              className="shrink-0 md:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuItem
              shortcut={MENU_ITEM_SHORTCUTS.edit}
              onClick={onEdit}
            >
              <DropdownMenuIcon icon={<LuPencil />} />
              <Trans>Set Category…</Trans>
            </DropdownMenuItem>
            {override ? (
              <DropdownMenuItem onClick={onClear}>
                <DropdownMenuIcon icon={<LuX />} />
                <Trans>Clear Override</Trans>
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
}

// Carbon staff set a feature's category by hand, with a reason kept in the set.
// The fields are uncontrolled and read on submit.
function OverrideModal({
  feature,
  current,
  override,
  onClose,
  onSave
}: {
  feature: PriorityFeature;
  current: PriorityCategory | null;
  override?: { category: PriorityCategory; reason?: string };
  onClose: () => void;
  onSave: (category: PriorityCategory, reason?: string) => void;
}) {
  const { t, i18n } = useLingui();
  const name = i18n._(feature.name);
  const initial = override?.category ?? current ?? feature.defaultCategory;

  return (
    <Modal open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const category = Number(data.get("category")) as PriorityCategory;
            const reason = String(data.get("reason") ?? "").trim();
            onSave(category, reason || undefined);
          }}
        >
          <ModalHeader>
            <ModalTitle>{t`Set Category for ${name}`}</ModalTitle>
            <ModalDescription>
              <Trans>
                Set by hand, the feature stays in this category whatever the
                answers say.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="priority-override-category">
                  <Trans>Category</Trans>
                </Label>
                <Select name="category" defaultValue={String(initial)}>
                  <SelectTrigger id="priority-override-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITY_CATEGORIES.map((category) => (
                      <SelectItem key={category} value={String(category)}>
                        {i18n._(PRIORITY_CATEGORY_NAME[category])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="priority-override-reason">
                  <Trans>Reason</Trans>
                </Label>
                <Textarea
                  id="priority-override-reason"
                  name="reason"
                  defaultValue={override?.reason ?? ""}
                  placeholder={t`Kept with the set`}
                />
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Button type="submit">
              <Trans>Save</Trans>
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
