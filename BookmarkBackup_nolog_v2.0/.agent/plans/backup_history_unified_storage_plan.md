# 备份历史统一存储架构迁移计划书

## 📋 项目概述

### 项目名称
备份历史数据统一存储架构迁移（Unified Storage Migration for Backup History）

### 项目目标
1. 将备份历史相关数据从分散存储（localStorage + chrome.storage.local）统一迁移到 chrome.storage.local
2. 实现完整的备份历史自动归档/导出功能
3. 支持跨设备同步和恢复备份历史
4. 确保 history.html 页面完整功能的备份与恢复
5. **统一导出逻辑**：让 background.js 的自动归档与 history.html 的全局导出使用相同的核心逻辑

### 创建日期
2026-01-09

### 📊 实现状态：✅ 已完成

---

## 🎯 最终实现总结

### 默认配置

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| **格式** | `json` | JSON 包含完整恢复信息 |
| **打包模式** | `zip` | 每条记录独立文件 |
| **文件名策略** | **覆盖** | 固定文件名，每次覆盖 |

### 文件结构

```
WebDAV/GitHub/本地:
└── 书签快照 & 工具箱/
    └── 备份历史/
        └── 备份历史归档.zip  ← 固定名称（覆盖模式）

ZIP 内部结构:
└── 备份历史归档_20260109_1720/
    ├── 01_备份_abc12345_20260109.json  ← 每条记录独立文件
    ├── 02_备份_def67890_20260108.json
    └── ...
```

### JSON 导出格式（支持完整恢复）

```json
{
  "title": "书签变化导出",
  "_exportInfo": {
    "backupTime": "2026-01-09T09:00:00.000Z",
    "exportTime": "2026-01-09T17:15:00.000Z",
    "note": "备份备注",
    "seqNumber": 42,
    "fingerprint": "abc12345",
    "stats": { "bookmarkAdded": 5, "bookmarkDeleted": 2, ... },
    "expandedIds": ["1", "2", "10"],       // 用户设置的展开节点（WYSIWYG）
    "viewMode": "detailed"                  // 视图模式
  },
  "_rawBookmarkTree": [ ... ],              // 原始书签树（完整恢复用）
  "children": [
    {
      "id": "123",                          // 节点 ID（恢复用）
      "title": "[+] 新增的书签",             // 带变化标记前缀
      "type": "bookmark",
      "url": "https://...",
      "changeType": "added"
    },
    ...
  ]
}
```

### 恢复能力

| 恢复项目 | 数据来源 | 支持 |
|----------|----------|------|
| **书签完整结构** | `_rawBookmarkTree` | ✅ |
| **变化视图（带前缀）** | `children` | ✅ |
| **展开状态** | `_exportInfo.expandedIds` | ✅ |
| **视图模式** | `_exportInfo.viewMode` | ✅ |
| **节点 ID** | 每个节点的 `id` | ✅ |
| **统计信息** | `_exportInfo.stats` | ✅ |

### 核心函数（background.js）

| 函数 | 功能 |
|------|------|
| `detectTreeChangesFastBg()` | 检测新增/删除/修改/移动 |
| `rebuildTreeWithDeletedBg()` | 重建包含删除节点的树 |
| `flattenBookmarkTreeBg()` | 展平书签树 |
| `prepareDataForExportBg()` | 准备导出数据（树 + 变化映射） |
| `generateFullBookmarkTreeHtml()` | 生成 Netscape Bookmark 格式 HTML |
| `generateFullBookmarkTreeJson()` | 生成结构化 JSON（支持完整恢复） |
| `generateMergedBookmarkHtml()` | 生成合并模式的 HTML |
| `exportSyncHistoryToCloud()` | 自动归档主函数 |

---

## 🏗️ 导出逻辑统一架构（核心设计）

### 当前问题：两套独立的导出逻辑

| 位置 | 函数 | 功能 | 问题 |
|------|------|------|------|
| `history.js` | `startGlobalExport()` | HTML 页面全局导出 | ✅ 完整功能（HTML/JSON/MD + ZIP/合并 + WYSIWYG） |
| `background.js` | `exportSyncHistoryToCloud()` | 自动归档 | ⚠️ 逻辑独立，不支持 MD，不支持 WYSIWYG |

### 目标架构：统一导出核心模块

