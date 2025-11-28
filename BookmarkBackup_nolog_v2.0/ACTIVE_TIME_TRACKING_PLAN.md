# 活跃时间追踪方案

> 此文档为「书签推荐」功能的子模块，详细描述活跃时间追踪的实现方案。

## 一、方案概述

采用**混合追踪方案**：历史记录 + 实时标签页监控

```
┌─────────────────────────────────────────────────────────────┐
│                    活跃时间追踪架构                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌──────────────┐  │
│  │ 历史记录    │     │ 标签页监控   │     │ 窗口焦点     │  │
│  │ getVisits   │     │ tabs API    │     │ windows API  │  │
│  └──────┬──────┘     └──────┬──────┘     └──────┬───────┘  │
│         │                   │                   │          │
│         ▼                   ▼                   ▼          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              书签URL/标题匹配器                      │   │
│  │         (bookmarkUrlSet / bookmarkTitleSet)         │   │
│  └──────────────────────────┬──────────────────────────┘   │
│                             │                              │
│                             ▼                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              活跃会话管理器                          │   │
│  │  - 开始时间 / 结束时间 / 累计时长                    │   │
│  │  - 只计算「真正活跃」的时间                          │   │
│  └──────────────────────────┬──────────────────────────┘   │
│                             │                              │
│                             ▼                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           IndexedDB (active_sessions)               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、「真正活跃」判定条件

| 条件 | 检测API | 不计时的情况 |
|------|---------|-------------|
| 标签页在前台 | `chrome.tabs.onActivated` | 切换到其他标签 |
| 窗口有焦点 | `chrome.windows.onFocusChanged` | 窗口最小化/失焦 |
| 浏览器未休眠 | `chrome.idle.onStateChanged` | 电脑锁屏/休眠 |
| 是书签URL | URL/标题匹配 | 非书签页面 |

---

## 三、状态机设计

```
                    ┌──────────────┐
                    │   INACTIVE   │  ← 初始状态
                    └──────┬───────┘
                           │ 打开书签URL + 窗口有焦点
                           ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   PAUSED     │◄───│   ACTIVE     │───►│   ENDED      │
│  (暂停计时)   │    │  (计时中)     │    │  (结束会话)   │
└──────┬───────┘    └──────────────┘    └──────┬───────┘
       │                   ▲                   │
       │  窗口恢复焦点      │                   │
       └───────────────────┘                   │
                                               ▼
                                    ┌──────────────┐
                                    │  保存到DB    │
                                    └──────────────┘
```

### 状态转换触发条件

| 转换 | 触发条件 |
|------|---------|
| INACTIVE → ACTIVE | 书签URL在前台 + 窗口有焦点 |
| ACTIVE → PAUSED | 切换标签 / 窗口失焦 / 电脑休眠 |
| PAUSED → ACTIVE | 恢复焦点到该标签 |
| ACTIVE → ENDED | 关闭标签 / URL导航离开 |
| PAUSED → ENDED | 关闭标签（暂停状态下关闭） |

---

## 四、监听事件清单

```javascript
// background.js 中需要添加的监听器

// 1. 标签页切换
chrome.tabs.onActivated.addListener((activeInfo) => {
    // activeInfo.tabId, activeInfo.windowId
});

// 2. URL变化（页面导航）
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // changeInfo.url 变化时触发
});

// 3. 关闭标签页
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    // 结束该标签的活跃会话
});

// 4. 窗口焦点变化
chrome.windows.onFocusChanged.addListener((windowId) => {
    // windowId === chrome.windows.WINDOW_ID_NONE 表示失焦
});

// 5. 电脑休眠/锁屏
chrome.idle.onStateChanged.addListener((newState) => {
    // newState: 'active' | 'idle' | 'locked'
});
```

---

## 五、数据结构

### 5.1 active_sessions 表 (IndexedDB)

```javascript
{
    id: string,               // 自动生成的唯一ID
    url: string,              // 页面URL
    bookmarkId: string,       // 关联书签ID（匹配成功时）
    title: string,            // 页面标题
    
    // 时间字段
    startTime: timestamp,     // 会话开始时间
    endTime: timestamp,       // 会话结束时间
    totalMs: number,          // 总时长（含暂停）= endTime - startTime
    activeMs: number,         // 实际活跃毫秒数（排除暂停时间）
    
    // 暂停统计（用于区分资料类型）
    pauseCount: number,       // 暂停次数
    pauseTotalMs: number,     // 累计暂停时长
    
    // 元数据
    source: 'tabs' | 'history',  // 数据来源
    matchType: 'url' | 'title' | 'both',  // 书签匹配方式
    tabId: number,            // 标签页ID
    windowId: number,         // 窗口ID
    
    createdAt: timestamp
}
```

### 5.2 运行时会话对象

```javascript
// 内存中维护的当前活跃会话
const activeSessions = new Map(); // tabId -> SessionState

