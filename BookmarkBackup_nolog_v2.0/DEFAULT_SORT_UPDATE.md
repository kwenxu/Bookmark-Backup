# 日历默认排序优化

## 更新日期
2025-11-24

## 更新摘要
将「书签添加记录」和「点击记录」两个日历视图的默认排序方式从**正序**改为**倒序**，最新的记录显示在最前面，更符合用户查看习惯。

## 修改详情

### 1. 书签添加记录日历
**文件：** `history_html/bookmark_calendar.js`  
**位置：** 第75行

```javascript
// 修改前
this.bookmarkSortAsc = true; // 书签排序：true=正序，false=倒序

// 修改后  
this.bookmarkSortAsc = false; // 书签排序：true=正序，false=倒序（默认倒序）
```

### 2. 点击记录日历  
**文件：** `history_html/browsing_history_calendar.js`  
**位置：** 第130行

```javascript
// 修改前
this.bookmarkSortAsc = true; // 书签排序：true=正序，false=倒序

// 修改后
this.bookmarkSortAsc = false; // 书签排序：true=正序，false=倒序（默认倒序）
```

## 功能说明

### 排序模式
- **正序**（`bookmarkSortAsc = true`）：时间从旧到新（1→10）
- **倒序**（`bookmarkSortAsc = false`）：时间从新到旧（10→1）✅ **新默认值**

### 用户交互
- ✅ 用户可以随时通过界面上的排序按钮手动切换正序/倒序
- ✅ 用户的排序选择会自动保存到 localStorage
- ✅ 下次打开时会恢复上次的排序选择
- ✅ 只有首次使用或清除缓存后才会使用新的默认倒序

### 影响范围

#### 书签添加记录日历
- ✅ 年视图
- ✅ 月视图  
- ✅ 周视图
- ✅ 日视图
- ✅ 小时分组排序

#### 点击记录日历
- ✅ 年视图
- ✅ 月视图
- ✅ 周视图  
- ✅ 日视图
- ✅ 小时分组排序

### 兼容性
- ✅ 不影响已有用户的排序偏好设置
- ✅ localStorage 中已保存的排序状态优先级更高
- ✅ 仅在首次使用或缓存清空时应用新默认值
- ✅ 排序按钮图标和文字会根据当前状态自动更新

## 设计理由

### 为什么改为倒序？
1. **查看最新内容**：用户通常更关心最近的书签和点击记录
2. **减少滚动**：最新的内容在顶部，无需滚动到底部查看
3. **符合习惯**：大多数日志、历史记录类应用默认都是新→旧排序
4. **保持一致**：与「备份历史」视图的默认排序保持一致

### 为什么保留手动切换？
- 某些场景下用户可能需要查看最早的记录
- 提供灵活性，让用户自由选择排序方式
- 排序状态持久化，符合用户习惯

## 技术实现

### localStorage 键名
- 书签添加记录：`bookmarkCalendar_sortAsc`
- 点击记录：`browsingHistoryCalendar_sortAsc`

### 初始化逻辑
```javascript
// 构造函数中设置默认值
this.bookmarkSortAsc = false; // 默认倒序

// 后续从 localStorage 恢复（如果有保存）
if (savedSortAsc !== null) {
    this.bookmarkSortAsc = savedSortAsc === 'true';
}
```

### 排序实现
```javascript
const sortedBookmarks = [...bookmarks].sort((a, b) => {
    const timeCompare = a.dateAdded - b.dateAdded;
    return this.bookmarkSortAsc ? timeCompare : -timeCompare;
});
```

## 测试建议

### 测试步骤
1. **清除缓存测试**：
   - 清除浏览器 localStorage
   - 打开「书签记录」→「书签添加记录」
   - 验证默认为倒序（最新的在上面）
   - 打开「书签记录」→「书签浏览记录」→「点击记录」
   - 验证默认为倒序

2. **排序切换测试**：
   - 点击排序按钮
   - 验证排序方向切换
   - 验证图标和文字更新
   - 刷新页面，验证排序状态保持

3. **兼容性测试**：
   - 如果之前设置过排序偏好
   - 验证升级后保持原有偏好不变

### 预期结果
- ✅ 首次打开默认倒序
- ✅ 排序按钮可正常切换
- ✅ 刷新后保持上次选择
- ✅ 所有视图层级（年/月/周/日）都生效
- ✅ 图标和提示文字正确显示

## 相关文档
- [点击记录优化说明](./CLICK_HISTORY_UPDATE.md)
