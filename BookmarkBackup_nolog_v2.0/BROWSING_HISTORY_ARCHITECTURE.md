# 书签浏览记录系统架构与缓存说明

> 适用范围：  
> - 「书签浏览记录」中的 **点击记录**（日历）  
> - 「书签浏览记录」中的 **点击排行**  
> - 「书签关联记录」  

本文说明三块功能与浏览器 API / 本地缓存之间的关系，以及当前实现上的优化与后续建议。

---

## 1. 缓存存在哪里？生命周期如何？

### 1.1 浏览历史点击记录缓存（点击记录）

- **缓存键**：`bb_cache_browsing_history_v1`
- **存储位置优先级**：
  1. `chrome.storage.local`  
  2. 若不可用，则回退到当前扩展页面的 `window.localStorage`
- **存储内容**：
  - `lastSyncTime`: 最近一次成功同步浏览历史的时间戳
  - `records`: `Map<'YYYY-MM-DD', VisitRecord[]>` 序列化后的数组版本
- **生命周期**：
  - 关闭 `history.html` 页面不会清空缓存
  - 同一浏览器实例中，只要扩展还在、没有清理浏览器数据，缓存会一直保留
  - 清除浏览器「扩展数据」或本地存储后，缓存才会丢失

### 1.2 书签添加记录缓存（Additions，用于书签 URL 集合）

- **缓存键**：`bb_cache_additions_v1`
- **存储位置**：同样优先使用 `chrome.storage.local`，回退到 `localStorage`
- **用途**：
  - 加快「书签添加记录」视图的加载
  - 同时为实时监听逻辑提供 `allBookmarks` 和 `bookmarkUrlSet`
    - `bookmarkUrlSet`: 当前所有书签的 URL 集合（仅 HTTP/HTTPS）

### 1.3 内存状态（仅当前页面会话内存在）

- `browsingHistoryCalendarInstance.bookmarksByDate`  
  - 点击记录日历内部的 `Map<'YYYY-MM-DD', VisitRecord[]>`
  - 从缓存恢复或运行时增量更新
- `browsingClickRankingStats`  
  - 点击排行的统计结果，存在于内存中（JS 变量）
  - 每次 `browsingHistoryCacheUpdated` 事件触发时清空，按需重算
- `browsingRelatedBookmarkUrls / Titles / Info`  
  - 书签关联记录使用的书签 URL / 标题 / URL→标题 映射
  - 只在当前页面会话有效，切换或刷新页面后重建

---

## 2. 页面首次 / 后续打开时的行为

### 2.1 点击记录（BrowsingHistoryCalendar）的启动流程

```mermaid
flowchart TD
    A[打开 history.html] --> B[initBrowsingHistoryCalendar()]
    B --> C{restoreBrowsingHistoryCache() 成功?}
    C -- 否 --> D[loadBookmarkData({ incremental: false })<br/>全量扫描历史 + 书签]
    D --> E[填充 bookmarksByDate<br/>+ visitKeySet<br/>+ historyCacheMeta.lastSyncTime]
    E --> F[saveBrowsingHistoryCache()<br/>写入 bb_cache_browsing_history_v1]
    C -- 是 --> G[使用缓存恢复<br/>bookmarksByDate + visitKeySet<br/>+ lastSyncTime]
    G --> H[render() 初次渲染日历]
    F --> H
    H --> I[loadBookmarkData({ incremental: true })<br/>后台增量同步]
    I --> J[announceHistoryDataUpdated()<br/>派发 browsingHistoryCacheUpdated]
```

说明：

- **第一次打开**：`restoreBrowsingHistoryCache()` 失败 → 执行全量扫描（但内部也有「只保留最近一定天数」的限制）。
- **后续打开**：
  - 若缓存存在：先用缓存立刻渲染，再做一次增量同步（只扫描 `lastSyncTime` 之后的历史）。
  - 若缓存被清空：退化为第一次打开的全量流程。

---

## 3. 三个功能与 API 的关系（总览流程图）

