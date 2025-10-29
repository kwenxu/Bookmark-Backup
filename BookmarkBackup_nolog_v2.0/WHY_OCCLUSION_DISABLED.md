# 为什么暂时禁用遮挡休眠

## 问题概述

遮挡休眠功能在测试时发现严重bug：
- 被遮挡的栏目位置异常
- 栏目可能消失或跑到错误的位置
- 与视口休眠功能冲突

因此**暂时完全禁用**，只保留视口休眠。

---

## 技术原因详解

### 1. 与 `display: none` 的冲突 ❌

#### 问题描述

遮挡检测需要计算所有栏目的位置和矩形区域，但当栏目被视口休眠（设置为 `display: none`）后，无法正确获取其位置信息。

#### 代码示例

```javascript
// 之前的实现
function calculateOcclusion() {
    const element = document.getElementById(section.id);
    const rect = element.getBoundingClientRect();  // ❌ 问题在这里
    
    // 当栏目 display: none 时
    // getBoundingClientRect() 返回全0的矩形：
    // { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
}
```

#### 导致的bug

```
栏目A：x=100, y=200, 正常显示
栏目B：x=150, y=250, 被视口休眠 (display: none)
栏目C：x=120, y=220, 正常显示

检测栏目C是否被遮挡：
1. 获取栏目B的位置 → getBoundingClientRect() → (0, 0, 0, 0)  ❌
2. 计算栏目B是否遮挡栏目C → 使用错误的位置 (0, 0)
3. 得出错误的遮挡结论
4. 栏目C被错误地休眠或唤醒
5. 位置信息混乱
```

---

### 2. 位置计算依赖问题 ❌

#### 问题描述

遮挡检测需要知道每个栏目的：
- 精确位置（x, y）
- 大小（width, height）
- z-index（层级）

但是：
- 位置和大小可以从数据中计算
- z-index 却只能从DOM元素的 `style.zIndex` 读取
- 休眠后的栏目，DOM属性不可靠

#### 代码示例

```javascript
// 混合使用数据和DOM
const x = section.x * scale + panOffsetX;  // ✅ 从数据计算
const y = section.y * scale + panOffsetY;  // ✅ 从数据计算
const zIndex = element.style.zIndex;        // ❌ 从DOM读取

// 当element是休眠状态时
// element.style.zIndex 可能不准确
// 因为CSS的层叠上下文可能改变
```

#### 导致的bug

```
栏目A：z-index=100, display: none (休眠)
栏目B：z-index=150, display: block (活跃)

检测时：
1. 栏目A的 z-index 应该是100
2. 但 display: none 后，可能读取到默认值或错误值
3. 遮挡计算错误
4. 栏目B可能被错误判定为被栏目A遮挡
5. 实际上栏目A根本不可见
```

---

### 3. 循环依赖问题 ❌

#### 问题描述

视口休眠和遮挡休眠互相影响，形成循环依赖：

```
视口休眠执行
    ↓
栏目A离开视口 → 进入休眠 (display: none)
    ↓
遮挡检测执行
    ↓
需要栏目A的位置信息来检测其他栏目是否被遮挡
    ↓
但栏目A已经 display: none → 获取到错误位置 (0, 0)
    ↓
遮挡计算完全错误
    ↓
栏目B被错误地判定为被遮挡 → 进入休眠
    ↓
栏目B的位置信息也变成 (0, 0)
    ↓
更多栏目位置错误
    ↓
整个系统崩溃
```

#### 实际场景

```
初始状态：
- 栏目1-5：在视口内，活跃
- 栏目6-10：在视口外，调度视口休眠
- 栏目11：被栏目5遮挡90%

2分钟后：
- 栏目6-10：视口休眠触发 → display: none
- 遮挡检测开始执行
- 检测栏目11是否被遮挡
- 需要知道栏目5的位置 → 正常获取 ✅
- 需要知道栏目6-10的位置 → 全部是 (0, 0) ❌
- 遮挡计算混乱
- 栏目11的位置可能异常
```

---

### 4. 数据不一致问题 ❌

#### 问题描述

栏目的状态信息分散在多个地方：
- `section.x, section.y` - 数据中的位置
- `element.style.left, element.style.top` - DOM中的位置
- `element.style.zIndex` - DOM中的层级
- `section.dormant` - 休眠标记

当栏目休眠后，这些信息不同步：

```javascript
// 数据层面
section.x = 100;
section.y = 200;
section.dormant = true;  // 休眠

// DOM层面
element.style.display = 'none';  // 隐藏
element.getBoundingClientRect() → (0, 0, 0, 0)  // 错误的位置
element.offsetLeft → 0  // 错误的位置
element.offsetTop → 0   // 错误的位置
```

