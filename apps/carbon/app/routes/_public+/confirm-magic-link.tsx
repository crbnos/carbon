import { SUPABASE_API_URL } from "@carbon/auth";
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
    return `${SUPABASE_API_URL}/auth/v1/verify?token=${token}&type=magiclink&redirect_to=${window?.location.origin}/callback`;
  };

  return (
    <AnimatePresence>
      <VStack
        spacing={4}
        className="max-w-lg pt-[20dvh] items-center text-center"
      >
        <motion.img
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 2, ease: "easeInOut" }}
          src="/carbon-logo-dark.png"
          alt="Carbon Logo"
          className="block dark:hidden max-w-[60px] mb-3"
        />
        <motion.img
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 2, ease: "easeInOut" }}
          src="/carbon-logo-light.png"
          alt="Carbon Logo"
          className="hidden dark:block max-w-[60px] mb-3"
        />
        <Heading
          {...fade}
          transition={{ duration: 1.2, ease: "easeInOut", delay: 1.5 }}
          size="h1"
          className="m-0"
        >
          Welcome to CarbonOS
        </Heading>
        <motion.p
          {...fade}
          transition={{ duration: 1.4, ease: "easeInOut", delay: 1.9 }}
          className="text-muted-foreground text-sm pb-4"
        >
          CarbonOS is the operating system for manufacturing
        </motion.p>

        <Button
          {...fade}
          transition={{ duration: 1, delay: 2.4 }}
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
