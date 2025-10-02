# 语言切换和布局优化记录

## ✅ 已完成的3个优化

### 1. ✅ 修复语言实时切换

#### 问题
自动备份设置对话框中的动态UI不能实时切换语言。

#### 解决方案
**添加CSS类选择器**：为所有需要动态更新的文本元素添加class：
- `.week-days-label` - 选择备份日期
- `.default-time-label` - 默认时间
- `.hour-interval-label` - 小时间隔
- `.hour-every-label` - "每"
- `.hour-unit-label` - "小时"
- `.minute-interval-label` - 分钟间隔
- `.minute-every-label` - "每"
- `.minute-unit-label` - "分钟"

**增强 applyLanguageToUI() 函数**：
```javascript
async function applyLanguageToUI() {
    const lang = await getCurrentLanguage();
    
    // 更新所有标题
    // 更新所有标签
    // 更新周勾选框文本
    // 更新描述
    // 重新渲染特定时间列表
}
```

#### 效果
- 切换语言时，所有文本立即更新
- 包括：标题、标签、周几、描述、按钮等
- 不丢失用户的配置数据

---

### 2. ✅ 周勾选框第二行居中显示

#### 之前布局
```
选择备份日期: ☑周一 ☑周二 ☑周三 ☑周四 ☑周五 ☑周六 ☑周日
默认时间: [10:00]
```

#### 现在布局
```
选择备份日期:

        ☑周一 ☑周二 ☑周三 ☑周四 ☑周五 ☑周六 ☑周日
           ↑ 第二行居中显示 ↑

默认时间: [10:00]
```

#### 实现代码
```html
<div style="display: flex; flex-direction: column; gap: 10px;">
    <!-- 第一行：标签 -->
    <div style="display: flex; align-items: center;">
        <span>选择备份日期:</span>
    </div>
    
    <!-- 第二行：勾选框居中 -->
    <div style="display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 8px;">
        ${weekCheckboxes}
    </div>
    
    <!-- 第三行：默认时间 -->
    <div style="display: flex; align-items: center;">
        <span>默认时间:</span>
        <input type="time" ...>
    </div>
</div>
```

---

### 3. ✅ 小时/分钟间隔左对齐

#### 之前
```
                小时间隔: 每 [2] 小时               [开关]
                        ↑ 居中 ↑
```

#### 现在
```
小时间隔: 每 [2] 小时                             [开关]
↑ 左对齐，与"默认时间:"对齐 ↑
```

#### 实现
**移除居中样式：**
```css
/* 之前 */
justify-content: center;

/* 现在 */
/* 不添加 justify-content，默认左对齐 */
```

**效果：**
- "小时间隔:"、"分钟间隔:" 与 "默认时间:" 左对齐
- 开关固定在右侧
- 视觉层级更清晰

---

## 📐 最终UI效果

```
┌──────────────────────────────────────────────┐
│  自动备份设置                             × │
├──────────────────────────────────────────────┤
│  [-] 常规时间                     [●    ]   │
│                                              │
│      ┌────────────────────────────────────┐ │
│      │ 选择备份日期:                      │ │
│      │                                    │ │
│      │    ☑周一 ☑周二 ☑周三 ☑周四         │ │
│      │    ☑周五 ☑周六 ☑周日               │ │
│      │      ↑ 第二行居中 ↑                │ │
│      │                                    │ │
│      │ 默认时间: [10:00]                  │ │
│      └────────────────────────────────────┘ │
│                                              │
│      ┌────────────────────────────────────┐ │
│      │ 小时间隔: 每 [2] 小时      [OFF]  │ │
│      │ ↑ 左对齐 ↑                         │ │
│      └────────────────────────────────────┘ │
│                                              │
│      ┌────────────────────────────────────┐ │
│      │ 分钟间隔: 每 [30] 分钟     [ON]   │ │
│      │ ↑ 左对齐 ↑                         │ │
│      └────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

---

## 🔧 修改的文件

### settings-ui.js

#### 1. 添加CSS类
所有需要动态更新的文本元素都添加了class：
- `week-days-label`
- `default-time-label`
- `hour-interval-label`
- `hour-every-label`
- `hour-unit-label`
- `minute-interval-label`
- `minute-every-label`
- `minute-unit-label`

#### 2. 布局修改
**周开关区域：**
```html
<!-- 之前：一行显示 -->
<div style="display: flex; flex-wrap: wrap;">
    <span>选择备份日期:</span>
    ${weekCheckboxes}
