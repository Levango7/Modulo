# F-12 第一期：把 AI 配置接到界面上（设计稿）

> 状态：**设计稿，待拍板后才动代码**。决策已定：三期推进 / 对话坞放页面正下方（照 cursor·codex·qoder·trae）/ AI 出口套内网黑名单 /
> `ai-settings.v1` 与 AI 历史暂不进备份、不进同步。本文只覆盖**第一期**。

## 0. 现状是查出来的，不是感觉出来的（2026-10-29，master `a3fce50`）

- **后端整套是现成的**：`src-tauri/src/ai/` 五个文件（keys 147 / openai_compat 364 / history 242 / protocol 200 / settings 61 行），
  10 条命令齐全（providers / chat / chat_cancel / summarize / set_key / delete_key / history_list·get·delete·clear），
  流式走 `Channel<AiChunk>{delta,done,error}`，并发 `Semaphore(2)`、取消走 `CancellationToken` 注册表，
  三档超时已收进 `net-policy.json`（`aiSummarizeMs 120s` / `aiProbeMs 3s` / `aiConnectMs 5s`），
  密钥在 Windows 凭据管理器（service `app.modulo`、account = provider id），配置文档 `ai-settings.v1`，历史在 `ai/history.json`。
  Rust 侧已有 14 条单测（protocol 6 / keys 5 / history 3）。
- **前端一次都没调用过**：`src/` 里 `ai_chat` / `ai_providers` / `ai-settings` 零命中；`DATA_KEYS` 里没有 `ai-settings.v1`。
- **命令是"撤注册"状态**：`src-tauri/src/lib.rs:5-8` 给 `mod ai;` 挂了 `#[allow(dead_code)]`，`:387-388` 一行注释写明
  "撤下的未接线注册（F-11②）"，回注册是一行。
- **线上已有一条通向死路的入口**（这是本期的真实动机）：
  `src/vue/components/MinutesDetail.vue:78` 的「摘要」按钮**无条件存在** → 调 `meeting_summarize`
  → `src-tauri/src/meeting/session.rs:227` 内部取第一个 `ready` 的 provider → 一个都没有时回
  「还没有可用的模型服务：请先在 **AI 设置**里配置并测试一个 provider」。
  **而 AI 设置界面根本不存在** —— 用户被指向一个不存在的页面。会议摘要这条能力今天是"看得见、点得着、永远走不通"。
- **命令面门禁**：`scripts/cmd-surface.mjs`（F-11② 加的）钉死「注册面 == 调用点面 == 桩面」三向一致。
  所以本期**只能注册本期真有调用点的命令**，剩下 7 条继续留在撤注册注释里。

## 1. 定位（一句话）

**给已有的 AI 后端装一个"配置入口"，让会议摘要从死路变成可用** —— 本期不做对话、不做历史界面、不做通用摘要。

三期路线（已定）：

| 期 | 内容 | 本期之后用户能做什么 |
|---|---|---|
| **一期（本文）** | 设置新增「实验室」组：provider 增删改 + 密钥 + 测试连接；注册 `ai_providers` / `ai_set_key` / `ai_delete_key`；AI 出口套内网黑名单 | 配好自己的模型服务 → 会议详情里的「摘要」真能出摘要 |
| 二期 | 页面正下方的对话坞（照 cursor·codex·qoder·trae）：常驻输入条 + 展开面板 + `@卡片` 引用 + 历史列表；注册 chat / cancel / history 4~5 条 | 在工作台里随时问 AI，可引用版面里的卡片 |
| 三期 | 通用摘要入口（`ai_summarize` 的 `plain` 档）+ 「AI 历史」作为备份"可选大项"的口径 | 把任意文本/卡片内容丢给 AI 摘要；历史可随包带走 |

## 2. 一期范围

**做**

