## Bookmark Canvas 缩略图行为说明（v1）

### 截图范围

- 只截 `history_html/history.html` 中的 `.canvas-main-container` 区域（书签画布容器）。
- 使用 `tabs.captureVisibleTab` 获取整页图，再按容器的 `getBoundingClientRect()` 裁剪，只保存容器区域。

### 截图时机

1. **离开 Canvas 视图时（方案 A）**
   - 在 `history.html` 内，从 “Bookmark Canvas” 切换到其他视图时：
     - 触发 `switchView()`，检测到 `previousView === 'canvas' && view !== 'canvas'`。
     - 调用 `requestCanvasThumbnailUpdate('switch-view')`，约 1.5 秒后截一次画布容器。

2. **Canvas 内有结构变动时（方案 B）**
   - 画布结构发生变化并调用 `saveTempNodes()` 时：
     - `saveTempNodes()` 在保存本地 state 后调用 `window.requestCanvasThumbnailUpdate('saveTempNodes')`。
     - `requestCanvasThumbnailUpdate` 进行 1.5 秒去抖，同一段编辑过程内合并为一次截图。

3. **在 Canvas 内点击主 UI 时**
   - 如果用户在 Canvas 标签上点击扩展图标打开主 UI：
     - 依赖上面的 A + B 截图机制提前生成缩略图。
     - 主 UI 打开时直接从 `chrome.storage.local.bookmarkCanvasThumbnail` 读取最新图像并立即显示。

### 主 UI 加载行为

- 主 UI（`popup.html`）中的 Bookmark Toolbox 初始化时：
  - 同步读取 `chrome.storage.local.bookmarkCanvasThumbnail`。
  - 若存在有效缩略图：立即渲染图像，不再等待额外延迟。
  - 若不存在：显示固定的斜纹占位背景。

### 截图清理

- 所有截图共用一个键：`bookmarkCanvasThumbnail`，每次新截图覆盖旧图，不保留历史版本。
- 当用户在 Canvas 中点击“清空临时栏目”（`clearAllTempNodes`）时：
  - 除了清空本地临时节点状态外，还调用 `storage.local.remove('bookmarkCanvasThumbnail')`。
  - 主 UI 下次打开时显示占位背景，等待下一次有效截图写入。

