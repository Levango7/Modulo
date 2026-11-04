//! meeting/model_trust.rs —— 模型校验和的**出处分级**与「已核未接线」制品。
//!
//! **为什么单独成文件**（同 `asr_errors.rs` 的 300 行纪律）：`asr_models.rs` 管的是
//! 「运行时怎么拿到、怎么验、怎么解」，这里管的是「那个 digest 凭什么可信」。
//! 后者全是**静态判据 + 台账对账**，一行 IO 都没有，混在一起会让人以为分级会改变
//! 下载行为 —— 它不改变：两档都是「不符即丢弃、拒装」。
//!
//! 台账是仓库根的 `model-checksums.json`（机器可读，逐条记出处与实测）。两份真值由
//! 下面 `台账与清单逐条对账` 用例双向钉住：常量改了台账没改 ⇒ 红；台账加了条常量
//! 没有 ⇒ 也红。漂移（上游重新打包 / 上游补出 checksum.txt）由
//! `scripts/model-checksum-check.mjs` 盯，判据与它自己的用例见那边。

use super::asr_models::{Kind, ModelSpec};

/// 说话人**分割**模型的 release tag 照抄上游，别"修"成 recognition —— 拼错了就是 404。
const BASE_SEG: &str =
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models";
/// 说话人**嵌入**模型（上游 tag 就这么拼，少一个 n 就 404）
const BASE_EMB: &str =
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models";

/// 一个 sha256 的**出处**分级 —— R-01「不无校验下载」的分级版。
///
/// 分级不改变运行时行为，改变的是**报错时该往哪查**：
/// - 官方基线不符 ⇒ 传输被截、被网关改写，或我们把另一款文件的行抄错了
///   （这个坑今天真踩过：`checksum.txt` 里 campplus 有三行，`grep -m1 campplus` 抓到的是
///   英文版那行 —— 必须按**完整文件名**对行）；
/// - 自证基线不符 ⇒ 先怀疑上游重新打过包。自证基线是**可推翻**的：上游哪天补出
///   `checksum.txt`，就以它为准并重新拍板。
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Trust {
    /// 上游 release 的 `checksum.txt` 里有这一行，digest 照抄。
    Official { release: &'static str },
    /// 上游没有 `checksum.txt`，digest 由我们自己实测（TOFU）。
    ///
    /// `samples` = 独立传输的次数（台账里 `measurements` 的条数，两边必须相等 ——
    /// 这个数不许自己填好看的），`measured_on` = 最后一次实测日（ISO）。
    SelfAttested {
        release: &'static str,
        samples: u8,
        measured_on: &'static str,
    },
}

impl Trust {
    /// 该去哪个 release 核这一行（漂移门的输入）
    pub fn release(&self) -> &'static str {
        match self {
            Trust::Official { release } | Trust::SelfAttested { release, .. } => release,
        }
    }

    /// 一句人话，进校验失败的报错文案（`asr_errors::verify_mismatch`）
    pub fn label(&self) -> String {
        match self {
            Trust::Official { release } => format!("官方 checksum.txt（release {release}）"),
            Trust::SelfAttested {
                release,
                samples,
                measured_on,
            } => format!(
                "自证基线（{samples} 次独立实测，{measured_on}；release {release} 至今无 checksum.txt）"
            ),
        }
    }
}

/// pyannote 说话人分割（6.9MB 归档）—— **全仓目前唯一的自证基线例外**。
///
/// digest 来自 2026-11-04 两次独立 HTTPS 传输实测（同值，字节数也同），
/// 逐次的 at/machine/tool/bytes 记在台账里。上游该 release 至今没有 `checksum.txt`。
pub const DIAR_SEG: ModelSpec = ModelSpec {
    id: "diar-seg",
    file: "sherpa-onnx-pyannote-segmentation-3-0.tar.bz2",
    base: BASE_SEG,
    sha256: "24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488",
    kind: Kind::Archive,
    trust: Trust::SelfAttested {
        release: "speaker-segmentation-models",
        samples: 2,
        measured_on: "2026-11-04",
    },
};

/// campplus 中英说话人嵌入（28.3MB 单文件）—— 官方 `checksum.txt` 有这一行，
/// 且今天按真下载的字节核过（下载值与那行同值，不是只抄了行没验包）。
pub const DIAR_EMB: ModelSpec = ModelSpec {
    id: "diar-emb",
    file: "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
    base: BASE_EMB,
    sha256: "aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2",
    kind: Kind::Single,
    trust: Trust::Official {
        release: "speaker-recongition-models",
    },
};

/// **已核过出处、还没接线**的两件。D-14b 给引擎装上分割+嵌入时搬进
/// [`crate::meeting::asr_models::all`]。
///
/// 为什么现在就登记进代码而不是只写在文档里：digest 和分级在搬运**之前**就得受门禁看着，
/// 否则 D-14b 会把「凭印象抄的数」直接带进下载清单。不进 `all()` 的后果由
/// `未接线的不进下载清单` 用例钉死 —— 首次运行的下载量因此一分不变。
pub fn pending() -> [ModelSpec; 2] {
    [DIAR_SEG, DIAR_EMB]
}

#[cfg(test)]
mod tests {
    // 模块名只在这里引：放在模块顶层会在**非 test 构建**里变成 unused import，
    // 而 CI 的 clippy 是 `-D warnings`。
    use super::*;
    use crate::meeting::asr_models;

    /// 台账：仓库根的 `model-checksums.json`，编译期内嵌。
    const LEDGER: &str = include_str!("../../../model-checksums.json");

