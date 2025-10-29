# 延迟休眠机制说明

## 概述

为了改善用户体验，休眠机制现在采用**延迟触发**，而不是立即休眠。

## 问题背景

### 之前的问题
当栏目离开视口时，**立即休眠**，导致：
- 用户快速滚动时，栏目频繁显示/隐藏
- 观感不好，有闪烁感
- 用户短暂查看其他区域后返回，栏目需要重新唤醒

### 用户需求
- 视口休眠：延迟 **2分钟**
- 遮挡休眠：延迟 **2分钟**（已暂时禁用）

## 解决方案：延迟休眠

### 核心机制

```javascript
// 延迟配置
dormancyDelays: {
    viewport: 120000,  // 离开视口2分钟后休眠
    occlusion: 120000  // 被遮挡2分钟后休眠（暂未启用）
}

// 定时器管理
dormancyTimers: new Map() // sectionId -> { type, timer, scheduledAt }
```

### 工作流程

#### 1. 栏目离开视口
```
栏目离开视口
  ↓
调度延迟休眠（2分钟定时器）
  ↓
栏目保持活跃（未休眠）
  ↓
等待2分钟...
  ↓
2分钟后 → 进入休眠
```

#### 2. 栏目在定时器触发前返回视口
```
栏目离开视口
  ↓
调度延迟休眠（2分钟定时器）
  ↓
等待30秒...
  ↓
栏目返回视口 → 取消定时器
  ↓
栏目保持活跃（未休眠）
```

#### 3. 栏目进入视口（已休眠）
```
栏目进入视口
  ↓
立即唤醒
  ↓
取消所有相关定时器
  ↓
栏目变为活跃
```

## 技术实现

### 1. 调度延迟休眠

```javascript
function scheduleDormancy(section, reason) {
    const sectionId = section.id;
    
    // 取消之前的定时器
    cancelDormancyTimer(sectionId);
    
    // 确定延迟时间
    const delay = reason === 'viewport' 
        ? CanvasState.dormancyDelays.viewport   // 2分钟
        : CanvasState.dormancyDelays.occlusion; // 2分钟
    
    // 设置新的定时器
    const timer = setTimeout(() => {
        // 再次检查栏目是否仍然应该休眠
        const element = document.getElementById(sectionId);
        if (element && !section.dormant) {
            section.dormant = true;
            element.style.display = 'none';
        }
        CanvasState.dormancyTimers.delete(sectionId);
    }, delay);
    
    // 保存定时器信息
    CanvasState.dormancyTimers.set(sectionId, {
        type: reason,
        timer: timer,
        scheduledAt: Date.now()
    });
}
```

### 2. 取消休眠定时器

```javascript
function cancelDormancyTimer(sectionId) {
    const timerInfo = CanvasState.dormancyTimers.get(sectionId);
    if (timerInfo && timerInfo.timer) {
        clearTimeout(timerInfo.timer);
        CanvasState.dormancyTimers.delete(sectionId);
    }
}
```

### 3. 立即唤醒栏目

```javascript
function wakeSection(section) {
    const sectionId = section.id;
    
    // 取消休眠定时器
    cancelDormancyTimer(sectionId);
    
    // 如果已经休眠，立即唤醒
    if (section.dormant) {
        section.dormant = false;
        const element = document.getElementById(sectionId);
        if (element) {
            element.style.display = '';
        }
    }
}
```

### 4. 休眠管理主逻辑

```javascript
function manageSectionDormancy() {
    CanvasState.tempSections.forEach(section => {
        // 置顶栏目：立即唤醒，取消定时器
        if (section.pinned) {
            wakeSection(section);
            return;
        }
        
        // 检查是否在视口内
        const isInViewport = /* ... */;
        
        if (isInViewport) {
            // 在视口内：立即唤醒，取消定时器
            wakeSection(section);
        } else {
            // 不在视口内
            if (!section.dormant) {
                // 未休眠：检查是否已调度
                const timerInfo = CanvasState.dormancyTimers.get(section.id);
                if (!timerInfo) {
                    // 还没调度：现在调度（15秒后休眠）
                    scheduleDormancy(section, 'viewport');
                }
                // 已调度：等待定时器触发
            }
            // 已休眠：保持休眠状态
        }
    });
}
```

## 状态转换

### 栏目的生命周期

