# 点击记录优化更新说明

## 更新日期
2025-11-24

## 更新内容

### 🆕 默认排序优化（2025-11-24）
- ✅ **书签添加记录**日历：默认改为**倒序排列**（最新的在前）
- ✅ **点击记录**日历：默认改为**倒序排列**（最新的在前）
- 用户仍可以通过排序按钮手动切换正序/倒序
- 排序状态会保存到 localStorage，下次打开保持上次选择

---

### 问题描述
之前的「点击记录」功能只基于URL来匹配书签和浏览器历史记录。当书签被删除后重新添加时，虽然URL相同，但如果书签的ID变化了，可能导致记录丢失或不准确。

用户发现：**再次添加进去的书签，书签的标题是一样的**，因此建议加入标题判断。

### 解决方案
修改「点击记录」的匹配算法，使用**URL或标题的并集匹配**：
- 条件1：URL匹配（原有逻辑）
- 条件2：标题匹配（新增逻辑）
- 只要**任意一个条件通过**，就认为是匹配的记录

### 修改文件
1. `history_html/browsing_history_calendar.js`（点击记录日历）
2. `history_html/bookmark_calendar.js`（书签添加记录日历）

### 具体修改

#### 1. 新增 `collectBookmarkUrlsAndTitles` 方法
同时收集书签的URL和标题（去除空白后存储）：

```javascript
collectBookmarkUrlsAndTitles(node, urlSet, titleSet) {
    if (node.url) {
        urlSet.add(node.url);
        // 同时收集标题（去除空白后存储）
        if (node.title && node.title.trim()) {
            titleSet.add(node.title.trim());
        }
    }

    if (node.children) {
        node.children.forEach(child => this.collectBookmarkUrlsAndTitles(child, urlSet, titleSet));
    }
}
```

#### 2. 修改 `loadBookmarkData` 方法
使用URL和标题两个集合进行匹配：

```javascript
// 修改前（只匹配URL）
const relevantHistoryItems = historyItems.filter(item => bookmarkUrls.has(item.url));

// 修改后（匹配URL或标题）
const relevantHistoryItems = historyItems.filter(item => {
    // 条件1：URL匹配
    if (bookmarkUrls.has(item.url)) {
        return true;
    }
    // 条件2：标题匹配（去除空白后比较）
    if (item.title && item.title.trim() && bookmarkTitles.has(item.title.trim())) {
        return true;
    }
    return false;
});
```

### 影响范围

#### 1. 点击记录（直接影响）
- 日历视图中的点击记录会显示更多匹配项
- 即使URL不同，只要标题相同也能匹配

#### 2. 点击排行（间接影响）
- 「点击排行」功能基于「点击记录」的数据
- 修改会**自动生效**到点击排行统计中
- 排行榜会包含更多通过标题匹配的记录

### 兼容性
- 保留了原有的 `collectBookmarkUrls` 方法，确保向后兼容
- 不影响现有的缓存数据结构
- 增量同步机制仍然正常工作

### 使用场景
1. **书签重新添加**：删除书签后重新添加，即使URL略有变化，也能通过标题匹配到历史记录
2. **相似书签**：标题相同的书签会被识别为同一项（需要注意重名问题）
3. **URL变化**：网站改版导致URL变化，但页面标题不变时仍能匹配

### 注意事项
1. 标题匹配会去除首尾空白后进行比较
2. 空标题不会被收集和匹配
3. 如果多个书签有相同标题但不同URL，它们的历史记录会被合并显示

### 测试建议
1. 删除一个书签，然后重新添加（标题相同，URL可能略有不同）
2. 打开「书签记录」→「书签浏览记录」→「点击记录」
3. 验证是否能看到之前的访问记录
4. 检查「点击排行」是否也反映了新的匹配逻辑

## 默认排序修改详情

### 修改位置

**1. 书签添加记录日历** (`bookmark_calendar.js` 第75行)
```javascript
// 修改前
this.bookmarkSortAsc = true; // 书签排序：true=正序，false=倒序

// 修改后
this.bookmarkSortAsc = false; // 书签排序：true=正序，false=倒序（默认倒序）
```

**2. 点击记录日历** (`browsing_history_calendar.js` 第130行)
```javascript
// 修改前
this.bookmarkSortAsc = true; // 书签排序：true=正序，false=倒序

// 修改后
this.bookmarkSortAsc = false; // 书签排序：true=正序，false=倒序（默认倒序）
```

### 排序逻辑
- `bookmarkSortAsc = true`：正序（旧→新，时间从小到大）
- `bookmarkSortAsc = false`：倒序（新→旧，时间从大到小）✅ **新默认值**
- 用户点击排序按钮时会切换该值并保存到 localStorage
- 下次打开时优先使用 localStorage 中保存的值

### 影响范围
- ✅ 书签添加记录的所有视图（年/月/周/日）
- ✅ 点击记录的所有视图（年/月/周/日）
- ✅ 不影响已保存的用户排序偏好
- ✅ 首次使用或清除缓存后采用新的倒序默认值

---

## 技术细节

### 匹配逻辑流程
```
浏览器历史记录 → 过滤匹配
                  ├─ URL匹配？ → 是 → 加入结果
                  └─ 标题匹配？ → 是 → 加入结果
                                 └─ 否 → 跳过
```

### 数据结构
- `bookmarkUrls`: Set<string> - 所有书签的URL集合
- `bookmarkTitles`: Set<string> - 所有书签的标题集合（已trim）
- 两个集合并行维护，匹配时使用并集逻辑

### 性能影响
- 额外维护一个标题集合，内存开销极小
- 匹配时多一次标题检查，性能影响可忽略
- Set查找操作为O(1)，效率很高
