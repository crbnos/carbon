import { requirePermissions } from "@carbon/auth/auth.server";
import { getCompanyTimeZone } from "@carbon/database";
import { datetime } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useUser } from "~/hooks";
import type { TrackCardState } from "~/modules/resources";
import {
  DEFAULT_WEEKLY_GOAL_XP,
  getLearnActivity,
  getLearnAssignmentsForUser,
  getLearnBadges,
  getLearnCertificates,
  getLearnPreference,
  getLearnUnitProgress,
  getLearnXpTotal,
  HEATMAP_WEEKS,
  LearnHub,
  learnTracks,
  trackUnitCount,
  weeklyStreak
} from "~/modules/resources";
import { getDatabaseClient } from "~/services/database.server";

export async function loader({ request }: LoaderFunctionArgs) {
  // Auth only: a learner is an employee, not necessarily a resources admin.
  const { client, userId, companyId } = await requirePermissions(request, {
    role: "employee"
  });

  let timeZone = "UTC";
  try {
    timeZone = await getCompanyTimeZone(getDatabaseClient(), companyId);
  } catch {
    timeZone = "UTC";
  }

  const today = datetime.today(timeZone);
  const since = today.subtract({ weeks: HEATMAP_WEEKS }).toString();

  const [
    progress,
    xpTotal,
    activity,
    badges,
    certificates,
    preference,
    assignments
  ] = await Promise.all([
    getLearnUnitProgress(client, userId, companyId),
    getLearnXpTotal(client, userId, companyId),
    getLearnActivity(client, userId, companyId, since),
    getLearnBadges(client, userId, companyId),
    getLearnCertificates(client, userId, companyId),
    getLearnPreference(client, userId, companyId),
    getLearnAssignmentsForUser(client, userId, companyId)
  ]);

  const days = (activity.data ?? []).map((row) => ({
    day: row.day,
    xp: row.xp
  }));

  // Roll the day rows up into ISO weeks (Monday-keyed) for the streak.
  const weekXpByMonday: Record<string, number> = {};
  for (const row of days) {
    const d = new Date(`${row.day}T00:00:00.000Z`);
    const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
    d.setUTCDate(d.getUTCDate() - dow);
    const monday = d.toISOString().slice(0, 10);
    weekXpByMonday[monday] = (weekXpByMonday[monday] ?? 0) + row.xp;
  }

  const todayString = today.toString();
  const todayDate = new Date(`${todayString}T00:00:00.000Z`);
  const todayDow = (todayDate.getUTCDay() + 6) % 7;
  todayDate.setUTCDate(todayDate.getUTCDate() - todayDow);
  const currentWeekMonday = todayDate.toISOString().slice(0, 10);

  const goalXp = preference.data?.weeklyGoalXp ?? DEFAULT_WEEKLY_GOAL_XP;

  const completedByTrack = new Map<string, number>();
  for (const row of progress.data ?? []) {
    if (!row.completedAt) continue;
    completedByTrack.set(
      row.trackSlug,
      (completedByTrack.get(row.trackSlug) ?? 0) + 1
    );
  }

  const dueByTrack = new Map<string, string | null>();
  for (const assignment of assignments.data ?? []) {
    dueByTrack.set(assignment.trackSlug, assignment.dueDate);
  }

  const trackState: Record<string, TrackCardState> = {};
  for (const track of learnTracks) {
    const total = trackUnitCount(track);
    const completed = completedByTrack.get(track.slug) ?? 0;
    const certificate = (certificates.data ?? []).find(
      (c) => c.trackSlug === track.slug
    );
    trackState[track.slug] = {
      percent: total === 0 ? 0 : Math.floor((completed / total) * 100),
      certified: Boolean(
        certificate &&
          !certificate.revokedAt &&
          certificate.expiresAt.slice(0, 10) >= todayString
      ),
      expiresAt: certificate?.expiresAt ?? null,
      revoked: Boolean(certificate?.revokedAt),
      dueDate: dueByTrack.get(track.slug) ?? null
    };
  }

  const badgeTitles: Record<string, string> = {};
  for (const track of learnTracks) {
    for (const module of track.modules) {
      badgeTitles[module.badgeSlug] = module.badgeTitle;
    }
  }

  return {
    tracks: learnTracks,
    trackState,
    totalXp: xpTotal.data ?? 0,
    weekXp: weekXpByMonday[currentWeekMonday] ?? 0,
    goalXp,
    streak: weeklyStreak(weekXpByMonday, goalXp, currentWeekMonday),
    badges: (badges.data ?? []).map((b) => ({
      badgeSlug: b.badgeSlug,
      awardedAt: b.awardedAt
    })),
    badgeTitles,
    certificates: (certificates.data ?? []).map((c) => ({
      id: c.id,
      trackTitle: c.trackTitle,
      issuedAt: c.issuedAt,
      expiresAt: c.expiresAt,
      revokedAt: c.revokedAt
    })),
    activity: days,
    today: todayString
  };
}

export default function LearnIndexRoute() {
  const data = useLoaderData<typeof loader>();
  const { company } = useUser();

  return <LearnHub {...data} companyName={company.name} />;
}
