# 备份历史导入恢复功能计划书

## 📋 项目概述

### 项目名称
备份历史导入恢复功能（Backup History Import & Restore）

### 项目目标
1. 实现手动导入备份历史（从 JSON/ZIP 文件恢复 `syncHistory`）
2. **智能检测**：检测当前书签与导入历史的匹配度，给出警告和建议
3. 支持恢复展开状态和视图模式（WYSIWYG）
4. 支持选择性恢复（部分记录/完整恢复）
5. 结合完整恢复向导，实现一站式恢复体验

### 核心理念
> ⚠️ **备份历史和书签必须保持关联性**
> 
> 备份历史记录的是书签的变化。如果当前书签结构与导入的历史不匹配，历史记录将失去参考意义。
> 因此必须在导入时进行智能检测，并引导用户按正确顺序恢复。

### 关联计划书
- [完整恢复向导计划书](./complete_restore_wizard_plan.md) - 方案 C 详细设计
- [设置与初始化 UI 计划书](./settings_initialization_ui_plan.md) - Phase 3 同步与恢复

### 创建日期
2026-01-09

---

## 🎯 功能分期

### Phase 1: 手动导入 + 智能检测（方案 A）

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 导入按钮 | 在全局导出旁添加导入按钮 | ✅ 已完成 |
| 导入 JSON 文件 | 从单个 JSON 文件恢复一条记录 | 🔴 高 |
| 导入 ZIP 归档 | 从 ZIP 文件恢复多条记录 | 🔴 高 |
| **智能检测** | 检测当前书签与导入历史的匹配度 | 🔴 高 |
| **警告提示** | 匹配度低时警告用户，建议先恢复书签 | 🔴 高 |
| 合并策略 | 选择覆盖/合并现有记录 | 🟡 中 |
| 冲突检测 | 检测并处理重复记录 | 🟡 中 |
| 恢复进度 | 显示导入进度和结果 | 🟢 低 |

### Phase 2: 完整恢复向导（方案 C）

> 详见 [完整恢复向导计划书](./complete_restore_wizard_plan.md)

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 向导入口 | 在设置面板添加恢复向导入口 | 🔴 高 |
| 数据源选择 | 云端/本地文件选择 | 🔴 高 |
| 云端检测 | 自动检测云端备份状态 | 🟡 中 |
| 书签恢复 | 从备份恢复书签到浏览器 | 🔴 高 |

### Phase 3: 自动同步（未来计划）

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 云端拉取 | 从 WebDAV/GitHub 自动下载备份 | 🟡 中 |
| 增量同步 | 只同步新增/变化的记录 | 🟡 中 |
| 冲突解决 | 自动或手动解决版本冲突 | 🟡 中 |
| 定时同步 | 定期检查云端是否有更新 | 🟢 低 |

---

## 🏗️ Phase 1 实现设计

### 1. UI 设计

#### 导入按钮位置
```
备份历史视图头部:
[分页] [清除] [导出📤] [导入📥] [简略|详细]
                        ↑ 新增
```

#### 导入弹窗设计
```
┌─────────────────────────────────────────┐
│  📥 导入备份历史                    [×] │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  拖拽文件到此处，或点击选择     │    │
│  │                                 │    │
│  │  支持 .json 或 .zip 文件        │    │
│  └─────────────────────────────────┘    │
│                                         │
│  合并策略:                              │
│  ○ 合并 - 保留现有记录，添加新记录      │
│  ● 覆盖 - 清空现有记录，使用导入数据    │
│                                         │
│  ─────────────────────────────────────  │
│  预览: (选择文件后显示)                 │
│  • 记录数量: --                         │
│  • 时间范围: -- ~ --                    │
│  • 新增记录: --                         │
│  • 重复记录: --                         │
│                                         │
├─────────────────────────────────────────┤
│            [取消]    [确认导入]         │
└─────────────────────────────────────────┘
```

### 2. 数据处理流程

```
用户选择文件
       ↓
判断文件类型
       ├── .json → 解析单个 JSON
       └── .zip  → 解压并解析所有 JSON
              ↓
验证数据格式
       ├── 检查 _exportInfo
       ├── 检查 _rawBookmarkTree
       └── 检查 children 结构
              ↓
冲突检测
       ├── 根据 fingerprint 检测重复
       └── 根据 time 检测重复
              ↓
显示预览
       ↓
用户确认
       ↓
执行导入
       ├── 合并模式: 添加新记录，保留现有
       └── 覆盖模式: 替换 syncHistory
              ↓
恢复展开状态
       └── 从 _exportInfo.expandedIds 恢复
              ↓
刷新 UI
```

### 3. 关键函数设计

#### `importBackupHistory(file, options)`
```javascript
/**
 * 导入备份历史
 * @param {File|FileList} file - 用户选择的文件
 * @param {Object} options - 导入选项
 * @param {string} options.mergeStrategy - 'merge' | 'overwrite'
 * @returns {Promise<ImportResult>}
 */
async function importBackupHistory(file, options) {
    // 1. 解析文件
    // 2. 验证格式
    // 3. 检测冲突
    // 4. 执行导入
    // 5. 恢复设置
    // 6. 刷新 UI
}
```

