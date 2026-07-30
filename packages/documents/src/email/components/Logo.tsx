import { getAppUrl } from "@carbon/env";
import { Img, Section } from "@react-email/components";

const baseUrl = getAppUrl();

export function Logo() {
  return (
    <Section className="mt-[32px]">
      <Img
        src={`${baseUrl}/carbon-word-dark-outline.png`}
        width="auto"
        height="45"
        alt="Carbon"
        className="mb-4 mx-auto block"
      />
    </Section>
  );
}
