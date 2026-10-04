use std::net::Ipv4Addr;
use std::path::{Component, Path};

pub const MAX_PATH_LENGTH: usize = 2048;
pub const MAX_URL_LENGTH: usize = 2048;

/// Hostnames that are never a valid URL target (compared against domain hosts).
const BLOCKED_HOSTNAMES: [&str; 4] = ["localhost", "0.0.0.0", "::1", "169.254.169.254"];

pub fn validate_path(path_str: &str, field_name: &str) -> Result<String, String> {
    validate_no_null_bytes(path_str, field_name)?;
    if path_str.len() > MAX_PATH_LENGTH {
        return Err(format!("{} exceeds maximum length of {}", field_name, MAX_PATH_LENGTH));
    }
    if path_str.trim().is_empty() {
        return Err(format!("{} cannot be empty", field_name));
    }
    // Reject actual `..` components only, so file names like `clip..mp4`
    // stay valid while `dir/../file` and `../file` are still refused.
    if Path::new(path_str)
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(format!("{} contains invalid path traversal", field_name));
    }
    Ok(path_str.to_string())
}

pub fn validate_file_exists(path_str: &str, field_name: &str) -> Result<String, String> {
    let validated = validate_path(path_str, field_name)?;
    let path = Path::new(&validated);
    if !path.is_file() {
        return Err(format!("File not found: {}", validated));
    }
    if let Ok(metadata) = path.metadata() {
        if metadata.len() > 10 * 1024 * 1024 * 1024 {
            return Err("File exceeds maximum allowed size (10GB)".to_string());
        }
    }
    Ok(validated)
}

pub fn validate_output_path(path_str: &str, field_name: &str) -> Result<String, String> {
    let validated = validate_path(path_str, field_name)?;
    let path = Path::new(&validated);
    let parent = path.parent()
        .ok_or_else(|| format!("Cannot determine parent directory for: {}", validated))?;
    if !parent.is_dir() {
        return Err(format!("Output directory does not exist: {}", parent.display()));
    }
    let file_name = path.file_name()
        .and_then(|f| f.to_str())
        .ok_or_else(|| format!("Invalid filename in: {}", validated))?;
    if file_name.contains('\0') || file_name.contains('\n') || file_name.contains('\r') {
        return Err(format!("{} contains invalid characters", field_name));
    }
    Ok(validated)
}

pub fn validate_url(url: &str) -> Result<String, String> {
    validate_no_null_bytes(url, "url")?;
    if url.len() > MAX_URL_LENGTH {
        return Err(format!("URL exceeds maximum length of {}", MAX_URL_LENGTH));
    }
    let parsed = url::Url::parse(url).map_err(|e| format!("Invalid URL: {}", e))?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(format!("URL scheme must be http or https, got: {}", scheme));
    }
    // `host()` is required here: `host_str()` returns IPv6 addresses with
    // brackets (`[::1]`), which matches neither the name list nor `Ipv6Addr`.
    let host = parsed
        .host()
        .ok_or_else(|| "URL must have a valid hostname".to_string())?;
    let host_str = parsed.host_str().unwrap_or_default().to_string();
    match host {
        url::Host::Domain(domain) => {
            if BLOCKED_HOSTNAMES
                .iter()
                .any(|&blocked| domain.eq_ignore_ascii_case(blocked))
            {
                return Err(format!("URL hostname is not allowed: {}", host_str));
            }
        }
        url::Host::Ipv4(ip) => {
            if let Some(reason) = blocked_ipv4_reason(&ip) {
                return Err(format!("URL hostname resolves to a {}: {}", reason, host_str));
            }
        }
        // `Host::Ipv6` carries an unbracketed `Ipv6Addr`, unlike `host_str()`.
        url::Host::Ipv6(ip) => {
            // IPv4-mapped (`::ffff:a.b.c.d`) and IPv4-compatible (`::a.b.c.d`)
            // forms embed an IPv4 address that must face the same rules.
            if let Some(embedded) = ip.to_ipv4_mapped().or_else(|| ip.to_ipv4()) {
                if let Some(reason) = blocked_ipv4_reason(&embedded) {
                    return Err(format!("URL hostname resolves to a {}: {}", reason, host_str));
                }
            }
            if ip.is_loopback() || ip.is_multicast() || ip.is_unspecified() {
                return Err(format!("URL hostname resolves to a private/reserved IP: {}", host_str));
            }
            // Unique-local addresses: fc00::/7.
            if ip.segments()[0] & 0xfe00 == 0xfc00 {
                return Err(format!("URL hostname resolves to a private/reserved IP: {}", host_str));
            }
            // Link-local addresses: fe80::/10.
            if ip.segments()[0] & 0xffc0 == 0xfe80 {
                return Err(format!("URL hostname resolves to a private/reserved IP: {}", host_str));
            }
        }
    }
    Ok(url.to_string())
}

