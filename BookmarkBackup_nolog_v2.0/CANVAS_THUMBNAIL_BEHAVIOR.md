## Bookmark Canvas 缩略图行为说明（更新版）

### 截图范围（裁剪）

- 只截 `history_html/history.html` 中的 **书签画布主容器**：
  - 使用 `.canvas-main-container`（画布区域 + 自定义滚动条）。
  - 不包含上方的标题文字和右侧三个按钮。
- 通过 `tabs.captureVisibleTab` 获取整页截图，再按该容器的 `getBoundingClientRect()` 裁剪，只保存这一块区域。

---

### 截图时机

#### A. 离开 Canvas / 进入 Canvas

1. **离开 Canvas 视图时**
   - 在 `history.html` 内，从 “Bookmark Canvas” 切换到其他视图时：
     - `switchView()` 中检测到 `previousView === 'canvas' && view !== 'canvas'`。
     - 调用 `requestCanvasThumbnailUpdate('switch-view')`，约 1.5 秒去抖后执行一次 `captureCanvasThumbnail()`。

2. **从任意入口进入 Canvas 视图时**
   - `renderCurrentView()` 的 `case 'canvas'` 完成初始化后：
     - 延迟约 800ms 调用 `captureCanvasThumbnail()`。
   - 触发场景包括：
     - 从左侧菜单切到 Bookmark Canvas；
     - 从主 UI 或其他页面打开 `history.html?view=canvas`；
     - 刷新页面且默认视图为 Canvas。

#### B. 使用过程中的“最后一帧”

1. **有编辑（结构变动）时**
   - 画布结构发生变化并调用 `saveTempNodes()` 时：
     - `saveTempNodes()` 在保存本地 state 后调用 `window.requestCanvasThumbnailUpdate('saveTempNodes')`。
     - `requestCanvasThumbnailUpdate` 进行约 1.5 秒的去抖：同一段编辑过程内多次调用合并为一次，最终执行 `captureCanvasThumbnail()`。
   - 适用操作：
     - 创建 / 删除 / 拖动临时栏目；
     - 创建 / 删除 / 修改 Markdown 节点；
     - 增删改连接线等会改变画布结构的操作。

2. **无编辑，仅滚动查看时：记录滚动位置**
   - 在 Canvas 视图中，用户滚动 `#canvasWorkspace`：
     - 首次进入 Canvas 时，为 `#canvasWorkspace` 绑定一次 `wheel` 事件监听。
     - 每次滚动后，如果约 800ms 内没有继续滚动，则调用 `requestCanvasThumbnailUpdate('scroll')`。
     - `requestCanvasThumbnailUpdate` 再 1.5 秒去抖后执行 `captureCanvasThumbnail()`。
   - 效果：
     - 即使没有编辑操作，只是“查看并滚动”，最终也会打上一针，包含当时的滚动位置。

---

### 主 UI 中的显示方式

- 主 UI（`popup.html`）中的 Bookmark Toolbox 初始化时：
  - 立即从 `chrome.storage.local.bookmarkCanvasThumbnail` 读取最新缩略图。
  - 若存在有效缩略图：
    - 清空占位内容；
    - 插入 `<img>`，设置：
      - `width: 100%; height: 100%`
      - `object-fit: contain`（完整显示整个画布截图，不再二次裁剪）。
  - 若不存在：
    - 显示斜纹占位背景，提示暂无缩略图。

---

### 最近 3 条书签展示区（第二个栏目）

- 容器：`#recentBookmarks`（类名 `recent-bookmarks-list`），展示最新 3 条书签。
- 布局与交互：
  - 内联样式 `overflow-y: hidden`：不再显示纵向滚动条。
  - CSS 中 `.bookmark-item` 增加 `min-height: 28px`：
    - 每个条目高度略增，3 条整体在该区域内更均衡、视觉更饱满。

---

### 截图清理 / 覆盖策略

- 所有截图共用一个键：`bookmarkCanvasThumbnail`。
  - 每次新的截图执行 `storage.local.set({ bookmarkCanvasThumbnail: <dataURL> })`。
  - 旧图会被直接覆盖，仅保留最后一次截图（不保留历史版本）。
- 当用户在 Canvas 中点击“清空临时栏目”（`clearAllTempNodes`）时：
  - 清空本地临时节点和相关状态；
  - 同时调用 `storage.local.remove('bookmarkCanvasThumbnail')`。
  - 主 UI 下次打开时显示占位背景，等待下一次有效截图写入。