#### 导致的bug

如果遮挡检测混用这两种数据源，会得到不一致的结果。

---

## 正确的实现方案（未来）

### 方案1：完全基于数据计算（推荐）✅

**核心思想：** 不依赖DOM，完全从数据计算位置和遮挡。

```javascript
function calculateOcclusion() {
    const sectionRects = CanvasState.tempSections.map(section => {
        // ✅ 完全从数据计算，不访问DOM
        const scale = CanvasState.zoom || 1;
        const x = section.x * scale + CanvasState.panOffsetX;
        const y = section.y * scale + CanvasState.panOffsetY;
        const width = (section.width || 360) * scale;
        const height = (section.height || 280) * scale;
        
        // ✅ z-index 也保存到数据中
        const zIndex = section.zIndex || 100;
        
        return {
            section,
            rect: { left: x, top: y, right: x + width, bottom: y + height },
            zIndex
        };
    });
    
    // 按z-index排序
    sectionRects.sort((a, b) => a.zIndex - b.zIndex);
    
    // 计算遮挡
    sectionRects.forEach((current, index) => {
        let occludedArea = 0;
        const totalArea = current.rect.width * current.rect.height;
        
        // 检查所有在当前栏目上面的栏目
        for (let i = index + 1; i < sectionRects.length; i++) {
            const upper = sectionRects[i];
            
            // ✅ 跳过休眠的栏目（不参与遮挡计算）
            // 注意：这里使用的是数据中的休眠状态，而不是DOM
            if (upper.section.dormant) continue;
            
            // 计算交集
            const intersection = calculateIntersection(current.rect, upper.rect);
            occludedArea += intersection;
        }
        
        const occlusionRatio = occludedArea / totalArea;
        
        if (occlusionRatio >= 0.90) {
            // 调度遮挡休眠（2分钟延迟）
            scheduleDormancy(current.section, 'occlusion');
        }
    });
}
```

**优势：**
- ✅ 不受 `display: none` 影响
- ✅ 性能更好（不需要访问DOM）
- ✅ 数据一致性好
- ✅ 逻辑清晰

---

### 方案2：保存 z-index 到数据 ✅

**核心思想：** 同步DOM和数据，避免读取DOM。

```javascript
// 创建栏目时保存 z-index
function createTempNodeElement(section) {
    const element = document.createElement('div');
    const zIndex = getNextZIndex();
    
    // 设置到DOM
    element.style.zIndex = zIndex;
    
    // ✅ 同时保存到数据中
    section.zIndex = zIndex;
}

// 拖动改变 z-index 时同步更新
function bringToFront(section) {
    const newZIndex = getNextZIndex();
    const element = document.getElementById(section.id);
    
    // 更新DOM
    element.style.zIndex = newZIndex;
    
    // ✅ 同步到数据
    section.zIndex = newZIndex;
    
    // 保存
    saveTempNodes();
}

// 加载时恢复 z-index
function loadTempNodes() {
    const saved = localStorage.getItem('temp-sections');
    const sections = JSON.parse(saved);
    
    sections.forEach(section => {
        // 创建DOM元素
        const element = createTempNodeElement(section);
        
        // ✅ 从数据恢复 z-index
        if (section.zIndex) {
            element.style.zIndex = section.zIndex;
        }
    });
}
```

**优势：**
- ✅ DOM和数据一致
- ✅ 不需要从DOM读取z-index
- ✅ 休眠后仍能获取正确的z-index
- ✅ 数据持久化保存z-index

---

### 方案3：分离检测逻辑 ✅

**核心思想：** 先做遮挡检测，再做视口检测，避免循环依赖。

```javascript
function manageSectionDormancy() {
    // 步骤1：计算遮挡（所有栏目都基于数据，不管是否休眠）
    const occlusionResults = calculateOcclusionFromData();
    
    // 步骤2：计算视口可见性
    const viewportResults = calculateViewportVisibility();
    
    // 步骤3：合并结果，决定休眠策略
    CanvasState.tempSections.forEach(section => {
        const shouldDormantByOcclusion = occlusionResults.get(section.id);
        const shouldDormantByViewport = viewportResults.get(section.id);
        
        if (shouldDormantByViewport) {
            // 视口外优先级更高，立即调度视口休眠
            scheduleDormancy(section, 'viewport');
        } else if (shouldDormantByOcclusion) {
            // 在视口内但被遮挡，调度遮挡休眠
            scheduleDormancy(section, 'occlusion');
        } else {
            // 可见且未遮挡，唤醒
            wakeSection(section);
        }
    });
}
```

