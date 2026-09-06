/**
 * The admin-facing projection.
 *
 * Managers see whether someone is on track and whether they are certified —
 * never their XP, their streak, or which questions they missed. Keeping that
 * boundary in a pure function means it can be unit-tested, and means the
 * dashboard route has no way to accidentally select a column it should not.
 */

import { round } from "@carbon/utils";
import type { LearnTeamStatus } from "./types";

export type ProjectionAssignment = {
  id: string;
  trackSlug: string;
  trackTitle: string;
  dueDate: string | null;
  memberIds: string[];
};

export type ProjectionMember = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

export type ProjectionProgress = {
  userId: string;
  trackSlug: string;
  completedUnits: number;
};

export type ProjectionCertificate = {
  id: string;
  userId: string;
  trackSlug: string;
  expiresAt: string;
  revokedAt: string | null;
};

export type TeamStatusRow = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  trackSlug: string;
  trackTitle: string;
  dueDate: string | null;
  status: LearnTeamStatus;
  percent: number;
  certificateId: string | null;
  expiresAt: string | null;
};

/**
 * `today` and `expiresAt` are compared as ISO strings, which sorts
 * chronologically — no JS Date arithmetic, no timezone drift.
 */
export function computeTeamStatus(input: {
  assignments: ProjectionAssignment[];
  members: Record<string, ProjectionMember>;
  progress: ProjectionProgress[];
  certificates: ProjectionCertificate[];
  unitCounts: Record<string, number>;
  today: string;
}): TeamStatusRow[] {
  const { assignments, members, progress, certificates, unitCounts, today } =
    input;

  const progressByKey = new Map<string, number>();
  for (const p of progress) {
    progressByKey.set(`${p.userId}:${p.trackSlug}`, p.completedUnits);
  }

  // Newest certificate wins when a track has been certified more than once.
  const certByKey = new Map<string, ProjectionCertificate>();
  for (const c of certificates) {
    const key = `${c.userId}:${c.trackSlug}`;
    const existing = certByKey.get(key);
    if (!existing || c.expiresAt > existing.expiresAt) {
      certByKey.set(key, c);
    }
  }

  const rows: TeamStatusRow[] = [];

  for (const assignment of assignments) {
    const total = unitCounts[assignment.trackSlug] ?? 0;

    for (const userId of assignment.memberIds) {
      const member = members[userId];
      if (!member) continue;

      const key = `${userId}:${assignment.trackSlug}`;
      const completed = progressByKey.get(key) ?? 0;
      const percent = total === 0 ? 0 : round((completed / total) * 100, 0);
      const certificate = certByKey.get(key);

      let status: LearnTeamStatus;
      if (certificate?.revokedAt) {
        status = "Revoked";
      } else if (certificate && certificate.expiresAt >= today) {
        status = "Certified";
      } else if (certificate) {
        status = "Expired";
      } else if (assignment.dueDate && assignment.dueDate < today) {
        status = "Overdue";
      } else if (completed > 0) {
        status = "In progress";
      } else {
        status = "Not started";
      }

      rows.push({
        userId,
        name: member.name,
        avatarUrl: member.avatarUrl,
        trackSlug: assignment.trackSlug,
        trackTitle: assignment.trackTitle,
        dueDate: assignment.dueDate,
        status,
        percent,
        certificateId: certificate?.id ?? null,
        expiresAt: certificate?.expiresAt ?? null
      });
    }
  }

  return rows.sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.trackSlug.localeCompare(b.trackSlug)
  );
}
