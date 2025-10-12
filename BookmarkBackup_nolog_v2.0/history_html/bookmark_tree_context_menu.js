// 书签树右键菜单功能
// 提供类似Chrome原生书签管理器的功能

// 全局变量
let contextMenu = null;
let currentContextNode = null;
let bookmarkClipboard = null; // 剪贴板 { action: 'cut'|'copy', nodeId, nodeData }
let clipboardOperation = null; // 'cut' | 'copy'
let selectedNodes = new Set(); // 多选节点集合
let lastClickedNode = null; // 上次点击的节点（用于Shift选择）

// 初始化右键菜单
function initContextMenu() {
    // 创建菜单容器
    contextMenu = document.createElement('div');
    contextMenu.id = 'bookmark-context-menu';
    contextMenu.className = 'bookmark-context-menu';
    contextMenu.style.display = 'none';
    // 初始挂载到body，使用时会动态插入到目标节点附近
    document.body.appendChild(contextMenu);
    
    // 点击其他地方关闭菜单（使用捕获阶段，优先处理）
    document.addEventListener('click', (e) => {
        // 如果点击的不是菜单内部，关闭菜单
        if (contextMenu && !contextMenu.contains(e.target)) {
            hideContextMenu();
        }
    }, true);  // 使用捕获阶段
    
    // 也监听右键事件，关闭已打开的菜单
    document.addEventListener('contextmenu', (e) => {
        // 如果不是在树节点上右键，关闭菜单
        if (!e.target.closest('.tree-item[data-node-id]')) {
            hideContextMenu();
        }
    }, true);
    
    // ESC键关闭菜单
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideContextMenu();
        }
    });
    
    // Resize时调整菜单位置（如果超出视口）
    window.addEventListener('resize', () => {
        // Resize时如果菜单可见，检查是否超出视口
        if (contextMenu && contextMenu.style.display !== 'none') {
            const rect = contextMenu.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            
            let left = parseInt(contextMenu.style.left);
            let top = parseInt(contextMenu.style.top);
            
            // 如果超出视口，调整位置
            if (rect.right > viewportWidth) {
                left = viewportWidth - rect.width - 10;
                contextMenu.style.left = left + 'px';
            }
            
            if (rect.bottom > viewportHeight) {
                top = viewportHeight - rect.height - 10;
                contextMenu.style.top = top + 'px';
            }
        }
    });
    
    console.log('[右键菜单] 初始化完成');
}

// 显示右键菜单
function showContextMenu(e, node) {
    e.preventDefault();
    e.stopPropagation();
    
    currentContextNode = node;
    
    // 移除之前的右键选中标识
    document.querySelectorAll('.tree-item.context-selected').forEach(item => {
        item.classList.remove('context-selected');
    });
    
    // 添加右键选中标识
    node.classList.add('context-selected');
    
    // 获取节点信息
    const nodeId = node.dataset.nodeId;
    const nodeTitle = node.dataset.nodeTitle;
    const nodeUrl = node.dataset.nodeUrl;
    const isFolder = node.dataset.nodeType === 'folder';
    
    console.log('[右键菜单] 显示菜单:', { nodeId, nodeTitle, isFolder });
    
    // 构建菜单项
    const menuItems = buildMenuItems(nodeId, nodeTitle, nodeUrl, isFolder);
    
    // 渲染菜单
    contextMenu.innerHTML = menuItems.map(item => {
        if (item.separator) {
            return '<div class="context-menu-separator"></div>';
        }
        
        const icon = item.icon ? `<i class="fas fa-${item.icon}"></i>` : '';
        const disabled = item.disabled ? 'disabled' : '';
        
        return `
            <div class="context-menu-item ${disabled}" data-action="${item.action}">
                ${icon}
                <span>${item.label}</span>
            </div>
        `;
    }).join('');
    
    // 绑定点击事件
    contextMenu.querySelectorAll('.context-menu-item:not(.disabled)').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = item.dataset.action;
            handleMenuAction(action, nodeId, nodeTitle, nodeUrl, isFolder);
            hideContextMenu();
        });
    });
    
    // 将菜单嵌入到DOM中（插入到被右键的节点后面）
    embedContextMenu(node);
    
    contextMenu.style.display = 'block';
}

