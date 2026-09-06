import { HStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { LuBookOpen, LuExternalLink } from "react-icons/lu";
import { MetricCard, Table } from "~/components";
import { usePercentFormatter } from "~/hooks";

export type LearnQuestionStatRow = {
  questionSlug: string;
  trackTitle: string;
  unitSlug: string;
  topic: string;
  prompt: string;
  docsUrl: string;
  attempts: number;
  correctRate: number;
};

/**
 * A question people keep getting wrong is usually a documentation problem, not
 * a learner problem — so this reads as a docs report: worst first, with the
 * page to go and fix one click away.
 */
const LearnQuestionStatsTable = ({
  data,
  count,
  weakCount
}: {
  data: LearnQuestionStatRow[];
  count: number;
  weakCount: number;
}) => {
  const { t } = useLingui();
  const percentFormatter = usePercentFormatter();

  const columns = useMemo<ColumnDef<LearnQuestionStatRow>[]>(
    () => [
      {
        accessorKey: "prompt",
        header: "Question",
        cell: (item) => (
          <span className="max-w-lg truncate block">
            {item.getValue<string>()}
          </span>
        )
      },
      {
        accessorKey: "trackTitle",
        header: "Track",
        cell: (item) => item.getValue<string>()
      },
      {
        accessorKey: "topic",
        header: "Topic",
        cell: (item) => (
          <span className="capitalize">{item.getValue<string>()}</span>
        )
      },
      {
        accessorKey: "correctRate",
        header: "Correct",
        cell: (item) => (
          <span className="font-mono tabular-nums">
            {percentFormatter.format(item.getValue<number>())}
          </span>
        )
      },
      {
        accessorKey: "attempts",
        header: "Attempts",
        cell: (item) => (
          <span className="font-mono tabular-nums">
            {item.getValue<number>()}
          </span>
        )
      },
      {
        accessorKey: "docsUrl",
        header: "Documentation",
        cell: (item) => (
          <a
            className="inline-flex items-center gap-1 text-primary hover:underline"
            href={item.getValue<string>()}
            target="_blank"
            rel="noopener noreferrer"
          >
            {new URL(item.getValue<string>()).pathname}
            <LuExternalLink />
          </a>
        )
      }
    ],
    [percentFormatter]
  );

  return (
    <>
      <HStack className="w-full px-4 pt-4">
        <MetricCard
          className="w-full max-w-sm"
          icon={<LuBookOpen />}
          title={t`Docs to revisit`}
          value={weakCount}
          description={t`Questions answered correctly less than 60% of the time`}
        />
      </HStack>
      <Table<LearnQuestionStatRow>
        data={data}
        columns={columns}
        count={count}
        title={t`Question performance`}
        table="learnQuestions"
        withSearch
      />
    </>
  );
};

export default LearnQuestionStatsTable;