1. `SETTINGS_GROUPS` 增一组 `lab`（标题「实验室」，`desktopOnly: true`，排在「关于」之前）。
2. 该组内容：provider 列表 + 新增/编辑/删除 + 每条的「测试连接」+ 密钥（保存/删除，永不回显）。
3. `ai-settings.v1` 登记进 `DATA_KEYS`（理由见 §4）。
4. 回注册 3 条命令：`ai_providers`、`ai_set_key`、`ai_delete_key`。
5. AI 出口的地址判据补「保留网段 / 内网名」黑名单（`validate_base_url`，localhost 显式白名单），配 Rust 单测；
   `net-policy.json` 补一条注记说明「AI 出口走 Rust reqwest、不经 webview CSP」这个豁免事实。
6. 会议摘要的未配置文案改成指向真实入口：「设置 → 实验室 → AI」。
7. 纯判定抽成 `src/vue/aiSettings.ts`（进受测层、分支锁 100）。

**不做**（本期明确不碰）

- 对话、流式、取消、历史界面 —— 二期；`ai_summarize` 的通用入口 —— 三期。
- 备份/同步口径变更 —— 决策已是「暂不进」，本期的登记**只影响启动 hydrate，不影响备份与同步**（见 §4）。
- 不引任何新依赖；不新增卡片类型（注册表仍 55 种）。

## 3. 交互与线框

```
设置 ▸ 实验室                                        [桌面版才有这一组]
┌──────────────────────────────────────────────────────────────┐
│ 模型服务（OpenAI 兼容 / Ollama）                              │
│                                                              │
│  ① 本机 Ollama            ollama        ● 可用    [测试] [编辑] │
│     http://localhost:11434 · qwen2.5:7b      密钥：不需要      │
│                                                              │
│  ② 公司网关               openai-compatible  ○ 未测试  [测试] │
│     https://ai.example.com/v1 · gpt-4o-mini  密钥：已配置 [改] │
│                                                              │
│  [+ 添加模型服务]                                             │
└──────────────────────────────────────────────────────────────┘
```

**空态**（一个 provider 都没有时）：

> 还没有模型服务。填入一个 **OpenAI 兼容**的服务地址（或本机 Ollama 的地址），密钥只存在本机凭据管理器里。
> 配好之后，会议详情里的「摘要」就能用了。 　[+ 添加模型服务]

**编辑表单**（就地展开，不弹二级窗）

| 字段 | 控件 | 规则 |
|---|---|---|
| 名称 | 文本 | 可空；空则用地址里的主机名显示 |
| 类型 | 二选一 | `openai-compatible` / `ollama`（与 Rust 契约枚举同名） |
| 服务地址 | 文本 | `https://…`；或 `http://` 仅限 `localhost` / `127.0.0.1`（与 Rust 判据同一张表，见 §4） |
| 模型 | 文本 | 必填（如 `gpt-4o-mini`、`qwen2.5:7b`） |
| 密钥 | password | 可空（本地 Ollama 通常不需要）；填了就存进凭据库；**存完输入框立刻清空** |
| 按钮 | — | [保存并测试] [取消]；已有服务还有 [删除]（二次确认，同时删密钥） |

**状态呈现**

- 每条服务一个状态点：`● 可用` / `○ 未测试` / `✕ 连不上（原因）`。
  状态**不落盘**：它是一次探测的结果，重启后回到「未测试」，不假装记得。
- 测试中按钮显示「测试中…」并禁用该条；超时/失败把人话原因摆在行内（不弹全局红条 —— 这是这一条的局部状态）。

## 4. 数据、契约与读盘策略

**存储与单一真源**

- 配置文档：`ai-settings.v1`（`data/ai-settings.v1.json`，Rust 的 `safe_name` 白名单允许连字符，实测合法）。
  schema 与 `src-tauri/src/ai/settings.rs` 的 `ProviderCfg` 逐一对应：
  `{ providers: [{ id, kind, baseUrl, model }] }`。
- **密钥永不进这份文档**（AC-09）：只在凭据管理器，`ai_providers` 只回 `keyConfigured` 布尔。
- `id`：前端生成，`p-<36 进制毫秒>`，要求非空且在同文档内唯一（Rust 只按 id 查找，不做格式校验）。
- **登记 `DATA_KEYS`**：这一条不是可选项。`createFileStorage.get()` 读的是启动时 `hydrateData` 灌进内存的镜像，
  镜像只装 `DATA_KEYS` 里的键 —— 漏登记的症状是"设置页写着三个服务、重启后一个都不见了"
  （F-10 之前踩过的原样坑）。本期 UI 的**列表展示读镜像**，不靠 `ai_providers` 读盘。

