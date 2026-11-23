// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noUnmountingDialog } from "./no-unmounting-dialog";

const scan = (contents: string, file = "apps/erp/app/modules/x/ui/X.tsx") =>
  noUnmountingDialog.scan(file, contents).map((v) => v.line);

describe("noUnmountingDialog", () => {
  it("flags a dialog that a condition removes", () => {
    expect(
      scan(`{deleteModal.isOpen && <ConfirmDelete name="x" onCancel={close} />}
{selected && (
  <PartDrawer item={selected} />
)}
{isOpen && <Modal open onOpenChange={close}>
{isOpen && (
  <IssueModal
    {/* the method's materials */}
    onClose={close}
  />
)}`)
    ).toEqual([1, 3, 5, 7]);
  });

  it("flags a dialog whose condition is its own open state, even with an open prop", () => {
    expect(
      scan(`{deleteModal.isOpen && (
  <ConfirmDelete isOpen={deleteModal.isOpen} onCancel={close} />
)}
{open && selected && <Modal open={open}>
{d.openCount > 0 && <PartModal key={d.openCount} open={d.isOpen} />}
{selected && <Drawer open={isOpen} />}
{showDelete && <ConfirmDelete isOpen={showDelete} />}
{d.isOpen === true && <XModal open={d.isOpen} />}
{showDeleteAll && <ConfirmDelete isOpen={showDelete} />}
{sel && <ConfirmDelete isOpen={!!sel} />}
{row.item && <EditModal open={Boolean(row.item)} />}`)
    ).toEqual([2, 4, 7, 8, 10, 11]);
  });

  it("flags a dialog in a ternary's empty branch or after ||, ignores data-open, and reads a braced open prop whole", () => {
    expect(
      scan(`{!deleteModal.isOpen ? null : <ConfirmDelete isOpen={deleteModal.isOpen} />}
{hidden || <EditModal onClose={close} />}
{x.isOpen && <ModalCard onClose={close}>}
{newGauge.isOpen && <GaugeForm type="modal" onClose={close} />}
{tab && <GaugeForm type="card" />}
{sel && <XModal data-open={sel.id} />}
{x && <XDrawer open={rows.some((r) => { return r.id === x; })} />}`)
    ).toEqual([1, 2, 3, 4, 6]);
  });

  it("flags a dialog whose own close clears the record it is guarded on", () => {
    expect(
      scan(`{selectedCustomer && selectedCustomer.id && (
  <ConfirmDelete
    isOpen={deleteModal.isOpen}
    onCancel={() => {
      deleteModal.onClose();
      setSelectedCustomer(null);
    }}
  />
)}
{loading ? <Spinner /> : <ConfirmDelete name="x" onCancel={close} />}
{selected && <ConfirmDelete isOpen={d.isOpen} onCancel={d.onClose} />}
{show && <XModal open={d.isOpen} onClose={() => { d.onClose(); setShow(false); }} />}
{deleteLine && <DeleteLine isOpen={d.isOpen} onCancel={onDeleteCancel} />}
const onDeleteCancel = () => {
  d.onClose();
  setDeleteLine(null);
};`)
    ).toEqual([2, 10, 12, 13]);
  });

  it("reads a ternary as a condition too", () => {
    expect(
      scan(`{issueModal.isOpen ? (
  <IssueMaterialModal onClose={close} />
) : null}
{pending ? <LeaseModal open={isOpen} /> : null}
const isOpen = d.isOpen;
const modals = pending?.action === "end" ? (
  <LeaseModal open={isOpen} />
) : pending?.action === "buy" ? (
  <BuyModal open={isOpen} />
) : null;
const render = () =>
  d.openCount > 0 ? <IssueModal open={d.isOpen} /> : null;`)
    ).toEqual([2]);
  });

  it("accepts a dialog driven by its open prop, under a condition or not", () => {
    expect(
      scan(`<ConfirmDelete isOpen={deleteModal.isOpen} onCancel={close} />
{selected && <PartDrawer open={drawer.isOpen} item={selected} />}
{rows.length > 0 && <Table rows={rows} />}
{isOpen && <ModalBody>text</ModalBody>}`)
    ).toEqual([]);
  });

  it("treats Confirm* and Delete* components as dialogs", () => {
    expect(
      scan(`{d.isOpen && <DeleteProcedureStep attribute={a} onCancel={close} />}
{d.isOpen && <ConfirmMaterialIdChange onClose={close} />}`)
    ).toEqual([1, 2]);
  });

  it("flags an early return that removes a dialog, not one in a component with no dialog", () => {
    expect(
      scan(`if (!isOpen) return null;\nreturn <Modal open={isOpen} />;`)
    ).toEqual([1]);
    expect(scan(`if (!open) return null;\nreturn <div />;`)).toEqual([]);
  });

  it("flags a route closed with useCloseRoute", () => {
    expect(scan(`const closeRoute = useCloseRoute();`)).toEqual([1]);
  });

  it("leaves the files that define the hooks alone", () => {
    expect(
      scan(
        `const closeRoute = useCloseRoute();`,
        "packages/react/src/hooks/useRouteDialog.tsx"
      )
    ).toEqual([]);
  });
});
