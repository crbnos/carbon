import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import type { LearnQuestionStatRow } from "~/modules/resources";
import {
  getLearnQuestionStats,
  getTrack,
  LEARN_QUESTION_WEAK_THRESHOLD,
  LearnQuestionStatsTable
} from "~/modules/resources";
import { questionMeta } from "~/modules/resources/learn/banks/index.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Questions`,
  to: path.to.learnQuestions,
  module: "resources"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });

  // `learnAttemptAnswer` has RLS on with NO policies — service role is the only
  // way to read it, and the aggregation below is what makes that safe to show.
  const serviceRole = await getCarbonServiceRole();
  const stats = await getLearnQuestionStats(serviceRole, companyId);

  // The five-attempt floor is applied by `getLearnQuestionStats` itself, so the
  // MCP tool and this page cannot disagree about it.
  const rows: LearnQuestionStatRow[] = [];
  for (const stat of stats.data ?? []) {
    const meta = questionMeta(stat.questionSlug);
    // A slug with no meta is a question retired since it was answered. It is
    // history, not a docs signal — there is no page left to send anyone to.
    if (!meta) continue;

    rows.push({
      questionSlug: stat.questionSlug,
      trackTitle: getTrack(meta.trackSlug)?.title ?? meta.trackSlug,
      unitSlug: meta.unitSlug,
      topic: meta.topic,
      prompt: meta.prompt,
      docsUrl: meta.docsUrl,
      attempts: stat.attempts,
      correctRate: stat.correctRate
    });
  }

  rows.sort((a, b) => a.correctRate - b.correctRate);

  return {
    rows,
    count: rows.length,
    weakCount: rows.filter(
      (row) => row.correctRate < LEARN_QUESTION_WEAK_THRESHOLD
    ).length
  };
}

export default function LearnQuestionsRoute() {
  const { rows, count, weakCount } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <LearnQuestionStatsTable
        data={rows}
        count={count}
        weakCount={weakCount}
      />
    </VStack>
  );
}
