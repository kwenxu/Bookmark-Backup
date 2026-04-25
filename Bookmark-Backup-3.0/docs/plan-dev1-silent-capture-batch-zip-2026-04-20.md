# dev_1 静默抓取与批处理打包实施计划（2026-04-20）

## 0. 圆桌并行执行状态（2026-04-20）

本轮已通过多 agent 并行审计并落地如下结果：

- 已完成：P1（dev_1 导出链路仅在下载终态 `complete` 计成功）。
- 已完成：P2（`foreground/background` 抓取模式 + 后台最小化专用窗口抓取）。
- 已完成：P2（新增“抓取当前页面”入口，runtime action 为 `dev1CaptureActiveTab`）。
- 已补充：当前页抓取默认“严格当前活动页”，不再默认回退到最近其它标签。
- 已确认：网页快照导出已固定为 MHTML-only，旧 HTML/MD DOM 提取与转换路线已下线。
- 已完成：batch-zip 基础版（支持每 10/20 条 URL 输出一个 ZIP，路径走现有下载通道）。
- 已完成：runState 扩展 `mode/batchSize/batches[]/artifacts[]`，并打通 batch-zip 恢复判定与批次元数据持久化。
- 已移除：旧 HTML/MD 质量改造入口、配置与实时抓取分支，不再进入网页快照链路。

需注意（本轮审计新增）：
- `dev_1` 链路已做下载终态强校验；但项目其它历史下载路径仍存在“未 `complete` 即 success”风险，需单独治理，不属于本次 dev_1 实验最小闭环范围。
- 旧 HTML/MD 方案仅作为历史背景，不再作为当前网页快照验收范围。

## 1. 目标与结论

目标是让用户基本无感地批量抓取页面内容（MHTML），并保证结果可恢复、可核对、可追踪。

关键结论：
- 纯 Chrome 扩展无法做到“完全不可见地打开任意网页并抓取渲染结果”。
- 可以做到“准静默”：不抢焦点、在后台最小化窗口中批量抓取、抓完即关。
- 可以实现“每批 10/20 条 URL 后打一个 ZIP”并通过现有下载通道落盘。

## 2. 用户可见性目标（准静默定义）

用户体验目标：
- 不抢当前操作焦点。
- 抓取过程不在当前活动窗口内插入可见标签。
- 抓取在单独后台窗口执行，窗口 `focused: false`，优先 `state: minimized`。
- 任务结束自动关闭后台窗口与临时标签。

不承诺：
- 完全零可见（浏览器层面仍存在后台窗口/标签实体）。

## 3. 功能范围

### 3.1 抓取来源
- 现有：来自 `current-changes` 的筛选队列。
- 新增：`当前活动页一键抓取`（即使该页不在 current-changes 中）。

### 3.2 导出格式
- 固定支持：`MHTML`。
- `HTML` / `MD` 网页快照导出已下线，不再提供入口或抓取分支。
- 新增导出模式：
  - `single-file`：每页独立文件（现状增强版）。
  - `batch-zip`：每批聚合为一个 zip（如每 20 条一包）。

### 3.3 批处理参数（默认）
- `batchSize`: 20（可选 10/20）。
- `concurrency`: 1（先稳后快，后续可放开到 2）。
- `renderWaitMs`: 1300（沿用，可配置）。
- `loadTimeoutMs`: 45000（沿用，可配置）。

### 3.4 抓取模式设置（新增）
- `foreground`（前台抓取）：
  - 在当前可见窗口执行，适合需要用户先完成登录、滚动触发懒加载、手动展开内容后再抓取。
- `background`（后台抓取，默认）：
  - 在后台最小化窗口执行，不抢焦点，适合批量任务。

配置建议：
- 全局设置：默认模式 `background`。
- 任务级设置：本次任务可临时切换为 `foreground`。
- 结果记录：每条结果行写入 `captureMode` 字段，便于后续统计。

## 4. 核心技术改造

### 4.1 修复 P1：下载完成态再记成功

问题：当前在 `downloads.download` 返回 `downloadId` 后即记录成功，可能出现“状态成功但文件不存在”。

改造：
- 所有导出写入统一走 `downloadDataUrlWithShelfControl` 或等价封装。
- 统一等待 `downloads.onChanged` 终态（`complete`/`interrupted`）。
- 仅当 `complete` 才把文件记入 `row.files`；`interrupted/timeout` 记入 `row.errors`。
- 失败项目保留可恢复状态，`resume` 只重试失败/未完成项。

验收：
- 人工中断下载时，结果行状态应为 `partial/error`，不得为 `success`。

### 4.2 修复 P2：准静默后台窗口执行

问题：`tabs.create({ active:false })` 会在当前窗口标签栏出现闪动标签。

