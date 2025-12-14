# 任务书：导出 Obsidian 兼容的 `.md` 文件（供 `.canvas` 的 `file` 节点引用）

## 目标
- 将「永久栏目」「书签型临时栏目」「空白栏目」导出为**纯 Markdown 源码**的 `.md` 文件集合。
- 在 Obsidian 中实现“强可视化 + 可折叠树状结构”（标题折叠 + 列表折叠混合）。
- 为后续“本体包导入（zip）”预留**稳定格式**与**纠错/容错解析点**。

## 导入范围（两种入口）
关于导入：分两种

1. 本体文件导入（全部）：导入「导出」生成的压缩包（zip），恢复整个书签画布状态。
2. 其他书签树导入：导入外部的 `html/json` 书签树文件，作为「书签型临时栏目」创建到画布中（不影响本体数据）。

## 输出物（文件结构）
导出目录根：`bookmark-canvas-export/`

- `bookmark-canvas-export/permanent-bookmarks.md`
- `bookmark-canvas-export/temp-sections/<tempSectionId>.md`（每个书签型临时栏目 1 个）
- `bookmark-canvas-export/md-nodes/<mdNodeId>.md`（每个空白栏目 1 个）

备注：后续 zip 任务会把整个目录打包，并生成 `.canvas` 引用这些路径。

## Markdown 规范（必须遵守，便于回读与纠错）

### 通用头部元信息（每个 md 文件都写）
文件首行起固定块（YAML frontmatter）：

```md
---
exporter: bookmark-backup-canvas
exportVersion: 1
exportedAt: <ISO8601>
source: <permanent|tempSection|mdNode>
sourceId: <id>
title: <title or empty>
---
```

要求：
- `exportVersion` 固定为整数，后续升级兼容用。
- `source/sourceId` 用于回导定位与纠错。
- 该块必须放在文件最顶部。

### “树状书签”可折叠结构（永久栏目 / 临时栏目内条目）
采用“标题折叠 + 列表折叠”混合：

- 顶层根分组：使用 `## <RootName>`（可折叠标题）
- 文件夹：使用列表项表示，并以缩进体现层级（可折叠列表）
- 书签：使用标准 Markdown 链接：`- [Title](URL)`
- 文件夹行格式：`- 📁 <FolderName>`（仅视觉标识；回读时以“非链接 + 有子级缩进”判断文件夹）
- 若文件夹为空：仍保留一行 `- 📁 <FolderName>`，不加子项

示例（规范示意）：

```md
## Bookmark Bar
- 📁 Dev
  - 📁 Docs
    - [JSON Canvas Spec](https://jsoncanvas.org/spec/1.0/)
  - [Obsidian](https://obsidian.md)
- 📁 Read Later
  - [Example](https://example.com)
```

### 临时栏目说明（`description`）
临时栏目 `.md` 文件中，frontmatter 后紧跟：

- `# <TempSectionTitle>`（标题）
- `> <说明>` 或普通段落（纯 Markdown 原样输出）
- 然后再输出树状结构（同上）

若说明为空：
- 仍输出 `# <TempSectionTitle>`，说明段落省略。

### 空白栏目（`mdNode`）
- frontmatter 后输出 `# <可选标题>`（若无标题可省略）
- 内容使用**纯 Markdown 文本**：
  - 优先来源：`node.text`（当前系统保存的纯文本字段）
  - 不导出 HTML

## 数据映射规则

### 永久栏目
输入：Chrome bookmarks tree（或内部“永久栏目数据结构”）。
输出：`permanent-bookmarks.md`。

根分组建议至少包含：
- `## Bookmark Bar`
- `## Other Bookmarks`
- `## Mobile Bookmarks`（如存在）

每个根下递归输出文件夹/书签折叠树。

### 书签型临时栏目（`CanvasState.tempSections`）
每个 section 输出：`temp-sections/<id>.md`。

- `title`：`section.title`
- `description`：`section.description`（原样 Markdown）
- `items`：递归输出折叠树
  - `bookmark`：`- [title](url)`
  - `folder`：`- 📁 name` + 子级缩进

### 空白栏目（`CanvasState.mdNodes`）
每个 node 输出：`md-nodes/<id>.md`。

- 内容：`node.text`（写入前清理 `\u200B`）

## 纠错/容错要求（为“导入”做准备）
导出时做“轻量纠错”：

- URL 非法或为空：改为 `#`，并在行尾加注 `<!-- invalid-url -->`
- Title 为空：用 URL 或 `Untitled` 填充
- 去除零宽空格 `\u200B`
- 统一换行 `\\n`，UTF-8

导入（后续任务）至少要能：
- 识别 frontmatter 的 `source/sourceId/exportVersion`
- 解析标题根 `##`
- 解析缩进列表层级
- 解析 Markdown 链接为书签
- 对缩进错误做修复（例如缩进不成对时向最近父级回退）

## 验收标准
- 将导出的 md 文件放入 Obsidian vault：
  - `permanent-bookmarks.md` 展示为可折叠树（标题与列表均可折叠）
  - 临时栏目 md 同样可折叠，且说明原样显示
  - 空白栏目 md 内容与画布中 `node.text` 一致（纯源码）
- 后续 `.canvas` 引用这些 md 文件时，file 节点能正常打开对应文件。
