# 书签浏览记录系统重构计划

## 📋 重构目标

将现有的单一数据源架构升级为**三存储库架构**，实现：
1. ✅ 所有浏览器历史记录**真正永久存储**（无时间限制）
2. ✅ 书签库**真正永久存储**并实时同步（无时间限制）
3. ✅ 匹配后的书签历史**真正永久存储**（无时间限制）
4. ✅ 三个标签页共享数据，高效查询
5. ✅ 实时增量更新，无需重复查询
6. ✅ 利用已有的 unlimitedStorage 权限，不做任何数据清理

---

## 🏗️ 新架构设计

### 三个永久存储库

```
┌─────────────────────────────────────────────────────────────────┐
│                      三个永久存储库                              │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 存储库1: AllHistoryDatabase                              │  │
│  │ 键名: 'bb_all_history_v2'                                │  │
│  │                                                            │  │
│  │ 数据源：chrome.history API                               │  │
│  │ 更新机制：chrome.history.onVisited                       │  │
│  │ 存储内容：所有浏览器历史记录（不过滤，永久保留）         │  │
│  │ 存储策略：无时间限制，无数量限制，真正永久存储           │  │
│  │                                                            │  │
│  │ 数据结构：                                                │  │
│  │ {                                                          │  │
│  │   lastSyncTime: timestamp,                                │  │
│  │   records: Map<'YYYY-MM-DD', HistoryRecord[]>             │  │
│  │ }                                                          │  │
│  │                                                            │  │
│  │ 单条记录：                                                │  │
│  │ {                                                          │  │
│  │   id: string,             // 唯一ID（便于删除）          │  │
│  │   url: string,                                            │  │
│  │   title: string,                                          │  │
│  │   visitTime: number,      // 访问时间戳                  │  │
│  │   visitCount: number,     // 访问次数（单次）            │  │
│  │   transition: string,     // 访问方式(link/typed/等)     │  │
│  │   referringVisitId: string // 来源访问ID                 │  │
│  │ }                                                          │  │
│  │                                                            │  │
│  │ 关键方法：                                                │  │
│  │ - add(record)             // 添加记录                    │  │
│  │ - removeByUrl(url)        // ✨ 删除指定URL的所有记录   │  │
│  │ - clear()                 // ✨ 清空所有记录            │  │
│  │ - getByUrl(url)           // 查询指定URL的记录           │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 存储库2: BookmarkDatabase                                │  │
│  │ 键名: 'bb_bookmarks_v2'                                   │  │
│  │                                                            │  │
│  │ 数据源：chrome.bookmarks API                             │  │
│  │ 更新机制：chrome.bookmarks.onCreate/onRemove/onChange    │  │
│  │ 存储内容：当前所有书签的URL和标题集合（永久保留）        │  │
│  │ 存储策略：实时同步，永久保留                             │  │
│  │                                                            │  │
│  │ 数据结构：                                                │  │
│  │ {                                                          │  │
│  │   lastUpdateTime: timestamp,                              │  │
│  │   urls: Set<string>,          // 所有书签URL             │  │
│  │   titles: Set<string>,        // 所有书签标题            │  │
│  │   urlToTitle: Map<url, title> // URL到标题的映射         │  │
│  │ }                                                          │  │
│  │                                                            │  │
│  │ 关键方法：                                                │  │
│  │ - add(bookmark)           // 添加书签                    │  │
│  │ - remove(url, title)      // ✨ 删除书签                │  │
│  │ - update(id, changeInfo)  // 更新书签                    │  │
│  │ - matches(record)         // 判断记录是否匹配书签        │  │
│  │ - hasUrl(url)             // 判断URL是否是书签           │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 存储库3: BookmarkHistoryDatabase                          │  │
│  │ 键名: 'bb_bookmark_history_v2'                            │  │
│  │                                                            │  │
│  │ 数据源：从存储库1和存储库2比对生成                       │  │
│  │ 更新机制：存储库1或存储库2变化时自动更新                 │  │
│  │ 存储内容：匹配书签的历史记录（永久保留）                 │  │
│  │ 存储策略：无时间限制，无数量限制，真正永久存储           │  │
│  │                                                            │  │
│  │ 数据结构：（与存储库1相同）                              │  │
│  │ {                                                          │  │
│  │   lastSyncTime: timestamp,                                │  │
│  │   records: Map<'YYYY-MM-DD', MatchedRecord[]>             │  │
│  │ }                                                          │  │
│  │                                                            │  │
│  │ 匹配规则：                                                │  │
│  │ record.url in 存储库2.urls OR                            │  │
│  │ record.title in 存储库2.titles                           │  │
│  │                                                            │  │
│  │ 关键方法：                                                │  │
│  │ - add(record)             // 添加匹配的书签历史          │  │
│  │ - removeByUrl(url)        // ✨ 删除指定URL的所有记录   │  │
│  │ - clear()                 // ✨ 清空所有记录            │  │
│  │ - getAllUrls()            // 获取所有书签URL集合         │  │
│  └──────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 🔄 完整数据流程图

### 1. 首次初始化流程

```
┌─────────────────────────────────────────────────────────────────┐
│                 用户首次打开「书签浏览记录」                     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│              尝试从持久化存储恢复三个数据库                      │
│                                                                  │
│  存储库1恢复：chrome.storage.local.get('bb_all_history_v2')     │
│  存储库2恢复：chrome.storage.local.get('bb_bookmarks_v2')       │
│  存储库3恢复：chrome.storage.local.get('bb_bookmark_history_v2')│
└────────────────────────────┬────────────────────────────────────┘
                             │
                    ┌────────┴────────┐
                    │                 │
            有缓存存在？           无缓存
                    │                 │
                    ↓                 ↓
        ┌───────────────────┐  ┌──────────────────┐
        │ A. 缓存恢复路径   │  │ B. 全量加载路径  │
        └───────────────────┘  └──────────────────┘