```
[活跃 - 在视口内]
        ↓ 离开视口
[活跃 - 已调度休眠] (等待15秒)
        ↓ 15秒后
    [休眠]
        ↓ 进入视口
[活跃 - 在视口内]
```

### 状态说明

| 状态 | dormant | 定时器 | display | 说明 |
|------|---------|--------|---------|------|
| 活跃-视口内 | false | 无 | block | 正常显示 |
| 活跃-已调度 | false | 有 | block | 正常显示，等待休眠 |
| 休眠 | true | 无 | none | 隐藏，节省性能 |

## 性能优化

### 1. 定时器管理

- 使用 `Map` 存储定时器，O(1) 查找
- 每个栏目最多一个定时器
- 取消定时器时自动清理

### 2. 避免重复调度

```javascript
// 检查是否已经调度了休眠
const timerInfo = CanvasState.dormancyTimers.get(section.id);
if (!timerInfo) {
    // 还没调度，现在调度
    scheduleDormancy(section, 'viewport');
}
// 已调度，不重复调度
```

### 3. 二次确认

定时器触发时，再次检查栏目状态：

```javascript
setTimeout(() => {
    // 再次检查栏目是否仍然应该休眠
    const element = document.getElementById(sectionId);
    if (element && !section.dormant) {
        // 确实应该休眠，执行休眠
        section.dormant = true;
        element.style.display = 'none';
    }
}, delay);
```

## 日志输出

**所有日志已移除**，不再输出任何休眠相关的日志信息，避免控制台污染。

如需调试，可以在代码中临时取消注释日志语句。

## 用户体验

### 优势对比

| 场景 | 立即休眠 | 延迟休眠（2分钟） |
|------|---------|-----------------|
| 快速滚动 | ❌ 频繁闪烁 | ✅ 保持显示 |
| 短暂离开（< 2分钟）| ❌ 需要重新唤醒 | ✅ 仍然活跃 |
| 长时间离开（> 2分钟）| ✅ 节省性能 | ✅ 节省性能 |
| 频繁切换视口 | ❌ 体验差 | ✅ 流畅 |

### 实际场景

#### 场景1：快速滚动查看
```
用户向下滚动查看栏目
  ↓
栏目1-5离开视口 → 调度休眠（2分钟）
  ↓
30秒后，用户滚回上方
  ↓
栏目1-5进入视口 → 取消定时器，保持活跃
  ↓
结果：栏目一直显示，无闪烁
```

#### 场景2：长时间查看其他区域
```
用户向右滚动到空白区域
  ↓
栏目1-20离开视口 → 调度休眠（2分钟）
  ↓
用户在空白区域停留5分钟
  ↓
2分钟后 → 栏目1-20进入休眠
  ↓
用户返回 → 栏目1-20唤醒
  ↓
结果：长时间离开时节省性能
```

## 遮挡休眠（暂时禁用）

遮挡休眠功能已暂时禁用，因为发现以下bug：
- 被遮挡的栏目位置可能异常
- 唤醒后可能消失

**后续计划：**
1. 修复遮挡检测的位置bug
2. 添加2分钟延迟休眠
3. 重新启用遮挡休眠功能

## 配置调整

### 修改延迟时间

```javascript
// 在 CanvasState 中修改
dormancyDelays: {
    viewport: 120000,  // 2分钟 → 可改为其他值（毫秒）
    occlusion: 120000  // 2分钟 → 可改为其他值（毫秒）
}
```

### 推荐值

| 场景 | 视口延迟 | 说明 |
|------|---------|------|
| 快速设备 | 60秒 | 性能好，可以更快休眠 |
| 推荐 | 120秒 (2分钟) | 平衡性能和体验 |
| 慢速设备 | 180秒 (3分钟) | 给更多缓冲时间 |

## 总结

**核心改进：**
- ✅ 视口休眠延迟2分钟
- ✅ 避免频繁显示/隐藏
- ✅ 改善滚动体验
- ✅ 保持性能优化效果
- ✅ 无日志输出，保持控制台干净

**技术特点：**
- ✅ 定时器管理高效（Map）
- ✅ 自动清理定时器
- ✅ 二次确认机制
- ✅ 避免重复调度

**用户体验：**
- ✅ 滚动流畅无闪烁
- ✅ 短暂离开（< 2分钟）不休眠
- ✅ 长时间离开（> 2分钟）节省性能
- ✅ 观感大幅改善
