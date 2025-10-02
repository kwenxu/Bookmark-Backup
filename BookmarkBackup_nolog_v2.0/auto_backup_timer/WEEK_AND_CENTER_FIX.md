# 周几顺序和居中对齐优化

## ✅ 已完成的3个优化

### 1. ✅ 周日放在周六后面

#### 问题
原来的顺序是：周日、周一、周二、周三、周四、周五、周六（0-6）

#### 解决方案
显示顺序调整为：周一、周二、周三、周四、周五、周六、周日

**关键实现：**
```javascript
const weekDays = getText('weekDays', lang);
// 调整显示顺序：周一到周日（但保持data-day与存储的映射：0=周日, 1=周一, ..., 6=周六）
const displayOrder = [1, 2, 3, 4, 5, 6, 0]; // 周一到周日
const weekCheckboxes = displayOrder.map(dayIndex => `
    <input type="checkbox" class="week-day-checkbox" data-day="${dayIndex}" checked>
    <span>${weekDays[dayIndex]}</span>
`).join('');
```

**为什么这样做？**
- `data-day` 保持与存储一致（0=周日是Chrome/JS标准）
- 显示顺序符合用户习惯（周一开始）
- 不影响底层逻辑和数据存储

#### 效果
```
之前：☑周日 ☑周一 ☑周二 ☑周三 ☑周四 ☑周五 ☑周六

现在：☑周一 ☑周二 ☑周三 ☑周四 ☑周五 ☑周六 ☑周日
```

---

### 2. ✅ 默认时间输入框居中

#### 问题
时间输入框紧贴着"默认时间:"标签，没有利用右侧空间。

#### 解决方案
在标签和输入框之间添加一个flex容器，让输入框在右侧区域居中。

**实现代码：**
```html
<div style="display: flex; align-items: center;">
    <span>默认时间:</span>
    
    <!-- 新增：flex容器让输入框居中 -->
    <div style="flex: 1; display: flex; justify-content: center;">
        <input type="time" id="regularDefaultTime" value="10:00" 
               style="width: auto;">
    </div>
</div>
```

**布局说明：**
- 外层flex容器：左侧标签 + 右侧可伸缩区域
- 内层flex容器：`flex: 1` 占据剩余空间，`justify-content: center` 让输入框居中
- 输入框：`width: auto` 自适应内容宽度

#### 效果
```
之前：
默认时间: [10:00]
          ↑紧贴

现在：
默认时间:              [10:00]
                        ↑居中
```

---

### 3. ✅ 小时/分钟间隔内容居中

#### 问题
"每 [2] 小时" 这部分内容紧贴标签，右侧开关也挤在一起。

#### 解决方案
使用与"默认时间"相同的布局：标签左对齐，内容居中，开关右对齐。

**实现代码：**
```html
<!-- 小时间隔 -->
<div style="display: flex; align-items: center;">
    <span>小时间隔:</span>
    
    <!-- 新增：flex容器让内容居中 -->
    <div style="flex: 1; display: flex; align-items: center; justify-content: center;">
        <span>每</span>
        <input type="number" value="2" style="width: 50px;">
        <span>小时</span>
    </div>
    
    <label class="switch">
        <input type="checkbox" id="hourIntervalSwitch">
        <span class="slider"></span>
    </label>
</div>

<!-- 分钟间隔：同样结构 -->
<div style="display: flex; align-items: center;">
    <span>分钟间隔:</span>
    
    <div style="flex: 1; display: flex; align-items: center; justify-content: center;">
        <span>每</span>
        <input type="number" value="30" style="width: 50px;">
        <span>分钟</span>
    </div>
    
    <label class="switch">
        <input type="checkbox" id="minuteIntervalSwitch" checked>
        <span class="slider"></span>
    </label>
</div>
```

#### 效果
```
之前：
小时间隔: 每 [2] 小时                       [开关]
          ↑紧贴

现在：
小时间隔:           每 [2] 小时             [开关]
                      ↑居中                  ↑右侧
```

---

## 📐 最终UI效果

```
┌──────────────────────────────────────────────┐
│  自动备份设置                             × │
├──────────────────────────────────────────────┤
│  [-] 常规时间                     [●    ]   │
│                                              │
│      选择备份日期:                           │
│                                              │
│          ☑周一 ☑周二 ☑周三 ☑周四             │
│          ☑周五 ☑周六 ☑周日                   │
│            ↑ 周日在最后 ↑                    │
│                                              │
│      默认时间:              [10:00]          │
│      小时间隔:           每 [2] 小时  [OFF]  │
│      分钟间隔:          每 [30] 分钟  [ON]   │
│      ↑ 标签左对齐    ↑ 内容居中   ↑ 开关右侧 │
└──────────────────────────────────────────────┘
```

