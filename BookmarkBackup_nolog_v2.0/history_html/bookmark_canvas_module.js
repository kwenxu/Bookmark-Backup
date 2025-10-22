// =============================================================================
// Bookmark Canvas Module - 基于原有Bookmark Tree改造的Canvas功能
// =============================================================================

// Canvas状态管理
const CanvasState = {
    tempNodes: [],
    tempNodeCounter: 0,
    dragState: {
        isDragging: false,
        draggedElement: null,
        draggedData: null,
        dragStartX: 0,
        dragStartY: 0,
        nodeStartX: 0,
        nodeStartY: 0,
        dragSource: null // 'permanent' or 'temporary'
    },
    // 画布缩放和平移
    zoom: 1,
    panOffsetX: 0,
    panOffsetY: 0,
    isPanning: false,
    panStartX: 0,
    panStartY: 0,
    isSpacePressed: false
};

// =============================================================================
// 初始化Canvas视图
// =============================================================================

function initCanvasView() {
    console.log('[Canvas] 初始化Obsidian风格的Canvas');
    
    // 显示缩放控制器
    const zoomIndicator = document.getElementById('canvasZoomIndicator');
    if (zoomIndicator) {
        zoomIndicator.style.display = 'block';
    }
    
    // 注意：永久栏目已经在renderCurrentView中从template创建并添加到canvas-content
    // bookmarkTree已经由renderTreeView()渲染了
    // 我们只需要增强它的拖拽功能
    
    enhanceBookmarkTreeForCanvas();
    
    // 让永久栏目可以拖动
    makePermanentSectionDraggable();
    
    // 设置Canvas缩放和平移
    setupCanvasZoomAndPan();
    
    // 加载临时节点
    loadTempNodes();
    
    // 设置Canvas事件监听
    setupCanvasEventListeners();
    
    // 设置永久栏目提示关闭按钮
    setupPermanentSectionTipClose();
}

// =============================================================================
// 增强现有书签树的Canvas拖拽功能
// =============================================================================

function enhanceBookmarkTreeForCanvas() {
    const bookmarkTree = document.getElementById('bookmarkTree');
    if (!bookmarkTree) return;
    
    console.log('[Canvas] 为书签树添加Canvas拖拽功能');
    
    // 为所有书签项添加拖拽功能
    const bookmarkItems = bookmarkTree.querySelectorAll('.bookmark-item');
    bookmarkItems.forEach(item => {
        item.draggable = true;
        item.addEventListener('dragstart', handleExistingBookmarkDragStart);
        item.addEventListener('dragend', handlePermanentDragEnd);
    });
    
    // 为所有文件夹添加拖拽功能
    const folderHeaders = bookmarkTree.querySelectorAll('.folder-header');
    folderHeaders.forEach(header => {
        header.draggable = true;
        header.addEventListener('dragstart', handleExistingFolderDragStart);
        header.addEventListener('dragend', handlePermanentDragEnd);
    });
}

function handleExistingBookmarkDragStart(e) {
    const item = e.currentTarget;
    const bookmarkData = {
        id: item.dataset.bookmarkId,
        title: item.querySelector('.bookmark-title')?.textContent || item.dataset.title,
        url: item.dataset.url
    };
    
    CanvasState.dragState.isDragging = true;
    CanvasState.dragState.draggedData = { ...bookmarkData, type: 'bookmark' };
    CanvasState.dragState.dragSource = 'permanent';
    
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', bookmarkData.title || '');
    e.dataTransfer.setData('application/json', JSON.stringify({ ...bookmarkData, type: 'bookmark' }));
    
    console.log('[Canvas] 开始拖拽书签:', bookmarkData.title);
}

function handleExistingFolderDragStart(e) {
    const header = e.currentTarget;
    const folderItem = header.closest('.folder-item');
    
    // 收集文件夹数据
    const folderData = {
        id: folderItem.dataset.folderId,
        title: header.querySelector('.folder-title')?.textContent || '未命名文件夹',
        children: []
    };
    
    // 收集子项
    const childItems = folderItem.querySelectorAll(':scope > .folder-children > .bookmark-item');
    childItems.forEach(child => {
        folderData.children.push({
            id: child.dataset.bookmarkId,
            title: child.querySelector('.bookmark-title')?.textContent,
            url: child.dataset.url
        });
    });
    
    CanvasState.dragState.isDragging = true;
    CanvasState.dragState.draggedData = { ...folderData, type: 'folder' };
    CanvasState.dragState.dragSource = 'permanent';
    
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', folderData.title);
    e.dataTransfer.setData('application/json', JSON.stringify({ ...folderData, type: 'folder' }));
    
    console.log('[Canvas] 开始拖拽文件夹:', folderData.title);
}

function createCanvasBookmarkElement(bookmark, isDraggable = true) {
    if (bookmark.url) {
        return createCanvasBookmarkItem(bookmark, isDraggable);
    } else {
        return createCanvasFolderItem(bookmark, isDraggable);
    }
}

function createCanvasBookmarkItem(bookmark, isDraggable) {
    const item = document.createElement('div');
    item.className = 'canvas-bookmark-item' + (isDraggable ? ' draggable' : '');
    item.dataset.bookmarkId = bookmark.id;
    item.dataset.bookmarkTitle = bookmark.title;
    item.dataset.bookmarkUrl = bookmark.url;
    
    // 图标
    const icon = document.createElement('img');
    icon.className = 'canvas-bookmark-icon';
    icon.src = getFaviconUrl(bookmark.url);
    icon.onerror = () => {
        icon.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23999"%3E%3Cpath d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"%3E%3C/path%3E%3C/svg%3E';
    };
    
    // 标题
    const title = document.createElement('span');
    title.className = 'canvas-bookmark-title';
    title.textContent = bookmark.title || bookmark.url;
    title.title = bookmark.title || bookmark.url;
    
    item.appendChild(icon);
    item.appendChild(title);
    
    // 点击打开链接
    item.addEventListener('click', (e) => {
        if (!CanvasState.dragState.isDragging && bookmark.url) {
            window.open(bookmark.url, '_blank');
        }
    });
    
    // 添加拖拽事件
    if (isDraggable) {
        item.draggable = true;
        item.addEventListener('dragstart', (e) => handlePermanentDragStart(e, bookmark, 'bookmark'));
        item.addEventListener('dragend', handlePermanentDragEnd);
    }
    
    return item;
}