// 构建菜单项
function buildMenuItems(nodeId, nodeTitle, nodeUrl, isFolder) {
    const lang = currentLang || 'zh_CN';
    const items = [];
    
    // 检查是否有多选
    const hasMultiSelection = selectedNodes.size > 1;
    
    if (hasMultiSelection) {
        // 多选菜单
        items.push(
            { action: 'open-selected', label: lang === 'zh_CN' ? `打开选中的 ${selectedNodes.size} 项` : `Open ${selectedNodes.size} Selected`, icon: 'folder-open' },
            { action: 'open-selected-tab-group', label: lang === 'zh_CN' ? `在新标签页组中打开` : `Open in New Tab Group`, icon: 'object-group' },
            { separator: true },
            { action: 'cut-selected', label: lang === 'zh_CN' ? '剪切选中项' : 'Cut Selected', icon: 'cut' },
            { action: 'copy-selected', label: lang === 'zh_CN' ? '复制选中项' : 'Copy Selected', icon: 'copy' },
            { action: 'delete-selected', label: lang === 'zh_CN' ? '删除选中项' : 'Delete Selected', icon: 'trash-alt' },
            { separator: true },
            { action: 'deselect-all', label: lang === 'zh_CN' ? '取消全选' : 'Deselect All', icon: 'times' }
        );
    } else if (isFolder) {
        // 文件夹菜单
        items.push(
            { action: 'open-all', label: lang === 'zh_CN' ? '打开全部' : 'Open All Bookmarks', icon: 'folder-open' },
            { action: 'open-all-tab-group', label: lang === 'zh_CN' ? '在新标签页组中打开全部' : 'Open All in New Tab Group', icon: 'object-group' },
            { action: 'open-all-new-window', label: lang === 'zh_CN' ? '在新窗口中打开全部' : 'Open All in New Window', icon: 'window-restore' },
            { action: 'open-all-incognito', label: lang === 'zh_CN' ? '在无痕窗口中打开全部' : 'Open All in Incognito Window', icon: 'user-secret' },
            { separator: true },
            { action: 'add-page', label: lang === 'zh_CN' ? '添加网页' : 'Add Page', icon: 'plus-circle' },
            { action: 'add-folder', label: lang === 'zh_CN' ? '添加文件夹' : 'Add Folder', icon: 'folder-plus' },
            { separator: true },
            { action: 'rename', label: lang === 'zh_CN' ? '重命名' : 'Rename', icon: 'edit' },
            { separator: true },
            { action: 'cut', label: lang === 'zh_CN' ? '剪切' : 'Cut', icon: 'cut' },
            { action: 'copy', label: lang === 'zh_CN' ? '复制' : 'Copy', icon: 'copy' },
            { action: 'paste', label: lang === 'zh_CN' ? '粘贴' : 'Paste', icon: 'paste', disabled: !hasClipboard() },
            { separator: true },
            { action: 'delete', label: lang === 'zh_CN' ? '删除' : 'Delete', icon: 'trash-alt' }
        );
    } else {
        // 书签菜单
        items.push(
            { action: 'open', label: lang === 'zh_CN' ? '打开' : 'Open', icon: 'external-link-alt' },
            { action: 'open-new-tab', label: lang === 'zh_CN' ? '在新标签页中打开' : 'Open in New Tab', icon: 'window-maximize' },
            { action: 'open-new-window', label: lang === 'zh_CN' ? '在新窗口中打开' : 'Open in New Window', icon: 'window-restore' },
            { action: 'open-incognito', label: lang === 'zh_CN' ? '在无痕窗口中打开' : 'Open in Incognito Window', icon: 'user-secret' },
            { separator: true },
            { action: 'edit', label: lang === 'zh_CN' ? '编辑' : 'Edit', icon: 'edit' },
            { separator: true },
            { action: 'cut', label: lang === 'zh_CN' ? '剪切' : 'Cut', icon: 'cut' },
            { action: 'copy', label: lang === 'zh_CN' ? '复制' : 'Copy', icon: 'copy' },
            { action: 'paste', label: lang === 'zh_CN' ? '粘贴' : 'Paste', icon: 'paste', disabled: !hasClipboard() },
            { separator: true },
            { action: 'copy-url', label: lang === 'zh_CN' ? '复制链接地址' : 'Copy Link Address', icon: 'link' },
            { separator: true },
            { action: 'delete', label: lang === 'zh_CN' ? '删除' : 'Delete', icon: 'trash-alt' }
        );
    }
    
    return items;
}

