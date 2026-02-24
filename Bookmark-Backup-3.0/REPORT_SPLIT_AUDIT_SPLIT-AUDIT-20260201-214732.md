# 拆分对照全量报告（ID: SPLIT-AUDIT-20260201-214732）

生成日期：2026-02-01

## 0. 报告目的
对照「原始集成版」与「三拆分项目」的功能与实现细节，确保拆分后的独立插件在其各自功能范围内与原始集成版一致；同时对照指定快照，保证本轮修复在可追溯范围内。

---

## 1. 对照对象与路径
**参考组（原始集成版）**
- `/Users/kk/Downloads/kk/分支_完整_对照组`

**快照（指定 commit）**
- 备份快照：`/Users/kk/Downloads/kk/_compare_snapshots/backup_06f3c9e/BookmarkBackup_nolog_v2.0`（commit 06f3c9e...）
- 画布快照：`/Users/kk/Downloads/kk/_compare_snapshots/canvas_dec29ae`（commit dec29ae...）
- 记录/推荐快照：`/Users/kk/Downloads/kk/_compare_snapshots/record_e39f7d3`（commit e39f7d3...）

**当前三项目（拆分后）**
- 备份项目：`/Users/kk/Downloads/kk/Bookmark-Backup/BookmarkBackup_nolog_v2.0`
- 画布项目：`/Users/kk/Downloads/kk/canvas/Bookmark-Canvas`
- 记录/推荐项目：`/Users/kk/Downloads/kk/record & recommend/Bookmark-Record-Recommend`

---

## 2. 使用工具与方法（完整清单）
**目录级对照**
- `diff -rq`：全量目录差异扫描（参考组 vs 当前；快照 vs 当前）

**语义级对照**
- `difftastic`（`difft`）：核心文件语义差异对照
  - JSON 摘要：`DFT_UNSTABLE=yes difft --display json ...`
  - 关键文件逐个输出：`difft --display inline --color never ...`

**定位/搜索**
- `rg`（ripgrep）：
  - 搜索功能关键词（视图、函数、消息事件）
  - 确认引用与残留

**结构/完整性校验（脚本）**
- Python 脚本：
  - `sendMessage(action)` ↔ `background.onMessage` 对齐检查
  - i18n key 使用 ↔ 定义完整性检查
  - `history.html` 引用资源（CSS/JS）存在性检查
  - JS `import` 路径解析检查
  - `manifest.json` 引用资源存在性检查
  - 文件数量/代码行数统计

**未使用工具（说明）**
- `madge`、`jq`、`web-ext`、`knip`、`eslint`（当前无 Node 工程配置，未启用）

---

## 3. 对照范围与对齐策略
**3.1 功能范围对齐**
- 备份项目：只保留并对齐「当前变化 / 备份历史」相关功能与 UI
- 画布项目：只保留并对齐「书签画布」相关功能与 UI
- 记录/推荐项目：只保留并对齐「书签记录 / 书签推荐 / 点击记录」相关功能与 UI

**3.2 对齐策略**
- 以“参考组”为功能基线，确保拆分后对应视图/模块的 DOM、JS 行为语义一致
- 以“快照”为修复范围基线，确认当前版本的修复全部可追溯
- 拆分后的差异仅允许出现在：
  - 入口/manifest 权限/命令调整
  - 视图剔除（非本项目功能）
  - 标题/文案/导出目录名的必要调整

---

## 4. 对照输出位置（所有工件）
**参考组 ↔ 当前**（目录级差异）
- `/Users/kk/Downloads/kk/_compare_snapshots/_reports/backup_full_diff.txt`
- `/Users/kk/Downloads/kk/_compare_snapshots/_reports/canvas_full_diff.txt`
- `/Users/kk/Downloads/kk/_compare_snapshots/_reports/record_full_diff.txt`

**快照 ↔ 当前**（目录级差异）
- `/Users/kk/Downloads/kk/_compare_snapshots/_reports/backup_snapshot_vs_current.txt`
- `/Users/kk/Downloads/kk/_compare_snapshots/_reports/canvas_snapshot_vs_current.txt`
- `/Users/kk/Downloads/kk/_compare_snapshots/_reports/record_snapshot_vs_current.txt`

**语义对照摘要（JSON）**
- `/Users/kk/Downloads/kk/_compare_snapshots/_reports/backup_current_summary.json`
- `/Users/kk/Downloads/kk/_compare_snapshots/_reports/canvas_current_summary.json`
- `/Users/kk/Downloads/kk/_compare_snapshots/_reports/record_current_summary.json`

