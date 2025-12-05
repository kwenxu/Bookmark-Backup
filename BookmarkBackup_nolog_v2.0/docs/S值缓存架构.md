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

### 一、基础场景

| 场景 | 期望行为 | 实际行为 | 状态 |
|------|---------|---------|:----:|
| 主动刷新 | 从缓存读取，显示新卡片 | 从缓存读取，跳过当前卡片选新Top3 | ✅ |
| 被动刷新 | 从缓存读取，显示新卡片 | 从缓存读取，选新Top3 | ✅ |
| F值（新鲜度）变化 | 实时计算 | `now - dateAdded`，每次计算都是最新 | ✅ |
| C/D值（访问URL） | 增量更新该书签 | `history.onVisited` → `updateSingleBookmarkScore` | ✅ |
| T值（时间追踪） | 增量更新缓存+S值 | `saveSession` → `sendMessage` → 更新缓存+触发S值更新 | ✅ |
| L值（待复习变化） | 增量更新相关书签 | `updateMultipleBookmarkScores` | ✅ |
| 模式切换 | 全量重算 | `clearCache` + `computeAll` | ✅ |
| 手动调权重 | 全量重算 | `clearCache` + `computeAll` | ✅ |
| 新建书签 | 增量计算该书签 | `updateSingleBookmarkScore` | ✅ |
| 删除书签 | 删除缓存 | `removeCachedScore` | ✅ |
| 循环刷新 | 阻止循环 | 500ms时间戳检查 | ✅ |
| 并发计算 | 阻止并发 | `isComputingScores`标志 | ✅ |

### 二、卡片三按钮交互

| 场景 | 期望行为 | 实际行为 | 状态 |
|------|---------|---------|:----:|
| 跳过按钮 | 加入跳过集合，刷新卡片 | `skippedBookmarks.add()` + `refreshRecommendCards(true)` | ✅ |
| 屏蔽按钮 | 加入屏蔽列表，刷新卡片 | `blockBookmark()` + `refreshRecommendCards(true)` | ✅ |
| 稍后复习按钮 | 显示延迟选项 | 弹窗选择时间 → `postponeBookmark()` | ✅ |
| 点击卡片 | 打开书签，记录翻阅 | `openInRecommendWindow()` + 更新flipped状态 | ✅ |

### 三、待复习系统（重点）

| 场景 | 期望行为 | 实际行为 | 状态 | 问题 |
|------|---------|---------|:----:|------|
| 添加到待复习 | L因子变化，更新S值 | 模式切换全量重算（已移除冗余增量更新） | ✅ | P1已修复 |
| 取消待复习 | L因子变化，更新S值 | 智能判断是否需要增量更新 | ✅ | P2已修复 |
| 手动添加 → 激活优先模式 | 自动切换模式 | `loadPostponedList` → `applyPresetMode('priority')` | ✅ | P1已修复 |
| 优先模式S值计算 | L权重=0.70 | `presetModes.priority.weights.laterReview = 0.70` | ✅ | - |
| 待复习清空 → 退出优先模式 | 自动切换回默认 | 智能跳过重复模式切换 | ✅ | P2已修复 |
| 提前复习（点击待复习项） | 取消待复习+记录复习 | `cancelPostpone` + `recordReview` | ✅ | - |

**P1: 添加待复习时重复计算**
```
confirmAddToPostponed()
  ├── updateMultipleBookmarkScores() ← 增量更新
  ├── loadPostponedList()
  │     └── applyPresetMode('priority')
  │           └── saveFormulaConfig() → computeAllBookmarkScores() ← 又全量重算！
  └── refreshRecommendCards(true)
```

**P2: 取消待复习时可能重复计算**
```
cancelPostpone() → updateSingleBookmarkScore() ← 增量更新
调用方 → loadPostponedList()
         └── 如果待复习清空 → applyPresetMode('default')
               └── computeAllBookmarkScores() ← 又全量重算！
```

### 四、模式切换

