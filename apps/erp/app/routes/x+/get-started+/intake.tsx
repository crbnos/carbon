import { assertIsPost, error, useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import {
  currentAnswers,
  type IntakeAnswers,
  intakeActionValidator,
  intakeAnswersValidator,
  SUPPORT_BOOKING_URL,
  suggestedWeeks
} from "@carbon/onboarding";
import {
  completeIntake,
  insertIntakeTranscript,
  saveIntakeDraft
} from "@carbon/onboarding/server";
import { IntakeWizard, PayoffScreen, useIntakeState } from "@carbon/onboarding/ui";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ActionFunctionArgs } from "react-router";
import { data, useFetcher, useNavigate, useSearchParams } from "react-router";
import { useUser } from "~/hooks";
import { path } from "~/utils/path";

// "Tell Us How You Run" — the intake wizard (Phase 1). Draft saves and
// completion post here; transcription and the AI clarifier live on their own
// api resource routes so the wizard can await their results.

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {});

  const validation = await validator(intakeActionValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return validationError(validation.error);
  }
  const payload = validation.data;

  const parseAnswers = (raw: string): IntakeAnswers | null => {
    try {
      const parsed = intakeAnswersValidator.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  };

  switch (payload.intent) {
    case "saveDraft": {
      const answers = parseAnswers(payload.answers);
      if (!answers) {
        return data(
          { success: false },
          await flash(request, error(null, "Invalid answers"))
        );
      }
      const result = await saveIntakeDraft(client, {
        companyId,
        userId,
        answers
      });
      if (result.error) {
        return data(
          { success: false },
          await flash(request, error(result.error, "Failed to save draft"))
        );
      }
      return data({ success: true });
    }
    case "complete": {
      const answers = parseAnswers(payload.answers);
      if (!answers) {
        return data(
          { success: false },
          await flash(request, error(null, "Invalid answers"))
        );
      }
      const result = await completeIntake(client, {
        companyId,
        userId,
        answers
      });
      if (result.error) {
        return data(
          { success: false },
          await flash(
            request,
            error(result.error, "Failed to complete the intake")
          )
        );
      }
      return data({ success: true, completed: true });
    }
    case "addTranscript": {
      // Transcripts normally persist through the transcribe/clarify api routes;
      // this intent exists for completeness (e.g. typed clarifier exchanges).
      const result = await insertIntakeTranscript(client, {
        companyId,
        userId,
        questionKey: payload.questionKey,
        source: payload.source,
        transcript: payload.transcript
      });
      if (result.error) {
        return data(
          { success: false },
          await flash(request, error(result.error, "Failed to save transcript"))
        );
      }
      return data({ success: true });
    }
  }
}

export default function GetStartedIntakeRoute() {
  const { company } = useUser();
  const { carbon } = useCarbon();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const intake = useIntakeState();

  const draftFetcher = useFetcher<{ success?: boolean }>();
  const completeFetcher = useFetcher<{
    success?: boolean;
    completed?: boolean;
  }>();

  // After a successful completion, land on the payoff — "Your plan is ready."
  const completedRef = useRef(false);
  useEffect(() => {
    if (
      completeFetcher.state === "idle" &&
      completeFetcher.data?.completed &&
      !completedRef.current
    ) {
      completedRef.current = true;
      navigate(`${path.to.getStartedIntake}?step=payoff`, { replace: true });
    }
  }, [completeFetcher.state, completeFetcher.data, navigate]);

  const initialAnswers = useMemo(
    () => intake.draft?.payload.answers ?? currentAnswers(intake),
    [intake]
  );

  // Suggested go-live: the tailored number of weeks out, landing on a Monday.
  const suggestedGoLiveDate = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() + suggestedWeeks(initialAnswers) * 7);
    while (date.getDay() !== 1) date.setDate(date.getDate() + 1);
    return date.toISOString().slice(0, 10);
  }, [initialAnswers]);

  const onTranscribe = useCallback(
    async (audioBase64: string, mimeType: string, questionKey: string) => {
      try {
        const body = new FormData();
        body.set("audio", audioBase64);
        body.set("mimeType", mimeType);
        body.set("questionKey", questionKey);
        const response = await fetch(path.to.api.intakeTranscribe, {
          method: "POST",
          body
        });
        if (!response.ok) return null;
        const result = (await response.json()) as { text?: string };
        return result.text ?? null;
      } catch {
        return null;
      }
    },
    []
  );

  const onClarify = useCallback(
    async (questionKey: string, message: string) => {
      try {
        const body = new FormData();
        body.set("questionKey", questionKey);
        body.set("message", message);
        const response = await fetch(path.to.api.intakeClarify, {
          method: "POST",
          body
        });
        if (!response.ok) return null;
        return (await response.json()) as {
          reply: string;
          answerValue?: string;
        };
      } catch {
        return null;
      }
    },
    []
  );

  const onUpload = useCallback(
    async (file: File) => {
      if (!carbon) return null;
      const extension = file.name.split(".").pop() ?? "csv";
      const storagePath = `${company.id}/intake/${nanoid()}.${extension}`;
      const { data: uploaded, error: uploadError } = await carbon.storage
        .from("private")
        .upload(storagePath, file);
      if (uploadError || !uploaded) return null;
      return { path: uploaded.path, name: file.name };
    },
    [carbon, company.id]
  );

  if (searchParams.get("step") === "payoff") {
    return (
      <PayoffScreen
        companyName={company.name}
        onFirstWin={() => navigate(path.to.getStartedFirstWin)}
        onOpenPlan={() => navigate(path.to.getStartedPage("plan"))}
        onBookCall={() =>
          window.open(SUPPORT_BOOKING_URL, "_blank", "noopener,noreferrer")
        }
      />
    );
  }

  return (
    <IntakeWizard
      companyName={company.name}
      initialAnswers={initialAnswers}
      previousAnswers={intake.current?.payload.answers ?? null}
      suggestedGoLiveDate={suggestedGoLiveDate}
      saving={completeFetcher.state !== "idle"}
      onSaveDraft={(answers) =>
        draftFetcher.submit(
          { intent: "saveDraft", answers: JSON.stringify(answers) },
          { method: "post" }
        )
      }
      onComplete={(answers) =>
        completeFetcher.submit(
          { intent: "complete", answers: JSON.stringify(answers) },
          { method: "post" }
        )
      }
      onExit={() => navigate(path.to.getStarted)}
      onTranscribe={onTranscribe}
      onClarify={onClarify}
      onUpload={onUpload}
    />
  );
}
