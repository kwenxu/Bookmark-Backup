# S值系统攻防演练报告

## 演练范围

对书签推荐系统的「权重公式」及所有相关功能进行全面攻击测试，覆盖：
- 热门场景（日常操作）
- 冷门场景（边缘情况）
- 并发/竞态场景
- 错误恢复场景

---

## 一、热门场景攻击

### 1.1 首次安装 → 打开主UI

```
攻击路径: 用户首次安装 → 点击插件图标打开popup
预期行为: 缓存为空 → 请求background计算 → 显示正确S值
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| popup.js检测缓存为空 | ✅ | `Object.keys(scoresCache).length === 0` |
| 发消息请求计算 | ✅ | `sendMessage('computeBookmarkScores')` |
| 等待计算完成 | ✅ | `await requestComputeScores()` |
| 重新读取缓存 | ✅ | `scoresCache = await getPopupScoresCache()` |
| **总结** | ✅ | 流程正确 |

### 1.2 首次安装 → 直接打开HTML页面

```
攻击路径: 用户首次安装 → 直接打开history.html?view=recommend
预期行为: 缓存为空 → 请求background计算 → 显示正确S值
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| history.js检测缓存为空 | ✅ | `Object.keys(scoresCache).length === 0` |
| 发消息请求计算 | ✅ | `sendMessage('computeBookmarkScores')` |
| 等待计算完成 | ✅ | `await new Promise(resolve => sendMessage(..., resolve))` |
| **总结** | ✅ | 流程正确 |

### 1.3 模式切换

```
攻击路径: 用户点击「考古模式」按钮
预期行为: 切换模式 → 保存配置 → 触发全量重算 → 刷新卡片
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| 模式相同时跳过 | ✅ | `if (currentRecommendMode === mode) return` |
| 更新DOM权重值 | ✅ | 设置所有input.value |
| 保存到storage | ✅ | `saveFormulaConfig()` |
| 发消息触发计算 | ✅ | `sendMessage('computeBookmarkScores')` |
| 刷新卡片 | ✅ | `refreshRecommendCards()` |
| **总结** | ✅ | 流程正确 |

### 1.4 手动调整权重

```
攻击路径: 用户拖动权重slider
预期行为: 归一化权重 → 保存配置 → 触发全量重算
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| 权重归一化 | ⚠️ | 需确认normalizeWeights是否在blur时调用 |
| 保存配置 | ✅ | `saveFormulaConfig()` |
| 触发计算 | ✅ | 在saveFormulaConfig内部发消息 |
| **总结** | ⚠️ | 需要验证slider的blur事件绑定 |

### 1.5 点击推荐卡片

```
攻击路径: 用户点击卡片 → 打开链接
预期行为: 标记翻阅 → 记录复习 → 打开链接 → 更新S值
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| 标记翻阅 | ✅ | `markBookmarkFlipped(id)` |
| 记录复习 | ✅ | `recordReview(id)` |
| 发消息更新S值 | ✅ | recordReview内部sendMessage |
| **总结** | ✅ | 流程正确 |

### 1.6 刷新按钮

```
攻击路径: 用户点击刷新按钮
预期行为: 直接从缓存读取 → 跳过当前卡片 → 显示新Top3
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| 不触发重算 | ✅ | `refreshRecommendCards(true)` |
| 跳过当前卡片 | ✅ | force=true时过滤currentCardIds |
| **总结** | ✅ | 流程正确 |

---

## 二、增量更新场景攻击

### 2.1 访问URL（书签对应页面）

```
攻击路径: 用户在浏览器中访问一个已收藏的URL
预期行为: C/D因子变化 → background增量更新S值
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| background监听history.onVisited | ✅ | 有监听器 |
| 1秒防抖 | ✅ | `scheduleScoreUpdateByUrl` |
| 增量更新 | ✅ | `updateSingleBookmarkScore` |
| **HTML页面未打开时** | ✅ | background.js会处理 |
| **总结** | ✅ | 流程正确 |

### 2.2 T值更新（页面停留时间）

```
攻击路径: 用户在某页面停留 → ActiveTimeTracker保存会话
预期行为: T因子变化 → 发送trackingDataUpdated → background增量更新
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| background监听trackingDataUpdated | ✅ | 有监听器 |
| 触发URL增量更新 | ✅ | `scheduleScoreUpdateByUrl(message.url)` |
| **HTML页面未打开时** | ✅ | background.js会处理 |
| **总结** | ✅ | 流程正确 |

### 2.3 新建书签