**为什么展示读镜像、探测才调 `ai_providers`**

`ai_providers` 的实现是**对每个 provider 顺序发一次 `GET /models`（各 3s 超时）**。
把它挂在面板挂载上，等于"打开设置要等 N×3 秒"。所以：

- 打开面板：只读 `ai-settings.v1` 文档（镜像，零网络）；
- 点「测试连接」：**先确保文档已落盘**（本页保存是即时的），再调 `ai_providers`，取回的那条 `ready` 就是结果；
  失败/超时也如实显示，不猜原因。

**三条命令的调用形状**（Tauri v2 参数是 camelCase）

| 命令 | 调用 | 返回/失败 |
|---|---|---|
| `ai_providers` | `invoke('ai_providers')` | `[{ id, kind, baseUrl, model, keyConfigured, ready }]`；探测失败只是 `ready:false`，不抛 |
| `ai_set_key` | `invoke('ai_set_key', { providerId, key })` | 空密钥拒绝；成功后只返回 `()` |
| `ai_delete_key` | `invoke('ai_delete_key', { providerId })` | 幂等（没存过也算成功） |

**删除一条 provider 的顺序**：先 `ai_delete_key`（幂等），再改文档删条目。
反过来会留下**凭据库孤儿**（钥匙串里永远躺着一条没人再读的密钥）。

**地址判据两侧同一张表**（前端 `aiSettings.ts` 与 Rust `validate_base_url`）

| 输入 | 结果 |
|---|---|
| `https://api.openai.com/v1` | 放行 |
| `https://`（无主机） | 拒：「模型服务地址缺少主机名」 |
| `http://localhost:11434` | 放行（本机） |
| `http://127.0.0.1:8080/v1` | 放行 |
| `http://ai.example.com` | 拒：「明文 http 只允许本机地址（localhost / 127.0.0.1），云端必须用 https」 |
| `ftp://…` / 不带协议 | 拒：「必须以 https:// 或 http:// 开头」 |
| `https://169.254.169.254/` · `https://router.internal/` | 拒（**本期新增**的黑名单，见下） |

前端这份是**给即时反馈**，真值仍是 Rust：两边不一致时以 Rust 的返回文案为准（原样显示）。
两侧共用同一张用例表（各写各的断言，同一组输入 → 同一结论），与仓库对"两侧判据分叉"的既有处置一致。

## 5. 安全边界（本期落的三条）

1. **AI 出口套保留网段/内网名黑名单**（已拍板）：`validate_base_url` 在"https 放行"之前加一道 ——
   host 是 IP 且落在回环/私网/链路本地/保留段，或域名以 `.local` / `.internal` / `.home.arpa` 等结尾，一律拒；
   **`localhost` / `127.0.0.1` 显式白名单放行**（Ollama 就住这儿）。
   代价要说清：**公司自建的内网 https 网关（10.x / 192.168.x）会被挡住** —— 这是有意的取舍（AI 出口等于"把内容发出去"），
   将来真要支持，得做成显式的"我信任这个内网地址"开关，不能默认放行。
2. **密钥不回显**：输入框 `type=password`、保存后立刻清空、列表只显示「已配置」；E2E 扫 localStorage/文档全文断言无密钥明文
   （口径照 `sync.spec.ts` 那三条的"口令不进任何本机存储"）。
3. **`net-policy.json` 补注记**：AI 出站由 Rust 进程发起，不经过 webview 的 `connect-src` —— 写清楚，
   免得后人看到"清单里没有 AI 域名"以为是漏配（本仓对"单源被误解"有过先例）。

## 6. 门禁与连带改动（同一笔里做完，不留尾巴）

