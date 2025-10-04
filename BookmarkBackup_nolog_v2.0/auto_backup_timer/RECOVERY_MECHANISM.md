# 自动备份定时器 - 恢复机制说明
# Auto Backup Timer - Recovery Mechanism Documentation

## 概述 / Overview

本文档说明自动备份定时器在浏览器从休眠恢复或重新打开时的智能恢复机制。

This document describes the intelligent recovery mechanism of the auto backup timer when the browser resumes from sleep or is reopened.

---

## 核心前提条件 / Core Prerequisite ⭐⭐⭐

**所有恢复操作都必须满足：角标变黄（有书签数量/结构变化）**

All recovery operations require: **Badge turns yellow (bookmark quantity/structure changes detected)**

**工作流程** / **Workflow:**
```
浏览器启动/休眠恢复
  ↓
检查书签变化（角标是否应该黄）
  ├─ 无变化 → 跳过所有遗漏检查 ← 节省资源
  └─ 有变化 → 执行遗漏检查 → 可能补充备份
```

- 如果没有检测到书签变化，所有遗漏检查将被跳过，节省系统资源
- If no bookmark changes are detected, all missed backup checks will be skipped to save system resources
- **这确保了系统按照"以变化为驱动"的设计原则运行**
- **This ensures the system operates on a "change-driven" design principle**

---

## 三种备份场景的恢复策略 / Recovery Strategies for Three Backup Scenarios

### 场景 1：常规时间（周一～周日）/ Scenario 1: Regular Time (Mon-Sun)

#### 行为 / Behavior

**浏览器启动或从休眠恢复时** / **On browser startup or resume from sleep:**

1. **检查前提**：首先验证是否有书签变化（角标是否黄）
   - **Check prerequisite**: First verify if there are bookmark changes (badge yellow)

2. **检查是否已补充**：验证今天是否已经执行过补充备份 ⭐ **NEW**
   - **Check if already backed up**: Verify if missed backup was already executed today ⭐ **NEW**
   - 已补充 → **跳过，避免重复**
     - Already backed up → **Skip to avoid duplication**

3. **检查周勾选**：确认今天是否在启用的日期范围内
   - **Check week selection**: Confirm if today is within enabled dates

4. **检查默认时间**：
   - **Check default time**:
   - 若已过默认时间（如 10:00）→ **执行补充备份一次**，并记录今天已补充
     - If past default time (e.g., 10:00) → **Execute补充backup once**, mark as executed today
   - 若未过默认时间 → **设置定时器正常等待**
     - If not past default time → **Set timer to wait normally**

#### 周勾选的影响 / Impact of Week Selection

- 周一～周日的勾选**不仅**决定周定时器，还决定当天的**分钟间隔**和**小时间隔**是否启用
- Week selection (Mon-Sun) **not only** determines week timers, but also whether **minute intervals** and **hour intervals** are enabled for that day

**示例** / **Example:**
```
设置：周一、周三、周五勾选
- 周一 10:00 默认时间，每 30 分钟间隔
```
```
Settings: Monday, Wednesday, Friday enabled
- Monday 10:00 default time, every 30 minutes interval
```

- **周一 09:00 启动浏览器** → 设置 10:00 定时器，设置 30 分钟间隔定时器
  - **Start browser Monday 09:00** → Set 10:00 timer, set 30-min interval timer
  
- **周一 11:00 启动浏览器** → 立即补充一次备份，设置 30 分钟间隔定时器
  - **Start browser Monday 11:00** → Immediately execute backup, set 30-min interval timer
  
- **周二 10:00 启动浏览器** → 不设置任何定时器（因为周二未勾选）
  - **Start browser Tuesday 10:00** → No timers set (Tuesday not enabled)

---

### 场景 2：分钟/小时间隔 / Scenario 2: Minute/Hour Intervals

#### 行为 / Behavior

**浏览器启动或从休眠恢复时** / **On browser startup or resume from sleep:**

1. **检查前提**：验证书签变化和周勾选
   - **Check prerequisite**: Verify bookmark changes and week selection

2. **不做遗漏检测**：不检查是否错过了之前的间隔点
   - **No missed backup detection**: Don't check if previous interval points were missed

3. **智能计算下一个间隔点**：根据当前时间直接计算下一个执行时间
   - **Intelligent calculation of next interval**: Calculate next execution time based on current time

#### 智能间隔计算 / Intelligent Interval Calculation

**示例：15 分钟间隔** / **Example: 15-minute interval**

- **15:01 关闭浏览器** / **Browser closed at 15:01**
- **15:08 打开浏览器** → 继续等待 **15:15** 的定时器
  - **Browser opened at 15:08** → Continue waiting for **15:15** timer
  
