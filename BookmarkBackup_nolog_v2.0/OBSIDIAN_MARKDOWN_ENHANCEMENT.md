# Obsidian Markdown 增强更新

## 更新日期
2025-11-07

## 更新内容

### 1. 支持 Obsidian 风格的 HTML 标签

现在「书签画布」中的「空白栏目」（Markdown 文本卡片）和「临时栏目说明」都支持以下 HTML 标签：

#### 支持的标签
- `<font color="#颜色">` - 设置文字颜色
- `<u>` - 下划线
- `<mark>` - 高亮标记
- `<strong>` / `<b>` - 粗体
- `<em>` / `<i>` - 斜体
- `<del>` / `<s>` - 删除线
- `<sub>` - 下标
- `<sup>` - 上标
- `<span>` - 通用容器（支持 style 和 class 属性）
- `<br>` - 换行

#### 支持的属性
- `color` - 颜色属性（用于 font 标签）
- `style` - 样式属性（已过滤危险内容）
- `class` - CSS 类名

### 2. 完整的 Obsidian Markdown 语法支持

除了 HTML 标签，还支持以下 Obsidian 特有语法：

#### Callout（提示框）
```markdown
> [!note] 标题
> 这是内容

> [!tip] 提示
> 这是提示内容

> [!warning] 警告
> 这是警告内容

> [!danger] 危险
> 这是危险提示
```

支持的 Callout 类型：
- `note` 📝 - 笔记
- `info` 💡 - 信息
- `tip` ✨ - 提示
- `success` ✅ - 成功
- `question` ❓ - 问题
- `warning` ⚠️ - 警告
- `danger` ⛔ - 危险
- `bug` 🐞 - Bug
- `example` 📌 - 示例
- `quote` 💬 - 引用

#### Wiki 链接
```markdown
[[链接目标]]
[[链接目标|显示文本]]
```

#### 高亮文本
```markdown
==高亮的文本==
```

#### 任务列表
```markdown
- [ ] 未完成任务
- [x] 已完成任务
```

### 3. 使用示例

你提供的例子现在可以正确渲染：

```markdown
「（书签型）临时栏目」下面会将到✅

1、从「核心永久栏目（Locate）」里面拖拽出去形成（<font color="#ffff00">正在实现</font>）；（要形成标识）

2、从导入其他html书签或者json书签，作为「临时栏目」；（右键吗？）（<font color="#00b0f0">还没有做</font>）

<u>双击左键 直接生成一个 空白栏目</u>
```

渲染效果：
- "正在实现" 会显示为黄色（#ffff00）
- "还没有做" 会显示为蓝色（#00b0f0）
- "双击左键 直接生成一个 空白栏目" 会显示下划线

### 4. 安全性

所有 HTML 标签都经过严格的白名单过滤：
- 只允许安全的标签和属性
- 自动过滤 `javascript:` 和 `expression()` 等危险内容
- 不允许的标签会被转义显示为文本

### 5. 测试

可以使用 `history_html/test_markdown_render.html` 测试 Markdown 渲染效果。

## 修改的文件

1. **history_html/vendor/obsidian-markdown.js**
   - 修改 `renderer.html` 函数，支持安全的 HTML 标签白名单

2. **history_html/history.css**
   - 为 `.md-canvas-text` 添加 HTML 标签样式
   - 为 `.temp-node-description` 添加 HTML 标签样式
   - 添加链接、任务列表等元素的样式

3. **history_html/test_markdown_render.html**（新增）
   - Markdown 渲染测试页面

## 使用方法

1. 在「书签画布」中双击空白处创建「空白栏目」
2. 双击栏目进入编辑模式
3. 输入 Markdown 文本，包括 HTML 标签
4. 按 `Ctrl+Enter`（Mac: `Cmd+Enter`）或点击外部保存
5. 文本会自动渲染为格式化的内容

同样适用于「临时栏目」的说明文字编辑。

## 注意事项

- HTML 标签必须正确闭合
- 颜色值使用十六进制格式（如 `#ffff00`）
- 不支持的 HTML 标签会显示为源码
- 建议优先使用 Markdown 语法，HTML 标签作为补充