```
┌─────────────────────────────────────────────────────────────────┐
│                      共享导出核心模块                              │
│              (backup_history_export_core.js)                     │
├─────────────────────────────────────────────────────────────────┤
│  • generateHistoryExportContent(records, options)               │
│    - 支持 HTML / JSON / MD 三种格式                              │
│    - 支持 simple / detailed 两种视图模式                         │
│    - 支持 WYSIWYG 展开状态（从 historyViewSettings 读取）         │
│                                                                 │
│  • packHistoryExport(contents, options)                         │
│    - 支持 ZIP 归档 / 单文件合并两种打包模式                        │
│                                                                 │
│  • buildExportMetadata(records, options)                        │
│    - 构建导出元数据（时间戳、序号范围、记录数等）                   │
└─────────────────────────────────────────────────────────────────┘
                    ▲                        ▲
                    │                        │
     ┌──────────────┴──────────┐   ┌────────┴───────────────┐
     │    history.js           │   │    background.js       │
     │  (全局导出 UI)           │   │  (自动归档 Service)    │
     ├─────────────────────────┤   ├────────────────────────┤
     │ startGlobalExport()     │   │ exportSyncHistoryToCloud() │
     │ - 调用核心模块生成内容   │   │ - 调用核心模块生成内容  │
     │ - 调用 downloadBlob()   │   │ - 直接上传到云端        │
     │   推送到云端+本地下载    │   │ - 或触发本地下载        │
     └─────────────────────────┘   └────────────────────────┘
```

### 实施方案：三种选项

#### 方案 A：消息驱动（推荐）⭐

**原理**：background.js 通过 `chrome.runtime.sendMessage` 请求 history.js 生成导出内容

```javascript
// background.js
async function exportSyncHistoryToCloud(options) {
    // 1. 获取设置和数据
    const settings = await browserAPI.storage.local.get([...]);
    
    // 2. 请求 history.js 生成导出内容
    const response = await chrome.runtime.sendMessage({
        action: 'generateHistoryExportContent',
        records: settings.syncHistory,
        format: options.format,      // 'html' | 'json' | 'md'
        packMode: options.packMode,  // 'zip' | 'merge'
        viewMode: options.viewMode,  // 来自 historyViewSettings
        // ... 其他选项
    });
    
    // 3. 上传到云端
    if (response.success) {
        await uploadToWebDAV(response.content, response.fileName);
        await uploadToGitHub(response.content, response.fileName);
    }
}
```

**优点**：
- 最小的代码改动
- history.js 负责所有导出逻辑，background.js 只负责调度和上传
- 保证两者输出完全一致

**缺点**：
- 需要 history.html 页面打开才能工作（可通过 offscreen document 解决）

---

#### 方案 B：共享模块（需要构建工具）

**原理**：抽离核心逻辑到共享模块，background.js 直接导入

```javascript
// lib/backup_history_export_core.js
export function generateHistoryHTML(records, options) { ... }
export function generateHistoryJSON(records, options) { ... }
export function generateHistoryMD(records, options) { ... }
export function packAsZip(files) { ... }

// background.js
import { generateHistoryHTML, packAsZip } from './lib/backup_history_export_core.js';

// history.js
import { generateHistoryHTML, packAsZip } from '../lib/backup_history_export_core.js';
```

**优点**：
- 完全解耦，最干净的架构
- 可独立测试核心模块

**缺点**：
- 需要修改为 ES Module 格式
- 需要更新 manifest.json 的脚本加载方式

---

#### 方案 C：简单复用（当前最佳折中）⭐⭐

**原理**：
1. background.js 继续保留现有的 `exportSyncHistoryToCloud()` 函数
2. 但是**读取与使用与 history.js 相同的设置**（`historyViewSettings`）
3. 让两者的输出格式**尽可能一致**

```javascript
// background.js 修改
async function exportSyncHistoryToCloud(options = {}) {
    const settings = await browserAPI.storage.local.get([
        'syncHistory',
        'historyViewSettings',  // ✅ 新增：读取视图设置
        'historySyncEnabled',
        'historySyncFormat',
        'historySyncPackMode',
        // ...
    ]);
    
    const viewSettings = settings.historyViewSettings || {
        defaultMode: 'detailed',
        recordModes: {},
        recordExpandedStates: {}
    };
    
    // 使用 viewSettings.defaultMode 代替硬编码的 'detailed'
    // 使用 viewSettings.recordModes[recordTime] 获取每条记录的模式
    // 使用 viewSettings.recordExpandedStates[recordTime] 获取展开状态
    
    // ... 生成导出内容时使用这些设置
}
```

