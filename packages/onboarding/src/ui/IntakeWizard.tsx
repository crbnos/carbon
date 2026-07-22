import { Badge, Button, cn, DatePicker, Input } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  LuArrowLeft,
  LuArrowRight,
  LuCheck,
  LuLoaderCircle,
  LuMic,
  LuSparkles,
  LuSquare,
  LuUpload
} from "react-icons/lu";
import type {
  IntakeAnswers,
  IntakeQuestion
} from "../content/intake";
import { INTAKE_QUESTIONS } from "../content/intake";
import { diffIntake } from "../logic";
import { toCalendarDate } from "./date";

// "Tell Us How You Run" — one question per screen, thumb-sized answers, plain
// factory language. The wizard is presentational: persistence, transcription,
// and the AI clarifier are injected by the route so this stays client-safe.
//
// Voice is a first-class input: the microphone records, the route transcribes
// (and persists the transcript for Carbon's sales review), and for option
// questions the clarifier maps the spoken answer onto an option. "Not sure" is
// always legal — it resolves to the recommended answer and moves on.

export interface IntakeWizardProps {
  companyName: string;
  initialAnswers: IntakeAnswers;
  // Editing a completed intake (re-tune): show the change summary before
  // completing, so nothing ever applies silently.
  previousAnswers: IntakeAnswers | null;
  suggestedGoLiveDate: string; // YYYY-MM-DD
  saving: boolean;
  onSaveDraft: (answers: IntakeAnswers) => void;
  onComplete: (answers: IntakeAnswers) => void;
  onExit: () => void;
  // Returns the transcript text, or null on failure. The route persists it.
  onTranscribe: (
    audioBase64: string,
    mimeType: string,
    questionKey: string
  ) => Promise<string | null>;
  // Ask the AI to interpret free words against this question's options.
  // Returns a plain-language reply and, when confident, the option to apply.
  onClarify: (
    questionKey: string,
    message: string
  ) => Promise<{ reply: string; answerValue?: string } | null>;
  // Upload the optional "anything you have" file; returns its storage path.
  onUpload: (file: File) => Promise<{ path: string; name: string } | null>;
}

type MicState = "idle" | "recording" | "transcribing";

// Small voice recorder around MediaRecorder. Feature-detected: renders nothing
// where recording isn't available (SSR, no mic).
function MicButton({
  disabled,
  onTranscript
}: {
  disabled?: boolean;
  onTranscript: (audioBase64: string, mimeType: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const [state, setState] = useState<MicState>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const supported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";
  if (!supported) return null;

  const stop = () => {
    recorderRef.current?.stop();
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        for (const track of stream.getTracks()) track.stop();
        setState("transcribing");
        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error);
            reader.onloadend = () => {
              const result = String(reader.result ?? "");
              resolve(result.slice(result.indexOf(",") + 1));
            };
            reader.readAsDataURL(blob);
          });
          await onTranscript(base64, recorder.mimeType);
        } finally {
          setState("idle");
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setState("recording");
    } catch {
      setState("idle");
    }
  };

  return (
    <Button
      type="button"
      variant={state === "recording" ? "destructive" : "secondary"}
      size="sm"
      isDisabled={disabled || state === "transcribing"}
      leftIcon={
        state === "recording" ? (
          <LuSquare />
        ) : state === "transcribing" ? (
          <LuLoaderCircle className="animate-spin" />
        ) : (
          <LuMic />
        )
      }
      onClick={state === "recording" ? stop : start}
      aria-label={t`Answer by voice`}
    >
      {state === "recording" ? (
        <Trans>Stop</Trans>
      ) : state === "transcribing" ? (
        <Trans>Listening…</Trans>
      ) : (
        <Trans>Speak</Trans>
      )}
    </Button>
  );
}

