//! Deserialization of the shadow corpus produced by
//! `services/geometry/tests/capture_corpus.py`.
//!
//! Each JSON case holds the exact component meshes a Python planner test built,
//! the call parameters, and the Python outcome. The Rust planner replays the
//! meshes and must reproduce the outcome (semantic parity).

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct RawComponent {
    #[serde(rename = "nodeId")]
    pub node_id: String,
    pub name: String,
    #[serde(rename = "isProxy")]
    pub is_proxy: bool,
    /// Flat row-major (n*3) world-space vertices, f64.
    pub vertices: Vec<f64>,
    /// Flat row-major (m*3) triangle indices.
    pub faces: Vec<u32>,
    #[serde(rename = "vertexCount")]
    pub vertex_count: usize,
    #[serde(rename = "faceCount")]
    pub face_count: usize,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct RawParams {
    pub clearance: Option<f64>,
    #[serde(rename = "pathSamples")]
    pub path_samples: Option<usize>,
    pub tolerance: Option<f64>,
    #[serde(default)]
    pub protected: Vec<String>,
    /// fixed_sequence only.
    #[serde(default)]
    pub groups: Option<Vec<Vec<String>>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawPlanned {
    #[serde(rename = "nodeId")]
    pub node_id: String,
    pub motion: serde_json::Value,
    pub confidence: Option<String>,
    #[serde(rename = "removalDirection")]
    pub removal_direction: Option<Vec<f64>>,
    #[serde(rename = "blockedBy", default)]
    pub blocked_by: Vec<String>,
    pub tier: Option<String>,
    pub verified: bool,
    #[serde(rename = "groupId")]
    pub group_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawResult {
    pub sequence: Vec<String>,
    pub tiers: std::collections::BTreeMap<String, i64>,
    #[serde(rename = "mergedInto", default)]
    pub merged_into: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    pub groups: serde_json::Value,
    #[serde(rename = "verifiedCount", default)]
    pub verified_count: i64,
    pub planned: Vec<RawPlanned>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawCase {
    pub kind: String,
    pub index: u64,
    #[serde(default)]
    pub monkeypatched: bool,
    pub params: RawParams,
    pub components: Vec<RawComponent>,
    pub result: RawResult,
}

impl RawCase {
    pub fn from_path(path: &std::path::Path) -> std::io::Result<Self> {
        let text = std::fs::read_to_string(path)?;
        Ok(serde_json::from_str(&text)?)
    }

    /// Tolerance to replay with: captured value or the Python default 0.15.
    pub fn tolerance(&self) -> f64 {
        self.params
            .tolerance
            .unwrap_or(crate::consts::PENETRATION_TOLERANCE_MM)
    }
}
