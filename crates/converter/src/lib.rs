//! STEP → GLB + graph.json converter (ported from the former Python geometry
//! service). Deterministic pieces here; OCCT ingestion via the occt-bridge crate.

pub mod convert;
pub mod glb;
pub mod graph;
pub mod nodeid;
