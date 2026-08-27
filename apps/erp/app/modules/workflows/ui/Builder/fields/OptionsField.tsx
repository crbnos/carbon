import { Combobox, MultiSelect } from "@carbon/react";
import type { OptionsSource, ValueOrRef, ValueType } from "@carbon/workflows";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo } from "react";
import { Link, useFetcher } from "react-router";
import { path } from "~/utils/path";
import { Field } from "./Field";

const STRING_TYPE: ValueType = { kind: "primitive", of: "string" };

type Loaded = {
  options: { label: string; value: string }[];
  emptyHref?: string;
  error?: string;
};

function literal(value: string | undefined): ValueOrRef | undefined {
  return value ? { kind: "literal", type: STRING_TYPE, value } : undefined;
}

function literalValue(value: ValueOrRef | undefined): string | undefined {
  return value?.kind === "literal" && typeof value.value === "string"
    ? value.value
    : undefined;
}

function literalList(value: ValueOrRef | undefined): string[] {
  if (value?.kind !== "literal" || !Array.isArray(value.value)) return [];
  return value.value.filter((item): item is string => typeof item === "string");
}

/**
 * An input whose choices are fetched while editing rather than listed in the
 * catalog. It knows only the provider id, the fixed params and the values of the
 * inputs it depends on — never what the list is, or who answers for it.
 */
export function OptionsField({
  label,
  source,
  type,
  values,
  dependencyLabels,
  required,
  value,
  onChange,
  issue,
  isReadOnly
}: {
  label: string;
  source: OptionsSource;
  type: ValueType;
  /** Current literal values of this input's `dependsOn` inputs. */
  values: Record<string, string>;
  /** Human labels for the same, for the "choose X first" prompt. */
  dependencyLabels: Record<string, string>;
  required?: boolean;
  value: ValueOrRef | undefined;
  onChange: (next: ValueOrRef | undefined) => void;
  issue?: string;
  isReadOnly?: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<Loaded>();

  const dependsOn = useMemo(() => source.dependsOn ?? [], [source.dependsOn]);
  const missing = dependsOn.filter((name) => !values[name]);
  const ready = missing.length === 0;

  // `values` is a fresh object every render, so the serialized payload (stable by
  // value) is what identifies the request rather than the object's identity.
  const payload = JSON.stringify(
    Object.fromEntries(dependsOn.map((name) => [name, values[name] ?? ""]))
  );

  const query = useMemo(() => {
    const params = new URLSearchParams({ provider: source.provider });
    if (source.params) params.set("params", JSON.stringify(source.params));
    if (dependsOn.length > 0) params.set("values", payload);
    return params.toString();
  }, [source.provider, source.params, dependsOn, payload]);

  useEffect(() => {
    if (!ready) return;
    if (fetcher.state === "idle" && fetcher.data === undefined) {
      fetcher.load(`${path.to.api.workflowOptions}?${query}`);
    }
  }, [fetcher, query, ready]);

  if (!ready) {
    const named = missing
      .map((name) => dependencyLabels[name] ?? name)
      .join(", ");
    return (
      <Field label={label} required={required} issue={issue}>
        <p className="text-sm text-muted-foreground">
          <Trans>Choose {named} first.</Trans>
        </p>
      </Field>
    );
  }

  const loaded = fetcher.data !== undefined;
  const options = fetcher.data?.options ?? [];
  const emptyHref = fetcher.data?.emptyHref;

  // Nothing to pick and somewhere to go and make one: a dropdown the author cannot
  // do anything about is worse than a link out.
  if (loaded && options.length === 0 && emptyHref) {
    return (
      <Field label={label} required={required} issue={issue}>
        <p className="text-sm text-muted-foreground">
          <Trans>
            Nothing to choose yet -{" "}
            <Link className="underline" to={emptyHref}>
              set one up in Settings
            </Link>
            .
          </Trans>
        </p>
      </Field>
    );
  }

  const placeholder =
    fetcher.state === "loading" || !loaded ? t`Loading…` : t`Select an option…`;

  return (
    <Field
      label={label}
      required={required}
      issue={issue ?? fetcher.data?.error}
    >
      {type.kind === "list" ? (
        <MultiSelect
          options={options}
          value={literalList(value)}
          isReadOnly={isReadOnly}
          placeholder={placeholder}
          onChange={(next) =>
            onChange(
              next.length > 0
                ? { kind: "literal", type, value: next }
                : undefined
            )
          }
        />
      ) : (
        <Combobox
          options={options}
          value={literalValue(value)}
          isClearable
          isReadOnly={isReadOnly}
          placeholder={placeholder}
          onChange={(next) => onChange(literal(next || undefined))}
        />
      )}
    </Field>
  );
}
