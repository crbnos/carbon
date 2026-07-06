import { Text } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";

type AddressBlockProps = {
  name?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  stateProvince?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

const tw = createTw({
  theme: {
    fontFamily: {
      sans: ["Inter", "Helvetica", "Arial", "sans-serif"]
    }
  }
});

/**
 * Render the address portion of a party block: name (bold), address lines, and
 * combined city/state/postal/country. Returns a Fragment so callers can wrap
 * it in their own <View> and add extra lines (Tax ID, VAT, contact info, etc.)
 * as siblings. AddressBlock is address-only by design.
 */
const AddressBlock = ({
  name,
  addressLine1,
  addressLine2,
  city,
  stateProvince,
  postalCode,
  country
}: AddressBlockProps) => {
  const stateAndPostal = [stateProvince, postalCode].filter(Boolean).join(" ");
  return (
    <>
      {name && <Text style={tw("font-bold")}>{name}</Text>}
      {addressLine1 && <Text>{addressLine1}</Text>}
      {addressLine2 && <Text>{addressLine2}</Text>}
      {city && <Text>{city}</Text>}
      {stateAndPostal && <Text>{stateAndPostal}</Text>}
      {country && <Text>{country}</Text>}
    </>
  );
};

export { AddressBlock };
