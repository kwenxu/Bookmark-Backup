// 书签树拖拽功能
// 支持拖拽移动书签和文件夹

// 全局变量
let draggedNode = null;
let draggedNodeId = null;
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
    draggedNodeId = draggedNode.dataset.nodeId;
    
    // 设置拖拽数据
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedNodeId);
    
    // 添加拖拽样式
    draggedNode.classList.add('dragging');
    
    console.log('[拖拽] 开始拖拽:', draggedNodeId, draggedNode.dataset.nodeTitle);
    
    // 启动自动滚动检测
    startAutoScroll();
}

// 拖拽经过
function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    
    // 不能拖到自己上
    const targetNode = e.currentTarget;
    if (targetNode === draggedNode) {
        e.dataTransfer.dropEffect = 'none';
        return;
    }
    
    // 不能拖到自己的子节点上
    if (isDescendant(targetNode, draggedNode)) {
        e.dataTransfer.dropEffect = 'none';
        return;
    }
    
    e.dataTransfer.dropEffect = 'move';
    
    // 显示拖拽指示器
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
    
    // 不能拖到自己上
    if (targetNode === draggedNode) return;
    
    // 不能拖到自己的子节点上
    if (isDescendant(targetNode, draggedNode)) return;
    
    const targetNodeId = targetNode.dataset.nodeId;
    const targetIsFolder = targetNode.dataset.nodeType === 'folder';
    
    console.log('[拖拽] 放下:', {
        from: draggedNodeId,
        to: targetNodeId,
        targetIsFolder
    });
    
    // 隐藏拖拽指示器
    hideDropIndicator();
    
    // 执行移动
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
    // 扩大上下边缘的可投放区域（同级移动更容易）
    const minBand = 12; // 最小边缘带高度
    const threshold = Math.max(minBand, Math.min(rect.height / 3, 24));
    
    const allowInside = (targetNode.dataset.nodeType === 'folder') && rect.height >= 30;

    if (mouseY < rect.top + threshold) {
        position = 'before';
    } else if (mouseY > rect.bottom - threshold) {
        position = 'after';
    } else {
        position = allowInside ? 'inside' : (mouseY < targetMiddle ? 'before' : 'after');
    }
    
    // 如果目标不是文件夹，不能放到内部
    if (position === 'inside' && targetNode.dataset.nodeType !== 'folder') {
        position = mouseY < targetMiddle ? 'before' : 'after';
    }
    
    // 设置指示器位置
    if (position === 'before') {
        dropIndicator.style.top = (rect.top + window.scrollY) + 'px';
        dropIndicator.style.left = rect.left + 'px';
        dropIndicator.style.width = rect.width + 'px';
        dropIndicator.style.height = '2px';
        dropIndicator.style.display = 'block';
    } else if (position === 'after') {
        dropIndicator.style.top = (rect.bottom + window.scrollY) + 'px';
        dropIndicator.style.left = rect.left + 'px';
        dropIndicator.style.width = rect.width + 'px';
        dropIndicator.style.height = '2px';
        dropIndicator.style.display = 'block';
    } else {
        // inside - 高亮整个节点，不显示线条
        dropIndicator.style.display = 'none';
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
        alert('此功能需要Chrome扩展环境');
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
        
        // 立刻触发蓝色移动标识（无需等待事件返回）
        try {
            if (typeof explicitMovedIds !== 'undefined') {
                explicitMovedIds.set(sourceId, Date.now() + 5000);
            }
        } catch(_) {}
        
    } catch (error) {
        console.error('[拖拽] 移动失败:', error);
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? `移动失败: ${error.message}` : `Move failed: ${error.message}`);
    }
}

// 启动自动滚动
function startAutoScroll() {
    if (autoScrollInterval) return;
    
    autoScrollInterval = setInterval(() => {
        // 由 updateAutoScroll 控制实际滚动
    }, 16); // 约60fps
}

// 更新自动滚动
function updateAutoScroll(e) {
    const scrollZone = 50; // 触发滚动的边缘区域大小
    const scrollSpeed = 10; // 滚动速度
    
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
        // 限制滚动频率
        if (now - lastScrollTime > 16) { // 约60fps
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