---

## 🔧 修改的文件

### settings-ui.js

#### 1. createRegularTimeBlock() - 周几顺序调整

**修改前：**
```javascript
const weekCheckboxes = weekDays.map((day, index) => `
    <input data-day="${index}">
    <span>${day}</span>
`).join('');
```

**修改后：**
```javascript
const displayOrder = [1, 2, 3, 4, 5, 6, 0]; // 周一到周日
const weekCheckboxes = displayOrder.map(dayIndex => `
    <input data-day="${dayIndex}">
    <span>${weekDays[dayIndex]}</span>
`).join('');
```

#### 2. createRegularTimeBlock() - 默认时间居中

**修改前：**
```html
<span>默认时间:</span>
<input type="time" id="regularDefaultTime">
```

**修改后：**
```html
<span>默认时间:</span>
<div style="flex: 1; display: flex; justify-content: center;">
    <input type="time" id="regularDefaultTime" style="width: auto;">
</div>
```

#### 3. createRegularTimeBlock() - 小时/分钟间隔居中

**修改前：**
```html
<div style="display: flex; justify-content: space-between;">
    <div style="display: flex;">
        <span>小时间隔:</span>
        <span>每</span><input><span>小时</span>
    </div>
    <label class="switch">...</label>
</div>
```

**修改后：**
```html
<div style="display: flex; align-items: center;">
    <span>小时间隔:</span>
    <div style="flex: 1; display: flex; justify-content: center;">
        <span>每</span><input><span>小时</span>
    </div>
    <label class="switch">...</label>
</div>
```

#### 4. applyLanguageToUI() - 周几文本更新逻辑

**修改前：**
```javascript
weekCheckboxes.forEach((cb, index) => {
    span.textContent = weekDays[index];
});
```

**修改后：**
```javascript
weekCheckboxes.forEach(cb => {
    const dayIndex = parseInt(cb.getAttribute('data-day'));
    span.textContent = weekDays[dayIndex];
});
```

---

## 🧪 测试清单

### 周几顺序
- [ ] 打开常规时间
- [ ] 勾选框顺序：周一、周二、周三、周四、周五、周六、**周日**
- [ ] 周日在最后一个位置
- [ ] 切换语言，顺序保持不变
- [ ] 勾选/取消勾选，功能正常

### 默认时间居中
- [ ] "默认时间:" 左对齐
- [ ] 时间输入框在右侧区域居中显示
- [ ] 输入框宽度自适应（不过宽）
- [ ] 可以正常选择时间

### 小时/分钟间隔居中
- [ ] "小时间隔:" 左对齐
- [ ] "每 [2] 小时" 整体居中
- [ ] 开关在最右侧
- [ ] "分钟间隔:" 同样布局
- [ ] 三个冒号（默认时间、小时间隔、分钟间隔）垂直对齐

### 语言切换
- [ ] 切换到英文
- [ ] 周几文本更新：Mon, Tue, Wed, Thu, Fri, Sat, **Sun**
- [ ] Sun在最后一个位置
- [ ] 布局不变，居中效果保持

### 数据保存
- [ ] 勾选不同的周几
- [ ] 保存设置
- [ ] 重新打开对话框
- [ ] 勾选状态正确恢复

---

## 📊 技术要点

### 为什么使用displayOrder映射？
- **保持兼容性**：`data-day` 与Chrome/JS标准一致（0=周日）
- **改变显示**：用户看到的是周一到周日
- **不影响逻辑**：存储、计算、判断都基于 `data-day`

### 为什么使用flex容器居中？
- **灵活布局**：三列布局（标签-内容-开关）
- **响应式**：内容自动适应宽度变化
- **视觉平衡**：标签左、内容中、开关右，层次清晰

### 为什么width: auto？
- **自适应**：时间输入框只占需要的宽度
- **不过宽**：避免输入框占满整个居中区域
- **美观**：保持紧凑的视觉效果

---

## 📊 对比总结

| 项目 | 之前 | 现在 |
|------|------|------|
| 周几顺序 | 周日在开头 | 周日在结尾 |
| 默认时间 | 紧贴标签 | 右侧居中 |
| 小时间隔 | 紧贴标签 | 居中显示 |
| 分钟间隔 | 紧贴标签 | 居中显示 |
| 整体布局 | 左对齐 | 标签左+内容中+开关右 |

---

**所有优化已完成！** 🎉

周几顺序符合习惯，内容居中视觉平衡，整体布局更加美观。
