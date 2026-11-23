// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { originOf } from "~/modules/users/users.service";

const text = zfd.text(z.string().optional());

const acknowledgeForm = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("itar-entity"),
    authorityToBind: zfd.checkbox(),
    acceptRider: zfd.checkbox(),
    fullLegalName: text,
    title: text,
    complianceContact: text
  }),
  z.object({
    intent: z.literal("itar-user"),
    certifyUsPerson: zfd.checkbox(),
    agreeNotify: zfd.checkbox(),
    understandPenalty: zfd.checkbox(),
    fullLegalName: text
  }),
  // Generic flags: training dismissals, changelog entries seen.
  z.object({
    intent: z.literal("flag"),
    flag: z.string(),
    value: text.transform((value) => value === "true"),
    redirectTo: text
  })
]);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(acknowledgeForm).request(args);
  if ("invalid" in input) return input.invalid;
  const form = input.data;
  const { ip, userAgent } = originOf(args.request);
  const api = await carbon(args.request);

  switch (form.intent) {
    case "itar-entity":
      return api.users.certifyItarEntity({
        authorityToBind: form.authorityToBind,
        acceptRider: form.acceptRider,
        fullLegalName: form.fullLegalName ?? "",
        title: form.title ?? "",
        complianceContact: form.complianceContact ?? "",
        ipAddress: ip,
        userAgent
      });
    case "itar-user":
      return api.users.certifyItarUser({
        certifyUsPerson: form.certifyUsPerson,
        agreeNotify: form.agreeNotify,
        understandPenalty: form.understandPenalty,
        fullLegalName: form.fullLegalName ?? "",
        ipAddress: ip,
        userAgent
      });
    case "flag": {
      const result = await api.users.setOwnFlag({
        flag: form.flag,
        value: form.value
      });
      if (result.error || !form.redirectTo) return result;
      throw redirect(form.redirectTo);
    }
  }
}
