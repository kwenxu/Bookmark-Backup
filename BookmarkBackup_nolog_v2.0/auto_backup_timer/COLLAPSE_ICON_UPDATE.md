# 折叠图标更新记录

## 📋 更新内容

### 问题
之前的折叠图标使用文本符号（▼/▶），与现有的"本地配置"样式不一致。

### 解决方案
改为使用与"本地配置"相同的 **+/-** 折叠图标样式。

---

## ✅ 修改内容

### 1. 实时备份块 (createRealtimeBackupBlock)
```html
<!-- 之前 -->
<div class="toggle-icon">▼</div>

<!-- 之后 -->
<div class="toggle-icon"></div>
```

### 2. 常规时间块 (createRegularTimeBlock)
```html
<!-- 之前 -->
<div class="toggle-icon">▶</div>

<!-- 之后 -->
<div class="toggle-icon"></div>
```

### 3. 特定时间块 (createSpecificTimeBlock)
```html
<!-- 之前 -->
<div class="toggle-icon">▶</div>

<!-- 之后 -->
<div class="toggle-icon"></div>
```

### 4. 折叠事件处理 (setupCollapseEvents)
```javascript
// 移除手动更新图标文本的代码
// 之前
if (icon) icon.textContent = '▼';
if (icon) icon.textContent = '▶';

// 之后
// 图标由CSS自动处理，无需手动更新
```

---

## 🎨 最终UI结构

### HTML结构
```html
<div class="config-section">
    <div class="config-header [collapsed]">
        <h2>
            <span>标题</span>
        </h2>
        <div style="display: flex; align-items: center;">
            <button class="toggle-button">开关</button>
            <div class="toggle-icon"></div>
        </div>
    </div>
    <div class="config-content">内容</div>
</div>
```

### CSS样式（已在 popup.html 中定义）

```css
.toggle-icon {
    width: 20px;
    height: 20px;
    position: relative;
    transition: transform 0.3s ease;
}

/* 十字的两条线 */
.toggle-icon::before,
.toggle-icon::after {
    content: '';
    position: absolute;
    background-color: var(--theme-icon-color);
    transition: transform 0.3s ease;
}

/* 垂直线 */
.toggle-icon::before {
    width: 2px;
    height: 12px;
    left: 9px;
    top: 4px;
}

/* 水平线 */
.toggle-icon::after {
    width: 12px;
    height: 2px;
    left: 4px;
    top: 9px;
}

/* 展开状态：显示为 - 号 */
.config-header:not(.collapsed) .toggle-icon::before {
    transform: scaleY(0);  /* 隐藏垂直线 */
}

/* 折叠状态：显示为 + 号 */
.config-header.collapsed .toggle-icon::before {
    transform: scaleY(1);  /* 显示垂直线 */
}
```

---

## 🎬 视觉效果

### 展开状态（无 collapsed class）
```
实时备份  [ON]  [-]   <-- 减号
  内容可见
```

### 折叠状态（有 collapsed class）
```
常规时间  [OFF] [+]   <-- 加号
```

---

## ✨ 优势

1. **统一风格** - 与现有的"本地配置"、"WebDAV配置"等完全一致
2. **CSS驱动** - 图标动画完全由CSS控制，性能更好
3. **简洁代码** - 无需手动更新图标文本
4. **平滑动画** - CSS transition 提供流畅的变换效果

---

## 🧪 测试清单

- [x] 实时备份：展开时显示 `-`，折叠时显示 `+`
- [x] 常规时间：展开时显示 `-`，折叠时显示 `+`
- [x] 特定时间：展开时显示 `-`，折叠时显示 `+`
- [x] 点击标题区域切换折叠状态
- [x] 点击开关按钮不触发折叠
- [x] 动画流畅自然
- [x] 与现有UI风格一致

---

## 📝 相关文件

- `auto_backup_timer/settings-ui.js` - UI创建和事件处理
- `popup.html` - CSS样式定义（.toggle-icon）

---

**更新完成！** 🎉
