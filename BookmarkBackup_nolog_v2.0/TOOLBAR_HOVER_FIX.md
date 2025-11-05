# 工具栏悬停保持修复

## 问题描述
当鼠标从工具栏移动到色盘时，工具栏会因为检测到鼠标离开而自动隐藏，导致色盘也跟着消失。

## 问题原因
原始CSS规则只在以下情况显示工具栏：
```css
.md-canvas-node:hover .md-node-toolbar {
    opacity: 1;
    pointer-events: auto;
}
```

当鼠标移动到色盘（位于工具栏上方）时，鼠标不再悬停在 `.md-canvas-node` 上，导致工具栏隐藏。

## 解决方案

### CSS修复
添加额外的CSS规则，确保在以下情况工具栏保持可见：

```css
.md-canvas-node.selected .md-node-toolbar,
.md-canvas-node:hover .md-node-toolbar,
.md-node-toolbar:hover,                          /* ← 新增：鼠标悬停在工具栏本身 */
.md-node-toolbar:has(.md-color-popover.open) {   /* ← 新增：色盘打开时 */
    opacity: 1;
    pointer-events: auto;
}
```

### 关键点

1. **`.md-node-toolbar:hover`**
   - 当鼠标悬停在工具栏本身时保持可见
   - 覆盖了鼠标在工具栏按钮上的情况

2. **`.md-node-toolbar:has(.md-color-popover.open)`**
   - 使用CSS `:has()` 伪类选择器
   - 当工具栏内部有打开的色盘时保持可见
   - 即使鼠标移动到色盘上，工具栏也不会消失

3. **DOM结构优势**
   - 色盘是工具栏的子元素：`toolbar.appendChild(pop)`
   - 鼠标在色盘上时，也算在工具栏内部
   - JavaScript的 `toolbar.contains(e.target)` 检查会返回 `true`

## 交互流程

### 修复前 ❌
```
1. 鼠标悬停卡片 → 工具栏显示
2. 点击🎨按钮 → 色盘打开
3. 鼠标移动到色盘 → 工具栏隐藏 → 色盘也消失 ❌
```

### 修复后 ✅
```
1. 鼠标悬停卡片 → 工具栏显示
2. 点击🎨按钮 → 色盘打开
3. 鼠标移动到色盘 → 工具栏保持显示 ✅
4. 点击颜色或外部 → 色盘关闭
5. 鼠标移开卡片 → 工具栏隐藏
```

## 浏览器兼容性

### `:has()` 伪类支持
- ✅ Chrome 105+ (2022年8月)
- ✅ Edge 105+ (2022年8月)
- ✅ Safari 15.4+ (2022年3月)
- ✅ Firefox 121+ (2023年12月)

所有现代浏览器都支持 `:has()` 伪类。

### 降级方案
如果需要支持旧浏览器，可以使用JavaScript添加类：

```javascript
// 打开色盘时添加类
pop.classList.add('open');
toolbar.classList.add('has-open-popover');  // ← 添加标记类

// CSS中使用
.md-node-toolbar.has-open-popover {
    opacity: 1;
    pointer-events: auto;
}
```

## 测试方法

1. 打开 `history_html/test_color_picker.html`
2. 悬停在卡片上，工具栏出现
3. 点击🎨按钮，色盘打开
4. **将鼠标移动到色盘上**
5. ✅ 工具栏和色盘应该都保持可见
6. 点击颜色或外部区域，色盘关闭
7. 鼠标移开卡片，工具栏隐藏

## 相关文件

- `history_html/history.css` - 主样式文件
- `history_html/test_color_picker.html` - 测试页面
- `history_html/bookmark_canvas_module.js` - 色盘逻辑

## 技术细节

### CSS层叠优先级
```css
/* 优先级从低到高 */
.md-canvas-node:hover .md-node-toolbar          /* 卡片悬停 */
.md-node-toolbar:hover                          /* 工具栏悬停 */
.md-node-toolbar:has(.md-color-popover.open)   /* 色盘打开 */
.md-canvas-node.selected .md-node-toolbar       /* 卡片选中 */
```

### 事件处理
```javascript
// 外部点击关闭
const onDoc = (e) => {
    if (!toolbar.contains(e.target)) {  // ← 检查点击是否在工具栏内
        closeMdColorPopover(toolbar);
        document.removeEventListener('mousedown', onDoc, true);
    }
};
```

由于色盘是工具栏的子元素，`toolbar.contains(e.target)` 在点击色盘时返回 `true`，不会触发关闭。

## 视觉效果

```
┌─────────────────────────────────────┐
│  ┌───┬───┬───┬───┬───┬───┬───┐     │
│  │ 🔴│ 🟠│ 🟡│ 🟢│ 🔵│ 🟣│ 🌈│     │  ← 鼠标在这里
│  └───┴───┴───┴───┴───┴───┴───┘     │     工具栏保持可见 ✅
└─────────────────────────────────────┘
                 ↑
┌─────────────────────────────────────┐
│  ┌───┬───┬───┬───┐                 │
│  │ 🗑️│ 🎨│ 🔍│ ✏️│                 │  ← 工具栏保持显示
│  └───┴───┴───┴───┘                 │
└─────────────────────────────────────┘
```

## 总结

通过添加 `:hover` 和 `:has()` CSS规则，工具栏现在能够在以下情况保持可见：
1. 鼠标悬停在卡片上
2. 鼠标悬停在工具栏上
3. 色盘打开时
4. 卡片被选中时

这提供了流畅的用户体验，用户可以自由地在工具栏和色盘之间移动鼠标而不会导致UI消失。
