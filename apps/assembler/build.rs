use std::process::Command;

/// Same OCCT discovery as occt-bridge/build.rs. Embeds the lib dir as an rpath
/// on the final binary so it runs without DYLD_LIBRARY_PATH/LD_LIBRARY_PATH
/// (macOS SIP strips DYLD_* across protected binaries like nohup).
fn occt_prefix() -> String {
    if let Ok(p) = std::env::var("OCCT_PREFIX") {
        if !p.is_empty() {
            return p;
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
    let occt = occt_prefix();
    println!("cargo:rustc-link-arg=-Wl,-rpath,{occt}/lib");
    println!("cargo:rerun-if-env-changed=OCCT_PREFIX");
}