A. 缓存恢复路径：
  ├─ 恢复存储库1（allHistory）
  ├─ 恢复存储库2（bookmarks）
  ├─ 恢复存储库3（bookmarkHistory）
  ├─ 立即显示界面（使用缓存数据）
  └─ 后台启动增量更新
      ├─ 查询 lastSyncTime 之后的新历史记录
      ├─ 查询书签变化
      └─ 增量更新三个存储库

B. 全量加载路径：
  ├─ 步骤1：加载存储库2（书签库）
  │   └─ chrome.bookmarks.getTree()
  │       → 遍历提取所有 URL 和 Title
  │       → 保存到存储库2
  │
  ├─ 步骤2：加载存储库1（所有历史）
  │   └─ chrome.history.search({
  │         text: '',
  │         startTime: 0,           // 从最开始
  │         maxResults: 0            // 不限制数量
  │       })
  │       → 按日期分组
  │       → 保存到存储库1
  │
  └─ 步骤3：生成存储库3（匹配的历史）
      └─ 遍历存储库1的所有记录
          → 检查是否匹配存储库2
          → 匹配的记录保存到存储库3
```

### 2. 实时更新流程

```
┌─────────────────────────────────────────────────────────────────┐
│                      用户浏览网页                                │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ↓
                  chrome.history.onVisited
                        事件触发
                             │
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│              handleHistoryVisited(visitItem)                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                                                            │  │
│  │  步骤1：追加到存储库1（所有历史）                        │  │
│  │  ─────────────────────────────                           │  │
│  │  const dateKey = getDateKey(visitItem.visitTime);        │  │
│  │  allHistoryDB.add(dateKey, {                             │  │
│  │    url: visitItem.url,                                    │  │
│  │    title: visitItem.title,                                │  │
│  │    visitTime: visitItem.visitTime,                        │  │
│  │    ...                                                     │  │
│  │  });                                                       │  │
│  │                                                            │  │
│  │  步骤2：检查是否匹配书签（查询存储库2）                 │  │
│  │  ───────────────────────────────────                     │  │
│  │  const isBookmark =                                       │  │
│  │    bookmarkDB.urls.has(visitItem.url) ||                 │  │
│  │    bookmarkDB.titles.has(visitItem.title.trim());        │  │
│  │                                                            │  │
│  │  步骤3：如果匹配，追加到存储库3                          │  │
│  │  ───────────────────────────────────                     │  │
│  │  if (isBookmark) {                                        │  │
│  │    bookmarkHistoryDB.add(dateKey, visitItem);            │  │
│  │  }                                                         │  │
│  │                                                            │  │
│  │  步骤4：批量保存到持久化存储（防抖500ms）               │  │
│  │  ─────────────────────────────────────                   │  │
│  │  scheduleSave();  // 500ms后保存                         │  │
│  │                                                            │  │
│  │  步骤5：派发更新事件                                      │  │
│  │  ─────────────────────                                    │  │
│  │  document.dispatchEvent(                                  │  │
│  │    new CustomEvent('browsingDataUpdated', {              │  │
│  │      detail: { type: 'history', isBookmark }             │  │
│  │    })                                                     │  │
│  │  );                                                        │  │
│  │                                                            │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ↓
                    更新事件触发UI刷新
        ┌────────────────┼────────────────┐
        │                │                │
        ↓                ↓                ↓
  点击记录页面      点击排行页面    书签关联页面
  (刷新列表)        (清除缓存)      (刷新列表)