**优点**：
- 改动最小
- 不需要 history.html 页面打开
- 立即可用

**缺点**：
- 两套代码仍然分离，需要手动保持同步

---

### 推荐：方案 B（直接生成 + 变化检测）✅ 已实现

**最终实现**：background.js 直接从 `chrome.storage.local` 读取所有数据，独立生成**与 history.js 全局导出完全一致**的完整书签变化树。

**实现细节**：

1. **变化检测函数**（从 history.js 复制并适配）：
   - `detectTreeChangesFastBg()` - 检测新增/删除/修改/移动
   - `rebuildTreeWithDeletedBg()` - 重建包含删除节点的树
   - `flattenBookmarkTreeBg()` - 展平书签树
   - `prepareDataForExportBg()` - 准备导出数据（树 + 变化映射）

2. **生成函数**（`generateFullBookmarkTreeHtml`, `generateFullBookmarkTreeJson`）：
   - 使用变化检测，添加 [+]、[-]、[~]、[↔] 等前缀标记
   - 从 `historyViewSettings.recordExpandedStates` 读取展开状态（WYSIWYG）
   - 支持 Netscape Bookmark 格式（HTML）和结构化 JSON

3. **exportSyncHistoryToCloud 修改**：
   - 传入完整 `syncHistory` 用于变化检测
   - 直接使用新函数生成完整书签变化树
   - **与 history.js 的全局导出输出格式完全一致**

**效果**：
- 自动归档生成的内容**与全局导出完全一致**（相同的格式、标记、展开逻辑）
- 使用用户在 history.html 中设置的展开状态（WYSIWYG）
- **无需打开任何页面**，background.js 独立完成所有工作

## 📊 当前架构分析

### 数据存储现状

| 数据项 | 存储位置 | Key 格式 | 说明 |
|--------|----------|----------|------|
| 备份历史记录 | `chrome.storage.local` | `syncHistory` | 主要数据（数组） |
| 全局默认视图模式 | `localStorage` | `historyDetailMode` | 'simple' 或 'detailed' |
| 每条记录的视图模式 | `localStorage` | `historyDetailMode:{recordTime}` | 'simple' 或 'detailed' |
| 每条记录的展开状态 | `localStorage` | `historyDetailExpanded:{recordTime}` | JSON 数组（展开的节点 ID） |

### syncHistory 记录结构
```javascript
{
  time: "2026-01-09T10:30:00.000Z",           // 备份时间
  seqNumber: 42,                               // 永久序号
  direction: "cloud_local",                    // 备份方向
  type: "auto",                                // 类型: auto/manual/switch
  status: "success",                           // 状态: success/error
  errorMessage: null,                          // 错误信息
  bookmarkStats: {                             // 变化统计
    bookmarkAdded: 5,
    bookmarkDeleted: 2,
    folderAdded: 1,
    folderDeleted: 0,
    movedCount: 3,
    modifiedCount: 1,
    explicitMovedIds: ["123", "456"]
  },
  isFirstBackup: false,                        // 是否首次备份
  note: "自动备份 - 检测到变化",               // 备注
  bookmarkTree: [...],                         // 完整书签树
  fingerprint: "a1b2c3d4"                      // 指纹哈希
}
```

### 问题分析

1. **数据分散**：核心数据在 chrome.storage.local，显示偏好在 localStorage
2. **无法后台访问**：background.js (Service Worker) 无法访问 localStorage
3. **无法跨设备同步**：localStorage 是浏览器本地的，不能通过 chrome.storage.sync 同步
4. **导出不完整**：当前的备份历史导出无法包含 localStorage 中的视图设置

---

## 🎯 目标架构设计

### 新的统一存储结构

所有数据统一存储在 `chrome.storage.local`：

```javascript
// 主键：syncHistory（保持不变）
syncHistory: [
  { time: "...", bookmarkTree: [...], ... },
  ...
]

// 新键：historyViewSettings
historyViewSettings: {
  // 全局默认视图模式
  defaultMode: "simple",  // 'simple' 或 'detailed'
  
  // 每条记录的视图模式
  recordModes: {
    "1704790200000": "detailed",
    "1704876600000": "simple",
    ...
  },
  
  // 每条记录的展开状态（WYSIWYG）
  recordExpandedStates: {
    "1704790200000": ["node-1", "node-2", "folder-3"],
    "1704876600000": ["node-5"],
    ...
  }
}
```

### 数据结构说明

