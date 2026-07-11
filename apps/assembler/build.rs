use std::path::PathBuf;
use std::process::Command;

/// Same OCCT discovery as crates/occt-bridge/build.rs (OCCT_PREFIX env → brew).
fn occt_prefix() -> String {
    if let Ok(p) = std::env::var("OCCT_PREFIX") {
        if !p.is_empty() {
            return p;
        }
    }
    // The per-machine static build (apps/assembler/scripts/build-occt.sh).
    if let Some(home) = std::env::var_os("HOME") {
        let cached = std::path::PathBuf::from(home).join(".cache/carbon-occt/8.0.0-p1");
        if cached.join("lib/libTKernel.a").exists() {
            return cached.to_string_lossy().into_owned();
        }
    }
    Command::new("brew")
        .args(["--prefix", "opencascade"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "/opt/homebrew/opt/opencascade".to_string())
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
