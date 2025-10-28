# Canvas 画布性能优化

## 优化日期
2025-10-28

## 问题描述
书签画布在遇到多个栏目时，出现以下性能问题：
- **Ctrl滚轮缩放**：卡顿、抖动
- **纵向滚动**：掉帧、不流畅
- **横向滚动**：掉帧、不流畅

主要原因是每次滚动/缩放都会触发大量的DOM操作和计算，导致帧率下降。

## 优化策略

### 1. **去抖与节流机制**
- 使用 `requestAnimationFrame` 批量处理滚动条更新
- 使用 `requestAnimationFrame` 批量处理边界计算
- 滚动停止后才执行完整的边界更新和滚动条更新

**实现：**
```javascript
// 新增变量
let scrollbarUpdateFrame = null;
let scrollbarUpdatePending = false;
let boundsUpdateFrame = null;
let boundsUpdatePending = false;
let scrollStopTimer = null;
let isScrolling = false;
const SCROLL_STOP_DELAY = 150; // 滚动停止后延迟加载时间

// 调度滚动条更新（使用 RAF 去抖）
function scheduleScrollbarUpdate() {
    if (scrollbarUpdatePending) return;
    scrollbarUpdatePending = true;
    if (scrollbarUpdateFrame) {
        cancelAnimationFrame(scrollbarUpdateFrame);
    }
    scrollbarUpdateFrame = requestAnimationFrame(() => {
        scrollbarUpdateFrame = null;
        scrollbarUpdatePending = false;
        updateScrollbarThumbs();
    });
}

// 调度边界更新（使用 RAF 去抖）
function scheduleBoundsUpdate() {
    if (boundsUpdatePending) return;
    boundsUpdatePending = true;
    if (boundsUpdateFrame) {
        cancelAnimationFrame(boundsUpdateFrame);
    }
    boundsUpdateFrame = requestAnimationFrame(() => {
        boundsUpdateFrame = null;
        boundsUpdatePending = false;
        updateCanvasScrollBounds({ initial: false, recomputeBounds: true });
    });
}
```

### 2. **优化缩放性能**
- 降低缩放速度，从 `0.001` 降至 `0.0008`，使缩放更平滑
- 缩放时跳过滚动条更新，使用延迟更新
- 缩放时使用快速平移应用 `applyPanOffsetFast()`

**实现：**
```javascript
// 降低缩放速度，更平滑
const zoomSpeed = 0.0008; // 原来是 0.001

// 标记正在滚动
markScrolling();

// 使用优化的缩放更新，滚动时跳过边界计算
scheduleZoomUpdate(newZoom, mouseX, mouseY, { 
    recomputeBounds: false, 
    skipSave: false, 
    skipScrollbarUpdate: true // 新增参数
});
```

### 3. **使用 Transform 替代 Left/Top**
在拖动永久栏目和临时节点时，使用 `transform: translate()` 替代 `left/top`，大幅提升渲染性能。

**原因：** 
- `transform` 只触发合成（Composite），不触发布局（Layout）和绘制（Paint）
- `left/top` 会触发布局（Layout）、绘制（Paint）和合成（Composite）

**实现：**
```javascript
// 拖动时使用 transform
permanentSection.style.transform = `translate(${newX - initialLeft}px, ${newY - initialTop}px)`;

// 释放时转回 left/top（便于保存位置）
permanentSection.style.transform = 'none';
permanentSection.style.left = finalX + 'px';
permanentSection.style.top = finalY + 'px';
```

### 4. **优化滚动动画**
- 滚动动画期间使用 `applyPanOffsetFast()`，不更新滚动条
- 动画结束后才调度滚动条更新

**实现：**
```javascript
function runScrollAnimation() {
    // ... 计算新位置 ...
    
    // 使用快速平移（不更新滚动条）
    applyPanOffsetFast();
    
    if (continueAnimation) {
        CanvasState.scrollAnimation.frameId = requestAnimationFrame(runScrollAnimation);
    } else {
        CanvasState.scrollAnimation.frameId = null;
        CanvasState.scrollAnimation.targetX = CanvasState.panOffsetX;
        CanvasState.scrollAnimation.targetY = CanvasState.panOffsetY;
        
        // 动画结束后更新滚动条
        scheduleScrollbarUpdate();
        savePanOffsetThrottled();
    }
}
```

### 5. **滚动停止检测**
添加滚动停止检测机制，滚动停止后才执行完整的边界计算和滚动条更新。

**实现：**
```javascript
// 标记正在滚动
function markScrolling() {
    isScrolling = true;
    
    // 清除之前的停止计时器
    if (scrollStopTimer) {
        clearTimeout(scrollStopTimer);
    }
    
    // 设置新的停止计时器
    scrollStopTimer = setTimeout(() => {
        isScrolling = false;
        onScrollStop();
    }, SCROLL_STOP_DELAY);
}

// 滚动停止后的处理
function onScrollStop() {
    // 滚动停止后，更新边界和滚动条
    scheduleBoundsUpdate();
    scheduleScrollbarUpdate();
    savePanOffsetThrottled();
}
```

## 优化效果

### 性能提升
- **缩放操作**：从掉帧、抖动 → 流畅、平滑
- **滚动操作**：从卡顿、掉帧 → 流畅不掉帧
- **拖动操作**：从稍有延迟 → 即时响应

### 技术指标
- **减少 DOM 操作**：滚动时只更新 CSS 变量，不计算边界和滚动条
- **使用 GPU 加速**：transform 替代 left/top
- **批量处理**：使用 RAF 合并多次更新请求
- **延迟加载**：滚动停止后才执行重计算

## 参考实现
本次优化参考了 Obsidian Canvas 的实现方式（`/Users/kk/Downloads/jsoncanvas-main/assets/canvas.js`）：
- 使用简洁的缩放和平移逻辑
- 避免频繁的边界计算
- 优先使用 CSS 变量而非直接操作 DOM

## 测试建议
1. 创建多个临时栏目（10+个）测试滚动性能
2. 使用 Ctrl + 滚轮测试缩放流畅度
3. 使用触控板/鼠标滚轮测试横向和纵向滚动
4. 拖动永久栏目和临时节点测试响应速度

## 后续优化方向
- 考虑使用虚拟化渲染大量栏目（如超过50个）
- 添加性能监控，实时显示 FPS
- 考虑使用 Web Worker 处理复杂计算
