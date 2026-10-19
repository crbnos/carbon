// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { useDisclosure } from "@carbon/react";
import type { ActionFunctionArgs } from "react-router";
import { riskRegisterValidator } from "~/modules/quality/quality.models";
import RiskRegisterForm from "~/modules/quality/ui/RiskRegister/RiskRegisterForm";
import { getParams, path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(riskRegisterValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { id: _, severity, likelihood, ...risk } = input.data;
  const api = await carbon(args.request);
  const result = await api.quality.createRisk({
    ...risk,
    severity: Number.parseInt(severity ?? "1", 10),
    likelihood: Number.parseInt(likelihood ?? "1", 10)
  });
  if (result.error) {
    return respond(args.request, result).redirect(path.to.risks);
  }
  return respond(args.request, result).redirect(
    `${path.to.risks}?${getParams(args.request)}`,
    { message: "Risk created successfully" }
  );
}

export default function NewRiskRoute() {
  const formDisclosure = useDisclosure({
    defaultIsOpen: true
  });
  const onClose = () => {
    formDisclosure.onClose();
  };

  return (
    <RiskRegisterForm
      open={formDisclosure.isOpen}
      initialValues={{
        title: "",
        description: "",
        source: "General",
        status: "Open",
        severity: "1",
        likelihood: "1",
        type: "Risk",
        notes: ""
      }}
      onClose={onClose}
    />
  );
}
