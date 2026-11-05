// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import { ClientOnly, cn, generateHTML, Status } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { createElement, useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { Empty } from "~/components";
import { useQuantityFormatter } from "~/hooks";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import type {
  ElementVerification,
  RequirementStatus,
  TestCaseVerdict
} from "../../projects.models";
import {
  buildReaderOutline,
  formatAllocation,
  formatRequirementTarget
} from "../../projects.models";
import type { ProjectElementListItem } from "../../projects.service";
import { ElementTypeIcon, useElementTypeLabels } from "./ElementTypeIcon";
import { VerificationStatus } from "./VerificationStatus";

type ElementReaderProps = {
  projectId: string;
  elements: ProjectElementListItem[];
  descriptions: Record<string, unknown>;
  verification: Record<string, ElementVerification>;
  requirementStatus: Record<string, RequirementStatus>;
};

const VERDICT_COLOR = {
  "Not Run": "gray",
  Pass: "green",
  Fail: "red",
  Inconclusive: "orange"
} as const satisfies Record<TestCaseVerdict, string>;

/**
 * The Reader layout: the filtered elements in tree order as one document,
 * with outline numbers, a property line, the description and the
 * Requirement, Parameter or Test Case facts. A table of contents sits on the
 * left on a wide pane. Read only.
 */
export function ElementReader({
  projectId,
  elements,
  descriptions,
  verification,
  requirementStatus
}: ElementReaderProps) {
  const outline = useMemo(() => buildReaderOutline(elements), [elements]);

  if (outline.length === 0) {
    return (
      <Empty title={<Trans>No elements to show</Trans>} description={null} />
    );
  }

  return (
    <div className="@container h-full min-h-0 overflow-y-auto">
      <div className="flex gap-8 px-6 py-6">
        <nav className="sticky top-0 hidden max-h-[calc(100dvh-12rem)] w-56 shrink-0 self-start overflow-y-auto @min-[56rem]:block">
          <p className="mb-2 text-xs text-muted-foreground">
            <Trans>Contents</Trans>
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {outline.map((entry) => (
              <li key={entry.element.id}>
                <a
                  href={`#element-${entry.element.id}`}
                  className="flex min-w-0 gap-2 text-muted-foreground hover:text-foreground"
                  style={{ paddingLeft: Math.min(entry.level, 4) * 12 }}
                >
                  <span className="shrink-0 tabular-nums">{entry.number}</span>
                  <span className="truncate">{entry.element.name}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <article className="flex min-w-0 max-w-3xl flex-1 flex-col gap-8">
          {outline.map((entry) => (
            <ReaderSection
              key={entry.element.id}
              projectId={projectId}
              element={entry.element}
              level={entry.level}
              number={entry.number}
              description={descriptions[entry.element.id]}
              verification={verification}
              status={requirementStatus[entry.element.id]}
            />
          ))}
        </article>
      </div>
    </div>
  );
}

function ReaderSection({
  projectId,
  element,
  level,
  number,
  description,
  verification,
  status
}: {
  projectId: string;
  element: ProjectElementListItem;
  level: number;
  number: string;
  description: unknown;
  verification: Record<string, ElementVerification>;
  status: RequirementStatus | undefined;
}) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const [searchParams] = useSearchParams();
  const [people] = usePeople();
  const typeLabels = useElementTypeLabels();
  const formatQuantity = useQuantityFormatter();
  const owner = element.ownerId
    ? people.find((person) => person.id === element.ownerId)?.name
    : null;
  const query = searchParams.toString();
  const headingLevel = Math.min(level + 2, 6);
  const own = verification[element.id];
  const target = formatRequirementTarget(element, locale);
  const verdictLabels: Record<TestCaseVerdict, string> = {
    "Not Run": t`Not Run`,
    Pass: t`Pass`,
    Fail: t`Fail`,
    Inconclusive: t`Inconclusive`
  };

  return (
    <section
      id={`element-${element.id}`}
      className="flex scroll-mt-4 flex-col gap-2"
    >
      {createElement(
        `h${headingLevel}`,
        {
          className: cn(
            "flex items-baseline gap-2 font-semibold tracking-tight",
            headingLevel <= 2
              ? "text-xl"
              : headingLevel === 3
                ? "text-lg"
                : "text-base"
          )
        },
        <span className="tabular-nums text-muted-foreground">{number}</span>,
        <Link
          to={`${path.to.projectElement(projectId, element.id)}${query ? `?${query}` : ""}`}
          className="whitespace-nowrap font-mono text-sm font-normal text-muted-foreground hover:underline"
        >
          {element.readableId}
        </Link>,
        <span>{element.name}</span>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <ElementTypeIcon type={element.type} className="size-3.5" />
          {typeLabels[element.type]}
        </span>
        {element.state && <span>{element.state.name}</span>}
        {owner && <span>{owner}</span>}
      </div>
      {element.type === "Requirement" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            <Trans>Target</Trans>
          </span>
          <span className="tabular-nums">{target ?? "—"}</span>
          <VerificationStatus status={status} />
        </div>
      )}
      {element.type === "Parameter" && own?.kind === "Parameter" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            <Trans>Value</Trans>
          </span>
          <span className="tabular-nums">
            {own.computedValue === null
              ? (own.reason ?? t`No value`)
              : `${formatQuantity(own.computedValue)}${element.parameterUnit ? ` ${element.parameterUnit}` : ""}`}
          </span>
          {own.budgetValue !== null &&
            own.parentValue !== null &&
            element.allocationPercent !== null && (
              <span className="tabular-nums text-muted-foreground">
                {formatAllocation(
                  own.budgetValue,
                  Number(element.allocationPercent),
                  own.parentValue,
                  element.parameterUnit,
                  locale
                )}
              </span>
            )}
        </div>
      )}
      {element.type === "Test Case" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            <Trans>Verdict</Trans>
          </span>
          <Status color={VERDICT_COLOR[element.verdict ?? "Not Run"]}>
            {verdictLabels[element.verdict ?? "Not Run"]}
          </Status>
        </div>
      )}
      {description !== undefined && description !== null && (
        <ClientOnly fallback={null}>
          {() => (
            <div
              className="prose prose-sm max-w-none dark:prose-invert"
              dangerouslySetInnerHTML={{
                __html: generateHTML(description as JSONContent)
              }}
            />
          )}
        </ClientOnly>
      )}
    </section>
  );
}