```
攻击路径: 用户新建一个书签
预期行为: 触发bookmarks.onCreated → 计算新书签S值
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| background监听bookmarks.onCreated | ✅ | 有监听器 |
| 延迟500ms计算 | ✅ | `setTimeout(() => updateSingleBookmarkScore(id), 500)` |
| **总结** | ✅ | 流程正确 |

### 2.4 删除书签

```
攻击路径: 用户删除一个书签
预期行为: 触发bookmarks.onRemoved → 删除缓存条目
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| background监听bookmarks.onRemoved | ✅ | 有监听器 |
| 删除缓存 | ✅ | `delete cache[id]` |
| **总结** | ✅ | 流程正确 |

### 2.5 修改书签（URL/标题变化）

```
攻击路径: 用户修改书签的URL或标题
预期行为: 触发bookmarks.onChanged → 更新S值
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| background监听bookmarks.onChanged | ✅ | 有监听器 |
| 仅URL/标题变化时触发 | ✅ | `if (changeInfo.url || changeInfo.title)` |
| history.js清除T值缓存 | ✅ | `clearTrackingRankingCache()` |
| **总结** | ✅ | 流程正确 |

---

## 三、待复习系统攻击

### 3.1 添加到待复习（通过卡片按钮）

```
攻击路径: 用户点击卡片的「稍后复习」按钮 → 选择时间
预期行为: 添加到待复习队列 → 刷新卡片（不触发S值更新）
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| postponeBookmark只设置时间 | ✅ | 不触发S值更新（正确）|
| L因子仅对manuallyAdded生效 | ✅ | 延迟复习的L=0 |
| **总结** | ✅ | 流程正确 |

### 3.2 手动添加到待复习（L因子=1）

```
攻击路径: 用户通过「添加到待复习」界面批量添加
预期行为: 设置manuallyAdded=true → 可能触发优先模式切换 → 全量重算
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| 设置manuallyAdded=true | ✅ | L因子将=1 |
| loadPostponedList检测 | ✅ | 检测是否有手动添加的书签 |
| 自动切换优先模式 | ✅ | `applyPresetMode('priority')` |
| 模式切换触发全量重算 | ✅ | saveFormulaConfig → sendMessage |
| **重复计算检查** | ✅ | confirmAddToPostponed不再调用updateMultipleBookmarkScores |
| **总结** | ✅ | 流程正确，无重复计算 |

### 3.3 取消待复习

```
攻击路径: 用户点击待复习列表的取消按钮
预期行为: L因子变化 → 发消息增量更新 → 可能触发模式切换
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| 发消息更新S值 | ✅ | `sendMessage('updateBookmarkScore')` |
| 智能判断是否跳过 | ✅ | 如果后续会全量重算，跳过增量更新 |
| 待复习清空→退出优先模式 | ✅ | loadPostponedList检测并调用applyPresetMode('default') |
| **总结** | ✅ | 流程正确 |

### 3.4 提前复习（点击待复习项）

```
攻击路径: 用户点击待复习列表中的书签
预期行为: 取消待复习 + 记录复习 → L和R因子都变化
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| cancelPostpone发消息 | ✅ | 更新L因子 |
| recordReview发消息 | ✅ | 更新R因子 |
| **重复更新问题** | ⚠️ | 两次sendMessage，可能导致两次增量更新 |
| **总结** | ⚠️ | **P1: 可能存在重复更新** |

---

## 四、并发/竞态场景攻击

### 4.1 快速连续点击刷新按钮

```
攻击路径: 用户快速点击刷新按钮5次
预期行为: 只触发一次刷新（或最后一次生效）
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| refreshRecommendCards无防抖 | ⚠️ | 可能导致多次刷新 |
| 不触发计算 | ✅ | 只读缓存 |
| **总结** | ⚠️ | **P2: 可考虑添加防抖** |

### 4.2 快速连续切换模式

```
攻击路径: 用户快速切换「考古→巩固→漫游」模式
预期行为: 只有最后一次生效
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| saveFormulaConfig异步发消息 | ⚠️ | 可能触发多次全量计算 |
| isComputingScores防并发 | ✅ | 第二次计算会被跳过 |
| **配置覆盖问题** | ⚠️ | 第一次计算使用的是第一次的配置，但storage已更新为最后一次 |
| **总结** | ⚠️ | **P3: 配置和计算可能不同步** |

### 4.3 popup和history同时操作

```
攻击路径: popup翻完3张卡片，同时history也在操作
预期行为: 两边状态同步，不循环刷新
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| 500ms时间戳防循环 | ✅ | historyLastSaveTime/popupLastSaveTime |
| storage.onChanged监听 | ✅ | 双向同步 |
| **总结** | ✅ | 流程正确 |

