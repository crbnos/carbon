import { cn } from "@carbon/react";

/**
 * The question/answer board that fills the body of a display.
 *
 * Rows are a fixed four-column grid — question, answer, detail label, detail
 * value — so the answer column lines up down the whole board and the eye can
 * scan one vertical strip instead of reading every line. Rows share the
 * available height rather than being fixed-height, so the board fills any
 * screen it is hung on without scrolling.
 */

export type AnswerTone = "neutral" | "good" | "warn" | "danger";

export function Scoreboard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col divide-y divide-white/10">
      {children}
    </div>
  );
}

export function ScoreboardRow({
  question,
  answer,
  detailLabel,
  detailValue,
  tone = "neutral",
  emphasis = false,
  detailWide = false
}: {
  question: React.ReactNode;
  answer: React.ReactNode;
  detailLabel?: React.ReactNode;
  detailValue?: React.ReactNode;
  tone?: AnswerTone;
  /** Draw the whole row hot — used when the row is the reason the board is red. */
  emphasis?: boolean;
  /**
   * Drop the label + fixed-width value cells for a single full-width value
   * cell. Use for a detail that is an identifier rather than a count — e.g. a
   * dispatch number, which is too wide for the 6ch value column and would clip.
   * The answer column keeps its minimum width so it still lines up down the board.
   */
  detailWide?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid min-h-0 flex-1 items-center gap-[1.5vw] px-[2vw]",
        detailWide
          ? // question | answer | value (packed right beside the answer, like
            // the label+value pair on the count rows)
            "grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_minmax(9ch,auto)_auto]"
          : // question | answer | detail label | detail value
            "grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_minmax(9ch,auto)_auto_6ch]",
        emphasis && "bg-red-950/60"
      )}
    >
      <div
        className="truncate font-medium text-white/85"
        style={{ fontSize: "clamp(0.8rem, 1.9vw, 2.4rem)" }}
        title={typeof question === "string" ? question : undefined}
      >
        {question}
      </div>

      <AnswerCell tone={tone}>{answer}</AnswerCell>

      {detailWide ? (
        <div
          className="hidden truncate text-right font-bold tabular-nums text-white sm:block"
          style={{ fontSize: "clamp(0.8rem, 1.9vw, 2.4rem)" }}
        >
          {detailValue}
        </div>
      ) : (
        <>
          <div
            className="hidden truncate text-right font-medium uppercase tracking-wide text-white/45 sm:block"
            style={{ fontSize: "clamp(0.7rem, 1.2vw, 1.5rem)" }}
          >
            {detailLabel}
          </div>
          <div
            className="hidden text-right font-bold tabular-nums text-white sm:block"
            style={{ fontSize: "clamp(0.8rem, 1.9vw, 2.4rem)" }}
          >
            {detailValue}
          </div>
        </>
      )}
    </div>
  );
}

const TONES: Record<AnswerTone, string> = {
  neutral: "bg-white/10 text-white/80",
  good: "bg-emerald-500 text-white",
  warn: "bg-amber-500 text-black",
  danger: "bg-red-600 text-white"
};

export function AnswerCell({
  tone = "neutral",
  children
}: {
  tone?: AnswerTone;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-md px-[1vw] py-[0.6vh] text-center font-bold uppercase tabular-nums leading-none",
        TONES[tone]
      )}
      style={{ fontSize: "clamp(0.8rem, 1.7vw, 2.2rem)" }}
    >
      {children}
    </div>
  );
}

/** Tone for a count-style row: red above zero when the count is a problem. */
export function countTone(
  count: number,
  severity: "warn" | "danger"
): AnswerTone {
  if (count <= 0) return "neutral";
  return severity;
}
