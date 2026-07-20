import { getLocalTimeZone, today } from "@internationalized/date";
import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { useUser } from "~/hooks";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import ChangeOrderForm from "./ChangeOrderForm";

type CreateChangeOrderModalProps = {
  // The Part to pre-select as the first affected item.
  itemId: string;
  onClose: () => void;
};

// Launches the CO create form as a modal from an item detail page, with the
// current item pre-selected as an affected item. Change-order categories are
// loaded on open from the create route's own loader (no extra route or
// layout-loader query), and the form posts to that same route — its action
// creates the CO, attaches the item, then redirects to the CO detail.
const CreateChangeOrderModal = ({
  itemId,
  onClose
}: CreateChangeOrderModalProps) => {
  const typesFetcher = useFetcher<{ types: ListItem[] }>();
  const user = useUser();

  // Load categories once when the modal mounts (it mounts only while open).
  const loadedRef = useRef(false);
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    typesFetcher.load(path.to.newChangeOrder);
  }, [typesFetcher]);

  const initialValues = {
    id: undefined,
    changeOrderId: undefined,
    name: "",
    reasonForChange: "",
    description: "",
    changeOrderTypeId: "",
    assignee: user.id,
    priority: "Medium" as const,
    openDate: today(getLocalTimeZone()).toString(),
    dueDate: "",
    nonConformanceId: "",
    affectedItemIds: [itemId]
  };

  return (
    <ChangeOrderForm
      type="modal"
      open
      onClose={onClose}
      initialValues={initialValues}
      types={typesFetcher.data?.types ?? []}
    />
  );
};

export default CreateChangeOrderModal;