```

### 3. 书签变化更新流程（增量/减量）

```
┌─────────────────────────────────────────────────────────────────┐
│           用户添加/删除/修改书签                                 │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ↓
      chrome.bookmarks.onCreated/onRemoved/onChanged
                        事件触发
                             │
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│              handleBookmarkChanged(changeInfo)                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                                                            │  │
│  │  步骤1：更新存储库2（书签库）                            │  │
│  │  ─────────────────────────────                           │  │
│  │  switch (changeInfo.type) {                               │  │
│  │    case 'created':                                        │  │
│  │      bookmarkDB.urls.add(changeInfo.url);                │  │
│  │      bookmarkDB.titles.add(changeInfo.title);            │  │
│  │      // 检查存储库1中是否有该URL的历史记录              │  │
│  │      // 如果有，添加到存储库3                           │  │
│  │      break;                                               │  │
│  │                                                            │  │
│  │    case 'removed':                                        │  │
│  │      bookmarkDB.urls.delete(changeInfo.url);             │  │
│  │      bookmarkDB.titles.delete(changeInfo.title);         │  │
│  │      // ✨ 从存储库3中删除该URL的所有记录               │  │
│  │      bookmarkHistoryDB.removeByUrl(changeInfo.url);      │  │
│  │      break;                                               │  │
│  │                                                            │  │
│  │    case 'changed':                                        │  │
│  │      // 更新URL和标题，重新匹配                         │  │
│  │      scheduleRematch();                                   │  │
│  │  }                                                         │  │
│  │                                                            │  │
│  │  步骤2：保存并派发事件                                    │  │
│  │  ─────────────────────                                    │  │
│  │  saveAll();                                               │  │
│  │  document.dispatchEvent(                                  │  │
│  │    new CustomEvent('browsingDataUpdated', {              │  │
│  │      detail: { type: 'bookmark', action: 'removed' }     │  │
│  │    })                                                     │  │
│  │  );                                                        │  │
│  │                                                            │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 4. 历史记录删除更新流程（减量）

