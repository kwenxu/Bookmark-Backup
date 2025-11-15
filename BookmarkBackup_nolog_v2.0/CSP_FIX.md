# CSP 错误修复说明

## 问题

Chrome 扩展报错：
```
Executing inline event handler violates the following Content Security Policy directive 'script-src 'self''. 
Either the 'unsafe-inline' keyword, a hash ('sha256-...'), or a nonce ('nonce-...') is required to enable inline execution.
```

## 原因

Chrome 扩展的 **Content Security Policy (CSP)** 默认不允许内联事件处理器，包括：
- HTML 属性中的事件：`<img onerror="...">`
- 内联 JavaScript：`<div onclick="...">`
- `javascript:` URL：`<a href="javascript:...">`

我们的代码中使用了：
```javascript
// ❌ 违反 CSP
<img src="${favicon}" onerror="this.src='${fallbackIcon}'">
```

## 解决方案

### 1. 移除所有内联事件处理器

**修改前：**
```javascript
<img class="tree-icon" src="${favicon}" alt="" onerror="this.src='${fallbackIcon}'">
```

**修改后：**
```javascript
<img class="tree-icon" src="${favicon}" alt="">
```

### 2. 使用事件委托（Event Delegation）

在 history.js 中添加全局错误处理器：

```javascript
// 全局图片错误处理（使用事件委托，避免CSP内联事件处理器）
function setupGlobalImageErrorHandler() {
    document.addEventListener('error', (e) => {
        if (e.target.tagName === 'IMG' && 
            (e.target.classList.contains('tree-icon') || 
             e.target.classList.contains('addition-icon') ||
             e.target.classList.contains('change-tree-item-icon') ||
             e.target.classList.contains('canvas-bookmark-icon'))) {
            // 只在src不是fallbackIcon时才替换，避免无限循环
            if (e.target.src !== fallbackIcon && !e.target.src.startsWith('data:image/svg+xml')) {
                e.target.src = fallbackIcon;
            }
        }
    }, true); // 使用捕获阶段
}
```

**关键点：**
- 使用 `document.addEventListener('error', ...)` 全局监听
- `true` 参数表示在捕获阶段处理（更早捕获错误）
- 检查 `e.target.tagName` 确保是 IMG 元素
- 检查 CSS 类名确保是我们关心的图标
- 避免无限循环（不替换已经是 fallbackIcon 的图片）

### 3. 在初始化时设置全局处理器

```javascript
document.addEventListener('DOMContentLoaded', async () => {
    // ... 其他初始化代码
    
    // 设置全局图片错误处理（避免CSP内联事件处理器）
    setupGlobalImageErrorHandler();
    
    // ... 继续其他初始化
});
```

## 修改的文件

### history.js
1. 新增 `setupGlobalImageErrorHandler()` 函数
2. DOMContentLoaded 中调用 `setupGlobalImageErrorHandler()`
3. 移除以下位置的 `onerror` 属性：
   - `renderChangeTreeItem()` - change-tree-item-icon
   - `renderBookmarkItem()` - addition-icon
   - `renderTreeNodeWithChanges()` - tree-icon (书签树)
   - `applyIncrementalAddToTree()` - tree-icon (增量添加)

### bookmark_canvas_module.js
1. `createCanvasBookmarkItem()` - canvas-bookmark-icon
2. `createPermanentTreeItem()` - tree-icon (永久栏目)

## 工作原理

### 事件捕获 vs 事件冒泡

```
DOM 树
  └─ document
      └─ body
          └─ div.tree-container
              └─ img.tree-icon ← 错误发生在这里
```

**事件流程（使用捕获阶段）：**
```
1. 捕获阶段（从上到下）
   document [✓ 我们在这里监听] → body → div → img

2. 目标阶段
   img（错误目标）

3. 冒泡阶段（从下到上）
   img → div → body → document
```

我们使用 `addEventListener('error', handler, true)` 在**捕获阶段**监听：
- ✅ 可以捕获到所有子元素的错误
- ✅ 在错误到达目标元素前就处理
- ✅ 避免被其他监听器阻止

### 为什么要检查 src？

```javascript
if (e.target.src !== fallbackIcon && !e.target.src.startsWith('data:image/svg+xml')) {
    e.target.src = fallbackIcon;
}
```

**避免无限循环：**
1. 图片加载失败 → 触发 error 事件
2. 处理器设置 `src = fallbackIcon`
3. 如果 fallbackIcon 本身也加载失败 → 又触发 error 事件
4. 如果不检查，会再次设置 `src = fallbackIcon` → 无限循环

**检查逻辑：**
- `e.target.src !== fallbackIcon` - 不是已经设置过的 fallback
- `!e.target.src.startsWith('data:image/svg+xml')` - 不是 data URL（fallbackIcon 是 SVG data URL）

## 测试验证

### 测试 1：CSP 错误消失
```
1. 打开 DevTools Console
2. 刷新页面
3. ✅ 不应该再看到 CSP 错误
```

### 测试 2：错误图标回退
```
1. 添加一个无效URL的书签（如 http://invalid-domain-12345.com）
2. 刷新页面
3. ✅ 应该显示 fallbackIcon（灰色圆圈）
4. ✅ Console 中不应该有 CSP 错误
```

### 测试 3：正常图标加载
```
1. 书签画布中的正常网站
2. ✅ 应该正常显示 favicon
3. ✅ 不影响正常功能
```

## 优势

### 1. 符合 CSP 规范
- ✅ 无内联事件处理器
- ✅ 所有 JavaScript 代码在 .js 文件中
- ✅ 符合 Chrome 扩展最佳实践

### 2. 代码更清晰
```javascript
// 之前：每个img标签都要写onerror
<img onerror="this.src='...'" src="...">
<img onerror="this.src='...'" src="...">
<img onerror="this.src='...'" src="...">

// 现在：统一在一个地方处理
<img src="...">
<img src="...">
<img src="...">
// + 一个全局处理器
```

### 3. 性能更好
- 减少 HTML 体积（每个 img 少了 `onerror` 属性）
- 统一处理逻辑，更容易维护
- 事件委托比为每个元素绑定事件更高效

### 4. 更容易调试
- 所有错误处理逻辑集中在一处
- 可以统一添加日志、统计等
- 修改逻辑只需改一个地方

## 注意事项

### 1. fallbackIcon 必须可靠
确保 `fallbackIcon` 是内联的 data URL：
```javascript
const fallbackIcon = 'data:image/svg+xml,%3Csvg...%3C/svg%3E';
```
- ✅ 不依赖网络
- ✅ 不会加载失败
- ✅ 避免无限循环

### 2. 事件捕获阶段
必须使用 `true` 参数（捕获阶段）：
```javascript
document.addEventListener('error', handler, true); // ✅
document.addEventListener('error', handler);        // ❌ 冒泡阶段，可能捕获不到
```

### 3. 类名检查
确保所有需要处理的图标都有对应的类名：
- `tree-icon` - 书签树图标
- `addition-icon` - 添加记录图标
- `change-tree-item-icon` - 变更项图标
- `canvas-bookmark-icon` - 画布书签图标

## 相关资源

- [Chrome Extension CSP](https://developer.chrome.com/docs/extensions/mv3/content-security-policy/)
- [MDN: Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [MDN: Event Delegation](https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Building_blocks/Events#event_delegation)
- [MDN: addEventListener](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener)