// 将菜单嵌入到DOM中（插入到树节点后面）
function embedContextMenu(node) {
    // 从当前位置移除菜单
    if (contextMenu.parentElement) {
        contextMenu.parentElement.removeChild(contextMenu);
    }
    
    // 找到合适的插入位置
    // 将菜单插入到被右键的节点后面
    const parent = node.parentElement;
    const nextSibling = node.nextSibling;
    
    if (nextSibling) {
        parent.insertBefore(contextMenu, nextSibling);
    } else {
        parent.appendChild(contextMenu);
    }
    
    // 使用相对定位，嵌入文档流
    contextMenu.style.cssText = `
        position: relative !important;
        display: block !important;
        margin-left: 20px !important;
        margin-top: 5px !important;
        margin-bottom: 5px !important;
    `;
    
    console.log('[右键菜单] 嵌入到DOM:', { 
        parent: parent.className,
        position: 'relative',
        note: '嵌入式菜单，跟随元素滚动'
    });
}

// 隐藏菜单
function hideContextMenu() {
    if (contextMenu) {
        contextMenu.style.display = 'none';
        
        // 将菜单移回body，避免影响DOM结构
        if (contextMenu.parentElement !== document.body) {
            document.body.appendChild(contextMenu);
        }
    }
    
    // 移除右键选中标识
    document.querySelectorAll('.tree-item.context-selected').forEach(item => {
        item.classList.remove('context-selected');
    });
    
    currentContextNode = null;
}

// 检查是否有剪贴板内容
function hasClipboard() {
    return bookmarkClipboard !== null;
}

// 处理菜单操作
async function handleMenuAction(action, nodeId, nodeTitle, nodeUrl, isFolder) {
    console.log('[右键菜单] 执行操作:', action, { nodeId, nodeTitle, isFolder });
    
    try {
        switch (action) {
            case 'open':
                await openBookmark(nodeUrl);
                break;
                
            case 'open-new-tab':
                await openBookmarkNewTab(nodeUrl);
                break;
                
            case 'open-new-window':
                await openBookmarkNewWindow(nodeUrl, false);
                break;
                
            case 'open-incognito':
                await openBookmarkNewWindow(nodeUrl, true);
                break;
                
            case 'open-all':
                await openAllBookmarks(nodeId, false, false);
                break;
                
            case 'open-all-new-window':
                await openAllBookmarks(nodeId, true, false);
                break;
                
            case 'open-all-incognito':
                await openAllBookmarks(nodeId, true, true);
                break;
                
            case 'open-all-tab-group':
                await openAllInTabGroup(nodeId);
                break;
                
            case 'open-selected':
                await openSelectedBookmarks();
                break;
                
            case 'open-selected-tab-group':
                await openSelectedInTabGroup();
                break;
                
            case 'cut-selected':
                await cutSelected();
                break;
                
            case 'copy-selected':
                await copySelected();
                break;
                
            case 'delete-selected':
                await deleteSelected();
                break;
                
            case 'deselect-all':
                deselectAll();
                break;
                
            case 'edit':
            case 'rename':
                await editBookmark(nodeId, nodeTitle, nodeUrl, isFolder);
                break;
                
            case 'add-page':
                await addBookmark(nodeId);
                break;
                
            case 'add-folder':
                await addFolder(nodeId);
                break;
                
            case 'cut':
                await cutBookmark(nodeId, nodeTitle, isFolder);
                break;
                
            case 'copy':
                await copyBookmark(nodeId, nodeTitle, isFolder);
                break;
                
            case 'paste':
                await pasteBookmark(nodeId);
                break;
                
            case 'copy-url':
                await copyUrl(nodeUrl);
                break;
                
            case 'delete':
                await deleteBookmark(nodeId, nodeTitle, isFolder);
                break;
                
            default:
                console.warn('[右键菜单] 未知操作:', action);
        }
    } catch (error) {
        console.error('[右键菜单] 操作失败:', error);
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? `操作失败: ${error.message}` : `Operation failed: ${error.message}`);
    }
}

// 打开书签
async function openBookmark(url) {
    if (!url) return;
    window.open(url, '_blank');
}

