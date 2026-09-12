use std::path::{Path, PathBuf};

pub const MAX_PATH_LENGTH: usize = 2048;
pub const MAX_URL_LENGTH: usize = 2048;
pub fn validate_path(path_str: &str, field_name: &str) -> Result<String, String> {
    validate_no_null_bytes(path_str, field_name)?;
    if path_str.len() > MAX_PATH_LENGTH {
        return Err(format!("{} exceeds maximum length of {}", field_name, MAX_PATH_LENGTH));
    }
    if path_str.trim().is_empty() {
        return Err(format!("{} cannot be empty", field_name));
    }
    if path_str.contains("..") {
        return Err(format!("{} contains invalid path traversal", field_name));
    }
    if let Ok(canonicalized) = Path::new(path_str).canonicalize() {
        if let Some(canonical_str) = canonicalized.to_str() {
            if canonical_str.contains("..") {
                return Err(format!("{} contains invalid path traversal after canonicalization", field_name));
            }
        }
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
            return Err(format!("File exceeds maximum allowed size (10GB)"));
        }
    }
    Ok(validated)
}

pub fn validate_output_path(path_str: &str, field_name: &str) -> Result<String, String> {
    let validated = validate_path(path_str, field_name)?;
    let parent = Path::new(&validated)
        .parent()
        .ok_or_else(|| format!("Cannot determine parent directory for: {}", validated))?;
    if !parent.is_dir() {
        return Err(format!("Output directory does not exist: {}", parent.display()));
    }
    let file_name = Path::new(&validated)
        .file_name()
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
    let host_str = parsed
        .host_str()
        .ok_or_else(|| "URL must have a valid hostname".to_string())?;
    let blocked_hosts = ["localhost", "0.0.0.0", "::1", "169.254.169.254"];
    if blocked_hosts.contains(&host_str) {
        return Err(format!("URL hostname is not allowed: {}", host_str));
    }
    if let Ok(ip) = host_str.parse::<std::net::Ipv4Addr>() {
        if ip.is_loopback() || ip.is_private() || ip.is_link_local() {
            return Err(format!("URL hostname resolves to a private/reserved IP: {}", host_str));
        }
        if ip.octets()[0] == 0 {
            return Err(format!("URL hostname resolves to a private/reserved IP: {}", host_str));
        }
        // RFC 2544 benchmarking network: 198.18.0.0/15.
        if matches!(ip.octets(), [198, 18 | 19, _, _]) {
            return Err(format!("URL hostname resolves to a benchmark/reserved IP: {}", host_str));
        }
    }
    if let Ok(ip) = host_str.parse::<std::net::Ipv6Addr>() {
        if ip.is_loopback() || ip.is_multicast() || ip.is_unspecified() {
            return Err(format!("URL hostname resolves to a private/reserved IP: {}", host_str));
        }
    }
    Ok(url.to_string())
}

pub fn validate_output_dir(dir_str: &str) -> Result<String, String> {
    validate_no_null_bytes(dir_str, "output_dir")?;
    if dir_str.trim().is_empty() {
        return Err("output_dir cannot be empty".to_string());
    }
    if dir_str.len() > MAX_PATH_LENGTH {
        return Err(format!("output_dir exceeds maximum length of {}", MAX_PATH_LENGTH));
    }
    let path = PathBuf::from(dir_str);
    if !path.is_dir() {
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
        serde_json::Value::String(s) => {
            if s.len() > 65536 {
                return Err("JSON string exceeds maximum length of 65536".to_string());
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_json_size(value: &serde_json::Value) -> Result<(), String> {
    let size = std::mem::size_of_val(value);
    if size > 10 * 1024 * 1024 {
        return Err("JSON value exceeds maximum size (10MB)".to_string());
    }
    Ok(())
}

pub fn validate_weighting(weighting: &str) -> Result<(), String> {
    const VALID_WEIGHTINGS: &[&str] = &[
        "equal", "ascending", "descending", "pyramid", "gaussian",
        "gaussian_reverse", "gaussian_sym", "vegas",
    ];
    if !VALID_WEIGHTINGS.contains(&weighting) {
        if !weighting.split(',').all(|w| w.trim().parse::<f64>().is_ok()) {
            return Err(format!("Invalid weighting method: {}", weighting));
        }
    }
    Ok(())
}

pub fn validate_gaussian_bound(bound: &str) -> Result<(f64, f64), String> {
    if bound.len() > 64 {
        return Err("Gaussian bound exceeds maximum length".to_string());
    }
    let parsed: serde_json::Value = serde_json::from_str(bound)
        .map_err(|_| format!("Invalid Gaussian bound JSON: {}", bound))?;
    let arr = parsed.as_array()
        .ok_or_else(|| "Gaussian bound must be a JSON array of two numbers".to_string())?;
    if arr.len() != 2 {
        return Err("Gaussian bound must have exactly two values".to_string());
    }
    let a = arr[0].as_f64()
        .ok_or_else(|| "First bound value must be a number".to_string())?;
    let b = arr[1].as_f64()
        .ok_or_else(|| "Second bound value must be a number".to_string())?;
    if !a.is_finite() || !b.is_finite() {
        return Err("Gaussian bound values must be finite".to_string());
    }
    if a == b {
        return Err("Gaussian bound values must be distinct".to_string());
    }
    Ok((a, b))
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
