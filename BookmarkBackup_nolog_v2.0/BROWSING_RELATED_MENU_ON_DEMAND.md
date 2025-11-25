# 书签关联页面 - 菜单按需显示和右对齐

## 更新时间
2025-11-25

## 🎯 优化目标

### 问题1：菜单应该按需显示
**需求**：只显示数据中实际存在的时间段，空的不显示

**示例**：
- 如果数据中只有 11:30 和 14:20，则当天菜单只显示：`11:00-11:59` 和 `14:00-14:59`
- 如果当周只有周一和周三有数据，则只显示这两天
- 如果当月只有第20周、第21周有数据，则只显示这两周
- 如果当年只有1月、3月、5月有数据，则只显示这三个月

### 问题2：菜单应该右对齐
**需求**：菜单按钮右对齐显示

## ✅ 实现方案

### 1. 新增数据获取函数

```javascript
// 获取书签关联历史数据（不渲染，仅返回数据）
async function getBrowsingRelatedHistoryData(range = 'day') {
    const browserAPI = (typeof chrome !== 'undefined') ? chrome : browser;
    if (!browserAPI || !browserAPI.history || !browserAPI.history.search) {
        return [];
    }

    try {
        const startTime = getTimeRangeStart(range);
        const endTime = Date.now();

        const historyItems = await new Promise((resolve, reject) => {
            browserAPI.history.search({
                text: '',
                startTime: startTime,
                endTime: endTime,
                maxResults: 0
            }, (results) => {
                if (browserAPI.runtime && browserAPI.runtime.lastError) {
                    reject(browserAPI.runtime.lastError);
                } else {
                    resolve(results || []);
                }
            });
        });

        return historyItems;
    } catch (error) {
        console.error('[BrowsingRelated] 获取历史数据失败:', error);
        return [];
    }
}
```

**作用**：在生成菜单前先获取历史数据，用于分析有哪些时间段

### 2. 修改菜单生成主函数

```javascript
async function showBrowsingRelatedTimeMenu(range) {
    const menuContainer = document.getElementById('browsingRelatedTimeMenu');
    if (!menuContainer) return;

    menuContainer.innerHTML = '';
    menuContainer.style.display = 'none';
    browsingRelatedTimeFilter = null;

    // ✨ 先获取数据
    const historyData = await getBrowsingRelatedHistoryData(range);
    if (!historyData || historyData.length === 0) {
        return; // 没有数据，不显示菜单
    }

    const now = new Date();

    // 传入数据给渲染函数
    switch (range) {
        case 'day':
            renderDayHoursMenu(menuContainer, now, historyData);
            break;
        case 'week':
            renderWeekDaysMenu(menuContainer, now, historyData);
            break;
        case 'month':
            renderMonthWeeksMenu(menuContainer, now, historyData);
            break;
        case 'year':
            renderYearMonthsMenu(menuContainer, now, historyData);
            break;
    }
}
```

**变化**：
1. 函数改为 `async`
2. 调用 `getBrowsingRelatedHistoryData()` 获取数据
3. 将数据传给各个渲染函数

### 3. 修改各渲染函数

#### 当天菜单

```javascript
function renderDayHoursMenu(container, date, historyData) {
    if (!historyData || historyData.length === 0) return;

    // ✨ 分析数据中有哪些小时
    const hoursSet = new Set();
    historyData.forEach(item => {
        if (item.lastVisitTime) {
            const itemDate = new Date(item.lastVisitTime);
            hoursSet.add(itemDate.getHours());
        }
    });

    if (hoursSet.size === 0) return;

    // 排序小时
    const hours = Array.from(hoursSet).sort((a, b) => a - b);

    // 只渲染有数据的小时段
    hours.forEach(hour => {
        // ... 生成按钮
    });
}
```

**逻辑**：
1. 遍历所有历史数据
2. 提取 `hours`（0-23）到 `Set`
3. 排序后只渲染这些小时段

#### 当周菜单

```javascript
function renderWeekDaysMenu(container, date, historyData) {
    if (!historyData || historyData.length === 0) return;

    // ✨ 分析数据中有哪些天
    const daysSet = new Set();
    historyData.forEach(item => {
        if (item.lastVisitTime) {
            const itemDate = new Date(item.lastVisitTime);
            daysSet.add(itemDate.toDateString());
        }
    });

    if (daysSet.size === 0) return;

    // 遍历本周7天
    for (let i = 0; i < 7; i++) {
        const dayDate = new Date(weekStart);
        dayDate.setDate(weekStart.getDate() + i);
        
        // ✨ 只显示有数据的天
        if (!daysSet.has(dayDate.toDateString())) continue;
        
        // ... 生成按钮
    }
}
```