### 4.4 多个HTML页面同时打开

```
攻击路径: 用户打开3个history.html?view=recommend
预期行为: 读取同一个缓存，显示一致
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| 共享recommend_scores_cache | ✅ | 所有页面读同一个 |
| 一个页面修改配置 | ⚠️ | 其他页面DOM未更新 |
| **总结** | ⚠️ | **P4: 多页面配置同步问题** |

---

## 五、冷门场景攻击

### 5.1 书签数量>10000

```
攻击路径: 用户有大量书签
预期行为: 分批计算，不阻塞UI
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| 分批计算 | ✅ | 1000+分3批 |
| 批次间暂停 | ✅ | 50ms |
| **总结** | ✅ | 流程正确 |

### 5.2 storage配额满

```
攻击路径: 用户存储空间已满
预期行为: 自动清理 → 重试保存
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| history.js有cleanupStorageQuota | ✅ | 清理已翻阅/过期/缩略图 |
| background.js是否有处理 | ❌ | **saveScoresCache无错误处理** |
| **总结** | ⚠️ | **P5: background.js需要添加配额错误处理** |

### 5.3 追踪功能关闭

```
攻击路径: 用户关闭活跃时间追踪
预期行为: T权重变0，其他权重归一化
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| background.js读取trackingEnabled | ✅ | **已修复**: 改用正确键名`trackingEnabled` |
| active_time_tracker保存 | ✅ | 使用正确键名`trackingEnabled` |
| 权重归一化逻辑 | ✅ | `if (!config.trackingEnabled)` |
| **总结** | ✅ | **P6已修复** |

### 5.4 书签没有URL（文件夹）

```
攻击路径: 计算时遇到文件夹节点
预期行为: 跳过，不计算
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| 只收集有URL的节点 | ✅ | `if (node.url) allBookmarks.push(node)` |
| **总结** | ✅ | 流程正确 |

### 5.5 书签URL无效

```
攻击路径: 书签URL格式错误（如javascript:）
预期行为: 不崩溃，正常处理
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| isBlockedDomain有try-catch | ✅ | `catch { return false }` |
| history.getVisits可能失败 | ⚠️ | 需确认是否有错误处理 |
| **总结** | ⚠️ | **P7: 需验证无效URL的错误处理** |

### 5.6 浏览器崩溃恢复

```
攻击路径: 浏览器崩溃后重启
预期行为: 使用已保存的缓存，继续工作
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| S值缓存持久化 | ✅ | storage.local |
| 会话定期保存 | ✅ | 30秒快照 |
| **总结** | ✅ | 流程正确 |

---

## 六、屏蔽系统攻击

### 6.1 屏蔽书签

```
攻击路径: 用户点击卡片的屏蔽按钮
预期行为: 加入屏蔽列表 → 刷新卡片（被屏蔽的不显示）
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| 加入blockedBookmarks | ✅ | `blockBookmark()` |
| 刷新卡片 | ✅ | `refreshRecommendCards(true)` |
| 下次全量计算时过滤 | ✅ | `!blocked.bookmarks.has(b.id)` |
| **总结** | ✅ | 流程正确 |

### 6.2 屏蔽域名

```
攻击路径: 用户在屏蔽设置中添加域名
预期行为: 该域名下所有书签不参与计算
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| 过滤检查 | ✅ | `isBlockedDomain(bookmark)` |
| **总结** | ✅ | 流程正确 |

### 6.3 恢复屏蔽

```
攻击路径: 用户恢复一个屏蔽的书签
预期行为: 从屏蔽列表移除 → 下次计算时包含
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| 从列表移除 | ✅ | `unblockBookmark()` |
| 刷新卡片 | ✅ | `refreshRecommendCards()` |
| **增量更新问题** | ⚠️ | 恢复后该书签可能没有S值缓存 |
| **总结** | ⚠️ | **P8: 恢复屏蔽后可能需要触发单书签计算** |

---

## 七、复习曲线攻击

### 7.1 R因子计算

```
攻击路径: 复习后R因子变化
预期行为: R = 0.7（刚复习）→ 1.0（到期）
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| 复习后更新S值 | ✅ | recordReview → sendMessage |
| R因子范围 | ✅ | 0.7~1.0 |
| **总结** | ✅ | 流程正确 |

### 7.2 复习后手动添加标记清除

```
攻击路径: 用户复习一个手动添加的待复习书签
预期行为: manuallyAdded标记被清除 → L因子变0
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| recordReview清除标记 | ✅ | `postponeInfo.manuallyAdded = false` |
| L因子更新 | ✅ | 下次计算时L=0 |
| **总结** | ✅ | 流程正确 |