// 在新标签页中打开
async function openBookmarkNewTab(url) {
    if (!url) return;
    if (chrome && chrome.tabs) {
        chrome.tabs.create({ url: url });
    } else {
        window.open(url, '_blank');
    }
}

// 在新窗口中打开
async function openBookmarkNewWindow(url, incognito = false) {
    if (!url) return;
    if (chrome && chrome.windows) {
        chrome.windows.create({ url: url, incognito: incognito });
    } else {
        window.open(url, '_blank');
    }
}

// 打开文件夹中所有书签
async function openAllBookmarks(folderId, newWindow = false, incognito = false) {
    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }
    
    // 获取文件夹中的所有书签（递归）
    async function getAllUrls(folderId) {
        const urls = [];
        const children = await chrome.bookmarks.getChildren(folderId);
        
        for (const child of children) {
            if (child.url) {
                urls.push(child.url);
            } else if (child.children) {
                // 递归获取子文件夹中的书签
                const subUrls = await getAllUrls(child.id);
                urls.push(...subUrls);
            }
        }
        
        return urls;
    }
    
    const urls = await getAllUrls(folderId);
    
    if (urls.length === 0) {
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? '文件夹中没有书签' : 'No bookmarks in folder');
        return;
    }
    
    // 确认是否打开大量书签
    if (urls.length > 10) {
        const lang = currentLang || 'zh_CN';
        const message = lang === 'zh_CN' 
            ? `确定要打开 ${urls.length} 个书签吗？` 
            : `Open ${urls.length} bookmarks?`;
        if (!confirm(message)) return;
    }
    
    if (newWindow) {
        // 在新窗口中打开
        if (chrome.windows) {
            chrome.windows.create({ url: urls, incognito: incognito });
        }
    } else {
        // 在新标签页中打开
        if (chrome.tabs) {
            for (const url of urls) {
                chrome.tabs.create({ url: url, active: false });
            }
        }
    }
}

// 编辑书签
async function editBookmark(nodeId, currentTitle, currentUrl, isFolder) {
    const lang = currentLang || 'zh_CN';
    
    if (isFolder) {
        // 编辑文件夹（重命名）
        const newTitle = prompt(
            lang === 'zh_CN' ? '重命名文件夹:' : 'Rename folder:',
            currentTitle
        );
        
        if (newTitle && newTitle !== currentTitle) {
            if (chrome && chrome.bookmarks) {
                await chrome.bookmarks.update(nodeId, { title: newTitle });
                await refreshBookmarkTree();
            }
        }
    } else {
        // 编辑书签
        const newTitle = prompt(
            lang === 'zh_CN' ? '书签名称:' : 'Bookmark name:',
            currentTitle
        );
        
        if (newTitle === null) return; // 用户取消
        
        const newUrl = prompt(
            lang === 'zh_CN' ? '书签地址:' : 'Bookmark URL:',
            currentUrl
        );
        
        if (newUrl === null) return; // 用户取消
        
        if ((newTitle && newTitle !== currentTitle) || (newUrl && newUrl !== currentUrl)) {
            if (chrome && chrome.bookmarks) {
                const updates = {};
                if (newTitle && newTitle !== currentTitle) updates.title = newTitle;
                if (newUrl && newUrl !== currentUrl) updates.url = newUrl;
                
                await chrome.bookmarks.update(nodeId, updates);
                await refreshBookmarkTree();
            }
        }
    }
}

// 添加书签
async function addBookmark(parentId) {
    const lang = currentLang || 'zh_CN';
    
    const title = prompt(lang === 'zh_CN' ? '书签名称:' : 'Bookmark name:');
    if (!title) return;
    
    const url = prompt(lang === 'zh_CN' ? '书签地址:' : 'Bookmark URL:', 'https://');
    if (!url) return;
    
    if (chrome && chrome.bookmarks) {
        await chrome.bookmarks.create({
            parentId: parentId,
            title: title,
            url: url
        });
        await refreshBookmarkTree();
    }
}

// 添加文件夹
async function addFolder(parentId) {
    const lang = currentLang || 'zh_CN';
    
    const title = prompt(lang === 'zh_CN' ? '文件夹名称:' : 'Folder name:');
    if (!title) return;
    
    if (chrome && chrome.bookmarks) {
        await chrome.bookmarks.create({
            parentId: parentId,
            title: title
        });
        await refreshBookmarkTree();
    }
}

