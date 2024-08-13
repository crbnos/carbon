import { VStack } from "@carbon/react";

type AddressProps = {
  address: {
    city: string | null;
    state: string | null;
    addressLine1: string | null;
    postalCode: string | null;
  };
};

const Address = ({ address }: AddressProps) => {
  const location = `${address.city ?? ""}, ${address.state ?? ""}`;
  const addressZip = `${address.addressLine1 ?? ""} ${
    address.postalCode ?? ""
  }`;
  return (
    <div>
      <VStack spacing={0}>
        <p className="font-bold line-clamp-1">{location}</p>
        <p className="text-sm text-muted-foreground line-clamp-1">
          {addressZip}
        </p>
      </VStack>
    </div>
  );
};

export default Address;
