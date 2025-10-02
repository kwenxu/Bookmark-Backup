# 自动备份定时器功能 - 实施文档

## 项目概述

本功能为书签备份扩展新增了两种自动备份定时模式：**常规时间**和**特定时间**，与现有的**实时备份**形成三个互斥的备份模式。

## 已完成的核心模块

### 1. storage.js - 存储管理模块
**功能：**
- 管理自动备份定时器的所有配置数据
- 提供增删改查接口
- 默认配置管理

**关键API：**
- `getAutoBackupSettings()` - 获取设置
- `updateBackupMode(mode)` - 更新备份模式
- `addSpecificTimeSchedule(schedule)` - 添加特定时间计划
- `removeSpecificTimeSchedule(scheduleId)` - 删除计划
- `getPendingSchedules()` - 获取待执行计划

### 2. timer.js - 核心定时器模块
**功能：**
- 管理 chrome.alarms API
- 计算下一个执行时间点
- 触发备份检查和执行
- 处理遗漏的备份任务

**关键功能：**
- **常规时间支持：**
  - 第一级：周开关（周一到周日选择）
  - 第二级：小时间隔（每N小时）
  - 第三级：分钟间隔（每N分钟）
  - 三级关系逻辑处理

- **特定时间支持：**
  - 最多5个计划
  - 日期时间选择
  - 启用/禁用状态管理

**核心逻辑：**
```javascript
// 只在有书签变化时备份（关键！）
const { hasChanges } = await checkBookmarkChanges();
if (!hasChanges) {
    return false; // 跳过备份
}
```

### 3. settings-ui.js - UI设置模块
**功能：**
- 创建精美的UI界面
- 处理用户交互
- 三个模式的互斥逻辑

**UI结构：**
1. **实时备份块** - 折叠式，默认展开
2. **常规时间块** - 折叠式，包含三级配置
3. **特定时间块** - 折叠式，计划列表管理

**样式特点：**
- 使用 config-section 和 config-header 样式（与现有UI一致）
- 开关使用 toggle-button 样式
- 支持主题切换（深色/浅色）
- 响应式设计

### 4. index.js - 模块入口
统一导出所有模块功能。

## UI集成

### popup.html 修改
```html
<!-- 自动备份定时器UI容器 -->
<div id="autoBackupTimerUIContainer">
    <!-- 三个备份模式的UI会由 JS 动态插入到这里 -->
</div>
```

### popup.js 修改
1. **导入模块：**
```javascript
import {
    createAutoBackupTimerUI,
    initializeUIEvents as initializeAutoBackupTimerUIEvents,
    loadAutoBackupSettings
} from './auto_backup_timer/index.js';
```

2. **初始化逻辑：**
   - 在打开自动备份设置对话框时动态创建UI
   - 首次打开时创建，后续打开时刷新数据

## 待完成的集成工作

### 1. background.js 集成（高优先级）

需要添加以下功能：

```javascript
// 1. 导入模块
import {
    initializeTimerSystem,
    restartTimerSystem,
    handleAlarmTrigger
} from './auto_backup_timer/index.js';

// 2. 监听 alarm 事件
chrome.alarms.onAlarm.addListener((alarm) => {
    handleAlarmTrigger(alarm);
});

// 3. 监听备份模式切换消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'autoBackupModeChanged') {
        restartTimerSystem();
    }
    if (message.action === 'restartAutoBackupTimer') {
        restartTimerSystem();
    }
    if (message.action === 'checkBookmarkChanges') {
        // 调用现有的书签变化检测逻辑
        // 返回 { hasChanges, changeDescription }
    }
});

// 4. 在浏览器启动时初始化
chrome.runtime.onStartup.addListener(() => {
    initializeTimerSystem();
});
```

### 2. 书签变化检测集成（高优先级）

需要在 background.js 中：
1. 提供 `checkBookmarkChanges()` 接口
2. 复用现有的变化检测代码
3. 返回格式：`{ hasChanges: boolean, changeDescription: string }`

### 3. 角标更新逻辑（高优先级）

根据用户需求，在自动备份模式下也需要黄色角标：

```javascript
// 在 background.js 的 setBadge() 函数中添加
async function setBadge() {
    const { autoSync, autoBackupTimerSettings } = await chrome.storage.local.get([
        'autoSync',
        'autoBackupTimerSettings'
    ]);
    
    if (autoSync) {
        // 自动备份模式
        const mode = autoBackupTimerSettings?.backupMode || 'realtime';
        
        if (mode === 'realtime') {
            // 实时备份：绿色角标 + 闪烁
            badgeColor = '#00FF00';
        } else {
            // 常规时间/特定时间：需要检查是否有变化
            const hasChanges = await checkIfHasBookmarkChanges();
            if (hasChanges) {
                badgeColor = '#FFFF00'; // 黄色
            } else {
                badgeColor = '#00FF00'; // 绿色
            }
        }
    }
    // ... 其他逻辑
}
```