// 复制URL
async function copyUrl(url) {
    if (!url) return;
    
    try {
        await navigator.clipboard.writeText(url);
        const lang = currentLang || 'zh_CN';
        console.log(lang === 'zh_CN' ? 'URL已复制' : 'URL copied');
        // 可以显示一个toast提示
    } catch (err) {
        console.error('复制失败:', err);
    }
}

// 删除书签/文件夹
async function deleteBookmark(nodeId, nodeTitle, isFolder) {
    const lang = currentLang || 'zh_CN';
    
    const confirmMsg = lang === 'zh_CN' 
        ? `确定要删除 "${nodeTitle}" 吗？${isFolder ? '（包括其中的所有内容）' : ''}`
        : `Delete "${nodeTitle}"?${isFolder ? ' (including all contents)' : ''}`;
    
    if (!confirm(confirmMsg)) return;
    
    if (chrome && chrome.bookmarks) {
        if (isFolder) {
            await chrome.bookmarks.removeTree(nodeId);
        } else {
            await chrome.bookmarks.remove(nodeId);
        }
        await refreshBookmarkTree();
    }
}

// 剪切书签
async function cutBookmark(nodeId, nodeTitle, isFolder) {
    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }
    
    try {
        // 获取节点完整信息
        const [node] = await chrome.bookmarks.get(nodeId);
        
        // 保存到剪贴板
        bookmarkClipboard = {
            action: 'cut',
            nodeId: nodeId,
            nodeData: node
        };
        clipboardOperation = 'cut';
        
        console.log('[剪切] 已剪切:', nodeTitle);
        
        // 标记节点（添加视觉反馈）
        markCutNode(nodeId);
        
    } catch (error) {
        console.error('[剪切] 失败:', error);
    }
}

// 复制书签
async function copyBookmark(nodeId, nodeTitle, isFolder) {
    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }
    
    try {
        // 获取节点完整信息（包括子节点）
        const [node] = await chrome.bookmarks.getSubTree(nodeId);
        
        // 保存到剪贴板
        bookmarkClipboard = {
            action: 'copy',
            nodeId: nodeId,
            nodeData: node
        };
        clipboardOperation = 'copy';
        
        console.log('[复制] 已复制:', nodeTitle);
        
    } catch (error) {
        console.error('[复制] 失败:', error);
    }
}

// 粘贴书签
async function pasteBookmark(targetFolderId) {
    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }
    
    if (!bookmarkClipboard) {
        return;
    }
    
    try {
        if (bookmarkClipboard.action === 'cut') {
            // 剪切：移动节点
            await chrome.bookmarks.move(bookmarkClipboard.nodeId, {
                parentId: targetFolderId
            });
            console.log('[粘贴] 移动完成');
            
            // 清空剪贴板
            bookmarkClipboard = null;
            clipboardOperation = null;
            
            // 移除标记
            unmarkCutNode();
            
        } else if (bookmarkClipboard.action === 'copy') {
            // 复制：递归创建节点
            await duplicateNode(bookmarkClipboard.nodeData, targetFolderId);
            console.log('[粘贴] 复制完成');
        }
        
        // 刷新视图
        await refreshBookmarkTree();
        
    } catch (error) {
        console.error('[粘贴] 失败:', error);
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? `粘贴失败: ${error.message}` : `Paste failed: ${error.message}`);
    }
}

// 递归复制节点
async function duplicateNode(node, parentId) {
    const newNode = {
        parentId: parentId,
        title: node.title
    };
    
    if (node.url) {
        newNode.url = node.url;
    }
    
    // 创建节点
    const created = await chrome.bookmarks.create(newNode);
    
    // 如果有子节点，递归复制
    if (node.children) {
        for (const child of node.children) {
            await duplicateNode(child, created.id);
        }
    }
    
    return created;
}

// 标记被剪切的节点
function markCutNode(nodeId) {
    const node = document.querySelector(`.tree-item[data-node-id="${nodeId}"]`);
    if (node) {
        node.classList.add('cut-marked');
    }
}

// 取消标记
function unmarkCutNode() {
    document.querySelectorAll('.cut-marked').forEach(node => {
        node.classList.remove('cut-marked');
    });
}

// ==================== 标签页组功能 ====================

