import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useActionData, useLoaderData } from "react-router";
import {
  ExamRunner,
  getTrack,
  learnExamAnswerValidator,
  learnExamStartValidator,
  RENEWAL_QUESTION_COUNT
} from "~/modules/resources";
import {
  answerExamQuestion,
  finalizeExamAttempt,
  startExamAttempt
} from "~/modules/resources/learn/engine.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, { role: "employee" });

  const track = params.trackSlug ? getTrack(params.trackSlug) : undefined;
  if (!track || track.status !== "live") {
    throw new Response("Not found", { status: 404 });
  }

  return {
    trackSlug: track.slug,
    trackTitle: track.title,
    questionCount: RENEWAL_QUESTION_COUNT
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {
    role: "employee"
  });

  const track = params.trackSlug ? getTrack(params.trackSlug) : undefined;
  if (!track) throw new Response("Not found", { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "start") {
      const validation = await validator(learnExamStartValidator).validate(
        formData
      );
      if (validation.error) return validationError(validation.error);

      const started = await startExamAttempt({
        companyId,
        userId,
        trackSlug: track.slug,
        kind: "Renewal Quiz"
      });
      if (!started.ok) return { gate: { reason: started.reason } };
      return { current: started };
    }

    if (intent === "answer") {
      const selectedValues = formData.getAll("selected").filter(Boolean);
      const validation = await validator(learnExamAnswerValidator).validate(
        formData
      );
      if (validation.error) return validationError(validation.error);

      const next = await answerExamQuestion({
        companyId,
        userId,
        attemptId: validation.data.attemptId,
        questionSlug: validation.data.questionSlug,
        selected:
          selectedValues.length > 1
            ? (selectedValues as string[])
            : ((selectedValues[0] as string) ?? "")
      });

      if ("voided" in next) {
        return data(
          { voided: true },
          await flash(
            request,
            error(null, "The content changed — start again.")
          )
        );
      }

      if ("done" in next && next.done) {
        const result = await finalizeExamAttempt({
          companyId,
          userId,
          attemptId: validation.data.attemptId
        });
        return { result };
      }

      return { current: { attemptId: validation.data.attemptId, ...next } };
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

export default function LearnRenewRoute() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<any>();

  return (
    <ExamRunner
      trackSlug={loaderData.trackSlug}
      trackTitle={loaderData.trackTitle}
      mode="renewal"
      questionCount={loaderData.questionCount}
      timeLimitMinutes={0}
      current={actionData?.current ?? null}
      result={actionData?.result ?? null}
      gate={actionData?.gate ?? null}
      verifyUrl={null}
    />
  );
}
