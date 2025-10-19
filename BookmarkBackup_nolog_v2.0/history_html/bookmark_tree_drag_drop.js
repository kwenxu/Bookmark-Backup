// 书签树拖拽功能
// 支持拖拽移动书签和文件夹

// 全局变量
let draggedNode = null;
let draggedNodeId = null;
let draggedNodeParent = null;
let draggedNodePrev = null;  // 被拖动节点的前一个同级节点
let draggedNodeNext = null;  // 被拖动节点的后一个同级节点
let dropIndicator = null;
let autoScrollInterval = null;
let lastScrollTime = 0;
let hoverExpandTimer = null;

// 初始化拖拽功能
function initDragDrop() {
    // 创建拖拽指示器
    dropIndicator = document.createElement('div');
    dropIndicator.className = 'drop-indicator';
    dropIndicator.style.display = 'none';
    document.body.appendChild(dropIndicator);
    
    console.log('[拖拽] 初始化完成');
}

// 为树节点绑定拖拽事件
function attachDragEvents(treeContainer) {
    if (!treeContainer) return;
    
    // 获取所有可拖拽的节点
    const draggableNodes = treeContainer.querySelectorAll('.tree-item[data-node-id]');
    
    draggableNodes.forEach(node => {
        // 设置可拖拽
        node.setAttribute('draggable', 'true');
        
        // 拖拽开始
        node.addEventListener('dragstart', handleDragStart);
        
        // 拖拽经过
        node.addEventListener('dragover', handleDragOver);
        
        // 拖拽进入
        node.addEventListener('dragenter', handleDragEnter);
        
        // 拖拽离开
        node.addEventListener('dragleave', handleDragLeave);
        
        // 放下
        node.addEventListener('drop', handleDrop);
        
        // 拖拽结束
        node.addEventListener('dragend', handleDragEnd);
    });
    
    console.log('[拖拽] 绑定拖拽事件:', draggableNodes.length, '个节点');
}

// 拖拽开始
function handleDragStart(e) {
    draggedNode = e.currentTarget;
    draggedNodeId = draggedNode?.dataset?.nodeId;
    
    // 获取被拖动节点的父级（tree-node 容器）
    draggedNodeParent = draggedNode.parentElement;
    
    // 获取同级节点中相邻的上下节点
    // tree-item 的上一个兄弟是 tree-children 或另一个 tree-node
    // 需要找到前一个 tree-item 和后一个 tree-item
    let prevSibling = draggedNodeParent?.previousElementSibling;
    let nextSibling = draggedNodeParent?.nextElementSibling;
    
    // 如果前一个是 tree-children，继续往前找
    while (prevSibling && prevSibling.classList.contains('tree-children')) {
        prevSibling = prevSibling.previousElementSibling;
    }
    
    // 如果后一个是 tree-children，继续往后找
    while (nextSibling && nextSibling.classList.contains('tree-children')) {
        nextSibling = nextSibling.nextElementSibling;
    }
    
    // 找到前一个节点的 tree-item
    draggedNodePrev = prevSibling?.querySelector('.tree-item') || null;
    
    // 后一个节点的 tree-item 就是 nextSibling（如果存在的话）
    draggedNodeNext = nextSibling?.classList.contains('tree-node') ? 
        nextSibling.querySelector('.tree-item') : null;
    
    // 设置拖拽数据
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedNodeId);
    
    // 添加拖拽样式
    draggedNode.classList.add('dragging');
    
    console.log('[拖拽] ===== 开始拖拽 =====');
    console.log('[拖拽] 被拖动节点ID:', draggedNodeId);
    console.log('[拖拽] 被拖动节点标题:', draggedNode?.dataset?.nodeTitle);
    console.log('[拖拽] 上一个同级节点ID:', draggedNodePrev?.dataset?.nodeId);
    console.log('[拖拽] 下一个同级节点ID:', draggedNodeNext?.dataset?.nodeId);
    
    // 启动自动滚动检测
    startAutoScroll();
}

