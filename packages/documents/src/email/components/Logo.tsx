import { Img, Section } from "@react-email/components";

export function Logo() {
  return (
    <Section className="mt-[32px]">
      <Img
        src="https://app.carbon.ms/carbon-word-light.png"
        width="auto"
        height="45"
        alt="Carbon"
        className="mb-4 mx-auto block"
      />
    </Section>
  );
}