| 门禁/受测面 | 要改什么 |
|---|---|
| `scripts/cmd-surface.mjs` | 回注册 3 条 ⇒ `src/` 里必须真有对应 `invoke(...)` 调用点；`tests/e2e/tauri-stub.js` 加 3 个 `case`（桩面 ⊆ 注册面） |
| `vitest.config.ts` | `src/vue/aiSettings.ts` 进 `GATED_VUE_MODULES` + `branches: 100` |
| `tests/e2e/settings-ia.spec.ts` | 「六组」→「七组」（桌面），并补一条"网页版看不到「实验室」"；`desktop-probe.mjs` 里「设置页有六个分组」同步改七 |
| Rust | `protocol.rs` 的黑名单 + 单测；`validate_base_url` 的既有 6 条用例按同一张表扩 |
| 文档 | `docs/ARCHITECTURE.md` 两条 facts 账本行（单测条数/文件数、E2E 条数、覆盖率、JS/CSS、行数）+ 新章节 §12.40；`FUNCTIONAL-SPEC` 的 F-12 现状与"AI 命令面未接线"那两处；`CHANGELOG` 未发布段 |
| 板行 | `docs/AGENT-COORD.md` 一行随本笔（`coord-gate` 按提交判） |

## 7. 验收（写完就能跑的红绿）

**单测**（`tests/vue/aiSettings.test.ts`，目标 ~20 条）

- 地址判据同一张表（上表 7 组输入，逐条断言"放行/具体文案"）；
- provider 增/改/删：id 唯一、删到空、编辑保留 id；
- 密钥状态机：未配置 → 填了 → 已配置；删除密钥后回落未配置；**空密钥不允许保存**；
- 文档序列化：往返一致、缺字段兜底（旧文档没有 `kind` 时默认 `openai-compatible`）。

**Rust 单测**（`protocol.rs`，+N 条）

- 保留网段/内网名逐类拒绝（回环除外）· localhost 白名单放行 · 公网 https 放行 · 无主机/无协议拒绝。

**E2E**（`tests/e2e/ai-settings.spec.ts`，~5 条）

1. 空态文案 + 「添加模型服务」展开表单；
2. 填错地址（`http://ai.example.com`）当场红字，且**没有发出任何 IPC**；
3. 填对（https）→ 保存 → 列表出现该条、状态「未测试」；
4. 点「测试连接」→ stub 回 ready → 状态变「可用」；再点一次 → 回不可用 → 状态变「连不上（原因）」；
5. 密钥：填 → 保存 → 输入框清空、显示「已配置」；**全文扫 localStorage + 文档，不含密钥明文**；点删除 → 回到「未配置」；
6. 会议摘要联动：配置好之后进入会议详情点「摘要」，`meeting_summarize` 真被调用（stub 断言）；未配置时文案指向「设置 → 实验室」。

## 8. 影响面与风险

- **网页版**：无 IPC ⇒ 「实验室」组不存在（`desktopOnly`），网页版仍是五组；不渲染一个点了就报错的表单。
- **设置 IA 又动一次**：上一笔（F-10）才把六组落稳，这期加第七组会连带 2 条 E2E、1 条探针断言 —— 已在 §6 列明。
- **`ai_providers` 的探测成本**：N 个 provider × 3s，且 Rust 侧顺序执行；本期只在用户点「测试」时触发，
  并在按钮上显示"测试中"。若将来 provider 变多，再考虑并发探测。
- **黑名单的副作用**（公司内网网关会被拒）写进 §5 与文档，不让它变成"用户配不上却不知道为什么"。
- **凭据库孤儿**：删除顺序错了会留下密钥；先用 `ai_delete_key` 再改文档。

## 9. 二期预告（只记边界，不展开）

对话坞固定在页面正下方，**默认收起**成一条输入条（约 46px），聚焦展开为浮在画布之上的面板（≤45% 视口），
`Ctrl+J` 唤出、`Esc` 收起，布局编辑 / 浮窗 / 沉浸页一律隐藏；上下文用 `@卡片名` 引用；会话历史走 `ai_history_*`。
二期的门禁代价会在届时的设计稿里单列（会碰现有"1280×800 不用滚"这类高度断言）。
