---
title: 网页快照辅助工具悬浮面板增强计划
created: 2026-05-09
scope: Bookmark-Backup Web Snapshot / dev_1 snapshot helper
---

# 网页快照辅助工具悬浮面板增强计划

## 1. 背景

当前「网页快照辅助工具」主要服务于网页快照队列打开的页面，提供：

- 区域截图
- 长截图
- 屏幕录制

后续希望这个悬浮面板成为一个更通用的当前页快照工具：

- 队列模式可以继续使用它。
- 临时模式也可以在用户当前所在页面直接弹出它。
- 不要求刷新当前页面。
- 尽量复用现有后台、下载、MHTML 和辅助工具逻辑，避免大改。

## 2. 目标

在「网页快照辅助工具」悬浮面板标题栏右侧新增两个小按钮：

1. `MHTML` 保存按钮
2. 打开 / 跳转网页快照页按钮

标题栏目标布局示意：

```text
[ 网页快照辅助工具                         MHTML  ↗  −  × ]
```

其中：

- `MHTML` 按钮用于直接保存当前页面 MHTML。
- `↗` 按钮用于跳转或打开扩展的「网页快照」页面。
- `−` 和 `×` 保持现有最小化 / 关闭行为。

## 3. 总体原则

### 3.1 不刷新页面

推荐使用 Chrome 官方扩展能力进行即时注入：

- `chrome.commands`
- `chrome.tabs`
- `chrome.scripting.executeScript`
- `chrome.pageCapture.saveAsMHTML`
- `chrome.downloads.download`

用户按快捷键后，后台只对当前 active tab 临时注入现有辅助工具脚本，不刷新页面，不破坏当前页面状态。

### 3.2 后台轻量占用

后台只在必要时工作：

- 快捷键触发时查询当前活动 tab。
- 注入辅助工具内容脚本。
- 用户点击 `MHTML` 时执行 `pageCapture.saveAsMHTML`。
- 用户点击跳转按钮时打开或激活扩展网页快照页。

不做：

- 常驻注入所有页面。
- 扫描所有 tab。
- 长轮询。
- 自动监听页面内容变化。

### 3.3 面板全局复用

同一套 `dev_1/snapshot_helper_content.js` 悬浮面板需要兼容两种来源：

- 队列模式：由网页快照队列打开页面后注入。
- 临时模式：由用户快捷键在当前页面即时注入。

面板按钮行为根据注入配置中的上下文信息决定。

## 4. UI 计划

## 4.1 `MHTML` 按钮

位置：

- 面板标题右侧。
- 位于跳转按钮左侧。
- 位于现有 `−` / `×` 按钮左侧。

样式：

- 小方框按钮。
- 参考现有标题栏 `−` 和 `×` 按钮。
- 文本直接显示 `MHTML`。
- 宽度略大于普通图标按钮。
- 字号较小，确保标题栏不拥挤。

交互：

- 点击后保存当前 tab 的 MHTML。
- 保存期间可短暂显示处理中状态，例如按钮禁用或标题栏状态提示。
- 成功后可轻提示，例如 `MHTML saved` / `MHTML 已保存`。
- 失败时不弹过度打扰的 alert，优先在面板内提示。

## 4.2 打开网页快照页按钮

位置：

- `MHTML` 按钮右侧。
- `−` 按钮左侧。

图标建议：

- `↗`
- 或 FontAwesome 外链图标

功能：

- 点击后打开或聚焦扩展的网页快照页面。
- 目标页面为：

```text
history_html/history.html?view=dev-1
```

行为：

- 如果已有对应网页快照页，则激活该 tab。
- 如果没有，则新建该 tab。

## 5. 队列模式与临时模式行为

## 5.1 队列模式

队列模式下，辅助工具由网页快照队列打开的页面注入。

配置中应携带：

- 当前页面标题
- 当前 URL
- 队列项信息
- 队列打开来源
- 可选：发起网页快照队列的扩展页面 tabId / windowId
- 当前时间戳目标目录 `snapshotHelperTargetFolder`