```
┌─────────────────────────────────────────────────────────────────┐
│       用户通过浏览器删除历史记录                                 │
│       (Ctrl+H → 删除 或 清除浏览数据)                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ↓
                chrome.history.onVisitRemoved
                        事件触发
                             │
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│           handleHistoryVisitRemoved(removeInfo)                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                                                            │  │
│  │  情况1：清除所有历史记录                                 │  │
│  │  ───────────────────────                                  │  │
│  │  if (removeInfo.allHistory) {                             │  │
│  │    // 清空存储库1（所有历史）                           │  │
│  │    allHistoryDB.clear();                                  │  │
│  │    // 清空存储库3（书签历史）                           │  │
│  │    bookmarkHistoryDB.clear();                             │  │
│  │    // 保存并派发事件                                     │  │
│  │    saveAll();                                             │  │
│  │    emit('updated', { type: 'history', action: 'cleared' });│ │
│  │    return;                                                 │  │
│  │  }                                                         │  │
│  │                                                            │  │
│  │  情况2：删除指定URL的历史记录                            │  │
│  │  ──────────────────────────                              │  │
│  │  if (Array.isArray(removeInfo.urls)) {                   │  │
│  │    for (const url of removeInfo.urls) {                  │  │
│  │      // ✨ 从存储库1中删除该URL的所有访问记录           │  │
│  │      allHistoryDB.removeByUrl(url);                       │  │
│  │                                                            │  │
│  │      // ✨ 检查是否是书签，如果是，从存储库3删除        │  │
│  │      if (bookmarkDB.urls.has(url)) {                     │  │
│  │        bookmarkHistoryDB.removeByUrl(url);                │  │
│  │      }                                                     │  │
│  │    }                                                       │  │
│  │                                                            │  │
│  │    // 保存并派发事件                                     │  │
│  │    saveAll();                                             │  │
│  │    emit('updated', {                                      │  │
│  │      type: 'history',                                     │  │
│  │      action: 'removed',                                   │  │
│  │      urls: removeInfo.urls                                │  │
│  │    });                                                     │  │
│  │  }                                                         │  │
│  │                                                            │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ↓
                    更新事件触发UI刷新
        ┌────────────────┼────────────────┐
        │                │                │
        ↓                ↓                ↓
  点击记录页面      点击排行页面    书签关联页面
  (移除记录)        (重新统计)      (移除记录)
```

---

## 🎯 三个页面的数据使用

### 页面1：点击记录

```javascript
// 数据源：100% 使用存储库3
class BrowsingHistoryCalendar {
  async loadData() {
    // 从存储库3加载数据
    this.bookmarksByDate = await bookmarkHistoryDB.getAllRecords();
    this.render();
  }
  
  onDataUpdate(event) {
    if (event.detail.type === 'history' && event.detail.isBookmark) {
      // 增量添加新记录
      this.incrementalUpdate();
    } else if (event.detail.type === 'bookmark') {
      // 书签变化，重新加载
      this.loadData();
    }
  }
}
```

### 页面2：点击排行

```javascript
// 数据源：100% 使用存储库3
async function ensureBrowsingClickRankingStats() {
  // 从存储库3统计点击次数
  const records = await bookmarkHistoryDB.getAllRecords();
  
  const statsMap = new Map(); // url -> { count, lastVisit }
  
  for (const [dateKey, dayRecords] of records) {
    for (const record of dayRecords) {
      const url = record.url;
      if (!statsMap.has(url)) {
        statsMap.set(url, { 
          url, 
          title: record.title,
          dayCount: 0, 
          weekCount: 0, 
          monthCount: 0,
          yearCount: 0,
          lastVisitTime: 0
        });
      }
      
      const stats = statsMap.get(url);
      const visitTime = record.visitTime;
      
      // 按时间范围累计
      if (visitTime >= boundaries.dayStart) stats.dayCount++;
      if (visitTime >= boundaries.weekStart) stats.weekCount++;
      if (visitTime >= boundaries.monthStart) stats.monthCount++;
      if (visitTime >= boundaries.yearStart) stats.yearCount++;
      
      if (visitTime > stats.lastVisitTime) {
        stats.lastVisitTime = visitTime;
      }
    }
  }
  
  return Array.from(statsMap.values());
}
```

### 页面3：书签关联记录

```javascript
// 数据源：存储库1 + 存储库3（用于判断高亮）
async function loadBrowsingRelatedHistory(range = 'day') {
  // 1. 从存储库1加载所有历史记录
  const allHistory = await allHistoryDB.getRecordsInRange(startTime, endTime);
  
  // 2. 从存储库3获取书签URL集合（用于快速判断）
  const bookmarkUrls = await bookmarkHistoryDB.getAllUrls();
  const bookmarkUrlSet = new Set(bookmarkUrls);
  
  // 3. 渲染所有记录，标识书签
  const historyItems = [];
  for (const [dateKey, records] of allHistory) {
    for (const record of records) {
      historyItems.push({
        ...record,
        isBookmark: bookmarkUrlSet.has(record.url)  // ✨ 判断是否高亮
      });
    }
  }
  
  // 4. 排序并渲染
  historyItems.sort((a, b) => b.visitTime - a.visitTime);
  renderList(historyItems);
}
```

