import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  gateProgress,
  LIVE_FIELD_KEYS,
  parseIntakeRows
} from "@carbon/onboarding/engine";
import type { ImplementationRowData } from "@carbon/onboarding";
import { Badge } from "@carbon/react";
import { isInternalEmail } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { PageHeader } from "@carbon/onboarding/ui";
import { path } from "~/utils/path";

// The internal fleet view — every enrolled factory's phase, band, flags,
// streak, and Guided-CTA clicks in one place. This is where quiet factories
// and post-activation reliance dips surface for proactive human outreach.
// Carbon staff only; served with the service role across companies.

export async function loader({ request }: LoaderFunctionArgs) {
  const { email } = await requirePermissions(request, {});
  if (!isInternalEmail(email)) {
    throw redirect(path.to.getStarted);
  }

  const serviceRole = getCarbonServiceRole();

  const [hubs, gateStates, fieldValues, intakeRows] = await Promise.all([
    serviceRole
      .from("implementationHub")
      .select("id, tier, status, createdAt"),
    serviceRole
      .from("implementationCheckState")
      .select("companyId, itemKey, value")
      .eq("kind", "gate"),
    // Small tables (per-company key/value config) — fetch and filter in JS
    // rather than fight PostgREST or-syntax with dotted keys.
    serviceRole
      .from("implementationFieldValue")
      .select("companyId, fieldKey, value"),
    serviceRole
      .from("implementationRow")
      .select("id, companyId, collection, payload, sortOrder")
      .eq("collection", "intake")
  ]);

  const companyIds = (hubs.data ?? []).map((hub) => hub.id);
  const companies = companyIds.length
    ? await serviceRole.from("company").select("id, name").in("id", companyIds)
    : { data: [] as { id: string; name: string }[] };
  const nameById = new Map(
    (companies.data ?? []).map((company) => [company.id, company.name])
  );

  const statesByCompany = new Map<string, { itemKey: string; value: string }[]>();
  for (const state of gateStates.data ?? []) {
    const list = statesByCompany.get(state.companyId) ?? [];
    list.push(state);
    statesByCompany.set(state.companyId, list);
  }
  const fieldsByCompany = new Map<string, Map<string, string>>();
  for (const field of fieldValues.data ?? []) {
    const map = fieldsByCompany.get(field.companyId) ?? new Map();
    map.set(field.fieldKey, field.value);
    fieldsByCompany.set(field.companyId, map);
  }
  const intakeByCompany = new Map<string, ImplementationRowData[]>();
  for (const row of intakeRows.data ?? []) {
    const list = intakeByCompany.get(row.companyId) ?? [];
    list.push(row as unknown as ImplementationRowData);
    intakeByCompany.set(row.companyId, list);
  }

  const fleet = (hubs.data ?? [])
    .map((hub) => {
      const progress = gateProgress(statesByCompany.get(hub.id) ?? []);
      const fields = fieldsByCompany.get(hub.id) ?? new Map<string, string>();
      const intake = parseIntakeRows(intakeByCompany.get(hub.id) ?? []);
      const lockClicks = Array.from(fields.keys()).filter((key) =>
        key.startsWith("lock.")
      );
      return {
        companyId: hub.id,
        name: nameById.get(hub.id) ?? hub.id,
        tier: hub.tier as string,
        status: hub.status as string,
        done: progress.done,
        total: progress.total,
        next: progress.next?.title ?? null,
        band: intake.current?.payload.band ?? null,
        flags: intake.current?.payload.flags ?? [],
        goLiveDate: fields.get("plan.gate:switch.gateDate") ?? null,
        liveAt: fields.get(LIVE_FIELD_KEYS.liveAt) ?? null,
        activatedAt: fields.get(LIVE_FIELD_KEYS.activatedAt) ?? null,
        streak: fields.get(LIVE_FIELD_KEYS.streak) ?? null,
        daysOnCarbon: fields.get(LIVE_FIELD_KEYS.daysOnCarbon) ?? null,
        lockClicks
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { fleet };
}

export default function GetStartedFleetRoute() {
  const { fleet } = useLoaderData<typeof loader>();

  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col gap-6">
      <PageHeader
        title="Implementation Fleet"
        lead="Every enrolled factory's phase, band, flags, and streak — the same truth the customer sees, across the whole fleet. Quiet factories and reliance dips show up here first."
      />
      <div className="rounded-xl border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground border-b">
              <th className="px-4 py-2">Factory</th>
              <th className="px-4 py-2">Tier</th>
              <th className="px-4 py-2">Phase</th>
              <th className="px-4 py-2">Next</th>
              <th className="px-4 py-2">Band</th>
              <th className="px-4 py-2">Flags</th>
              <th className="px-4 py-2">Go-live</th>
              <th className="px-4 py-2">Streak</th>
              <th className="px-4 py-2">Guided clicks</th>
            </tr>
          </thead>
          <tbody>
            {fleet.map((row) => (
              <tr key={row.companyId} className="border-b last:border-0">
                <td className="px-4 py-2 font-medium">{row.name}</td>
                <td className="px-4 py-2">
                  <Badge variant="secondary">{row.tier}</Badge>
                </td>
                <td className="px-4 py-2 tabular-nums">
                  {row.activatedAt
                    ? "Activated"
                    : `${row.done} / ${row.total}`}
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {row.activatedAt ? "—" : (row.next ?? "—")}
                </td>
                <td className="px-4 py-2">{row.band ?? "—"}</td>
                <td className="px-4 py-2">
                  {row.flags.length > 0 ? (
                    <Badge variant="destructive">{row.flags.length}</Badge>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-2 tabular-nums">
                  {row.goLiveDate ?? "—"}
                </td>
                <td className="px-4 py-2 tabular-nums">
                  {row.liveAt
                    ? `${row.streak ?? 0} 🔥 · ${row.daysOnCarbon ?? 0} total`
                    : "—"}
                </td>
                <td className="px-4 py-2">
                  {row.lockClicks.length > 0 ? (
                    <span title={row.lockClicks.join(", ")}>
                      {row.lockClicks.length}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {fleet.length === 0 ? (
              <tr>
                <td
                  className="px-4 py-6 text-center text-muted-foreground"
                  colSpan={9}
                >
                  No enrolled factories yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
