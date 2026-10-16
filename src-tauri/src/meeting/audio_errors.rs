//! meeting/audio_errors.rs —— cpal 错误人话化（300 行纪律拆出）。
//!
//! AC-18 要求：设备占用 / 权限缺失 / 热插拔分别引导，**不崩溃不静默失败**。
//! cpal 的 ErrorKind 是给开发者看的，前端要的是"发生了什么 + 下一步"。
//! 同 ai/protocol.rs 与 capture/preview_errors.rs 的纪律。
//!
//! 变体表取自 cpal 0.18.2 `src/error.rs` 源码实证（0.15→0.18 有过增删，
//! 别凭老版本记忆写：本文件第一版就写错了两个不存在的变体）。

use cpal::Error;

/// 按错误类别给可渲染的人话。未知类别保留原文（宁可啰嗦也不编）
pub fn humanize_cpal_error(e: &Error) -> String {
    use cpal::ErrorKind as K;
    match e.kind() {
        // 麦克风被别的程序独占（会议软件/录音机开着）——让用户去关，不是我们重试
        K::DeviceBusy => "音频设备被其他程序占用，关掉那个程序后重试".to_string(),
        // 系统隐私设置没给麦克风权限
        K::PermissionDenied => {
            "系统未允许访问音频设备，请在系统隐私设置里打开麦克风权限".to_string()
        }
        // 拔了/禁用了/驱动崩了 —— 上层据此提示"设备已断开"
        K::DeviceNotAvailable => "音频设备已断开或被禁用".to_string(),
        // 默认设备路由变了（插了耳机、换了输出）——AC-18 的"音频设备已切换"：
        // 流已由 cpal 自动跟随，上层只需提示，不必重建
        K::DeviceChanged => "音频设备已切换，正在继续采集".to_string(),
        // 配置失效：必须按新配置重建流（上层拿这条去重建）
        K::StreamInvalidated => "音频设备参数已变化，正在重新建立采集".to_string(),
        K::HostUnavailable => "系统音频服务不可用，检查音频设备与驱动".to_string(),
        // 请求 16k 单声道被拒（老设备/独占模式）
        K::UnsupportedConfig => "该音频设备不支持所需的录音格式".to_string(),
        K::UnsupportedOperation => {
            "该音频设备不支持这种用法（比如对麦克风做系统音频采集）".to_string()
        }
        K::InvalidInput => "音频采集参数不合法".to_string(),
        K::ResourceExhausted => "系统音频资源耗尽，关闭其它录音程序再试".to_string(),
        // 抖动：WASAPI 起流头一帧常见（本机探针就是这么报的），**不是故障**，
        // 上层可以忽略，别拿它弹错误框
        K::Xrun => "音频缓冲抖动了一帧，不影响后续采集".to_string(),
        K::RealtimeDenied => "系统未给音频线程实时优先级，可能有轻微延迟".to_string(),
        K::BackendError | K::Other => format!("音频设备出错：{e}"),
        _ => format!("音频设备出错：{e}"),
    }
}