#### `parseImportFile(file)`
```javascript
/**
 * 解析导入文件
 * @param {File} file - 文件对象
 * @returns {Promise<{records: Array, metadata: Object}>}
 */
async function parseImportFile(file) {
    const fileName = file.name.toLowerCase();
    
    if (fileName.endsWith('.json')) {
        // 解析单个 JSON
        const text = await file.text();
        const data = JSON.parse(text);
        return { records: [data], metadata: data._exportInfo };
    } 
    else if (fileName.endsWith('.zip')) {
        // 解压并解析所有 JSON
        const zip = await JSZip.loadAsync(file);
        const records = [];
        for (const [path, zipEntry] of Object.entries(zip.files)) {
            if (path.endsWith('.json')) {
                const text = await zipEntry.async('text');
                records.push(JSON.parse(text));
            }
        }
        return { records, metadata: { count: records.length } };
    }
    
    throw new Error('不支持的文件格式');
}
```

#### `restoreFromImportedRecord(record)`
```javascript
/**
 * 从导入的记录恢复到 syncHistory 格式
 * @param {Object} record - 导入的 JSON 对象
 * @returns {Object} syncHistory 格式的记录
 */
function restoreFromImportedRecord(record) {
    const info = record._exportInfo || {};
    
    return {
        time: info.backupTime,
        seqNumber: info.seqNumber,
        fingerprint: info.fingerprint,
        note: info.note,
        status: 'success',
        type: 'imported',  // 标记为导入的记录
        bookmarkStats: info.stats,
        bookmarkTree: record._rawBookmarkTree || null,
        // ... 其他字段
    };
}
```

#### `restoreViewSettings(records)`
```javascript
/**
 * 从导入的记录恢复展开状态
 * @param {Array} records - 导入的记录数组
 */
async function restoreViewSettings(records) {
    const { historyViewSettings } = await chrome.storage.local.get(['historyViewSettings']);
    const settings = historyViewSettings || {
        defaultMode: 'detailed',
        recordModes: {},
        recordExpandedStates: {}
    };
    
    for (const record of records) {
        const info = record._exportInfo || {};
        const timeKey = String(info.backupTime);
        
        if (info.expandedIds && info.expandedIds.length > 0) {
            settings.recordExpandedStates[timeKey] = info.expandedIds;
        }
        
        if (info.viewMode) {
            settings.recordModes[timeKey] = info.viewMode;
        }
    }
    
    await chrome.storage.local.set({ historyViewSettings: settings });
}
```

### 4. 冲突检测策略

| 检测条件 | 判定 | 处理 |
|----------|------|------|
| `fingerprint` 相同 | 完全重复 | 跳过或更新 |
| `time` 相同但 `fingerprint` 不同 | 同一时间点不同数据 | 提示用户选择 |
| 都不同 | 新记录 | 直接添加 |

### 5. 依赖项

- **JSZip**: 用于解压 ZIP 文件
  - CDN: `https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js`
  - 或内嵌到项目中

---

## 📊 预期成果

### 手动导入完成后

1. 用户可以从本地 JSON/ZIP 文件恢复备份历史
2. 恢复后的记录包含完整的书签树结构
3. 用户的展开状态和视图模式被恢复
4. UI 自动刷新显示导入的记录

### 未来自动同步功能

1. 从云端（WebDAV/GitHub）自动拉取最新备份
2. 智能合并本地和云端数据
3. 实现真正的跨设备同步

---

## ✅ 实现清单

### Phase 1: 手动导入

- [x] 在 history.html 添加导入按钮
- [ ] 添加导入弹窗 HTML
- [ ] 添加导入弹窗 CSS
- [ ] 引入 JSZip 库
- [ ] 实现 `parseImportFile()` 函数
- [ ] 实现 `restoreFromImportedRecord()` 函数
- [ ] 实现 `restoreViewSettings()` 函数
- [ ] 实现 `importBackupHistory()` 主函数
- [ ] 添加导入按钮点击事件监听
- [ ] 添加文件拖拽支持
- [ ] 添加导入预览功能
- [ ] 添加导入进度显示
- [ ] 添加多语言支持
- [ ] 测试 JSON 导入
- [ ] 测试 ZIP 导入
- [ ] 测试冲突处理

### Phase 2: 自动同步

- [ ] 设计自动同步架构
- [ ] 实现云端拉取（WebDAV）
- [ ] 实现云端拉取（GitHub）
- [ ] 实现增量同步逻辑
- [ ] 实现冲突解决 UI
- [ ] 添加定时同步设置
- [ ] 测试跨设备同步

---

## 📝 备注

- 当前导出的 JSON 已包含 `_rawBookmarkTree` 和 `_exportInfo.expandedIds`，完全支持恢复
- ZIP 归档使用固定文件名（覆盖模式），便于同步
- 建议先完成 Phase 1 的手动导入功能，验证数据格式正确后再实现自动同步