| 新键 | 说明 |
|------|------|
| `historyViewSettings.defaultMode` | 替代 localStorage 的 `historyDetailMode` |
| `historyViewSettings.recordModes` | 替代 localStorage 的 `historyDetailMode:{recordTime}` |
| `historyViewSettings.recordExpandedStates` | 替代 localStorage 的 `historyDetailExpanded:{recordTime}` |

### WYSIWYG（所见即所得）设计理念 ⭐

**核心思想**：用户在 history.html 页面上的所有视图操作（切换模式、展开文件夹）都应该**立即持久化**到 `chrome.storage.local`，这样：

1. **history.html 全局导出** → 读取 `historyViewSettings` → 导出用户看到的内容
2. **background.js 自动归档** → 读取 `historyViewSettings` → 导出相同的内容  
3. **两者完全一致** = 真正的"所见即所得"

```
┌────────────────────────────────────────────────────────────────┐
│  用户在 history.html 页面上的操作                                │
├────────────────────────────────────────────────────────────────┤
│  • 切换某条记录为"详细模式"                                      │
│  • 手动展开某些文件夹                                            │
│                    ↓ 立即保存                                   │
└────────────────────────────────────────────────────────────────┘
                     ↓
┌────────────────────────────────────────────────────────────────┐
│  chrome.storage.local['historyViewSettings']                   │
├────────────────────────────────────────────────────────────────┤
│  {                                                             │
│    recordModes: { '1704790200000': 'detailed' },               │
│    recordExpandedStates: { '1704790200000': ['folder-1', ...] }│
│  }                                                             │
└────────────────────────────────────────────────────────────────┘
                     ↓ 可被读取
     ┌───────────────┴───────────────┐
     ↓                               ↓
┌─────────────┐              ┌──────────────────┐
│ history.js  │              │ background.js    │
│ 全局导出    │              │ 自动归档         │
├─────────────┤              ├──────────────────┤
│ ✅ 读取设置 │              │ ✅ 也能读取设置   │
│ ✅ 导出一致 │              │ ✅ 导出一致       │
└─────────────┘              └──────────────────┘
```

**之前的问题**：展开状态存在 `localStorage`，但 Service Worker (background.js) 无法访问 `localStorage`，导致自动归档无法获取用户的展开状态。

**迁移后**：展开状态存在 `chrome.storage.local`，所有地方都能访问，真正实现 WYSIWYG。

## 📝 实施步骤

### 阶段 1：准备工作 ✅ 已完成

#### 1.1 创建迁移辅助函数
- [x] 在 history.js 中创建 `migrateHistoryViewSettingsFromLocalStorage()` 函数
- [x] 读取所有 localStorage 中的 history 相关数据
- [x] 转换为新的统一格式
- [x] 写入 chrome.storage.local

#### 1.2 创建兼容层函数
- [x] 创建 `loadHistoryViewSettings()` - 从 chrome.storage.local 读取视图设置
- [x] 创建 `saveHistoryViewSettings()` - 写入视图设置（带防抖）
- [x] 修改 `getRecordDetailMode(recordTime)` - 从 historyViewSettings 获取视图模式
- [x] 修改 `setRecordDetailMode(recordTime, mode)` - 设置视图模式并保存
- [x] 修改 `getRecordExpandedState(recordTime)` - 从 historyViewSettings 获取展开状态
- [x] 修改 `saveRecordExpandedState(recordTime, nodeId, isExpanded)` - 保存展开状态
- [x] 修改 `captureRecordExpandedState(recordTime, treeContainer)` - 保存展开状态

---

### 阶段 2：修改 history.js

#### 2.1 修改全局变量初始化
**文件**：`history_html/history.js`

**当前代码**（行 13-17）：
```javascript
let historyDetailMode = (() => {
    try {
        return localStorage.getItem('historyDetailMode') || 'simple';
    } catch (e) { return 'simple'; }
})();
```

**修改为**：
```javascript
let historyDetailMode = 'simple'; // 默认值，将在初始化时从 chrome.storage.local 加载
let historyViewSettings = null;   // 缓存视图设置
```

#### 2.2 添加初始化加载函数
在 history.js 的初始化流程中添加：
```javascript
async function loadHistoryViewSettings() {
    return new Promise(resolve => {
        browserAPI.storage.local.get(['historyViewSettings'], result => {
            historyViewSettings = result.historyViewSettings || {
                defaultMode: 'simple',
                recordModes: {},
                recordExpandedStates: {}
            };
            historyDetailMode = historyViewSettings.defaultMode;
            resolve(historyViewSettings);
        });
    });
}
```