**语义对照明细（逐文件）**
- `/Users/kk/Downloads/kk/_compare_snapshots/_reports/*_current__*.diff.txt`
- `/Users/kk/Downloads/kk/_compare_snapshots/_reports/*_snapshot__*.difft.txt`

**关键视图切片语义对照**（用于验证 UI 结构一致性）
- `backup_current__current_changes.difft.txt`
- `backup_current__history.difft.txt`
- `canvas_current__canvas_view.difft.txt`
- `record_current__record_additions.difft.txt`
- `record_current__record_recommend.difft.txt`

---

## 5. 快照对照结论（核心）
快照 ↔ 当前：每个项目仅 4 行差异，集中在：
- `.git` 类型差异
- `allowed_views.js` 已剔除
- `history.html` / `history.js`（修复功能与 i18n 相关）

对应输出：
- `backup_snapshot_vs_current.txt`
- `canvas_snapshot_vs_current.txt`
- `record_snapshot_vs_current.txt`

---

## 6. 全量完整性校验结果（防“少东西”）
**资源引用检查**
- `history.html` 中 `<link>` / `<script>` 引用资源全部存在

**JS import 路径检查**
- 所有 `import` 路径均可解析，无缺失文件

**manifest 资源检查**
- background / popup / icons / web_accessible_resources 均存在

**i18n 使用完整性**
- 3 个项目的所有 `history_html/*.js` 中 `i18n.xxx` 均在 `history.js` 内定义

---

## 7. 修复与对齐（已实施）
**已实施的修复点（功能一致性修复）**
- 删除残留：`history_html/allowed_views.js` 与其脚本引用（3 项目）
- 补齐 i18n 缺失键（快捷键面板、导出提示、错误提示等）
- 修复记录/推荐项目运行报错（`messageListenerRegistered` 与导出 i18n 相关）
- 保持 FaviconCache 相关功能在 3 项目中可用

**修复记录见**
- `/Users/kk/Downloads/kk/_compare_snapshots/_reports/COMPARE_REPORT.md`

---

## 8. 规模与差异统计（用于完整性评估）
**代码行数统计（js/html/css/json）**
- 参考组：145,737 行
- 备份：63,741 行
- 画布：65,576 行
- 记录/推荐：47,042 行

**目录级差异（diff -rq 行数）**
- 参考组 vs 备份：178 行
- 参考组 vs 画布：151 行
- 参考组 vs 记录/推荐：156 行
- 快照 vs 当前：均为 4 行

---

## 9. 结论（功能一致性）
- 书签画布（独立项目）对齐参考组的 Canvas 视图功能
- 书签记录/推荐（独立项目）对齐参考组的 Additions/Recommend 视图功能
- 备份（独立项目）对齐参考组的 Current Changes / Backup History 视图功能

差异仅来自拆分后“功能范围裁剪 + 入口/权限/文案调整”，不属于功能缺失。

---

## 10. 如何复跑（可复现实验流程）
**目录级对照**
- `diff -rq <ref> <current>`
- `diff -rq <snapshot> <current>`

**语义级对照**
- `DFT_UNSTABLE=yes difft --display json <ref> <current> > *_summary.json`
- `difft --display inline --color never <fileA> <fileB> > *.diff.txt`

**完整性检查**
- i18n keys：扫描 `history_html/*.js` 中 `i18n.xxx` 与 `history.js` 定义
- 资源引用：检查 `history.html` 中 link/script 指向
- import 路径：解析所有 `import` 语句目标
- manifest：检查 service_worker / popup / icons / web_accessible_resources

---

## 11. 关联报告
- `/Users/kk/Downloads/kk/_compare_snapshots/_reports/COMPARE_REPORT.md`



## 12. 差异判定（代码文件，仅 .js/.html/.css/.json/.png/.svg/.ico）

**结论**
- 当前三项目「未发现额外新增代码文件」（only_in_cur=0）。
- 缺失文件均为：
  - 拆分后剔除的非本项目功能（如日历/画布/拖拽等）
  - 测试/调试文件（test_*）
  - 说明/引导类文件（如 GitHub token guide）

**备份项目缺失（相对参考组）**
- auto_backup_timer/test-ui.html（测试页面）
- history_html/bookmark_calendar.css/js（书签日历，非备份）
- history_html/browsing_history_calendar.js（点击记录，非备份）
- history_html/bookmark_canvas_module.js + canvas_obsidian_style.css（画布，非备份）
- history_html/multiselect_integration.js（非备份视图）
- history_html/test_*.html（测试）
- test_debug.html（测试）