按钮行为：

- `MHTML`：保存当前页面 MHTML 到该队列对应的时间戳根目录。
- `打开网页快照页`：优先回到发起队列的扩展页；如果找不到，则打开 `history_html/history.html?view=dev-1`。

## 5.2 临时模式

临时模式下，用户在任意当前页面按快捷键打开悬浮工具。

配置中应携带：

- 当前页面标题
- 当前 URL
- 当前 tabId
- 当前 windowId
- `source: quick_snapshot`
- 临时时间戳目标目录

按钮行为：

- `MHTML`：保存当前页面 MHTML 到新的网页快照时间戳根目录。
- `打开网页快照页`：如果已有网页快照页则激活；否则新建。

临时模式不需要队列序号。

## 6. MHTML 保存路径与命名

## 6.1 路径

继续使用网页快照导出的时间戳根目录：

```text
书签备份/手动导出/网页快照/{YYYYMMDD_HH}/
```

示例：

```text
书签备份/手动导出/网页快照/20260509_01/
```

## 6.2 队列模式文件名

队列模式可沿用现有队列文件名规则。

当前已调整为所有文件平铺到时间戳根目录。

示例：

```text
009_linux.do_页面标题.mhtml
```

## 6.3 临时模式文件名

临时模式不带队列序号。

建议规则：

```text
{host}_{title}_mhtml_{HHmmss}.mhtml
```

示例：

```text
linux.do_LINUX_DO_Mail_开始起航_mhtml_014212.mhtml
```

需要复用现有安全文件名清理函数，避免非法字符和过长文件名。

## 7. 后台能力计划

## 7.1 新增或调整快捷键命令

由于 Chrome 扩展命令数量有限，当前规划保留 4 个命令：

```text
Option/Alt + A  激活扩展
Option/Alt + C  打开当前变化
Option/Alt + H  打开备份历史
Option/Alt + W  当前页网页快照辅助工具
```

第四个命令建议从“打开网页快照页”调整为“当前页网页快照辅助工具”。

原因：

- 打开网页快照页可以通过 POPUP 或历史页导航完成。
- 当前页即时弹出辅助工具更高频、更有价值。

## 7.2 后台命令处理

新增或调整命令：

```text
open_web_snapshot_view
```

新行为：

1. 查询当前 active tab。
2. 判断是否允许注入。
3. 注入：
   - `dev_1/mp4-muxer.js`
   - `dev_1/snapshot_helper_content.js`
4. 调用：

```js
window.__dev1SnapshotHelper.show(config)
```

其中 `config.source` 可设为：

```text
quick_snapshot
```

## 7.3 MHTML 保存消息

新增内容脚本到后台消息，例如：

```text
dev1SnapshotHelperSaveCurrentMhtml
```

后台处理：

1. 读取 sender.tab。
2. 使用 `chrome.pageCapture.saveAsMHTML({ tabId })` 获取 Blob。
3. 生成目标目录。
4. 生成临时模式或队列模式文件名。
5. 使用 `chrome.downloads.download` 保存。
6. 返回保存结果。

返回示例：

```js
{
  success: true,
  filename,
  downloadId
}
```

## 7.4 打开网页快照页消息

新增内容脚本到后台消息，例如：

```text
dev1OpenWebSnapshotPage
```

后台处理：

1. 优先根据 config 中的扩展页 tabId/windowId 聚焦原页面。
2. 找不到时查询已打开的 `history_html/history.html?view=dev-1`。
3. 若存在则激活。
4. 若不存在则新建。

## 8. 内容脚本计划

目标文件：

```text
dev_1/snapshot_helper_content.js
```

## 8.1 配置扩展

在 `normalizeConfig` 或等价配置入口中补充：

- `source`
- `existingTabId`
- `originExtensionTabId`
- `originExtensionWindowId`
- `snapshotHelperTargetFolder`
- `quickSnapshot`

## 8.2 标题栏按钮

在 `_renderPanel()` 的标题栏右侧增加：