---

## 💾 存储空间说明

### ✅ 已有 unlimitedStorage 权限

```json
// manifest.json（已配置）
{
  "permissions": [
    "unlimitedStorage"
  ]
}
```

### 存储策略：真正的永久存储

```javascript
const STORAGE_POLICY = {
  allHistory: {
    // 存储库1：所有历史
    maxDays: Infinity,      // ✅ 永久保留，无时间限制
    maxRecords: Infinity,   // ✅ 无数量限制
    cleanup: false          // ✅ 不执行清理
  },
  
  bookmarkHistory: {
    // 存储库3：书签历史
    maxDays: Infinity,      // ✅ 永久保留，无时间限制
    maxRecords: Infinity,   // ✅ 无数量限制
    cleanup: false          // ✅ 不执行清理
  },
  
  bookmarks: {
    // 存储库2：书签库
    maxDays: Infinity,      // ✅ 永久保留
    realtime: true          // ✅ 实时同步
  }
};

// ❌ 不需要清理任务
// 所有数据永久保留，只增不减（除非用户手动清理浏览器历史）
```

### 存储空间估算

```
假设用户重度使用场景：
- 每天访问 200 个不同网页
- 每条记录约 300 字节（包括URL、标题、时间等）
- 一年数据：200 * 365 * 300 = 21.9 MB
- 五年数据：约 110 MB

结论：
✅ 即使五年数据也只有 100MB 左右
✅ 现代电脑存储完全足够
✅ unlimitedStorage 权限足以支撑
✅ 不需要任何清理策略
```

### 用户手动清理（可选功能）

如果用户确实想清理旧数据，可以提供手动清理功能：

```javascript
// 可选：提供手动清理接口（不自动执行）
async function manualCleanup(options) {
  const { 
    clearBefore,      // 清理指定日期之前的数据
    keepBookmarks     // 是否保留书签相关记录
  } = options;
  
  if (keepBookmarks) {
    // 只清理非书签的历史记录
    await allHistoryDB.removeNonBookmarksBefore(clearBefore);
  } else {
    // 清理所有历史记录
    await allHistoryDB.removeBefore(clearBefore);
    await bookmarkHistoryDB.removeBefore(clearBefore);
  }
  
  console.log('[Manual Cleanup] 用户手动清理完成');
}
```

---

## 🚀 实施步骤

### Phase 1: 创建数据管理器类（2-3小时）

```
1. 创建 /history_html/database/ 目录
2. 实现三个数据库类：
   ├─ AllHistoryDatabase.js       (存储库1)
   ├─ BookmarkDatabase.js          (存储库2)
   └─ BookmarkHistoryDatabase.js   (存储库3)

3. 每个类实现：
   ├─ 初始化和恢复
   ├─ 增删改查方法
   ├─ 持久化保存
   └─ 事件派发
```

**文件结构：**
```
history_html/
├─ database/
│  ├─ AllHistoryDatabase.js
│  ├─ BookmarkDatabase.js
│  ├─ BookmarkHistoryDatabase.js
│  ├─ DatabaseManager.js          // 统一管理器
│  └─ utils.js                     // 工具函数
├─ browsing_history_calendar.js
└─ history.js
```

### Phase 2: 实现数据初始化和恢复（1-2小时）

```
1. 修改 initBrowsingHistoryCalendar()
2. 添加三个数据库的初始化逻辑
3. 实现缓存恢复
4. 实现全量加载fallback
```

### Phase 3: 实现实时更新监听（1-2小时）

```
1. 监听 chrome.history.onVisited
2. 监听 chrome.bookmarks.onCreate/onRemove/onChange
3. 实现增量更新逻辑
4. 实现防抖保存
```

### Phase 4: 适配三个页面（2-3小时）

```
1. 修改「点击记录」使用存储库3
2. 修改「点击排行」使用存储库3
3. 修改「书签关联」使用存储库1+3
4. 测试数据一致性
```

