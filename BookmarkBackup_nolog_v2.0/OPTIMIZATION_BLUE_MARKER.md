# 书签树蓝色标记优化

## 问题描述

在书签树中，当删除或添加某个书签/文件夹时，附近的兄弟节点会被错误地标记为蓝色（"moved"状态），即使这些节点本身并未被用户主动操作。

**示例场景：**
- 用户删除了文件夹"B"
- 之前在B之后的文件夹"C"的索引从2改变为1
- 结果：C会被错误地标记为蓝色（moved），尽管用户并未移动它

## 根本原因

在 `detectTreeChangesFast` 函数（`history_html/history.js` 第2970行）中，当比较新旧书签树时：

1. 系统首先记录了"added"和"deleted"的节点
2. 然后检查"同级移动"，即同一父级下的节点是否改变了位置
3. 当某个兄弟节点因为add/delete而改变索引时，它被加入到候选项中
4. 系统会选择位移量最大的节点标记为"moved"
5. **问题**：这些位置改变是被动的，不应该被标记为"moved"

## 解决方案

在 `detectTreeChangesFast` 函数的同级移动检测部分添加优化逻辑：

1. **建立"有add/delete操作的父级"集合** - 遍历所有changes，找出哪些父级节点有add/delete操作
2. **跳过这些父级的同级移动检测** - 如果某个父级在上述集合中，则不对该父级下的其他节点进行位置改变检测，避免被动位置改变被标记为"moved"

## 修改文件

- **文件**：`history_html/history.js`
- **函数**：`detectTreeChangesFast`（第2970行）
- **修改位置**：第3032-3090行（同级移动检测部分）

## 关键优化代码

```javascript
// 建立"有add/delete操作的父级"集合
const parentsWithAddDelete = new Set();
changes.forEach((change, id) => {
    if (change.type.includes('added') || change.type.includes('deleted')) {
        const node = change.type.includes('added') ? newNodes.get(id) : oldNodes.get(id);
        if (node && node.parentId) {
            parentsWithAddDelete.add(node.parentId);
        }
    }
});

// 在同级移动检测中跳过这些父级
newByParent.forEach((newList, parentId) => {
    if (parentsWithAddDelete.has(parentId)) {
        return; // 跳过有add/delete操作的父级
    }
    // ... 继续处理其他父级的同级移动
});
```

## 设计原理

- **只标记用户主动操作的对象**：蓝色标记（moved）只应该显示在用户主动拖拽或移动的节点上
- **被动位置改变不计算**：因为add/delete导致的兄弟节点位置改变是被动的，不应该被视为"移动"
- **优先级**：优先保留显式标记（`explicitMovedIds`，用户拖拽时设置），这确保了拖拽操作的标记不会被override

## 效果

修改后：
- ✅ 删除或添加书签时，其他书签不再被错误标记为蓝色
- ✅ 用户拖拽的节点仍然会正确显示蓝色标记
- ✅ 书签树视觉更加清晰，减少了不必要的视觉干扰

## 验证

可以通过以下操作验证修改的有效性：

1. 打开浏览器书签管理器
2. 在某个文件夹下添加或删除一个书签/子文件夹
3. 查看书签树 - 其他兄弟节点不应该显示蓝色标记
4. 手动拖拽一个节点到其他位置 - 该节点应该显示蓝色标记

## 相关代码

- 用户拖拽操作设置的显式移动ID：`explicitMovedIds`（`history.js` 第35行）
- 蓝色标记的CSS类：`.tree-change-moved`（`history.css`中定义）
- 拖拽处理：`bookmark_tree_drag_drop.js` 第297-303行
