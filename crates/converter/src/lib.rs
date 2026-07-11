//! STEP → GLB + graph.json converter (Rust port of `services/geometry/app/convert.py`
//! + `glb.py`). Deterministic pieces here; OCCT ingestion via the occt-bridge crate.

pub mod convert;
pub mod glb;
pub mod graph;
pub mod nodeid;
