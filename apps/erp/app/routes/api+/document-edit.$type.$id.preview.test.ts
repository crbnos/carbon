// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { resolveTemplate } from "@carbon/documents/template";
import {
  getCompanyTemplate,
  getDocumentEdit
} from "@carbon/lib/document-edit.server";
import { beforeEach, expect, it, vi } from "vitest";
import {
  renderDocumentWithEdit,
  requireDocumentEditRecord
} from "~/modules/settings/document-edit.pdf";
import { action } from "./document-edit.$type.$id.preview";

vi.mock("~/modules/settings/document-edit.pdf", () => ({
  renderDocumentWithEdit: vi.fn(),
  requireDocumentEditRecord: vi.fn()
}));
vi.mock("@carbon/lib/document-edit.server", () => ({
  getCompanyTemplate: vi.fn(),
  getDocumentEdit: vi.fn()
}));

const template = resolveTemplate("purchaseOrder", null);
const saved = { blocks: {}, settings: { text: { title: "Saved words" } } };

function post(fields: Record<string, string>) {
  const body = new FormData();
  body.set("blocks", JSON.stringify(template.blocks));
  body.set("settings", JSON.stringify(template.settings));
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return action({
    request: new Request("http://localhost/preview", { method: "post", body }),
    params: { type: "purchaseOrder", id: "po-1" },
    context: {}
  } as never);
}

function recordIs(locked: boolean) {
  vi.mocked(requireDocumentEditRecord).mockResolvedValue({
    client: {},
    companyGroupId: "group-1",
    key: {
      companyId: "company-1",
      documentType: "purchaseOrder",
      documentId: "po-1"
    },
    record: { label: "PO-1", locked, notes: null }
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(renderDocumentWithEdit).mockResolvedValue(new Response("pdf"));
  vi.mocked(getCompanyTemplate).mockResolvedValue(template);
  vi.mocked(getDocumentEdit).mockResolvedValue(saved);
});

it("prints a locked record's saved edits and ignores the posted draft", async () => {
  recordIs(true);
  const draftTitle = { ...template.settings, text: { title: "Typed words" } };

  await post({
    settings: JSON.stringify(draftTitle),
    notes: JSON.stringify({ type: "doc", content: [] })
  });

  expect(vi.mocked(renderDocumentWithEdit).mock.calls[0]?.[1].edit).toBe(saved);
});

it("refuses a draft that takes a figure out, on an open record", async () => {
  recordIs(false);
  const typedTotal = template.blocks.map((block) =>
    block.type === "summary" ? { ...block, text: { totalValue: "$1" } } : block
  );

  const response = await post({ blocks: JSON.stringify(typedTotal) });

  expect(response.status).toBe(400);
  expect(renderDocumentWithEdit).not.toHaveBeenCalled();
});