#### 2.3 修改 getRecordDetailMode 函数
**当前代码**（行 19536-19543）：
```javascript
function getRecordDetailMode(recordTime) {
    if (!recordTime) return historyDetailMode || 'simple';
    try {
        return localStorage.getItem(`${HISTORY_DETAIL_MODE_PREFIX}${recordTime}`) || historyDetailMode || 'simple';
    } catch (e) {
        return historyDetailMode || 'simple';
    }
}
```

**修改为**：
```javascript
function getRecordDetailMode(recordTime) {
    if (!recordTime) return historyDetailMode || 'simple';
    if (historyViewSettings && historyViewSettings.recordModes) {
        const mode = historyViewSettings.recordModes[String(recordTime)];
        if (mode) return mode;
    }
    return historyDetailMode || 'simple';
}
```

#### 2.4 修改 setRecordDetailMode 函数
**当前代码**（行 19545-19552）：
```javascript
function setRecordDetailMode(recordTime, mode) {
    if (!recordTime || !mode) return;
    try {
        localStorage.setItem(`${HISTORY_DETAIL_MODE_PREFIX}${recordTime}`, mode);
    } catch (e) {}
}
```

**修改为**：
```javascript
async function setRecordDetailMode(recordTime, mode) {
    if (!recordTime || !mode) return;
    if (!historyViewSettings) {
        historyViewSettings = { defaultMode: 'simple', recordModes: {}, recordExpandedStates: {} };
    }
    historyViewSettings.recordModes[String(recordTime)] = mode;
    await saveHistoryViewSettings();
}
```

#### 2.5 修改 hasRecordExpandedState 函数
**当前代码**（行 19555-19562）：
```javascript
function hasRecordExpandedState(recordTime) {
    if (!recordTime) return false;
    try {
        return localStorage.getItem(`${HISTORY_DETAIL_EXPANDED_PREFIX}${recordTime}`) != null;
    } catch (e) {
        return false;
    }
}
```

**修改为**：
```javascript
function hasRecordExpandedState(recordTime) {
    if (!recordTime) return false;
    if (historyViewSettings && historyViewSettings.recordExpandedStates) {
        return historyViewSettings.recordExpandedStates[String(recordTime)] != null;
    }
    return false;
}
```

#### 2.6 修改 getRecordExpandedState 函数
**当前代码**（行 19564-19574）：
```javascript
function getRecordExpandedState(recordTime) {
    if (!recordTime) return new Set();
    try {
        const raw = localStorage.getItem(`${HISTORY_DETAIL_EXPANDED_PREFIX}${recordTime}`);
        const parsed = raw ? JSON.parse(raw) : [];
        const ids = Array.isArray(parsed) ? parsed.map(id => String(id)) : [];
        return new Set(ids);
    } catch (e) {
        return new Set();
    }
}
```

**修改为**：
```javascript
function getRecordExpandedState(recordTime) {
    if (!recordTime) return new Set();
    if (historyViewSettings && historyViewSettings.recordExpandedStates) {
        const ids = historyViewSettings.recordExpandedStates[String(recordTime)];
        if (Array.isArray(ids)) {
            return new Set(ids.map(id => String(id)));
        }
    }
    return new Set();
}
```

#### 2.7 修改 saveRecordExpandedState 相关函数
**当前代码**（行 19600-19610 附近）：
```javascript
// 保存展开状态到 localStorage
localStorage.setItem(`${HISTORY_DETAIL_EXPANDED_PREFIX}${recordTime}`, JSON.stringify(expandedIds));
```

**修改为**：
```javascript
async function saveRecordExpandedState(recordTime, expandedIds) {
    if (!recordTime) return;
    if (!historyViewSettings) {
        historyViewSettings = { defaultMode: 'simple', recordModes: {}, recordExpandedStates: {} };
    }
    historyViewSettings.recordExpandedStates[String(recordTime)] = Array.from(expandedIds);
    await saveHistoryViewSettings();
}
```

#### 2.8 添加统一保存函数
```javascript
// 保存视图设置到 chrome.storage.local（带防抖）
let saveHistoryViewSettingsTimeout = null;
async function saveHistoryViewSettings() {
    if (saveHistoryViewSettingsTimeout) {
        clearTimeout(saveHistoryViewSettingsTimeout);
    }
    saveHistoryViewSettingsTimeout = setTimeout(async () => {
        await new Promise(resolve => {
            browserAPI.storage.local.set({ historyViewSettings }, resolve);
        });
        console.log('[历史视图设置] 已保存到 chrome.storage.local');
    }, 300); // 300ms 防抖
}
```