// 拖拽经过
function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const targetNode = e.currentTarget;
    const targetNodeId = targetNode?.dataset?.nodeId;
    
    e.dataTransfer.dropEffect = 'move';
    
    // 显示拖拽指示器（包含屏蔽逻辑）
    showDropIndicator(targetNode, e);
    
    // 更新自动滚动
    updateAutoScroll(e);
}

// 拖拽进入
function handleDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const targetNode = e.currentTarget;
    if (targetNode !== draggedNode && !isDescendant(targetNode, draggedNode)) {
        targetNode.classList.add('drag-over');
    }

    // 悬停自动展开文件夹（提升可用性）
    try {
        clearTimeout(hoverExpandTimer);
    } catch(_) {}
    if (targetNode.dataset.nodeType === 'folder') {
        hoverExpandTimer = setTimeout(() => {
            try {
                const children = targetNode.nextElementSibling;
                const toggle = targetNode.querySelector('.tree-toggle');
                if (children && children.classList.contains('tree-children') && !children.classList.contains('expanded')) {
                    children.classList.add('expanded');
                    if (toggle) toggle.classList.add('expanded');
                }
            } catch(_) {}
        }, 400);
    }
}

// 拖拽离开
function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const targetNode = e.currentTarget;
    targetNode.classList.remove('drag-over');
    try { clearTimeout(hoverExpandTimer); } catch(_) {}
}

// 放下
async function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const targetNode = e.currentTarget;
    targetNode.classList.remove('drag-over');
    
    const targetNodeId = targetNode.dataset.nodeId;
    const targetIsFolder = targetNode.dataset.nodeType === 'folder';
    
    console.log('[拖拽] 放下:', {
        from: draggedNodeId,
        to: targetNodeId,
        targetIsFolder
    });
    
    // 隐藏拖拽指示器
    hideDropIndicator();
    
    // 执行移动（移除验证，让Chrome API处理）
    await moveBookmark(draggedNodeId, targetNodeId, targetIsFolder, e);
}

// 拖拽结束
function handleDragEnd(e) {
    // 移除拖拽样式
    if (draggedNode) {
        draggedNode.classList.remove('dragging');
    }
    
    // 移除所有drag-over样式
    document.querySelectorAll('.drag-over').forEach(node => {
        node.classList.remove('drag-over');
    });
    
    // 隐藏拖拽指示器
    hideDropIndicator();
    
    // 停止自动滚动
    stopAutoScroll();
    
    draggedNode = null;
    draggedNodeId = null;
    draggedNodeParent = null;
    draggedNodePrev = null;
    draggedNodeNext = null;
    
    console.log('[拖拽] 拖拽结束');
}