---

## 八、数据一致性攻击

### 8.1 popup和history显示不同S值

```
攻击路径: popup和history同时显示同一书签
预期行为: S值相同
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| 共享recommend_scores_cache | ✅ | 同一个storage |
| **总结** | ✅ | 流程正确 |

### 8.2 DOM配置和storage配置不一致

```
攻击路径: history.js的DOM更新后storage还没同步
预期行为: 以storage为准进行计算
```

| 检查项 | 状态 | 问题 |
|--------|:----:|------|
| background.js从storage读取 | ✅ | `getFormulaConfig()` |
| saveFormulaConfig先保存后发消息 | ✅ | 顺序正确 |
| **总结** | ✅ | 流程正确 |

---

## 问题汇总

| ID | 严重度 | 问题描述 | 修复状态 |
|----|:------:|---------|:--------:|
| P1 | 低 | 提前复习时cancelPostpone和recordReview各发一次消息，可能导致两次增量更新 | 待修复 |
| P2 | 低 | refreshRecommendCards无防抖，快速点击可能多次刷新 | 待修复 |
| P3 | 中 | 快速切换模式时，配置和计算可能不同步 | 待修复 |
| P4 | 低 | 多个HTML页面打开时，一个页面修改配置，其他页面DOM未更新 | 待修复 |
| P5 | 中 | background.js的saveScoresCache无配额错误处理 | ✅ 已修复 |
| P6 | **高** | **键名不一致BUG**: active_time_tracker保存`trackingEnabled`，background.js读取`activeTimeTrackingEnabled` | ✅ 已修复 |
| P7 | 低 | 无效URL可能导致history API错误 | 待修复 |
| P8 | 中 | 恢复屏蔽后书签可能没有S值缓存 | ✅ 已修复 |

---

## 修复建议优先级

### 高优先级 ✅ 已全部修复
1. ~~**P6**: **键名BUG** - background.js使用了错误的键名~~ → **已修复**: 改用`trackingEnabled`
2. ~~**P5**: background.js添加存储配额错误处理~~ → **已修复**: 添加try-catch和自动清理
3. ~~**P8**: 恢复屏蔽后触发单书签S值计算~~ → **已修复**: unblockBookmark后发送消息

### 中优先级（建议本周修复）
4. **P3**: 添加配置版本校验，防止计算使用旧配置

### 低优先级（可择机修复）
5. **P1**: 合并提前复习的两次消息
6. **P2**: 添加刷新按钮节流
7. **P4**: 多页面配置同步
8. **P7**: 增强无效URL错误处理

---

## 正向验证清单

| 场景 | 预期行为 | 验证状态 |
|------|---------|:--------:|
| popup首次打开 | 缓存为空→请求计算→显示正确S值 | ✅ |
| history首次打开 | 缓存为空→请求计算→显示正确S值 | ✅ |
| 模式切换 | 保存配置→触发全量计算→刷新卡片 | ✅ |
| 手动调权重 | 保存配置→触发全量计算 | ✅ |
| 点击卡片 | 标记翻阅→记录复习→更新S值 | ✅ |
| 刷新按钮 | 只读缓存→显示新Top3 | ✅ |
| 访问书签URL | C/D因子变化→增量更新 | ✅ |
| T值更新 | T因子变化→增量更新 | ✅ |
| 新建书签 | 触发增量计算 | ✅ |
| 删除书签 | 删除缓存条目 | ✅ |
| 修改书签 | 触发增量更新 | ✅ |
| 添加待复习 | 可能切换优先模式→全量重算 | ✅ |
| 取消待复习 | L因子变化→增量更新 | ✅ |
| 屏蔽书签 | 加入列表→刷新卡片 | ✅ |
| 追踪关闭 | T权重归0→其他归一化 | ✅ |
| popup和history同步 | 使用同一缓存 | ✅ |
| 并发计算防护 | isComputingScores标志 | ✅ |
| 循环刷新防护 | 500ms时间戳检查 | ✅ |

---

## 结论

系统整体设计合理，主要流程验证通过。

**发现8个问题，已修复3个高优先级问题：**
- ✅ P6: 修复键名不一致BUG（`activeTimeTrackingEnabled` → `trackingEnabled`）
- ✅ P5: 添加存储配额错误处理和自动清理
- ✅ P8: 恢复屏蔽后触发S值计算

**剩余5个低/中优先级问题可择机修复。**