    /// 清单里的全部制品（已接线 + 未接线）—— 对账的作用域。
    ///
    /// 只在用例里用，所以放这儿而不是模块级：模块级私有函数在非 test 构建下是
    /// never used，而 CI 的 clippy 是 `-D warnings`。
    fn registry() -> Vec<ModelSpec> {
        asr_models::all().into_iter().chain(pending()).collect()
    }

    /// 台账 ↔ 常量 双向对账。四条一致才算一条通过：digest、release、wired 归属、分级档位。
    ///
    /// 这条用例是「两份真值」能并存的唯一理由：改了常量忘了台账（或反过来）当场红。
    #[test]
    fn 台账与清单逐条对账() {
        let ledger: serde_json::Value =
            serde_json::from_str(LEDGER).expect("model-checksums.json 读不动 / JSON 坏了");
        let rows = ledger["artifacts"]
            .as_array()
            .expect("artifacts 必须是数组");
        let specs = registry();
        assert_eq!(
            rows.len(),
            specs.len(),
            "台账 {} 条、清单 {} 条 —— 谁加了一边没加另一边",
            rows.len(),
            specs.len()
        );
        for s in &specs {
            let row = rows
                .iter()
                .find(|a| a["file"].as_str() == Some(s.file))
                .unwrap_or_else(|| panic!("台账里没有 `{}` 这条记录", s.file));
            assert_eq!(
                row["sha256"].as_str(),
                Some(s.sha256),
                "{} 的 digest 两份不一致（台账 {} / 常量 {}）",
                s.id,
                &row["sha256"],
                s.sha256
            );
            assert_eq!(
                row["release"].as_str(),
                Some(s.trust.release()),
                "{} 的 release tag 两份不一致",
                s.id
            );
            assert_eq!(
                row["wired"].as_bool(),
                Some(asr_models::all().iter().any(|w| w.id == s.id)),
                "{} 的 wired 与它是否在 all() 里不一致",
                s.id
            );
            match s.trust {
                Trust::Official { .. } => {
                    assert_eq!(
                        row["trust"].as_str(),
                        Some("official-checksum-txt"),
                        "{} 常量说是官方、台账说 {:?}",
                        s.id,
                        row["trust"]
                    );
                }
                Trust::SelfAttested { samples, .. } => {
                    assert_eq!(
                        row["trust"].as_str(),
                        Some("self-attested"),
                        "{} 常量说是自证、台账说 {:?}",
                        s.id,
                        row["trust"]
                    );
                    let m = row["measurements"]
                        .as_array()
                        .unwrap_or_else(|| panic!("{} 自证基线却没有 measurements", s.id));
                    assert_eq!(
                        m.len() as u8,
                        samples,
                        "{} 的 samples={} 与台账实测 {} 次不符",
                        s.id,
                        samples,
                        m.len()
                    );
                    for (i, one) in m.iter().enumerate() {
                        assert_eq!(
                            one["sha256"].as_str(),
                            Some(s.sha256),
                            "{} 第 {} 次实测的 digest 与基线不同 —— 那就不止一次实测的事了",
                            s.id,
                            i + 1
                        );
                    }
                }
            }
        }
        // 反向：台账里不许留孤儿记录（制品换了名/下架，常量删了而台账没删）
        for row in rows {
            let f = row["file"].as_str().unwrap_or_default();
            assert!(
                specs.iter().any(|s| s.file == f),
                "台账里的 `{f}` 在清单里找不到（删了常量忘了删台账？）"
            );
        }
    }

    /// 「未接线」的锁：这两件不许出现在下载清单里，且首次运行的件数一分不涨。
    /// D-14b 接线时这条用例会红 —— 那是**故意的**，逼那一笔同时重测下载量并回写文档。
    #[test]
    fn 未接线的不进下载清单() {
        let wired: Vec<&str> = asr_models::all().iter().map(|s| s.id).collect();
        for s in pending() {
            assert!(
                !wired.contains(&s.id),
                "{} 已经接线，还挂在 pending() 里",
                s.id
            );
        }
        assert_eq!(
            asr_models::all().len(),
            3,
            "下载清单从 3 件变多了 —— 首次运行下载量要重新实测，文档的体积红线也要重算"
        );
    }

    /// 分级里写的 release 必须就是这个 base URL 的 tag —— 防「包挂 A、行抄 B」。
    #[test]
    fn 分级声明的release与base同处一个tag() {
        for s in registry() {
            let want = format!("/download/{}", s.trust.release());
            assert!(
                s.base.ends_with(&want),
                "{} 的 base 是 {}，但分级写的 release 是 {}",
                s.id,
                s.base,
                s.trust.release()
            );
        }
    }

    /// 自证例外必须是**点名可得的一小包**，而不是"以后再说"。
    #[test]
    fn 自证基线全仓只此一件() {
        let sa: Vec<&str> = registry()
            .iter()
            .filter(|s| matches!(s.trust, Trust::SelfAttested { .. }))
            .map(|s| s.file)
            .collect();
        assert_eq!(sa, vec!["sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"]);
        for s in registry() {
            assert!(
                asr_models::is_sha256_hex(s.sha256),
                "{} 的 sha256 不是 64 位 hex",
                s.id
            );
        }
    }

    /// 报错文案要能把人指对方向：官方的点名 release，自证的点名「无权威源 + 实测几次」。
    #[test]
    fn label_两种分级各说各的() {
        let off = DIAR_EMB.trust.label();
        assert!(
            off.contains("官方 checksum.txt") && off.contains("speaker-recongition-models"),
            "{off}"
        );
        let self_att = DIAR_SEG.trust.label();
        for frag in ["自证基线", "2 次", "2026-11-04", "至今无 checksum.txt"] {
            assert!(self_att.contains(frag), "文案缺 `{frag}`：{self_att}");
        }
    }
}