**逻辑**：
1. 提取所有日期的 `toDateString()` 到 `Set`
2. 遍历本周7天，用 `continue` 跳过没有数据的天

#### 当月菜单

```javascript
function renderMonthWeeksMenu(container, date, historyData) {
    if (!historyData || historyData.length === 0) return;

    // ✨ 分析数据中有哪些周
    const weeksSet = new Set();
    historyData.forEach(item => {
        if (item.lastVisitTime) {
            const itemDate = new Date(item.lastVisitTime);
            const weekNum = getWeekNumberForRelated(itemDate);
            weeksSet.add(weekNum);
        }
    });

    if (weeksSet.size === 0) return;

    const sortedWeeks = Array.from(weeksSet).sort((a, b) => a - b);

    // 只渲染有数据的周
    sortedWeeks.forEach(weekNum => {
        // ... 生成按钮
    });
}
```

**逻辑**：
1. 提取所有日期的周数到 `Set`
2. 排序后只渲染这些周

#### 当年菜单

```javascript
function renderYearMonthsMenu(container, date, historyData) {
    if (!historyData || historyData.length === 0) return;

    // ✨ 分析数据中有哪些月份
    const monthsSet = new Set();
    historyData.forEach(item => {
        if (item.lastVisitTime) {
            const itemDate = new Date(item.lastVisitTime);
            monthsSet.add(itemDate.getMonth());
        }
    });

    if (monthsSet.size === 0) return;

    const months = Array.from(monthsSet).sort((a, b) => a - b);

    // 只渲染有数据的月份
    months.forEach(month => {
        // ... 生成按钮
    });
}
```

**逻辑**：
1. 提取所有日期的月份（0-11）到 `Set`
2. 排序后只渲染这些月份

### 4. CSS右对齐

```css
.time-menu-items {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: flex-end; /* 右对齐 */
}
```

## 📦 修改文件

### 1. history.js
- **新增函数**：`getBrowsingRelatedHistoryData(range)` - 获取历史数据
- **修改函数**：`showBrowsingRelatedTimeMenu(range)` - 改为async，传入数据
- **修改函数**：`renderDayHoursMenu(container, date, historyData)` - 按需显示
- **修改函数**：`renderWeekDaysMenu(container, date, historyData)` - 按需显示
- **修改函数**：`renderMonthWeeksMenu(container, date, historyData)` - 按需显示
- **修改函数**：`renderYearMonthsMenu(container, date, historyData)` - 按需显示

### 2. history.css
- **修改样式**：`.time-menu-items` - 添加 `justify-content: flex-end`

## 🎨 视觉效果（修复后）

### 示例：当天只有部分小时有数据

```
┌──────────────────────────────────────────────────────┐
│ [排序] [当天▼] [当周] [当月] [当年]                    │
└──────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────┐
│           08:00-08:59  11:00-11:59  14:00-14:59  ← 右对齐 │
└──────────────────────────────────────────────────────┘
```

**只显示有数据的时间段！**

### 示例：当周只有周一、周三、周五有数据

```
┌──────────────────────────────────────────────────────┐
│ [排序] [当天] [当周▼] [当月] [当年]                    │
└──────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────┐
│                星期一  星期三  星期五  ← 右对齐         │
└──────────────────────────────────────────────────────┘
```

## 🔍 技术细节

### 数据分析逻辑

1. **当天**：`itemDate.getHours()` → Set<number>
2. **当周**：`itemDate.toDateString()` → Set<string>
3. **当月**：`getWeekNumberForRelated(itemDate)` → Set<number>
4. **当年**：`itemDate.getMonth()` → Set<number>

### 性能优化

- 使用 `Set` 去重，避免重复计算
- 数据只查询一次，传给渲染函数
- 空数据直接返回，不渲染菜单

## ✅ 验证清单

- [x] 当天：只显示有数据的小时段
- [x] 当周：只显示有数据的天
- [x] 当月：只显示有数据的周
- [x] 当年：只显示有数据的月份
- [x] 菜单右对齐
- [x] 空数据不显示菜单
- [x] 数据按时间排序（早→晚）

## 🎉 总结

优化完成！

**实现效果**：
- ✅ 菜单按需显示（只显示有数据的时间段）
- ✅ 菜单右对齐
- ✅ 性能优化（数据只查询一次）
- ✅ 所有时间范围（当天/当周/当月/当年）全部支持
