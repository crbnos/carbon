type CountryProfile = {
  eori?: boolean;
  registrationNumber?: boolean;
};

const COUNTRY_PROFILES: Record<string, CountryProfile> = {
  AT: { eori: true },
  BE: { eori: true },
  BG: { eori: true },
  HR: { eori: true },
  CY: { eori: true },
  CZ: { eori: true },
  DK: { eori: true },
  EE: { eori: true },
  FI: { eori: true },
  FR: { eori: true },
  DE: { eori: true },
  GB: { eori: true, registrationNumber: true },
  GR: { eori: true },
  HU: { eori: true },
  IE: { eori: true },
  IT: { eori: true },
  LV: { eori: true },
  LT: { eori: true },
  LU: { eori: true },
  MT: { eori: true },
  NL: { eori: true },
  PL: { eori: true },
  PT: { eori: true },
  RO: { eori: true },
  SK: { eori: true },
  SI: { eori: true },
  ES: { eori: true },
  SE: { eori: true }
};

export function getCountryProfile(
  countryCode: string | null | undefined
): CountryProfile | undefined {
  if (!countryCode) return undefined;
  return COUNTRY_PROFILES[countryCode.toUpperCase()];
}

export function isEoriCountry(countryCode: string | null | undefined): boolean {
  return getCountryProfile(countryCode)?.eori === true;
}

export function isRegistrationNumberCountry(
  countryCode: string | null | undefined
): boolean {
  return getCountryProfile(countryCode)?.registrationNumber === true;
}
