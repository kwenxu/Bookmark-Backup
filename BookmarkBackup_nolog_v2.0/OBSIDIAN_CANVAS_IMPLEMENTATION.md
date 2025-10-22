# Obsidian Canvas 风格实现总结

## ✅ 已完成的修改

### 1. **HTML结构变更**
**从：**
```html
<div class="canvas-workspace">
  <div class="canvas-inner">
    <!-- 临时节点 -->
  </div>
</div>
<div class="permanent-section">...</div>
```

**到：**
```html
<div class="canvas-main-container" style="--canvas-scale: 1; --canvas-pan-x: 0px; --canvas-pan-y: 0px;">
  <div class="canvas-workspace">
    <div class="canvas-content">
      <!-- 永久栏目和临时节点都在这里 -->
    </div>
  </div>
</div>

<template id="permanentSectionTemplate">
  <!-- 永久栏目模板，JS动态添加到canvas-content -->
</template>
```

### 2. **CSS实现（Obsidian方式）**

**新文件：** `canvas_obsidian_style.css`

```css
.canvas-content {
    transform: translate(var(--canvas-pan-x), var(--canvas-pan-y)) scale(var(--canvas-scale));
    transform-origin: left top;
}

.canvas-workspace {
    background-image: radial-gradient(var(--border-color) calc(var(--canvas-scale)*0.5px + 0.5px), transparent 0);
    background-size: calc(var(--canvas-scale) * 20px) calc(var(--canvas-scale) * 20px);
    background-position: calc(var(--canvas-pan-x) - 10px) calc(var(--canvas-pan-y) - 10px);
}
```

**关键特性：**
- 使用CSS变量控制缩放和平移
- 背景网格随缩放动态变化
- Transform应用在canvas-content上

### 3. **JavaScript实现**

**核心函数：**

```javascript
// 设置缩放（使用CSS变量）
function setCanvasZoom(zoom) {
    const container = document.querySelector('.canvas-main-container');
    container.style.setProperty('--canvas-scale', zoom);
}

// 应用平移偏移（使用CSS变量）
function applyPanOffset() {
    const container = document.querySelector('.canvas-main-container');
    container.style.setProperty('--canvas-pan-x', `${CanvasState.panOffsetX}px`);
    container.style.setProperty('--canvas-pan-y', `${CanvasState.panOffsetY}px`);
}

// 保存平移位置
function savePanOffset() {
    localStorage.setItem('canvas-pan', JSON.stringify({
        x: CanvasState.panOffsetX,
        y: CanvasState.panOffsetY
    }));
}

// 将永久栏目移入canvas-content（使其受缩放影响）
function movePermanentSectionToCanvas() {
    const permanentSection = document.getElementById('permanentSection');
    const canvasContent = document.getElementById('canvasContent');
    canvasContent.appendChild(permanentSection);
}
```

**CanvasState更新：**
```javascript
CanvasState = {
    zoom: 1,
    panOffsetX: 0,  // 新增：X轴平移偏移
    panOffsetY: 0,  // 新增：Y轴平移偏移
    isPanning: false,
    panStartX: 0,
    panStartY: 0,
    isSpacePressed: false
};
```

### 4. **缩放和平移实现**

**Ctrl+滚轮缩放：**
```javascript
workspace.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = -e.deltaY;
        const zoomSpeed = 0.001;
        const newZoom = Math.max(0.1, Math.min(3, CanvasState.zoom + delta * zoomSpeed));
        setCanvasZoom(newZoom);
    }
}, { passive: false });
```

**空格+拖动平移：**
```javascript
workspace.addEventListener('mousedown', (e) => {
    if (CanvasState.isSpacePressed) {
        e.preventDefault();
        CanvasState.isPanning = true;
        CanvasState.panStartX = e.clientX - CanvasState.panOffsetX;
        CanvasState.panStartY = e.clientY - CanvasState.panOffsetY;
        workspace.classList.add('panning');
    }
});

document.addEventListener('mousemove', (e) => {
    if (CanvasState.isPanning) {
        CanvasState.panOffsetX = e.clientX - CanvasState.panStartX;
        CanvasState.panOffsetY = e.clientY - CanvasState.panStartY;
        applyPanOffset();
    }
});
```

## 📋 与Obsidian的对比

