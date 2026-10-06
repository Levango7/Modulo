fn main() {
    tauri_build::build();

    // ---- 为什么测试壳需要单独再链一次资源 ----
    //
    // 症状：本机 `cargo test` 的 lib 测试壳启动即退 0xC0000139
    // （STATUS_ENTRYPOINT_NOT_FOUND）；CI 上同一个命令通过。查下来的链条是：
    //
    //   tauri → muda（托盘/原生菜单）→ windows crate → 静态导入
    //   comctl32.dll 的 TaskDialogIndirect
    //
    // 而 TaskDialogIndirect **只由 comctl32 v6 导出**，System32 里那个 v5 存根不导出。
    // 要让 loader 绑到 v6，唯一途径是应用清单里声明对 Microsoft.Windows.Common-Controls 6 的
    // 依赖 —— SxS 旁加载。comctl32 还是 KnownDLL，往 exe 同目录放一份 v6 是**没用**的
    // （实测拷进去仍然 0xC0000139：KnownDLL 由对象管理器直接映射，绕过常规搜索顺序）。
    //
    // 清单本身一直都在：`tauri-build` 用 `tauri_winres` 生成 `resource.rc`（里面就有
    // `1 24` = RT_MANEST 的那段 assemblyIdentity），并编成 `OUT_DIR/libresource.a`。
    // 但那份资源**只链进了 bin 目标**：
    //     测试壳里搜 "Microsoft.Windows.Common-Controls" -> False
    //     release exe 里搜同样字符串        -> True
    // 所以测试壳缺清单 → 绑到 v5 → 缺入口 → 进程起不来。
    //
    // 修法：把同一份已编好的资源再链给**测试目标**。两个细节都是踩出来的：
    //
    // 1. 用 `-tests` 后缀是关键。不加后缀的 `rustc-link-arg` 会把 bin 一起套用，
    //    而 bin 已经由 embed_resource 用 `-bins` 链过一次（它的输出里能看到
    //    `cargo:rustc-link-arg-bins=...libresource.a`），重复链资源会出重复定义。
    //
    // 2. 必须配 `--whole-archive`。归档里装的是「只有 .rsrc、没有任何符号」的目标文件，
    //    ld 按需解析符号的默认行为**不会把它拉进来** —— 表现为：指令发了、归档里也确实有
    //    那段清单，但测试壳里搜 "Microsoft.Windows.Common-Controls" 仍然是 False。
    #[cfg(target_os = "windows")]
    {
        let lib = std::path::PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"))
            .join("libresource.a");
        // tauri-build 刚编出来的，理论上必然在；不存在就不发指令，让构建照常报错而不是静默
        if lib.exists() {
            println!("cargo:rustc-link-arg={}", lib.display());
        }
    }
}
