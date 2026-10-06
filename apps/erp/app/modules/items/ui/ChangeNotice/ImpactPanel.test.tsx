// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({
  pathname: "/x/items/change-notice/cn-1/impact"
}));

vi.mock("@carbon/react", () => {
  const passthrough = (props: { children?: unknown }) => props.children;
  return {
    Card: passthrough,
    CardContent: passthrough,
    CardHeader: passthrough,
    CardTitle: passthrough,
    VStack: passthrough
  };
});
vi.mock("@lingui/react/macro", () => ({
  Trans: (props: { children?: unknown }) => props.children
}));
vi.mock("react-icons/lu", () => ({ LuExternalLink: () => null }));
vi.mock("react-router", () => ({
  Link: (props: { children?: unknown }) => props.children,
  useLocation: () => ({ pathname: route.pathname })
}));
vi.mock("~/utils/path", () => ({
  path: {
    to: {
      changeNoticeImpact: (id: string) => `/x/items/change-notice/${id}/impact`
    }
  }
}));

const { default: ImpactPanel } = await import("./ImpactPanel");

function renderPanel() {
  return renderToStaticMarkup(
    createElement(ImpactPanel, { changeNoticeId: "cn-1" })
  );
}

describe("ImpactPanel entry point", () => {
  beforeEach(() => {
    route.pathname = "/x/items/change-notice/cn-1/impact";
  });

  it("hides its link while the workspace route is already open", () => {
    const rendered = renderPanel();
    expect(rendered).not.toContain("Open Impact Workspace");
    expect(rendered).toContain("Review current purchasing");
  });

  it("keeps the link on other change notice routes", () => {
    route.pathname = "/x/items/change-notice/cn-1/details";
    expect(renderPanel()).toContain("Open Impact Workspace");
  });
});
