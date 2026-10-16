// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import { getClientIp, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { carbon } from "~/modules/carbon.server";
import {
  itarEntityCertificationValidator,
  itarUserCertificationValidator,
  userFlagValidator
} from "~/modules/users";

const acknowledgeForm = z.looseObject({
  intent: z.string(),
  redirectTo: z.string().optional()
});

// The ITAR screens and the panels read `{ success, message }`.
export async function action(args: ActionFunctionArgs) {
  const input = await validator(acknowledgeForm).request(args);
  if ("invalid" in input) return { success: false, message: "Invalid request" };
  const { intent, redirectTo, ...form } = input.data;
  const api = await carbon(args.request);
  // Best-effort request metadata for the compliance record.
  const meta = {
    ipAddress: getClientIp(args.request),
    userAgent: args.request.headers.get("user-agent") ?? null
  };

  if (intent === "itar-entity") {
    const parsed = itarEntityCertificationValidator.safeParse({
      authorityToBind: form.authorityToBind === "on",
      acceptRider: form.acceptRider === "on",
      fullLegalName: form.fullLegalName,
      title: form.title,
      complianceContact: form.complianceContact
    });
    if (!parsed.success) {
      return { success: false, message: parsed.error.issues[0].message };
    }
    const result = await api.shared.itar.certifyEntity({
      ...parsed.data,
      ...meta
    });
    if (result.error) return { success: false, message: result.error.message };
    return { success: true, message: "Rider accepted" };
  }

  if (intent === "itar-user") {
    const parsed = itarUserCertificationValidator.safeParse({
      certifyUsPerson: form.certifyUsPerson === "on",
      agreeNotify: form.agreeNotify === "on",
      understandPenalty: form.understandPenalty === "on",
      fullLegalName: form.fullLegalName
    });
    if (!parsed.success) {
      return { success: false, message: parsed.error.issues[0].message };
    }
    const result = await api.shared.itar.certifyUser({
      ...parsed.data,
      ...meta
    });
    if (result.error) return { success: false, message: result.error.message };
    return { success: true, message: "Certification recorded" };
  }

  // Generic flags: training dismissals, the changelog panel, any future flag.
  if (intent === "flag") {
    const parsed = userFlagValidator.safeParse({
      flag: form.flag,
      value: form.value === "true"
    });
    if (!parsed.success) {
      return { success: false, message: parsed.error.issues[0].message };
    }
    const result = await api.shared.userFlag.set(parsed.data);
    if (result.error) return { success: false, message: result.error.message };
    if (redirectTo) throw redirect(redirectTo);
    return { success: true, message: "Flag updated" };
  }

  return null;
}
