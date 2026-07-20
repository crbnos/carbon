//! Convert the STEP fixtures with the Rust converter and assert the graph.json
//! matches the Python reference (nodeId + geometryHash byte-identical; transforms/
//! bbox/volume/color within epsilon). Env ASSEMBLER_FIXTURES points at a dir with
//! {box,plates,nested}.step + {name}.graph.json (Python output). Skips if unset.

use converter::convert::convert_step;
use serde_json::Value;

fn approx_eq(a: &Value, b: &Value, eps: f64) -> bool {
    match (a, b) {
        (Value::Null, Value::Null) => true,
        (Value::Number(x), Value::Number(y)) => {
            (x.as_f64().unwrap() - y.as_f64().unwrap()).abs() <= eps
        }
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(u, v)| approx_eq(u, v, eps))
        }
        _ => a == b,
    }
}

fn compare(rust: &Value, py: &Value, path: &str) -> Result<(), String> {
    for key in ["nodeId", "name", "isAssembly", "geometryHash"] {
        if rust[key] != py[key] {
            return Err(format!("{path}.{key}: rust={} py={}", rust[key], py[key]));
        }
    }
    for (key, eps) in [("transform", 1e-6), ("volume", 0.01), ("color", 0.02)] {
        if !approx_eq(&rust[key], &py[key], eps) {
            return Err(format!("{path}.{key}: rust={} py={}", rust[key], py[key]));
        }
    }
    // bbox within 0.5mm (tessellation-dependent, matching test_convert tolerances)
    for mm in ["min", "max"] {
        if !approx_eq(&rust["bbox"][mm], &py["bbox"][mm], 0.5) {
            return Err(format!(
                "{path}.bbox.{mm}: rust={} py={}",
                rust["bbox"][mm], py["bbox"][mm]
            ));
        }
    }
    let rc = rust["children"].as_array().unwrap();
    let pc = py["children"].as_array().unwrap();
    if rc.len() != pc.len() {
        return Err(format!(
            "{path}.children len rust={} py={}",
            rc.len(),
            pc.len()
        ));
    }
    for (i, (r, p)) in rc.iter().zip(pc).enumerate() {
        compare(r, p, &format!("{path}.children[{i}]"))?;
    }
    Ok(())
}

fn graph_node_ids(node: &Value) -> Vec<String> {
    let mut ids = vec![node["nodeId"].as_str().unwrap().to_string()];
    for c in node["children"].as_array().unwrap() {
        ids.extend(graph_node_ids(c));
    }
    ids
}

fn glb_node_ids(glb: &[u8]) -> std::collections::HashSet<String> {
    // Parse the JSON chunk (starts at byte 20 after 12-byte header + 8-byte chunk header).
    let json_len = u32::from_le_bytes([glb[12], glb[13], glb[14], glb[15]]) as usize;
    let json: Value = serde_json::from_slice(&glb[20..20 + json_len]).unwrap();
    let mut ids = std::collections::HashSet::new();
    for node in json["nodes"].as_array().unwrap() {
        if let Some(id) = node
            .get("extras")
            .and_then(|e| e.get("nodeId"))
            .and_then(|v| v.as_str())
        {
            ids.insert(id.to_string());
        }
    }
    ids
}

#[test]
fn convert_matches_python() {
    let dir = match std::env::var("ASSEMBLER_FIXTURES") {
        Ok(d) => d,
        Err(_) => {
            eprintln!("ASSEMBLER_FIXTURES unset; skipping");
            return;
        }
    };
    let mut failures = Vec::new();
    for name in ["box", "plates", "nested"] {
        let step = format!("{dir}/{name}.step");
        let text = std::fs::read_to_string(&step).unwrap_or_default();
        let conv = convert_step(&step, &text, 0.1, 0.5).expect("convert");
        let py: Value = serde_json::from_str(
            &std::fs::read_to_string(format!("{dir}/{name}.graph.json")).unwrap(),
        )
        .unwrap();

        for key in ["version", "unit", "sourceUnit", "componentCount"] {
            if conv.graph[key] != py[key] {
                failures.push(format!(
                    "{name}.{key}: rust={} py={}",
                    conv.graph[key], py[key]
                ));
            }
        }
        match compare(&conv.graph["root"], &py["root"], name) {
            Ok(()) => eprintln!(
                "PASS graph {name} (components={}, triangles={})",
                conv.component_count, conv.triangles
            ),
            Err(e) => failures.push(e),
        }
        // GLB: valid magic, and every graph nodeId is stamped on a glTF node.
        if &conv.glb[..4] != b"glTF" {
            failures.push(format!("{name}: GLB bad magic"));
        }
        let glb_ids = glb_node_ids(&conv.glb);
        let graph_ids = graph_node_ids(&conv.graph["root"]);
        for id in &graph_ids {
            if !glb_ids.contains(id) {
                failures.push(format!("{name}: graph nodeId {id} missing from GLB"));
            }
        }
        eprintln!(
            "PASS glb {name} ({} nodes, {} bytes)",
            glb_ids.len(),
            conv.glb.len()
        );
    }
    assert!(
        failures.is_empty(),
        "convert parity failures:\n{}",
        failures.join("\n")
    );
}