export function IntakeWizard({
  companyName,
  initialAnswers,
  previousAnswers,
  suggestedGoLiveDate,
  saving,
  onSaveDraft,
  onComplete,
  onExit,
  onTranscribe,
  onClarify,
  onUpload
}: IntakeWizardProps) {
  const { t, i18n } = useLingui();
  const [answers, setAnswers] = useState<IntakeAnswers>(initialAnswers);
  const [index, setIndex] = useState(0);
  const [clarifying, setClarifying] = useState(false);
  const [clarifyReply, setClarifyReply] = useState<string | null>(null);
  const [clarifyText, setClarifyText] = useState("");
  const [showClarify, setShowClarify] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [uploading, setUploading] = useState(false);

  const questions = useMemo(
    () => INTAKE_QUESTIONS.filter((q) => !q.appliesTo || q.appliesTo(answers)),
    [answers]
  );
  const question = questions[Math.min(index, questions.length - 1)]!;
  const isLast = index >= questions.length - 1;

  const patch = useCallback((next: Partial<IntakeAnswers>) => {
    setAnswers((prev) => ({ ...prev, ...next }));
  }, []);

  const goTo = (nextIndex: number) => {
    setClarifyReply(null);
    setShowClarify(false);
    setClarifyText("");
    setIndex(Math.max(0, Math.min(nextIndex, questions.length - 1)));
  };

  const advance = () => {
    onSaveDraft(answers);
    if (!isLast) {
      goTo(index + 1);
      return;
    }
    // Finishing. A re-tune with changes shows the change summary first —
    // nothing applies silently.
    if (previousAnswers && diffIntake(previousAnswers, answers).hasChanges) {
      setConfirming(true);
      return;
    }
    onComplete(answers);
  };

  const applyClarifierValue = (value: string) => {
    const key = question.key as keyof IntakeAnswers;
    if (question.kind === "multi") {
      const values = value.split(",").map((v) => v.trim());
      const valid = values.filter((v) =>
        question.options?.some((o) => o.value === v)
      );
      if (valid.length > 0) patch({ [key]: valid } as Partial<IntakeAnswers>);
      return;
    }
    if (question.options?.some((o) => o.value === value)) {
      patch({ [key]: value } as Partial<IntakeAnswers>);
    }
  };

  const clarify = async (message: string) => {
    if (!message.trim()) return;
    setClarifying(true);
    try {
      const result = await onClarify(String(question.key), message);
      if (result) {
        setClarifyReply(result.reply);
        if (result.answerValue) applyClarifierValue(result.answerValue);
      }
    } finally {
      setClarifying(false);
    }
  };

  const handleTranscript = async (audioBase64: string, mimeType: string) => {
    const text = await onTranscribe(audioBase64, mimeType, String(question.key));
    if (!text) return;
    if (question.kind === "text") {
      patch({ [question.key as keyof IntakeAnswers]: text });
      return;
    }
    if (question.kind === "owner") {
      // Let the clarifier split "Maria Alvarez, maria@..." into the two fields
      // via its structured reply; fall back to dropping it in the name.
      patch({ ownerName: text });
      return;
    }
    // Option questions: the clarifier maps the spoken answer onto an option.
    await clarify(text);
  };

  const notSureOption = question.options?.find((o) => o.recommended);
  const answerValue = answers[question.key as keyof IntakeAnswers];
  const hasAnswer =
    question.optional ||
    question.kind === "upload" ||
    (question.kind === "owner"
      ? Boolean(answers.ownerName)
      : Array.isArray(answerValue)
        ? answerValue.length > 0
        : answerValue !== undefined && answerValue !== "");

  const diff =
    confirming && previousAnswers ? diffIntake(previousAnswers, answers) : null;

  if (confirming && diff) {
    return (
      <div className="w-full max-w-2xl mx-auto flex flex-col gap-6 py-10">
        <div>
          <h1 className="text-2xl font-semibold">
            <Trans>Here's what changes</Trans>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            <Trans>
              Nothing is deleted when your plan re-tunes — finished work keeps
              its record, even while hidden, and comes back if an answer changes
              again.
            </Trans>
          </p>
        </div>
        <ul className="flex flex-col gap-2">
          {diff.answers.map((change) => (
            <li
              key={change.key}
              className="rounded-lg border bg-card px-4 py-3 text-sm"
            >
              <div className="font-medium">{i18n._(change.ask)}</div>
              <div className="text-muted-foreground">
                {change.from ?? t`(blank)`} → {change.to ?? t`(blank)`}
              </div>
            </li>
          ))}
        </ul>
        {diff.planChanges.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm">
            {diff.planChanges.map((line, i) => (
              <li key={i} className="flex items-center gap-2">
                <LuSparkles className="size-3.5 text-primary shrink-0" />
                {i18n._(line)}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            <Trans>Keep editing</Trans>
          </Button>
          <Button
            isLoading={saving}
            isDisabled={saving}
            onClick={() => onComplete(answers)}
          >
            <Trans>Apply the changes</Trans>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto flex flex-col gap-8 py-10">
      {/* Progress */}
      <div className="flex items-center justify-between gap-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {i18n._(question.section)}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground tabular-nums">
            {index + 1} / {questions.length}
          </span>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={onExit}
          >
            <Trans>Save and finish later</Trans>
          </button>
        </div>
      </div>
      <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${((index + 1) / questions.length) * 100}%` }}
        />
      </div>

      {/* The question */}
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold leading-snug">
          {i18n._(question.ask)}
        </h1>
        {question.helper ? (
          <p className="text-sm text-muted-foreground">
            {i18n._(question.helper)}
          </p>
        ) : null}
      </div>

      {/* The answer */}
      <QuestionInput
        question={question}
        answers={answers}
        patch={patch}
        suggestedGoLiveDate={suggestedGoLiveDate}
        uploading={uploading}
        onUploadFile={async (file) => {
          setUploading(true);
          try {
            const uploaded = await onUpload(file);
            if (uploaded) {
              patch({ uploadPath: uploaded.path, uploadName: uploaded.name });
            }
          } finally {
            setUploading(false);
          }
        }}
      />

      {/* Talk it through */}
      {clarifyReply ? (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm flex gap-2">
          <LuSparkles className="size-4 text-primary shrink-0 mt-0.5" />
          <span>{clarifyReply}</span>
        </div>
      ) : null}
      {showClarify ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void clarify(clarifyText);
            setClarifyText("");
          }}
        >
          <Input
            value={clarifyText}
            onChange={(e) => setClarifyText(e.target.value)}
            placeholder={t`Tell us in your own words…`}
            autoFocus
          />
          <Button type="submit" isLoading={clarifying} isDisabled={clarifying}>
            <Trans>Ask</Trans>
          </Button>
        </form>
      ) : null}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        {index > 0 ? (
          <Button
            variant="ghost"
            leftIcon={<LuArrowLeft />}
            onClick={() => goTo(index - 1)}
          >
            <Trans>Back</Trans>
          </Button>
        ) : null}
        <div className="flex-1" />
        <MicButton disabled={clarifying} onTranscript={handleTranscript} />
        {question.kind !== "text" && question.kind !== "upload" ? (
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<LuSparkles />}
            onClick={() => setShowClarify((v) => !v)}
          >
            <Trans>Talk it through</Trans>
          </Button>
        ) : null}
        {notSureOption && question.notSure !== false ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              patch({
                [question.key as keyof IntakeAnswers]: notSureOption.value
              } as Partial<IntakeAnswers>);
              advance();
            }}
          >
            <Trans>Not sure — use the recommended answer</Trans>
          </Button>
        ) : null}
        <Button
          rightIcon={isLast ? <LuCheck /> : <LuArrowRight />}
          isDisabled={!hasAnswer || saving}
          isLoading={isLast && saving}
          onClick={advance}
        >
          {isLast ? <Trans>Build my plan</Trans> : <Trans>Next</Trans>}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        <Trans>
          Answers only shape the plan for {companyName} — you can change any of
          them later, and we'll show you exactly what moves before it does.
        </Trans>
      </p>
    </div>
  );
}

function QuestionInput({
  question,
  answers,
  patch,
  suggestedGoLiveDate,
  uploading,
  onUploadFile
}: {
  question: IntakeQuestion;
  answers: IntakeAnswers;
  patch: (next: Partial<IntakeAnswers>) => void;
  suggestedGoLiveDate: string;
  uploading: boolean;
  onUploadFile: (file: File) => Promise<void>;
}) {
  const { t, i18n } = useLingui();
  const key = question.key as keyof IntakeAnswers;
  const value = answers[key];

  switch (question.kind) {
    case "text":
      return (
        <Input
          value={typeof value === "string" ? value : ""}
          onChange={(e) => patch({ [key]: e.target.value })}
          placeholder={t`Type it, or press Speak`}
          autoFocus
        />
      );

    case "single":
    case "multi": {
      const selected = new Set(
        question.kind === "multi"
          ? Array.isArray(value)
            ? (value as string[])
            : []
          : typeof value === "string"
            ? [value]
            : []
      );
      return (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {question.options?.map((option) => {
              const active = selected.has(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  className={cn(
                    "rounded-xl border px-4 py-3 text-left text-sm transition",
                    active
                      ? "border-primary bg-primary/5 font-medium"
                      : "bg-card hover:border-primary/40"
                  )}
                  onClick={() => {
                    if (question.kind === "multi") {
                      const next = new Set(selected);
                      if (next.has(option.value)) next.delete(option.value);
                      else next.add(option.value);
                      patch({
                        [key]: Array.from(next)
                      } as Partial<IntakeAnswers>);
                    } else {
                      patch({ [key]: option.value } as Partial<IntakeAnswers>);
                    }
                  }}
                >
                  <span className="flex items-center justify-between gap-2">
                    {i18n._(option.label)}
                    {active ? (
                      <LuCheck className="size-4 text-primary shrink-0" />
                    ) : null}
                  </span>
                  {option.hint ? (
                    <span className="block text-xs text-muted-foreground mt-1">
                      {i18n._(option.hint)}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Follow-up toggle on the same screen (tracking → regulator?) */}
          {question.followUp &&
          typeof value === "string" &&
          value !== "none" ? (
            <div className="flex items-center gap-3 text-sm">
              <span>{i18n._(question.followUp.ask)}</span>
              {[true, false].map((yes) => (
                <Button
                  key={String(yes)}
                  size="sm"
                  variant={
                    answers[question.followUp!.key] === yes
                      ? "primary"
                      : "secondary"
                  }
                  onClick={() =>
                    patch({
                      [question.followUp!.key]: yes
                    } as Partial<IntakeAnswers>)
                  }
                >
                  {yes ? <Trans>Yes</Trans> : <Trans>No</Trans>}
                </Button>
              ))}
            </div>
          ) : null}

          {/* Detail text when a specific option is on (legacy ERP → which?) */}
          {question.detailFor && selected.has(question.detailFor.value) ? (
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">
                {i18n._(question.detailFor.ask)}
              </label>
              <Input
                value={
                  typeof answers[question.detailFor.key] === "string"
                    ? (answers[question.detailFor.key] as string)
                    : ""
                }
                onChange={(e) =>
                  patch({
                    [question.detailFor!.key]: e.target.value
                  } as Partial<IntakeAnswers>)
                }
              />
            </div>
          ) : null}
        </div>
      );
    }

    case "owner":
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input
            value={answers.ownerName ?? ""}
            onChange={(e) => patch({ ownerName: e.target.value })}
            placeholder={t`Name`}
            autoFocus
          />
          <Input
            value={answers.ownerEmail ?? ""}
            onChange={(e) => patch({ ownerEmail: e.target.value })}
            placeholder={t`Email`}
            type="email"
          />
        </div>
      );

    case "date":
      return (
        <div className="flex flex-wrap items-center gap-3">
          <DatePicker
            value={toCalendarDate(answers.goLiveDate)}
            onChange={(date) =>
              patch({ goLiveDate: date ? date.toString() : undefined })
            }
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => patch({ goLiveDate: suggestedGoLiveDate })}
          >
            <Trans>Use the suggested date</Trans>
          </Button>
          <Badge variant="secondary">{suggestedGoLiveDate}</Badge>
        </div>
      );

    case "upload":
      return (
        <div className="flex flex-col gap-3">
          {answers.uploadName ? (
            <div className="rounded-lg border bg-card px-4 py-3 text-sm flex items-center gap-2">
              <LuCheck className="size-4 text-primary" />
              {answers.uploadName}
            </div>
          ) : null}
          <label
            className={cn(
              "rounded-xl border border-dashed px-6 py-8 text-center text-sm cursor-pointer transition hover:border-primary/50",
              uploading && "opacity-60 pointer-events-none"
            )}
          >
            <LuUpload className="size-5 mx-auto mb-2 text-muted-foreground" />
            {uploading ? (
              <Trans>Reading your file…</Trans>
            ) : (
              <Trans>Drop a file here, or click to pick one</Trans>
            )}
            <input
              type="file"
              className="hidden"
              accept=".csv,.tsv,.txt,.xlsx,.xls"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onUploadFile(file);
              }}
            />
          </label>
        </div>
      );

    default:
      return null;
  }
}
