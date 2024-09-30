export function formatAddressLines(
  addressLine1?: string | null,
  addressLine2?: string | null
): string {
  // Concatenate addressLine1 and addressLine2 if both are provided
  if (addressLine1) {
    const address = addressLine2
      ? `${addressLine1} ${addressLine2}`
      : addressLine1;
    return address;
  } else if (addressLine2) {
    return addressLine2;
  }
}

export function formatCityStatePostalCode(
  city?: string | null,
  stateProvince?: string | null,
  postalCode?: string | null
): string {
  // Create an array to hold the different parts of the address
  const parts: string[] = [];

  // Add city in the correct format
  if (city) parts.push(city);

  // Combine state and postalCode without a comma if both are provided
  if (stateProvince) {
    const stateProvincePostalCode = postalCode
      ? `${stateProvince} ${postalCode}`
      : stateProvince;
    parts.push(stateProvincePostalCode);
  } else if (postalCode) {
    parts.push(postalCode);
  }

  // Join all parts with a comma separator
  return parts.join(", ");
}

export function formatAddress(
  addressLine1?: string | null,
  addressLine2?: string | null,
  city?: string | null,
  stateProvince?: string | null,
  postalCode?: string | null,
  country?: string | null
): string {
  // Create an array to hold the different parts of the address
  const parts: string[] = [];

  const formattedAddressLines = formatAddressLines(addressLine1, addressLine2);
  if (formattedAddressLines) parts.push(formattedAddressLines);

  const formattedCityStatePostalCode = formatCityStatePostalCode(
    city,
    stateProvince,
    postalCode
  );
  if (formattedCityStatePostalCode) parts.push(formattedCityStatePostalCode);

  if (country) parts.push(country);

  // Join all parts with a comma separator
  return parts.join(", ");
}
