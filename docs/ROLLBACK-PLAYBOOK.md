# 回滚预案（本仓专用）

这份预案写给「已经合进 master 的东西需要撤回」的时刻。它不是通用模板：里面的提交号、
tag、文件与检查项都是本仓的真实对象，照着做即可。**回滚不是删除历史，是新增一条反向提交**。

## 1. 本仓红线（先读这段，再决定要不要动手）

- **master 不可 force push**。任何 `git push -f origin master`、改写 master 历史的
  `reset --hard` / `rebase` / amend 都禁止，哪怕只差一个提交。master 是唯一发布源，
  改写它会让所有已拉取的仓库与 CI 记录对不上。
- **已发布的 `v*` tag 不可重发、不可移动、不可删除**。tag 是用户升级与 Release 的锚点，
  移动等于对同一版本号换内容。
- **npm 同号不可重发**。已发布的 `0.8.x` 再 `npm publish` 会撞 403；修正只能发新版本号。
- **GitHub Release immutable**。已发布的 Release 资产不能替换；要修就发新 Release。
- **用户数据先备份再动**。回滚涉及存储 schema 时，先在用户机器上 `cp -a` 全量备份
  （含隐藏文件），再考虑降级；不要在用户数据上试错。

## 2. 回滚单位 = squash commit

本仓 PR 以 squash 合入：一个 PR 在 master 上就是一个提交。所以**回滚单位就是那个 squash 提交**，
不是 PR 里的某几个原始提交。

- 每笔 PR 合入后，把 `merge_commit_sha` 记进板行 / 本预案第 7 节案例；没有这个 sha 就没有可执行的回滚单位。
- 标准动作：`git revert --no-edit <sha>`。它新增一条反向提交，**保留原提交**，CI 与审计链完整。
- 不用 `git reset --hard`、不删 commit、不改写已合入的历史 —— 那些动作只在本机「还没推」时成立。
- 多笔 PR 要一起回滚时，按**合入时间逆序** revert（后合入的先撤），避免依赖倒置。
- 如果一笔 squash commit 里混了「该撤的」和「不该撤的」：仍然先整体 revert，再把要留的部分
  用一个新提交补回来。不做部分 revert、不 cherry-pick 原提交冒充。

## 3. pre-squash 提交靠锚 tag 保活

squash 之后，原分支上的那些提交就不再是 master 的祖先；一旦删掉分支，它们只剩 reflog 一线生机。
本仓的做法是**在 squash 之前给分支头打锚 tag**：

- 命名规则：`anchor/<分支名去斜杠>`。例如 `feat/f4c2-mcp-stdio` → `anchor/feat-f4c2-mcp-stdio`。
- 打完必须**确认已推到远端**再考虑删分支：
  `git ls-remote --tags origin refs/tags/anchor/feat-f4c2-mcp-stdio` 要能查到同一个 sha。
- 锚 tag 不是发布 tag（不是 `v*`），它只用于「保活与追责」，不参与版本号。
- 顺序是 **squash → 锚 tag → master 首跑双绿 → 才 `push --delete` 源分支**。
  先删分支再补 tag，等于把可回滚性押在 reflog 上，本仓已经吃过这个亏。

## 4. 标准五步

1. **查 master 真 sha（双通道，502 不算结论）**
   - REST：`GET /repos/{owner}/{repo}/commits?sha=master`，取第一条的 sha；
   - 同时 `git ls-remote origin refs/heads/master`，两处必须对上。
   - 任一通道 502 / 超时都不能当结论：换通道重试，或者等下一轮。**绝不拿本地缓存的 master 当真值** ——
     本地落后一个提交就会 revert 错对象。
2. **查这个提交做了什么、CI 是不是绿的**
   - `git show --stat <sha>` 看改动面；对照板上同时间的登记行确认范围。
   - 看该提交的 CI 检查明细（桌面 job / 前端 job / 发布门禁），确认它不是「本来就没过」的提交。
   - 特别标出涉及存储字段、生成物、策略单源（`net-policy.json`）的改动 —— 这几类回滚有连带。
3. **revert，不 reset**
   - `git revert --no-edit <sha>`；冲突就手工解开后继续 revert，**不要改用 reset**。
   - revert 走自己的 PR，不直接推 master。
4. **重跑门禁**
   - 本地四检：`vue-tsc` / `vitest run` / `build` / `docs:check`（Rust 额外跑 `cargo fmt --check` 与
     `net-policy-check.mjs`、`cmd-surface.mjs`）。
   - PR 上两个 required check 必须**双绿**；只绿一个不算可合。