### Phase 5: 测试和优化（2-3小时）

```
1. 功能测试
2. 性能测试
3. 边界测试
4. 优化查询效率
```

### Phase 6: 可选功能（1小时）

```
1. 添加手动清理按钮（可选）
2. 添加存储空间查看（可选）
3. 添加数据导出功能（可选）
```

**总计时间：9-13小时**

---

## 📊 核心代码示例

### DatabaseManager.js

```javascript
class DatabaseManager {
  constructor() {
    this.allHistory = new AllHistoryDatabase();
    this.bookmarks = new BookmarkDatabase();
    this.bookmarkHistory = new BookmarkHistoryDatabase();
    
    this.initialized = false;
    this.listeners = new Set();
  }
  
  async init() {
    if (this.initialized) return;
    
    console.log('[DatabaseManager] 初始化三个存储库...');
    
    // 并行恢复三个数据库
    await Promise.all([
      this.allHistory.restore(),
      this.bookmarks.restore(),
      this.bookmarkHistory.restore()
    ]);
    
    // 检查是否需要全量加载
    const needFullLoad = 
      !this.allHistory.hasData() || 
      !this.bookmarks.hasData() ||
      !this.bookmarkHistory.hasData();
    
    if (needFullLoad) {
      await this.fullLoad();
    } else {
      // 后台增量更新
      this.incrementalUpdate();
    }
    
    // 设置实时监听
    this.setupListeners();
    
    this.initialized = true;
    console.log('[DatabaseManager] 初始化完成');
  }
  
  async fullLoad() {
    console.log('[DatabaseManager] 全量加载...');
    
    // 1. 加载书签库
    await this.bookmarks.loadFromBrowser();
    
    // 2. 加载所有历史
    await this.allHistory.loadFromBrowser();
    
    // 3. 生成匹配的书签历史
    await this.rebuildBookmarkHistory();
    
    // 4. 保存到持久化
    await this.saveAll();
    
    console.log('[DatabaseManager] 全量加载完成');
  }
  
  async incrementalUpdate() {
    console.log('[DatabaseManager] 增量更新...');
    
    const lastSync = this.allHistory.getLastSyncTime();
    const newRecords = await this.allHistory.loadFromBrowser({
      startTime: lastSync - 60000  // 回溯1分钟
    });
    
    // 检查新记录是否匹配书签
    for (const record of newRecords) {
      if (this.bookmarks.matches(record)) {
        await this.bookmarkHistory.add(record);
      }
    }
    
    await this.saveAll();
    this.emit('updated', { type: 'incremental' });
    
    console.log('[DatabaseManager] 增量更新完成，新增记录:', newRecords.length);
  }
  
  async rebuildBookmarkHistory() {
    console.log('[DatabaseManager] 重建书签历史匹配...');
    
    this.bookmarkHistory.clear();
    
    for (const [dateKey, records] of this.allHistory.getAllRecords()) {
      for (const record of records) {
        if (this.bookmarks.matches(record)) {
          await this.bookmarkHistory.add(dateKey, record);
        }
      }
    }
  }
  
  setupListeners() {
    const browserAPI = (typeof chrome !== 'undefined') ? chrome : browser;
    
    // 监听历史记录
    if (browserAPI.history?.onVisited) {
      browserAPI.history.onVisited.addListener(async (visitItem) => {
        await this.handleHistoryVisited(visitItem);
      });
    }
    
    // 监听书签变化
    if (browserAPI.bookmarks?.onCreated) {
      browserAPI.bookmarks.onCreated.addListener(async (id, bookmark) => {
        await this.handleBookmarkCreated(bookmark);
      });
    }
    
    if (browserAPI.bookmarks?.onRemoved) {
      browserAPI.bookmarks.onRemoved.addListener(async (id, removeInfo) => {
        await this.handleBookmarkRemoved(removeInfo);
      });
    }
    
    if (browserAPI.bookmarks?.onChanged) {
      browserAPI.bookmarks.onChanged.addListener(async (id, changeInfo) => {
        await this.handleBookmarkChanged(id, changeInfo);
      });
    }
    
    // 监听历史记录删除
    if (browserAPI.history?.onVisitRemoved) {
      browserAPI.history.onVisitRemoved.addListener(async (removeInfo) => {
        await this.handleHistoryVisitRemoved(removeInfo);
      });
    }
  }
  
  async handleHistoryVisited(visitItem) {
    console.log('[DatabaseManager] 新访问:', visitItem.url);
    
    // 1. 添加到存储库1
    await this.allHistory.add(visitItem);
    
    // 2. 检查是否匹配书签
    const isBookmark = this.bookmarks.matches(visitItem);
    if (isBookmark) {
      await this.bookmarkHistory.add(visitItem);
    }
    
    // 3. 延迟保存（防抖）
    this.scheduleSave();
    
    // 4. 派发事件
    this.emit('updated', { 
      type: 'history', 
      isBookmark 
    });
  }
  
  async handleBookmarkCreated(bookmark) {
    console.log('[DatabaseManager] 书签创建:', bookmark.url);
    
    await this.bookmarks.add(bookmark);
    
    // 检查存储库1中是否有该URL的历史记录
    const historyRecords = await this.allHistory.getByUrl(bookmark.url);
    if (historyRecords.length > 0) {
      // 有历史记录，添加到存储库3
      for (const record of historyRecords) {
        await this.bookmarkHistory.add(record);
      }
    }
    
    await this.saveAll();
    this.emit('updated', { 
      type: 'bookmark', 
      action: 'created',
      url: bookmark.url
    });
  }
  
  async handleBookmarkRemoved(removeInfo) {
    console.log('[DatabaseManager] 书签删除:', removeInfo.node?.url);
    
    const url = removeInfo.node?.url;
    const title = removeInfo.node?.title;
    
    // 从存储库2删除
    await this.bookmarks.remove(url, title);
    
    // ✨ 从存储库3删除该URL的所有记录
    if (url) {
      await this.bookmarkHistory.removeByUrl(url);
    }
    
    await this.saveAll();
    this.emit('updated', { 
      type: 'bookmark', 
      action: 'removed',
      url: url
    });
  }
  
  async handleBookmarkChanged(id, changeInfo) {
    console.log('[DatabaseManager] 书签修改:', changeInfo);
    
    await this.bookmarks.update(id, changeInfo);
    
    // 如果URL或标题改变，需要重新匹配
    if (changeInfo.url || changeInfo.title) {
      this.scheduleRematch();
    }
  }
  
  async handleHistoryVisitRemoved(removeInfo) {
    console.log('[DatabaseManager] 历史记录删除:', removeInfo);
    
    // 情况1：清除所有历史
    if (removeInfo.allHistory) {
      console.log('[DatabaseManager] 清除所有历史记录');
      await this.allHistory.clear();
      await this.bookmarkHistory.clear();
      await this.saveAll();
      this.emit('updated', { 
        type: 'history', 
        action: 'cleared' 
      });
      return;
    }
    
    // 情况2：删除指定URL
    if (Array.isArray(removeInfo.urls) && removeInfo.urls.length > 0) {
      console.log('[DatabaseManager] 删除指定URL:', removeInfo.urls);
      
      for (const url of removeInfo.urls) {
        // 从存储库1删除
        await this.allHistory.removeByUrl(url);
        
        // 如果是书签，从存储库3删除
        if (this.bookmarks.hasUrl(url)) {
          await this.bookmarkHistory.removeByUrl(url);
        }
      }
      
      await this.saveAll();
      this.emit('updated', { 
        type: 'history', 
        action: 'removed',
        urls: removeInfo.urls
      });
    }
  }
  
  scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveAll();
    }, 500);
  }
  
  scheduleRematch() {
    if (this.rematchTimer) clearTimeout(this.rematchTimer);
    this.rematchTimer = setTimeout(() => {
      this.rebuildBookmarkHistory().then(() => {
        this.saveAll();
        this.emit('updated', { type: 'bookmark' });
      });
    }, 2000);
  }
  
  async saveAll() {
    await Promise.all([
      this.allHistory.save(),
      this.bookmarks.save(),
      this.bookmarkHistory.save()
    ]);
  }
  
  emit(event, data) {
    document.dispatchEvent(new CustomEvent('browsingDataUpdated', {
      detail: { event, ...data }
    }));
  }
}

// 全局单例
window.databaseManager = new DatabaseManager();
```

