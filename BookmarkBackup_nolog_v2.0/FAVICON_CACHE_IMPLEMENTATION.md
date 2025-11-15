# Favicon 缓存优化实现说明

## 问题分析

### 原有问题
1. **每次打开都要联网加载** - `preloadedIcons` Map 只是内存缓存，页面刷新后丢失
2. **`getFaviconUrl()` 不使用缓存** - 每次调用都生成新的 Google favicon URL
3. **没有失败缓存机制** - 404错误的URL会反复请求
4. **没有过滤本地/内网URL** - 对明显无效的URL也发起请求

### 代码位置
- `history.js` 第 98-119 行：`getFaviconUrl()` 函数
- `history.js` 第 79-81 行：`preloadedIcons` Map（仅内存）
- `history.js` 第 1178-1217 行：`preloadIcon()` 函数
- `bookmark_canvas_module.js`：多处直接调用 `getFaviconUrl()`

## 解决方案

### 1. 持久化 Favicon 缓存系统（IndexedDB）

新增 `FaviconCache` 对象，提供完整的缓存管理：

```javascript
const FaviconCache = {
    db: null,                          // IndexedDB 实例
    memoryCache: new Map(),            // 内存缓存（快速访问）
    failureCache: new Set(),           // 失败缓存（域名级别）
    pendingRequests: new Map(),        // 请求去重
    
    async init()                       // 初始化 IndexedDB
    async get(url)                     // 从缓存获取
    async save(url, dataUrl)           // 保存成功的favicon
    async saveFailure(url)             // 记录失败的域名
    async clear(url)                   // 清除指定URL的缓存
    async fetch(url)                   // 获取favicon（带缓存）
}
```

#### 存储结构
- **成功缓存表** (`favicons`)
  - domain: 域名
  - dataUrl: Base64编码的favicon数据
  - timestamp: 缓存时间（30天过期）

- **失败缓存表** (`failures`)
  - domain: 域名
  - timestamp: 失败时间（7天过期）

### 2. URL 智能过滤

在 `FaviconCache.isInvalidUrl()` 中过滤：
- 本地地址：localhost, 127.0.0.1, ::1
- 内网地址：10.x.x.x, 172.16-31.x.x, 192.168.x.x
- .local 域名
- 非 HTTP/HTTPS 协议

### 3. 失败缓存（Negative Cache）

- 记录失败的域名，避免重复请求
- 7天过期（可能是临时故障）
- 域名级别缓存（同一域名下的所有URL共享）

### 4. 请求去重

使用 `pendingRequests` Map 避免同一域名的并发重复请求。

### 5. 书签修改时清除缓存

#### background.js
在 `onChanged` 监听器中添加：
```javascript
if (changeInfo.url) {
    browserAPI.runtime.sendMessage({
        action: 'clearFaviconCache',
        url: changeInfo.url
    });
}
```

#### history.js
在消息监听器中处理：
```javascript
else if (message.action === 'clearFaviconCache') {
    if (message.url) {
        FaviconCache.clear(message.url);
    }
}
```

### 6. 更新函数

#### `getFaviconUrl()` - 同步版本（兼容性）
```javascript
function getFaviconUrl(url) {
    // 检查内存缓存和失败缓存
    // 返回 Google favicon URL（后台会缓存）
}
```

#### `getFaviconUrlAsync()` - 异步版本（推荐）
```javascript
async function getFaviconUrlAsync(url) {
    return await FaviconCache.fetch(url);
}
```

#### `preloadIcon()` - 使用新缓存
```javascript
async function preloadIcon(url) {
    await FaviconCache.fetch(url);
}
```

## 实现效果

### 规则实现情况

✅ **规则1：成功获取的favicon直接用存储**
- 使用 IndexedDB 持久化存储（30天有效）
- 内存缓存加速访问
- 页面刷新后依然有效

✅ **规则2：失败的使用默认图标**
- 失败域名记录在 `failures` 表（7天有效）
- 使用 `fallbackIcon` SVG 图标
- 修改URL时会清除失败记录并重试

✅ **规则3：减少不必要的请求**
- 过滤本地/内网/无效URL
- 请求去重（同一域名同时只请求一次）
- 超时保护（5秒）

✅ **规则4：失败缓存（negative cache）**
- 域名级别的失败记录
- 7天过期（考虑临时故障）
- 避免同一域名反复404

## 性能优化

1. **三级缓存**
   - L1: 内存缓存（最快）
   - L2: IndexedDB（持久化）
   - L3: 网络请求

2. **批量预加载**
   - 最多预加载50个图标
   - 批次大小10（控制并发）

3. **Base64 存储**
   - 转换为 Base64 避免跨域问题
   - 完全离线可用

4. **过期机制**
   - 成功缓存：30天
   - 失败缓存：7天

## 使用建议

### 新代码
推荐使用异步版本：
```javascript
const faviconUrl = await getFaviconUrlAsync(bookmark.url);
img.src = faviconUrl;
```

### 旧代码兼容
保留同步版本：
```javascript
const faviconUrl = getFaviconUrl(bookmark.url);
img.src = faviconUrl;
img.onerror = () => { img.src = fallbackIcon; };
```

## 测试建议

1. **首次加载** - 验证favicon正常加载并缓存
2. **刷新页面** - 验证从缓存读取（无网络请求）
3. **404 URL** - 验证失败缓存生效
4. **修改URL** - 验证缓存清除和重新获取
5. **本地URL** - 验证过滤逻辑（如 localhost）
6. **过期测试** - 修改时间戳验证过期逻辑

## 注意事项

1. **IndexedDB 兼容性** - 现代浏览器都支持
2. **CORS 问题** - Google favicon 服务支持跨域，但转换为Base64存储
3. **存储空间** - 每个favicon约2-5KB，1000个约2-5MB
4. **初始化时机** - DOMContentLoaded 时初始化缓存系统

## 文件修改清单

- ✅ `history.js` - 添加 `FaviconCache` 对象
- ✅ `history.js` - 更新 `getFaviconUrl()` 使用缓存
- ✅ `history.js` - 添加 `getFaviconUrlAsync()` 
- ✅ `history.js` - 更新 `preloadIcon()` 使用新缓存
- ✅ `history.js` - 初始化时启动 `FaviconCache.init()`
- ✅ `history.js` - 添加 `clearFaviconCache` 消息处理
- ✅ `background.js` - `onChanged` 监听器发送清除缓存消息
- ⏭️ `bookmark_canvas_module.js` - （可选）使用 `getFaviconUrlAsync()`

## 后续优化建议

1. **添加清理功能** - 定期清理过期缓存
2. **统计信息** - 显示缓存命中率
3. **手动刷新** - 提供UI按钮强制刷新favicon
4. **批量更新** - 书签导入时批量更新favicon