/// Why an IPv4 address must not be contacted, if any.
fn blocked_ipv4_reason(ip: &Ipv4Addr) -> Option<&'static str> {
    if ip.is_loopback() || ip.is_private() || ip.is_link_local() {
        return Some("private/reserved IP");
    }
    if ip.octets()[0] == 0 {
        return Some("private/reserved IP");
    }
    // RFC 2544 benchmarking network: 198.18.0.0/15.
    if matches!(ip.octets(), [198, 18 | 19, _, _]) {
        return Some("benchmark/reserved IP");
    }
    None
}

pub fn validate_output_dir(dir_str: &str) -> Result<String, String> {
    validate_no_null_bytes(dir_str, "output_dir")?;
    if dir_str.trim().is_empty() {
        return Err("output_dir cannot be empty".to_string());
    }
    if dir_str.len() > MAX_PATH_LENGTH {
        return Err(format!("output_dir exceeds maximum length of {}", MAX_PATH_LENGTH));
    }
    if !Path::new(dir_str).is_dir() {
        return Err(format!("Output directory does not exist: {}", dir_str));
    }
    Ok(dir_str.to_string())
}

pub fn validate_string(value: &str, field_name: &str, max_length: usize) -> Result<String, String> {
    validate_no_null_bytes(value, field_name)?;
    if value.len() > max_length {
        return Err(format!("{} exceeds maximum length of {}", field_name, max_length));
    }
    Ok(value.to_string())
}

pub fn validate_no_null_bytes(value: &str, field_name: &str) -> Result<(), String> {
    if value.contains('\0') {
        return Err(format!("Null bytes not allowed in {}", field_name));
    }
    Ok(())
}

pub fn validate_json_value(value: &serde_json::Value, max_depth: usize) -> Result<(), String> {
    validate_json_depth(value, 0, max_depth)?;
    validate_json_size(value)?;
    Ok(())
}

fn validate_json_depth(value: &serde_json::Value, current_depth: usize, max_depth: usize) -> Result<(), String> {
    if current_depth > max_depth {
        return Err(format!("JSON nesting exceeds maximum depth of {}", max_depth));
    }
    match value {
        serde_json::Value::Object(map) => {
            for (k, v) in map {
                if k.len() > 256 {
                    return Err("JSON key exceeds maximum length".to_string());
                }
                validate_json_depth(v, current_depth + 1, max_depth)?;
            }
        }
        serde_json::Value::Array(arr) => {
            if arr.len() > 1024 {
                return Err("JSON array exceeds maximum length of 1024".to_string());
            }
            for item in arr {
                validate_json_depth(item, current_depth + 1, max_depth)?;
            }
        }
        serde_json::Value::String(s) if s.len() > 65536 => {
            return Err("JSON string exceeds maximum length of 65536".to_string());
        }
        _ => {}
    }
    Ok(())
}

fn estimate_json_size(value: &serde_json::Value) -> usize {
    match value {
        serde_json::Value::Null | serde_json::Value::Bool(_) => 5,
        serde_json::Value::Number(_) => 20,
        serde_json::Value::String(s) => s.len() + 2,
        serde_json::Value::Array(arr) => {
            2 + arr.iter().map(estimate_json_size).sum::<usize>() + arr.len().saturating_sub(1)
        }
        serde_json::Value::Object(map) => {
            let inner: usize = map.iter()
                .map(|(k, v)| k.len() + 2 + 1 + estimate_json_size(v))
                .sum();
            2 + inner + map.len().saturating_sub(1)
        }
    }
}