function createCanvasFolderItem(folder, isDraggable) {
    const item = document.createElement('div');
    item.className = 'canvas-folder-item';
    item.dataset.folderId = folder.id;
    item.dataset.folderTitle = folder.title;
    
    // 文件夹头部
    const header = document.createElement('div');
    header.className = 'canvas-folder-header';
    
    // 图标
    const icon = document.createElement('i');
    icon.className = 'fas fa-folder canvas-folder-icon';
    
    // 标题
    const title = document.createElement('span');
    title.className = 'canvas-folder-title';
    title.textContent = folder.title || '未命名文件夹';
    
    header.appendChild(icon);
    header.appendChild(title);
    
    // 子节点容器
    const children = document.createElement('div');
    children.className = 'canvas-folder-children';
    
    if (folder.children) {
        folder.children.forEach(child => {
            const childElement = createCanvasBookmarkElement(child, isDraggable);
            children.appendChild(childElement);
        });
    }
    
    // 点击展开/折叠
    header.addEventListener('click', (e) => {
        if (!CanvasState.dragState.isDragging) {
            children.classList.toggle('collapsed');
            icon.classList.toggle('fa-folder');
            icon.classList.toggle('fa-folder-open');
        }
    });
    
    // 文件夹拖拽
    if (isDraggable) {
        header.draggable = true;
        header.addEventListener('dragstart', (e) => handlePermanentDragStart(e, folder, 'folder'));
        header.addEventListener('dragend', handlePermanentDragEnd);
    }
    
    item.appendChild(header);
    item.appendChild(children);
    
    return item;
}

// =============================================================================
// Canvas 缩放和平移功能
// =============================================================================


function setupCanvasZoomAndPan() {
    const workspace = document.getElementById('canvasWorkspace');
    const container = document.querySelector('.canvas-main-container');
    
    if (!workspace || !container) {
        console.warn('[Canvas] 找不到workspace或container元素');
        return;
    }
    
    console.log('[Canvas] 设置Obsidian风格的缩放和平移功能');
    
    // 加载保存的缩放级别
    loadCanvasZoom();
    
    // Ctrl + 滚轮缩放（以鼠标位置为中心）
    workspace.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            
            // 获取鼠标在viewport中的位置
            const rect = workspace.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            // 计算鼠标在canvas内容中的实际位置（考虑当前缩放和平移）
            const canvasX = (mouseX - CanvasState.panOffsetX) / CanvasState.zoom;
            const canvasY = (mouseY - CanvasState.panOffsetY) / CanvasState.zoom;
            
            // 计算新的缩放级别
            const delta = -e.deltaY;
            const zoomSpeed = 0.001;
            const oldZoom = CanvasState.zoom;
            const newZoom = Math.max(0.1, Math.min(3, oldZoom + delta * zoomSpeed));
            
            // 应用新的缩放
            setCanvasZoom(newZoom);
            
            // 调整平移偏移，使鼠标位置保持在canvas中的相同点
            CanvasState.panOffsetX = mouseX - canvasX * newZoom;
            CanvasState.panOffsetY = mouseY - canvasY * newZoom;
            applyPanOffset();
        }
    }, { passive: false });
    
    // 空格键按下 - 启用拖动模式
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && !e.repeat && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
            e.preventDefault();
            CanvasState.isSpacePressed = true;
            workspace.classList.add('space-pressed');
        }
    });
    
    document.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            CanvasState.isSpacePressed = false;
            workspace.classList.remove('space-pressed');
            if (CanvasState.isPanning) {
                CanvasState.isPanning = false;
                workspace.classList.remove('panning');
            }
        }
    });
    
    // 空格 + 鼠标拖动画布（Obsidian方式）
    workspace.addEventListener('mousedown', (e) => {
        if (CanvasState.isSpacePressed) {
            e.preventDefault();
            CanvasState.isPanning = true;
            CanvasState.panStartX = e.clientX - CanvasState.panOffsetX;
            CanvasState.panStartY = e.clientY - CanvasState.panOffsetY;
            workspace.classList.add('panning');
        }
    });
    
    document.addEventListener('mousemove', (e) => {
        if (CanvasState.isPanning) {
            CanvasState.panOffsetX = e.clientX - CanvasState.panStartX;
            CanvasState.panOffsetY = e.clientY - CanvasState.panStartY;
            
            applyPanOffset();
        }
    });
    
    document.addEventListener('mouseup', () => {
        if (CanvasState.isPanning) {
            CanvasState.isPanning = false;
            workspace.classList.remove('panning');
            savePanOffset();
        }
    });
    
    // 缩放按钮
    const zoomInBtn = document.getElementById('zoomInBtn');
    const zoomOutBtn = document.getElementById('zoomOutBtn');
    const zoomLocateBtn = document.getElementById('zoomLocateBtn');
    
    if (zoomInBtn) zoomInBtn.addEventListener('click', () => setCanvasZoom(CanvasState.zoom + 0.1));
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => setCanvasZoom(CanvasState.zoom - 0.1));
    if (zoomLocateBtn) zoomLocateBtn.addEventListener('click', locateToPermanentSection);
}

