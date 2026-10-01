// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

//! STEP → GLB + graph.json converter (ported from the former Python geometry
//! service). Deterministic pieces here; OCCT ingestion via the occt-bridge crate.

pub mod convert;
pub mod glb;
pub mod graph;
pub mod nodeid;