### 4. 状态卡片更新（中优先级）

需要在 popup.js 中更新状态卡片显示逻辑：

```javascript
// 状态卡片（右侧）显示规则
if (autoSync) {
    // 自动备份模式
    const mode = settings.backupMode;
    
    if (mode === 'realtime') {
        // 实时备份：无变化时显示"实时自动备份：监测中"
        statusText = lang === 'zh_CN' ? '「实时」自动备份：监测中' : 'Realtime Auto Backup: Monitoring';
    } else if (mode === 'regular' || mode === 'specific') {
        // 常规/特定时间：根据是否有变化显示
        if (hasChanges) {
            // 有变化：显示具体的变化描述（类似手动模式的绿色卡片）
            statusText = changeDescription; // 例如：(+12 书签，+1 文件夹)
        } else {
            // 无变化
            statusText = lang === 'zh_CN' ? '无变化' : 'No Changes';
        }
    }
} else {
    // 手动备份模式
    if (hasChanges) {
        statusText = changeDescription;
    } else {
        statusText = lang === 'zh_CN' ? '「手动」备份：无变化' : 'Manual Backup: No Changes';
    }
}
```

### 5. 备份记录备注（中优先级）

在执行备份时，需要在备份记录中添加备注：

```javascript
// 在 syncBookmarks 函数中
const backupRecord = {
    timestamp: Date.now(),
    type: 'upload',
    // ... 其他字段
    note: '' // 新增备注字段
};

// 根据触发原因设置备注
if (autoBackupReason) {
    if (autoBackupReason.includes('周')) {
        backupRecord.note = autoBackupReason; // 例如："周一"
    } else if (autoBackupReason.includes('特定时间')) {
        backupRecord.note = autoBackupReason; // 例如："特定时间: 2024-01-02 17:23"
    }
}
```

### 6. 多窗口防护（低优先级）

```javascript
// 使用 chrome.windows.onFocusChanged 防止多窗口干扰
chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        // 所有窗口失去焦点，暂停定时器
        // pauseTimers();
    } else {
        // 窗口获得焦点，恢复定时器
        // resumeTimers();
    }
});
```

## 测试清单

### 功能测试
- [ ] 三个模式的互斥切换
- [ ] 常规时间 - 周开关
- [ ] 常规时间 - 小时间隔
- [ ] 常规时间 - 分钟间隔
- [ ] 常规时间 - 三级关系逻辑
- [ ] 特定时间 - 添加计划（最多5个）
- [ ] 特定时间 - 删除计划
- [ ] 特定时间 - 启用/禁用计划
- [ ] 只在有变化时备份
- [ ] 遗漏任务的补偿执行

### UI测试
- [ ] 折叠/展开动画
- [ ] 开关按钮交互
- [ ] 深色/浅色主题适配
- [ ] 中英文语言切换
- [ ] 响应式布局

### 集成测试
- [ ] 角标颜色变化
- [ ] 状态卡片更新
- [ ] 备份记录备注
- [ ] 浏览器重启后恢复
- [ ] 跨日期自动重置

## 关键设计决策

1. **变化检测优先：** 所有定时备份都必须先检测书签变化，只有在有变化时才执行备份
2. **使用 chrome.alarms：** 比 setTimeout 更可靠，支持浏览器重启后恢复
3. **三级关系逻辑：** 第二、三级同时开启时不包含整点，只有第三级开启时才包含整点
4. **最多5个计划：** 特定时间功能限制为5个计划，避免过多的 alarm
5. **动态UI：** UI在首次打开时创建，减少初始加载时间

## 下一步工作

1. **立即完成：** background.js 集成（核心功能）
2. **立即完成：** 角标更新逻辑
3. **短期完成：** 状态卡片更新
4. **短期完成：** 备份记录备注
5. **测试验证：** 全功能测试
6. **英文翻译：** UI文本国际化

## 注意事项

- 所有时间计算都考虑了时区和跨日期情况
- UI使用现有的CSS变量，完全适配主题系统
- 代码风格与现有项目保持一致
- 错误处理完善，避免crash
- 日志输出清晰，便于调试