function setCanvasZoom(zoom) {
    const container = document.querySelector('.canvas-main-container');
    if (!container) return;
    
    // 限制缩放范围
    zoom = Math.max(0.1, Math.min(3, zoom));
    CanvasState.zoom = zoom;
    
    // 使用CSS变量应用缩放（Obsidian方式）
    container.style.setProperty('--canvas-scale', zoom);
    
    // 更新显示
    const zoomValue = document.getElementById('zoomValue');
    if (zoomValue) {
        zoomValue.textContent = Math.round(zoom * 100) + '%';
    }
    
    // 保存缩放级别
    localStorage.setItem('canvas-zoom', zoom.toString());
    
    console.log('[Canvas] 缩放:', Math.round(zoom * 100) + '%');
}

function applyPanOffset() {
    const container = document.querySelector('.canvas-main-container');
    if (!container) return;
    
    container.style.setProperty('--canvas-pan-x', `${CanvasState.panOffsetX}px`);
    container.style.setProperty('--canvas-pan-y', `${CanvasState.panOffsetY}px`);
}

function loadCanvasZoom() {
    try {
        const saved = localStorage.getItem('canvas-zoom');
        if (saved) {
            const zoom = parseFloat(saved);
            if (!isNaN(zoom)) {
                setCanvasZoom(zoom);
            }
        }
        
        // 加载平移位置
        const panData = localStorage.getItem('canvas-pan');
        if (panData) {
            const pan = JSON.parse(panData);
            CanvasState.panOffsetX = pan.x || 0;
            CanvasState.panOffsetY = pan.y || 0;
            applyPanOffset();
        }
    } catch (error) {
        console.error('[Canvas] 加载画布状态失败:', error);
    }
}

function savePanOffset() {
    localStorage.setItem('canvas-pan', JSON.stringify({
        x: CanvasState.panOffsetX,
        y: CanvasState.panOffsetY
    }));
}

// =============================================================================
// 定位到永久栏目
// =============================================================================

function locateToPermanentSection() {
    const permanentSection = document.getElementById('permanentSection');
    const workspace = document.getElementById('canvasWorkspace');
    
    if (!permanentSection || !workspace) {
        console.warn('[Canvas] 找不到永久栏目或工作区');
        return;
    }
    
    // 获取永久栏目的位置和尺寸（在canvas-content坐标系中）
    const sectionLeft = parseFloat(permanentSection.style.left) || 0;
    const sectionTop = parseFloat(permanentSection.style.top) || 0;
    const sectionWidth = permanentSection.offsetWidth;
    const sectionHeight = permanentSection.offsetHeight;
    
    // 获取workspace的尺寸
    const workspaceWidth = workspace.clientWidth;
    const workspaceHeight = workspace.clientHeight;
    
    // 计算永久栏目的中心点（在canvas-content坐标系中）
    const sectionCenterX = sectionLeft + sectionWidth / 2;
    const sectionCenterY = sectionTop + sectionHeight / 2;
    
    // 计算需要的平移量，使永久栏目居中显示
    // 公式：panOffset = workspace中心 - (section中心 * zoom)
    CanvasState.panOffsetX = workspaceWidth / 2 - sectionCenterX * CanvasState.zoom;
    CanvasState.panOffsetY = workspaceHeight / 2 - sectionCenterY * CanvasState.zoom;
    
    // 应用平移
    applyPanOffset();
    savePanOffset();
    
    console.log('[Canvas] 定位到永久栏目:', {
        sectionCenter: { x: sectionCenterX, y: sectionCenterY },
        panOffset: { x: CanvasState.panOffsetX, y: CanvasState.panOffsetY }
    });
}

// =============================================================================
// 让永久栏目本身可以拖动
// =============================================================================

function makePermanentSectionDraggable() {
    const permanentSection = document.getElementById('permanentSection');
    const header = document.getElementById('permanentSectionHeader');
    
    if (!permanentSection || !header) {
        console.warn('[Canvas] 找不到永久栏目元素');
        return;
    }
    
    console.log('[Canvas] 为永久栏目添加拖拽功能');
    
    // 初始化位置：如果使用transform居中，转换为left/top形式，避免第一次拖动跳动
    initializePermanentSectionPosition(permanentSection);
    
    // 添加resize功能
    makePermanentSectionResizable(permanentSection);
    
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;
    let hasMoved = false;
    
    const onMouseDown = (e) => {
        // 不要在关闭按钮、提示文本上触发拖动
        if (e.target.closest('.permanent-section-tip-close') || 
            e.target.closest('.permanent-section-tip-container')) {
            return;
        }
        
        // 只允许在标题区域拖动
        if (!e.target.closest('.permanent-section-header')) {
            return;
        }
        
        isDragging = true;
        hasMoved = false;
        startX = e.clientX;
        startY = e.clientY;
        
        // 获取当前在canvas-content坐标系中的位置
        const currentLeft = parseFloat(permanentSection.style.left) || 0;
        const currentTop = parseFloat(permanentSection.style.top) || 0;
        
        initialLeft = currentLeft;
        initialTop = currentTop;
        
        permanentSection.classList.add('dragging');
        permanentSection.style.transform = 'none';
        permanentSection.style.transition = 'none';
        
        // 立即响应，不阻止默认行为可能更灵敏
        e.preventDefault();
    };
    
    const onMouseMove = (e) => {
        if (!isDragging) return;
        
        // 计算鼠标在屏幕上的移动距离
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        
        // 降低移动阈值，提高灵敏度
        if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
            hasMoved = true;
        }
        
        // 除以缩放比例得到在canvas-content坐标系中的实际移动距离
        const scaledDeltaX = deltaX / CanvasState.zoom;
        const scaledDeltaY = deltaY / CanvasState.zoom;
        
        // 计算新位置
        const newX = initialLeft + scaledDeltaX;
        const newY = initialTop + scaledDeltaY;
        
        // 直接更新位置，不使用requestAnimationFrame提高响应速度
        permanentSection.style.left = newX + 'px';
        permanentSection.style.top = newY + 'px';
        
        // 阻止文本选择
        e.preventDefault();
    };
    
    const onMouseUp = () => {
        if (isDragging) {
            isDragging = false;
            permanentSection.classList.remove('dragging');
            
            if (hasMoved) {
                // 保存位置
                savePermanentSectionPosition();
            }
            
            hasMoved = false;
        }
    };
    
    // 使用捕获阶段确保事件优先处理，mousemove用冒泡阶段提高性能
    header.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mousemove', onMouseMove, false);
    document.addEventListener('mouseup', onMouseUp, true);
}