- `MHTML` 按钮
- 打开网页快照页按钮

按钮 class 建议：

```text
dev1-helper-mhtml
dev1-helper-open-snapshot
```

事件：

- `MHTML` 点击调用 `_saveCurrentMhtml()`。
- 打开按钮点击调用 `_openWebSnapshotPage()`。

## 8.3 状态反馈

可复用面板内状态或轻量提示：

- 保存中
- 保存成功
- 保存失败

避免使用频繁 alert。

## 9. POPUP 与历史页快捷键显示

同步第四个快捷键文案：

旧：

```text
打开网页快照
```

新：

```text
当前页快照工具
```

英文：

```text
Open Quick Snapshot Tool
```

影响文件：

- `popup.html`
- `popup.js`
- `history_html/shortcuts_helpers.js`

## 10. 权限与限制

已有权限中应覆盖主要需求：

- `commands`
- `scripting`
- `tabs`
- `downloads`
- `pageCapture`
- `activeTab`
- `<all_urls>` host permissions

特殊页面限制：

- `chrome://`
- `edge://`
- Chrome Web Store
- 扩展页面
- 浏览器内置页
- 某些 PDF / 受限页面

这些页面无法注入时应显示轻量错误提示。

## 11. 实施阶段

## 阶段 1：MVP

目标：最小可用。

内容：

1. 第四个快捷键改为当前页打开辅助工具。
2. 标题栏新增 `MHTML` 按钮。
3. 标题栏新增打开网页快照页按钮。
4. 实现当前页 MHTML 保存。
5. 实现打开 / 聚焦网页快照页。
6. 更新 POPUP / 历史页快捷键文案。

暂不做：

- HTML DOM 快照按钮。
- 更复杂的队列回跳状态同步。
- 常驻注入。

## 阶段 2：队列上下文增强

目标：队列模式体验更好。

内容：

1. 队列注入时传递发起扩展页 tabId/windowId。
2. 打开网页快照页按钮优先回到发起队列页。
3. MHTML 保存复用队列目标目录和文件名规则。

## 阶段 3：可选 HTML 快照

目标：提供轻量 DOM HTML 保存。

内容：

1. 新增 `HTML` 按钮。
2. 保存 `document.documentElement.outerHTML`。
3. 文件名使用 `{host}_{title}_html_{HHmmss}.html`。

注意：

- HTML 不等价于 MHTML。
- 外部资源不会完整打包。
- 应在 UI 中明确说明。

## 12. 验收标准

MVP 完成后应满足：

1. 用户在普通网页按第四个快捷键后，不刷新页面即可出现辅助工具悬浮窗。
2. 悬浮窗标题右侧显示 `MHTML` 小按钮。
3. 点击 `MHTML` 后，当前页 MHTML 保存到网页快照时间戳根目录。
4. 临时模式文件名不带队列序号。
5. 点击打开网页快照页按钮后，能打开或聚焦扩展的网页快照页面。
6. 队列模式下现有截图、长截图、屏幕录制不受影响。
7. POPUP / 历史页快捷键列表显示新的第四快捷键含义。
8. 特殊页面注入失败时有轻量提示，不导致后台报错循环。

## 13. 风险点

- Chrome 快捷键可能被系统或其他扩展占用，实际快捷键可能为空，需要用户到浏览器快捷键页设置。
- `pageCapture.saveAsMHTML` 对部分页面可能失败。
- 受限页面无法注入内容脚本。
- 当前页临时模式和队列模式共用同一面板，配置字段需要保持兼容，避免破坏现有队列辅助工具。

## 14. 推荐决策

推荐先实现 MVP：

```text
Option/Alt + W -> 当前页弹出网页快照辅助工具
标题栏新增 MHTML + 打开网页快照页按钮
MHTML 保存到时间戳根目录
临时模式文件名不带序号
```

该方案：

- 官方支持。
- 不需要刷新。
- 后台占用轻。
- 改动中小。
- 最大化复用现有辅助工具与导出逻辑。