class SessionState {
    tabId: number;
    url: string;
    bookmarkId: string;
    
    state: 'active' | 'paused';
    startTime: number;
    activeStartTime: number;      // 当前活跃段的开始时间
    accumulatedActiveMs: number;  // 已累积的活跃时长
    
    pauseCount: number;
    pauseTotalMs: number;
    lastPauseTime: number;        // 上次暂停时间
}
```

---

## 六、挂机页面判定

> 注意：阅读/参考/工具类型难以自动准确判断，容易误判。
> 因此只自动判定「挂机页面」，其他类型展示原始数据让用户自行判断。

### 挂机判定规则

```javascript
// 挂机判定（相对准确）
function isIdlePage(session) {
    const { totalMs, activeMs } = session;
    const activeRatio = activeMs / totalMs;
    
    // 条件：总时长>30分钟 且 活跃占比<15%
    return totalMs > 30 * 60 * 1000 && activeRatio < 0.15;
}
```

| 指标 | 阈值 | 说明 |
|------|------|------|
| 总时长 | >30分钟 | 打开时间足够长 |
| 活跃占比 | <15% | 大部分时间没在看 |

### 展示原始数据

不做复杂的类型推断，直接展示三个核心指标：

| 指标 | 计算方式 | 用途 |
|------|---------|------|
| **活跃时间** | `activeMs` 转换为时分秒 | 实际浏览时长 |
| **暂停次数** | `pauseCount` | 反映使用模式 |
| **活跃占比** | `activeMs / totalMs × 100%` | 专注程度 |

用户可根据这些数据自行判断是阅读、参考还是工具页面。

---

## 七、追踪开关与公式联动

### 开关状态

| 状态 | 说明 | 公式中的S |
|:----:|------|:--------:|
| ● 开启 | 正常追踪活跃时间 | 有效 |
| ○ 关闭 | 停止追踪 | 变为0 |

### 公式自动调整

```
追踪开启时：
P = [0.15]×F + [0.25]×C + [0.30]×S + [0.25]×D
                         ─────
                         浅阅读（生效）

追踪关闭时（自动归一化）：
P = [0.20]×F + [0.33]×C + [0.00]×S + [0.33]×D
                         ─────
                         浅阅读=0（禁用）
```

### 归一化计算

```javascript
// 追踪关闭时，S权重变0，其他权重重新分配
function normalizeWeights(weights, trackingEnabled) {
    if (trackingEnabled) {
        return weights; // 原样返回
    }
    
    // S变0，其他按比例放大
    const { W1, W2, W3, W4 } = weights;
    const remaining = W1 + W2 + W4; // 排除W3(浅阅读)
    
    return {
        W1: W1 / remaining,  // 新鲜度
        W2: W2 / remaining,  // 冷门度
        W3: 0,               // 浅阅读 = 0
        W4: W4 / remaining   // 遗忘度
    };
}
```

### UI表现

追踪关闭时，公式中的S项显示删除线：

```
P = [0.20]×F + [0.33]×C + [0̶.̶0̶0̶]̶×̶S̶ + [0.33]×D
                         ~~~~~~
                         删除线样式
