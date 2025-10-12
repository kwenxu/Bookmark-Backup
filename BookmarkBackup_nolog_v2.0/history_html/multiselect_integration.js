// 多选功能集成 - 添加到 attachTreeEvents 函数中

// 在 attachTreeEvents 函数的末尾添加以下代码：

function attachTreeEventsWithMultiSelect(treeContainer) {
    // ... 原有的代码保持不变 ...
    
    // 绑定多选点击事件
    treeContainer.addEventListener('click', (e) => {
        const treeItem = e.target.closest('.tree-item[data-node-id]');
        if (!treeItem) return;
        
        const nodeId = treeItem.dataset.nodeId;
        
        // Ctrl/Cmd + Click: 多选
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof toggleNodeSelection === 'function') {
                toggleNodeSelection(nodeId, treeItem);
            }
            lastClickedNode = nodeId;
            return;
        }
        
        // Shift + Click: 范围选择
        if (e.shiftKey && lastClickedNode) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof selectRange === 'function') {
                selectRange(lastClickedNode, nodeId);
            }
            return;
        }
        
        // 普通点击：取消其他选择（如果不是在已选中的项上）
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
            if (!treeItem.classList.contains('selected')) {
                if (typeof deselectAll === 'function') {
                    deselectAll();
                }
            }
            lastClickedNode = nodeId;
        }
    });
    
    // 全选快捷键：Ctrl+A
    document.addEventListener('keydown', (e) => {
        // 只在书签树容器有焦点时生效
        const isTreeFocused = treeContainer.contains(document.activeElement) || 
                             document.activeElement === document.body;
        
        if ((e.ctrlKey || e.metaKey) && e.key === 'a' && isTreeFocused) {
            e.preventDefault();
            if (typeof selectAll === 'function') {
                selectAll();
            }
        }
        
        // ESC键取消选择
        if (e.key === 'Escape' && selectedNodes.size > 0) {
            if (typeof deselectAll === 'function') {
                deselectAll();
            }
        }
    });
}

// 使用说明：
// 在 history.js 的 attachTreeEvents 函数末尾添加上述多选事件监听代码