function savePermanentSectionPosition() {
    const permanentSection = document.getElementById('permanentSection');
    if (!permanentSection) return;
    
    const position = {
        left: permanentSection.style.left,
        top: permanentSection.style.top,
        width: permanentSection.style.width,
        height: permanentSection.style.height
    };
    
    localStorage.setItem('permanent-section-position', JSON.stringify(position));
    console.log('[Canvas] 保存永久栏目位置和大小:', position);
}

function loadPermanentSectionPosition() {
    try {
        const saved = localStorage.getItem('permanent-section-position');
        if (saved) {
            const position = JSON.parse(saved);
            const permanentSection = document.getElementById('permanentSection');
            if (permanentSection) {
                permanentSection.style.transition = 'none';
                permanentSection.style.transform = 'none';
                permanentSection.style.left = position.left;
                permanentSection.style.top = position.top;
                if (position.width) permanentSection.style.width = position.width;
                if (position.height) permanentSection.style.height = position.height;
                console.log('[Canvas] 恢复永久栏目位置和大小:', position);
                
                // 强制重排后恢复transition
                permanentSection.offsetHeight;
                permanentSection.style.transition = '';
            }
        }
    } catch (error) {
        console.error('[Canvas] 加载永久栏目位置失败:', error);
    }
}

// 初始化永久栏目位置：转换transform为left/top，避免第一次拖动跳动
function initializePermanentSectionPosition(permanentSection) {
    if (!permanentSection) return;
    
    // 如果已经有left/top设置，说明已经初始化过了
    if (permanentSection.style.left && permanentSection.style.top) {
        return;
    }
    
    // 获取当前的计算位置（使用transform居中）
    const rect = permanentSection.getBoundingClientRect();
    const workspace = document.getElementById('canvasWorkspace');
    if (!workspace) return;
    
    const workspaceRect = workspace.getBoundingClientRect();
    
    // 计算在canvas-content坐标系中的位置
    const left = (rect.left - workspaceRect.left) / CanvasState.zoom;
    const top = (rect.top - workspaceRect.top) / CanvasState.zoom;
    
    // 禁用过渡，设置新位置
    permanentSection.style.transition = 'none';
    permanentSection.style.transform = 'none';
    permanentSection.style.left = left + 'px';
    permanentSection.style.top = top + 'px';
    
    // 强制重排后恢复transition
    permanentSection.offsetHeight;
    permanentSection.style.transition = '';
    
    console.log('[Canvas] 初始化永久栏目位置:', { left, top });
}

// =============================================================================
// 永久栏目和临时节点Resize功能
// =============================================================================

function makePermanentSectionResizable(element) {
    // 创建8个resize handles
    const handles = [
        { name: 'nw', cursor: 'nw-resize', position: 'top-left' },
        { name: 'n', cursor: 'n-resize', position: 'top' },
        { name: 'ne', cursor: 'ne-resize', position: 'top-right' },
        { name: 'e', cursor: 'e-resize', position: 'right' },
        { name: 'se', cursor: 'se-resize', position: 'bottom-right' },
        { name: 's', cursor: 's-resize', position: 'bottom' },
        { name: 'sw', cursor: 'sw-resize', position: 'bottom-left' },
        { name: 'w', cursor: 'w-resize', position: 'left' }
    ];
    
    handles.forEach(handleInfo => {
        const handle = document.createElement('div');
        handle.className = `resize-handle resize-handle-${handleInfo.name}`;
        handle.style.cssText = getResizeHandleStyle(handleInfo);
        element.appendChild(handle);
        
        let isResizing = false;
        let startX, startY, startWidth, startHeight, startLeft, startTop;
        
        handle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startWidth = element.offsetWidth;
            startHeight = element.offsetHeight;
            startLeft = parseFloat(element.style.left) || 0;
            startTop = parseFloat(element.style.top) || 0;
            
            element.classList.add('resizing');
            
            const onMouseMove = (e) => {
                if (!isResizing) return;
                
                // 计算鼠标移动距离（考虑缩放）
                const deltaX = (e.clientX - startX) / CanvasState.zoom;
                const deltaY = (e.clientY - startY) / CanvasState.zoom;
                
                // 根据handle位置计算新的尺寸和位置
                let newWidth = startWidth;
                let newHeight = startHeight;
                let newLeft = startLeft;
                let newTop = startTop;
                
                // 处理水平方向
                if (handleInfo.name.includes('e')) {
                    newWidth = Math.max(300, startWidth + deltaX);
                } else if (handleInfo.name.includes('w')) {
                    newWidth = Math.max(300, startWidth - deltaX);
                    newLeft = startLeft + (startWidth - newWidth);
                }
                
                // 处理垂直方向
                if (handleInfo.name.includes('s')) {
                    newHeight = Math.max(200, startHeight + deltaY);
                } else if (handleInfo.name.includes('n')) {
                    newHeight = Math.max(200, startHeight - deltaY);
                    newTop = startTop + (startHeight - newHeight);
                }
                
                // 应用新的尺寸和位置
                element.style.width = newWidth + 'px';
                element.style.height = newHeight + 'px';
                element.style.left = newLeft + 'px';
                element.style.top = newTop + 'px';
                
                // 调整max-height
                element.style.maxHeight = newHeight + 'px';
            };
            
            const onMouseUp = () => {
                if (isResizing) {
                    isResizing = false;
                    element.classList.remove('resizing');
                    savePermanentSectionPosition();
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                }
            };
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    });
}

