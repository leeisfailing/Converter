use std::path::{Path, PathBuf};

pub const MAX_PATH_LENGTH: usize = 2048;
pub const MAX_URL_LENGTH: usize = 2048;
pub const MAX_STRING_LENGTH: usize = 4096;

pub fn validate_path(path_str: &str, field_name: &str) -> Result<String, String> {
    validate_no_null_bytes(path_str, field_name)?;
    if path_str.len() > MAX_PATH_LENGTH {
        return Err(format!("{} exceeds maximum length of {}", field_name, MAX_PATH_LENGTH));
    }
    if path_str.trim().is_empty() {
        return Err(format!("{} cannot be empty", field_name));
    }
    Ok(path_str.to_string())
}

pub fn validate_file_exists(path_str: &str, field_name: &str) -> Result<String, String> {
    let validated = validate_path(path_str, field_name)?;
    if !Path::new(&validated).is_file() {
        return Err(format!("File not found: {}", validated));
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

    let blocked_hosts = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "169.254.169.254"];
    if blocked_hosts.contains(&host_str) {
        return Err(format!("URL hostname is not allowed: {}", host_str));
    }

    Ok(url.to_string())
}

pub fn validate_output_dir(dir_str: &str) -> Result<String, String> {
    validate_no_null_bytes(dir_str, "output_dir")?;
    if dir_str.is_empty() {
        return Ok(dir_str.to_string());
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