5. **验证回滚后的行为，不只是「编译过」**
   - 按撤回的那笔功能逐条实测。例：撤回 F4c-2 后，命令面应回到 50 条注册 / 50 调用点，
     `net-policy-check` 断言应回到 52 项，真子进程用例文件不再参与编译，且用户配置
     `modulo.mcp.v1` 仍在、重启后还能读回来。
   - 把实测结果写回 PR 描述，不要只贴一个「CI green」。

## 5. 数据兼容性（回滚最容易伤人眉骨的地方）

- `src/vue/fileStorage.ts:25` 的 `DATA_KEYS` 是**桌面 `get` 的唯一来源**：启动时 hydrate 成内存镜像，
  之后读镜像。少登记一个键的症状不是报错，而是「写下去了、重启看不见」—— 环形 7 份备份会变成
  每次启动重建基线。
- 因此回滚若涉及存储字段：
  - 先确认旧版本能读当前用户数据；不能读就要先做降级迁移或保留双读，**不能直接切旧代码**。
  - 用户数据先 `cp -a` 全量备份（含隐藏文件）再动应用。
- 本仓实例：`modulo.mcp.v1` 通过 `MCP_DOC_KEY` 常量登记在 `fileStorage.ts:99`。
  撤回 MCP 客户端时**不能顺手把这个键从 `DATA_KEYS` 拿掉** —— 那样用户的 server 配置重启即失，
  比功能回退本身更糟。
- 生成物同理：`netPolicy.generated.ts`、`tauri.conf.json` 的 `connect-src` 都由
  `net-policy.json` 单源生成。回滚策略值时必须三侧一起回，并跑 `gen-net-policy.mjs` 复核幂等。

## 6. 验证清单

**合并前（每次 PR）**

- [ ] squash 提交的 sha 已记录；锚 tag 已打且 `git ls-remote --tags` 查得到。
- [ ] PR 的两个 required check 双绿；桌面 job 真跑了 Rust 侧行为，没有「只编译过」。
- [ ] 改动涉及 `DATA_KEYS` / 存储字段时，已写明旧版本能否读新数据。
- [ ] 改动涉及 `net-policy.json` 时，单源 → TS / Rust / CSP 三侧一致（脚本实跑）。
- [ ] 板行状态与产品面同一 commit（铁律 1），没有「代码合了、板还挂着进行中」。

**回滚后（每次 revert PR）**

- [ ] revert 的 sha 与第 2 步双通道查到的 master 真 sha 一致。
- [ ] 本地四检全绿；PR 双 required 全绿。
- [ ] 按功能实测的行为与预期一致（不是只看编译）。
- [ ] 用户数据自测：原有配置重启后仍在、`DATA_KEYS` 没被顺手改坏。
- [ ] 板行已更新，回滚 PR 的单据里写清「撤的是哪一笔、为什么」。
- [ ] 已发布 `v*` / npm 版本 / Release **一个都没动**；修正通过新提交与新版本发布。

## 7. 真实案例（本仓，按时间顺序）

| 顺序 | 事件 | 对象 |
|------|------|------|
| 1 | pre-squash 分支头打锚 tag | `anchor/feat-f4c2-mcp-stdio` → `856d9b7` |
| 2 | PR #309 squash 合入 master | `895caff`（MCP stdio 客户端，懒连接 + 进程表 + 未确认即拒） |
| 3 | master 首跑双绿（CI 前端 + 桌面） | 确认 #309 没有「只编译过」的假绿 |
| 4 | 确认锚 tag 已推，再删源分支 | `git ls-remote --tags origin refs/tags/anchor/feat-f4c2-mcp-stdio` |
| 5 | 后续文档 / 序数修正 | PR #310 → `c6555a5` |

若要撤回 #309：对 `895caff` 执行 `git revert --no-edit 895caff`，而不是去找 `856d9b7` ——
后者是锚 tag 保活的 pre-squash 提交，**不在 master 上**，revert 它不会改变 master 的内容。
锚 tag 的作用是「需要追查/补回时找得到原始提交」，不是回滚入口。

## 8. 不承诺的事（如实写）

- 项目当前**没有灰度 / feature flag 基础设施**。回滚是全量 revert：一旦撤，所有用户同时回到旧行为，
  **不能按用户分批撤回，也不能只撤某个开关**。
- 没有独立的 hotfix 通道；紧急修复仍走 PR → squash → master → 新版本。
- tag / npm / Release 的不可变性意味着「已发布版本里的错误」只能由**更新版本**修正，不能原地改。
- 本预案不保证「任何回滚都能一键完成」：涉及 schema 降级、跨笔耦合的回滚仍需要逐项判断，
  清单只是把必须问的问题列全。