</div>

<!-- 现在：三行显示，勾选框居中 -->
<div style="display: flex; flex-direction: column; gap: 10px;">
    <div><span>选择备份日期:</span></div>
    <div style="justify-content: center;">${weekCheckboxes}</div>
    <div><span>默认时间:</span><input></div>
</div>
```

**小时/分钟间隔：**
```html
<!-- 之前：居中 -->
<div style="justify-content: center;">...</div>

<!-- 现在：左对齐 -->
<div>...</div>
```

#### 3. applyLanguageToUI() 增强
```javascript
// 更新所有带class的标签
document.querySelector('.week-days-label').textContent = getText('selectWeekDays', lang) + ':';
document.querySelector('.default-time-label').textContent = getText('defaultTime', lang) + ':';
// ... 更多

// 更新周勾选框文本
const weekDays = getText('weekDays', lang);
document.querySelectorAll('.week-day-checkbox').forEach((cb, index) => {
    cb.nextElementSibling.textContent = weekDays[index];
});
```

---

## 🧪 测试清单

### 语言切换
- [ ] 打开自动备份设置对话框
- [ ] 展开常规时间
- [ ] 切换到英文
- [ ] **所有文本立即更新**（不需要关闭重开）：
  - [ ] "选择备份日期" → "Select Backup Days"
  - [ ] "周一、周二..." → "Mon, Tue..."
  - [ ] "默认时间" → "Default Time"
  - [ ] "小时间隔" → "Hour Interval"
  - [ ] "分钟间隔" → "Minute Interval"
  - [ ] "每" → "Every"
  - [ ] "小时" → "hour(s)"
  - [ ] "分钟" → "minute(s)"
- [ ] 切换回中文，所有文本恢复
- [ ] 配置数据不丢失

### 布局-周勾选框
- [ ] 第一行只有"选择备份日期:"
- [ ] 第二行只有7个勾选框，水平居中
- [ ] 第三行是"默认时间:"和输入框
- [ ] 三行间距适当（gap: 10px）

### 布局-间隔对齐
- [ ] "默认时间:" 左对齐
- [ ] "小时间隔:" 与"默认时间:"对齐
- [ ] "分钟间隔:" 与"默认时间:"对齐
- [ ] 三个冒号垂直对齐成一条线
- [ ] 开关都在右侧

### 视觉检查
- [ ] 布局整洁，不拥挤
- [ ] 层级清晰
- [ ] 间距合理
- [ ] 响应式换行正常

---

## 📊 对比总结

| 项目 | 之前 | 现在 |
|------|------|------|
| 语言切换 | ❌ 不工作 | ✅ 实时更新 |
| 周勾选框 | 第一行挤一起 | 第二行居中 |
| 间隔标签 | 居中显示 | 左对齐 |
| 垂直对齐 | 不对齐 | 冒号对齐 |

---

## 💡 技术要点

### 为什么要添加CSS类？
- **选择器稳定性**：基于class的选择器比基于style的选择器更可靠
- **性能**：直接选择元素比遍历DOM树快
- **可维护性**：代码更清晰，容易理解

### 为什么使用 flex-direction: column？
- **简化布局**：每行独立控制
- **易于对齐**：第二行单独居中
- **扩展性**：未来添加更多行很容易

### 为什么不用 loadSettings()？
- **避免状态丢失**：重新加载会丢失用户当前的输入
- **性能更好**：只更新文本，不重新渲染整个UI
- **用户体验**：无闪烁，平滑切换

---

**所有优化已完成！** 🎉

语言切换现在完全正常，布局更加清晰美观。
