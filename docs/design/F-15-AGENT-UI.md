# F-15 Agent 应用形态：对话是主轴，版面是产物

> 目标：把 Modulo 从「带聊天功能的看板」重构为「agent 应用」。
> 范围：P0 布局（纯前端）+ P1a 原生 tool-calling 与结构化事件流（Rust）。
> 用户裁决（11-11）：**默认视图 = 对话**；本次做到 **P0 + P1**。
> 基线：`origin/master` = `bde9521`（v0.8.12 已合入）。

## 〇、不做什么（写在这里是为了防止做着做着变成另一个产品）

1. **不删工作台。** 79 个卡片变体、布局引擎、本地优先是 Modulo 唯一别人没有的东西。
   正确做法是让版面变成 agent 的**产出面板**，不是把它藏起来。
2. **不照抄 ChatGPT 的功能清单。** 每个功能都比别人晚两年；只借布局与交互范式。
3. **不改「动作要用户点头」这条铁律。** AI 永不直接写盘，是产品底线，不因重构放开。
4. **不在 P0 碰 Rust。** P0 纯前端，可单独发布。

## 一、P0：布局重排（纯前端）

### 1.1 目标结构

```
TitleBar
└ shell
  ├ SessionRail            左栏会话（保留现状，含「版面 / 对话」切换项）
  ├ content
  │ ├ AppToolbar           顶栏（保留，按视图裁剪按钮）
  │ └ main.stage
  │   └ view === 'chat' 时为三栏：
  │     ├ 对话流（主轴，占满剩余宽度）
  │     └ ArtifactPanel（右栏，可折叠；视图 = 版面 / 画布 / 堆叠）
  └ ChatDock               仅在 view === 'workbench' 时以浮坞出现
```

**关键改动只有一处语义**：`view` 的默认值从 `'workbench'` 改为 `'chat'`，
并且在 `'chat'` 视图里把版面塞进右栏 —— 不再有「chat 视图 = 满屏聊天、没有版面」。

### 1.2 右栏产物面板

- 宽度：默认 420px，可拖拽调宽（min 320 / max 720），可折叠为 0；状态持久化。
- 内容：复用现有 `GridLayout` / `CanvasEditor` / `StackEditor`，顶部一个三选一的分段控件。
- 窄屏（< 1100px）：右栏默认折叠，改为底部弹出层（复用浮坞的展开逻辑）。
- 折叠时对话区满宽；展开时对话区不重排到不可读（最小 480px）。

### 1.3 输入框常驻

- 位置：对话区底部固定（现状 `composer` 已在 ChatDock 内，需保证在 `full` 模式下贴底）。
- 控件行保留现有：模型、思考档位、附件、@ 引用（卡片 / 资料 / 技能）。
- 新增：**工具开关**（本轮只做占位开关 + 说明，真正生效在 P1a）；不做点了没反应的假按钮，
  若 P1a 未合入则此开关**不显示**。

### 1.4 空态（新对话）

首次进入无消息时给出三条建议能力，点击即填入输入框（不自动发送）：

- 「看看我的版面，今天该干什么」
- 「把这段会议记录整理成待办」
- 「记住：我偏好四象限」

文案取自已实现的能力（`context.read` / `todo.add` / `memory.add`），**不许写还没做的功能**。

### 1.5 执行时间线

现有数据已够：`ChatTurn.actions` / `actionsState` / `actionsNote` / 工具结果小条（`data-chat-tool-note`）。

- 把「提议块 → 照做 → 结果」这条链渲染成一条**纵向时间线**：每一步一行，带状态点
  （待确认 / 执行中 / 成功 / 失败 / 未执行）。
- 不在 P0 引入新的数据源；P1a 的结构化事件到位后再把「正在调哪个工具」接上。

### 1.6 P0 验收

- 冷启动直接是对话视图，右栏能看到版面；折叠右栏后对话满宽。
- 浮坞在 `workbench` 视图仍可用（老行为不回归）。
- 现有 E2E 全绿（`view` 默认值变化会打到依赖「打开即版面」的用例，逐条修，不许改断言口径）。
- 单测：新增右栏宽度/折叠状态的纯函数用例；不新增对 DOM 的依赖（项目无 jsdom）。

## 二、P1a：原生 tool-calling 与结构化事件流（Rust）

### 2.1 为什么必须做