**优势：**
- ✅ 逻辑清晰，职责分离
- ✅ 避免循环依赖
- ✅ 遮挡检测在数据层进行，不受休眠影响
- ✅ 可以单独测试每个检测逻辑

---

### 方案4：只对活跃栏目进行遮挡检测 ✅

**核心思想：** 休眠的栏目不参与遮挡计算。

```javascript
function calculateOcclusion() {
    // ✅ 只计算活跃栏目的遮挡
    const activeSections = CanvasState.tempSections.filter(s => !s.dormant);
    
    const sectionRects = activeSections.map(section => {
        // 从数据计算位置
        // ...
    });
    
    // 遮挡检测只在活跃栏目之间进行
    // ...
}
```

**优势：**
- ✅ 休眠栏目不参与计算，避免位置错误
- ✅ 性能更好（减少计算量）
- ✅ 逻辑简单

---

## 实施计划

### 阶段1：数据结构改进

1. 在 `section` 对象中添加 `zIndex` 字段
2. 创建栏目时同步保存 z-index
3. 拖动改变层级时同步更新
4. 保存/加载时持久化 z-index

### 阶段2：实现完全基于数据的遮挡检测

1. 实现 `calculateOcclusionFromData()` 函数
2. 完全从数据计算位置和遮挡
3. 不访问任何DOM元素
4. 只对活跃栏目进行检测

### 阶段3：集成延迟休眠机制

1. 遮挡检测调用 `scheduleDormancy(section, 'occlusion')`
2. 使用2分钟延迟
3. 与视口休眠协同工作

### 阶段4：测试和优化

1. 测试各种遮挡场景
2. 测试视口休眠和遮挡休眠的交互
3. 优化性能
4. 修复发现的bug

### 阶段5：重新启用

1. 充分测试后启用遮挡休眠
2. 监控线上表现
3. 收集用户反馈

---

## 为什么不能简单修复

### 尝试过的方案

#### 方案A：在遮挡检测前临时显示所有栏目 ❌

```javascript
// 临时显示所有休眠栏目
CanvasState.tempSections.forEach(s => {
    if (s.dormant) {
        const el = document.getElementById(s.id);
        el.style.display = '';
    }
});

// 计算遮挡
calculateOcclusion();

// 恢复休眠状态
CanvasState.tempSections.forEach(s => {
    if (s.dormant) {
        const el = document.getElementById(s.id);
        el.style.display = 'none';
    }
});
```

**问题：**
- 会导致页面闪烁
- 触发不必要的重排和重绘
- 性能差
- 用户体验不好

#### 方案B：缓存栏目位置 ❌

```javascript
// 缓存每个栏目的位置
const positionCache = new Map();

// 栏目移动时更新缓存
function updateSectionPosition(section) {
    positionCache.set(section.id, {
        x: section.x,
        y: section.y,
        width: section.width,
        height: section.height
    });
}

// 遮挡检测时使用缓存
function calculateOcclusion() {
    const pos = positionCache.get(section.id);
    // ...
}
```

**问题：**
- 缓存同步复杂
- 缩放、平移时需要更新所有缓存
- 容易出现缓存不一致
- 代码复杂度高

#### 方案C：使用虚拟DOM ❌

```javascript
// 维护一个虚拟DOM，记录所有栏目的位置
const virtualDOM = {
    sections: [
        { id: 'xxx', x: 100, y: 200, zIndex: 100 },
        // ...
    ]
};
```

**问题：**
- 过度工程化
- 需要完整的虚拟DOM系统
- 开发成本高
- 维护成本高

---

## 结论

### 当前状态

- ✅ 暂时禁用遮挡休眠
- ✅ 只保留视口休眠（2分钟延迟）
- ✅ 系统稳定可靠
- ✅ 性能已经很好

### 未来优化

- 📋 实现方案1：完全基于数据的遮挡检测
- 📋 实现方案2：保存z-index到数据
- 📋 充分测试后重新启用
- 📋 添加2分钟延迟机制

### 优先级

- 遮挡休眠是**锦上添花**的功能
- 视口休眠已经能解决90%的性能问题
- 可以等到有充足时间时再实现
- 不影响核心功能和用户体验

**总结：** 暂时禁用遮挡休眠是正确的选择，避免了严重的bug，保证了系统稳定性。未来有时间时，会采用更好的方案重新实现。
