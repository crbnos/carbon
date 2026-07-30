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
