// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { formatDate, SCALE_FORMAT } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale, useNumberFormatter } from "@react-aria/i18n";
import type { getJobCorrections } from "../../production.service";

type JobCorrection = NonNullable<
  Awaited<ReturnType<typeof getJobCorrections>>["data"]
>[number];

/**
 * A job make method's corrections, read-only: the rework-only routings
 * snapshotted from the make method, the step results that suggest each one,
 * and each time it was used on this job. Hidden when there are none.
 */
export default function JobCorrections({
  corrections
}: {
  corrections: JobCorrection[];
}) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const formatter = useNumberFormatter(SCALE_FORMAT);

  if (corrections.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Corrections</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Rework-only operations that a step result suggests. This job keeps
            its own copy from the make method.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <VStack spacing={8}>
          {corrections.map((correction) => (
            <VStack key={correction.id} spacing={3} className="w-full">
              <HStack spacing={2} className="flex-wrap">
                <span className="font-semibold">{correction.name}</span>
                <Badge variant="outline">
                  {correction.returnTo === "Continue"
                    ? t`Then continue`
                    : t`Then re-inspect`}
                </Badge>
                {correction.maxAttempts !== null && (
                  <Badge variant="secondary">
                    {t`Max ${correction.maxAttempts} per unit`}
                  </Badge>
                )}
              </HStack>
              {correction.description && (
                <span className="text-sm text-muted-foreground">
                  {correction.description}
                </span>
              )}

              <Section title={t`Operations`}>
                {correction.operations.length === 0 ? (
                  <EmptyRow>
                    <Trans>No operations</Trans>
                  </EmptyRow>
                ) : (
                  correction.operations.map((operation, index) => (
                    <Row key={operation.key}>
                      <span className="text-sm min-w-0 flex-1 truncate">
                        <span className="text-muted-foreground tabular-nums mr-2">
                          {index + 1}
                        </span>
                        {operation.description}
                      </span>
                      {operation.operationOrder === "With Previous" && (
                        <Badge variant="outline" className="shrink-0">
                          {t`With Previous`}
                        </Badge>
                      )}
                    </Row>
                  ))
                )}
              </Section>

              {correction.materials.length > 0 && (
                <Section title={t`Materials`}>
                  {correction.materials.map((material, index) => (
                    <Row key={`${material.itemId}:${index}`}>
                      <span className="text-sm min-w-0 flex-1 truncate">
                        {material.description}
                      </span>
                      <span className="text-sm text-muted-foreground tabular-nums shrink-0">
                        {t`${formatter.format(material.quantity)} ${material.unitOfMeasureCode} per unit`}
                      </span>
                    </Row>
                  ))}
                </Section>
              )}

              <Section title={t`Result mappings`}>
                {correction.triggers.length === 0 ? (
                  <EmptyRow>
                    <Trans>No step results suggest this correction.</Trans>
                  </EmptyRow>
                ) : (
                  correction.triggers.map((trigger) => (
                    <Row key={trigger.id}>
                      <span className="text-sm min-w-0 flex-1 truncate">
                        {trigger.operationDescription} · {trigger.stepName} ·{" "}
                        <span className="font-medium">
                          {trigger.listValue ??
                            (trigger.measurementCondition === "Below Minimum"
                              ? t`Below minimum`
                              : t`Above maximum`)}
                        </span>
                      </span>
                    </Row>
                  ))
                )}
              </Section>

              <Section title={t`Uses on this job`}>
                {correction.uses.length === 0 ? (
                  <EmptyRow>
                    <Trans>Not used yet.</Trans>
                  </EmptyRow>
                ) : (
                  correction.uses.map((use) => (
                    <Row key={use.id}>
                      <VStack spacing={0} className="min-w-0 flex-1">
                        <span className="text-sm font-medium w-full truncate">
                          {use.reason}
                        </span>
                        {use.units.length > 0 && (
                          <span className="text-xs text-muted-foreground w-full truncate">
                            {use.units.join(", ")}
                          </span>
                        )}
                      </VStack>
                      <span className="text-sm text-muted-foreground tabular-nums shrink-0">
                        {t`Qty ${formatter.format(use.quantity)}`}
                      </span>
                      <span className="text-sm text-muted-foreground whitespace-nowrap shrink-0">
                        {formatDate(use.createdAt, undefined, locale)}
                      </span>
                    </Row>
                  ))
                )}
              </Section>
            </VStack>
          ))}
        </VStack>
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <VStack spacing={2} className="w-full">
      <span className="text-xs text-muted-foreground">{title}</span>
      <div className="w-full divide-y border rounded-md">{children}</div>
    </VStack>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2">
      {children}
    </div>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-2 text-sm text-muted-foreground">{children}</div>
  );
}