function getResizeHandleStyle(handleInfo) {
    const baseStyle = 'position: absolute; z-index: 10; background: transparent;';
    const cornerSize = '50px'; // 角手柄更大
    const edgeSize = '10px';   // 边手柄保持原大小
    
    let style = baseStyle + `cursor: ${handleInfo.cursor};`;
    
    // 角handle - 三角形区域，更大范围
    if (handleInfo.name.length === 2) {
        style += `width: ${cornerSize}; height: ${cornerSize};`;
        
        // 使用clip-path创建三角形
        if (handleInfo.name === 'nw') {
            style += 'top: 0; left: 0;';
            style += 'clip-path: polygon(0 0, 100% 0, 0 100%);';
        } else if (handleInfo.name === 'ne') {
            style += 'top: 0; right: 0;';
            style += 'clip-path: polygon(100% 0, 100% 100%, 0 0);';
        } else if (handleInfo.name === 'sw') {
            style += 'bottom: 0; left: 0;';
            style += 'clip-path: polygon(0 0, 0 100%, 100% 100%);';
        } else if (handleInfo.name === 'se') {
            style += 'bottom: 0; right: 0;';
            style += 'clip-path: polygon(100% 0, 100% 100%, 0 100%);';
        }
    }
    // 边handle
    else {
        if (handleInfo.name === 'n' || handleInfo.name === 's') {
            style += 'left: 50px; right: 50px; height: ' + edgeSize + '; background: transparent;';
            if (handleInfo.name === 'n') style += 'top: -5px;';
            else style += 'bottom: -5px;';
        } else {
            style += 'top: 50px; bottom: 50px; width: ' + edgeSize + '; background: transparent;';
            if (handleInfo.name === 'w') style += 'left: -5px;';
            else style += 'right: -5px;';
        }
    }
    
    return style;
}

function makeTempNodeResizable(element, node) {
    // 创建8个resize handles
    const handles = [
        { name: 'nw', cursor: 'nw-resize' },
        { name: 'n', cursor: 'n-resize' },
        { name: 'ne', cursor: 'ne-resize' },
        { name: 'e', cursor: 'e-resize' },
        { name: 'se', cursor: 'se-resize' },
        { name: 's', cursor: 's-resize' },
        { name: 'sw', cursor: 'sw-resize' },
        { name: 'w', cursor: 'w-resize' }
    ];
    
    handles.forEach(handleInfo => {
        const handle = document.createElement('div');
        handle.className = `resize-handle resize-handle-${handleInfo.name}`;
        handle.style.cssText = getResizeHandleStyle(handleInfo);
        element.appendChild(handle);
        
        let isResizing = false;
        let startX, startY, startWidth, startHeight, startLeft, startTop;
        
        handle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startWidth = element.offsetWidth;
            startHeight = element.offsetHeight;
            startLeft = node.x;
            startTop = node.y;
            
            element.classList.add('resizing');
            
            const onMouseMove = (e) => {
                if (!isResizing) return;
                
                // 计算鼠标移动距离（考虑缩放）
                const deltaX = (e.clientX - startX) / CanvasState.zoom;
                const deltaY = (e.clientY - startY) / CanvasState.zoom;
                
                // 根据handle位置计算新的尺寸和位置
                let newWidth = startWidth;
                let newHeight = startHeight;
                let newLeft = startLeft;
                let newTop = startTop;
                
                // 处理水平方向
                if (handleInfo.name.includes('e')) {
                    newWidth = Math.max(200, startWidth + deltaX);
                } else if (handleInfo.name.includes('w')) {
                    newWidth = Math.max(200, startWidth - deltaX);
                    newLeft = startLeft + (startWidth - newWidth);
                }
                
                // 处理垂直方向
                if (handleInfo.name.includes('s')) {
                    newHeight = Math.max(150, startHeight + deltaY);
                } else if (handleInfo.name.includes('n')) {
                    newHeight = Math.max(150, startHeight - deltaY);
                    newTop = startTop + (startHeight - newHeight);
                }
                
                // 应用新的尺寸和位置
                element.style.width = newWidth + 'px';
                element.style.left = newLeft + 'px';
                element.style.top = newTop + 'px';
                
                // 更新节点数据
                node.width = newWidth;
                node.height = newHeight;
                node.x = newLeft;
                node.y = newTop;
            };
            
            const onMouseUp = () => {
                if (isResizing) {
                    isResizing = false;
                    element.classList.remove('resizing');
                    saveTempNodes();
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                }
            };
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    });
}

// =============================================================================
// 拖拽功能 - 从永久栏目拖出
// =============================================================================

function handlePermanentDragStart(e, data, type) {
    CanvasState.dragState.isDragging = true;
    CanvasState.dragState.draggedData = { ...data, type: type };
    CanvasState.dragState.dragSource = 'permanent';
    
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', data.title || '');
    e.dataTransfer.setData('application/json', JSON.stringify({ ...data, type: type }));
    
    // 创建拖拽预览
    const preview = document.createElement('div');
    preview.className = 'drag-preview';
    preview.textContent = data.title || '未命名';
    preview.style.left = '-9999px';
    document.body.appendChild(preview);
    e.dataTransfer.setDragImage(preview, 0, 0);
    setTimeout(() => preview.remove(), 0);
}