---

## ✅ 验收标准

### 功能测试

**增量更新测试**：
- [ ] 首次打开能正确全量加载所有数据
- [ ] 刷新页面能从缓存快速恢复
- [ ] 访问网页后能实时添加到存储库1
- [ ] 访问书签网页后能实时添加到存储库3
- [ ] 添加书签后能立即在三个页面看到
- [ ] 三个页面数据一致性正确

**减量更新测试**：
- [ ] 删除书签后，存储库2正确删除
- [ ] 删除书签后，存储库3删除对应记录
- [ ] 删除书签后，三个页面正确更新
- [ ] 删除单条历史记录后，存储库1正确删除
- [ ] 删除单条历史记录后，如果是书签，存储库3也删除
- [ ] 清除所有历史后，存储库1和3正确清空
- [ ] 修改书签URL后，存储库2和3正确更新

### 性能测试

- [ ] 10000条历史记录加载时间 < 2秒
- [ ] 缓存恢复时间 < 500ms
- [ ] 单次访问更新延迟 < 100ms
- [ ] 内存占用合理（< 100MB）

### 数据测试

- [ ] 存储库1包含所有历史记录（永久保留）
- [ ] 存储库2实时同步书签库（永久保留）
- [ ] 存储库3正确匹配URL和标题（永久保留）
- [ ] 持久化存储正确保存和恢复
- [ ] 数据累积正常，无异常清理

