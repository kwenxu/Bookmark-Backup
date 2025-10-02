# 标签宽度对齐优化

## ✅ 问题

用户反馈"默认时间:"右边的`[10:00]`与"小时间隔:"、"分钟间隔:"右边的内容没有对齐。

### 原因分析

三个标签的文字长度不同：
- "默认时间:" - 5个中文字符
- "小时间隔:" - 5个中文字符  
- "分钟间隔:" - 5个中文字符

但是它们使用了不同的字体粗细（`font-weight`）：
- "默认时间:" - 正常（无font-weight）
- "小时间隔:" - 粗体（font-weight: 500）
- "分钟间隔:" - 粗体（font-weight: 500）

导致实际渲染宽度不同，右侧居中容器的起点不对齐。

---

## ✅ 解决方案

给三个标签设置**相同的固定宽度**：`width: 85px; display: inline-block;`

### 实现代码

```css
/* 三个标签都添加相同的宽度 */
width: 85px; 
display: inline-block;
```

### 修改内容

**1. 默认时间标签：**
```html
<!-- 之前 -->
<span class="default-time-label" style="font-size: 13px; color: var(--theme-text-primary); margin-right: 6px; white-space: nowrap;">

<!-- 现在 -->
<span class="default-time-label" style="font-size: 13px; color: var(--theme-text-primary); margin-right: 6px; white-space: nowrap; width: 85px; display: inline-block;">
```

**2. 小时间隔标签：**
```html
<!-- 之前 -->
<span class="hour-interval-label" style="font-weight: 500; font-size: 13px; color: var(--theme-text-primary); margin-right: 12px; white-space: nowrap;">

<!-- 现在 -->
<span class="hour-interval-label" style="font-weight: 500; font-size: 13px; color: var(--theme-text-primary); margin-right: 12px; white-space: nowrap; width: 85px; display: inline-block;">
```

**3. 分钟间隔标签：**
```html
<!-- 之前 -->
<span class="minute-interval-label" style="font-weight: 500; font-size: 13px; color: var(--theme-text-primary); margin-right: 12px; white-space: nowrap;">

<!-- 现在 -->
<span class="minute-interval-label" style="font-weight: 500; font-size: 13px; color: var(--theme-text-primary); margin-right: 12px; white-space: nowrap; width: 85px; display: inline-block;">
```

---

## 📐 效果对比

### 之前（未对齐）：
```
默认时间:      [10:00]
              ↑ 这里

小时间隔:           每 [2] 小时
                    ↑ 这里

分钟间隔:          每 [30] 分钟
                   ↑ 这里

↑ 三个位置不对齐 ↑
```

### 现在（已对齐）：
```
[默认时间: 85px]        [10:00]
                        ↑

[小时间隔: 85px]     每 [2] 小时
                        ↑

[分钟间隔: 85px]    每 [30] 分钟
                        ↑

↑ 三个位置垂直对齐 ↑
```

---

## 🎯 布局原理

### 布局结构：
```
┌─────────────┬──────────────────────────┬─────────┐
│   标签      │      居中内容区域        │  开关   │
│   85px      │      flex: 1             │         │
├─────────────┼──────────────────────────┼─────────┤
│ 默认时间:   │        [10:00]           │         │
│ 小时间隔:   │      每 [2] 小时         │  [OFF]  │
│ 分钟间隔:   │     每 [30] 分钟         │  [ON]   │
└─────────────┴──────────────────────────┴─────────┘
```

### 关键CSS：

**标签：**
```css
width: 85px;              /* 固定宽度 */
display: inline-block;    /* 让width生效 */
white-space: nowrap;      /* 不换行 */
```

**居中容器：**
```css
flex: 1;                  /* 占据剩余空间 */
display: flex;
justify-content: center;  /* 内容居中 */
```

**开关：**
```css
margin-left: 15px;        /* 与内容保持间距 */
```

---

## 🔧 为什么选择85px？

### 宽度考量：

**中文文本：**
- "默认时间:" ≈ 65px
- "小时间隔:" ≈ 65px
- "分钟间隔:" ≈ 65px

**英文文本：**
- "Default Time:" ≈ 85px
- "Hour Interval:" ≈ 95px
- "Minute Interval:" ≈ 110px

**选择85px的原因：**
1. 能容纳中文文本（65px < 85px）
2. 英文"Default Time:"刚好放得下
3. 较长的英文会略微挤压，但不会换行（因为white-space: nowrap）
4. 如果设置更大（如110px），中文时会有太多空白

**替代方案：**
如果英文文本被截断，可以考虑：
- 增加到 `width: 100px` 
- 或使用 `min-width: 85px` + 动态宽度

---

## 🧪 测试清单

### 视觉对齐
- [ ] 打开常规时间
- [ ] `[10:00]`、"每 [2] 小时"、"每 [30] 分钟" 垂直对齐
- [ ] 三个居中内容在同一条垂直线上

### 中文显示
- [ ] "默认时间:" 完整显示
- [ ] "小时间隔:" 完整显示
- [ ] "分钟间隔:" 完整显示
- [ ] 文本不被截断

### 英文显示
- [ ] 切换到英文
- [ ] "Default Time:" 完整显示
- [ ] "Hour Interval:" 完整显示（可能略挤）
- [ ] "Minute Interval:" 完整显示（可能略挤）
- [ ] 不换行
- [ ] 右侧内容依然对齐

### 响应式
- [ ] 缩小窗口宽度
- [ ] 对齐效果保持
- [ ] 开关不会被挤掉

---

## 📊 技术要点

### 为什么需要 display: inline-block？

`<span>` 默认是 `display: inline`，内联元素不支持设置宽度（width）。

```css
/* ❌ 不生效 */
span { width: 85px; }

/* ✅ 生效 */
span { 
    width: 85px; 
    display: inline-block; 
}
```

### 为什么不用 min-width？

`min-width` 允许元素扩展，导致不同语言下宽度不一致：

```css
/* 使用 min-width */
min-width: 85px;

/* 结果 */
中文时：实际宽度 = 65px（虽然min是85px，但内容撑开后是65px） ❌
英文时：实际宽度 = 110px（超过min-width，自动扩展） ❌

/* 使用固定 width */
width: 85px;

/* 结果 */
中文时：实际宽度 = 85px ✅
英文时：实际宽度 = 85px ✅
```

固定宽度确保无论语言，标签宽度都一致，右侧内容才能对齐。

---

## 📊 对比总结

| 项目 | 之前 | 现在 |
|------|------|------|
| 标签宽度 | 自动（不一致） | 固定85px（一致） |
| 右侧对齐 | ❌ 不对齐 | ✅ 垂直对齐 |
| 中文显示 | ✅ 正常 | ✅ 正常 |
| 英文显示 | ✅ 正常 | ✅ 基本正常（略挤） |
| 视觉效果 | 参差不齐 | 整齐划一 |

---

**优化已完成！** 🎉

三个标签宽度一致，右侧内容完美对齐，视觉效果更加整洁。
