# 书签变化导出功能设计文档

## ✅ 已实现功能

### 1. UI部分
- ✅ 在「切换详略」按钮左边添加了导出按钮 `exportChangesBtn`
- ✅ 点击后弹出模态框 `exportChangesModal`
- ✅ 模态框包含4组选项：格式、模式、扩展层级、操作方式

### 2. 选项设置（每行单选）
1. **格式**: HTML 或 JSON ✅
2. **模式**: 简单 或 详细 ✅
3. **扩展层级**: 0-3层滑块（仅在详细模式下显示）✅
4. **操作**: 导出（下载文件）或 复制（到剪贴板）✅

### 3. 变化类型标记

导出的 HTML/JSON 包含图例文件夹，说明变化类型：

| 变化类型 | 前缀标记 | 示例 |
|---|---|---|
| 新增 | `[+]` | `[+] 新网站` |
| 删除 | `[-]` | `[-] 已删除的网站` |
| 修改 | `[~]` | `[~] 改名后的网站` |
| 移动 | `[↔]` | `[↔] 移动的书签` |

### 4. 导出格式

#### HTML格式
- 标准 Netscape Bookmark 格式，可直接导入浏览器
- 包含图例文件夹
- 按原路径结构组织

#### JSON格式
```json
{
  "exportDate": "2025-12-31T19:00:00+08:00",
  "exportMode": "simple",
  "expandDepth": 0,
  "legend": {
    "[+]": "新增",
    "[-]": "删除",
    "[~]": "修改",
    "[↔]": "移动"
  },
  "summary": {
    "added": 5,
    "deleted": 2,
    "modified": 1,
    "moved": 3
  },
  "changes": [...]
}
```

## ⏳ 待实现功能

### 详细模式的层级扩展
当前详细模式仅导出变化项本身。需要实现：

- **第0层（仅同级）**: 变化项所在文件夹的所有兄弟节点
- **第1层**: 包含父级文件夹
- **第2层**: 包含祖父级文件夹
- **第3层**: 包含曾祖父级文件夹

实现位置：`collectChangesForExport()` 函数中的 TODO 注释处

## 文件修改记录

1. `history_html/history.html` - 添加导出变化模态框
2. `history_html/history.js` - 添加导出按钮和完整导出逻辑
   - `showExportChangesModal()` - 显示模态框
   - `initExportChangesModal()` - 初始化事件绑定
   - `executeExportChanges()` - 执行导出
   - `generateChangesHTML()` - 生成HTML格式
   - `generateChangesJSON()` - 生成JSON格式
   - `collectChangesForExport()` - 收集变化项
   - `getChangePrefix()` - 获取变化类型前缀
   - `escapeHtml()` - HTML转义
