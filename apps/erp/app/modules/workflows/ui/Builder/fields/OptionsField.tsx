import { Button, Combobox, MultiSelect } from "@carbon/react";
import type { OptionsSource, ValueOrRef, ValueType } from "@carbon/workflows";
import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "react-router";
import { Field } from "./Field";
import { useWorkflowOptions } from "./useWorkflowOptions";

const STRING_TYPE: ValueType = { kind: "primitive", of: "string" };

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
  help,
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
  /** The vendor's own field description, for the ⓘ hover. */
  help?: string;
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
  const {
    ready,
    missing,
    loaded,
    isLoading,
    options,
    emptyHref,
    errorCode,
    errorHref,
    retry
  } = useWorkflowOptions(source, values);

  if (!ready) {
    const named = missing
      .map((name) => dependencyLabels[name] ?? name)
      .join(", ");
    return (
      <Field label={label} help={help} required={required} issue={issue}>
        <p className="text-sm text-muted-foreground">
          <Trans>Choose {named} first.</Trans>
        </p>
      </Field>
    );
  }

  // A failed lookup is NOT an empty one. Without this the vendor's error fell
  // through to an empty dropdown, which reads as "this account has nothing" —
  // sending the author off to fix data that was never the problem.
  if (loaded && errorCode) {
    return (
      <Field label={label} help={help} required={required} issue={issue}>
        <div className="flex flex-wrap items-center gap-2">
          {/* The specific reason when the provider knew one — "this account needs
              to be reconnected" is actionable, "couldn't load the choices" is not. */}
          <p className="text-sm text-muted-foreground">
            {errorCode === "reconnect" ? (
              <Trans>This account needs to be reconnected.</Trans>
            ) : errorCode === "refreshing" ? (
              <Trans>
                That account is still being reconnected. Try again in a moment.
              </Trans>
            ) : (
              <Trans>Couldn't load the choices for this field.</Trans>
            )}
          </p>
          {errorHref ? (
            <Link
              className="text-sm underline underline-offset-2"
              to={errorHref}
              target="_blank"
              rel="noreferrer"
            >
              <Trans>Fix this</Trans>
            </Link>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={retry}
            isDisabled={isReadOnly}
            isLoading={isLoading}
          >
            <Trans>Try again</Trans>
          </Button>
        </div>
      </Field>
    );
  }

  // Nothing to pick and somewhere to go and make one: a dropdown the author cannot
  // do anything about is worse than a link out.
  if (loaded && options.length === 0 && emptyHref) {
    return (
      <Field label={label} help={help} required={required} issue={issue}>
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

  const placeholder = isLoading || !loaded ? t`Loading…` : t`Select an option…`;

  return (
    <Field label={label} help={help} required={required} issue={issue}>
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
