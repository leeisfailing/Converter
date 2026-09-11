use std::f64::consts::E;

pub fn normalize(weights: &[f64]) -> Vec<f64> {
    let mut adjusted: Vec<f64> = weights.to_vec();

    if let Some(min_val) = adjusted.iter().cloned().reduce(f64::min) {
        if min_val < 0.0 {
            let shift = -min_val + 1.0;
            for w in &mut adjusted {
                *w += shift;
            }
        }
    }

    let total: f64 = adjusted.iter().sum();
    if total > 0.0 {
        for w in &mut adjusted {
            *w /= total;
        }
    }

    adjusted
}

pub fn scale_range(n: usize, start: f64, end: f64) -> Vec<f64> {
    if n <= 1 {
        return vec![start; n];
    }

    let step = (end - start) / (n - 1) as f64;
    (0..n).map(|i| start + (i as f64) * step).collect()
}

pub fn equal(frames: usize) -> Vec<f64> {
    let val = 1.0 / frames as f64;
    vec![val; frames]
}

pub fn ascending(frames: usize) -> Vec<f64> {
    let raw: Vec<f64> = (1..=frames).map(|i| i as f64).collect();
    normalize(&raw)
}

pub fn descending(frames: usize) -> Vec<f64> {
    let raw: Vec<f64> = (0..frames).map(|i| (frames - i) as f64).collect();
    normalize(&raw)
}

pub fn pyramid(frames: usize) -> Vec<f64> {
    let half = (frames as f64 - 1.0) / 2.0;
    let weights: Vec<f64> = (0..frames)
        .map(|i| half - (i as f64 - half).abs() + 1.0)
        .collect();
    normalize(&weights)
}

pub fn gaussian(
    frames: usize,
    mean: f64,
    stddev: f64,
    bound: (f64, f64),
) -> Result<Vec<f64>, String> {
    if bound.0 == bound.1 {
        return Err("Gaussian bound must have two distinct values".to_string());
    }
    if stddev <= 0.0 || !stddev.is_finite() {
        return Err("Gaussian standard deviation must be a positive number".to_string());
    }
    if !mean.is_finite() {
        return Err("Gaussian mean must be a finite number".to_string());
    }

    let x_vals = scale_range(frames, bound.0, bound.1);
    let denom = 2.0 * stddev * stddev;
    let weights: Vec<f64> = x_vals
        .iter()
        .map(|x| E.powf(-((x - mean).powi(2)) / denom))
        .collect();

    Ok(normalize(&weights))
}

pub fn gaussian_reverse(
    frames: usize,
    mean: f64,
    stddev: f64,
    bound: (f64, f64),
) -> Result<Vec<f64>, String> {
    let mut weights = gaussian(frames, mean, stddev, bound)?;
    weights.reverse();
    Ok(weights)
}

pub fn gaussian_sym(
    frames: usize,
    stddev: f64,
    bound: (f64, f64),
) -> Result<Vec<f64>, String> {
    let max_abs = bound.0.abs().max(bound.1.abs());
    gaussian(frames, 0.0, stddev, (-max_abs, max_abs))
}

pub fn vegas(frames: usize) -> Vec<f64> {
    let weights: Vec<f64> = if frames.is_multiple_of(2) {
        let mut w = Vec::with_capacity(frames);
        w.push(1.0);
        w.extend(std::iter::repeat_n(2.0, frames - 2));
        w.push(1.0);
        w
    } else {
        vec![1.0; frames]
    };
    normalize(&weights)
}

pub fn divide(frames: usize, weights: &[f64]) -> Vec<f64> {
    if weights.is_empty() {
        return vec![0.0; frames];
    }

    let len = weights.len();
    let indices = scale_range(frames, 0.0, (len - 1) as f64);
    let stretched: Vec<f64> = indices
        .iter()
        .map(|idx| {
            let i = (*idx as usize).min(len - 1);
            weights[i]
        })
        .collect();
    normalize(&stretched)
}

pub fn parse_gaussian_bound(json_str: &str) -> Result<(f64, f64), String> {
    let parsed: serde_json::Value =
        serde_json::from_str(json_str).map_err(|e| format!("Failed to parse gaussian bound: {}", e))?;

    if let Some(arr) = parsed.as_array() {
        if arr.len() == 2 {
            let a = arr[0].as_f64().ok_or("First bound value must be a number")?;
            let b = arr[1].as_f64().ok_or("Second bound value must be a number")?;
            return Ok((a, b));
        }
    }

    Err("Gaussian bound must be a JSON array of two numbers".to_string())
}

#[derive(Debug, Clone)]
pub struct WeightPreview {
    pub weights: Vec<f64>,
    pub labels: Vec<String>,
}

pub fn get_weight_preview(
    blur_weighting: &str,
    blur_amount: f64,
    video_fps: f64,
    output_fps: f64,
    gaussian_std_dev: f64,
    gaussian_mean: f64,
    gaussian_bound: &str,
) -> Result<WeightPreview, String> {
    if blur_amount <= 0.0 || video_fps <= 0.0 || output_fps <= 0.0 {
        return Ok(WeightPreview {
            weights: vec![],
            labels: vec![],
        });
    }

    let frame_gap = (video_fps / output_fps).round() as usize;
    let blended_frames = (frame_gap as f64 * blur_amount).round() as usize;

    if blended_frames == 0 {
        return Ok(WeightPreview {
            weights: vec![],
            labels: vec![],
        });
    }

    let weights = match blur_weighting {
        "equal" => equal(blended_frames),
        "ascending" => ascending(blended_frames),
        "descending" => descending(blended_frames),
        "pyramid" => pyramid(blended_frames),
        "gaussian" => {
            let bound = parse_gaussian_bound(gaussian_bound)?;
            gaussian(blended_frames, gaussian_mean, gaussian_std_dev, bound)?
        }
        "gaussian_reverse" => {
            let bound = parse_gaussian_bound(gaussian_bound)?;
            gaussian_reverse(blended_frames, gaussian_mean, gaussian_std_dev, bound)?
        }
        "gaussian_sym" => {
            let bound = parse_gaussian_bound(gaussian_bound)?;
            gaussian_sym(blended_frames, gaussian_std_dev, bound)?
        }
        "vegas" => vegas(blended_frames),
        custom => {
            let custom_weights: Result<Vec<f64>, _> =
                custom.split(',').map(|s| s.trim().parse::<f64>()).collect();
            match custom_weights {
                Ok(cw) => divide(blended_frames, &cw),
                Err(_) => return Err(format!("Invalid custom weighting: {}", custom)),
            }
        }
    };

    let labels: Vec<String> = (0..weights.len()).map(|i| format!("Frame {}", i + 1)).collect();

    Ok(WeightPreview { weights, labels })
}
