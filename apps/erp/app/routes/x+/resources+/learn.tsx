import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { VStack } from "@carbon/react";
import { datetime } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import type { LearnTeamRow } from "~/modules/resources";
import {
  computeTeamStatus,
  getLearnAssignments,
  LearnTeamTable,
  learnTracks,
  RevokeCertificateModal,
  trackUnitCount
} from "~/modules/resources";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Learn`,
  to: path.to.learnAdmin,
  module: "resources"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });

  const assignments = await getLearnAssignments(client, companyId);
  const rows = assignments.data ?? [];

  // The dashboard is a PROJECTION: status per employee x track, and the
  // certificate. Never XP, streaks, or which questions anyone missed — those
  // stay in the learner's own session.
  const serviceRole = await getCarbonServiceRole();

  const memberIdsForAssignment = async (assignmentGroupIds: string[]) => {
    if (assignmentGroupIds.length === 0) return [];
    const result = await serviceRole.rpc("users_for_groups", {
      groups: assignmentGroupIds
    });
    return ((result.data ?? []) as string[]).filter(Boolean);
  };

  const assignmentsWithMembers = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      trackSlug: row.trackSlug,
      trackTitle: row.trackTitle,
      dueDate: row.dueDate,
      memberIds: await memberIdsForAssignment(row.groupIds ?? [])
    }))
  );

  const allMemberIds = Array.from(
    new Set(assignmentsWithMembers.flatMap((a) => a.memberIds))
  );

  const [people, progress, certificates] =
    allMemberIds.length > 0
      ? await Promise.all([
          serviceRole
            .from("user")
            .select("id, fullName, avatarUrl")
            .in("id", allMemberIds),
          serviceRole
            .from("learnUnitProgress")
            .select("userId, trackSlug, completedAt")
            .eq("companyId", companyId)
            .in("userId", allMemberIds),
          serviceRole
            .from("learnCertificate")
            .select("id, userId, trackSlug, expiresAt, revokedAt")
            .eq("companyId", companyId)
            .in("userId", allMemberIds)
        ])
      : [
          { data: [] as any[], error: null },
          { data: [] as any[], error: null },
          { data: [] as any[], error: null }
        ];

  const members: Record<
    string,
    { id: string; name: string; avatarUrl: string | null }
  > = {};
  for (const person of people.data ?? []) {
    members[person.id] = {
      id: person.id,
      name: person.fullName ?? "—",
      avatarUrl: person.avatarUrl
    };
  }

  const completedByUserTrack = new Map<string, number>();
  for (const row of progress.data ?? []) {
    if (!row.completedAt) continue;
    const key = `${row.userId}:${row.trackSlug}`;
    completedByUserTrack.set(key, (completedByUserTrack.get(key) ?? 0) + 1);
  }

  const unitCounts: Record<string, number> = {};
  for (const track of learnTracks) {
    unitCounts[track.slug] = trackUnitCount(track);
  }

  const teamStatus = computeTeamStatus({
    assignments: assignmentsWithMembers,
    members,
    progress: Array.from(completedByUserTrack.entries()).map(([key, count]) => {
      const [userId, trackSlug] = key.split(":");
      return { userId, trackSlug, completedUnits: count };
    }),
    certificates: (certificates.data ?? []).map((c) => ({
      id: c.id,
      userId: c.userId,
      trackSlug: c.trackSlug,
      expiresAt: c.expiresAt,
      revokedAt: c.revokedAt
    })),
    unitCounts,
    today: datetime.timestamp().slice(0, 10)
  });

  return { rows: teamStatus, count: teamStatus.length };
}

export default function LearnAdminRoute() {
  const { rows, count } = useLoaderData<typeof loader>();
  const [revoking, setRevoking] = useState<LearnTeamRow | null>(null);

  return (
    <VStack spacing={0} className="h-full">
      <LearnTeamTable data={rows} count={count} onRevoke={setRevoking} />
      {revoking?.certificateId && (
        <RevokeCertificateModal
          certificateId={revoking.certificateId}
          learnerName={revoking.name}
          trackTitle={revoking.trackTitle}
          onClose={() => setRevoking(null)}
        />
      )}
      <Outlet />
    </VStack>
  );
}
