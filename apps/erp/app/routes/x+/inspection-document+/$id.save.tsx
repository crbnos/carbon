// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { saveInspectionDocument } from "~/modules/quality/quality.server";

const { shape } = saveInspectionDocument.input;

// The editor posts each change set as a JSON-encoded form field.
const save = z.object({
  pdfUrl: zfd.text(z.string().optional()),
  pageCount: zfd.numeric(z.number().optional()),
  defaultPageWidth: zfd.numeric(z.number().optional()),
  defaultPageHeight: zfd.numeric(z.number().optional()),
  features: zfd.json(shape.features),
  balloons: zfd.json(shape.balloons),
  anchors: zfd.json(shape.anchors),
  samplingDefault: zfd.json(shape.samplingDefault)
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(save).request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.quality.saveInspectionDocument({
    ...input.data,
    inspectionDocumentId: input.params.id
  });
}
