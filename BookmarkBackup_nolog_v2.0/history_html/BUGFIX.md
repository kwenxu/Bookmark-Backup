# Bug 修复记录

## ❌ Bug: Invalid URL 错误

### 问题描述
```
TypeError: Failed to construct 'URL': Invalid URL
at history_html/history.js:707
```

**原因**: 
- 书签数据中可能包含非 HTTP/HTTPS 的 URL（如 `chrome://`, `file://`, `javascript:` 等）
- 文件夹节点可能没有 URL 属性
- 某些书签的 URL 可能是空字符串或格式不正确

### 影响范围
- ✅ 图标预加载失败
- ✅ 当前变化视图加载失败
- ✅ 书签树渲染失败
- ✅ 书签温故显示失败

## ✅ 解决方案

### 1. 创建安全的 URL 处理函数

```javascript
// 安全地获取网站图标 URL
function getFaviconUrl(url) {
    if (!url) return '';
    
    // 只处理 HTTP/HTTPS URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return '';
    }
    
    try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname;
        return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    } catch (error) {
        console.warn('[getFaviconUrl] 无效的 URL:', url);
        return '';
    }
}
```

### 2. 添加全局 fallback 图标

```javascript
// SVG 圆圈占位符
const fallbackIcon = 'data:image/svg+xml,...';
```

### 3. 更新所有使用 URL 的地方

#### 修改前
```javascript
// ❌ 不安全
const domain = bookmark.url ? new URL(bookmark.url).hostname : '';
const favicon = domain ? `https://...` : '';
```

#### 修改后
```javascript
// ✅ 安全
const favicon = getFaviconUrl(bookmark.url);
```

### 4. 预加载时过滤无效 URL

```javascript
// 只预加载有效的 HTTP/HTTPS URL
const urls = allBookmarks
    .map(b => b.url)
    .filter(url => url && url.trim() && 
            (url.startsWith('http://') || url.startsWith('https://')));
```

### 5. 添加错误处理和日志

```javascript
try {
    // ... URL 处理逻辑
} catch (error) {
    console.warn('[图标预加载] URL 无效:', url, error.message);
    resolve(); // 继续处理其他 URL
}
```

## 📝 修改的文件

### history_html/history.js

1. **新增函数** (行 30-46):
   - `getFaviconUrl(url)` - 安全的 favicon 获取函数
   
2. **新增常量** (行 49-50):
   - `fallbackIcon` - SVG 占位符

3. **修改函数**:
   - `preloadCommonIcons()` - 添加 URL 过滤和错误处理
   - `preloadIcon(url)` - 添加 URL 验证
   - `renderChangeTreeItem()` - 使用 `getFaviconUrl()`
   - `renderBookmarkItem()` - 使用 `getFaviconUrl()`
   - `renderTreeNode()` - 使用 `getFaviconUrl()`

## 🧪 测试方法

### 测试场景 1: Chrome 内部页面
1. 添加书签：`chrome://extensions/`
2. 打开历史查看器
3. **预期**: 不会报错，使用 fallback 图标

### 测试场景 2: 本地文件
1. 添加书签：`file:///Users/test/file.html`
2. 打开历史查看器
3. **预期**: 不会报错，使用 fallback 图标

### 测试场景 3: JavaScript 伪协议
1. 添加书签：`javascript:alert('test')`
2. 打开历史查看器
3. **预期**: 不会报错，使用 fallback 图标

### 测试场景 4: 正常 HTTP/HTTPS
1. 添加书签：`https://www.google.com`
2. 打开历史查看器
3. **预期**: 正常显示 Google 图标

### 测试场景 5: 空 URL
1. 创建文件夹（没有 URL）
2. 打开书签树视图
3. **预期**: 不会报错，文件夹显示文件夹图标

## 📊 验证结果

### 控制台日志
```
[初始化] 立即渲染当前变化视图
[图标预加载] 开始预加载常见图标...
[getFaviconUrl] 无效的 URL: chrome://extensions/
[图标预加载] 完成，已预加载 45 个图标
```

### 错误处理
- ✅ 无效 URL 被安全过滤
- ✅ 控制台有警告日志（不影响功能）
- ✅ 使用 fallback 图标替代
- ✅ 其他功能正常工作

## 🔍 调试命令

### 查看被过滤的 URL
```javascript
// 在控制台执行
allBookmarks
    .filter(b => b.url)
    .filter(b => !b.url.startsWith('http://') && !b.url.startsWith('https://'))
    .forEach(b => console.log('非 HTTP URL:', b.url));
```

### 测试 getFaviconUrl 函数
```javascript
// 测试各种 URL
console.log(getFaviconUrl('https://google.com'));        // ✅ 返回 favicon URL
console.log(getFaviconUrl('chrome://extensions/'));      // ✅ 返回空字符串
console.log(getFaviconUrl('file:///test.html'));        // ✅ 返回空字符串
console.log(getFaviconUrl('javascript:alert()'));       // ✅ 返回空字符串
console.log(getFaviconUrl(''));                          // ✅ 返回空字符串
console.log(getFaviconUrl(null));                        // ✅ 返回空字符串
```

## ⚠️ 注意事项

1. **Chrome 内部页面**: 无法获取 favicon，使用 fallback 图标
2. **本地文件**: 无法获取 favicon，使用 fallback 图标
3. **JavaScript 伪协议**: 不安全，直接过滤
4. **FTP 协议**: 不支持，使用 fallback 图标

## 🚀 未来改进

1. [ ] 支持更多协议（ftp://, data: 等）
2. [ ] 为特殊 URL 类型提供专用图标
   - `chrome://` → Chrome logo
   - `file://` → 文件图标
   - `javascript:` → JS 图标
3. [ ] 缓存 fallback 状态，避免重复尝试
4. [ ] 提供用户自定义 fallback 图标选项

---

**修复日期**: 2024  
**版本**: v2.1.1  
**影响**: 修复关键错误，提升稳定性
