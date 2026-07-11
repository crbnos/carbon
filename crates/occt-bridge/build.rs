use std::path::{Path, PathBuf};

/// Resolve the OCCT install prefix deterministically: `OCCT_PREFIX` env
/// (Docker/CI/custom) → the per-machine static build cache
/// (apps/assembler/scripts/build-occt.sh) → a fixed per-target default. No
/// `brew` shell-out, so the build never depends on Homebrew being installed or
/// on PATH; Docker/CI set OCCT_PREFIX explicitly.
fn occt_prefix() -> String {
    if let Ok(p) = std::env::var("OCCT_PREFIX") {
        if !p.is_empty() {
            return p;
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        let cached = PathBuf::from(home).join(".cache/carbon-occt/8.0.0-p1");
        if cached.join("lib/libTKernel.a").exists() {
            return cached.to_string_lossy().into_owned();
        }
    }
    // CARGO_CFG_TARGET_* is the target we build for. macOS dev = the standard
    // Homebrew opt layout; Linux = the distro `/usr` layout.
    let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    match os.as_str() {
        "macos" if arch == "aarch64" => "/opt/homebrew/opt/opencascade".to_string(),
        "macos" => "/usr/local/opt/opencascade".to_string(),
        _ => "/usr".to_string(),
    }
}

/// All OCCT toolkits present in `lib_dir`, and whether they are static
/// archives. Prefers static (`libTK*.a`) when present — the deployment build —
/// else dynamic (`libTK*.dylib`/`.so`, e.g. the brew install).
fn toolkits(lib_dir: &Path) -> (Vec<String>, bool) {
    let mut static_libs = Vec::new();
    let mut dylibs = Vec::new();
    if let Ok(entries) = std::fs::read_dir(lib_dir) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let Some(stem) = name.strip_prefix("lib") else {
                continue;
            };
            if let Some(s) = stem.strip_suffix(".a") {
                if s.starts_with("TK") && !s.contains('.') {
                    static_libs.push(s.to_string());
                }
            } else if let Some(s) = stem
                .strip_suffix(".dylib")
                .or_else(|| stem.strip_suffix(".so"))
            {
                // Skip versioned files (libTKFoo.so.8.0.0) so each links once.
                if s.starts_with("TK") && !s.contains('.') {
                    dylibs.push(s.to_string());
                }
            }
        }
    }
    let is_static = !static_libs.is_empty();
    let mut libs = if is_static { static_libs } else { dylibs };
    libs.sort();
    libs.dedup();
    (libs, is_static)
}

fn main() {
    let occt = occt_prefix();
    let include_dir = format!("{occt}/include/opencascade");
    let lib_dir = PathBuf::from(format!("{occt}/lib"));

    cxx_build::bridge("src/lib.rs")
        .file("src/occt.cc")
        .std("c++17")
        .include(&include_dir)
        .warnings(false)
        .compile("carbon_occt_shim");

    println!("cargo:rustc-link-search=native={}", lib_dir.display());
    println!(
        "cargo:rustc-link-search=native={}/x86_64-linux-gnu",
        lib_dir.display()
    );

    // Link every OpenCASCADE toolkit found — the STEP+XCAF+Mesh path pulls in a
    // broad transitive set; linking all TK* avoids hand-maintaining the list.
    // NOTE: must be rustc-link-lib (rustc-link-arg from a lib crate's build
    // script is dropped by cargo and never reaches the final binary link).
    // rustc wraps the native/crate library section in a --start-group on GNU
    // targets, so alphabetical order is fine for the inter-archive references.
    let (libs, is_static) = toolkits(&lib_dir);
    let kind = if is_static { "static" } else { "dylib" };
    for lib in &libs {
        println!("cargo:rustc-link-lib={kind}={lib}");
    }

    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=src/occt.cc");
    println!("cargo:rerun-if-changed=src/occt.h");
    println!("cargo:rerun-if-env-changed=OCCT_PREFIX");
}
