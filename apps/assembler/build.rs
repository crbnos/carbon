use std::path::PathBuf;

/// Same OCCT discovery as crates/occt-bridge/build.rs: `OCCT_PREFIX` env → the
/// per-machine static-build cache → a fixed per-target default. No `brew`
/// shell-out, so the build never depends on Homebrew being installed or on PATH.
fn occt_prefix() -> String {
    if let Ok(p) = std::env::var("OCCT_PREFIX") {
        if !p.is_empty() {
            return p;
        }
    }
    // The per-machine static build (apps/assembler/scripts/build-occt.sh).
    if let Some(home) = std::env::var_os("HOME") {
        let cached = PathBuf::from(home).join(".cache/carbon-occt/8.0.0-p1");
        if cached.join("lib/libTKernel.a").exists() {
            return cached.to_string_lossy().into_owned();
        }
    }
    let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    match os.as_str() {
        "macos" if arch == "aarch64" => "/opt/homebrew/opt/opencascade".to_string(),
        "macos" => "/usr/local/opt/opencascade".to_string(),
        _ => "/usr".to_string(),
    }
}

fn main() {
    // Static OCCT (the deployment build) is linked into the binary — no rpath
    // needed. Only a dynamic OCCT (e.g. a brew fallback) needs its lib dir on
    // the runtime search path; embed it so the binary runs without
    // DYLD_LIBRARY_PATH/LD_LIBRARY_PATH (macOS SIP strips DYLD_* across
    // protected binaries like nohup).
    let lib = PathBuf::from(format!("{}/lib", occt_prefix()));
    let is_static = lib.join("libTKernel.a").exists();
    if !is_static && lib.exists() {
        println!("cargo:rustc-link-arg=-Wl,-rpath,{}", lib.display());
    }
    println!("cargo:rerun-if-env-changed=OCCT_PREFIX");
}
