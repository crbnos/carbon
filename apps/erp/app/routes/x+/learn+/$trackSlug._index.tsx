import { requirePermissions } from "@carbon/auth/auth.server";
import { datetime } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import type { ExamGate } from "~/modules/resources";
import {
  examCooldownEnd,
  getLearnBadges,
  getLearnCertificates,
  getLearnChallengeAttempts,
  getLearnExamAttempts,
  getLearnUnitProgress,
  getTrack,
  isWithinRenewalWindow,
  TrackDetail
} from "~/modules/resources";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {
    role: "employee"
  });

  const { trackSlug } = params;
  const track = trackSlug ? getTrack(trackSlug) : undefined;
  if (!track || track.status !== "live") {
    throw new Response("Not found", { status: 404 });
  }

  const [progress, challenges, exams, certificates, badges] = await Promise.all(
    [
      getLearnUnitProgress(client, userId, companyId, track.slug),
      getLearnChallengeAttempts(client, userId, companyId, track.slug),
      getLearnExamAttempts(client, userId, companyId, track.slug),
      getLearnCertificates(client, userId, companyId),
      getLearnBadges(client, userId, companyId)
    ]
  );

  const now = datetime.timestamp();
  const today = now.slice(0, 10);

  const certificate = (certificates.data ?? []).find(
    (c) => c.trackSlug === track.slug && !c.revokedAt
  );

  const passedChallenges = new Set(
    (challenges.data ?? []).filter((c) => c.passed).map((c) => c.challengeSlug)
  );
  const missing = track.requiredChallengeSlugs.filter(
    (slug) => !passedChallenges.has(slug)
  );

  const failedAt = (exams.data ?? [])
    .filter((e) => e.passed === false && e.submittedAt)
    .map((e) => e.submittedAt as string);
  const cooldownUntil = examCooldownEnd(failedAt);

  let examGate: ExamGate;
  if (certificate && certificate.expiresAt.slice(0, 10) >= today) {
    examGate = {
      state: "certified",
      certificateId: certificate.id,
      expiresAt: certificate.expiresAt
    };
  } else if (missing.length > 0) {
    examGate = { state: "locked", missing };
  } else if (cooldownUntil && cooldownUntil > now) {
    examGate = { state: "cooldown", until: cooldownUntil };
  } else {
    examGate = { state: "ready" };
  }

  return {
    track,
    completedUnits: (progress.data ?? [])
      .filter((p) => p.completedAt)
      .map((p) => p.unitSlug),
    earnedBadges: (badges.data ?? []).map((b) => b.badgeSlug),
    examGate,
    canRenew: Boolean(
      certificate && isWithinRenewalWindow(certificate.expiresAt, now)
    )
  };
}

export default function LearnTrackRoute() {
  const data = useLoaderData<typeof loader>();
  return <TrackDetail {...data} />;
}