// 在新标签页组中打开所有书签
async function openAllInTabGroup(folderId) {
    if (!chrome || !chrome.bookmarks || !chrome.tabs) {
        alert('此功能需要Chrome扩展环境');
        return;
    }
    
    try {
        // 获取所有URL
        const urls = await getAllUrlsFromFolder(folderId);
        
        if (urls.length === 0) {
            const lang = currentLang || 'zh_CN';
            alert(lang === 'zh_CN' ? '文件夹中没有书签' : 'No bookmarks in folder');
            return;
        }
        
        // 确认是否打开大量书签
        if (urls.length > 10) {
            const lang = currentLang || 'zh_CN';
            const message = lang === 'zh_CN' 
                ? `确定要打开 ${urls.length} 个书签吗？` 
                : `Open ${urls.length} bookmarks?`;
            if (!confirm(message)) return;
        }
        
        // 获取文件夹信息作为组名
        const [folder] = await chrome.bookmarks.get(folderId);
        const groupTitle = folder.title;
        
        // 创建标签页
        const tabIds = [];
        for (const url of urls) {
            const tab = await chrome.tabs.create({ url: url, active: false });
            tabIds.push(tab.id);
        }
        
        // 创建标签页组
        if (chrome.tabs.group) {
            const groupId = await chrome.tabs.group({ tabIds: tabIds });
            
            // 设置组标题和颜色
            if (chrome.tabGroups) {
                await chrome.tabGroups.update(groupId, {
                    title: groupTitle,
                    collapsed: false
                });
            }
        }
        
        console.log('[标签页组] 已创建:', groupTitle, tabIds.length, '个标签页');
        
    } catch (error) {
        console.error('[标签页组] 打开失败:', error);
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? `打开失败: ${error.message}` : `Failed to open: ${error.message}`);
    }
}

// 辅助函数：递归获取文件夹中的所有URL
async function getAllUrlsFromFolder(folderId) {
    const urls = [];
    const children = await chrome.bookmarks.getChildren(folderId);
    
    for (const child of children) {
        if (child.url) {
            urls.push(child.url);
        } else if (child.children) {
            const subUrls = await getAllUrlsFromFolder(child.id);
            urls.push(...subUrls);
        }
    }
    
    return urls;
}

// ==================== 多选功能 ====================

// 切换节点选中状态
function toggleNodeSelection(nodeId, nodeElement) {
    if (selectedNodes.has(nodeId)) {
        selectedNodes.delete(nodeId);
        nodeElement.classList.remove('selected');
    } else {
        selectedNodes.add(nodeId);
        nodeElement.classList.add('selected');
    }
    
    console.log('[多选] 当前选中:', selectedNodes.size, '个');
}

// 范围选择（Shift+Click）
function selectRange(startNodeId, endNodeId) {
    const allNodes = Array.from(document.querySelectorAll('.tree-item[data-node-id]'));
    const startIndex = allNodes.findIndex(n => n.dataset.nodeId === startNodeId);
    const endIndex = allNodes.findIndex(n => n.dataset.nodeId === endNodeId);
    
    if (startIndex === -1 || endIndex === -1) return;
    
    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);
    
    // 选中范围内的所有节点
    for (let i = start; i <= end; i++) {
        const node = allNodes[i];
        const nodeId = node.dataset.nodeId;
        selectedNodes.add(nodeId);
        node.classList.add('selected');
    }
    
    console.log('[多选] 范围选择:', selectedNodes.size, '个');
}

// 全选
function selectAll() {
    document.querySelectorAll('.tree-item[data-node-id]').forEach(node => {
        selectedNodes.add(node.dataset.nodeId);
        node.classList.add('selected');
    });
    
    console.log('[多选] 全选:', selectedNodes.size, '个');
}

// 取消全选
function deselectAll() {
    document.querySelectorAll('.tree-item[data-node-id]').forEach(node => {
        node.classList.remove('selected');
    });
    selectedNodes.clear();
    
    console.log('[多选] 已取消全选');
}

// 打开选中的书签
async function openSelectedBookmarks() {
    if (!chrome || !chrome.tabs) {
        alert('此功能需要Chrome扩展环境');
        return;
    }
    
    try {
        const urls = await getSelectedUrls();
        
        if (urls.length === 0) {
            const lang = currentLang || 'zh_CN';
            alert(lang === 'zh_CN' ? '没有选中书签' : 'No bookmarks selected');
            return;
        }
        
        // 打开所有URL
        for (const url of urls) {
            await chrome.tabs.create({ url: url, active: false });
        }
        
        console.log('[多选] 已打开:', urls.length, '个书签');
        
    } catch (error) {
        console.error('[多选] 打开失败:', error);
    }
}

