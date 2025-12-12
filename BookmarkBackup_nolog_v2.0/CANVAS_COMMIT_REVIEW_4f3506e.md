# Canvas 性能优化 Commit 复查报告（4f3506e）

## 基本信息

- Commit: `4f3506ea39496d8b6cb10fe0edc2d1cc2a7e2f32`
- 变更文件：
  - `BookmarkBackup_nolog_v2.0/background.js`
  - `BookmarkBackup_nolog_v2.0/history_html/bookmark_canvas_module.js`
  - `BookmarkBackup_nolog_v2.0/history_html/history.js`
  - `BookmarkBackup_nolog_v2.0/popup.js`

## 这次优化的核心收益（按影响力排序）

1. **Canvas 永久栏目树懒加载（避免首次进入一次性渲染整棵树）**
   - Canvas 视图下，永久栏目不再递归渲染所有 folder children，而是“展开时再加载 + 分批加载更多”。
   - 直接减少首屏 O(N) DOM 构建、布局、样式计算与事件绑定。

2. **后台书签树快照缓存（减少重复 `bookmarks.getTree()`）**
   - 在 `background.js` 中维护 `BookmarkSnapshotCache`，UI 通过消息 `getBookmarkSnapshot` 读取。
   - `history.js` / `popup.js` 优先走快照，失败再回退直连 `getTree()`。
   - 让“刷新/切视图/重复打开”更接近缓存读取。

3. **Canvas 永久栏目拖拽事件委托（减少每节点绑定）**
   - `bookmark_canvas_module.js` 中把对 `.tree-item` 的逐个 dragstart/dragend 绑定改为容器事件委托。

4. **避免 Canvas 下不必要的全量工作**
   - Canvas 懒加载模式下跳过：
     - 全树 favicon warmup（减少首屏卡顿）
     - 全树 diff 扫描（减少首屏卡顿）
   - 以 `snapshot version` 作为“树未变化”的快速判断，替代昂贵的 JSON 指纹。

## 复查发现的“遗漏/反直觉点”与功能影响

### 1) 事件重复绑定风险（高影响）

**问题描述**

- `history.js` 的 `renderTreeView()` 在 Canvas 模式下存在“尽量不替换 DOM”路径（为了减少“重新加载感”）。
- 在这种路径下仍然会调用 `attachTreeEvents()`，如果内部采用“逐节点 addEventListener”，会在同一批 DOM 上重复绑定，导致：
  - 右键菜单弹多次 / 行为触发多次
  - HTML5 拖拽事件（dragstart/dragover/drop/dragend）重复触发
  - 指针拖拽（pointermove/pointerup）全局监听重复绑定，长期会造成明显卡顿与内存增长

**我做的修复（已落地）**

- `BookmarkBackup_nolog_v2.0/history_html/history.js`
  - 把“左键打开书签”的 `click` 监听合并进 `clickHandler`，避免每次 attach 都新增一个监听器。
  - 右键菜单改为事件委托 + WeakMap 去重（不再对每个 tree-item 单独绑）。
- `BookmarkBackup_nolog_v2.0/history_html/bookmark_tree_drag_drop.js`
  - 给每个 `.tree-item` 增加 `data-drag-events-bound`（实际字段：`dataset.dragEventsBound`）防重复绑定。
- `BookmarkBackup_nolog_v2.0/history_html/pointer_drag.js`
  - 给容器加 `dataset.pointerDragAttached` 防重复绑定。
  - document 全局 pointer 监听只绑定一次（`pointerDragState.globalHandlersAttached`）。

**功能影响评估**

- 不影响功能，属于“把重复绑定变成幂等”的修复。
- 反而能避免一些用户侧偶发的“重复执行”怪问题。

### 2) `renderTreeView()` 空树早退未重置 `isRenderingTree`（中影响）

**问题描述**

- `renderTreeView()` 设置了 `isRenderingTree = true`，但在 `currentTree` 为空时直接 `return`，没有把标志复位。
- 结果：后续任何渲染请求会被“渲染中”挡住，表现为永久栏目不再更新/刷新无效。

**我做的修复（已落地）**

- `BookmarkBackup_nolog_v2.0/history_html/history.js`
  - 空树早退前补 `isRenderingTree = false`，并处理 `pendingRenderRequest`。

### 3) `BookmarkSnapshotCache` 在 tree 为 null 时会重复 rebuild（低到中影响）

**问题描述**

- `ensureFresh()` 的快速返回条件是 `(!stale && tree)`，当 tree 为 `null` 时即使 stale 已清，也会反复重建。
- 正常情况下 `getTree()` 不会为 null，但在异常/权限/运行时错误场景会出现。

**我做的修复（已落地）**

- `BookmarkBackup_nolog_v2.0/background.js`
  - 把快速返回条件改为 `if (!this.stale) return this.tree;`

### 4) Canvas 懒加载模式下，diff 标记与“子树变化提示”会变少（预期变化）

**现象**

- 为了性能，Canvas 永久栏目懒加载模式下：
  - 关闭了全树 diff 扫描与某些 descendant 扫描
  - 因此 Canvas 永久栏目不保证展示完整的变化标记（尤其是“子文件夹下有变化”的灰点提示）

**影响**

- 性能提升明显，但如果用户强依赖 Canvas 里看完整 diff，需要后续做“轻量级 changed-id 集合”方案（不做全树遍历）。

## 额外：懒加载插入节点后的拖拽能力

**问题**

- 永久栏目懒加载会动态插入新的 `.tree-item`。
- 原 HTML5 DnD 拖拽系统是“逐节点绑定”，新插入节点如果不补绑，会无法在树里拖动排序/移动。

**我做的修复（已落地）**

- `BookmarkBackup_nolog_v2.0/history_html/history.js`
  - 在 `loadPermanentFolderChildrenLazy()` 插入节点后调用一次 `attachDragEvents(treeRoot)`；
  - 再配合 `bookmark_tree_drag_drop.js` 的幂等绑定，保证只给“新节点”绑定，不会重复绑旧节点。

## 建议的验证清单（不跑性能面板也能感知）

1. 首次打开「书签画布」：
   - 永久栏目首屏不再“卡住几秒”。
   - 展开文件夹时能加载子项；子项很多时 “加载更多” 工作正常。
2. 永久栏目内交互：
   - 点击文件夹行展开/收起正常。
   - 右键菜单只弹一次且功能正常。
   - 树内拖拽移动/排序正常（包含懒加载后插入的新节点）。
3. Canvas 交互：
   - 从永久栏目拖出到画布创建临时栏目正常（包含懒加载后插入的新节点）。
4. 刷新/重复进入：
   - 刷新后永久栏目不会频繁出现“重新加载感”。

## 备注：本次复查后的新增改动

- 除了 commit `4f3506e` 自身内容，我额外落地了几处“幂等/早退标志复位/懒加载后补绑拖拽”的修复，避免功能回退与隐性掉帧。

