import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gated: true,
  types: [] as { id: string; name: string; systemType?: string; protected?: boolean }[],
  fetcherCall: 0,
  load: vi.fn()
}));

vi.mock("@carbon/form", () => ({
  ValidatedForm: ({ children }: { children: ReactNode }) => children,
  useFieldArray: () => [
    ["row-a", "row-b"].map((rowId) => ({ key: rowId, defaultValue: { rowId } })),
    { push: vi.fn(), remove: vi.fn() },
    undefined
  ]
}));
vi.mock("@carbon/react", () => {
  const wrapper = ({ children }: { children?: ReactNode }) => children ?? null;
  return {
    Badge: wrapper, Button: wrapper, HStack: wrapper, IconButton: wrapper,
    Modal: wrapper, ModalBody: wrapper, ModalContent: wrapper,
    ModalFooter: wrapper, ModalHeader: wrapper, ModalOverlay: wrapper,
    ModalTitle: wrapper, VStack: wrapper,
    toast: { error: vi.fn() },
    useMount: (callback: () => void) => callback()
  };
});
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings.join("") })
}));
vi.mock("react-router", () => ({
  useNavigate: () => vi.fn(),
  useFetcher: () => mocks.fetcherCall++ === 0
    ? { state: "idle", data: undefined }
    : { data: { data: mocks.types }, load: mocks.load }
}));
vi.mock("~/components/Form", () => ({
  Boolean: () => null,
  Hidden: ({ name, value }: { name: string; value: string }) =>
    createElement("input", { type: "hidden", name, value }),
  Input: ({ name }: { name: string }) => createElement("input", { name }),
  Location: () => null,
  Select: ({ name }: { name: string }) => createElement("select", { name }),
  Submit: ({ isDisabled, children }: { isDisabled: boolean; children: ReactNode }) =>
    createElement("button", { type: "submit", disabled: isDisabled }, children)
}));
vi.mock("~/hooks", () => ({
  useFlags: () => ({ isControlledEnvironment: false }),
  useUser: () => ({ defaults: {} })
}));
vi.mock("~/hooks/usePlanGate", () => ({
  usePlanGate: () => ({ isGated: mocks.gated })
}));
vi.mock("~/modules/users", async () => import("../app/modules/users/users.models"));
vi.mock("~/utils/path", () => ({
  path: { to: { api: { employeeTypes: "/api/employee-types" }, bulkInviteEmployees: "/x/users/employees/bulk-invite" } }
}));

import BulkInviteEmployeesModal from "../app/modules/users/ui/Employees/BulkInviteEmployeesModal";

beforeEach(() => {
  mocks.gated = true;
  mocks.types = [];
  mocks.fetcherCall = 0;
  vi.clearAllMocks();
});
const renderModal = () => renderToStaticMarkup(createElement(BulkInviteEmployeesModal));

describe("bulk invite upstream role selector gate", () => {
  it("disables gated submission until the shared Admin lookup resolves", () => {
    const html = renderModal();
    expect(html).toContain('type="submit" disabled=""');
    expect(html).not.toContain("<select");
    expect(mocks.load).toHaveBeenCalledOnce();
    expect(mocks.load).toHaveBeenCalledWith("/api/employee-types");
  });

  it("submits the Admin type in every gated row and enables Invite", () => {
    mocks.types = [
      { id: "worker-a", name: "Worker" },
      { id: "admin-a", name: "Admin", systemType: "Admin" }
    ];
    const html = renderModal();
    expect(html).toContain('name="employees[0].employeeType" value="admin-a"');
    expect(html).toContain('name="employees[1].employeeType" value="admin-a"');
    expect(html).not.toContain("<select");
    expect(html).not.toContain('type="submit" disabled=""');
  });

  it("preserves the upstream protected-type fallback", () => {
    mocks.types = [
      { id: "worker-a", name: "Worker" },
      { id: "protected-a", name: "Protected", protected: true }
    ];
    expect(renderModal()).toContain('name="employees[0].employeeType" value="protected-a"');
  });

  it("retains a selectable employee type for ungated rows", () => {
    mocks.gated = false;
    const html = renderModal();
    expect(html).toContain('<select name="employees[0].employeeType"');
    expect(html).toContain('<select name="employees[1].employeeType"');
    expect(html).not.toContain('type="submit" disabled=""');
    expect(html).toContain("md:col-span-2");
    expect(html).not.toContain("Employee 1");
    expect(html).not.toContain("Employee 2");
  });
});