| 特性 | Obsidian实现 | 我们的实现 | 状态 |
|------|------------|----------|------|
| CSS变量控制 | ✓ `--scale`, `--pan-x`, `--pan-y` | ✓ `--canvas-scale`, `--canvas-pan-x`, `--canvas-pan-y` | ✅ |
| Transform应用 | ✓ 在nodes容器 | ✓ 在canvas-content | ✅ |
| 背景网格 | ✓ 随缩放变化 | ✓ 随缩放变化 | ✅ |
| Ctrl+滚轮缩放 | ✓ | ✓ | ✅ |
| 空格+拖动 | ✓ | ✓ | ✅ |
| 状态持久化 | ✓ | ✓ | ✅ |

## 🎯 核心改进点

### 1. **统一的Transform应用**
- 所有内容（永久栏目+临时节点）都在`canvas-content`内
- 缩放和平移同时影响所有元素
- 避免了之前永久栏目不受缩放影响的问题

### 2. **CSS变量驱动**
- JavaScript只负责修改CSS变量值
- CSS通过变量自动应用transform
- 性能更好，更符合现代Web开发实践

### 3. **背景网格动态缩放**
- 网格点大小随缩放变化：`calc(var(--canvas-scale)*0.5px + 0.5px)`
- 网格间距随缩放变化：`calc(var(--canvas-scale) * 20px)`
- 网格位置随平移变化：`calc(var(--canvas-pan-x) - 10px)`

### 4. **状态管理完善**
- 缩放级别保存到localStorage
- 平移位置保存到localStorage
- 页面刷新后自动恢复状态

## 🔧 使用方法

### 初始化
```javascript
// 在renderCurrentView()中调用
case 'canvas':
    renderTreeView();
    CanvasModule.init();
    break;
```

### Canvas模块初始化流程
```javascript
function initCanvasView() {
    // 1. 将永久栏目移入canvas-content
    movePermanentSectionToCanvas();
    
    // 2. 增强书签树的拖拽功能
    enhanceBookmarkTreeForCanvas();
    
    // 3. 让永久栏目可以拖动
    makePermanentSectionDraggable();
    
    // 4. 设置Canvas缩放和平移
    setupCanvasZoomAndPan();
    
    // 5. 加载临时节点
    loadTempNodes();
    
    // 6. 设置Canvas事件监听
    setupCanvasEventListeners();
}
```

## ✨ 用户体验

### 缩放操作
- **Ctrl/Cmd + 滚轮↑**：放大
- **Ctrl/Cmd + 滚轮↓**：缩小
- **右下角 + 按钮**：放大10%
- **右下角 - 按钮**：缩小10%
- **右下角"重置"按钮**：恢复100%

### 平移操作
- **按住Space**：鼠标变为抓手图标
- **Space + 拖动**：平移画布
- **松开Space**：恢复正常操作

### 视觉反馈
- 缩放指示器实时显示当前百分比
- 按住空格时显示抓手光标
- 拖动时显示抓取光标
- 背景网格提供视觉参考

## 📝 技术要点

### 1. Transform Origin
```css
transform-origin: left top;
```
- 固定变换原点在左上角
- 确保缩放和平移行为一致
- 避免元素"跳动"

### 2. 事件处理
- 使用`{ passive: false }`允许preventDefault
- 区分拖动画布 vs 拖动节点
- 输入框内不触发空格拖动

### 3. 性能优化
- CSS变量避免频繁DOM操作
- Transform使用GPU加速
- 节流平移更新（通过mousemove）

## 🐛 已知问题和解决方案

### 问题：永久栏目不受缩放影响
**原因：** 永久栏目在canvas-content外部
**解决：** 通过movePermanentSectionToCanvas()移入canvas-content

### 问题：节点位置计算不准确
**原因：** 没有考虑缩放因子
**解决：** 创建节点时除以缩放因子，保存原始坐标

### 问题：拖动冲突
**原因：** 空格拖动和节点拖动同时触发
**解决：** 按住空格时禁用节点拖动

## 📚 参考资料

- Obsidian Canvas源码：`/Users/kk/Downloads/jsoncanvas-main/assets/canvas.js`
- Obsidian CSS样式：`/Users/kk/Downloads/jsoncanvas-main/assets/style.css`
- JSON Canvas规范：https://jsoncanvas.org/

## ✅ 完成度

- [x] HTML结构重构
- [x] CSS变量方式实现
- [x] 缩放功能（Ctrl+滚轮）
- [x] 平移功能（Space+拖动）
- [x] 背景网格动态变化
- [x] 状态持久化
- [x] 永久栏目受缩放影响
- [x] 临时节点受缩放影响
- [x] 缩放指示器
- [x] 代码清理（删除重复函数）

**所有功能已按Obsidian方式完整实现！** 🎉