function handlePermanentDragEnd(e) {
    if (!CanvasState.dragState.isDragging) return;
    
    const dropX = e.clientX;
    const dropY = e.clientY;
    
    // 检查是否拖到Canvas工作区
    const workspace = document.getElementById('canvasWorkspace');
    const rect = workspace.getBoundingClientRect();
    
    if (dropX >= rect.left && dropX <= rect.right && 
        dropY >= rect.top && dropY <= rect.bottom) {
        
        // 在Canvas上创建临时节点
        const x = dropX - rect.left + workspace.scrollLeft;
        const y = dropY - rect.top + workspace.scrollTop;
        createTempNode(CanvasState.dragState.draggedData, x, y);
    }
    
    CanvasState.dragState.isDragging = false;
    CanvasState.dragState.draggedData = null;
    CanvasState.dragState.dragSource = null;
}

// =============================================================================
// 临时节点管理
// =============================================================================

function createTempNode(data, x, y) {
    const nodeId = `temp-node-${++CanvasState.tempNodeCounter}`;
    
    const node = {
        id: nodeId,
        type: data.type || (data.url ? 'bookmark' : 'folder'),
        x: x,
        y: y,
        width: 250,
        height: 200, // 默认高度
        data: data
    };
    
    CanvasState.tempNodes.push(node);
    renderTempNode(node);
    saveTempNodes();
}

function renderTempNode(node) {
    const container = document.getElementById('canvasContent');
    if (!container) {
        console.warn('[Canvas] 找不到canvasContent容器');
        return;
    }
    
    const nodeElement = document.createElement('div');
    nodeElement.className = 'temp-canvas-node';
    nodeElement.id = node.id;
    
    // 禁用初始transition避免创建时的动画
    nodeElement.style.transition = 'none';
    nodeElement.style.left = node.x + 'px';
    nodeElement.style.top = node.y + 'px';
    nodeElement.style.width = node.width + 'px';
    if (node.height) {
        nodeElement.style.height = node.height + 'px';
    }
    
    // 节点头部
    const header = document.createElement('div');
    header.className = 'temp-node-header';
    
    const title = document.createElement('div');
    title.className = 'temp-node-title';
    title.textContent = node.data.title || '未命名';
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'temp-node-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => removeTempNode(node.id));
    
    header.appendChild(title);
    header.appendChild(closeBtn);
    
    // 节点内容
    const body = document.createElement('div');
    body.className = 'temp-node-body';
    
    // 类型标记
    const badge = document.createElement('div');
    badge.className = 'temp-node-type-badge';
    badge.textContent = node.type === 'bookmark' ? '书签' : '文件夹';
    body.appendChild(badge);
    
    if (node.type === 'bookmark' && node.data.url) {
        const bookmarkItem = createCanvasBookmarkItem(node.data, false);
        body.appendChild(bookmarkItem);
    } else if (node.type === 'folder' && node.data.children) {
        node.data.children.forEach(child => {
            const item = createCanvasBookmarkElement(child, false);
            body.appendChild(item);
        });
    }
    
    nodeElement.appendChild(header);
    nodeElement.appendChild(body);
    
    // 添加拖拽功能
    makeNodeDraggable(nodeElement, node);
    
    // 添加拖回永久栏目功能
    makeNodeDroppableBack(nodeElement, node);
    
    // 添加resize功能
    makeTempNodeResizable(nodeElement, node);
    
    // 添加到容器（使用之前已经声明的container变量）
    container.appendChild(nodeElement);
    
    // 强制重排后恢复transition
    nodeElement.offsetHeight;
    nodeElement.style.transition = '';
}

function makeNodeDraggable(element, node) {
    const header = element.querySelector('.temp-node-header');
    let hasMoved = false;
    
    const onMouseDown = (e) => {
        if (e.target.classList.contains('temp-node-close')) return;
        
        CanvasState.dragState.isDragging = true;
        CanvasState.dragState.draggedElement = element;
        CanvasState.dragState.dragStartX = e.clientX;
        CanvasState.dragState.dragStartY = e.clientY;
        CanvasState.dragState.nodeStartX = node.x;
        CanvasState.dragState.nodeStartY = node.y;
        CanvasState.dragState.dragSource = 'temp-node';
        hasMoved = false;
        
        element.classList.add('dragging');
        element.style.transition = 'none';
        
        e.preventDefault();
    };
    
    header.addEventListener('mousedown', onMouseDown, true);
}

function makeNodeDroppableBack(element, node) {
    const body = element.querySelector('.temp-node-body');
    
    body.draggable = true;
    body.addEventListener('dragstart', (e) => {
        CanvasState.dragState.dragSource = 'temporary';
        CanvasState.dragState.draggedData = node;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/json', JSON.stringify(node));
        
        // 高亮永久栏目
        const permanentSection = document.getElementById('permanentSection');
        if (permanentSection) {
            permanentSection.classList.add('drop-target-highlight');
        }
    });
    
    body.addEventListener('dragend', () => {
        const permanentSection = document.getElementById('permanentSection');
        if (permanentSection) {
            permanentSection.classList.remove('drop-target-highlight');
        }
        CanvasState.dragState.dragSource = null;
    });
}

function removeTempNode(nodeId) {
    const element = document.getElementById(nodeId);
    if (element) {
        element.remove();
    }
    
    CanvasState.tempNodes = CanvasState.tempNodes.filter(n => n.id !== nodeId);
    saveTempNodes();
}

function clearAllTempNodes() {
    if (!confirm('确定要清空所有临时节点吗？')) return;
    
    const container = document.getElementById('canvasContent');
    if (container) {
        const nodes = container.querySelectorAll('.temp-canvas-node');
        nodes.forEach(node => node.remove());
    }
    
    CanvasState.tempNodes = [];
    saveTempNodes();
}

// 注意：这个函数已经不需要了，因为永久栏目在renderCurrentView中直接创建到canvas-content中
// 保留此函数以防其他地方调用，但实际上不做任何事
function movePermanentSectionToCanvas() {
    // 已废弃：永久栏目现在直接从template创建到canvas-content中
    console.log('[Canvas] 永久栏目已在canvas-content中（从template创建）');
}