| 场景 | 期望行为 | 实际行为 | 状态 |
|------|---------|---------|:----:|
| 切换到考古模式 | 全量重算，刷新卡片 | `applyPresetMode('archaeology')` | ✅ |
| 切换到巩固模式 | 全量重算，刷新卡片 | `applyPresetMode('consolidate')` | ✅ |
| 切换到漫游模式 | 全量重算，刷新卡片 | `applyPresetMode('wander')` | ✅ |
| 切换到优先模式 | 全量重算，刷新卡片 | `applyPresetMode('priority')` | ✅ |
| 手动调权重 | 归一化+全量重算 | `normalizeWeights()` → `saveFormulaConfig()` | ✅ |
| 手动调阈值 | 全量重算 | `saveFormulaConfig()` | ✅ |

### 五、屏蔽系统

| 场景 | 期望行为 | 实际行为 | 状态 |
|------|---------|---------|:----:|
| 屏蔽书签 | 加入屏蔽列表，刷新卡片 | `blockBookmark()` | ✅ |
| 屏蔽域名 | 加入域名屏蔽列表 | `blockDomain()` | ✅ |
| 屏蔽文件夹 | 加入文件夹屏蔽列表 | `blockFolder()` | ✅ |
| 恢复屏蔽书签 | 从列表移除，刷新卡片 | `unblockBookmark()` | ✅ |
| 恢复屏蔽域名 | 从列表移除 | `unblockDomain()` | ✅ |
| 恢复屏蔽文件夹 | 从列表移除 | `unblockFolder()` | ✅ |
| 屏蔽后书签被过滤 | 不出现在推荐卡片 | `baseFilter` 中检查 | ✅ |

### 六、意外情况/异常处理

| 场景 | 期望行为 | 当前实现 | 状态 | 问题 |
|------|---------|---------|:----:|------|
| 浏览器崩溃 | 保留已保存数据 | 每30秒定期保存会话快照 | ✅ | P3已修复 |
| 电脑休眠 | 唤醒后继续追踪 | 1秒心跳检测，唤醒时重置计时起点 | ✅ | P4已修复 |
| 页面刷新 | 恢复之前的卡片状态 | 从storage读取 | ✅ | - |
| 网络中断 | 本地存储不受影响 | storage.local | ✅ | - |
| 书签被删除 | 从缓存移除 | `bookmarks.onRemoved` | ✅ | - |
| 书签被修改 | 更新缓存 | 清除旧T值缓存，重算S值 | ✅ | P5已修复 |

**P3: 浏览器崩溃时数据丢失**
- ActiveTimeTracker 只在以下时机保存会话：URL变化时、标签关闭时、追踪关闭时
- **缺少定期保存机制**，崩溃时当前会话丢失

**P4: 休眠后唤醒**
- 休眠时会话计时可能不准确
- 唤醒后需要重新检测活跃状态

**P5: 书签被修改**
- 书签URL/标题修改后，S值缓存可能失效
- 需要监听 `bookmarks.onChanged` 并更新

### 七、边界条件

| 场景 | 期望行为 | 实际行为 | 状态 |
|------|---------|---------|:----:|
| 没有书签 | 显示空状态 | 卡片显示"所有书签都已翻阅" | ✅ |
| 所有书签已翻阅 | 显示空状态 | 同上 | ✅ |
| 所有书签被屏蔽 | 显示空状态 | 同上 | ✅ |
| 可用书签<3个 | 显示可用的+空卡片 | `setCardEmpty()` | ✅ |
| 刷新时可用书签<3个 | 不排除当前卡片 | `availableBookmarks.length < 3` 时回退 | ✅ |

### 八、并发/竞态

| 场景 | 期望行为 | 实际行为 | 状态 |
|------|---------|---------|:----:|
| 快速连续点击刷新 | 不重复计算 | `isComputingScores` 标志 | ✅ |
| popup和history同时操作 | 状态同步 | storage.onChanged 监听 | ✅ |
| 多个tab同时触发更新 | 合并更新 | 1秒防抖 | ✅ |
| history/popup循环刷新 | 阻止循环 | 500ms时间戳检查 | ✅ |

### 九、冷门场景

