import { getAppUrl } from "@carbon/auth";
import { Img, Section } from "@react-email/components";

const baseUrl = getAppUrl();

export function Logo() {
  return (
    <Section className="mt-[32px]">
      <Img
        src={`${baseUrl}/carbon-logo-mark.svg`}
        width="45"
        height="45"
        alt="Carbon"
        className="my-0 mx-auto block"
      />
    </Section>
  );
}