**画布项目缺失（相对参考组）**
- history_html/bookmark_calendar.css/js（书签日历，非画布）
- history_html/browsing_history_calendar.js（点击记录，非画布）
- history_html/multiselect_integration.js（非画布视图）
- github-token-guide.html/js（备份向导）
- safe_tabs.js（备份 popup 专用）
- history_html/test_*.html / test_debug.html（测试）

**记录/推荐项目缺失（相对参考组）**
- history_html/bookmark_canvas_module.js + canvas_obsidian_style.css（画布，非记录/推荐）
- history_html/bookmark_tree_context_menu.js / bookmark_tree_drag_drop.js / pointer_drag.js（画布/备份树交互）
- history_html/window_marker.html/js（画布窗口标记）
- history_html/multiselect_integration.js（非记录/推荐视图）
- github-token-guide.html/js（备份向导）
- safe_tabs.js（备份 popup 专用）
- history_html/test_*.html / test_debug.html（测试）


## 14. 局部复扫（仅差异文件）

- 复扫时间：2026-02-01T22:09:24
- 复扫范围：仅对 `diff -rq` 标记为 differ 的代码文件进行 difftastic 语义对照（共 49 个文件对）。
- 复扫输出目录：`/Users/kk/Downloads/kk/_compare_snapshots/_reports/rescan/`

**完整性结果**
- i18n 缺失：备份/画布/记录均为 0
- history.html 引用资源缺失：备份/画布/记录均为 0
- JS import 缺失：备份/画布/记录均为 0
- manifest 引用资源缺失：备份/画布/记录均为 0

## 15. 2026-02-01 追加修复（UI一致性）
- `history_html/history.css`：补齐永久栏目/Markdown callout/编辑书签/刷新设置/全局导出表格与切换按钮/范围滑块等缺失样式，恢复与对照组一致的排版与提示
- `history_html/history.css`：补齐 `.jump-to-related-btn` 样式，修复关联跳转按钮对齐与可见性
- `history_html/history.css`：补齐永久栏目书签树连线与图标对齐样式（来自 `canvas_obsidian_style.css` 的共用部分）
- 备注：仅补 CSS，对 JS/HTML 逻辑未做改动


---
## SPLIT-AUDIT-ADDENDUM-20260202-0019
时间：2026-02-02 00:20

工具使用：
- rg / difftastic(difft) / depcruise / madge / knip / eslint(no-unused-vars)
- 扫描输出：/Users/kk/Downloads/kk/_compare_snapshots/_reports/rescan/


对照概览（来自 rescan 汇总）：
# RESCAN_COMPARE_SUMMARY 20260201_235055
Reference: /Users/kk/Downloads/kk/分支_完整_对照组

## backup
project_root: /Users/kk/Downloads/kk/Bookmark-Backup/BookmarkBackup_nolog_v2.0
ref_total: 55  proj_total: 46
missing: 10  extra: 1  modified: 20  same: 25

## canvas
project_root: /Users/kk/Downloads/kk/canvas/Bookmark-Canvas
ref_total: 55  proj_total: 34
missing: 23  extra: 2  modified: 14  same: 18

## record
project_root: /Users/kk/Downloads/kk/record & recommend/Bookmark-Record-Recommend
ref_total: 55  proj_total: 32
missing: 25  extra: 2  modified: 15  same: 15


本轮变更：无代码改动（仅补充扫描/报告）。
注意：knip 在 backup 中提示 github-token-guide.js 未使用，但该文件被 popup 打开（动态窗口），视为误报。

---
## SPLIT-AUDIT-ADDENDUM-20260202-0224
时间：2026-02-02 02:24

本轮复扫（对照组 → 三项目）工具：
- difftastic (difft)
- diffoscope
- diff (diff -rq)
- dependency-cruiser (--no-config)
- knip（无 package.json，记录错误输出）
- madge（无 import 关系时输出为空）

输出目录：
- /Users/kk/Downloads/kk/_compare_snapshots/_reports/rescan_20260202_022054

汇总：
- /Users/kk/Downloads/kk/_compare_snapshots/_reports/rescan_20260202_022054/RESCAN_COMPARE_SUMMARY_20260202_022054.md

注意：
- knip 缺少 package.json：见 rescan 目录内 knip_*.err
- depcruise 使用 --no-config，仅作为“缺失引用”快筛
- diffoscope 报告体积较大（约 20–30MB/项目）