现状动作走 `@@act {json}` 文字约定，前端 `aiActions.ts` 手写解析。代价：
参数校验全靠手写、无法并行调工具、无法边流边调、模型说得不标准就整行作废。
`src-tauri/src/ai/openai_compat.rs` 的 `ChatRequest` **没有 `tools` 字段**，
`AiChunk` 只有 `{ delta, done, error }` —— 前端拿不到「正在调哪个工具」，时间线画不出来。

### 2.2 事件契约（两端唯一真相，改这里必须同时改 `src-tauri` 与 `src/vue/aiChat.ts`）

Rust 侧 `AiChunk` 改为 tagged union（`#[serde(tag = "t", rename_all = "camelCase")]`）：

```rust
pub enum AiEvent {
    /// 正文增量
    Text { delta: String },
    /// 工具调用开始（模型已给出 name + arguments）
    ToolStart { id: String, name: String, args: serde_json::Value },
    /// 工具调用结束（本地执行完或拒收）
    ToolEnd { id: String, ok: bool, result: Option<String>, error: Option<String> },
    /// agent 循环进入第 n 轮
    Round { n: u32 },
    /// 本轮结束
    Done { reason: DoneReason },   // stop | tool | error
    /// 通道级错误
    Error { message: String },
}
```

TS 侧一一对应，类型定义放 `src/vue/aiChat.ts`，导出 `AiEvent`。

**终止不变量（P1a 定型，不可再改）**：**每条流有且只有一条 `Done`**，错误路径也是 ——
原来是合成一条 `{done:true, error:"…"}`，现在拆成 `{t:"error",message}` + `{t:"done",reason:"error"}`。
前端**必须等 `done` 收尾**，不许靠「最后一帧」判断结束。

**事件顺序（P1a 定型）**：每轮第一条是 `{t:"round",n}`；工具事件在**流收尾时按 index 顺序一次性发**
（`arguments` 是分片的，name + 完整 args 同时可用的时刻只能是收尾）。**已提供工具的 `ToolEnd`
由前端补** —— Rust 没有执行权，也不该有；Rust 只在自己拒收时发 `ToolEnd{ok:false}`，
且拒收前**先发 `ToolStart`**（`ToolEnd` 不带 name，否则时间线上只剩一行没名字的失败）。

**兼容**：桌面端前后端同版本发布，允许直接改字段。但 `tests/e2e/tauri-stub.js`
必须同步产出新形状，且保留对旧 `{ delta, done }` 的容忍（读取端兼容，写入端只写新格式）。

### 2.3 `tools` 请求

- `ChatRequest` 增加 `tools: Option<Vec<ToolSpec>>`，`ToolSpec { name, description, parameters }`
  （JSON Schema，由前端从动作白名单生成后传入，**不在 Rust 里硬编码业务动作**）。
- **两种形状必须分开（P1a 定型）**：IPC 上就是扁平三字段（前端只交这三样）；**出站到服务端时
  必须包成 `{"type":"function","function":{…}}`**。平铺发出去服务端直接 400，功能等于不存在。
- **命令签名多两个可选参数**：`tools: Option<Vec<ToolSpec>>`、`round: Option<u32>`。
  语义按 tauri `deserialize_option`：**键缺失 = `None`（老调用点零改动）；键在但形状不对 = invoke 报错**，
  不许静默降级成缺省。
- 仅在 provider 配置 `supportsTools: true` 时附带；否则退回 `@@act` 文字约定。
  当前 `settings.rs` 尚无这一位 ⇒ **实际语义是「前端不传 tools 就等于不支持」**，
  加 `supportsTools` 要同时改设置面板，留待 P1b。
- **流式解析 `tool_calls` 增量**：`delta.tool_calls[i].function.arguments` 是分片拼接的，
  必须按 `index` 累积；JSON 未闭合前不得解析（半个 JSON 是畸形，不是空参数）。
- 参数校验仍走现有 `aiActions.ts` 的白名单与闸门 —— **Rust 只做搬运，不做业务判断**。

### 2.4 降级与不变量

| 情况 | 行为 |
|---|---|
| provider 不支持 tools | 退回 `@@act`，行为与 v0.8.12 逐字一致 |
| 模型给了未知工具名 | 不执行，回一条 `ToolEnd{ok:false}` + 人话 |
| arguments 分片未闭合 | 不解析，等下一片；流结束仍未闭合 ⇒ `Error` |
| 协议错误 vs 工具失败 | 必须分开（`Error` vs `ToolEnd{ok:false}`），沿用 F4b 的同一条纪律 |

