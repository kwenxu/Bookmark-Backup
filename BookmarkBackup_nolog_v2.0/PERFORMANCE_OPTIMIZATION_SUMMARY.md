# 书签画布滚动与拖动性能优化总结

## 优化日期
2025-11-17

## 问题描述
在书签画布中，进行以下操作时栏目会发生剧烈抖动，不够丝滑：
- 普通的纵向/横向滚动（鼠标滚轮）
- 按住栏目进行拖动
- 按住空格键拖动画布

## 优化策略

### 核心思路
参考 Ctrl 缩放时的优化机制，在滚动/拖动过程中**降低渲染频率**，使用更高效的渲染方式。

### 优化关键点

#### 1. 滚动/拖动状态检测
- 使用 `markScrolling()` 标记正在滚动/拖动
- 使用 150ms 延迟检测停止：`scrollStopTimer`
- 停止后调用 `onScrollStop()` 进行完整更新

#### 2. 极速平移模式
在滚动/拖动过程中使用 `applyPanOffsetFast()`：
```javascript
function applyPanOffsetFast() {
    const content = getCachedContent();
    const scale = CanvasState.zoom;
    const translateX = CanvasState.panOffsetX / scale;
    const translateY = CanvasState.panOffsetY / scale;
    // 直接使用 transform + translate3d 硬件加速
    content.style.transform = `scale(${scale}) translate3d(${translateX}px, ${translateY}px, 0)`;
}
```

**优势：**
- 跳过边界计算（`clampPan`）
- 跳过滚动条更新
- 跳过休眠管理
- 使用 `translate3d` 启用 GPU 硬件加速
- 只触发浏览器的**合成层**，不触发布局和绘制

#### 3. 停止后完整更新
调用 `onScrollStop()` 进行：
- 恢复 CSS 变量模式
- 更新边界和滚动条
- 更新栏目休眠状态
- 保存位置

## 修改文件
`history_html/bookmark_canvas_module.js`

### 修改点 1: 空格拖动画布优化
```javascript
// mousedown 时标记滚动
markScrolling();

// mousemove 时使用极速平移
markScrolling();
applyPanOffsetFast();

// mouseup 时触发完整更新
onScrollStop();
```

### 修改点 2: 普通滚轮滚动优化
```javascript
// handleCanvasCustomScroll 中
markScrolling();  // 标记正在滚动
applyPanOffsetFast();  // 使用极速平移
```

### 修改点 3: 拖动栏目时优化
```javascript
// setupCanvasEventListeners 中
// mousemove: 标记正在拖动
markScrolling();

// mouseup: 拖动停止后更新
onScrollStop();

// applyTempNodeDragPosition: 拖动时跳过连接线渲染
if (typeof renderEdges === 'function' && isScrolling) {
    // 只在停止时重新渲染连接线
} else if (typeof renderEdges === 'function') {
    renderEdges();
}

// finalizeTempNodeDrag: 拖动结束时渲染连接线
if (typeof renderEdges === 'function') {
    renderEdges();
}
```

## 性能提升

### 优化前
- 每次滚动/拖动都触发：
  - 边界计算
  - 滚动条更新
  - 休眠管理
  - 连接线重渲染
  - CSS 变量更新

### 优化后
- 滚动/拖动过程中：
  - 仅更新 `transform`（GPU 加速）
  - 跳过所有重渲染
  - 极小的性能开销

- 停止后才进行：
  - 边界计算（一次）
  - 滚动条更新（一次）
  - 休眠管理（一次）
  - 连接线渲染（一次）

### 预期效果
- 滚动/拖动更加流畅丝滑
- 栏目不再抖动
- 栏目保持相对静止
- 帧率显著提升

## 测试建议
1. 测试普通滚轮滚动（纵向、横向）
2. 测试按住空格拖动画布
3. 测试拖动栏目（永久栏目、临时栏目）
4. 测试拖动时使用滚轮滚动
5. 在不同缩放级别下测试
6. 测试大量栏目时的性能

## 兼容性
- 使用标准 `transform` 属性
- 使用 `translate3d` 启用硬件加速
- 支持所有现代浏览器
- 对旧浏览器降级为普通 `translate`