// 显示拖拽指示器
function showDropIndicator(targetNode, e) {
    if (!dropIndicator) return;
    
    const rect = targetNode.getBoundingClientRect();
    const mouseY = e.clientY;
    const targetMiddle = rect.top + rect.height / 2;
    
    // 判断放置位置：上方、内部还是下方
    let position;
    // 增加边缘检测敏感度，使同级移动更容易准确
    const minBand = 6; // 减小最小边缘带高度，提高灵敏度
    const threshold = Math.max(minBand, Math.min(rect.height / 4, 12)); // 调整为1/4并减小上限
    
    // 使用基于 data-node-id 的比较（比 DOM 元素引用更可靠）
    const draggedNodeId = draggedNode?.dataset?.nodeId;
    const targetNodeId = targetNode?.dataset?.nodeId;
    const prevNodeId = draggedNodePrev?.dataset?.nodeId;
    const nextNodeId = draggedNodeNext?.dataset?.nodeId;
    
    // 检查目标节点是否是被拖动节点
    const isTargetDraggedNode = draggedNodeId && draggedNodeId === targetNodeId;
    
    // 检查目标节点是否是被拖动节点的子节点
    const isTargetDescendant = draggedNode && isDescendant(targetNode, draggedNode);
    
    // 检查目标节点是否是前一个同级节点
    const isTargetPrev = prevNodeId && prevNodeId === targetNodeId;
    
    // 检查目标节点是否是后一个同级节点
    const isTargetNext = nextNodeId && nextNodeId === targetNodeId;
    
    // 确定是否需要屏蔽以及屏蔽哪个边缘
    let blockBeforeEdge = false;  // 是否屏蔽 before 边缘
    let blockAfterEdge = false;   // 是否屏蔽 after 边缘
    
    if (isTargetDraggedNode || isTargetDescendant) {
        // 屏蔽被拖动节点和其子节点的所有上下边缘
        blockBeforeEdge = true;
        blockAfterEdge = true;
        console.log('[拖拽指示器] 屏蔽被拖节点的所有上下边缘');
    } else if (isTargetPrev) {
        // 屏蔽前一个同级节点的下边缘 (after)
        blockAfterEdge = true;
        console.log('[拖拽指示器] 屏蔽前一个同级节点的下边缘');
    } else if (isTargetNext) {
        // 屏蔽后一个同级节点的上边缘 (before)
        blockBeforeEdge = true;
        console.log('[拖拽指示器] 屏蔽后一个同级节点的上边缘');
    }
    
    // 允许任意位置放置
    const allowInside = true;

    // 根据屏蔽规则确定最终位置
    if (mouseY < rect.top + threshold) {
        // 鼠标在上边缘
        position = blockBeforeEdge ? 'inside' : 'before';
    } else if (mouseY > rect.bottom - threshold) {
        // 鼠标在下边缘
        position = blockAfterEdge ? 'inside' : 'after';
    } else {
        // 鼠标在中间
        position = 'inside';
    }
    
    // 如果上下边缘都被屏蔽，强制为 inside
    if (blockBeforeEdge && blockAfterEdge && (mouseY < rect.top + threshold || mouseY > rect.bottom - threshold)) {
        position = 'inside';
    }
    
    // 设置指示器位置
    if (position === 'before') {
        console.log('[拖拽指示器] 显示 before 线条');
        dropIndicator.style.top = (rect.top + window.scrollY) + 'px';
        dropIndicator.style.left = rect.left + 'px';
        dropIndicator.style.width = rect.width + 'px';
        dropIndicator.style.height = '2px';
        dropIndicator.style.display = 'block';
        dropIndicator.style.visibility = 'visible';
        dropIndicator.style.pointerEvents = 'auto';
        // 添加闪烁效果提示可以吸附
        dropIndicator.classList.add('flashing');
    } else if (position === 'after') {
        console.log('[拖拽指示器] 显示 after 线条');
        dropIndicator.style.top = (rect.bottom + window.scrollY) + 'px';
        dropIndicator.style.left = rect.left + 'px';
        dropIndicator.style.width = rect.width + 'px';
        dropIndicator.style.height = '2px';
        dropIndicator.style.display = 'block';
        dropIndicator.style.visibility = 'visible';
        dropIndicator.style.pointerEvents = 'auto';
        // 添加闪烁效果提示可以吸附
        dropIndicator.classList.add('flashing');
    } else {
        // inside - 隐藏线条
        console.log('[拖拽指示器] 屏蔽线条（inside 位置）');
        dropIndicator.style.display = 'none';
        dropIndicator.style.visibility = 'hidden';
        dropIndicator.style.pointerEvents = 'none';
        // 隐藏时移除闪烁效果
        dropIndicator.classList.remove('flashing');
    }
    
    // 保存位置信息
    dropIndicator.dataset.position = position;
}

// 隐藏拖拽指示器
function hideDropIndicator() {
    if (dropIndicator) {
        dropIndicator.style.display = 'none';
    }
}

// 检查是否是后代节点
function isDescendant(potentialDescendant, ancestor) {
    let node = potentialDescendant.parentElement;
    while (node) {
        if (node === ancestor) return true;
        node = node.parentElement;
    }
    return false;
}

