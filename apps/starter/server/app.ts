// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createRequestHandler, RouterContextProvider } from "react-router";
// @ts-expect-error
import * as build from "virtual:react-router/server-build";

const handler = createRequestHandler(build);

// @ts-expect-error
export default (req: Request) => handler(req, new RouterContextProvider());