// =============================================================================
// 永久栏目提示关闭功能
// =============================================================================

function setupPermanentSectionTipClose() {
    const closeBtn = document.getElementById('permanentSectionTipClose');
    const tipContainer = document.getElementById('permanentSectionTipContainer');
    
    if (!closeBtn || !tipContainer) {
        console.warn('[Canvas] 找不到提示关闭按钮或容器');
        return;
    }
    
    // 检查是否已经关闭过
    const isTipClosed = localStorage.getItem('canvas-permanent-tip-closed') === 'true';
    if (isTipClosed) {
        tipContainer.style.display = 'none';
    }
    
    // 点击关闭按钮
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        
        tipContainer.style.display = 'none';
        localStorage.setItem('canvas-permanent-tip-closed', 'true');
        console.log('[Canvas] 永久栏目提示已关闭');
    });
}

// =============================================================================
// 拖回永久栏目功能
// =============================================================================

function setupPermanentDropTarget() {
    const permanentSection = document.getElementById('permanentSection');
    if (!permanentSection) return;
    
    permanentSection.addEventListener('dragover', (e) => {
        if (CanvasState.dragState.dragSource === 'temporary') {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        }
    });
    
    permanentSection.addEventListener('drop', async (e) => {
        e.preventDefault();
        
        if (CanvasState.dragState.dragSource !== 'temporary') return;
        
        try {
            const nodeData = CanvasState.dragState.draggedData;
            await addToPermanentBookmarks(nodeData);
            
            // 移除临时节点
            removeTempNode(nodeData.id);
            
            // 刷新永久栏目
            await renderPermanentBookmarkTree();
            
            alert('已添加到浏览器书签！');
        } catch (error) {
            console.error('[Canvas] 添加到书签失败:', error);
            alert('添加到书签失败: ' + error.message);
        }
        
        permanentSection.classList.remove('drop-target-highlight');
    });
}

async function addToPermanentBookmarks(nodeData) {
    const bookmarkData = nodeData.data;
    
    // 获取书签栏ID
    const tree = await browserAPI.bookmarks.getTree();
    const bookmarkBar = tree[0].children.find(child => child.title === '书签栏' || child.id === '1');
    
    if (!bookmarkBar) {
        throw new Error('找不到书签栏');
    }
    
    if (bookmarkData.url) {
        // 添加书签
        await browserAPI.bookmarks.create({
            parentId: bookmarkBar.id,
            title: bookmarkData.title,
            url: bookmarkData.url
        });
    } else if (bookmarkData.children) {
        // 添加文件夹
        const folder = await browserAPI.bookmarks.create({
            parentId: bookmarkBar.id,
            title: bookmarkData.title
        });
        
        // 递归添加子项
        for (const child of bookmarkData.children) {
            if (child.url) {
                await browserAPI.bookmarks.create({
                    parentId: folder.id,
                    title: child.title,
                    url: child.url
                });
            }
        }
    }
}

// =============================================================================
// 事件监听设置
// =============================================================================

function setupCanvasEventListeners() {
    // 鼠标移动 - 拖动节点
    document.addEventListener('mousemove', (e) => {
        if (CanvasState.dragState.isDragging && CanvasState.dragState.draggedElement && CanvasState.dragState.dragSource === 'temp-node') {
            // 计算鼠标在屏幕上的移动距离
            const deltaX = e.clientX - CanvasState.dragState.dragStartX;
            const deltaY = e.clientY - CanvasState.dragState.dragStartY;
            
            // 除以缩放比例得到在canvas-content坐标系中的实际移动距离
            const scaledDeltaX = deltaX / CanvasState.zoom;
            const scaledDeltaY = deltaY / CanvasState.zoom;
            
            const newX = CanvasState.dragState.nodeStartX + scaledDeltaX;
            const newY = CanvasState.dragState.nodeStartY + scaledDeltaY;
            
            // 直接更新DOM，提高响应速度
            CanvasState.dragState.draggedElement.style.left = newX + 'px';
            CanvasState.dragState.draggedElement.style.top = newY + 'px';
            
            // 更新节点数据
            const nodeId = CanvasState.dragState.draggedElement.id;
            const node = CanvasState.tempNodes.find(n => n.id === nodeId);
            if (node) {
                node.x = newX;
                node.y = newY;
            }
            
            // 阻止文本选择
            e.preventDefault();
        }
    }, false);
    
    // 鼠标释放
    document.addEventListener('mouseup', () => {
        if (CanvasState.dragState.isDragging && CanvasState.dragState.draggedElement) {
            CanvasState.dragState.draggedElement.classList.remove('dragging');
            CanvasState.dragState.isDragging = false;
            CanvasState.dragState.draggedElement = null;
            saveTempNodes();
        }
    }, false);
    
    // 工具栏按钮
    const importBtn = document.getElementById('importCanvasBtn');
    const exportBtn = document.getElementById('exportCanvasBtn');
    const clearBtn = document.getElementById('clearTempNodesBtn');
    
    if (importBtn) importBtn.addEventListener('click', showImportDialog);
    if (exportBtn) exportBtn.addEventListener('click', exportCanvas);
    if (clearBtn) clearBtn.addEventListener('click', clearAllTempNodes);
    
    // 设置永久栏目拖放目标
    setupPermanentDropTarget();
}

// =============================================================================
// 导入导出功能
// =============================================================================

