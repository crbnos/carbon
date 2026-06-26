import { CADENCE, ESCALATION } from "../content/howwework";
import { EditableField } from "./EditableField";
import { useFieldMap } from "./state";

export function HowWeWorkView() {
  const fields = useFieldMap();
  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          How We Work Together
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl text-pretty">
          How we stay aligned and how issues get resolved. Your part: show up to
          the weekly call and raise blockers early, before they become delays.
        </p>
      </header>

      <section className="rounded-2xl border bg-card shadow-button-base overflow-hidden">
        <div className="px-5 py-3 border-b">
          <span className="text-sm font-semibold">Meeting cadence</span>
        </div>
        <ul className="divide-y">
          {CADENCE.map((c) => (
            <li key={c.key} className="flex items-center gap-4 px-5 py-3">
              <span className="text-sm font-medium w-28 shrink-0">
                {c.cadence}
              </span>
              <EditableField
                fieldKey={`howWeWork.cadence.${c.key}`}
                value={fields.get(`howWeWork.cadence.${c.key}`)}
                defaultValue={c.what}
                className="text-sm text-muted-foreground flex-1"
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border bg-card shadow-button-base p-5">
        <h2 className="text-sm font-semibold mb-4">
          If something is off track
        </h2>
        <ol className="flex flex-col gap-4">
          {ESCALATION.map((step) => (
            <li key={step.n} className="flex items-start gap-3">
              <span className="shrink-0 size-6 rounded-lg border bg-background flex items-center justify-center text-xs font-semibold tabular-nums">
                {step.n}
              </span>
              <div>
                <div className="text-sm font-medium">{step.title}</div>
                <div className="text-sm text-muted-foreground mt-0.5">
                  {step.body}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="rounded-2xl border-l-2 border-l-primary bg-muted/30 px-5 py-4">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">The principle:</span>{" "}
          raise it early and raise it plainly. A problem named in week 2 is a
          small fix; the same problem at go-live is a delay.
        </p>
      </div>
    </div>
  );
}
