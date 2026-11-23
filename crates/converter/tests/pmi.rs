// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

//! PMI extraction (`pmi.json`). Hermetic: the AP242 fixture is written by the
//! occt bridge itself. The NIST MBE PMI test models are public domain but not
//! committed; set `PMI_FIXTURES` to a directory holding them to run those
//! checks too (https://www.nist.gov/document/nist-pmi-step-files).

use converter::pmi::{extract_pmi, to_json, PmiDocument};

fn fixture(name: &str) -> (std::path::PathBuf, String) {
    let dir = std::env::temp_dir().join(format!("carbon-pmi-{name}"));
    std::fs::create_dir_all(&dir).unwrap();
    let step = dir.join("fixture.step");
    let step_str = step.to_str().unwrap().to_string();
    assert!(
        occt_bridge::write_test_pmi_step(&step_str),
        "failed to write the AP242 fixture"
    );
    (dir, step_str)
}

fn read(path: &str) -> PmiDocument {
    extract_pmi(path, Some("mm"))
        .expect("PMI read")
        .expect("the fixture has PMI")
}

#[test]
fn reads_dimension_tolerance_and_datum_from_ap242() {
    let (_dir, step) = fixture("semantic");
    let doc = read(&step);

    let kinds: Vec<&str> = doc.items.iter().map(|i| i.kind).collect();
    assert_eq!(kinds, vec!["dimension", "tolerance", "datum"], "{doc:#?}");

    let dim = &doc.items[0];
    assert_eq!(dim.id, "d1");
    let d = dim.dimension.as_ref().unwrap();
    assert_eq!(d.kind, "linearDistance");
    assert_eq!(d.value, Some(100.0));
    assert_eq!(d.upper, Some(0.1));
    assert_eq!(d.lower, Some(-0.05));
    assert_eq!(dim.faces.len(), 2, "the two X faces");
    for &f in &dim.faces {
        assert!(!doc.faces[f as usize].indices.is_empty());
    }
    assert!(!dim.lines.is_empty(), "the two-edge presentation");

    let tol = &doc.items[1];
    let t = tol.tolerance.as_ref().unwrap();
    assert_eq!(t.kind, "flatness");
    assert_eq!(t.value, Some(0.05));
    assert_eq!(
        t.datums.iter().map(|d| d.name.as_str()).collect::<Vec<_>>(),
        vec!["A"]
    );
    assert_eq!(tol.faces.len(), 1, "the top face");

    let datum = &doc.items[2];
    assert_eq!(datum.datum.as_ref().unwrap().name, "A");
    assert_eq!(datum.faces.len(), 1, "the bottom face");

    // The top face (z = 20) and the bottom face (z = 0) are where the box says.
    let z_of = |f: u32| {
        let p = &doc.faces[f as usize].positions;
        p.iter()
            .skip(2)
            .step_by(3)
            .copied()
            .fold(f64::NAN, f64::max)
    };
    assert_eq!(z_of(tol.faces[0]), 20.0);
    assert_eq!(z_of(datum.faces[0]), 0.0);
}

#[test]
fn xbf_round_trip_keeps_the_pmi() {
    let (dir, step) = fixture("xbf");
    let xbf = dir.join("fixture.xbf");
    let xbf_str = xbf.to_str().unwrap();
    assert!(occt_bridge::step_to_xbf(&step, xbf_str), "step_to_xbf");
    let from_step = to_json(&read(&step)).unwrap();
    let from_xbf = to_json(&read(xbf_str)).unwrap();
    assert_eq!(
        String::from_utf8(from_step).unwrap(),
        String::from_utf8(from_xbf).unwrap()
    );
}

#[test]
fn a_model_without_pmi_has_no_document() {
    let dir = std::env::temp_dir().join("carbon-pmi-none");
    std::fs::create_dir_all(&dir).unwrap();
    let step = dir.join("box.step");
    let step_str = step.to_str().unwrap();
    assert!(occt_bridge::write_test_step(step_str, 1));
    assert_eq!(extract_pmi(step_str, None).unwrap(), None);
}

// --- NIST MBE PMI test models (opt-in) ---------------------------------------

fn nist(name: &str) -> Option<String> {
    let dir = std::env::var("PMI_FIXTURES").ok()?;
    let path = std::path::Path::new(&dir).join(name);
    assert!(
        path.exists(),
        "PMI_FIXTURES is set but {} is missing",
        path.display()
    );
    Some(path.to_string_lossy().into_owned())
}

fn bounds(points: impl Iterator<Item = f64>) -> ([f64; 3], [f64; 3]) {
    let mut min = [f64::INFINITY; 3];
    let mut max = [f64::NEG_INFINITY; 3];
    for (i, v) in points.enumerate() {
        min[i % 3] = min[i % 3].min(v);
        max[i % 3] = max[i % 3].max(v);
    }
    (min, max)
}

