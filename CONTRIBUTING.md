# 参与 Modulo

先读这三样，它们是本项目最不肯妥协的部分：

1. `README.md` —— 产品是什么、怎么跑、凭什么不一样
2. `docs/ARCHITECTURE.md` —— 设计定稿**与决策记录**（含被测试逼出来的修正、被推翻的假设）
3. `CHANGELOG.md` —— 每一轮改了什么、为什么、以及**哪些没做到**

## 环境

Windows 上开发需要 Rust 工具链。本机的特殊之处（`rustc` host 是 `x86_64-pc-windows-gnu`、
GNU 工具链在 MSYS2 里而不在 PATH）写在 `docs/ARCHITECTURE.md` §11.1 —— 遇到
「找不到资源编译器 windres」这类报错，先去那里看，不要以为是代码坏了。

```bash
npm ci
npm run verify         # 类型检查 → 单测（含引擎覆盖门禁）→ 构建 → E2E
npm run dev            # 浏览器预览
```

## 提交前

`npm run verify` 必须全绿。CI 的 `verify` job 跑的就是这四步，外加一条 `npm run docs:check`。

几条本项目自己立的规矩，写代码时用得上：

- **引擎层（`packages/engine/src/**`，即 `@levango7/engine` 包）不许 import vue / @tauri，也不许出现 `document` / `window`，更不许用 `../` 往包外伸手。**
  这不是风格偏好，是 `tests/engine-purity.test.ts` 逐文件守着的硬约束 —— 破了它引擎就没法脱离 UI 单测；
  包的构建（`tsconfig.build.json` 里 `lib` 只有 ES2022、不含 DOM）是第二道、更硬的门：真碰 DOM 编译就过不去。
- **验收标准写成测试，不写成文档条目。** 本项目的历史里，§8 的验收判据有两条曾经只停在纸面上，
  谁也没测过；补成可执行的断言之后才算数。
- **夹具要自带，不能蹭默认状态。** 「点一下 X 会变化」这类断言要问一句：这个变化是 X 造成的，
  还是默认状态本来就烂？本项目出过三条 E2E 一直在测「排版排得烂」而不是测「这三个工具有用」。
- **校验函数只测「返回空」等于没测**，必须至少有一条反例证明它咬得动。
  有一条守卫绿了整整一轮，因为它退化成了「什么都不报」。
- **别在没数据前选复杂方案。** 投影的 A1/A2 两条路线是跑完对照实验才定的，A2 出局且不留未用代码。

## 提交信息

用中文，`<type>(<scope>): <一句话>`，例如：

```
fix(engine): findFreeSpot 在空版面时丢失请求 y
docs: 记清覆盖门禁余量只有 1.72 个百分点
ci: 摘掉桌面自检那一步 —— 它在 runner 上量不到任何东西
```

`type` 用 `feat` / `fix` / `docs` / `ci` / `chore` / `refactor` / `test`。
正文写「为什么」，不写「改了什么」—— diff 已经说了改了什么。

## 报 bug 与提 PR

- bug 请附：操作系统与缩放比例、复现步骤、实际 vs 预期。**如果是布局问题，请一并给出容器宽度**
  （顶栏右侧那枚 pill 就写着当前的 `px · 列数`），投影是按容器宽度换档的。
- 涉及视觉/交互的改动，附一张三档视口的图（1440 / 720 / 390）。`scripts/shoot.mjs` 是干这个的。
- 一次 PR 只做一件事。跨三层的重构请拆开 —— 本项目的历史证明过「大杂烩式改动」会让 review 变成形式。

## 发版

### 版本号有七处，别手改

`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、
`src-tauri/tauri.conf.json`、`src/vue/useBackup.ts`（`APP_VERSION`）、`packages/engine/package.json`。

`npm run docs:check` 会把它们逐个读出来比 —— 漏一处它直接报 `✗ 版本号不一致`。
另外两条工具命令：`npm run release:ledger` 校验发布点、`npm run release:ledger:update` 在发版后刷新台账。

**不要用字符串全局替换改版本号。** 出过一次事故：`replace('0.6.0','0.7.0')` 把依赖
`emoji-regex@10.6.0` 也改成了不存在的 `10.7.0`，CI 在 `npm ci` 上 404。锁文件一律按结构定位。

### tag 必须签名

```bash
git tag -s v0.8.0 -m "Modulo 0.8.0"   # 注意 -s，不是 -a
git push origin v0.8.0
```

签名不是仪式，它补的是 ruleset 补不了的那半边：ruleset 保证「tag 不许被改」，但保证不了
「打的时候就是对的」，也不给归属。签名让改指**可检测**、让 tag 有**署名**。

`release-manifest.mjs` 会逐个 `git verify-tag`（公钥就在仓库里，`release-signing-key.pub`），
未签名且不在 `legacyUnsignedTags` 白名单里的 `v*` tag 会让 `verify` job 变红。

### 签名密钥

- 私钥：`~/.ssh/modulo-release-signing`（**没有 passphrase** —— 为让发版构建不卡在交互提示上）
- 公钥：`release-signing-key.pub`（入库，CI 用它验签）
- **同时注册在 GitHub 账号上**：Settings → SSH and GPG keys，类型必须选 **Signing Key**

> ⚠️ 加错成 **Authentication Key** 是很自然的一步错，而且症状很绕：tag 本地验得过、CI 也过，
> 只有 GitHub 页面上一直不显示 Verified，API 给的 `reason` 是 `unknown_key`。
> 更糟的是那把私钥**没有口令**，当认证公钥用等于多了一把可推送凭据 —— 它只该用来签名。
> 验证：`gh api /users/<owner>/ssh_signing_keys` 有内容，`/users/<owner>/keys` 里没有它。

换机器或轮换：重新 `ssh-keygen -t ed25519`，把新公钥替换 `release-signing-key.pub`、
在 GitHub 上换掉 Signing Key，并且**旧 tag 不会因此失效**（各自的签名各自验）。

### 发完版

```bash
npm run release:ledger:update   # 把新发布点写进 release-manifest.json
git add release-manifest.json && git commit     # 这一步不能忘，否则下次 verify 报「台账里没有」
```

发布点现在是三层，改任何一层之前先读 `scripts/release-manifest.mjs` 的文件头：
tag ruleset（禁删/禁改指）、release 资产 immutable（锁字节）、出处台账（让前两层自己也被管）。

## 许可

代码与文档均为 [Apache-2.0](../LICENSE)。往 `src/` 里加代码即视为同意该许可。