---
## SPLIT-AUDIT-ADDENDUM-20260202-1022
时间：2026-02-02 10:22

修复：
- 书签树懒加载按钮样式缺失（tree-load-more）
  - 来源：对照组 history_html/canvas_obsidian_style.css
  - 迁移到：history_html/history.css（保证当前变化/备份历史树视图样式与对照一致）
  - 文件：/Users/kk/Downloads/kk/Bookmark-Backup/BookmarkBackup_nolog_v2.0/history_html/history.css

---
## SPLIT-AUDIT-ADDENDUM-20260202_103449
时间：2026-02-02 10:35

本轮复扫（对照组 → 三项目）工具：
- diff -rq
- diffoscope
- difftastic (difft)
- dependency-cruiser (depcruise)
- madge
- knip（无 package.json，可能报错）

输出目录：
- /Users/kk/Downloads/kk/_compare_snapshots/_reports/rescan_20260202_103449

汇总：
- /Users/kk/Downloads/kk/_compare_snapshots/_reports/rescan_20260202_103449/RESCAN_COMPARE_SUMMARY_20260202_103449.md

备注：
- depcruise 使用本机路径 /Users/kk/.npm-global/bin/depcruise
- knip 报错输出见 knip_*.err

---
## SPLIT-AUDIT-ADDENDUM-20260202-1301
时间：2026-02-02 13:01

JS 重点对照范围：
- background.js / history_html/history.js / history_html/search/search.js / popup.js
- 模块：bookmark_canvas_module.js（画布）、bookmark_calendar.js 与 browsing_history_calendar.js（记录）

对照方法：
- diff -u + rg 关键词筛选（view/模块/消息/搜索/权限）
- 对照基线：/Users/kk/Downloads/kk/分支_完整_对照组

结论（可保留/无需恢复的差异）：
- 备份项目（当前变化/备份历史）：
  - history.js/search.js 仅保留 current-changes + history 视图；canvas/additions/recommend 全部剔除。
  - background.js/popup.js 移除推荐/追踪/画布相关消息与入口，保留备份相关流程。
  - resetPermanentSectionChangeMarkers 等逻辑从“画布 + 预览”收敛为“仅当前变化预览”。
- 画布项目（书签画布）：
  - history.js 视图收敛为 canvas；新增“自动清除标识”状态与定时逻辑（允许保留）。
  - bookmark_canvas_module.js 增加标识下拉/输入/滚轮阻断/拖拽保护等交互。
  - search.js 仅保留画布搜索模式；background.js/popup.js 移除备份/记录/推荐功能。
- 记录/推荐项目：
  - history.js 视图收敛为 additions + recommend；移除 current-changes/canvas/backup 逻辑。
  - search.js 仅保留 additions/recommend 搜索语义与占位符。
  - bookmark_calendar.js / browsing_history_calendar.js 增加 i18n 容错 + 导出目录命名替换（按用户要求保留）。
  - background.js/popup.js 删除备份/画布流程，保留推荐/追踪相关消息与计算。

待恢复项（JS 层面）：未发现影响目标功能的缺失。当前差异均来自拆分裁剪或画布新增功能（允许差异）。
注：如仍存在 UI 排版问题，主要落在 CSS（history.css / search.css）层，非 JS 逻辑缺失。

---
## SPLIT-AUDIT-ADDENDUM-20260202-1312
时间：2026-02-02 13:12

本轮动作：
- 仅剔除确定残留：backup/background.js 的 storage 初始化字段 bookmarkCanvasThumbnail。

对照复扫报告：
- /Users/kk/Downloads/kk/_compare_snapshots/_reports/RESIDUALS_REPORT_20260202_1305.md

---
## SPLIT-AUDIT-ADDENDUM-20260202-1325
时间：2026-02-02 13:25

剔除决策报告：
- /Users/kk/Downloads/kk/_compare_snapshots/_reports/RESIDUALS_DECISION_20260202_1325.md

---
## SPLIT-AUDIT-ADDENDUM-20260202-1340
时间：2026-02-02 13:40

本轮“全删”执行结果：
- backup：删除 window_marker 标记页与所有入口；删除 marked/obsidian 脚本引用与文件。
- canvas：删除 clearBackupHistoryBtn 相关 CSS。

复扫报告：
- /Users/kk/Downloads/kk/_compare_snapshots/_reports/RESIDUALS_REPORT_20260202_1340.md
