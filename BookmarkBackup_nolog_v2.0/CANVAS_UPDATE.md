# Bookmark Canvas 功能更新说明

## 更新内容

将「Bookmark Tree」页面改造为「Bookmark Canvas」，实现了类似 Obsidian Canvas 的可视化书签管理功能。

## 核心改动

### 1. 文件变更

**新增文件：**
- `/history_html/bookmark_canvas_module.js` - Canvas 核心功能模块

**修改文件：**
- `/history_html/history.html` - 更新视图结构和导航
- `/history_html/history.css` - 新增 Canvas 样式（追加在文件末尾）
- `/history_html/history.js` - 集成 Canvas 视图初始化
- `/manifest.json` - 保持原状（未添加独立资源）

### 2. 视图改造

**原来：**
```
- Bookmark Tree（独立视图）
  └── 显示书签树结构
```

**现在：**
```
- Bookmark Canvas（改造后的视图）
  ├── Canvas工作区（画布，可拖动临时节点）
  └── 永久栏目（中心区域，原书签树内容）
```

### 3. 功能特性

#### 永久栏目（Permanent Section）
- 画布中心的蓝色边框区域
- 显示浏览器真实书签树
- 支持文件夹展开/折叠
- 点击书签在新标签页打开
- 可拖拽书签/文件夹到画布

#### 临时栏目（Temporary Nodes）
- 从永久栏目拖拽书签/文件夹到画布创建
- 可在画布上自由移动（拖动标题栏）
- 独立于浏览器书签系统
- 用于临时整理和规划
- 数据保存在 localStorage

#### 双向拖拽
**拖出（永久 → 临时）：**
- 从永久栏目拖拽书签/文件夹到画布空白区域
- 自动创建临时节点
- 不影响浏览器书签

**拖回（临时 → 永久）：**
- 从临时节点**内容区域**拖回永久栏目
- 永久栏目显示绿色高亮
- 自动添加到浏览器书签栏
- 临时节点自动移除

#### 导入导出
**导入：**
- HTML 书签（Chrome/Firefox 导出格式）
- JSON 书签（Chrome 书签数据）
- 自动创建为临时节点

**导出：**
- `.canvas` 文件（JSON Canvas 规范）
- 包含永久栏目和所有临时节点
- 可在 Obsidian 中打开

## 技术实现

### 模块化设计
```javascript
// Canvas模块对外接口
window.CanvasModule = {
    init: initCanvasView,           // 初始化Canvas视图
    refresh: renderPermanentBookmarkTree, // 刷新永久栏目
    clear: clearAllTempNodes        // 清空临时节点
};
```

### 数据管理
```javascript
// Canvas状态
CanvasState = {
    tempNodes: [],              // 临时节点数组
    tempNodeCounter: 0,         // 节点ID计数器
    dragState: {                // 拖拽状态
        isDragging: false,
        draggedElement: null,
        draggedData: null,
        dragSource: 'permanent|temporary'
    }
};
```

### localStorage 存储
```javascript
// 键名：bookmark-canvas-temp-nodes
{
    nodes: [...],    // 临时节点数据
    timestamp: 123456 // 保存时间
}
```

## 用户操作指南

### 基础操作
1. **访问 Canvas**
   - 打开插件 → 历史记录查看器
   - 点击左侧导航「Bookmark Canvas」

2. **创建临时节点**
   - 在永久栏目找到书签/文件夹
   - 拖动到画布空白区域
   - 释放鼠标创建节点

3. **移动节点**
   - 拖动节点标题栏改变位置
   - 自动保存新位置

4. **拖回永久栏目**
   - 从节点**内容区**（不是标题栏）开始拖动
   - 拖到绿色高亮的永久栏目
   - 释放添加到浏览器书签

5. **删除节点**
   - 点击节点右上角 × 按钮
   - 或使用「清空临时节点」清空所有

### 导入导出
1. **导入书签**
   - 点击工具栏「导入」按钮
   - 选择 HTML 或 JSON 格式
   - 选择本地文件
   - 自动创建临时节点

2. **导出 Canvas**
   - 点击工具栏「导出」按钮
   - 自动下载 .canvas 文件
   - 可在 Obsidian 中打开

## JSON Canvas 规范

导出的 `.canvas` 文件符合 [JSON Canvas Spec 1.0](https://jsoncanvas.org/spec/1.0/)：

```json
{
  "nodes": [
    {
      "id": "permanent-section",
      "type": "group",
      "x": 300, "y": 300,
      "width": 600, "height": 600,
      "label": "Bookmark Tree (永久栏目)",
      "color": "4"
    },
    {
      "id": "temp-node-1",
      "type": "text",
      "x": 100, "y": 100,
      "width": 250, "height": 150,
      "text": "# 书签标题\n\n[链接](url)"
    }
  ],
  "edges": []
}
```

## 使用场景

### 场景 1：书签整理
1. 拖出需要整理的书签
2. 在画布上按类别排列
3. 逐个拖回形成新结构

### 场景 2：批量导入筛选
1. 导入外部书签文件
2. 在画布上比较筛选
3. 选择性保存到浏览器

### 场景 3：规划设计
1. 在画布上规划理想结构
2. 导出为 .canvas 文件
3. 在 Obsidian 中完善
4. 最终实施到浏览器

## 注意事项

⚠️ **重要提示**
1. 临时节点数据保存在 localStorage，清除浏览器数据会丢失
2. 拖回永久栏目会实际修改浏览器书签
3. 导出的 .canvas 文件仅为快照，不会实时更新
4. 拖动节点标题栏 = 移动位置；拖动内容区 = 拖回永久栏目

⚠️ **拖拽区分**
- **拖动标题栏** → 移动节点在画布上的位置
- **拖动内容区** → 拖回永久栏目（添加到书签）

## 兼容性

- ✅ Chrome 88+
- ✅ Edge 88+
- ✅ 使用 Chrome Extensions Manifest V3
- ✅ localStorage 支持
- ✅ HTML5 Drag and Drop API

## 参考资料

- [JSON Canvas 官网](https://jsoncanvas.org/)
- [Obsidian Canvas](https://obsidian.md/canvas)
- [Obsidian GitHub](https://github.com/obsidianmd)

---

**版本：** v2.0  
**更新时间：** 2024-10-22  
**开发者：** kk1
