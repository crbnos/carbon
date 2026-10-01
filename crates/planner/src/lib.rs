// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

//! Carbon geometry planner: collision-free disassembly motion + assembly
//! sequence for a tessellated CAD assembly. Collision via FCL (the `collision`
//! crate); numerics via `npy` (LAPACK/BLAS).

pub mod collide;
pub mod consts;
pub mod contains;
pub mod fasteners;
pub mod geom;
pub mod greedy;
pub mod npy;
pub mod pipeline;
pub mod pipeline2;
pub mod stability;
pub mod steps;
pub mod types;
pub mod view;