改造：
- 新增 `ensureDev1CaptureWindow()`：
  - 若不存在专用窗口：`windows.create({ focused:false, state:'minimized' })`。
  - 在该窗口内创建抓取标签页并复用窗口生命周期。
- 抓取完成后清理标签；整批完成后关闭专用窗口。
- 任务中断（service worker suspend/restart）时记录窗口与标签上下文并清理残留。

验收：
- 用户当前工作窗口不出现抓取标签。
- 抓取过程中焦点不被切换。

### 4.3 修复 P2：当前页直抓入口

问题：当前仅支持 `current-changes` 队列，无法一键抓当前活动页。

改造：
- 新增 runtime action：`dev1CaptureActiveTab`。
- 新增 UI 按钮：`抓取当前页面`（支持 MHTML + single-file/batch-zip）。
- 当前页抓取可与批处理共用同一执行与结果状态模型。

验收：
- 当前页不在 current-changes 时，仍可独立抓取并产出文件。

### 4.4 批处理 ZIP（每 10/20 条一包）

方案：
- 引入 ZIP 库（建议 JSZip），在 service worker 中聚合每页产物：
  - 文件命名保留现有 `index_host_title.ext` 规则。
  - 包内目录建议：`/mhtml`。
- 到达 `batchSize` 或队列结束时 `generateAsync({ type:'blob' })` 下载一个 zip。
- 记录批次元信息（批次序号、含哪些 URL、失败项清单）到 runState。

产物示例：
- `dev_1_2026-04-20_001.zip`（1-20）
- `dev_1_2026-04-20_002.zip`（21-40）

验收：
- 21 条队列在 `batchSize=20` 下产出 2 个 zip（20 + 1）。
- zip 内文件数量与成功记录一致。

## 5. 状态模型与恢复策略

runState 已实现字段：
- `mode`: `single-file | batch-zip`
- `batchSize`
- `captureWindowId`
- `batches[]`: 每批状态（pending/running/completed/failed）、文件名、统计
- `artifacts[]`: 最终落盘产物清单（含 downloadId/terminalState）

恢复策略：
- service worker 重启后将 `running` 标记为 `interrupted`（保留现状）。
- `resume` 时：
  - single-file：仅重跑失败/未完成 URL。
  - batch-zip：基于 `batches[]` 与行状态重建失败批次/未封口批次，已完成批次不重复构建。

## 6. UI/交互改动

`dev_1` 视图新增：
- 导出模式选择：`单文件` / `批量 ZIP`
- 批大小选择：`10` / `20`
- 当前页抓取按钮：`抓取当前页面`
- 后台运行信息：
  - 当前批次
  - 已完成 URL / 总数
  - 已产出包数

提示文案：
- 明确“准静默（后台最小化窗口）”而非“完全不可见”。

## 7. 分阶段执行

Phase A（稳定性优先，1-2 天）
- 修复下载终态判定（P1）。
- 新增后台窗口执行模式（P2）。
- 不引入 ZIP，先确保单文件稳定。

Phase B（功能补齐，1 天）
- 增加当前页直抓入口（P2）。
- 补充结果面板与状态字段。

Phase C（效率增强，1-2 天）
- 实现 batch-zip（10/20）。
- 增加批次级恢复与校验。

Phase D（验证与灰度）
- 压测 10/20/50 URL。
- 覆盖超时、下载中断、worker 重启、页面重定向等场景。

## 8. 验收清单

- 任务运行时用户当前窗口无抓取标签闪现。
- 下载失败不会被标记为成功。
- 当前活动页可独立抓取。
- `batchSize=20` 且 URL=21 时，产出两个 zip 且状态准确。
- `resume` 能继续未完成任务，不重复已完成产物。

## 9. 风险与边界

- 某些页面（登录态、反爬、CSP、跨域 iframe）抓取结果与前台可见效果存在差异，属于浏览器安全边界。
- MHTML 体积较大时，zip 生成耗时与内存占用上升，需要批次上限与大小阈值保护。
- service worker 生命周期导致长任务中断风险，必须依赖 runState 恢复机制。

## 10. 当前抓取策略

当前网页快照导出已固定为 MHTML-only：
- 已移除旧 HTML/MD DOM 提取分支；
- 不再提供旧文本导出配置；
- MHTML 直接走 Chrome 官方 `pageCapture.saveAsMHTML` API。

验收标准：
- 导出格式只出现 MHTML；
- single-file 与 batch-zip 都只生成 MHTML 产物；
- 论坛、虚拟滚动、懒加载页面只保证保存抓取瞬间已加载的页面状态，未渲染区域可能空白或缺失。

## 11. 本计划对应现有 Review Findings

- Finding 1（P1）：通过“下载终态判定后记成功”解决。
- Finding 2（P2）：通过“后台最小化专用窗口抓取”降低可见性。
- Finding 3（P2）：通过“当前活动页直抓入口”补齐能力。