// 在新标签页组中打开选中的书签
async function openSelectedInTabGroup() {
    if (!chrome || !chrome.tabs) {
        alert('此功能需要Chrome扩展环境');
        return;
    }
    
    try {
        const urls = await getSelectedUrls();
        
        if (urls.length === 0) {
            const lang = currentLang || 'zh_CN';
            alert(lang === 'zh_CN' ? '没有选中书签' : 'No bookmarks selected');
            return;
        }
        
        // 创建标签页
        const tabIds = [];
        for (const url of urls) {
            const tab = await chrome.tabs.create({ url: url, active: false });
            tabIds.push(tab.id);
        }
        
        // 创建标签页组
        if (chrome.tabs.group) {
            const lang = currentLang || 'zh_CN';
            const groupId = await chrome.tabs.group({ tabIds: tabIds });
            
            if (chrome.tabGroups) {
                await chrome.tabGroups.update(groupId, {
                    title: lang === 'zh_CN' ? `选中的书签 (${urls.length})` : `Selected (${urls.length})`,
                    collapsed: false
                });
            }
        }
        
        console.log('[多选] 已在标签页组中打开:', urls.length, '个书签');
        
    } catch (error) {
        console.error('[多选] 打开失败:', error);
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? `打开失败: ${error.message}` : `Failed to open: ${error.message}`);
    }
}

// 剪切选中的项
async function cutSelected() {
    // TODO: 实现批量剪切
    console.log('[多选] 剪切:', selectedNodes.size, '个');
    const lang = currentLang || 'zh_CN';
    alert(lang === 'zh_CN' ? '批量剪切功能开发中' : 'Batch cut feature coming soon');
}

// 复制选中的项
async function copySelected() {
    // TODO: 实现批量复制
    console.log('[多选] 复制:', selectedNodes.size, '个');
    const lang = currentLang || 'zh_CN';
    alert(lang === 'zh_CN' ? '批量复制功能开发中' : 'Batch copy feature coming soon');
}

// 删除选中的项
async function deleteSelected() {
    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }
    
    const lang = currentLang || 'zh_CN';
    const message = lang === 'zh_CN' 
        ? `确定要删除选中的 ${selectedNodes.size} 项吗？` 
        : `Delete ${selectedNodes.size} selected items?`;
    
    if (!confirm(message)) return;
    
    try {
        for (const nodeId of selectedNodes) {
            const [node] = await chrome.bookmarks.get(nodeId);
            if (node.url) {
                await chrome.bookmarks.remove(nodeId);
            } else {
                await chrome.bookmarks.removeTree(nodeId);
            }
        }
        
        deselectAll();
        await refreshBookmarkTree();
        
        console.log('[多选] 已删除:', selectedNodes.size, '个');
        
    } catch (error) {
        console.error('[多选] 删除失败:', error);
        alert(lang === 'zh_CN' ? `删除失败: ${error.message}` : `Delete failed: ${error.message}`);
    }
}

// 获取选中节点的所有URL
async function getSelectedUrls() {
    const urls = [];
    
    for (const nodeId of selectedNodes) {
        try {
            const [node] = await chrome.bookmarks.get(nodeId);
            if (node.url) {
                urls.push(node.url);
            } else {
                // 如果是文件夹，递归获取
                const folderUrls = await getAllUrlsFromFolder(nodeId);
                urls.push(...folderUrls);
            }
        } catch (error) {
            console.error('[多选] 获取URL失败:', nodeId, error);
        }
    }
    
    return urls;
}

// 刷新书签树
async function refreshBookmarkTree() {
    if (typeof renderTreeView === 'function') {
        await renderTreeView(true);
    }
}

// 导出函数
if (typeof window !== 'undefined') {
    window.initContextMenu = initContextMenu;
    window.showContextMenu = showContextMenu;
    window.hideContextMenu = hideContextMenu;
    window.toggleNodeSelection = toggleNodeSelection;
    window.selectRange = selectRange;
    window.selectAll = selectAll;
    window.deselectAll = deselectAll;
}
