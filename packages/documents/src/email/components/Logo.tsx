import { Img, Section } from "@react-email/components";

export function Logo() {
  return (
    <Section className="mt-[32px]">
      <Img
        src="https://app.carbonos.dev/carbon-word-light.svg"
        width="auto"
        height="45"
        alt="Carbon"
        className="mb-4 mx-auto block"
      />
    </Section>
  );
}