#### 2.9 修改全局模式切换
**当前代码**（行 19917, 19931）：
```javascript
localStorage.setItem('historyDetailMode', 'simple');
// 或
localStorage.setItem('historyDetailMode', 'detailed');
```

**修改为**：
```javascript
historyDetailMode = 'simple'; // 或 'detailed'
if (historyViewSettings) {
    historyViewSettings.defaultMode = historyDetailMode;
    saveHistoryViewSettings();
}
```

---

### 阶段 3：添加数据迁移逻辑

#### 3.1 创建迁移函数
在 history.js 中添加：
```javascript
/**
 * 将 localStorage 中的历史视图设置迁移到 chrome.storage.local
 * 只在首次加载时执行一次
 */
async function migrateHistoryViewSettingsFromLocalStorage() {
    // 检查是否已迁移
    const result = await new Promise(resolve => {
        browserAPI.storage.local.get(['historyViewSettingsMigrated'], resolve);
    });
    
    if (result.historyViewSettingsMigrated) {
        console.log('[迁移] 历史视图设置已迁移，跳过');
        return;
    }
    
    console.log('[迁移] 开始迁移 localStorage 中的历史视图设置...');
    
    const newSettings = {
        defaultMode: 'simple',
        recordModes: {},
        recordExpandedStates: {}
    };
    
    try {
        // 迁移全局默认模式
        const defaultMode = localStorage.getItem('historyDetailMode');
        if (defaultMode === 'simple' || defaultMode === 'detailed') {
            newSettings.defaultMode = defaultMode;
        }
        
        // 遍历 localStorage，找出所有历史相关的 key
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key) continue;
            
            // 迁移每条记录的视图模式
            if (key.startsWith('historyDetailMode:')) {
                const recordTime = key.replace('historyDetailMode:', '');
                const mode = localStorage.getItem(key);
                if (mode === 'simple' || mode === 'detailed') {
                    newSettings.recordModes[recordTime] = mode;
                }
            }
            
            // 迁移每条记录的展开状态
            if (key.startsWith('historyDetailExpanded:')) {
                const recordTime = key.replace('historyDetailExpanded:', '');
                try {
                    const expandedIds = JSON.parse(localStorage.getItem(key));
                    if (Array.isArray(expandedIds)) {
                        newSettings.recordExpandedStates[recordTime] = expandedIds;
                    }
                } catch (e) {}
            }
        }
        
        // 保存到 chrome.storage.local
        await new Promise(resolve => {
            browserAPI.storage.local.set({
                historyViewSettings: newSettings,
                historyViewSettingsMigrated: true
            }, resolve);
        });
        
        // 更新全局变量
        historyViewSettings = newSettings;
        historyDetailMode = newSettings.defaultMode;
        
        // 可选：清理 localStorage 中的旧数据（保留一段时间后再清理）
        // cleanupLocalStorageHistoryData();
        
        console.log('[迁移] 历史视图设置迁移完成');
        console.log('[迁移] 迁移的数据:', {
            defaultMode: newSettings.defaultMode,
            recordModesCount: Object.keys(newSettings.recordModes).length,
            recordExpandedStatesCount: Object.keys(newSettings.recordExpandedStates).length
        });
        
    } catch (error) {
        console.error('[迁移] 迁移失败:', error);
    }
}
```

#### 3.2 修改初始化流程
在 history.js 的 `initializeData()` 或 DOMContentLoaded 处理中：
```javascript
// 在加载 syncHistory 之前，先执行迁移和加载视图设置
await migrateHistoryViewSettingsFromLocalStorage();
await loadHistoryViewSettings();
```

---

### 阶段 4：修改 background.js 导出逻辑

#### 4.1 修改 exportSyncHistoryToCloud 函数
更新获取设置的代码，加入 `historyViewSettings`：
```javascript
const settings = await browserAPI.storage.local.get([
    'syncHistory',
    'historyViewSettings',  // 新增
    'historySyncEnabled',
    'historySyncFormat',
    'historySyncPackMode',
    // ... 其他设置
]);
```

#### 4.2 导出完整数据
在导出时包含视图设置：
```javascript
const exportData = {
    exportedAt: new Date().toISOString(),
    version: 2,
    syncHistory: settings.syncHistory || [],
    historyViewSettings: settings.historyViewSettings || null,
    // 其他元数据...
};
```