#[test]
fn nist_ctc_01_reads_semantic_and_graphical_pmi() {
    let Some(path) = nist("nist_ctc_01_asme1_ap242-e1.stp") else {
        return;
    };
    let doc = read(&path);
    let count = |k: &str| doc.items.iter().filter(|i| i.kind == k).count();
    eprintln!(
        "CTC 01: {} dimensions, {} tolerances, {} datums, {} notes, {} views, {} faces",
        count("dimension"),
        count("tolerance"),
        count("datum"),
        count("note"),
        doc.views.len(),
        doc.faces.len()
    );
    assert!(doc.items.len() >= 20, "{} items", doc.items.len());
    for item in &doc.items {
        assert!(
            !item.lines.is_empty() || item.mesh.is_some(),
            "{} has no graphical PMI",
            item.id
        );
    }
    let json = to_json(&doc).unwrap();
    eprintln!("CTC 01 pmi.json: {} bytes", json.len());

    // The PMI sits on the model: its faces' box lies inside the model's box,
    // and the annotations' box overlaps it.
    let conv =
        converter::convert::convert_step_head(&path, &std::fs::read(&path).unwrap(), 0.1, 0.5)
            .expect("convert");
    let bbox = &conv.graph["root"]["bbox"];
    let model_min: Vec<f64> = bbox["min"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_f64().unwrap())
        .collect();
    let model_max: Vec<f64> = bbox["max"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_f64().unwrap())
        .collect();
    let (fmin, fmax) = bounds(doc.faces.iter().flat_map(|f| f.positions.iter().copied()));
    for a in 0..3 {
        assert!(
            fmin[a] >= model_min[a] - 0.5 && fmax[a] <= model_max[a] + 0.5,
            "faces {fmin:?}..{fmax:?} outside model {model_min:?}..{model_max:?}"
        );
    }
    let (lmin, lmax) = bounds(doc.items.iter().flat_map(|i| {
        i.lines
            .iter()
            .flatten()
            .copied()
            .chain(i.mesh.iter().flat_map(|m| m.positions.iter().copied()))
    }));
    for a in 0..3 {
        assert!(
            lmin[a] <= model_max[a] && lmax[a] >= model_min[a],
            "annotations {lmin:?}..{lmax:?} do not overlap model {model_min:?}..{model_max:?}"
        );
    }
}

#[test]
fn nist_ctc_05_inch_polyline_pmi() {
    let Some(path) = nist("nist_ctc_05_asme1_ap242-e1.stp") else {
        return;
    };
    let doc = read(&path);
    eprintln!(
        "CTC 05: {} items, {} views",
        doc.items.len(),
        doc.views.len()
    );
    assert!(!doc.items.is_empty());
    assert!(
        doc.items.iter().any(|i| !i.lines.is_empty()),
        "polyline presentation"
    );
}

#[test]
fn nist_saved_views_carry_a_look_direction_and_their_items() {
    let Some(ctc01) = nist("nist_ctc_01_asme1_ap242-e1.stp") else {
        return;
    };
    let doc = read(&ctc01);
    assert_eq!(doc.views.len(), 1);
    let view = &doc.views[0];
    // An isometric from front-right-top looks down: -Z, with +Z up.
    assert!(view.direction[2] < 0.0, "{:?}", view.direction);
    assert!(view.up[2] > 0.0, "{:?}", view.up);
    assert!(!view.item_ids.is_empty());
    for id in &view.item_ids {
        assert!(
            doc.items.iter().any(|i| &i.id == id),
            "view names unknown item {id}"
        );
    }

    let Some(ctc05) = nist("nist_ctc_05_asme1_ap242-e1.stp") else {
        return;
    };
    assert_eq!(read(&ctc05).views.len(), 2);
}

#[test]
fn nist_stc_06_reads_pmi_without_views() {
    // OCCT stops reading views at the first camera it cannot tie to a
    // draughting model; this AP242 e3 file's 12 cameras all arrive dropped.
    // The PMI itself still reads.
    let Some(path) = nist("nist_stc_06_asme1_ap242-e3.stp") else {
        return;
    };
    let doc = read(&path);
    assert!(doc.items.len() >= 30, "{} items", doc.items.len());
    assert!(doc.views.is_empty());
}

#[test]
fn nist_datums_merge_to_one_per_letter() {
    let Some(path) = nist("nist_ctc_01_asme1_ap242-e1.stp") else {
        return;
    };
    let doc = read(&path);
    let datums: Vec<&str> = doc
        .items
        .iter()
        .filter_map(|i| i.datum.as_ref().map(|d| d.name.as_str()))
        .collect();
    assert_eq!(datums, vec!["A", "B", "C"]);
}
