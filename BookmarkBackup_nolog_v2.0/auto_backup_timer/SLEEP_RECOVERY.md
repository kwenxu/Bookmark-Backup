# 休眠恢复机制说明
# Sleep Recovery Mechanism

## 问题

之前的实现只处理了 **浏览器启动**（`onStartup`），没有处理 **休眠恢复**。

**Previous implementation only handled browser startup (`onStartup`), not sleep recovery.**

- ✅ 浏览器启动（关闭后重新打开）→ 会检查遗漏
- ❌ 休眠恢复（电脑睡眠/Service Worker 唤醒）→ 不会检查遗漏

---

## 解决方案

添加**基于时间间隔的智能检测**：

**Added intelligent detection based on time intervals:**

### 核心机制

1. **记录检查时间戳**
   - 添加 `lastMissedCheckTime` 字段
   - 每次检查遗漏时更新时间戳

2. **10分钟阈值判断**
   - 当定时器系统初始化时，检查距离上次检查的时间
   - 如果超过10分钟 → 可能是休眠恢复 → 执行遗漏检查
   - 如果不到10分钟 → 短时间内重复 → 跳过检查

3. **三种模式**
   ```javascript
   initializeTimerSystem(true)   // 强制检查（浏览器启动）
   initializeTimerSystem(false)  // 不检查
   initializeTimerSystem('auto') // 自动判断（可能是休眠恢复）
   ```

---

## 工作流程

### 浏览器启动时

```
onStartup 事件
  ↓
initializeTimerSystem(true) ← 强制检查
  ↓
执行 checkMissedBackups()
  ↓
更新 lastMissedCheckTime
```

### 休眠恢复时

```
Service Worker 被唤醒
  ↓
角标变黄（有书签变化）
  ↓
启动定时器
  ↓
initializeTimerSystem('auto') ← 自动模式
  ↓
检查距离上次检查的时间
  ├─ < 10分钟 → 跳过（短时间内重复）
  └─ ≥ 10分钟 → 执行 checkMissedBackups() + 更新时间戳
       ├─ 检查是否有书签变化（角标黄）
       ├─ lastMissedBackupDate 防止当天重复补充
       └─ executed 标记防止特定任务重复
```

---

## 防重复机制

即使休眠恢复后会检查遗漏，也不会重复补充备份：

**Even after sleep recovery checks for missed backups, no duplicate backups:**

1. **常规时间**：`lastMissedBackupDate` 记录当天是否已补充
   - 今天已补充 → 跳过
   
2. **特定时间**：`executed` 标记任务是否已执行
   - 已执行 → 跳过

3. **时间戳**：`lastMissedCheckTime` 避免频繁检查
   - 10分钟内 → 跳过

---

## 测试场景

### 场景 1：休眠恢复 + 有遗漏

```
1. 设置默认时间 10:00
2. 添加书签（角标变黄）
3. 让电脑进入睡眠
4. 11:00 唤醒电脑
```

**预期日志**：
```
[自动备份定时器] 角标变黄（检测到变化），启动定时器
[自动备份定时器] 距离上次检查超过10分钟（可能休眠恢复），检查遗漏的备份任务
[自动备份定时器] 开始检查遗漏的备份任务...
[自动备份定时器] 检测到书签变化（角标变黄），继续检查遗漏任务
[自动备份定时器] 已过默认时间 10:00，执行补充备份
[自动备份定时器] 触发自动备份，原因: Sat
```

### 场景 2：短时间内重复启动

```
1. 添加书签（角标变黄）
2. 2分钟后再添加书签
```

**预期日志**：
```
[自动备份定时器] 角标变黄（检测到变化），启动定时器
[自动备份定时器] 距离上次检查超过10分钟（第一次）
...
（2分钟后）
[自动备份定时器] 角标变黄（检测到变化），启动定时器
[自动备份定时器] 距离上次检查不到10分钟，跳过遗漏检查
```

### 场景 3：休眠恢复 + 已补充

```
1. 执行场景1（已补充备份）
2. 立即让电脑睡眠再唤醒
```

**预期日志**：
```
[自动备份定时器] 距离上次检查超过10分钟（可能休眠恢复），检查遗漏的备份任务
[自动备份定时器] 开始检查遗漏的备份任务...
[自动备份定时器] 检测到书签变化（角标变黄），继续检查遗漏任务
[自动备份定时器] 今天已经执行过补充备份，跳过重复补充 ← 关键
```

---

## 修改的文件

1. `storage.js`
   - 添加 `lastMissedCheckTime` 字段
   - 添加 `updateLastMissedCheckTime()` 函数
   - 添加 `shouldCheckMissed()` 函数

2. `timer.js`
   - `initializeTimerSystem()` 支持 `'auto'` 模式
   - `checkMissedBackups()` 开始和结束时更新时间戳

3. `background.js`
   - `setBadge()` 启动定时器时使用 `'auto'` 模式

4. `index.js`
   - 导出新函数

---

## 总结

✅ **浏览器启动**：强制检查遗漏（`true`）
✅ **休眠恢复**：智能检查遗漏（`'auto'`，基于10分钟阈值）
✅ **防重复**：三重保护（日期、标记、时间戳）

**现在完全符合用户需求：**
- 初始化（打开浏览器）：检查遗漏
- 恢复（从休眠中恢复）：检查遗漏
- 所有补充备份只执行一次（每天/每任务）