```

---

## 八、时间捕捉UI设计

### 整体布局

```
┌──── 时间捕捉 ─────────────────────────────── [追踪: ● 开启] ──┐
│                                                               │
│  📖 正在追踪的书签 (3)                                         │
│  ┌───────────────────────────────────────────────────────────┐│
│  │ 🟢 如何学习编程          ⏱ 03:25   暂停2次   活跃92%     ││
│  │ 🟡 React文档             ⏱ 15:30   暂停8次   活跃45%     ││
│  │ 🟡 某PDF手册             ⏱ 48:12   暂停23次  活跃8% ⚠挂机 ││
│  │ 🟢 TypeScript文档        ⏱ 02:15   暂停0次   活跃100%    ││
│  └───────────────────────────────────────────────────────────┘│
│                                                               │
│  ⏱ 活跃时间排行                                    [本周 ▼]  │
│  ┌───────────────────────────────────────────────────────────┐│
│  │ 1. GitHub文档       2h15m   暂停5次   活跃78%  ██████████ ││
│  │ 2. MDN Web Docs     1h42m   暂停12次  活跃52%  ████████   ││
│  │ 3. Stack Overflow   58m     暂停28次  活跃35%  █████      ││
│  │ 4. 某PDF文档        45m     暂停3次   活跃6%   ████ ⚠挂机 ││
│  └───────────────────────────────────────────────────────────┘│
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### 状态指示器

| 图标 | 状态 | 说明 |
|:----:|------|------|
| 🟢 | 活跃中 | 当前标签页在前台 |
| 🟡 | 已暂停 | 标签页失焦/切换到其他标签 |
| ⚠挂机 | 挂机页面 | 符合挂机判定条件 |

### 列表项信息

每个条目显示：
- **书签标题**（点击可切换到该标签页）
- **活跃时间**：格式 `HH:mm` 或 `XXm`
- **暂停次数**：`暂停N次`
- **活跃占比**：`活跃XX%`
- **挂机标记**：符合条件时显示 `⚠挂机`

### 交互功能

| 操作 | 功能 |
|------|------|
| 点击书签行 | 切换到该标签页 |
| 点击「追踪: 开启」 | 切换追踪状态 |
| 时间范围下拉 | 切换 今天/本周/本月/全部 |
| 点击排行项 | 展开详细时间线 |

---

## 九、配置参数

```javascript
const ACTIVE_TIME_CONFIG = {
    // 最小计时阈值：活跃时间 < 3秒不记录
    MIN_ACTIVE_MS: 3000,
    
    // 去重合并：同一URL 5分钟内多次访问合并
    MERGE_WINDOW_MS: 5 * 60 * 1000,
    
    // 批量写入：累积5条后批量写DB
    BATCH_SIZE: 5,
    
    // 历史补充间隔：每30分钟用getVisits补充
    HISTORY_SYNC_INTERVAL_MS: 30 * 60 * 1000,
    
    // idle检测阈值：用户无操作超过60秒视为idle
    IDLE_DETECTION_INTERVAL: 60
};
```

---

## 八、实现步骤

| 步骤 | 任务 | 文件 |
|:----:|------|------|
| 1 | 创建 ActiveTimeTracker 类 | background.js 或独立模块 |
| 2 | 注册所有事件监听器 | background.js |
| 3 | 实现状态机逻辑 | ActiveTimeTracker |
| 4 | 添加 IndexedDB 存储 | active_sessions 表 |
| 5 | 实现书签匹配逻辑 | 复用现有 bookmarkUrlSet |
| 6 | 添加历史记录补充 | 定时任务 |
| 7 | 暴露 API 给前端 | chrome.runtime.sendMessage |

---

## 九、API接口

```javascript
// 前端可调用的消息接口

// 获取书签的累计活跃时间
{ action: 'getBookmarkActiveTime', bookmarkId: string }
→ { totalActiveMs, sessionCount, avgActiveMs, contentType }

// 获取某时间段的活跃记录
{ action: 'getActiveSessions', startTime, endTime }
→ { sessions: [...] }

// 获取当前活跃的书签标签
{ action: 'getCurrentActiveSessions' }
→ { activeTabs: [...] }
```

---

## 十、与权重公式的集成

活跃时间数据将用于计算「浅阅读度」因子：

```javascript
// 浅阅读度 = 1 - min(累计活跃时间 / 5分钟, 1)
function calcShallowReadScore(bookmarkId) {
    const stats = await getBookmarkActiveTime(bookmarkId);
    const threshold = 5 * 60 * 1000; // 5分钟
    return 1 - Math.min(stats.totalActiveMs / threshold, 1);
}
```

---

## 更新日志

- 2024-XX-XX: 初始方案文档创建
