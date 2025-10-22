# Canvas 缩放和平移功能说明

## ✅ 已添加的功能

### 1. **Ctrl/Cmd + 滚轮缩放**
- 按住 `Ctrl` (Windows/Linux) 或 `Cmd` (Mac)
- 滚动鼠标滚轮上下
- 缩放范围：10% - 300%
- 缩放中心：鼠标位置

### 2. **空格键拖动画布**
- 按住 `Space` (空格键)
- 鼠标光标变为抓手图标
- 点击并拖动画布
- 释放空格键停止拖动

### 3. **滚动条**
- 画布大小：200% × 200%
- 水平和垂直滚动条自动显示
- 滚动条宽度：12px
- 带圆角和悬停效果

### 4. **缩放指示器**
- 位置：右下角固定
- 显示当前缩放百分比
- 快捷按钮：
  - **-** 缩小 (每次10%)
  - **重置** 恢复100%
  - **+** 放大 (每次10%)
- 显示操作提示

### 5. **数据持久化**
- 缩放级别保存到 localStorage
- 键名：`canvas-zoom`
- 刷新页面后自动恢复

## 技术实现

### HTML 结构
```html
<div class="canvas-workspace" id="canvasWorkspace">
  <div class="canvas-inner" id="canvasInner">
    <!-- 所有临时节点在这里 -->
    <!-- 永久栏目也在这里 -->
  </div>
</div>

<div class="canvas-zoom-indicator">
  <!-- 缩放控制器 -->
</div>
```

### CSS 关键样式
```css
.canvas-workspace {
    overflow: auto;  /* 显示滚动条 */
}

.canvas-inner {
    min-width: 200%;
    min-height: 200%;
    transform-origin: 0 0;
    transform: scale(var(--zoom));
}

.canvas-workspace.space-pressed {
    cursor: grab;
}

.canvas-workspace.panning {
    cursor: grabbing;
}
```

### JavaScript 状态
```javascript
CanvasState = {
    zoom: 1,              // 当前缩放级别
    isPanning: false,     // 是否正在拖动
    isSpacePressed: false,// 空格键是否按下
    panStartX: 0,         // 拖动起始X
    panStartY: 0,         // 拖动起始Y
    panScrollLeft: 0,     // 拖动前滚动位置
    panScrollTop: 0
}
```

## 使用方法

### 缩放操作
1. **滚轮缩放**：
   - Ctrl + 向上滚 = 放大
   - Ctrl + 向下滚 = 缩小

2. **按钮缩放**：
   - 点击右下角的 + / - 按钮
   - 点击"重置"回到100%

### 平移操作
1. **空格拖动**：
   - 按住空格键
   - 鼠标点击画布并拖动
   - 松开空格键结束

2. **滚动条**：
   - 直接拖动滚动条
   - 使用鼠标滚轮（不按Ctrl）

### 组合使用
1. 先缩放到合适比例
2. 用空格拖动到目标区域
3. 松开空格进行编辑操作

## 快捷键总结

| 操作 | 快捷键 |
|------|--------|
| 放大 | Ctrl/Cmd + 滚轮↑ |
| 缩小 | Ctrl/Cmd + 滚轮↓ |
| 拖动画布 | Space + 鼠标拖动 |
| 重置缩放 | 点击"重置"按钮 |

## 注意事项

1. **空格键冲突**
   - 在输入框中不会触发拖动
   - 避免在文本输入时误触发

2. **缩放范围**
   - 最小：10%
   - 最大：300%
   - 超出范围自动限制

3. **性能考虑**
   - 临时节点<100个时流畅
   - 大量节点时建议100%缩放

4. **浏览器兼容性**
   - Chrome/Edge: 完全支持
   - Firefox: 完全支持
   - Safari: 需测试

## 与其他功能的配合

### 拖动节点
- 缩放不影响节点拖动
- 节点位置基于原始坐标
- 拖动时空格键不响应

### 永久栏目
- 永久栏目也会缩放
- 拖动永久栏目时空格键不响应
- 永久栏目位置保存为原始坐标

### 临时节点
- 临时节点随画布缩放
- 创建位置考虑滚动偏移
- 节点位置保存为原始坐标

## 调试信息

打开浏览器控制台查看：
```
[Canvas] 设置缩放和平移功能
[Canvas] 缩放: 150%
[Canvas] 恢复缩放: 120%
```

## 未来改进

- [ ] 缩放动画更平滑
- [ ] 支持触摸屏手势
- [ ] 小地图导航
- [ ] 缩放到选中节点
- [ ] 画布网格对齐
