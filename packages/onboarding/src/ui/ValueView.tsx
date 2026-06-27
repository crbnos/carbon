import { Trans, useLingui } from "@lingui/react/macro";
import { LuArrowRight } from "react-icons/lu";
import { PAGE_COPY, UI_TEXT } from "../content";
import {
  VALUE_GOALS,
  VALUE_METRICS,
  VALUE_POINTS,
  VALUE_PROBLEMS
} from "../content/value";
import { EditableField } from "./EditableField";
import { PageHeader, Panel } from "./primitives";
import { useCanEdit, useFieldMap } from "./state";

export function ValueView() {
  const { t, i18n } = useLingui();
  const canEdit = useCanEdit();
  const fields = useFieldMap();

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {i18n._(PAGE_COPY.value.title)}
            {canEdit ? (
              <span className="text-xxs uppercase tracking-wide rounded px-1.5 py-0.5 border text-muted-foreground font-medium">
                <Trans>Optional</Trans>
              </span>
            ) : null}
          </span>
        }
        lead={i18n._(PAGE_COPY.value.lead)}
      />

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {VALUE_METRICS.map((metric) => (
          <div
            key={metric.key}
            className="rounded-2xl border bg-card shadow-button-base p-5 flex flex-col gap-1"
          >
            <EditableField
              fieldKey={`${metric.key}.value`}
              value={fields.get(`${metric.key}.value`)}
              defaultValue={metric.value}
              placeholder={t`Target`}
              className="text-xl font-semibold tracking-tight"
            />
            <EditableField
              fieldKey={`${metric.key}.label`}
              value={fields.get(`${metric.key}.label`)}
              defaultValue={metric.label}
              placeholder={t`Metric`}
              className="text-xs text-muted-foreground"
            />
          </div>
        ))}
      </section>
      {canEdit ? (
        <p className="text-xxs text-muted-foreground -mt-3">
          {i18n._(UI_TEXT.carbonOnlyValueNote)}
        </p>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Panel title={t`Where you are today`}>
          <ul className="flex flex-col gap-2">
            {VALUE_PROBLEMS.map((p, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm">
                <span className="shrink-0 mt-1.5 size-1.5 rounded-full bg-red-500/70" />
                {i18n._(p)}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title={t`Where you want to grow`}>
          <ul className="flex flex-col gap-2">
            {VALUE_GOALS.map((g, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm">
                <span className="shrink-0 mt-1.5 size-1.5 rounded-full bg-emerald-500" />
                {i18n._(g)}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title={t`What changes day to day`}>
        <div className="flex flex-col gap-4">
          {VALUE_POINTS.map((v, i) => (
            <div key={i} className="flex items-start gap-3">
              <LuArrowRight className="shrink-0 mt-0.5 text-primary" />
              <div>
                <div className="text-sm font-medium">{i18n._(v.title)}</div>
                <div className="text-sm text-muted-foreground mt-0.5">
                  {i18n._(v.body)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
