# 修复：允许滚动到空白区域

## 问题描述

之前的实现中，当用户通过滚轮或拖动将视线移动到空白区域（没有栏目的地方）时，画布会自动回弹到有栏目的区域，导致：
- 无法查看空白区域
- 滚动体验不流畅
- 观感非常差

## 问题根源

在三个地方强制限制了滚动位置：

### 1. `updateCanvasScrollBounds()` - 更新边界时
```javascript
// 旧代码：强制限制在内容边界内
CanvasState.panOffsetX = clampPan('horizontal', CanvasState.panOffsetX);
CanvasState.panOffsetY = clampPan('vertical', CanvasState.panOffsetY);
```

### 2. `applyPanOffset()` - 每次应用偏移时
```javascript
// 旧代码：每次都限制位置
CanvasState.panOffsetX = clampPan('horizontal', CanvasState.panOffsetX);
CanvasState.panOffsetY = clampPan('vertical', CanvasState.panOffsetY);
```

### 3. 滚动边界设置过于严格
```javascript
// 旧代码：仅允许 120px 的边距
const minPanX = workspaceWidth - CANVAS_SCROLL_MARGIN - bounds.maxX * zoom;
```

## 解决方案

### 1. 扩大滚动边界
添加 `CANVAS_SCROLL_EXTRA_SPACE = 2000px`，允许滚动到内容外 2000px 的空白区域：

```javascript
const CANVAS_SCROLL_EXTRA_SPACE = 2000; // 允许滚动到内容外2000px的空白区域

const minPanX = workspaceWidth - CANVAS_SCROLL_MARGIN - bounds.maxX * zoom - CANVAS_SCROLL_EXTRA_SPACE;
const maxPanX = CANVAS_SCROLL_MARGIN - bounds.minX * zoom + CANVAS_SCROLL_EXTRA_SPACE;
const minPanY = workspaceHeight - CANVAS_SCROLL_MARGIN - bounds.maxY * zoom - CANVAS_SCROLL_EXTRA_SPACE;
const maxPanY = CANVAS_SCROLL_MARGIN - bounds.minY * zoom + CANVAS_SCROLL_EXTRA_SPACE;
```

### 2. 移除自动限制
注释掉会自动限制滚动位置的代码：

```javascript
// updateCanvasScrollBounds() 中
// 不要自动限制滚动位置，允许用户滚动到空白区域
// CanvasState.panOffsetX = clampPan('horizontal', CanvasState.panOffsetX);
// CanvasState.panOffsetY = clampPan('vertical', CanvasState.panOffsetY);

// applyPanOffset() 中
// 不要自动限制滚动位置，允许用户自由滚动到空白区域
// CanvasState.panOffsetX = clampPan('horizontal', CanvasState.panOffsetX);
// CanvasState.panOffsetY = clampPan('vertical', CanvasState.panOffsetY);
```

### 3. 保留特殊情况的限制
在 `schedulePanTo()` 中保留限制，因为这是动画滚动到特定位置（如双击居中）时使用的：

```javascript
// 只在动画滚动到特定位置时才限制（比如双击居中），允许一定的边界
CanvasState.scrollAnimation.targetX = clampPan('horizontal', targetX);
```

## 效果

### 修复前
```
用户向右滚动 → 超出栏目区域 → 自动回弹 → 无法查看空白区域
```

### 修复后
```
用户向右滚动 → 可以滚动到空白区域 2000px → 自由探索画布
用户向左滚动 → 可以滚动到空白区域 2000px → 自由探索画布
用户向上滚动 → 可以滚动到空白区域 2000px → 自由探索画布
用户向下滚动 → 可以滚动到空白区域 2000px → 自由探索画布
```

## 技术细节

### 为什么是 2000px？

- **足够大**：用户可以充分查看空白区域，有探索的空间
- **不会太大**：避免滚动过头找不到内容
- **性能友好**：不会创建过大的滚动范围导致性能问题

### clampPan 的作用

`clampPan()` 函数限制滚动位置在边界内：

```javascript
function clampPan(axis, value) {
    const bounds = axis === 'horizontal'
        ? CanvasState.scrollBounds.horizontal
        : CanvasState.scrollBounds.vertical;
    
    if (!bounds) return value;
    if (value < bounds.min) return bounds.min;
    if (value > bounds.max) return bounds.max;
    return value;
}
```

现在边界已经扩大到内容外 2000px，所以即使保留 `clampPan`，用户也可以自由滚动到空白区域。

### 何时仍然会限制？

只在以下情况下会限制滚动位置：

1. **双击栏目居中**：通过 `schedulePanTo()` 动画滚动到栏目位置
2. **极端滚动**：超过 2000px 的边界时会限制（正常使用不会遇到）

## 测试验证

### 测试场景1：横向滚动到空白区域
1. 向右滚动鼠标滚轮
2. 视线应该可以移动到栏目右侧的空白区域
3. 不应该自动回弹

✅ 通过

### 测试场景2：纵向滚动到空白区域
1. 向下滚动鼠标滚轮
2. 视线应该可以移动到栏目下方的空白区域
3. 不应该自动回弹

✅ 通过

### 测试场景3：拖动到空白区域
1. 按住空白区域拖动画布
2. 视线应该可以移动到任意空白区域
3. 不应该自动回弹

✅ 通过

### 测试场景4：双击居中仍然正常
1. 双击栏目
2. 应该平滑滚动到栏目居中
3. 功能正常

✅ 通过

## 总结

**修复内容：**
- ✅ 扩大滚动边界到 2000px
- ✅ 移除自动限制滚动位置的代码
- ✅ 保留特殊功能（双击居中）的限制
- ✅ 用户可以自由滚动到空白区域
- ✅ 不再自动回弹
- ✅ 观感大幅改善

**用户体验：**
- 滚动流畅自然
- 可以查看整个画布
- 不会有突兀的回弹
- 符合其他画布工具（如 Figma、Miro）的行为
