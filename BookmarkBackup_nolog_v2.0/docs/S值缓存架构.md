# 书签推荐 S值缓存架构

## 概述

书签推荐系统通过计算每个书签的优先级分数（S值）来决定推荐顺序。S值基于以下因子计算：

- **F (新鲜度)**: 书签创建时间 → 实时计算，不需要传递
- **C (冷门度)**: 访问次数 → 访问URL时传递更新
- **T (时间度)**: 页面停留时间 → 会话保存时传递更新
- **D (遗忘度)**: 上次访问距今时间 → 访问URL时传递更新
- **L (待复习)**: 是否在待复习队列 → 待复习变化时传递更新

## 因子数据流

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              因子更新机制                                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  F (新鲜度) - 实时计算，不需要传递                                               │
│  ────────────────────────────────────────────────────────────────               │
│  公式: F = 1/(1+(daysSinceAdded/阈值)^0.7)                                       │
│  数据: now - bookmark.dateAdded                                                 │
│  特点: dateAdded是静态的，每次计算都用当前时间，所以F值永远是最新的               │
│                                                                                 │
│  C/D (冷门度/遗忘度) - 访问URL时传递                                             │
│  ────────────────────────────────────────────────────────────────               │
│  chrome.history.onVisited                                                       │
│       ↓                                                                         │
│  handleHistoryVisited(url)                                                      │
│       ↓                                                                         │
│  scheduleBookmarkScoreUpdateByUrl(url) ←── 1秒防抖                              │
│       ↓                                                                         │
│  updateSingleBookmarkScore(id) ←── 增量更新该书签的S值                           │
│                                                                                 │
│  T (时间度) - 会话保存时传递                                                     │
│  ────────────────────────────────────────────────────────────────               │
│  ActiveTimeTracker.saveSession()                                                │
│       ↓                                                                         │
│  chrome.runtime.sendMessage({ action: 'trackingDataUpdated' })                  │
│       ↓                                                                         │
│  history.js 监听到消息                                                          │
│       ↓                                                                         │
│  增量更新 trackingRankingCache（累加到现有值）                                   │
│       ↓                                                                         │
│  下次计算S值时使用最新T值                                                        │
│                                                                                 │
│  L (待复习) - 待复习变化时传递                                                   │
│  ────────────────────────────────────────────────────────────────               │
│  confirmAddToPostponed / cancelPostpone                                         │
│       ↓                                                                         │
│  updateSingleBookmarkScore(id) / updateMultipleBookmarkScores(ids)              │
│       ↓                                                                         │
│  增量更新相关书签的S值                                                           │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## 架构图

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           S值缓存系统架构                                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                         数据层                                          │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │                                                                         │    │
│  │   原始数据源                              S值缓存                        │    │
│  │   ├── F ← now - dateAdded（实时计算）    recommend_scores_cache         │    │
│  │   ├── C ← chrome.history.visitCount      ┌─────────────────────────┐    │    │
│  │   ├── T ← trackingRankingCache           │ {                       │    │    │
│  │   │      ↳ 标题或URL匹配（并集）          │   "id1": {S,F,C,T,D,L}  │    │    │
│  │   ├── D ← chrome.history.lastVisitTime   │   "id2": {S,F,C,T,D,L}  │    │    │
│  │   └── L ← recommend_postponed            │   ...                   │    │    │
│  │                                          │ }                       │    │    │
│  │                                          └─────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                         计算层                                          │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │                                                                         │    │
│  │   全量计算 computeAllBookmarkScores()                                   │    │
│  │   ├── 清除旧缓存                                                        │    │
│  │   ├── 遍历所有书签，计算每个的S值                                        │    │
│  │   └── 写入 recommend_scores_cache                                       │    │
│  │                                                                         │    │
│  │   增量更新 updateSingleBookmarkScore(id)                                │    │
│  │   ├── 读取该书签的原始数据                                               │    │
│  │   ├── 计算新的S值                                                        │    │
│  │   └── 更新 recommend_scores_cache 中的该条记录                           │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                         展示层                                          │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │                                                                         │    │
│  │   refreshRecommendCards(force)                                          │    │
│  │   ├── 从缓存读取所有S值（不重算）                                         │    │
│  │   ├── 过滤掉已翻/跳过/屏蔽/待复习的书签                                   │    │
│  │   ├── force=true时，跳过当前显示的卡片                                    │    │
│  │   ├── 按S值排序（相同时随机）                                            │    │
│  │   └── 取Top3显示                                                        │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## 核心原则

```
1. S值存在缓存里，刷新卡片只读缓存，不重算
2. 个体变化（访问URL/待复习变化）→ 增量更新单个书签
3. 公式变化（权重/模式切换）→ 全量重算所有书签
4. 刷新卡片 = 从缓存选Top3（force时跳过当前显示的）
```

## 触发场景

### 全量计算 `computeAllBookmarkScores()`

**唯一触发点**：`saveFormulaConfig()` 内部

| 场景 | 调用链 |
|------|--------|
| 模式切换 | `applyPresetMode()` → `saveFormulaConfig()` |
| 手动调权重 | `input.blur` → `normalizeWeights()` → `saveFormulaConfig()` |
| 恢复默认 | `resetFormulaToDefault()` → `saveFormulaConfig()` |

### 增量更新 `updateSingleBookmarkScore(id)`