- **15:17 打开浏览器** → 直接设置 **15:30** 的定时器（跳过 15:15）
  - **Browser opened at 15:17** → Directly set **15:30** timer (skip 15:15)

**小时间隔同理** / **Hour intervals work similarly**

#### 跨天处理 / Cross-Day Handling

当间隔定时器触发时，会检查：
When interval timer triggers, it checks:

1. 今天是否在周勾选范围内
   - If today is within week selection
   
2. 下一个间隔点是否跨天
   - If next interval crosses to a new day

**如果跨天或今天未勾选** → 停止间隔定时器，等待周定时器在下一个勾选日重新设置
**If crossing day or today not enabled** → Stop interval timer, wait for week timer to reset on next enabled day

---

### 场景 3：特定时间 / Scenario 3: Specific Time

#### 行为 / Behavior

**浏览器启动或从休眠恢复时** / **On browser startup or resume from sleep:**

1. **检查前提**：验证书签变化
   - **Check prerequisite**: Verify bookmark changes

2. **检索当日任务**：只处理今天的特定时间任务
   - **Retrieve today's tasks**: Only process today's specific time tasks

3. **处理逻辑** / **Processing logic:**
   - **已错过的当日任务** → 立即执行补充备份**一次**，标记为已执行 ⭐
     - **Missed tasks today** → Execute backup **once**, mark as executed ⭐
     - **重复打开浏览器不会重复备份**（已标记为 `executed`）
     - **Won't re-execute on repeated browser opens** (marked as `executed`)
     
   - **未错过的当日任务** → 设置定时器正常等待
     - **Upcoming tasks today** → Set timer to wait normally
     
   - **过期任务（昨天或更早）** → 仅标记为已执行，不备份
     - **Expired tasks (yesterday or earlier)** → Only mark as executed, no backup

---

## 技术实现细节 / Technical Implementation Details

### 关键函数 / Key Functions

#### 1. `checkMissedBackups()`

在浏览器启动时（`onStartup`）和定时器系统初始化时调用。
Called on browser startup (`onStartup`) and timer system initialization.

**流程** / **Flow:**
```javascript
1. 检查书签变化 (hasBookmarkChanges)
   - 无变化 → 跳过所有检查
   - 有变化 → 继续

2. 根据备份模式执行相应检查：
   - regular: 检查常规时间 + 周勾选
   - specific: 检查特定时间任务

3. 执行必要的补充备份
```

#### 2. `setupRegularTimeAlarms()`

设置常规时间定时器时，会检查周勾选状态。
When setting regular time alarms, checks week selection status.

**逻辑** / **Logic:**
```javascript
- 如果今天在周勾选范围内：
  - 设置分钟/小时间隔定时器
  
- 如果今天不在周勾选范围内：
  - 跳过间隔定时器设置
  - 只设置周定时器（指向下一个勾选日）
```

#### 3. `handleAlarmTrigger()`

处理定时器触发时的跨天逻辑。
Handles cross-day logic when alarm triggers.

**对于间隔定时器** / **For interval timers:**
```javascript
1. 检查今天是否在周勾选范围内
   - 不在 → 停止定时器
   
2. 执行备份

3. 计算下一个间隔点
   - 如果跨天 → 停止定时器
   - 否则 → 重新设置定时器
```

---

## 防重复机制 / Duplicate Prevention Mechanism

为了避免短时间内触发多次备份，系统实现了防重复机制：
To avoid triggering multiple backups in a short time, the system implements duplicate prevention:

```javascript
- 备份进行中标志 (isBackupInProgress)
- 最小备份间隔：5 秒
- 如果正在备份或距离上次触发不到 5 秒，跳过本次触发
```

---

## 性能优化 / Performance Optimization

1. **按需检查**：只在角标变黄时才执行遗漏检查
   - **On-demand checking**: Only execute missed checks when badge turns yellow

2. **智能跳过**：周未勾选的日期自动跳过所有检查
   - **Intelligent skipping**: Automatically skip all checks on unchecked days

3. **定时器清理**：跨天或日期未勾选时主动清理定时器
   - **Timer cleanup**: Actively clear timers when crossing days or on unchecked dates

4. **防抖机制**：避免短时间内重复触发备份
   - **Debounce mechanism**: Avoid triggering backups repeatedly in a short time

---

## 测试场景 / Test Scenarios

### 推荐测试用例 / Recommended Test Cases

1. **常规时间 - 过期恢复**
   - Regular time - expired recovery
   - 设置默认时间 10:00，关闭浏览器到 11:00 后打开
   - Set default time 10:00, close browser and reopen at 11:00
   - 预期：立即执行一次补充备份
   - Expected: Execute immediate backup

