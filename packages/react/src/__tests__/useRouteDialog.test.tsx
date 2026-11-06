// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// @vitest-environment jsdom

import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import type { To } from "react-router";
import {
  createMemoryRouter,
  Outlet,
  RouterProvider,
  useBlocker
} from "react-router";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { useRouteDialog } from "../hooks/useRouteDialog";
import { Modal, ModalContent, ModalTitle } from "../Modal";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

// What the page behind the dialog saw when it rendered: whether the dialog
// was still on the page at the moment the route was left.
let dialogOnPageWhenLeft: boolean | null = null;

function List() {
  dialogOnPageWhenLeft = document.querySelector('[role="dialog"]') !== null;
  return <p>list</p>;
}

// The page behind the dialog, holding a form with unsaved changes or not.
function Page({ unsaved = false }: { unsaved?: boolean }) {
  return (
    <>
      {unsaved && <DirtyForm />}
      <Outlet />
    </>
  );
}

// A form with unsaved changes, as `<Submit>` marks it, with its prompt. A
// router takes one blocker at a time, so only a dirty form mounts one.
function DirtyForm() {
  const blocker = useBlocker(true);
  return (
    <>
      <i data-unsaved-changes="" />
      <Modal open={blocker.state === "blocked"}>
        <ModalContent>
          <ModalTitle>Unsaved changes</ModalTitle>
          <button type="button" onClick={() => blocker.reset?.()}>
            Stay
          </button>
        </ModalContent>
      </Modal>
    </>
  );
}

const dialogTitles = () =>
  Array.from(document.querySelectorAll('[role="dialog"]')).map(
    (dialog) =>
      `${dialog.querySelector("h2")?.textContent}:${dialog.getAttribute("data-state")}`
  );

function NewRecord({ to, unsaved = false }: { to?: To; unsaved?: boolean }) {
  const dialog = useRouteDialog(to);
  return (
    <Modal
      open={dialog.open}
      onOpenChange={(open) => {
        if (!open) dialog.close();
      }}
    >
      <ModalContent>
        <ModalTitle>New record</ModalTitle>
        {unsaved && <DirtyForm />}
        <button type="button" onClick={dialog.close}>
          Cancel
        </button>
        {/* Closes outside an event handler, as a save's success callback does. */}
        <button type="button" onClick={() => setTimeout(dialog.close, 0)}>
          Done
        </button>
      </ModalContent>
    </Modal>
  );
}

function mount({
  pageUnsaved,
  ...props
}: {
  to?: To;
  unsaved?: boolean;
  pageUnsaved?: boolean;
} = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  const router = createMemoryRouter(
    [
      {
        path: "/list",
        element: <Page unsaved={pageUnsaved} />,
        children: [
          { index: true, element: <List /> },
          { path: "new", element: <NewRecord {...props} /> }
        ]
      },
      { path: "/elsewhere", element: <List /> }
    ],
    { initialEntries: ["/list/new"] }
  );
  root = createRoot(container);
  act(() => root!.render(<RouterProvider router={router} />));
  return router;
}

async function clickCancel(settleMs = 0, label = "Cancel") {
  const cancel = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent === label
  );
  expect(cancel).toBeDefined();
  // `act` runs effects only when its callback ends, so the click and the
  // wait are two calls: the hook's effect runs after the click, as it does
  // in a browser.
  await act(async () => {
    cancel!.click();
  });
  // The MutationObserver and the navigation settle on later ticks.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  });
}

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no matchMedia; the dialogs read the viewport through it.
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }) as unknown as MediaQueryList;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  dialogOnPageWhenLeft = null;
});

describe("useRouteDialog", () => {
  it("closes the dialog first and leaves the route once it is off the page", async () => {
    const router = mount();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    await clickCancel();

    expect(router.state.location.pathname).toBe("/list");
    expect(dialogOnPageWhenLeft).toBe(false);
  });

  it("waits for the dialog when it closes outside an event handler", async () => {
    const router = mount();

    await clickCancel(50, "Done");

    expect(router.state.location.pathname).toBe("/list");
    expect(dialogOnPageWhenLeft).toBe(false);
  });

  it("goes to `to` when one is given", async () => {
    const router = mount({ to: "/elsewhere" });

    await clickCancel();

    expect(router.state.location.pathname).toBe("/elsewhere");
  });

  it("keeps the dialog open behind the blocker when it holds unsaved changes, and closes again after stay", async () => {
    const router = mount({ unsaved: true });

    await clickCancel(400);
    expect(router.state.location.pathname).toBe("/list/new");
    expect(dialogTitles()).toEqual(["New record:open", "Unsaved changes:open"]);

    // Stay, then close again at once: the close is not ignored.
    await clickCancel(250, "Stay");
    expect(dialogTitles()).toEqual(["New record:open"]);

    await clickCancel(50);
    expect(dialogTitles()).toEqual(["New record:open", "Unsaved changes:open"]);
  });

  it("shows the dialog again once the user stays on a page whose blocker kept the route", async () => {
    const router = mount({ pageUnsaved: true });

    // Past the check that runs after leaving (300ms): only the prompt shows,
    // so nothing covers its buttons.
    await clickCancel(400);
    expect(router.state.location.pathname).toBe("/list/new");
    expect(dialogTitles()).toEqual(["Unsaved changes:open"]);

    await clickCancel(50, "Stay");
    expect(dialogTitles()).toEqual(["New record:open"]);
  });
});
