# 日历周数修复说明

## 问题描述

月视图的日历左侧周数、左下方一级菜单显示的周数、以及右下方显示的周数不一致。经检查,是日历左侧的周数算错了,少算了一周。

## ISO 8601 周数标准

### 核心规则

1. **一周从周一开始**(全球统一,不区分地区)
2. **第一周的定义**:包含当年第一个**周四**的那一周
3. **跨年规则**:
   - 如果1月1日是周五、周六、周日,则这几天属于**上一年**的最后一周
   - 如果12月29日、30日、31日是周一、周二、周三,则这几天属于**下一年**的第一周
   - 每年第一周必须包含至少4天属于新年

### JavaScript 实现

```javascript
// ISO 8601 周数计算(全球统一标准)
getWeekNumber(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    // 将日期调整到当周的周四
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    // 获取该周四所在年份的1月1日
    const yearStart = new Date(d.getFullYear(), 0, 1);
    // 计算周数
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return weekNo;
}
```

## 解决方案

### 1. 周数计算统一使用 ISO 8601 标准

- ✅ 所有周数计算都基于**周一**
- ✅ 遵循"包含周四"规则
- ✅ 正确处理跨年情况

### 2. 显示层面根据语言调整

虽然周数计算统一用ISO 8601,但**日历显示顺序**根据用户语言调整:

| 语言 | 一周开始日 | 日历显示顺序 | 周数计算基准 |
|------|-----------|-------------|-------------|
| 中文 | 周一 | 周一→周日 | 周一(ISO 8601) |
| 英文 | 周日 | 周日→周六 | 周一(ISO 8601) |

### 3. 修复内容

#### 修复点1: 月视图左侧周数计算
**问题**: 使用了错误的周开始日计算周数  
**修复**: 改为基于当月第一天所在周的**周一**计算

```javascript
// 修复前(错误)
let currentWeekStart = new Date(firstDay);
currentWeekStart.setDate(firstDay.getDate() - firstDay.getDay()); // 周日开始

// 修复后(正确)
let weekMonday = new Date(firstDay);
const firstDayDay = firstDay.getDay() || 7; // 1-7
weekMonday.setDate(firstDay.getDate() - firstDayDay + 1); // 周一开始
```

#### 修复点2: 日历网格空白格计算
**问题**: 固定从周日开始,不支持语言切换  
**修复**: 根据语言动态调整

```javascript
// 获取一周开始日(中文:周一=1, 英文:周日=0)
const weekStartDay = (currentLang === 'zh_CN') ? 1 : 0;

// 计算空白格数量
const firstDayOfWeek = firstDay.getDay();
let blankCells = (firstDayOfWeek - weekStartDay + 7) % 7;
```

#### 修复点3: 星期标题行
**问题**: 固定显示周日→周六  
**修复**: 根据语言调整显示顺序

```javascript
for (let i = 0; i < 7; i++) {
    const dayIndex = (weekStartDay + i) % 7;
    weekday.textContent = tw(dayIndex); // tw()是星期翻译函数
}
```

#### 修复点4: 周视图显示
**问题**: 固定从周一显示  
**修复**: 英文模式从周日开始显示(但周数计算仍用ISO标准)

```javascript
// 中文: 周一(offset=0)到周日
// 英文: 周日(offset=-1)到周六
const displayOffset = weekStartDay === 0 ? -1 : 0;

for (let i = 0; i < 7; i++) {
    const date = new Date(this.currentWeekStart);
    date.setDate(this.currentWeekStart.getDate() + displayOffset + i);
    const dayOfWeek = date.getDay(); // 用实际星期几显示
}
```

#### 修复点5: 所有currentWeekStart赋值
统一改为计算**周一**:

```javascript
// 修复前(错误)
this.currentWeekStart.setDate(date.getDate() - date.getDay());

// 修复后(正确)
const dateDay = date.getDay() || 7;
this.currentWeekStart.setDate(date.getDate() - dateDay + 1);
```

## 使用 JavaScript Intl API

项目代码中虽然可以使用现代浏览器的 `Intl.Locale.prototype.getWeekInfo()` API:

```javascript
// 获取中国大陆地区的周信息
const zhCN = new Intl.Locale("zh-CN");
console.log(zhCN.getWeekInfo().firstDay); // 输出 1 (代表周一)

// 获取美国地区的周信息
const enUS = new Intl.Locale("en-US");
console.log(enUS.getWeekInfo().firstDay); // 输出 7 (代表周日)
```

但考虑到兼容性和明确性,我们选择了**手动实现**,直接根据 `currentLang` 判断。

## 测试建议

1. **周数一致性测试**:
   - 切换到不同月份,检查左侧周数、面包屑周数、下方菜单周数是否一致
   
2. **跨年测试**:
   - 测试2024年12月30日(周一,应属于2025年第1周)
   - 测试2025年1月1日(周三,应属于2025年第1周)
   
3. **语言切换测试**:
   - 中文:日历应从周一开始显示
   - 英文:日历应从周日开始显示
   - 两种语言的周数应保持一致(都遵循ISO 8601)

4. **边界情况**:
   - 点击日期进入日视图,检查面包屑周数
   - 前后翻页,周数连续性
   - 定位至今天按钮

## 参考资料

- [ISO 8601 - Week Numbers](https://en.wikipedia.org/wiki/ISO_8601#Week_dates)
- [MDN - Intl.Locale.prototype.getWeekInfo()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Locale/getWeekInfo)

---

**修复日期**: 2025-11-21  
**影响范围**: `bookmark_calendar.js`  
**向后兼容**: ✅ 完全兼容,用户无需任何操作
