import { CONTROLLED_ENVIRONMENT, SUPABASE_URL } from "@carbon/auth";
import { Button, Heading, VStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useNavigate, useSearchParams } from "react-router";

export default function ConfirmMagicLink() {
  const { t } = useLingui();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const token = params.get("token");
  if (!token) {
    navigate("/");
    return null;
  }

  const getConfirmationURL = (token: string) => {
    return `${SUPABASE_URL}/auth/v1/verify?token=${token}&type=magiclink&redirect_to=${window?.location.origin}/callback`;
  };

  return (
    <>
      <div className="flex justify-center mb-8">
        <img
          src={CONTROLLED_ENVIRONMENT ? "/flag.png" : "/carbon-mark-light.svg"}
          className="w-24 dark:hidden"
          alt={t`Carbon Logo`}
        />
        <img
          src={CONTROLLED_ENVIRONMENT ? "/flag.png" : "/carbon-mark-dark.svg"}
          className="w-24 hidden dark:block"
          alt={t`Carbon Logo`}
        />
      </div>
      <div className="rounded-lg md:bg-card md:border md:border-border md:shadow-lg p-8 w-[380px]">
        <VStack spacing={4} className="items-center justify-center">
          <Heading size="h3">
            <Trans>Let's build something</Trans> 🚀
          </Heading>
          <Button
            size="lg"
            onClick={() => {
              window.location.href = getConfirmationURL(token);
            }}
          >
            <Trans>Log In</Trans>
          </Button>
        </VStack>
      </div>
    </>
  );
}