```mermaid
flowchart LR
    subgraph APIs[浏览器 API]
        HAPI[chrome.history.search / getVisits]
        BAPI[chrome.bookmarks.getTree]
        HEvents[history.onVisited / onVisitRemoved]
        BEvents[bookmarks.onCreated / onRemoved / onChanged]
    end

    subgraph Cache[扩展本地缓存]
        BHCache[bb_cache_browsing_history_v1<br/>(点击记录缓存)]
        AddCache[bb_cache_additions_v1<br/>(书签添加缓存)]
    end

    subgraph Runtime[运行时内存结构]
        CAL[BrowsingHistoryCalendar<br/>bookmarksByDate + visitKeySet]
        BKSet[allBookmarks + bookmarkUrlSet]
        RankStats[browsingClickRankingStats]
    end

    subgraph UI[UI 功能]
        ClickCalendar[点击记录（日历视图）]
        ClickRanking[点击排行]
        Related[书签关联记录]
    end

    %% 缓存加载
    BHCache --> CAL
    AddCache --> BKSet

    %% 启动时全量/增量
    BAPI --> CAL
    HAPI --> CAL

    %% 实时事件
    HEvents -->|onVisited / onVisitRemoved| CAL
    BEvents -->|书签变化| BKSet
    BKSet --> CAL

    %% 点击记录
    CAL --> ClickCalendar

    %% 点击排行
    CAL --> RankStats
    BAPI --> RankStats
    RankStats --> ClickRanking

    %% 书签关联记录
    HAPI --> Related
    BAPI --> Related
    CAL --> Related
```

---

## 4. 三个功能的详细数据流

### 4.1 点击记录（日历）

**数据源：**

- `chrome.bookmarks.getTree()` → 收集全部书签的：
  - URL 集合：`Set<url>`
  - 标题集合：`Set<title.trim()>`
- `chrome.history.search()` + `chrome.history.getVisits()`：
  - 读取浏览器历史（受 `BROWSING_HISTORY_LOOKBACK_DAYS` 限制）
  - 按 URL / 标题与书签集合做 **并集匹配**：
    - 条件1：`bookmarkUrls.has(item.url)`
    - 条件2：`bookmarkTitles.has(item.title.trim())`

**缓存与结构：**

- 匹配到的记录以日期分组，存入：
  - `BrowsingHistoryCalendar.bookmarksByDate: Map<'YYYY-MM-DD', VisitRecord[]>`
  - 同时记录 `visitKeySet`（`url|visitTime`）用于去重
- 成功同步后：
  - 写入 `bb_cache_browsing_history_v1`
  - 保存 `historyCacheMeta.lastSyncTime`

**实时更新（增量 / 减量）：**

- 增量（新增历史）：
  - `history.onVisited` → `handleHistoryVisited` → `scheduleHistoryRefresh({ forceFull: false })`
  - `refreshBrowsingHistoryData({ incremental: true })`：
    - 只从 `lastSyncTime - padding` 起调用 `history.search`
    - 新访问进入 `bookmarksByDate`，触发 `browsingHistoryCacheUpdated`
- 减量（删除历史）：
  - `history.onVisitRemoved` → 无条件 `scheduleHistoryRefresh({ forceFull: true })`
  - `refreshBrowsingHistoryData({ incremental: false })`：
    - 重建最近一年的点击记录（同样用 URL+标题并集）
    - 删除掉对应日期下的访问记录

---

### 4.2 点击排行

**依赖数据：**

- 来自「点击记录」的：
  - `browsingHistoryCalendarInstance.bookmarksByDate`
- 来自书签 API 的：
  - `getBookmarkUrlsAndTitles()`：
    - `Set<url>`：书签 URL 集合
    - `Set<title.trim()>`：书签标题集合
    - `Map<url, { url, title }>`：URL → 标题映射

**统计逻辑：**

- `ensureBrowsingClickRankingStats()`：
  1. 等待 `bookmarksByDate` 准备好
  2. 从书签映射构建：
     - `bookmarkKeyMap`：`url:` 或 `title:` → 内部书签 key
     - `bookmarkInfoMap`：key → `{ url, title }`
  3. 遍历 `bookmarksByDate` 中的所有 VisitRecord：
     - 优先用 URL 命中；失败再用标题命中
     - 每条访问贡献 `increment = 1`
     - 按「今天 / 本周 / 本月 / 本年」四个时间桶统计
  4. 结果写入 `browsingClickRankingStats`（内存）

**刷新机制：**

- 任意一次 `browsingHistoryCacheUpdated`：
  - `browsingClickRankingStats = null`
  - 若点击排行面板当前可见：
    - 调用 `refreshActiveBrowsingRankingIfVisible()`
    - 它内部会再次调用 `ensureBrowsingClickRankingStats()` 并重绘列表

---

### 4.3 书签关联记录

**数据源：**

- `chrome.history.search()`：
  - 按用户选择的时间范围（天 / 周 / 月 / 年）拉取历史记录
  - 不限制结果数量（`maxResults: 0`）