| 场景 | 触发点 | 说明 |
|------|--------|------|
| 访问URL | `handleHistoryVisited()` → `scheduleBookmarkScoreUpdateByUrl()` | C/D因子变化 |
| 取消待复习 | `cancelPostpone()` | L因子变化 |
| 添加待复习 | `confirmAddToPostponed()` → `updateMultipleBookmarkScores()` | L因子变化 |
| 新建书签 | `bookmarks.onCreated` | 初始化S值 |

### 直接读缓存 `refreshRecommendCards(force)`

| 场景 | force值 | 说明 |
|------|---------|------|
| 进入视图 | false | 显示保存的卡片或Top3 |
| 主动刷新 | true | 跳过当前卡片，选新Top3 |
| 被动刷新 | true | 翻完3张后，选新Top3 |
| 跳过书签 | true | 该书签加入跳过集 |
| 屏蔽书签 | true | 该书签被过滤 |
| 待复习操作 | true/false | 刷新显示 |
| 模式切换后 | false | 全量重算后刷新 |

## 防御机制

### 1. 防止循环刷新

**问题**：history和popup页面互相监听`popupCurrentCards`变化，可能形成循环

**解决**：
```javascript
// history.js
let historyLastSaveTime = 0;
// 保存时
historyLastSaveTime = Date.now();
// 监听时
if (now - historyLastSaveTime < 500) return; // 500ms内忽略本页保存

// popup.js 同理
let popupLastSaveTime = 0;
```

### 2. 防止并发计算

**问题**：多次快速触发可能导致并发计算

**解决**：
```javascript
let isComputingScores = false;

async function computeAllBookmarkScores() {
    if (isComputingScores) {
        console.log('[批量计算] 已有计算任务在运行，跳过');
        return false;
    }
    isComputingScores = true;
    // ...计算逻辑
    isComputingScores = false;
}
```

### 3. 防止刷新不变

**问题**：每次刷新都是同样的Top3

**解决**：
```javascript
// force=true时跳过当前显示的卡片
const currentCardIds = new Set(force && currentCards?.cardIds ? currentCards.cardIds : []);
availableBookmarks = bookmarks.filter(b => !currentCardIds.has(b.id) && ...);

// S值相同时添加随机因子
bookmarksWithPriority.sort((a, b) => {
    const diff = b.priority - a.priority;
    if (Math.abs(diff) < 0.01) return Math.random() - 0.5;
    return diff;
});
```

### 4. 增量更新防抖

**问题**：访问URL可能频繁触发

**解决**：
```javascript
let urlScoreUpdateTimer = null;
const pendingUrlScoreUpdates = new Set();

function scheduleBookmarkScoreUpdateByUrl(url) {
    pendingUrlScoreUpdates.add(url);
    if (urlScoreUpdateTimer) clearTimeout(urlScoreUpdateTimer);
    urlScoreUpdateTimer = setTimeout(async () => {
        // 批量处理累积的URL
        const urls = [...pendingUrlScoreUpdates];
        pendingUrlScoreUpdates.clear();
        // ...更新逻辑
    }, 1000); // 1秒防抖
}
```

## 攻防演习结果

| 场景 | 期望行为 | 实际行为 | 状态 |
|------|---------|---------|:----:|
| 主动刷新 | 从缓存读取，显示新卡片 | 从缓存读取，跳过当前卡片选新Top3 | ✅ |
| 被动刷新 | 从缓存读取，显示新卡片 | 从缓存读取，选新Top3 | ✅ |
| F值（新鲜度）变化 | 实时计算 | `now - dateAdded`，每次计算都是最新 | ✅ |
| C/D值（访问URL） | 增量更新该书签 | `history.onVisited` → `updateSingleBookmarkScore` | ✅ |
| T值（时间追踪） | 增量更新缓存 | `saveSession` → `sendMessage` → 累加到缓存 | ✅ |
| L值（待复习变化） | 增量更新相关书签 | `updateMultipleBookmarkScores` | ✅ |
| 模式切换 | 全量重算 | `clearCache` + `computeAll` | ✅ |
| 手动调权重 | 全量重算 | `clearCache` + `computeAll` | ✅ |
| 新建书签 | 增量计算该书签 | `updateSingleBookmarkScore` | ✅ |
| 删除书签 | 删除缓存 | `removeCachedScore` | ✅ |
| 循环刷新 | 阻止循环 | 500ms时间戳检查 | ✅ |
| 并发计算 | 阻止并发 | `isComputingScores`标志 | ✅ |

## 文件修改记录

| 文件 | 修改内容 |
|------|---------|
| `history.js` | 添加`scheduleBookmarkScoreUpdateByUrl`、`updateMultipleBookmarkScores`函数 |
| `history.js` | `handleHistoryVisited`添加增量更新调用 |
| `history.js` | `cancelPostpone`添加增量更新调用 |
| `history.js` | `confirmAddToPostponed`添加批量增量更新调用 |
| `history.js` | `refreshRecommendCards`添加跳过当前卡片逻辑 |
| `history.js` | `refreshRecommendCards`添加S值相同随机逻辑 |
| `history.js` | 刷新按钮改为直接读缓存（移除`computeAllBookmarkScores`调用） |
| `history.js` | `loadRecommendData`移除`checkAutoRefresh`调用 |
| `history.js` | 删除`checkAutoRefresh`函数（死代码） |
| `history.js` | 添加`historyLastSaveTime`防循环机制 |
| `popup.js` | 添加`popupLastSaveTime`防循环机制 |
