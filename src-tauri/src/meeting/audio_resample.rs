//! meeting/audio_resample.rs —— 音频纯函数（300 行纪律拆出，同 shot_geom 手法）。
//!
//! 两个动作：**降混**（多声道 → 单声道）与**重采样**（任意率 → 16kHz）。
//! 主路径是"向 WASAPI 直接要 16k 单声道"（引擎自己转，质量最好），这两个
//! 函数只服务兜底路径——所以别在这里过度投资算法：简单线性插值 + 诚实标注
//! 质量损失（见 audio.rs 模块头）。真要用窗函数 sinc 就引 rubato，另开偏差。

/// 多声道 → 单声道：取各声道均值（不是取左声道——平均能保留中置人声
/// 又不至于让单侧噪声翻倍）
pub fn downmix_to_mono(interleaved: &[f32], channels: usize) -> Vec<f32> {
    if channels == 0 {
        return Vec::new();
    }
    if channels == 1 {
        return interleaved.to_vec();
    }
    interleaved
        .chunks_exact(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect()
}

/// 线性插值重采样。输入/输出均为单声道 f32。
/// 诚实标注：线性插值没有抗混叠滤波，降采样时高频会折回——语音主能量在
/// 4kHz 以下，实际影响有限但**不是零**。要更好的（窗函数 sinc）就引 rubato。
pub fn resample_linear(input: &[f32], src_rate: u32, dst_rate: u32) -> Vec<f32> {
    if src_rate == 0 || dst_rate == 0 || input.is_empty() {
        return Vec::new();
    }
    if src_rate == dst_rate {
        return input.to_vec();
    }
    // 输出长度按比率算（+1 覆盖最后一格的插值起点）
    let ratio = src_rate as f64 / dst_rate as f64;
    let out_len = ((input.len() as f64 / ratio).ceil() as usize).max(1);
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let pos = i as f64 * ratio;
        let left = pos.floor() as usize;
        let frac = (pos - left as f64) as f32;
        let a = input.get(left).copied().unwrap_or(0.0);
        let b = input.get(left + 1).copied().unwrap_or(a);
        out.push(a + (b - a) * frac);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 降混取声道均值() {
        // 交错双声道 [L0,R0,L1,R1]
        assert_eq!(downmix_to_mono(&[1.0, 0.0, 0.5, 0.5], 2), vec![0.5, 0.5]);
        // 单声道原样返回
        assert_eq!(downmix_to_mono(&[1.0, 2.0], 1), vec![1.0, 2.0]);
        // 0 声道不出 NaN
        assert!(downmix_to_mono(&[1.0], 0).is_empty());
    }

    #[test]
    fn 降混丢弃不完整的最后一帧() {
        // 5 个样本 / 2 声道 = 2 帧 + 1 个残样：残样丢（chunks_exact）
        assert_eq!(downmix_to_mono(&[1.0, 1.0, 0.0, 0.0, 9.0], 2), vec![1.0, 0.0]);
    }

    #[test]
    fn 同率重采样是直通() {
        assert_eq!(resample_linear(&[0.1, 0.2, 0.3], 16000, 16000), vec![0.1, 0.2, 0.3]);
    }

    #[test]
    fn 降采样长度按比率算() {
        // 48000 → 16000 是 3:1，48 个样本出 16 个
        let src: Vec<f32> = (0..48).map(|i| i as f32).collect();
        let out = resample_linear(&src, 48000, 16000);
        assert_eq!(out.len(), 16);
        // 首样本对齐（pos=0 取 left=0, frac=0）
        assert_eq!(out[0], 0.0);
        // 第 3 个输出对应 src[9]（pos=9.0）
        assert_eq!(out[3], 9.0);
    }

    #[test]
    fn 升采样也成立() {
        // 16000 → 48000：2 个样本出 6 个
        let out = resample_linear(&[0.0, 3.0], 16000, 48000);
        assert_eq!(out.len(), 6);
        assert_eq!(out[0], 0.0);
        assert_eq!(out[3], 3.0);
    }

    #[test]
    fn 脏输入不炸() {
        assert!(resample_linear(&[], 48000, 16000).is_empty());
        assert!(resample_linear(&[1.0], 0, 16000).is_empty());
        assert!(resample_linear(&[1.0], 48000, 0).is_empty());
    }
}