2. **常规时间 - 未过期恢复**
   - Regular time - not expired recovery
   - 设置默认时间 14:00，在 13:00 打开浏览器
   - Set default time 14:00, open browser at 13:00
   - 预期：设置 14:00 定时器，不执行备份
   - Expected: Set 14:00 timer, no immediate backup

3. **间隔恢复 - 智能计算**
   - Interval recovery - intelligent calculation
   - 设置 30 分钟间隔，关闭浏览器再打开
   - Set 30-minute interval, close and reopen browser
   - 预期：根据当前时间计算下一个间隔点
   - Expected: Calculate next interval based on current time

4. **周勾选影响**
   - Week selection impact
   - 只勾选周一、周三、周五，在周二打开浏览器
   - Only enable Mon, Wed, Fri, open browser on Tuesday
   - 预期：不设置任何定时器
   - Expected: No timers set

5. **特定时间 - 当日遗漏**
   - Specific time - today's missed task
   - 设置今天 10:00 的任务，在 11:00 打开浏览器
   - Set task for today 10:00, open browser at 11:00
   - 预期：立即执行备份并标记为已执行
   - Expected: Execute backup immediately and mark as executed

6. **跨天情况**
   - Cross-day scenario
   - 设置 30 分钟间隔，在 23:45 触发，下一个间隔在 00:15
   - Set 30-minute interval, trigger at 23:45, next at 00:15
   - 预期：不设置跨天的定时器，等待周定时器重新设置
   - Expected: Don't set cross-day timer, wait for week timer reset

7. **无变化情况**
   - No changes scenario
   - 没有书签变化时打开浏览器
   - Open browser without bookmark changes
   - 预期：跳过所有遗漏检查
   - Expected: Skip all missed backup checks

---

## 日志监控 / Log Monitoring

关键日志信息 / Key log messages:

```
[自动备份定时器] 开始检查遗漏的备份任务...
[自动备份定时器] 未检测到书签变化（角标未变黄），跳过遗漏检查
[自动备份定时器] 检测到书签变化（角标变黄），继续检查遗漏任务
[自动备份定时器] 已过默认时间 10:00，执行补充备份
[自动备份定时器] 今天未在周勾选范围内，跳过常规时间遗漏检查
[自动备份定时器] 发现当日遗漏的特定时间任务: 2024-01-02T17:23
[自动备份定时器] 下一个小时间隔已跨天，停止定时器，等待周定时器重新设置
[自动备份定时器] 遗漏备份任务检查完成
```

---

## 更新日志 / Changelog

### 2024-10-04 (最新 v5) ⭐
- ✅ **Bug修复**：移除 `setBadge()` 防抖机制，避免角标不更新的问题
- ✅ **重要新增**：实现休眠恢复检测机制，基于时间间隔（10分钟）自动判断
- ✅ **重要新增**：添加 `lastMissedCheckTime` 记录上次检查时间，避免频繁检查
- ✅ **重要新增**：定时器初始化支持 'auto' 模式，智能检测休眠恢复
- ✅ **重要修复**：常规时间的补充备份只执行一次，添加 `lastMissedBackupDate` 记录
- ✅ **重要修复**：特定时间任务的补充备份只执行一次，依赖 `executed` 标记
- ✅ **Bug修复**：遗漏检查完全独立，在 `onStartup` 强制执行，在定时器启动时自动判断
- ✅ **Bug修复**：补充备份成功后正确重置 `lastCalculatedDiff` 为 0，角标变绿
- ✅ 实现常规时间的遗漏恢复逻辑（过期补充，未过期继续）
- ✅ 实现分钟/小时间隔的智能恢复（直接计算下一个间隔点）
- ✅ 实现特定时间任务的当日遗漏检测
- ✅ 添加周勾选对间隔定时器的影响
- ✅ 实现跨天情况的智能处理
- ✅ 添加防重复触发机制
- ✅ 优化性能：只在角标变黄时执行检查

### 2024-10-04 (Latest)
- ✅ **Bug Fix**: Missed check now only executes on browser startup, not when badge turns yellow
- ✅ **Bug Fix**: Badge correctly updates to green after successful补充backup (reset lastCalculatedDiff to 0)
- ✅ Implemented missed recovery logic for regular time (补充if expired, continue if not)
- ✅ Implemented intelligent recovery for minute/hour intervals (calculate next interval directly)
- ✅ Implemented today's missed task detection for specific time
- ✅ Added week selection impact on interval timers
- ✅ Implemented intelligent cross-day handling
- ✅ Added duplicate trigger prevention mechanism
- ✅ Performance optimization: Only execute checks when badge turns yellow
