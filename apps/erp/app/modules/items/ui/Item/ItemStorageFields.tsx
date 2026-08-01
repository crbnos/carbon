import { useLingui } from "@lingui/react/macro";
import { StorageUnit } from "~/components/Form";
import { useUser } from "~/hooks";

const ItemStorageFields = () => {
  const { t } = useLingui();
  // The storage-unit picker is scoped to the signed-in user's default
  // location. Items are company-wide - there's no item.locationId - so we
  // use the user's working warehouse as the context for the pick. The
  // server will derive the pickMethod.locationId from the chosen unit's
  // storageUnit.locationId (which is always set).
  const { defaults } = useUser();
  const userLocationId = defaults.locationId ?? undefined;

  return (
    <StorageUnit
      name="defaultStorageUnitId"
      label={t`Default Storage Unit`}
      locationId={userLocationId}
      isOptional
      disabled={!userLocationId}
      helperText={
        userLocationId
          ? undefined
          : t`Set your default location in profile settings to pick a storage unit.`
      }
    />
  );
};

export default ItemStorageFields;