---

### 阶段 5：实现导入/恢复功能

#### 5.1 在 history.html 添加导入按钮
在全局导出模态框或工具栏添加"导入备份"按钮

#### 5.2 实现导入函数
```javascript
async function importBackupHistory(jsonContent) {
    try {
        const data = JSON.parse(jsonContent);
        
        // 验证数据结构
        if (!data.syncHistory || !Array.isArray(data.syncHistory)) {
            throw new Error('无效的备份文件格式');
        }
        
        // 确认覆盖
        const confirmed = confirm(currentLang === 'zh_CN' 
            ? `确定要导入 ${data.syncHistory.length} 条备份记录吗？这将覆盖当前的备份历史。`
            : `Import ${data.syncHistory.length} backup records? This will overwrite current backup history.`
        );
        
        if (!confirmed) return false;
        
        // 保存导入的数据
        await new Promise(resolve => {
            browserAPI.storage.local.set({
                syncHistory: data.syncHistory,
                historyViewSettings: data.historyViewSettings || null
            }, resolve);
        });
        
        // 更新全局变量
        syncHistory = data.syncHistory;
        if (data.historyViewSettings) {
            historyViewSettings = data.historyViewSettings;
            historyDetailMode = historyViewSettings.defaultMode || 'simple';
        }
        
        // 刷新页面显示
        renderHistoryList();
        
        showToast(currentLang === 'zh_CN' 
            ? `成功导入 ${data.syncHistory.length} 条备份记录`
            : `Successfully imported ${data.syncHistory.length} backup records`
        );
        
        return true;
        
    } catch (error) {
        console.error('[导入] 失败:', error);
        showToast(currentLang === 'zh_CN' 
            ? '导入失败: ' + error.message
            : 'Import failed: ' + error.message
        );
        return false;
    }
}
```

---

### 阶段 6：清理和优化

#### 6.1 清理旧的 localStorage 数据（可选）
```javascript
function cleanupLocalStorageHistoryData() {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (
            key === 'historyDetailMode' ||
            key.startsWith('historyDetailMode:') ||
            key.startsWith('historyDetailExpanded:')
        )) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
    console.log('[清理] 已清理 localStorage 中的旧数据:', keysToRemove.length, '项');
}
```

#### 6.2 移除不再需要的常量
```javascript
// 删除或注释掉
// const HISTORY_DETAIL_MODE_PREFIX = 'historyDetailMode:';
// const HISTORY_DETAIL_EXPANDED_PREFIX = 'historyDetailExpanded:';
```

---

## 📁 需要修改的文件清单

| 文件 | 修改类型 | 说明 |
|------|----------|------|
| `history_html/history.js` | 大幅修改 | 迁移存储逻辑、添加迁移函数 |
| `background.js` | 小幅修改 | 导出时包含 historyViewSettings |
| `popup.js` | 可能修改 | 如果有相关显示逻辑 |

---

## 🧪 测试计划

### 测试用例 1：新用户（无历史数据）
- [ ] 安装扩展，确认 historyViewSettings 正确初始化
- [ ] 进行几次备份，确认数据保存到 chrome.storage.local
- [ ] 修改视图模式，确认设置保存正确
- [ ] 展开/折叠文件夹，确认展开状态保存正确

### 测试用例 2：现有用户（有 localStorage 数据）
- [ ] 打开 history.html，确认迁移自动执行
- [ ] 检查 chrome.storage.local 是否包含迁移后的数据
- [ ] 确认视图模式和展开状态与迁移前一致

### 测试用例 3：导出功能
- [ ] 触发自动归档，确认导出文件包含完整数据
- [ ] 检查导出的 JSON 文件结构是否正确

### 测试用例 4：导入功能
- [ ] 清空备份历史
- [ ] 导入之前导出的文件
- [ ] 确认数据完整恢复

### 测试用例 5：跨设备同步（如果启用 chrome.storage.sync）
- [ ] 在设备 A 进行备份
- [ ] 在设备 B 检查是否同步

---

## ⚠️ 风险和回滚方案

### 潜在风险
1. **数据丢失**：迁移过程中可能丢失数据
2. **兼容性问题**：旧版本可能无法读取新格式数据
3. **存储限制**：chrome.storage.local 有 5MB 限制

