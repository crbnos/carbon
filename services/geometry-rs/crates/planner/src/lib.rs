//! Carbon geometry planner (Rust port of `services/geometry/app/plan.py`).
//!
//! Verified against the shadow corpus captured from the Python test suite
//! (`services/geometry/tests/capture_corpus.py`).

pub mod collide;
pub mod consts;
pub mod contains;
pub mod corpus;
pub mod fasteners;
pub mod geom;
pub mod greedy;
pub mod npy;
pub mod pipeline;
pub mod pipeline2;
pub mod steps;
pub mod types;