function showImportDialog() {
    // 创建导入对话框
    const dialog = document.createElement('div');
    dialog.className = 'import-dialog';
    dialog.id = 'canvasImportDialog';
    
    dialog.innerHTML = `
        <div class="import-dialog-content">
            <div class="import-dialog-header">
                <h3>导入书签</h3>
                <button class="import-dialog-close" id="closeImportDialog">&times;</button>
            </div>
            <div class="import-dialog-body">
                <div class="import-options">
                    <button class="import-option-btn" id="importHtmlBtn">
                        <i class="fas fa-file-code" style="font-size: 24px;"></i>
                        <span>导入 HTML 书签</span>
                    </button>
                    <button class="import-option-btn" id="importJsonBtn">
                        <i class="fas fa-file-code" style="font-size: 24px;"></i>
                        <span>导入 JSON 书签</span>
                    </button>
                </div>
                <input type="file" id="canvasFileInput" accept=".html,.json" style="display: none;">
            </div>
        </div>
    `;
    
    document.body.appendChild(dialog);
    
    // 事件监听
    document.getElementById('closeImportDialog').addEventListener('click', () => {
        dialog.remove();
    });
    
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.remove();
    });
    
    document.getElementById('importHtmlBtn').addEventListener('click', () => {
        const input = document.getElementById('canvasFileInput');
        input.accept = '.html';
        input.dataset.type = 'html';
        input.click();
    });
    
    document.getElementById('importJsonBtn').addEventListener('click', () => {
        const input = document.getElementById('canvasFileInput');
        input.accept = '.json';
        input.dataset.type = 'json';
        input.click();
    });
    
    document.getElementById('canvasFileInput').addEventListener('change', handleFileImport);
}

async function handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const type = e.target.dataset.type;
    
    try {
        const text = await file.text();
        
        if (type === 'html') {
            importHtmlBookmarks(text);
        } else {
            importJsonBookmarks(text);
        }
        
        document.getElementById('canvasImportDialog').remove();
        alert('导入成功！');
    } catch (error) {
        console.error('[Canvas] 导入失败:', error);
        alert('导入失败: ' + error.message);
    }
    
    e.target.value = '';
}

function importHtmlBookmarks(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const links = doc.querySelectorAll('a[href]');
    
    let x = 100;
    let y = 100;
    
    links.forEach((link, index) => {
        const bookmark = {
            id: 'imported-' + Date.now() + '-' + index,
            title: link.textContent,
            url: link.href,
            type: 'bookmark'
        };
        
        createTempNode(bookmark, x, y);
        x += 30;
        y += 30;
    });
}

function importJsonBookmarks(json) {
    const data = JSON.parse(json);
    
    let x = 100;
    let y = 100;
    
    const processNode = (node) => {
        if (node.url) {
            const bookmark = {
                id: node.id || 'imported-' + Date.now(),
                title: node.name || node.title,
                url: node.url,
                type: 'bookmark'
            };
            createTempNode(bookmark, x, y);
            x += 30;
            y += 30;
        }
        
        if (node.children) {
            node.children.forEach(processNode);
        }
    };
    
    if (data.roots) {
        Object.values(data.roots).forEach(root => {
            if (root.children) {
                root.children.forEach(processNode);
            }
        });
    } else {
        processNode(data);
    }
}

function exportCanvas() {
    const canvasData = {
        nodes: [],
        edges: []
    };
    
    // 添加永久栏目节点
    canvasData.nodes.push({
        id: 'permanent-section',
        type: 'group',
        x: window.innerWidth / 2 - 300,
        y: window.innerHeight / 2 - 300,
        width: 600,
        height: 600,
        label: 'Bookmark Tree (永久栏目)',
        color: '4'
    });
    
    // 添加临时节点
    CanvasState.tempNodes.forEach(node => {
        const canvasNode = {
            id: node.id,
            type: 'text',
            x: node.x,
            y: node.y,
            width: node.width,
            height: 150,
            text: formatNodeText(node)
        };
        
        if (node.type === 'folder') {
            canvasNode.color = '2';
        }
        
        canvasData.nodes.push(canvasNode);
    });
    
    // 生成并下载文件
    const blob = new Blob([JSON.stringify(canvasData, null, 2)], { 
        type: 'application/json' 
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bookmark-canvas-${Date.now()}.canvas`;
    a.click();
    URL.revokeObjectURL(url);
    
    alert('Canvas已导出为 .canvas 文件！');
}

function formatNodeText(node) {
    let text = `# ${node.data.title}\n\n`;
    
    if (node.type === 'bookmark' && node.data.url) {
        text += `[${node.data.title}](${node.data.url})`;
    } else if (node.type === 'folder' && node.data.children) {
        node.data.children.forEach(child => {
            if (child.url) {
                text += `- [${child.title}](${child.url})\n`;
            }
        });
    }
    
    return text;
}

// =============================================================================
// 数据持久化
// =============================================================================

function saveTempNodes() {
    const state = {
        nodes: CanvasState.tempNodes,
        timestamp: Date.now()
    };
    
    localStorage.setItem('bookmark-canvas-temp-nodes', JSON.stringify(state));
}

function loadTempNodes() {
    try {
        const saved = localStorage.getItem('bookmark-canvas-temp-nodes');
        if (saved) {
            const state = JSON.parse(saved);
            CanvasState.tempNodes = state.nodes || [];
            CanvasState.tempNodeCounter = CanvasState.tempNodes.length;
            
            // 渲染保存的临时节点
            CanvasState.tempNodes.forEach(node => {
                renderTempNode(node);
            });
            
            console.log('[Canvas] 加载了', CanvasState.tempNodes.length, '个临时节点');
        }
        
        // 加载永久栏目位置
        loadPermanentSectionPosition();
    } catch (error) {
        console.error('[Canvas] 加载临时节点失败:', error);
    }
}

// =============================================================================
// 导出模块
// =============================================================================

window.CanvasModule = {
    init: initCanvasView,
    enhance: enhanceBookmarkTreeForCanvas, // 增强书签树的Canvas功能
    clear: clearAllTempNodes
};
