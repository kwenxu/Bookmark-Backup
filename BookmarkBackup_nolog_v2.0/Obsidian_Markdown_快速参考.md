# Obsidian Markdown 快速参考

## 基础格式

```markdown
**粗体文字**
*斜体文字*
~~删除线~~
==高亮文本==
`行内代码`
```

## HTML 标签（新增支持）

```markdown
<font color="#ffff00">黄色文字</font>
<font color="#00b0f0">蓝色文字</font>
<font color="#ff0000">红色文字</font>
<u>下划线文字</u>
<mark>标记文字</mark>
```

### 常用颜色代码
- 黄色：`#ffff00` 或 `#ffd700`
- 蓝色：`#00b0f0` 或 `#0096ff`
- 红色：`#ff0000` 或 `#ff6b6b`
- 绿色：`#00ff00` 或 `#51cf66`
- 橙色：`#ffa500` 或 `#ff922b`
- 紫色：`#9b59b6` 或 `#cc5de8`
- 灰色：`#808080` 或 `#adb5bd`

## 标题

```markdown
# 一级标题
## 二级标题
### 三级标题
```

## 列表

### 无序列表
```markdown
- 项目 1
- 项目 2
  - 子项目 2.1
  - 子项目 2.2
```

### 有序列表
```markdown
1. 第一项
2. 第二项
3. 第三项
```

### 任务列表
```markdown
- [ ] 未完成任务
- [x] 已完成任务
- [ ] 待办事项
```

## Callout（提示框）

### 基础用法
```markdown
> [!note] 笔记标题
> 这是笔记内容
> 可以多行
```

### 可折叠 Callout
```markdown
> [!tip]+ 展开的提示
> 默认展开

> [!warning]- 折叠的警告
> 默认折叠
```

### Callout 类型

```markdown
> [!note] 📝 笔记
> 一般性笔记内容

> [!info] 💡 信息
> 重要信息提示

> [!tip] ✨ 提示
> 有用的提示和技巧

> [!success] ✅ 成功
> 成功完成的事项

> [!question] ❓ 问题
> 需要解答的问题

> [!warning] ⚠️ 警告
> 需要注意的警告

> [!danger] ⛔ 危险
> 危险或错误提示

> [!bug] 🐞 Bug
> 已知的 Bug

> [!example] 📌 示例
> 示例代码或内容

> [!quote] 💬 引用
> 引用的内容
```

## Wiki 链接

```markdown
[[链接目标]]
[[链接目标|显示的文字]]
```

## 链接和图片

```markdown
[链接文字](https://example.com)
![图片描述](https://example.com/image.jpg)
```

## 代码块

### 行内代码
```markdown
这是 `行内代码` 示例
```

### 代码块
````markdown
```javascript
function hello() {
  console.log("Hello World");
}
```
````

## 引用

```markdown
> 这是引用文字
> 可以多行
```

## 分隔线

```markdown
---
或
***
```

## 表格

```markdown
| 列1 | 列2 | 列3 |
|-----|-----|-----|
| 内容1 | 内容2 | 内容3 |
| 内容4 | 内容5 | 内容6 |
```

## 组合使用示例

```markdown
### 项目进度 ✅

1、从「核心永久栏目（Locate）」里面拖拽出去形成（<font color="#ffff00">正在实现</font>）

2、从导入其他html书签或者json书签，作为「临时栏目」（<font color="#00b0f0">还没有做</font>）

3、<u>双击左键 直接生成一个 空白栏目</u>

> [!tip] 快捷操作
> - 双击空白处：创建空白栏目
> - Ctrl+Enter：保存编辑
> - Esc：取消编辑

**任务列表：**
- [x] 完成基础功能
- [ ] 添加高级特性
- [ ] 优化性能
```

## 快捷键

- **保存编辑**：`Ctrl+Enter`（Mac: `Cmd+Enter`）
- **取消编辑**：`Esc`
- **进入编辑**：双击栏目

## 注意事项

1. HTML 标签必须正确闭合
2. 颜色值使用十六进制格式（如 `#ffff00`）
3. Callout 的类型名称不区分大小写
4. Wiki 链接目前仅作为样式显示，不会实际跳转
5. 任务列表的复选框可以点击切换状态