### 2.5 P1a 验收

- Rust：`cargo fmt --check` + `cargo clippy` 零新告警；单元测试覆盖
  ① 分片累积（三片拼成完整 JSON）② 未闭合不解析 ③ 未知工具 ④ 不支持 tools 时退回。
- 前端：`AiEvent` 解析的单测（每个变体 + 畸形输入）。
- 端到端：`tests/e2e/chat-dock.spec.ts` 的桩改新形状后仍绿；新增一条「工具时间线可见」用例。

### 2.6 P1a 落地记录（11-11）

- **落盘**：四个新文件，行数**两种口径都要记**（`docs-check` 的 `fileLineClaims` 逐条核，只写一种口径会被另一个人的写法打红）：

  | 文件 | raw | 不含空行/注释 |
  |---|---|---|
  | `ai/events.rs` | 166 | 120 |
  | `ai/sse.rs` | 163 | 125 |
  | `ai/tools.rs` | **309** | **233** |
  | `ai/request.rs` | 130 | 96 |

  `tools.rs` 的 raw 超出 300，超出部分全是测试表换行与解释性注释 —— **刻意不压**（为凑数字删注释是拿可读性换数字）。
  另：`protocol.rs` 567 → 508（SSE 段拆出，净减 59）；`openai_compat.rs` 373 → 402；`lib.rs` 一行注释。
- **本机编不了 `src-tauri`，根因订正**：不是「缺 Windows SDK」，是**缺 GNU `dlltool.exe`**
  （mingw binutils 未装，msys64 / choco / scoop / LLVM 都没有）。`cargo test --no-run` = **EXIT 101**。
- **纯逻辑的验法（可复现）**：四个文件**逐字复制**到仓外 crate（只依赖 serde / serde_json，
  `Msg` 用桩顶替 `crate::net`），实跑 **18 条全绿**、`cargo clippy` 零告警；`diff` 证明与仓内 IDENTICAL。
  复现：`cp src-tauri/src/ai/{events,tools,request,sse}.rs /f/tmp/p1a-check/src/ai/ && cd /f/tmp/p1a-check && cargo test`。
- **「参数未闭合」反例组 = 表驱动 6 形态**（不是一种）：截断在字符串内、`{"a":`、`{"a":1`、`{oops`、
  裸 `"`、尾部多余字符 `{"a":1}x`。每种断言两件事：报「参数不是完整 JSON」+ 点名是哪个工具。
  **任何一条被兜底成 `{}`，用例立刻红。**
- **变异检验 5/5 全被抓**（仓外副本植入缺陷、跑、还原，跑完 `diff` 确认副本=仓内）：
  M1 参数改回 `.unwrap_or_default()` / M2 未知工具不拒收 / M3 分片覆盖而非拼接 /
  M4 有工具也报 `used=false` / M5 空 arguments 不按 `{}` 收。
- **CI 首验优先看这三处**（`openai_compat.rs` 是唯一没被本机类型检查过的文件）：
  `Option::as_deref` 传参、`'stream` 标签跳出双层循环、`Channel<AiEvent>` 的 `Serialize` 约束。
- **行数遗留**：`openai_compat.rs` 402 行。`ai_summarize` 拆去 `summarize.rs` 的机械搬迁**刻意后置** ——
  本机不可编译的搬运若与 P1a 同批上 CI，红了就分不清是谁的错。

## 三、风险与顺序

1. **`view` 默认值改动会打一片 E2E** —— 先跑全量看红在哪，逐条改前提，不改断言口径。
2. **ChatDock 1279 行**，P0 要拆件（时间线 / composer / 提议块各成子组件），
   遵守 ≤300 行纪律；拆之前先补「改一个不碰另一个」的定点映射用例。
3. **P1a 本机编不了 `src-tauri`**（缺 GNU `dlltool.exe`，见 §2.6）⇒ Rust 腿只有 CI 桌面 job 能验；
   本地只能把纯逻辑文件复制到仓外 crate 跑（P1a 已这样做，18 条全绿）。
4. **P0 与 P1a 并行时**：P0 只碰 `App.vue` / `components/`，P1a 只碰 `src-tauri/`，
   `aiChat.ts` 的类型增量由 P1a 落，P0 不碰该文件 —— 避免同文件互撞。
