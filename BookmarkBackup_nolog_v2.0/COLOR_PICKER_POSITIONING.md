# 色盘定位说明

## 视觉层次结构

```
┌─────────────────────────────────────┐
│  ┌─────────────────────────────┐   │
│  │  [  选择颜色  ]  #2563eb    │   │  ← RGB选择器UI（.md-rgb-picker）
│  └─────────────────────────────┘   │     点击后显示原生颜色选择器
└─────────────────────────────────────┘
                 ↑
                 │ 4px 间距
                 │
┌─────────────────────────────────────┐
│  ┌───┬───┬───┬───┬───┬───┬───┐     │
│  │ 🔴│ 🟠│ 🟡│ 🟢│ 🔵│ 🟣│ 🌈│     │  ← 色盘（.md-color-popover）
│  └───┴───┴───┴───┴───┴───┴───┘     │     7个颜色按钮
└─────────────────────────────────────┘
                 ↑
                 │ 4px 间距
                 │
┌─────────────────────────────────────┐
│  ┌───┬───┬───┬───┐                 │
│  │ 🗑️│ 🎨│ 🔍│ ✏️│                 │  ← 工具栏（.md-node-toolbar）
│  └───┴───┴───┴───┘                 │     4个工具按钮
└─────────────────────────────────────┘
                 ↑
                 │ 28px 高度
                 │
┌─────────────────────────────────────┐
│                                     │
│     空白栏目（Markdown 卡片）        │  ← 卡片节点（.md-canvas-node）
│                                     │
│     双击画布创建                     │
│                                     │
└─────────────────────────────────────┘
```

## DOM 结构

```html
<div class="md-canvas-node" id="md-node-xxx">
    <!-- 工具栏 -->
    <div class="md-node-toolbar">
        <button data-action="md-delete">🗑️</button>
        <button data-action="md-color-toggle">🎨</button>
        <button data-action="md-focus">🔍</button>
        <button data-action="md-edit">✏️</button>
        
        <!-- 色盘（附加到工具栏内部） -->
        <div class="md-color-popover">
            <span data-color="1" style="background:#ff6666"></span>
            <span data-color="2" style="background:#ffaa66"></span>
            <span data-color="3" style="background:#ffdd66"></span>
            <span data-color="4" style="background:#66dd99"></span>
            <span data-color="5" style="background:#66bbff"></span>
            <span data-color="6" style="background:#bb99ff"></span>
            <button class="md-color-picker-btn">🌈</button>
            
            <!-- RGB选择器UI（附加到色盘内部） -->
            <div class="md-rgb-picker">
                <input type="color" class="md-color-input" />
            </div>
        </div>
    </div>
    
    <!-- 内容区域 -->
    <div class="md-canvas-text">...</div>
    <textarea class="md-canvas-editor">...</textarea>
</div>
```

## CSS 定位关键点

### 1. 工具栏定位
```css
.md-node-toolbar {
    position: absolute;
    top: -28px;           /* 在卡片上方 28px */
    left: 50%;
    transform: translateX(-50%);  /* 水平居中 */
    z-index: 100;
}
```

### 2. 色盘定位（相对于工具栏）
```css
.md-color-popover {
    position: absolute;
    bottom: calc(100% + 4px);  /* 在工具栏上方，留 4px 间距 */
    left: 50%;
    transform: translateX(-50%);  /* 相对工具栏水平居中 */
    z-index: 10;              /* 相对于工具栏的局部层级 */
}
```

### 3. RGB 选择器UI（相对于色盘）
```css
.md-rgb-picker {
    position: absolute;
    bottom: calc(100% + 4px);  /* 在色盘上方，留 4px 间距 */
    left: 50%;
    transform: translateX(-50%);  /* 相对色盘水平居中 */
    z-index: 20;              /* 高于色盘 */
}
```
- RGB选择器UI显示在色盘正上方
- 点击彩色圆盘按钮时显示UI，并自动触发原生颜色选择器
- 用户可以看到当前选择的颜色值

## 交互流程

1. **悬停卡片** → 工具栏淡入显示（opacity: 0 → 1）
2. **点击🎨按钮** → 色盘在工具栏正上方弹出
3. **点击预设颜色** → 立即应用颜色，色盘关闭
4. **点击🌈按钮** → RGB选择器UI在色盘正上方显示，并自动触发原生颜色选择器
5. **选择自定义颜色** → 实时应用颜色
6. **选择完成** → RGB选择器UI关闭
7. **点击外部** → 所有弹出层自动关闭

## 关键代码改动

### JavaScript
```javascript
// 色盘附加到 toolbar，而不是 el
function ensureMdColorPopover(toolbar, node) {
    // ...
    toolbar.appendChild(pop);  // ← 关键：附加到工具栏
    return pop;
}

// 调用时传递 toolbar
toolbar.addEventListener('click', (e) => {
    if (action === 'md-color-toggle') {
        toggleMdColorPopover(toolbar, node, btn);  // ← 传递 toolbar
    }
});
```

### 定位计算
- **工具栏**：`top: -28px` 相对于卡片
- **色盘**：`bottom: calc(100% + 4px)` 相对于工具栏
- **RGB选择器**：`bottom: calc(100% + 4px)` 相对于色盘
- **总距离**：卡片顶部 → 工具栏（28px）→ 色盘（4px间距）→ RGB选择器（4px间距）

## 浏览器兼容性
- ✅ Chrome/Edge: 完全支持
- ✅ Firefox: 完全支持
- ✅ Safari: 完全支持
- ✅ 原生颜色选择器在所有现代浏览器中都有良好支持

## 测试方法
1. 打开 `history_html/test_color_picker.html`
2. 悬停在卡片上查看工具栏
3. 点击🎨按钮，色盘应出现在工具栏正上方
4. 点击🌈按钮，原生颜色选择器应立即打开