// 移动书签
async function moveBookmark(sourceId, targetId, targetIsFolder, e) {
    if (!chrome || !chrome.bookmarks) {
        console.warn('[拖拽] Chrome扩展环境不可用');
        return;
    }
    
    try {
        // 获取源节点和目标节点信息
        const [sourceNode] = await chrome.bookmarks.get(sourceId);
        const [targetNode] = await chrome.bookmarks.get(targetId);
        
        const position = dropIndicator.dataset.position;
        
        console.log('[拖拽] 移动书签:', {
            source: sourceNode.title,
            target: targetNode.title,
            position
        });
        
        if (position === 'inside') {
            // 移动到文件夹内部
            await chrome.bookmarks.move(sourceId, {
                parentId: targetId
            });
        } else {
            // 移动到目标节点之前或之后
            const targetIndex = targetNode.index;
            const newIndex = position === 'before' ? targetIndex : targetIndex + 1;
            
            await chrome.bookmarks.move(sourceId, {
                parentId: targetNode.parentId,
                index: newIndex
            });
        }
        
        // 标记这个被直接拖拽的对象（永久标记，不设过期时间）
        try {
            if (typeof explicitMovedIds !== 'undefined') {
                // 使用Infinity表示永久标记，这样只有被主动拖拽的对象会显示蓝色标识
                explicitMovedIds.set(sourceId, Date.now() + Infinity);
            }
        } catch(_) {}
        
    } catch (error) {
        // 静默处理错误（例如系统根文件夹无法移动），不弹出alert
        console.debug('[拖拽] 移动操作信息:', error.message);
    }
}

// 启动自动滚动
function startAutoScroll() {
    if (autoScrollInterval) return;
    
    autoScrollInterval = setInterval(() => {
        // 由 updateAutoScroll 控制实际滚动
    }, 10); // 100fps，更高的帧率提供更流畅的拖拽体验
}

// 更新自动滚动
function updateAutoScroll(e) {
    const scrollZone = 40; // 触发滚动的边缘区域大小，减小触发区域
    const scrollSpeed = 15; // 滚动速度，增加到15使滚动更快更流畅
    
    const viewportHeight = window.innerHeight;
    const mouseY = e.clientY;
    
    let scrollDelta = 0;
    
    // 检查是否在顶部边缘
    if (mouseY < scrollZone) {
        scrollDelta = -scrollSpeed * ((scrollZone - mouseY) / scrollZone);
    }
    // 检查是否在底部边缘
    else if (mouseY > viewportHeight - scrollZone) {
        scrollDelta = scrollSpeed * ((mouseY - (viewportHeight - scrollZone)) / scrollZone);
    }
    
    // 执行滚动
    if (scrollDelta !== 0) {
        const now = Date.now();
        // 限制滚动频率，提高为100fps
        if (now - lastScrollTime > 10) {
            window.scrollBy(0, scrollDelta);
            
            // 如果在树容器内，也滚动树容器
            const treeContainer = document.getElementById('bookmarkTree');
            if (treeContainer) {
                const rect = treeContainer.getBoundingClientRect();
                if (e.clientX >= rect.left && e.clientX <= rect.right &&
                    e.clientY >= rect.top && e.clientY <= rect.bottom) {
                    treeContainer.scrollTop += scrollDelta;
                }
            }
            
            lastScrollTime = now;
        }
    }
}

// 停止自动滚动
function stopAutoScroll() {
    if (autoScrollInterval) {
        clearInterval(autoScrollInterval);
        autoScrollInterval = null;
    }
}

// 刷新书签树
async function refreshBookmarkTree() {
    if (typeof renderTreeView === 'function') {
        await renderTreeView(true);
    }
}

// 导出函数
if (typeof window !== 'undefined') {
    window.initDragDrop = initDragDrop;
    window.attachDragEvents = attachDragEvents;
}