- 书签集合：
  - 优先从 `browsingHistoryCalendarInstance.bookmarksByDate` 推导
  - 若不可用，则调用 `getBookmarkUrlsAndTitles()` 直接从书签 API 获取

**匹配逻辑（与点击记录一致）：**

- 对每条历史记录：
  - 条件1：URL 在书签 URL 集合中
  - 条件2：标题在书签标题集合中
  - 任一满足，则认为是「书签关联记录」，在 UI 中加高亮标识

**刷新机制：**

- `browsingHistoryCacheUpdated` 时：
  - `refreshBrowsingRelatedHistory()`：
    - 清除书签 URL/标题缓存
    - 等待点击记录日历同步完成
    - 再重新调用 `loadBrowsingRelatedHistory(range)`

---

## 5. 现有优化点汇总

1. **时间窗口限制（已取消）**
   - 当前配置为 `BROWSING_HISTORY_LOOKBACK_DAYS = 0`，即**不在扩展层面主动裁剪老记录**。
   - 点击记录与点击排行可以覆盖浏览器历史中可用的全部时间范围，真正的上限由浏览器自身的历史保留策略决定（比如 Chrome 可能只保留若干月/年的历史）。

2. **每个 URL 的访问次数上限**
   - 单个 URL 缓存的访问次数受 `BROWSING_HISTORY_MAX_VISITS_PER_URL` 限制。
   - 防止某些高频站点撑爆内存和存储。

3. **去重机制**
   - 使用 `visitKeySet (url|visitTime)` 来避免重复写入同一访问记录。

4. **防抖与合并刷新**
   - `scheduleHistoryRefresh()` 对多次事件进行 500ms 防抖。
   - 多个 `forceFull` 请求会自动合并，最终只跑一次真正的重建。

5. **事件驱动的实时更新**
   - 历史事件：`history.onVisited` / `onVisitRemoved`
   - 书签事件：`bookmarks.onCreated` / `onRemoved` / `onChanged`
   - UI 更新统一通过 `browsingHistoryCacheUpdated` 事件分发。

6. **启动时优先使用缓存**
   - 首先从 `bb_cache_browsing_history_v1` 恢复，以保证首次渲染速度。
   - 后台增量加载完成后无感更新视图。

---

## 6. 进一步优化建议

以下是一些可以考虑、但不强制的优化方向：

1. **可配置时间窗口**
   - 在设置中增加「只分析最近 X 天」选项（例如 90 / 180 / 365），用户可以按需求权衡精度与性能。

2. **点击排行的懒加载与节流**
   - 当前已经只在面板可见时刷新；可以进一步在滚动时分页显示，减少一次性渲染 50 条以上 DOM 的压力。

3. **缓存结构压缩**
   - 若数据量非常大，可以考虑：
     - 对相同域名的 URL 做简单前缀压缩
     - 或将较老的记录只保留「聚合统计」而不保留每一次访问

4. **后台定期清理策略**
   - 例如每次全量重建完成后，自动删除超过 N 天的历史记录条目（已经部分通过 `lookback` 实现，可以继续收紧）。

5. **首屏感知优化**
   - 在点击记录的 UI 中，优先渲染当前月 / 当前周数据，远期月份在滚动时按需渲染，降低首屏渲染成本。

---

## 7. 简要问答（便于快速回顾）

**Q1：从 API 获得的数据是缓存吗？关掉页面还在吗？**  
- 是的，关键数据会写入 `chrome.storage.local`（或降级到 `localStorage`）作为扩展自己的持久缓存。  
- 关闭 `history.html` 页面不会丢失；只要不清理浏览器数据 / 不卸载扩展，下次再打开仍可直接恢复。

**Q2：这些缓存是浏览器自身的网络缓存吗？**  
- 不是。  
- 它们是扩展通过 `chrome.storage.local` 主动写入的 *扩展存储*，逻辑上属于扩展自己的数据区，与网络缓存无关。

**Q3：第一次打开和后续打开有何不同？**  
- 第一次：没有缓存 → 全量扫描历史 + 书签 → 构建点击记录缓存。  
- 后续：先用缓存即刻显示 → 后台进行增量更新（只补充新增的历史和书签变化），再通过事件刷新 UI。

如需进一步调整缓存策略（比如把 lookback 从 365 天改成其他值），可以在 `browsing_history_calendar.js` 中调整常量，并同时更新本文件说明。  
