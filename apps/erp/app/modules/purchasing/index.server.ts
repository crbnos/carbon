// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  activateLease,
  addReturnOrderLine,
  applyPlanningActions,
  assignPurchasingPlanningActions,
  cancelLease,
  cancelPurchasingRfq,
  cancelReturnOrder,
  closePurchaseOrderAndApprovals,
  confirmReturnOrder,
  createPurchasingRfq,
  deactivateSupplier,
  decidePurchaseOrderApproval,
  decideSupplierApproval,
  deletePurchaseOrders,
  dismissPurchasingPlanningActions,
  finalizePurchaseOrderAndNotify,
  finalizePurchasingRfqAndNotify,
  finalizeSupplierQuoteWithLink,
  modifyLease,
  orderPlannedPurchases,
  overrideLeaseLineClassification,
  purchaseLeaseLine,
  removeLeaseLineClassificationOverride,
  reopenPurchaseOrder,
  reopenPurchasingPlanningActions,
  reopenReturnOrder,
  requestSupplierApproval,
  sendSupplierQuoteToSupplier,
  terminateLeaseLine,
  updatePlanningPurchaseOrderLine,
  updatePurchaseOrders,
  updatePurchasingRfqs,
  updateReturnOrderLine,
  updateReturnOrders,
  updateSupplierQuotes
} from "./purchasing.server";

/** The purchasing module's operations, by entity. */
export const purchasing = {
  purchaseOrder: {
    update: updatePurchaseOrders,
    delete: deletePurchaseOrders,
    finalize: finalizePurchaseOrderAndNotify,
    decideApproval: decidePurchaseOrderApproval,
    reopen: reopenPurchaseOrder,
    close: closePurchaseOrderAndApprovals
  },
  purchaseReturnOrder: {
    update: updateReturnOrders,
    confirm: confirmReturnOrder,
    cancel: cancelReturnOrder,
    reopen: reopenReturnOrder,
    addLine: addReturnOrderLine,
    updateLine: updateReturnOrderLine
  },
  rfq: {
    create: createPurchasingRfq,
    update: updatePurchasingRfqs,
    cancel: cancelPurchasingRfq,
    finalize: finalizePurchasingRfqAndNotify
  },
  supplierQuote: {
    update: updateSupplierQuotes,
    finalize: finalizeSupplierQuoteWithLink,
    send: sendSupplierQuoteToSupplier
  },
  supplier: {
    requestApproval: requestSupplierApproval,
    deactivate: deactivateSupplier,
    decideApproval: decideSupplierApproval
  },
  lease: {
    activate: activateLease,
    cancel: cancelLease,
    modify: modifyLease
  },
  planning: {
    order: orderPlannedPurchases,
    updateLine: updatePlanningPurchaseOrderLine,
    apply: applyPlanningActions,
    dismiss: dismissPurchasingPlanningActions,
    reopen: reopenPurchasingPlanningActions,
    assign: assignPurchasingPlanningActions
  },
  leaseLine: {
    terminate: terminateLeaseLine,
    purchase: purchaseLeaseLine,
    overrideClassification: overrideLeaseLineClassification,
    removeClassificationOverride: removeLeaseLineClassificationOverride
  }
};
