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
  learnExamStartValidator
} from "~/modules/resources";
import {
  answerExamQuestion,
  finalizeExamAttempt,
  startExamAttempt
} from "~/modules/resources/learn/engine.server";
import { ERP_URL, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, { role: "employee" });

  const track = params.trackSlug ? getTrack(params.trackSlug) : undefined;
  if (!track || track.status !== "live") {
    throw new Response("Not found", { status: 404 });
  }

  // The loader never serves a question: starting is a deliberate POST behind
  // the honor statement, so a refresh can't quietly consume an attempt.
  return {
    trackSlug: track.slug,
    trackTitle: track.title,
    questionCount: track.exam.questionCount,
    timeLimitMinutes: track.exam.timeLimitMinutes
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
        trackSlug: track.slug
      });

      if (!started.ok) {
        return {
          gate:
            started.reason === "challenges"
              ? { reason: "challenges" as const, missing: started.missing }
              : { reason: "cooldown" as const, until: started.until }
        };
      }
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
            error(
              null,
              "The exam content changed mid-attempt, so this sitting was voided. No cooldown applies — start again when you are ready."
            )
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

export default function LearnExamRoute() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<any>();

  const certificateId = actionData?.result?.certificateId ?? null;

  return (
    <ExamRunner
      trackSlug={loaderData.trackSlug}
      trackTitle={loaderData.trackTitle}
      mode="exam"
      questionCount={loaderData.questionCount}
      timeLimitMinutes={loaderData.timeLimitMinutes}
      current={actionData?.current ?? null}
      result={actionData?.result ?? null}
      gate={actionData?.gate ?? null}
      verifyUrl={
        certificateId && actionData?.verificationCode
          ? `${ERP_URL}${path.to.learnCertificateVerify(actionData.verificationCode)}`
          : null
      }
    />
  );
}
