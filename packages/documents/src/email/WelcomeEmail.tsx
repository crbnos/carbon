// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Body, Html, Preview, Text } from "@react-email/components";

export const WelcomeEmail = () => {
  return (
    <Html>
      <Preview>Hey- I saw you just signed up for Carbon.</Preview>
      <Body>
        <Text>
          Hey- I saw you just signed up for Carbon. Appreciate it! Let me know
          if you want to meet or talk about anything.
        </Text>
        <Text>
          This is an automated email, but I'll respond to anything you send me.
        </Text>
        <Text>Thank you!</Text>
        <Text>— Chase</Text>
      </Body>
    </Html>
  );
};

export default WelcomeEmail;
