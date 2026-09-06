"use client";

/**
 * Quiz / QuizQuestion / QuizOption — an inline "check your understanding" block.
 *
 * Anonymous by design: the docs site has no user and no backend, so a pick is
 * remembered per page in localStorage and nothing leaves the browser. The
 * scored, certificate-bearing version of this lives in the ERP under Learn.
 *
 * The answer travels to the browser — it has to, because grading happens here
 * with no server to ask. That is fine for a self-check and NOT fine for
 * anything that scores you: the certificate-bearing quizzes in the ERP keep
 * their banks in `*.server.ts` and grade server-side.
 *
 * Keeping the answer and explanation in ATTRIBUTES rather than children buys
 * two things: the search index (which reads rendered structure) sees only the
 * option text, and `scripts/generate-agent-kb.ts` drops the whole block, so the
 * in-app agent is never taught the deliberately-plausible wrong answers.
 *
 * Usage in MDX:
 *   <Quiz>
 *     <QuizQuestion
 *       prompt="A receipt posts for 40 of 50 units. What does the order show?"
 *       answer="b"
 *       explanation="Status is computed from the lines, never typed."
 *     >
 *       <QuizOption id="a">Completed</QuizOption>
 *       <QuizOption id="b">To Receive and Invoice</QuizOption>
 *     </QuizQuestion>
 *   </Quiz>
 */
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useState
} from "react";

export function Quiz({ children }: { children: ReactNode }) {
  let index = 0;
  return (
    <div className="not-prose my-8 flex flex-col gap-4">
      {Children.map(children, (child) =>
        isValidElement(child)
          ? cloneElement(child, { _index: index++ } as { _index: number })
          : child
      )}
    </div>
  );
}

type QuizQuestionProps = {
  prompt: string;
  answer: string;
  explanation: string;
  children: ReactNode;
  _index?: number;
};

export function QuizQuestion({
  prompt,
  answer,
  explanation,
  children,
  _index = 0
}: QuizQuestionProps) {
  const pathname = usePathname();
  const key = `carbon-docs:quiz:${pathname}:${_index}`;
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    try {
      setPicked(window.localStorage.getItem(key));
    } catch {
      // Private browsing and blocked site data both throw here; an
      // un-remembered quiz still works perfectly.
    }
  }, [key]);

  function choose(id: string) {
    setPicked(id);
    try {
      window.localStorage.setItem(key, id);
    } catch {
      // Ignore — the pick still applies for this page view.
    }
  }

  const options = Children.toArray(children).filter(isValidElement) as Array<
    React.ReactElement<{ id: string; children: ReactNode }>
  >;

  const correct = picked === answer;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-ed-15 font-medium leading-snug text-pretty">{prompt}</p>

      <div className="mt-4 flex flex-col gap-2">
        {options.map((option) => {
          const id = option.props.id;
          const isPicked = picked === id;
          const isAnswer = id === answer;

          let tone = "border-border hover:border-brand/60";
          if (picked) {
            if (isAnswer) tone = "border-brand bg-brand/5";
            else if (isPicked) tone = "border-destructive/60 bg-destructive/5";
            else tone = "border-border opacity-60";
          }

          return (
            <button
              key={id}
              type="button"
              onClick={() => choose(id)}
              aria-pressed={isPicked}
              className={`flex items-start gap-3 rounded-lg border p-3 text-left text-ed-15 transition-colors ${tone}`}
            >
              <span className="mt-0.5 shrink-0 font-mono text-xs text-muted-foreground uppercase">
                {id}
              </span>
              <span>{option.props.children}</span>
            </button>
          );
        })}
      </div>

      {picked && (
        <p className="mt-4 text-ed-15 leading-relaxed text-muted-foreground">
          <span
            className={
              correct ? "font-medium text-brand" : "font-medium text-foreground"
            }
          >
            {correct ? "Correct. " : "Not quite. "}
          </span>
          {explanation}
        </p>
      )}
    </div>
  );
}

export function QuizOption({
  children
}: {
  id: string;
  children: ReactNode;
}) {
  // Rendered by QuizQuestion, which needs the `id` prop; this component exists
  // so MDX authors can write real elements rather than a props array.
  return <>{children}</>;
}
