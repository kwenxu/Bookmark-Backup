# 书签关联记录 - 匹配算法更新

## 更新日期
2025-11-24

## 问题背景

之前「书签关联记录」功能只基于 **URL** 来匹配书签和浏览器历史记录。但是根据 commit `01cc2012` 中的「点击记录」优化，发现：

> 用户发现：**再次添加进去的书签，书签的标题是一样的**，因此建议加入标题判断。

当书签被删除后重新添加时，虽然 URL 相同，但如果标题变化或 URL 略有不同，可能导致匹配失败。

## 解决方案

### 采用 URL + 标题双重匹配算法

与「点击记录」保持一致，使用 **URL 或标题的并集匹配**：

- **条件1**：URL 匹配（原有逻辑）
- **条件2**：标题匹配（新增逻辑，去除空白后比较）
- **匹配规则**：只要**任意一个条件**通过，就认为是匹配的记录

## 代码修改

### 1. 新增全局变量

```javascript
let browsingRelatedBookmarkTitles = null; // 缓存的书签标题集合
```

### 2. 修改函数名和逻辑

#### `getBookmarkUrls()` → `getBookmarkUrlsAndTitles()`

**修改前（只收集URL）**：
```javascript
async function getBookmarkUrls() {
    const urls = new Set();
    
    const collectUrls = (nodes) => {
        for (const node of nodes) {
            if (node.url) {
                urls.add(node.url);
            }
            if (node.children) {
                collectUrls(node.children);
            }
        }
    };
    
    // ...
    return urls;
}
```

**修改后（同时收集URL和标题）**：
```javascript
async function getBookmarkUrlsAndTitles() {
    const urls = new Set();
    const titles = new Set();
    
    const collectUrlsAndTitles = (nodes) => {
        for (const node of nodes) {
            if (node.url) {
                urls.add(node.url);
                // 同时收集标题（去除空白后存储）
                if (node.title && node.title.trim()) {
                    titles.add(node.title.trim());
                }
            }
            if (node.children) {
                collectUrlsAndTitles(node.children);
            }
        }
    };
    
    // ...
    browsingRelatedBookmarkUrls = urls;
    browsingRelatedBookmarkTitles = titles;
    return { urls, titles };
}
```

#### `loadBrowsingRelatedHistory()`

**修改前**：
```javascript
const bookmarkUrls = await getBookmarkUrls();
// ...
renderBrowsingRelatedList(listContainer, historyItems, bookmarkUrls, range);
```

**修改后**：
```javascript
const { urls: bookmarkUrls, titles: bookmarkTitles } = await getBookmarkUrlsAndTitles();
// ...
renderBrowsingRelatedList(listContainer, historyItems, bookmarkUrls, bookmarkTitles, range);
```

#### `renderBrowsingRelatedList()`

**修改前（只匹配URL）**：
```javascript
const isBookmark = bookmarkUrls.has(item.url);
```

**修改后（匹配URL或标题）**：
```javascript
// 使用URL或标题进行匹配（并集逻辑）
let isBookmark = false;

// 条件1：URL匹配
if (bookmarkUrls.has(item.url)) {
    isBookmark = true;
}

// 条件2：标题匹配（去除空白后比较）
if (!isBookmark && item.title && item.title.trim() && bookmarkTitles.has(item.title.trim())) {
    isBookmark = true;
}
```

### 3. 更新缓存清理逻辑

`refreshBrowsingRelatedHistory()` 中添加：
```javascript
browsingRelatedBookmarkTitles = null;
```

## 影响范围

### 直接影响
「书签关联记录」功能：
- 会显示更多匹配的书签记录
- 即使 URL 不同，只要标题相同也能匹配
- 提高了书签识别的准确性和容错性

### 保持一致性
现在「书签关联记录」和「点击记录」使用**完全相同**的匹配算法，确保了功能的一致性。

## 使用场景

### 1. 书签重新添加
```
场景：删除书签后重新添加
原URL：https://example.com/page?id=123
新URL：https://example.com/page?id=456
标题：Example Page（相同）

结果：✅ 能够匹配（通过标题）
```

### 2. URL变化
```
场景：网站改版导致URL变化
旧URL：https://example.com/old-page
新URL：https://example.com/new-page
标题：Example Page（不变）

结果：✅ 能够匹配（通过标题）
```

### 3. 标题相似
```
场景：多个书签有相同标题
URL1：https://site1.com/page
URL2：https://site2.com/page
标题：同名页面

结果：⚠️ 两个书签的历史都会被标识（需注意）
```

## 注意事项

1. **标题处理**
   - 标题会去除首尾空白后进行比较
   - 空标题不会被收集和匹配
   - 标题匹配是**大小写敏感**的

2. **重名问题**
   - 如果多个书签有相同标题但不同 URL
   - 它们的历史记录可能会被合并显示
   - 这是预期行为，符合用户「标题相同即相关」的认知

3. **性能影响**
   - 额外维护一个标题集合，内存开销极小
   - 匹配时多一次标题检查，性能影响可忽略
   - Set 查找操作为 O(1)，效率很高

## 兼容性

- ✅ 不影响现有缓存数据结构
- ✅ 向后兼容，不会破坏现有功能
- ✅ 与「点击记录」功能保持一致

## 测试建议

### 基本测试
1. 添加一些书签并访问它们
2. 打开「书签关联记录」
3. 验证书签被正确标识（黄色边框）

### 标题匹配测试
1. 删除一个书签
2. 重新添加相同标题但URL略有不同的书签
3. 验证历史记录仍能被识别为书签

### URL变化测试
1. 修改一个书签的URL（保持标题不变）
2. 查看「书签关联记录」
3. 验证旧URL的历史记录仍被标识为书签

## 技术细节

### 匹配逻辑流程图
```
浏览器历史记录 → 过滤匹配
                  ├─ URL匹配？ → 是 → 标记为书签 ✓
                  │              └─ 否 ↓
                  └─ 标题匹配？ → 是 → 标记为书签 ✓
                                 └─ 否 → 普通记录
```

### 数据结构
```javascript
// 书签数据
browsingRelatedBookmarkUrls: Set<string>    // URL集合
browsingRelatedBookmarkTitles: Set<string>  // 标题集合（已trim）

// 匹配逻辑
isBookmark = (url in URLs) OR (title.trim() in Titles)
```

### 复杂度分析
- **空间复杂度**：O(n)，n为书签数量
- **时间复杂度**：O(m)，m为历史记录数量（每条记录最多2次Set查找）
- **查找效率**：Set.has() 为 O(1)

## 与点击记录的对比

| 功能 | 点击记录 | 书签关联记录 | 一致性 |
|------|---------|-------------|--------|
| 数据源 | 浏览器历史记录 | 浏览器历史记录 | ✅ 相同 |
| 匹配算法 | URL + 标题 | URL + 标题 | ✅ 相同 |
| 匹配逻辑 | 并集（OR） | 并集（OR） | ✅ 相同 |
| 标题处理 | trim() | trim() | ✅ 相同 |
| 实现代码 | `browsing_history_calendar.js` | `history.js` | 不同文件 |

## 参考

- 原始提交：`01cc2012bcba16f5f96aed70aa2a57feb23824a3`
- 相关文档：`CLICK_HISTORY_UPDATE.md`
- 实现文件：`history_html/history.js`

---

**版本**：v2.1  
**更新时间**：2025-11-24  
**状态**：已完成 ✅
