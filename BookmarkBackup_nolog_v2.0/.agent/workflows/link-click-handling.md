---
description: 链接点击事件处理架构 - 书签/超链接/时间捕捉三系统隔离
---

# 链接点击事件处理架构

## ⚠️ 重要：三个独立的点击处理系统

本项目存在**三套独立的链接点击处理系统**，它们互不干扰，各自有独立的"默认打开方式"记忆功能。

| 系统 | 变量 | 适用范围 | 处理位置 |
|-----|------|---------|---------|
| **书签系统** | `defaultOpenMode` | 永久/临时栏目的书签树（`.tree-bookmark-link`） | `history.js` + `bookmark_canvas_module.js` |
| **超链接系统** | `hyperlinkDefaultOpenMode` | 说明框、Markdown卡片内的链接 | `bookmark_tree_context_menu.js` |
| **时间捕捉兜底** | 无记忆 | 其他所有 `target="_blank"` 链接 | `history.js` 全局监听器 |

---

## 📍 关键代码位置

### 1. 书签系统左键处理

- **永久栏目**：`history.js` → `attachTreeEvents()` → `clickHandler`
  - 位置：搜索 `左键点击书签标签，根据默认打开方式打开`
  - 必须处理所有 `defaultOpenMode` 值！

- **临时栏目**：`bookmark_canvas_module.js` → `tempLinkClickHandler`
  - 位置：搜索 `tempLinkClickHandler = (e) =>`
  - ⚠️ 必须与永久栏目保持同步！（曾遗漏 `manual-select` 导致bug）

### 2. 超链接系统

- **右键菜单 + 左键处理**：`bookmark_tree_context_menu.js` → `attachHyperlinkContextMenu()`
  - 位置：搜索 `function attachHyperlinkContextMenu()`
  - 使用 `capture: true`，处理 `.permanent-section-tip`、`.temp-node-description`、`.md-canvas-text` 内的链接

### 3. 全局时间捕捉监听器（兜底）

- **位置**：`history.js` → 搜索 `捕捉 extension 页面内的超链接打开`
- **关键**：此监听器必须**排除**书签和超链接，避免重复处理！

```javascript
// 排除书签链接
if (anchor.classList.contains('tree-bookmark-link')) return;

// 排除超链接区域
if (anchor.closest('.permanent-section-tip, .temp-node-description, .md-canvas-text, ...')) return;
```

---

## 🔧 添加新功能时的检查清单

### 情况A：给书签系统添加新的打开模式

1. [ ] `bookmark_tree_context_menu.js` - 右键菜单action处理 + 菜单项定义
2. [ ] `history.js` - `attachTreeEvents` 中添加 `else if` 分支
3. [ ] `bookmark_canvas_module.js` - `tempLinkClickHandler` 中添加 `else if` 分支
4. [ ] 三处逻辑必须保持一致！

### 情况B：添加新的可点击链接区域

如果新区域的链接需要**自己的处理逻辑**：

1. [ ] 实现新区域的点击处理器
2. [ ] 在 `history.js` 全局监听器中添加**排除条件**（防止重复处理）

### 情况C：添加完全新的第三套链接系统

1. [ ] 新建变量（如 `xxxDefaultOpenMode`）
2. [ ] 实现持久化（`chrome.storage.local`）
3. [ ] 实现右键菜单
4. [ ] 实现左键处理器（使用 `capture: true`）
5. [ ] 在 `history.js` 全局监听器中添加排除条件

---

## 🐛 历史问题记录

### 2024-12-30：书签左键点击无法记忆打开方式

**原因**：commit `2769621f`（时间捕捉功能）添加了全局 `a[target="_blank"]` 监听器，会拦截书签链接，直接用 `openBookmarkNewTab` 打开，绕过了书签专用处理逻辑。

**修复**：在全局监听器中添加排除条件：
- 排除 `.tree-bookmark-link`（书签链接）
- 排除说明框/Markdown卡片区域（超链接）

**教训**：添加全局事件监听器时，必须考虑是否会与现有的专用处理器冲突！

---

## 📝 事件处理优先级

```
事件捕获阶段（capture: true）先执行
      ↓
1. 超链接系统监听器 → 检测到说明框内链接 → 处理并阻止冒泡
2. 全局时间捕捉监听器 → 检测到排除条件 → 跳过
3. 书签系统监听器（冒泡阶段）→ 处理书签链接

结果：每个链接只被处理一次，走正确的系统
```