| 场景 | 期望行为 | 当前实现 | 状态 | 问题 |
|------|---------|---------|:----:|------|
| 书签标题为空 | 使用URL显示 | `title \|\| url` | ✅ | - |
| 书签URL无效 | 不崩溃 | try-catch | ✅ | - |
| storage配额满 | 优雅降级 | 自动清理+用户提示 | ✅ | P6已修复 |
| 书签数量>10000 | 性能问题 | 分批计算（500+/1000+），批次间50ms暂停 | ✅ | P7已有 |
| 首次使用无缓存 | 全量计算 | `computeAllBookmarkScores` | ✅ | - |
| 权重全为0 | 使用默认值 | `\|\| 0.15` 等 | ✅ | - |
| 阈值为0 | 可能除零错误 | `safeThreshold = Math.max(1, threshold)` | ✅ | P8已修复 |

**P6: storage配额满** - 需要添加错误处理和用户提示

**P7: 书签数量>10000** - 需要分批计算或增量计算优化

**P8: 阈值为0** - 需要添加最小值检查

---

## 问题汇总

| ID | 严重度 | 问题描述 | 修复方案 | 状态 |
|----|:------:|---------|---------|:----:|
| P1 | 中 | 添加待复习时重复计算 | 移除冗余增量更新，依赖模式切换全量重算 | ✅ 已修复 |
| P2 | 中 | 取消待复习可能重复计算 | `applyPresetMode` 检查是否已是目标模式；`cancelPostpone` 检测是否会触发模式切换 | ✅ 已修复 |
| P3 | 高 | 浏览器崩溃时数据丢失 | 添加定期保存机制（每30秒），`createSnapshot` + `resetAccumulated` | ✅ 已修复 |
| P4 | 低 | 休眠后唤醒计时不准 | 休眠检测（1秒心跳），唤醒时重置计时起点 | ✅ 已修复 |
| P5 | 低 | 书签修改后缓存失效 | `onChanged` 监听，清除旧URL的T值缓存，重算S值 | ✅ 已修复 |
| P6 | 低 | storage配额满无处理 | 自动清理（已翻阅/过期待复习/Canvas缩略图）+ 用户提示 | ✅ 已修复 |
| P7 | 中 | 大量书签性能问题 | 分批计算（500+分2批，1000+分3批，批次间50ms暂停） | ✅ 已有 |
| P8 | 低 | 阈值为0除零错误 | `safeThreshold = Math.max(1, threshold)` | ✅ 已修复 |

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
| `history.js` | 添加`trackingRankingCache`（T值静态缓存，按标题/URL双索引） |
| `history.js` | 添加`loadTrackingRankingCache`、`clearTrackingRankingCache`、`getBookmarkCompositeTime` |
| `history.js` | 监听`trackingDataUpdated`消息，增量更新T值缓存 |
| `history.js` | T值变化后触发S值增量更新（`scheduleBookmarkScoreUpdateByUrl`） |
| `history.js` | `applyPresetMode`添加模式检查，避免重复切换时全量重算 |
| `history.js` | `confirmAddToPostponed`移除冗余增量更新（依赖模式切换全量重算） |
| `history.js` | `cancelPostpone`智能判断是否需要增量更新（避免与模式切换重复） |
| `active_time_tracker/index.js` | `saveSession`发送`trackingDataUpdated`消息通知 |
| `active_time_tracker/index.js` | 添加定期保存机制（`PERIODIC_SAVE_INTERVAL`=30秒） |
| `active_time_tracker/index.js` | 添加`createSnapshot`、`resetAccumulated`方法 |
| `active_time_tracker/index.js` | 添加`startPeriodicSave`、`stopPeriodicSave`函数 |
| `active_time_tracker/index.js` | 添加休眠检测（`SLEEP_DETECTION_INTERVAL`=1秒，`SLEEP_THRESHOLD_MS`=5秒） |
| `active_time_tracker/index.js` | 添加`startSleepDetection`、`stopSleepDetection`、`handleWakeFromSleep`函数 |
| `history.js` | `calculateFactorValue`添加阈值最小值保护（`safeThreshold = Math.max(1, threshold)`) |
| `history.js` | `bookmarks.onChanged`监听器添加T值缓存清理和S值重算 |
| `history.js` | 添加`cleanupStorageQuota`函数（清理已翻阅/过期待复习/Canvas缩略图） |
| `history.js` | 添加`showStorageFullWarning`函数（存储满时提示用户） |
| `history.js` | `saveScoresCache`添加配额错误检测和自动清理重试 |
| `popup.js` | 添加`popupLastSaveTime`防循环机制 |
