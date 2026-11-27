// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The ability gate: what an operator lacks to work on an operation whose
// process requires an ability, and the refusal when its policy is Block.

import type { Database } from "@carbon/database";
import { getCompanyTimeZone } from "@carbon/database";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";

type Client = SupabaseClient<Database>;

export type ProcessAbilityPolicy =
  Database["public"]["Enums"]["processAbilityPolicy"];

// What an operator lacks to work on an operation whose process requires an
// ability. getAbilityShortfall returns null when nothing is missing.
export type AbilityShortfall = {
  policy: ProcessAbilityPolicy;
  processName: string;
  // the qualification's expiry date; null when the operator never held it
  expiredOn: string | null;
  // an Active training that grants the ability, when one exists
  trainingName: string | null;
};

export async function getAbilityShortfall(
  client: Client,
  args: { operationId: string; employeeId: string; companyId: string }
): Promise<AbilityShortfall | null> {
  const { operationId, employeeId, companyId } = args;

  // NOTE: query failures here FAIL OPEN (no shortfall). An RLS/database
  // error must not brick the shop floor — the scheduler is the primary
  // enforcement of ability requirements; this gate is a best-effort backstop.
  // The requirement comes from the operation's PROCESS: process.requiresAbility
  // gates, and the ability linked 1:1 to the process (ability.processId) is
  // what the employee must be qualified for.
  const operation = await client
    .from("jobOperation")
    .select(
      "process!jobOperation_processId_fkey(name, requiresAbility, abilityPolicy, ability!ability_processId_fkey(id, active))"
    )
    .eq("id", operationId)
    .eq("companyId", companyId)
    .maybeSingle();

  const process = operation.data?.process;
  if (operation.error || !process?.requiresAbility) return null;

  // requiresAbility is on but no active linked ability exists — data anomaly,
  // don't block the floor
  const ability = process.ability.find((a) => a.active);
  if (!ability) return null;

  const [employeeAbility, training] = await Promise.all([
    client
      .from("employeeAbility")
      .select("expiresAt")
      .eq("employeeId", employeeId)
      .eq("abilityId", ability.id)
      .eq("companyId", companyId)
      .maybeSingle(),
    // Read alongside, so a refusal can name what to complete; a failed read
    // only drops the name.
    client
      .from("training")
      .select("name")
      .eq("grantsAbilityId", ability.id)
      .eq("companyId", companyId)
      .eq("status", "Active")
      .limit(1)
      .maybeSingle()
  ]);
  if (employeeAbility.error) return null;

  // Qualification is presence-based: the row existing means qualified,
  // subject only to expiry.
  const expiresAt = employeeAbility.data?.expiresAt ?? null;
  if (employeeAbility.data) {
    if (expiresAt === null) return null;
    const today = datetime
      .today(await getCompanyTimeZone(client, companyId))
      .toString();
    if (expiresAt > today) return null;
  }

  return {
    policy: process.abilityPolicy,
    // The ability's name IS the process's name (abilities no longer store one).
    processName: process.name,
    expiredOn: expiresAt,
    trainingName: training.data?.name ?? null
  };
}

// English text for the server flash when work is refused. MES routes have no
// server-side translation; the page banner carries the translated text.
function abilityRefusalMessage(shortfall: AbilityShortfall): string {
  const how = shortfall.trainingName
    ? `Complete the ${shortfall.trainingName} training to get it.`
    : "Ask a supervisor to add it to your profile.";
  const expired = shortfall.expiredOn
    ? ` Your qualification expired on ${shortfall.expiredOn}.`
    : "";
  return `You need the ${shortfall.processName} ability to work on this operation.${expired} ${how}`;
}

// The refusal text when the operator may not do production work on this
// operation (the process's policy is 'Block'); null when the work may go ahead.
export async function abilityBlockRefusal(
  client: Client,
  args: { operationId: string; employeeId: string; companyId: string }
): Promise<string | null> {
  const shortfall = await getAbilityShortfall(client, args);
  return shortfall?.policy === "Block"
    ? abilityRefusalMessage(shortfall)
    : null;
}
