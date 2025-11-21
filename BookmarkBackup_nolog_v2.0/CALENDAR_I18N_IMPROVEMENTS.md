# 日历国际化改进说明

## 修改内容

### 1. 中文月份名称改为数字格式

**问题**: 中文显示"一月"、"二月"......"十月"不够简洁  
**修改**: 统一改为"1月"、"2月"......"10月"

#### 修改位置

**文件1**: `history_html/history.js`
```javascript
// 修改前
calendarMonthNames: {
    'zh_CN': ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'],
    'en': ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
}

// 修改后
calendarMonthNames: {
    'zh_CN': ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
    'en': ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
}
```

**文件2**: `history_html/bookmark_calendar.js`
```javascript
// 修改前
function tm(index) {
    if (typeof i18n === 'undefined' || typeof currentLang === 'undefined') {
        return ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'][index];
    }
    return i18n.calendarMonthNames[currentLang][index] || '';
}

// 修改后
function tm(index) {
    if (typeof i18n === 'undefined' || typeof currentLang === 'undefined') {
        return ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'][index];
    }
    return i18n.calendarMonthNames[currentLang][index] || '';
}
```

#### 影响范围

- ✅ 地址栏面包屑: `2024年10月` → `2024年10月`
- ✅ 年视图: 所有月份名称
- ✅ 月视图导航标题
- ✅ 周视图日期范围显示
- ✅ 日视图标题

### 2. 补全翻译 - "勾选"按钮

**问题**: "勾选"按钮没有英文翻译  
**修改**: 添加 `calendarSelectMode` 翻译键

#### 修改位置

**history_html/history.js**

```javascript
// 添加翻译定义
calendarSelectMode: {
    'zh_CN': '勾选',
    'en': 'Select'
}

// 在 applyLanguage() 函数中添加
const calendarSelectModeText = document.getElementById('calendarSelectModeText');
if (calendarSelectModeText) calendarSelectModeText.textContent = i18n.calendarSelectMode[currentLang];
```

#### 效果

- 中文: **勾选**
- 英文: **Select**

### 3. 补全翻译 - "定位至今天"按钮

**问题**: "定位至今天"按钮没有英文翻译  
**修改**: 添加 `calendarLocateToday` 翻译键

#### 修改位置

**history_html/history.js**

```javascript
// 添加翻译定义
calendarLocateToday: {
    'zh_CN': '定位至今天',
    'en': 'Locate Today'
}

// 在 applyLanguage() 函数中添加
const calendarLocateTodayText = document.getElementById('calendarLocateTodayText');
if (calendarLocateTodayText) calendarLocateTodayText.textContent = i18n.calendarLocateToday[currentLang];
```

#### 效果

- 中文: **定位至今天**
- 英文: **Locate Today**

## 参考已有的翻译模式

参考了 `navAdditions` 的实现方式:

```javascript
// i18n定义
navAdditions: {
    'zh_CN': '书签记录',
    'en': 'Bookmark Records'
}

// HTML中的元素ID
<span id="navAdditionsText">书签记录</span>

// applyLanguage()中的更新
document.getElementById('navAdditionsText').textContent = i18n.navAdditions[currentLang];
```

## 测试清单

- [x] 中文模式下月份显示为数字格式(1月-12月)
- [x] 英文模式下月份显示为英文名称(January-December)
- [x] 切换语言时"勾选"按钮文字正确切换
- [x] 切换语言时"定位至今天"按钮文字正确切换
- [x] 年视图所有月份名称正确
- [x] 面包屑导航月份显示正确
- [x] 刷新页面后语言设置保持

## 修改文件清单

- ✅ `history_html/history.js` - 添加翻译定义和更新逻辑
- ✅ `history_html/bookmark_calendar.js` - 更新降级方案中的月份名称

---

**修改日期**: 2025-11-21  
**影响范围**: 日历视图的国际化显示  
**向后兼容**: ✅ 完全兼容
