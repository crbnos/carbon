import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useActionData, useLoaderData } from "react-router";
import { useUser } from "~/hooks";
import {
  getChallenge,
  getLearnChallengeAttempts,
  getLearnUnitProgress,
  getTrack,
  getUnit,
  learnChallengeCheckValidator,
  learnChallengeStartValidator,
  learnQuizSubmissionValidator,
  UnitRunner
} from "~/modules/resources";
import {
  checkChallenge,
  gradeQuizAttempt,
  startChallenge,
  startQuizAttempt
} from "~/modules/resources/learn/engine.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {
    role: "employee"
  });

  const { trackSlug, unitSlug } = params;
  const track = trackSlug ? getTrack(trackSlug) : undefined;
  const unit = trackSlug && unitSlug ? getUnit(trackSlug, unitSlug) : undefined;
  if (!track || track.status !== "live" || !unit) {
    throw new Response("Not found", { status: 404 });
  }

  const [progress, challengeAttempts] = await Promise.all([
    getLearnUnitProgress(client, userId, companyId, track.slug),
    getLearnChallengeAttempts(client, userId, companyId, track.slug)
  ]);

  const completed = (progress.data ?? []).some(
    (p) => p.unitSlug === unit.slug && p.completedAt
  );

  const challenge =
    unit.assessment.kind === "challenge"
      ? (getChallenge(unit.assessment.challengeSlug) ?? null)
      : null;

  const attempt = challenge
    ? ((challengeAttempts.data ?? []).find(
        (a) => a.challengeSlug === challenge.slug
      ) ?? null)
    : null;

  return {
    trackSlug: track.slug,
    trackTitle: track.title,
    unit,
    completed,
    challenge,
    challengeState: challenge
      ? {
          attemptId: attempt?.id ?? null,
          passed: attempt?.passed ?? false,
          failedRequirement: attempt?.failedRequirement ?? null,
          message: attempt?.message ?? null,
          evidence:
            (attempt?.evidence as Record<string, unknown> | null) ?? null,
          checkCount: attempt?.checkCount ?? 0
        }
      : null
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {
    role: "employee"
  });

  const { trackSlug, unitSlug } = params;
  const track = trackSlug ? getTrack(trackSlug) : undefined;
  const unit = trackSlug && unitSlug ? getUnit(trackSlug, unitSlug) : undefined;
  if (!track || !unit) throw new Response("Not found", { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "start-quiz") {
      const started = await startQuizAttempt({
        companyId,
        userId,
        trackSlug: track.slug,
        unitSlug: unit.slug
      });
      return { questions: started.questions, attemptId: started.attemptId };
    }

    if (intent === "submit-quiz") {
      const validation = await validator(learnQuizSubmissionValidator).validate(
        formData
      );
      if (validation.error) return validationError(validation.error);

      const graded = await gradeQuizAttempt({
        companyId,
        userId,
        attemptId: validation.data.attemptId,
        responses: validation.data.responses
      });

      if (graded.voided) {
        return data(
          { voided: true },
          await flash(
            request,
            error(
              null,
              "The course content changed while you were answering. Start the quiz again."
            )
          )
        );
      }
      return { quizResult: graded };
    }

    if (intent === "start-challenge") {
      const validation = await validator(learnChallengeStartValidator).validate(
        formData
      );
      if (validation.error) return validationError(validation.error);

      const attempt = await startChallenge({
        companyId,
        userId,
        trackSlug: track.slug,
        challengeSlug: validation.data.challengeSlug
      });
      return { challengeAttemptId: attempt.id };
    }

    if (intent === "check-challenge") {
      const validation = await validator(learnChallengeCheckValidator).validate(
        formData
      );
      if (validation.error) return validationError(validation.error);

      const result = await checkChallenge({
        companyId,
        userId,
        attemptId: validation.data.attemptId
      });
      return { checkResult: result };
    }
  } catch (err) {
    if (err instanceof Response) throw err;
    return data(
      {},
      await flash(request, error(err, "Something went wrong. Try again."))
    );
  }

  return data({}, await flash(request, error(null, "Unknown action")));
}

type ActionData = {
  questions?: Awaited<ReturnType<typeof startQuizAttempt>>["questions"];
  attemptId?: string;
  quizResult?: Exclude<
    Awaited<ReturnType<typeof gradeQuizAttempt>>,
    { voided: true }
  >;
};

export default function LearnUnitRoute() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const { company } = useUser();

  return (
    <UnitRunner
      trackSlug={loaderData.trackSlug}
      trackTitle={loaderData.trackTitle}
      unit={loaderData.unit}
      questions={actionData?.questions ?? null}
      attemptId={actionData?.attemptId ?? null}
      quizResult={actionData?.quizResult ?? null}
      challenge={loaderData.challenge}
      challengeState={loaderData.challengeState}
      companyName={company.name}
      completed={loaderData.completed}
    />
  );
}