---

## 🔍 风险评估

| 风险 | 影响 | 缓解方案 |
|------|------|----------|
| **性能问题（大数据量）** | 中 | 1. 增加索引<br>2. 懒加载<br>3. 虚拟滚动<br>4. 分页加载 |
| **数据同步延迟** | 低 | 1. 防抖优化<br>2. 后台同步<br>3. UI loading状态 |
| **历史记录API限制** | 低 | 1. 分批查询<br>2. 增量更新<br>3. 错误重试 |
| **兼容性问题** | 低 | 1. 版本迁移脚本<br>2. 降级方案<br>3. 数据备份 |
| **内存占用** | 低 | 1. 懒加载数据<br>2. 虚拟列表<br>3. Map结构优化 |

**注**：由于已有 unlimitedStorage 权限且数据量预计不超过 100MB，存储空间不再是风险。

---

## 📝 后续优化

1. **搜索功能**：全文搜索历史记录（基于永久存储的完整数据）
2. **标签功能**：为历史记录添加自定义标签
3. **导出功能**：导出所有历史记录（无时间限制）
4. **统计分析**：更丰富的数据可视化（跨年统计成为可能）
5. **云同步**：跨设备同步历史记录
6. **手动清理**：提供用户手动清理旧数据的选项（可选）
7. **存储查看**：查看三个存储库的大小和记录数量

---

## 🎉 架构优势总结

有了 unlimitedStorage 权限，这个架构具有以下优势：

### 1. **真正的永久存储**
- ✅ 所有数据永久保留，无时间限制
- ✅ 不需要担心数据丢失
- ✅ 可以查看多年前的浏览记录

### 2. **数据完整性**
- ✅ 存储库1：完整的浏览历史
- ✅ 存储库2：实时同步的书签库
- ✅ 存储库3：准确匹配的书签历史

### 3. **高性能**
- ✅ 增量更新，不重复查询
- ✅ 三个页面共享数据
- ✅ 实时同步，延迟<100ms

### 4. **架构简洁**
- ✅ 不需要复杂的清理逻辑
- ✅ 不需要分级存储策略
- ✅ 代码更简单，更可维护

### 5. **用户体验**
- ✅ 数据永久保留，不会丢失
- ✅ 查询速度快（本地存储）
- ✅ 实时更新，无需手动刷新

---

**准备开始实施？** 🚀

下一步：创建 `database/` 目录和核心数据库类。