fn validate_json_size(value: &serde_json::Value) -> Result<(), String> {
    if estimate_json_size(value) > 10 * 1024 * 1024 {
        return Err("JSON value exceeds maximum size (10MB)".to_string());
    }
    Ok(())
}

pub fn validate_ffmpeg_override(override_str: &str) -> Result<(), String> {
    if override_str.is_empty() {
        return Ok(());
    }
    if override_str.len() > 2048 {
        return Err("ffmpeg_override exceeds maximum length".to_string());
    }
    for arg in override_str.split_whitespace() {
        if arg.contains('\0') || arg.contains(';') || arg.contains('&') || arg.contains('|') {
            return Err("ffmpeg_override contains invalid characters".to_string());
        }
    }
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_url_rejects_ipv6_loopback() {
        // `host_str()` yields the bracketed form, which never matched the
        // literal "::1" nor `Ipv6Addr::parse`; `host()` yields V6 directly.
        let err = validate_url("http://[::1]/").unwrap_err();
        assert!(err.contains("private/reserved"), "unexpected error: {err}");
        assert!(validate_url("http://[::1]:8080/admin").is_err());
    }

    #[test]
    fn validate_url_rejects_ipv4_mapped_ipv6_metadata_address() {
        let err = validate_url("http://[::ffff:169.254.169.254]/latest/meta-data/").unwrap_err();
        assert!(err.contains("private/reserved"), "unexpected error: {err}");
        assert!(validate_url("http://[::ffff:127.0.0.1]/").is_err());
        assert!(validate_url("http://[::169.254.169.254]/").is_err());
    }

    #[test]
    fn validate_url_rejects_unique_local_and_link_local_ipv6() {
        assert!(validate_url("http://[fc00::1]/").is_err());
        assert!(validate_url("http://[fd12:3456:789a::1]/").is_err());
        assert!(validate_url("http://[fe80::1]/").is_err());
    }

    #[test]
    fn validate_url_still_rejects_ipv4_and_named_hosts() {
        assert!(validate_url("http://127.0.0.1/").is_err());
        assert!(validate_url("http://0.0.0.0/").is_err());
        assert!(validate_url("http://10.0.0.1/").is_err());
        assert!(validate_url("http://169.254.169.254/").is_err());
        assert!(validate_url("http://198.18.0.1/").is_err());
        assert!(validate_url("http://localhost/").is_err());
        assert!(validate_url("http://example.test/").is_ok());
    }

    #[test]
    fn validate_url_rejects_non_http_schemes() {
        assert!(validate_url("file:///etc/passwd").is_err());
        assert!(validate_url("ftp://example.com/").is_err());
    }

    #[test]
    fn validate_url_accepts_public_https_url() {
        let url = "https://example.com/watch?v=abc123";
        assert_eq!(validate_url(url).unwrap(), url);
    }

    #[test]
    fn validate_path_allows_dots_inside_a_file_name() {
        assert_eq!(validate_path("clip..mp4", "path").unwrap(), "clip..mp4");
        assert_eq!(validate_path("./clip.mp4", "path").unwrap(), "./clip.mp4");
        assert!(validate_path("dir/.../clip.mp4", "path").is_ok());
    }

    #[test]
    fn validate_path_rejects_parent_components() {
        assert!(validate_path("../clip.mp4", "path")
            .unwrap_err()
            .contains("traversal"));
        assert!(validate_path("dir/../clip.mp4", "path").is_err());
        assert!(validate_path("dir/..", "path").is_err());
        assert!(validate_path("..", "path").is_err());
        // Backslash is a separator only on Windows; elsewhere `dir\..\clip`
        // is a single, non-traversal component.
        assert_eq!(validate_path("dir\\..\\clip.mp4", "path").is_ok(), !cfg!(windows));
    }

    #[test]
    fn validate_path_keeps_null_byte_empty_and_length_checks() {
        assert!(validate_path("bad\0name", "path").is_err());
        assert!(validate_path("   ", "path").unwrap_err().contains("empty"));
        assert!(validate_path(&"a".repeat(MAX_PATH_LENGTH + 1), "path").is_err());
    }
}