### 缓解措施
1. 迁移前先备份 localStorage 数据
2. 保留 localStorage 数据一段时间（不立即删除）
3. 添加数据版本号，支持未来的格式升级

### 回滚方案
如果出现严重问题：
1. 从 localStorage 恢复数据
2. 回退代码修改
3. 手动清理 chrome.storage.local 中的新格式数据

---

## 📅 实施时间表

| 阶段 | 预计时间 | 说明 |
|------|----------|------|
| 阶段 1：准备工作 | 30 分钟 | 创建辅助函数 |
| 阶段 2：修改 history.js | 2-3 小时 | 核心代码修改 |
| 阶段 3：数据迁移逻辑 | 1 小时 | 迁移函数 |
| 阶段 4：修改 background.js | 30 分钟 | 导出逻辑更新 |
| 阶段 5：导入功能 | 1 小时 | 新增导入功能 |
| 阶段 6：清理和测试 | 1-2 小时 | 测试和优化 |
| **总计** | **6-8 小时** | |

---

## ✅ 完成标准

- [ ] 所有历史视图设置从 localStorage 迁移到 chrome.storage.local
- [ ] 现有用户的数据无损迁移
- [ ] 新用户正常使用
- [ ] 导出文件包含完整数据（syncHistory + historyViewSettings）
- [ ] 导入功能正常工作
- [ ] 所有测试用例通过

---

## 📌 备注

1. **关于 WYSIWYG 展开状态**：如果存储空间成为问题，可以考虑只保存最近 N 条记录的展开状态
2. **关于版本升级**：建议在导出数据中包含版本号，方便未来的格式升级

---

## ⚠️ 存储策略说明（重要）

### chrome.storage.sync vs chrome.storage.local

本项目**选择 `chrome.storage.local`** 作为统一存储，**不使用 `chrome.storage.sync`**。原因如下：

#### chrome.storage.sync 的严格限制

| 限制类型 | 数值 | 影响 |
|---------|------|------|
| **总容量** | **100 KB** | 所有数据总和不能超过 100KB |
| **单个键值** | **8 KB** | 每个 key-value 对不能超过 8KB |
| **Key 数量** | 512 个 | 最多 512 个 key |
| **写入频率** | 120 次/分钟 | 频繁写操作可能被限流 |

#### 为什么我们的数据不适合 chrome.storage.sync

1. **syncHistory 数据量巨大**
   - 每条记录包含完整的 `bookmarkTree`（可达 **数百KB ~ 几MB**）
   - 100KB 限制连**一条完整备份记录都存不下**
   - 100 条记录 × 每条 500KB = **50MB**（远超限制）

2. **historyViewSettings 可增长**
   - `recordModes`: 每条记录一个模式设置
   - `recordExpandedStates`: 每条记录可能有数十个展开节点 ID
   - 随着记录增多，8KB 单键限制很快会触发

3. **不符合设计目标**
   - **history.html 全局导出**：需要导出完整 `syncHistory`（含 `bookmarkTree`）
   - **主 UI 自动归档**：归档完整备份历史到云端（WebDAV/GitHub）
   - 这些场景需要**本地存储 + 手动云端归档**，而非浏览器内置同步

#### chrome.storage.local 的优势

| 特性 | 数值 | 说明 |
|------|------|------|
| **总容量** | **无限制** ✅ | 项目已在 `manifest.json` 中声明 `unlimitedStorage` 权限 |
| **无单键限制** | - | 可以存储大型 JSON 对象 |
| **无写入频率限制** | - | 可自由读写 |
| **Service Worker 可访问** | ✅ | background.js 可以操作，localStorage 做不到 |

> **注**：本项目 `manifest.json` 第 65 行已声明：`"unlimitedStorage"`
> 这意味着 `chrome.storage.local` 的 5MB 默认限制被解除，可以存储任意大小的数据。

#### 跨设备同步方案

本项目的跨设备同步**不依赖 `chrome.storage.sync`**，而是通过：

1. **WebDAV 同步**：用户配置的 WebDAV 服务器
2. **GitHub 同步**：用户配置的 GitHub 仓库
3. **手动导入/导出**：通过 JSON 文件在设备间传输

这种方式**没有容量限制**，并且用户对数据有完全控制权。

### 结论

> **`chrome.storage.sync` 的 100KB 限制完全不适合存储备份历史数据。**
> 
> 我们的统一存储策略是：
> - 本地存储：`chrome.storage.local`（5MB+，可无限扩展）
> - 跨设备同步：WebDAV / GitHub / 手动导入导出
