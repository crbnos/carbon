import { SUPABASE_URL } from "@carbon/auth";
import { Button as _Button, Heading as _Heading, VStack } from "@carbon/react";
import { useNavigate, useSearchParams } from "@remix-run/react";
import { AnimatePresence, motion } from "framer-motion";

const Heading = motion(_Heading);
const Button = motion(_Button);

const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
};

export default function ConfirmMagicLink() {
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
    <AnimatePresence>
      <VStack spacing={4} className="max-w-lg items-center text-center">
        <motion.img
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, ease: "easeInOut" }}
          src="/carbon-logo-mark.svg"
          alt="Carbon Logo"
          className="w-24 mb-3"
        />

        <Heading
          {...fade}
          transition={{ duration: 0.8, ease: "easeInOut", delay: 0.5 }}
          size="h3"
          className="m-0"
        >
          Magic Link Authentication
        </Heading>

        <Button
          {...fade}
          transition={{ duration: 0.8, ease: "easeInOut", delay: 0.5 }}
          size="lg"
          onClick={() => {
            window.location.href = getConfirmationURL(token);
          }}
        >
          Log In
        </Button>
      </VStack>
    </AnimatePresence>
  );
}
