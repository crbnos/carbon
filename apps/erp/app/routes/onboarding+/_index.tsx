import { Button as _Button, Heading as _Heading, VStack } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import { AnimatePresence, motion } from "framer-motion";
import { onboardingSequence } from "~/utils/path";

const Heading = motion(_Heading);
const Button = motion(_Button);

const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
};

export default function GetStarted() {
  const navigate = useNavigate();

  return (
    <AnimatePresence>
      <VStack spacing={4} className="max-w-lg p-4 items-center text-center">
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
          size="h1"
          className="m-0"
        >
          Welcome to Carbon
        </Heading>

        <motion.p
          {...fade}
          transition={{ duration: 0.8, ease: "easeInOut", delay: 0.7 }}
          className="text-muted-foreground text-balance text-sm pb-4"
        >
          Carbon is the operational system for manufacturing
        </motion.p>

        <Button
          {...fade}
          transition={{ duration: 0.8, ease: "easeInOut", delay: 0.7 }}
          size="lg"
          onClick={() => navigate(onboardingSequence[0])}
        >
          Get Started
        </Button>
      </VStack>
    </AnimatePresence>
  );
}
