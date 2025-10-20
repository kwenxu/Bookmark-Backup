// 书签树右键菜单功能
// 提供类似Chrome原生书签管理器的功能

// 全局变量
let contextMenu = null;
let currentContextNode = null;
let bookmarkClipboard = null; // 剪贴板 { action: 'cut'|'copy', nodeId, nodeData }
let clipboardOperation = null; // 'cut' | 'copy'
let selectedNodes = new Set(); // 多选节点集合
let lastClickedNode = null; // 上次点击的节点（用于Shift选择）
let selectMode = false; // 是否处于Select模式

// 初始化右键菜单
function initContextMenu() {
    // 创建菜单容器
    contextMenu = document.createElement('div');
    contextMenu.id = 'bookmark-context-menu';
    contextMenu.className = 'bookmark-context-menu';
    contextMenu.style.display = 'none';

    // 如果默认是横向布局，添加 horizontal-layout 类
    if (contextMenuHorizontal) {
        contextMenu.classList.add('horizontal-layout');
    }

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
    
    // Resize时不调整菜单位置（保持嵌入式相对定位）
    // 嵌入式菜单会随DOM自然调整，无需手动处理
    
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
    const lang = currentLang || 'zh_CN';
    let menuHTML;

    if (contextMenuHorizontal) {
        // 横向布局：按分组渲染
        const groups = {};
        const groupOrder = [];

        // 分组菜单项
        menuItems.forEach(item => {
            if (item.separator) return;

            const groupName = item.group || 'default';
            if (!groups[groupName]) {
                groups[groupName] = [];
                groupOrder.push(groupName);
            }
            groups[groupName].push(item);
        });

        // 生成HTML
        const groupElements = groupOrder.map(groupName => {
            const groupItems = groups[groupName];
            return groupItems.map(item => {
                const icon = item.icon ? `<i class="fas fa-${item.icon}"></i>` : '';
                const disabled = item.disabled ? 'disabled' : '';
                const colorClass = item.action === 'select-item' ? 'color-blue' : item.action === 'delete' ? 'color-red' : '';
                const hiddenStyle = item.hidden ? 'style="display:none;"' : '';
                return `
                    <div class="context-menu-item ${disabled} ${colorClass}" data-action="${item.action}" ${hiddenStyle}>
                        ${icon}
                        <span>${item.label}</span>
                    </div>
                `;
            }).join('');
        }).join('');

        menuHTML = groupElements;
    } else {
        // 纵向布局：原始格式
        menuHTML = menuItems.map(item => {
            if (item.separator) {
                return '<div class="context-menu-separator"></div>';
            }

            const icon = item.icon ? `<i class="fas fa-${item.icon}"></i>` : '';
            const disabled = item.disabled ? 'disabled' : '';
            const colorClass = item.action === 'select-item' ? 'color-blue' : item.action === 'delete' ? 'color-red' : '';
            const hiddenStyle = item.hidden ? 'style="display:none;"' : '';

            return `
                <div class="context-menu-item ${disabled} ${colorClass}" data-action="${item.action}" ${hiddenStyle}>
                    ${icon}
                    <span>${item.label}</span>
                </div>
            `;
        }).filter(html => html !== '').join('');
    }

    contextMenu.innerHTML = menuHTML;
    
    // 绑定点击事件
    contextMenu.querySelectorAll('.context-menu-item:not(.disabled)').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = item.dataset.action;

            // 切换布局时，不关闭菜单
            if (action === 'toggle-context-menu-layout') {
                toggleContextMenuLayout();
                // 重新渲染菜单以更新按钮文字
                showContextMenu(e, currentContextNode);
                return;
            }

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
    
    // 检查是否有选中项
    const hasSelection = selectedNodes.size > 0;
    
    // 检查当前右键的项是否已被选中
    const isNodeSelected = selectedNodes.has(nodeId);
    
    // 如果右键的是已选中的项，且有多个选中项，显示批量操作菜单
    if (isNodeSelected && selectedNodes.size > 0) {
        items.push(
            { action: 'batch-open', label: lang === 'zh_CN' ? `打开选中的 ${selectedNodes.size} 项` : `Open ${selectedNodes.size} Selected`, icon: 'folder-open' },
            { action: 'batch-open-tab-group', label: lang === 'zh_CN' ? '在新标签页组中打开' : 'Open in New Tab Group', icon: 'object-group' },
            { separator: true },
            { action: 'batch-cut', label: lang === 'zh_CN' ? '剪切选中项' : 'Cut Selected', icon: 'cut' },
            { action: 'batch-delete', label: lang === 'zh_CN' ? '删除选中项' : 'Delete Selected', icon: 'trash-alt' },
            { action: 'batch-rename', label: lang === 'zh_CN' ? '批量重命名' : 'Batch Rename', icon: 'edit' },
            { separator: true },
            { action: 'batch-export-html', label: lang === 'zh_CN' ? '导出为HTML' : 'Export to HTML', icon: 'file-code' },
            { action: 'batch-export-json', label: lang === 'zh_CN' ? '导出为JSON' : 'Export to JSON', icon: 'file-alt' },
            { action: 'batch-merge-folder', label: lang === 'zh_CN' ? '合并为新文件夹' : 'Merge to New Folder', icon: 'folder-plus' },
            { separator: true },
            { action: 'deselect-all', label: lang === 'zh_CN' ? '取消全选' : 'Deselect All', icon: 'times' }
        );
        return items;
    }
    
    // 普通单项菜单
    if (isFolder) {
        // 文件夹菜单 - 按分组组织
        items.push(
            // 选择组
            { action: 'select-item', label: lang === 'zh_CN' ? '选择（批量操作）' : 'Select (Batch)', icon: 'check-square', group: 'select' },

            // 编辑组 - 紧跟在select后面
            { action: 'rename', label: lang === 'zh_CN' ? '重命名' : 'Rename', icon: 'edit', group: 'select' },
            { action: 'cut', label: lang === 'zh_CN' ? '剪切' : 'Cut', icon: 'cut', group: 'select' },
            { action: 'copy', label: lang === 'zh_CN' ? '复制' : 'Copy', icon: 'copy', group: 'select' },
            { action: 'paste', label: lang === 'zh_CN' ? '粘贴' : 'Paste', icon: 'paste', disabled: !hasClipboard(), group: 'select', hidden: true },
            { separator: true },

            // 打开组
            { action: 'open-all', label: lang === 'zh_CN' ? '打开全部' : 'Open All', icon: 'folder-open', group: 'open' },
            { action: 'open-all-tab-group', label: lang === 'zh_CN' ? '标签页组' : 'Tab Group', icon: 'object-group', group: 'open' },
            { action: 'open-all-new-window', label: lang === 'zh_CN' ? '新窗口' : 'New Window', icon: 'window-restore', group: 'open' },
            { action: 'open-all-incognito', label: lang === 'zh_CN' ? '无痕窗口' : 'Incognito', icon: 'user-secret', group: 'open' },
            { separator: true },

            // 新增组
            { action: 'add-page', label: lang === 'zh_CN' ? '添加网页' : 'Add Page', icon: 'plus-circle', group: 'add' },
            { action: 'add-folder', label: lang === 'zh_CN' ? '添加文件夹' : 'Add Folder', icon: 'folder-plus', group: 'add' },
            { separator: true },

            // 删除组
            { action: 'delete', label: lang === 'zh_CN' ? '删除' : 'Delete', icon: 'trash-alt', group: 'delete' },
            { separator: true },

            // 设置组
            { action: 'toggle-context-menu-layout', label: contextMenuHorizontal ? (lang === 'zh_CN' ? '纵向布局' : 'Vertical') : (lang === 'zh_CN' ? '横向布局' : 'Horizontal'), icon: 'exchange-alt', group: 'settings' }
        );
    } else {
        // 书签菜单 - 按分组组织
        items.push(
            // 选择组
            { action: 'select-item', label: lang === 'zh_CN' ? '选择（批量操作）' : 'Select (Batch)', icon: 'check-square', group: 'select' },

            // 编辑组 - 紧跟在select后面
            { action: 'edit', label: lang === 'zh_CN' ? '编辑' : 'Edit', icon: 'edit', group: 'select' },
            { action: 'cut', label: lang === 'zh_CN' ? '剪切' : 'Cut', icon: 'cut', group: 'select' },
            { action: 'copy', label: lang === 'zh_CN' ? '复制' : 'Copy', icon: 'copy', group: 'select' },
            { action: 'paste', label: lang === 'zh_CN' ? '粘贴' : 'Paste', icon: 'paste', disabled: !hasClipboard(), group: 'select', hidden: true },
            { separator: true },

            // 打开组
            { action: 'open', label: lang === 'zh_CN' ? '打开' : 'Open', icon: 'external-link-alt', group: 'open' },
            { action: 'open-new-tab', label: lang === 'zh_CN' ? '新标签页' : 'New Tab', icon: 'window-maximize', group: 'open' },
            { action: 'open-new-window', label: lang === 'zh_CN' ? '新窗口' : 'New Window', icon: 'window-restore', group: 'open' },
            { action: 'open-incognito', label: lang === 'zh_CN' ? '无痕窗口' : 'Incognito', icon: 'user-secret', group: 'open' },
            { separator: true },

            // 链接组
            { action: 'copy-url', label: lang === 'zh_CN' ? '复制链接' : 'Copy Link', icon: 'link', group: 'url' },
            { separator: true },

            // 删除组
            { action: 'delete', label: lang === 'zh_CN' ? '删除' : 'Delete', icon: 'trash-alt', group: 'delete' },
            { separator: true },

            // 设置组
            { action: 'toggle-context-menu-layout', label: contextMenuHorizontal ? (lang === 'zh_CN' ? '纵向布局' : 'Vertical') : (lang === 'zh_CN' ? '横向布局' : 'Horizontal'), icon: 'exchange-alt', group: 'settings' }
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

// 显示粘贴按钮
function showPasteButton() {
    const pasteBtn = contextMenu.querySelector('[data-action="paste"]');
    if (pasteBtn) {
        pasteBtn.style.display = 'inline-flex';
        pasteBtn.classList.remove('paste-hidden');
        console.log('[右键菜单] 已显示粘贴按钮');
    }
}

// 隐藏粘贴按钮
function hidePasteButton() {
    const pasteBtn = contextMenu.querySelector('[data-action="paste"]');
    if (pasteBtn) {
        pasteBtn.style.display = 'none';
        pasteBtn.classList.add('paste-hidden');
        console.log('[右键菜单] 已隐藏粘贴按钮');
    }
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
            
            // 批量操作
            case 'batch-open':
                await batchOpen();
                break;
                
            case 'batch-open-tab-group':
                await batchOpenTabGroup();
                break;
                
            case 'batch-cut':
                await batchCut();
                break;
                
            case 'batch-delete':
                await batchDelete();
                break;
                
            case 'batch-rename':
                await batchRename();
                break;
                
            case 'batch-export-html':
                await batchExportHTML();
                break;
                
            case 'batch-export-json':
                await batchExportJSON();
                break;
                
            case 'batch-merge-folder':
                await batchMergeFolder();
                break;
                
            case 'select-item':
                enterSelectMode();
                break;
                
            case 'deselect-all':
                deselectAll();
                updateBatchToolbar();
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
                showPasteButton();
                break;

            case 'copy':
                await copyBookmark(nodeId, nodeTitle, isFolder);
                showPasteButton();
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

            case 'toggle-context-menu-layout':
                toggleContextMenuLayout();
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

// 刷新书签树（批量操作后专用，不显示变更标记）
async function refreshBookmarkTree() {
    console.log('[批量操作] 开始刷新书签树（无diff模式）');
    
    if (typeof renderTreeView === 'function') {
        // 临时清空旧数据，避免显示变更标记
        await chrome.storage.local.set({ lastBookmarkData: null });
        console.log('[批量操作] 已临时清除旧数据，避免diff');
        
        // 渲染当前书签树（不会检测变更）
        await renderTreeView(true);
        
        // 获取当前书签数据并更新为新的基准数据（重要：这样下次对比就基于删除后的状态）
        if (chrome && chrome.bookmarks) {
            const bookmarkTree = await chrome.bookmarks.getTree();
            await chrome.storage.local.set({ lastBookmarkData: bookmarkTree });
            console.log('[批量操作] 已将当前状态设为新的基准数据，避免后续误标记为moved');
        }
    } else {
        console.warn('[批量操作] renderTreeView 函数不存在');
    }
}

// ==================== Select模式 ====================

// 进入Select模式
function enterSelectMode() {
    selectMode = true;
    
    // 显示全局蓝框和提示
    showSelectModeOverlay();
    
    // 隐藏顶部工具栏
    const toolbar = document.getElementById('batch-toolbar');
    if (toolbar) {
        toolbar.style.display = 'none';
        console.log('[Select模式] 隐藏顶部工具栏');
    }
    
    // 更新批量工具栏（但不显示，因为我们要显示批量菜单）
    updateBatchToolbar();
    
    // 关闭右键菜单
    hideContextMenu();
    
    // 检查上次的显示状态，决定是显示批量菜单还是工具栏
    try {
        const savedState = localStorage.getItem('batchPanelState');
        if (savedState) {
            const state = JSON.parse(savedState);
            if (state.visible === false) {
                // 上次是隐藏状态，显示工具栏
                console.log('[Select模式] 恢复上次状态：显示工具栏');
                updateBatchToolbar();
                if (toolbar) {
                    toolbar.style.display = 'flex';
                }
                return;
            }
        }
    } catch (e) {
        console.error('[Select模式] 读取保存状态失败:', e);
    }
    
    // 默认或上次是显示状态，自动显示批量菜单
    setTimeout(() => {
        const fakeEvent = { preventDefault: () => {}, stopPropagation: () => {} };
        showBatchContextMenu(fakeEvent);
        console.log('[Select模式] 自动显示批量菜单');
    }, 100);
    
    console.log('[Select模式] 已进入');
}

// 退出Select模式
function exitSelectMode() {
    selectMode = false;
    
    // 隐藏蓝框
    hideSelectModeOverlay();
    
    // 隐藏批量操作面板
    hideBatchActionPanel();
    
    // 清空选中
    deselectAll();
    updateBatchToolbar();
    
    console.log('[Select模式] 已退出');
}

// 隐藏批量操作面板
function hideBatchActionPanel() {
    const batchPanel = document.getElementById('batch-action-panel');
    if (batchPanel) {
        batchPanel.style.display = 'none';
        console.log('[批量面板] 已隐藏');
    }
}

// 显示Select模式蓝框（不再显示顶部提示）
function showSelectModeOverlay() {
    // 检查是否已存在
    let overlay = document.getElementById('select-mode-overlay');
    if (overlay) {
        overlay.style.display = 'block';
        return;
    }
    
    // 创建蓝框（不包含顶部提示）
    overlay = document.createElement('div');
    overlay.id = 'select-mode-overlay';
    overlay.className = 'select-mode-overlay';
    
    // 找到树容器
    const treeContainer = document.getElementById('bookmarkTree') || 
                         document.querySelector('.bookmark-tree') || 
                         document.querySelector('.tree-view-container') || 
                         document.body;
    treeContainer.style.position = 'relative';
    treeContainer.appendChild(overlay);
    
    console.log('[Select模式] 蓝框已添加到:', treeContainer.id || treeContainer.className);
    
    // 绑定点击事件 - 点击overlay上的位置，找到下面的书签元素
    overlay.addEventListener('click', (e) => {
        console.log('[Select模式] overlay点击事件:', e.target);
        
        // 暂时隐藏overlay以获取下面的元素
        overlay.style.pointerEvents = 'none';
        const elementBelow = document.elementFromPoint(e.clientX, e.clientY);
        overlay.style.pointerEvents = 'auto';
        
        console.log('[Select模式] 下面的元素:', elementBelow);
        
        // 检查是否点击折叠按钮或其附近区域
        const toggleBtn = elementBelow?.closest('.tree-toggle');
        if (toggleBtn) {
            console.log('[Select模式] 点击折叠按钮，触发展开/收起');
            // 触发折叠按钮的点击
            toggleBtn.click();
            return;
        }
        
        // 检查是否点击在折叠按钮右侧30px范围内
        const treeItem = elementBelow?.closest('.tree-item[data-node-id]');
        if (treeItem) {
            const toggle = treeItem.querySelector('.tree-toggle');
            if (toggle) {
                const toggleRect = toggle.getBoundingClientRect();
                // 点击位置在折叠按钮右侧30px范围内，也触发折叠
                if (e.clientX >= toggleRect.left && e.clientX <= toggleRect.right + 30 &&
                    e.clientY >= toggleRect.top && e.clientY <= toggleRect.bottom) {
                    console.log('[Select模式] 点击折叠按钮附近区域，触发展开/收起');
                    toggle.click();
                    return;
                }
            }
        }
        
        // 找到最近的tree-item
        if (!treeItem) {
            console.log('[Select模式] 未找到tree-item');
            return;
        }
        
        const nodeId = treeItem.dataset.nodeId;
        console.log('[Select模式] 找到节点:', nodeId);
        
        // Ctrl/Cmd + Click: 多选
        if (e.ctrlKey || e.metaKey) {
            toggleSelectItem(nodeId);
            lastClickedNode = nodeId;
            console.log('[Select模式] Ctrl+Click多选');
            return;
        }
        
        // Shift + Click: 范围选择
        if (e.shiftKey && lastClickedNode) {
            selectRange(lastClickedNode, nodeId);
            console.log('[Select模式] Shift+Click范围选择');
            return;
        }
        
        // 普通点击: 切换选择
        toggleSelectItem(nodeId);
        lastClickedNode = nodeId;
        console.log('[Select模式] 普通点击');
    });
    
    // 绑定右键事件 - 在蓝框区域右键显示批量菜单
    overlay.addEventListener('contextmenu', (e) => {
        console.log('[Select模式] 右键事件:', { selectedCount: selectedNodes.size });
        if (selectedNodes.size > 0) {
            e.preventDefault();
            e.stopPropagation();
            showBatchContextMenu(e);
        }
    });
    
    // 使overlay可以接收点击和右键事件
    overlay.style.pointerEvents = 'auto';
}

// 隐藏Select模式蓝框
function hideSelectModeOverlay() {
    const overlay = document.getElementById('select-mode-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

// 显示批量操作固定面板
function showBatchContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    
    console.log('[批量菜单] 显示固定面板');
    
    // 检查是否已存在批量面板
    let batchPanel = document.getElementById('batch-action-panel');
    if (batchPanel) {
        // 如果已存在，只需确保显示
        batchPanel.style.display = 'block';
        console.log('[批量菜单] 面板已存在，直接显示');
        return;
    }
    
    // 创建固定位置的批量操作面板
    batchPanel = document.createElement('div');
    batchPanel.id = 'batch-action-panel';
    batchPanel.className = 'batch-action-panel vertical-batch-layout'; // 默认纵向布局
    
    const lang = currentLang || 'zh_CN';
    
    // 构建批量菜单 - 分组显示（简化版本）
    const itemGroups = [
        // 打开组
        {
            name: lang === 'zh_CN' ? '打开' : 'Open',
            items: [
                { action: 'batch-open', label: lang === 'zh_CN' ? `打开(${selectedNodes.size})` : `Open(${selectedNodes.size})`, icon: 'folder-open' },
                { action: 'batch-open-tab-group', label: lang === 'zh_CN' ? '标签组' : 'Group', icon: 'object-group' }
            ]
        },
        // 编辑组
        {
            name: lang === 'zh_CN' ? '编辑' : 'Edit',
            items: [
                { action: 'batch-cut', label: lang === 'zh_CN' ? '剪切' : 'Cut', icon: 'cut' },
                { action: 'batch-delete', label: lang === 'zh_CN' ? '删除' : 'Del', icon: 'trash-alt' },
                { action: 'batch-rename', label: lang === 'zh_CN' ? '改名' : 'Rename', icon: 'edit' }
            ]
        },
        // 导出组
        {
            name: lang === 'zh_CN' ? '导出' : 'Export',
            items: [
                { action: 'batch-export-html', label: 'HTML', icon: 'file-code' },
                { action: 'batch-export-json', label: 'JSON', icon: 'file-alt' },
                { action: 'batch-merge-folder', label: lang === 'zh_CN' ? '合并' : 'Merge', icon: 'folder-plus' }
            ]
        },
        // 控制组
        {
            name: lang === 'zh_CN' ? '控制' : 'Control',
            items: [
                { action: 'toggle-batch-layout', label: lang === 'zh_CN' ? '横向' : 'Horiz', icon: 'exchange-alt' },
                { action: 'hide-batch-panel', label: lang === 'zh_CN' ? '隐藏' : 'Hide', icon: 'eye-slash' }
            ]
        }
    ];
    
    batchPanel.innerHTML = `
        <div class="batch-panel-header" id="batch-panel-header">
            <span class="batch-panel-title" title="${lang === 'zh_CN' ? '拖动移动窗口' : 'Drag to move'}">${lang === 'zh_CN' ? '批量操作' : 'Batch Actions'}</span>
            <span class="batch-panel-count" id="batch-panel-count">${selectedNodes.size} ${lang === 'zh_CN' ? '项已选' : 'selected'}</span>
            <button class="batch-panel-exit-btn" data-action="exit-select-mode" title="${lang === 'zh_CN' ? '退出Select模式' : 'Exit Select Mode'}">
                <i class="fas fa-times"></i> ${lang === 'zh_CN' ? '退出' : 'Exit'}
            </button>
        </div>
        <div class="batch-panel-resize-handles">
            <div class="resize-handle resize-n" data-direction="n"></div>
            <div class="resize-handle resize-s" data-direction="s"></div>
            <div class="resize-handle resize-w" data-direction="w"></div>
            <div class="resize-handle resize-e" data-direction="e"></div>
            <div class="resize-handle resize-nw" data-direction="nw"></div>
            <div class="resize-handle resize-ne" data-direction="ne"></div>
            <div class="resize-handle resize-sw" data-direction="sw"></div>
            <div class="resize-handle resize-se" data-direction="se"></div>
        </div>
        <div class="batch-panel-content">
            ${itemGroups.map((group, groupIndex) => {
                const groupItems = group.items.map(item => {
                    const icon = item.icon ? `<i class="fas fa-${item.icon}"></i>` : '';
                    const exitClass = item.isExit ? 'exit-item' : '';
                    return `
                        <div class="context-menu-item ${exitClass}" data-action="${item.action}">
                            ${icon}
                            <span>${item.label}</span>
                        </div>
                    `;
                }).join('');
                
                return `
                    <div class="batch-menu-group" data-group="${group.name}">
                        <div class="batch-group-label">${group.name}</div>
                        <div class="batch-group-items">
                            ${groupItems}
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
    
    // 绑定点击事件
    batchPanel.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', async (e) => {
            e.stopPropagation();
            const action = item.dataset.action;
            console.log('[批量菜单] 点击操作:', action);
            
            if (action === 'exit-select-mode') {
                exitSelectMode();
            } else if (action === 'hide-batch-panel') {
                hideBatchPanel();
            } else if (action === 'toggle-batch-layout') {
                toggleBatchPanelLayout();
            } else {
                await handleMenuAction(action, null, null, null, false);
            }
        });
    });
    
    // 绑定标题栏退出按钮事件
    const headerExitBtn = batchPanel.querySelector('.batch-panel-exit-btn');
    if (headerExitBtn) {
        headerExitBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            exitSelectMode();
            console.log('[批量菜单] 点击标题栏退出按钮');
        });
    }
    
    // 添加拖拽移动功能
    initBatchPanelDrag(batchPanel);
    
    // 添加调整大小功能（四边和四角）
    initBatchPanelResize(batchPanel);
    
    // 添加窗口大小变化监听器（用于横向布局自适应）
    initBatchPanelWindowResize(batchPanel);
    
    // 将面板添加到书签树容器
    const treeContainer = document.getElementById('bookmarkTree') || 
                         document.querySelector('.bookmark-tree') || 
                         document.querySelector('.tree-view-container');
    
    if (treeContainer) {
        treeContainer.style.position = 'relative';
        treeContainer.appendChild(batchPanel);
        console.log('[批量菜单] 固定面板已添加到树容器');
    } else {
        document.body.appendChild(batchPanel);
        console.log('[批量菜单] 固定面板已添加到body');
    }
    
    // 恢复保存的位置和大小，或设置初始居中位置
    const treeContainerForPosition = document.getElementById('bookmarkTree') || 
                                      document.querySelector('.bookmark-tree') || 
                                      document.querySelector('.tree-view-container');
    restoreBatchPanelState(batchPanel, treeContainerForPosition);
}

// ==================== 批量操作功能 ====================

// 切换选择单个项目
function toggleSelectItem(nodeId) {
    const nodeElement = document.querySelector(`.tree-item[data-node-id="${nodeId}"]`);
    if (!nodeElement) {
        console.log('[批量] 未找到节点元素:', nodeId);
        return;
    }
    
    if (selectedNodes.has(nodeId)) {
        selectedNodes.delete(nodeId);
        nodeElement.classList.remove('selected');
        console.log('[批量] 取消选中:', nodeId);
    } else {
        selectedNodes.add(nodeId);
        nodeElement.classList.add('selected');
        console.log('[批量] 选中:', nodeId);
    }
    
    updateBatchToolbar();
    updateBatchPanelCount(); // 实时更新批量面板计数
    console.log('[批量] 选中状态:', selectedNodes.size, '个');
}

// 批量打开
async function batchOpen() {
    if (!chrome || !chrome.tabs) {
        alert('此功能需要Chrome扩展环境');
        return;
    }
    
    const lang = currentLang || 'zh_CN';
    const urls = await getSelectedUrls();
    
    if (urls.length === 0) {
        alert(lang === 'zh_CN' ? '没有可打开的书签' : 'No bookmarks to open');
        return;
    }
    
    if (urls.length > 10) {
        const message = lang === 'zh_CN' 
            ? `确定要打开 ${urls.length} 个书签吗？` 
            : `Open ${urls.length} bookmarks?`;
        if (!confirm(message)) return;
    }
    
    for (const url of urls) {
        await chrome.tabs.create({ url: url, active: false });
    }
    
    console.log('[批量] 已打开:', urls.length, '个书签');
}

// 批量打开（标签页组）
async function batchOpenTabGroup() {
    if (!chrome || !chrome.tabs) {
        alert('此功能需要Chrome扩展环境');
        return;
    }
    
    const lang = currentLang || 'zh_CN';
    const urls = await getSelectedUrls();
    
    if (urls.length === 0) {
        alert(lang === 'zh_CN' ? '没有可打开的书签' : 'No bookmarks to open');
        return;
    }
    
    try {
        // 创建标签页
        const tabIds = [];
        for (const url of urls) {
            const tab = await chrome.tabs.create({ url: url, active: false });
            tabIds.push(tab.id);
        }
        
        // 创建标签页组
        if (chrome.tabs.group) {
            const groupId = await chrome.tabs.group({ tabIds: tabIds });
            
            if (chrome.tabGroups) {
                await chrome.tabGroups.update(groupId, {
                    title: lang === 'zh_CN' ? `选中的书签 (${urls.length})` : `Selected (${urls.length})`,
                    collapsed: false
                });
            }
        }
        
        console.log('[批量] 已在标签页组中打开:', urls.length, '个书签');
    } catch (error) {
        console.error('[批量] 打开失败:', error);
        alert(lang === 'zh_CN' ? `打开失败: ${error.message}` : `Failed to open: ${error.message}`);
    }
}

// 批量剪切
async function batchCut() {
    const lang = currentLang || 'zh_CN';
    console.log('[批量] 剪切:', selectedNodes.size, '个');
    alert(lang === 'zh_CN' ? '批量剪切功能开发中' : 'Batch cut feature coming soon');
}

// 批量删除
async function batchDelete() {
    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }
    
    const lang = currentLang || 'zh_CN';
    const count = selectedNodes.size;
    
    // 二次确认
    const message = lang === 'zh_CN' 
        ? `确定要删除选中的 ${count} 项吗？此操作不可撤销！` 
        : `Delete ${count} selected items? This cannot be undone!`;
    
    if (!confirm(message)) return;
    
    try {
        let successCount = 0;
        let failCount = 0;
        const affectedParentIds = new Set(); // 记录受影响的父文件夹ID
        
        // 先收集所有要删除的节点的父ID
        for (const nodeId of selectedNodes) {
            try {
                const [node] = await chrome.bookmarks.get(nodeId);
                if (node.parentId) {
                    affectedParentIds.add(node.parentId);
                }
            } catch (error) {
                console.error('[批量] 获取节点信息失败:', nodeId, error);
            }
        }
        
        // 执行删除
        for (const nodeId of selectedNodes) {
            try {
                const [node] = await chrome.bookmarks.get(nodeId);
                if (node.url) {
                    await chrome.bookmarks.remove(nodeId);
                } else {
                    await chrome.bookmarks.removeTree(nodeId);
                }
                successCount++;
            } catch (error) {
                console.error('[批量] 删除失败:', nodeId, error);
                failCount++;
            }
        }
        
        // 先清空选择状态（重要：避免残留蓝色标记）
        deselectAll();
        updateBatchToolbar();
        
        // 存储受影响的父文件夹列表到临时存储，供比较算法使用
        if (affectedParentIds.size > 0) {
            await chrome.storage.local.set({ 
                tempDeletedParents: Array.from(affectedParentIds),
                tempDeleteTimestamp: Date.now()
            });
            console.log('[批量删除] 已记录受影响的父文件夹:', Array.from(affectedParentIds));
        }
        
        // 刷新书签树（这会重新渲染，确保没有残留的状态）
        await refreshBookmarkTree();
        
        // 清除临时标记（延迟清除，给渲染留出更长时间，从1秒增加到5秒）
        setTimeout(async () => {
            await chrome.storage.local.remove(['tempDeletedParents', 'tempDeleteTimestamp']);
            console.log('[批量删除] 已清除临时标记');
        }, 5000);
        
        const result = lang === 'zh_CN' 
            ? `已删除 ${successCount} 项${failCount > 0 ? `，失败 ${failCount} 项` : ''}` 
            : `Deleted ${successCount} items${failCount > 0 ? `, failed ${failCount}` : ''}`;
        
        alert(result);
        console.log('[批量] 删除完成:', { successCount, failCount });
        
    } catch (error) {
        console.error('[批量] 删除失败:', error);
        alert(lang === 'zh_CN' ? `删除失败: ${error.message}` : `Delete failed: ${error.message}`);
    }
}

// 批量重命名
async function batchRename() {
    const lang = currentLang || 'zh_CN';
    
    const prefix = prompt(
        lang === 'zh_CN' ? '请输入统一前缀（可选）:' : 'Enter prefix (optional):',
        ''
    );
    
    const suffix = prompt(
        lang === 'zh_CN' ? '请输入统一后缀（可选）:' : 'Enter suffix (optional):',
        ''
    );
    
    if (prefix === null && suffix === null) return;
    
    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }
    
    try {
        let count = 0;
        for (const nodeId of selectedNodes) {
            const [node] = await chrome.bookmarks.get(nodeId);
            const newTitle = `${prefix || ''}${node.title}${suffix || ''}`;
            await chrome.bookmarks.update(nodeId, { title: newTitle });
            count++;
        }
        
        await refreshBookmarkTree();
        alert(lang === 'zh_CN' ? `已重命名 ${count} 项` : `Renamed ${count} items`);
        console.log('[批量] 重命名完成:', count);
        
    } catch (error) {
        console.error('[批量] 重命名失败:', error);
        alert(lang === 'zh_CN' ? `重命名失败: ${error.message}` : `Rename failed: ${error.message}`);
    }
}

// 导出为HTML
async function batchExportHTML() {
    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }
    
    const lang = currentLang || 'zh_CN';
    
    try {
        let html = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n';
        html += '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n';
        html += '<TITLE>Bookmarks</TITLE>\n';
        html += '<H1>Bookmarks</H1>\n';
        html += '<DL><p>\n';
        
        for (const nodeId of selectedNodes) {
            const [node] = await chrome.bookmarks.get(nodeId);
            if (node.url) {
                html += `    <DT><A HREF="${node.url}">${node.title}</A>\n`;
            } else {
                html += `    <DT><H3>${node.title}</H3>\n`;
                html += `    <DL><p>\n`;
                // 递归获取子项
                const children = await chrome.bookmarks.getChildren(nodeId);
                for (const child of children) {
                    if (child.url) {
                        html += `        <DT><A HREF="${child.url}">${child.title}</A>\n`;
                    }
                }
                html += `    </DL><p>\n`;
            }
        }
        
        html += '</DL><p>\n';
        
        // 下载文件
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'bookmarks.html';
        a.click();
        URL.revokeObjectURL(url);
        
        alert(lang === 'zh_CN' ? '导出成功！' : 'Export successful!');
        console.log('[批量] 导出HTML完成');
        
    } catch (error) {
        console.error('[批量] 导出HTML失败:', error);
        alert(lang === 'zh_CN' ? `导出失败: ${error.message}` : `Export failed: ${error.message}`);
    }
}

// 导出为JSON
async function batchExportJSON() {
    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }
    
    const lang = currentLang || 'zh_CN';
    
    try {
        const bookmarks = [];
        
        for (const nodeId of selectedNodes) {
            const [node] = await chrome.bookmarks.get(nodeId);
            const bookmark = {
                id: node.id,
                title: node.title,
                url: node.url || null,
                dateAdded: node.dateAdded,
                dateGroupModified: node.dateGroupModified
            };
            
            if (!node.url) {
                // 如果是文件夹，获取子项
                const children = await chrome.bookmarks.getChildren(nodeId);
                bookmark.children = children.map(child => ({
                    id: child.id,
                    title: child.title,
                    url: child.url || null
                }));
            }
            
            bookmarks.push(bookmark);
        }
        
        const json = JSON.stringify(bookmarks, null, 2);
        
        // 下载文件
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'bookmarks.json';
        a.click();
        URL.revokeObjectURL(url);
        
        alert(lang === 'zh_CN' ? '导出成功！' : 'Export successful!');
        console.log('[批量] 导出JSON完成');
        
    } catch (error) {
        console.error('[批量] 导出JSON失败:', error);
        alert(lang === 'zh_CN' ? `导出失败: ${error.message}` : `Export failed: ${error.message}`);
    }
}

// 合并为新文件夹
async function batchMergeFolder() {
    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }
    
    const lang = currentLang || 'zh_CN';
    
    const folderName = prompt(
        lang === 'zh_CN' ? '请输入新文件夹名称:' : 'Enter new folder name:',
        lang === 'zh_CN' ? '合并的文件夹' : 'Merged Folder'
    );
    
    if (!folderName) return;
    
    try {
        // 创建新文件夹（默认在根目录的"其他书签"中）
        const bookmarkBar = (await chrome.bookmarks.getTree())[0].children.find(n => n.id === '1');
        const newFolder = await chrome.bookmarks.create({
            parentId: bookmarkBar.id,
            title: folderName
        });
        
        // 移动所有选中项到新文件夹
        let count = 0;
        for (const nodeId of selectedNodes) {
            try {
                await chrome.bookmarks.move(nodeId, { parentId: newFolder.id });
                count++;
            } catch (error) {
                console.error('[批量] 移动失败:', nodeId, error);
            }
        }
        
        deselectAll();
        updateBatchToolbar();
        await refreshBookmarkTree();
        
        alert(lang === 'zh_CN' ? `已将 ${count} 项合并到新文件夹` : `Merged ${count} items to new folder`);
        console.log('[批量] 合并完成:', count);
        
    } catch (error) {
        console.error('[批量] 合并失败:', error);
        alert(lang === 'zh_CN' ? `合并失败: ${error.message}` : `Merge failed: ${error.message}`);
    }
}

// ==================== 顶部批量操作工具栏 ====================

// 初始化批量操作工具栏
function initBatchToolbar() {
    // 查找书签树视图的标题
    const pageTitle = document.querySelector('#treeViewTitle') || 
                     document.querySelector('#treeView h2') ||
                     document.querySelector('h2');
    if (!pageTitle) {
        console.warn('[批量工具栏] 未找到页面标题');
        return;
    }
    
    console.log('[批量工具栏] 找到标题:', pageTitle.textContent);
    
    // 创建工具栏容器（在标题同一行）
    const titleContainer = pageTitle.parentElement;
    titleContainer.style.display = 'flex';
    titleContainer.style.alignItems = 'center';
    titleContainer.style.gap = '20px';
    titleContainer.style.flexWrap = 'wrap';
    
    // 创建工具栏
    const toolbar = document.createElement('div');
    toolbar.id = 'batch-toolbar';
    toolbar.className = 'batch-toolbar';
    toolbar.style.display = 'none';
    const lang = currentLang || 'zh_CN';
    toolbar.innerHTML = `
        <span class="selected-count">已选中 0 项</span>
        <button class="batch-btn" data-action="show-batch-panel" title="${lang === 'zh_CN' ? '显示悬浮窗菜单' : 'Show Floating Panel'}">
            <i class="fas fa-window-restore"></i> ${lang === 'zh_CN' ? '悬浮窗' : 'Float'}
        </button>
        <button class="batch-btn" data-action="batch-open"><i class="fas fa-folder-open"></i> 打开</button>
        <button class="batch-btn" data-action="batch-open-tab-group"><i class="fas fa-object-group"></i> 标签组</button>
        <button class="batch-btn" data-action="batch-cut"><i class="fas fa-cut"></i> 剪切</button>
        <button class="batch-btn" data-action="batch-delete"><i class="fas fa-trash-alt"></i> 删除</button>
        <button class="batch-btn" data-action="batch-rename"><i class="fas fa-edit"></i> 重命名</button>
        <button class="batch-btn" data-action="batch-export-html"><i class="fas fa-file-code"></i> HTML</button>
        <button class="batch-btn" data-action="batch-export-json"><i class="fas fa-file-alt"></i> JSON</button>
        <button class="batch-btn" data-action="batch-merge-folder"><i class="fas fa-folder-plus"></i> 合并</button>
        <button class="batch-btn exit-select-btn" data-action="exit-select-mode"><i class="fas fa-times"></i> 退出</button>
    `;
    
    // 插入到标题旁边
    titleContainer.appendChild(toolbar);
    
    // 绑定按钮事件
    toolbar.querySelectorAll('.batch-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const action = btn.dataset.action;
            if (action === 'exit-select-mode') {
                exitSelectMode();
            } else if (action === 'show-batch-panel') {
                showBatchPanel();
            } else {
                await handleMenuAction(action, null, null, null, false);
            }
        });
    });
    
    console.log('[批量工具栏] 初始化完成');
}

// 更新批量操作工具栏
function updateBatchToolbar() {
    const toolbar = document.getElementById('batch-toolbar');
    if (!toolbar) {
        console.warn('[批量工具栏] 未找到工具栏元素');
        return;
    }
    
    const lang = currentLang || 'zh_CN';
    const count = selectedNodes.size;
    
    console.log('[批量工具栏] 更新:', { selectMode, count });
    
    // 在Select模式下，默认不显示工具栏（显示批量菜单）
    // 除非用户点击了"隐藏批量菜单"按钮
    // 如果不在Select模式，也隐藏
    if (!selectMode) {
        toolbar.style.display = 'none';
        console.log('[批量工具栏] 已隐藏（非Select模式）');
        return;
    }
    
    // 更新计数文本
    const countText = lang === 'zh_CN' ? `已选中 ${count} 项` : `${count} Selected`;
    const countElement = toolbar.querySelector('.selected-count');
    if (countElement) {
        countElement.textContent = countText;
    }
    
    console.log('[批量工具栏] 已更新计数:', countText);
}

// ==================== 快捷键支持 ====================

// 初始化快捷键
function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // ESC - 退出Select模式
        if (e.key === 'Escape' && selectMode) {
            exitSelectMode();
            return;
        }
        
        // 只在Select模式下响应其他快捷键
        if (!selectMode) return;
        
        // Ctrl/Cmd + A - 全选
        if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
            e.preventDefault();
            selectAll();
        }
    });
    
    console.log('[快捷键] 初始化完成');
}

// 初始化点击选择 - 现在改为在overlay上处理，不需要这个函数了
function initClickSelect() {
    console.log('[点击选择] 初始化完成（点击事件现在在overlay上处理）');
}

// 更新批量面板的选择计数
function updateBatchPanelCount() {
    const batchPanel = document.getElementById('batch-action-panel');
    if (!batchPanel) return;
    
    const countElement = batchPanel.querySelector('#batch-panel-count');
    if (!countElement) return;
    
    const lang = currentLang || 'zh_CN';
    const count = selectedNodes.size;
    countElement.textContent = `${count} ${lang === 'zh_CN' ? '项已选' : 'selected'}`;
    
    console.log('[批量面板] 更新计数:', count);
}

// 初始化批量面板的拖拽移动功能
function initBatchPanelDrag(panel) {
    const header = panel.querySelector('#batch-panel-header');
    if (!header) return;
    
    let isDragging = false;
    let startX, startY, startLeft, startTop;
    
    // 整个标题栏都可拖动
    header.style.cursor = 'grab';
    
    header.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        
        // 获取当前实际位置
        const rect = panel.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;
        
        // 立即清除transform并设置固定位置，防止拖动时跳变
        panel.style.transform = 'none';
        panel.style.left = startLeft + 'px';
        panel.style.top = startTop + 'px';
        panel.style.bottom = 'auto';
        panel.style.right = 'auto';
        
        // 改变光标样式
        header.style.cursor = 'grabbing';
        
        // 防止文字选中
        e.preventDefault();
        
        console.log('[批量面板] 开始拖动');
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        
        panel.style.left = (startLeft + deltaX) + 'px';
        panel.style.top = (startTop + deltaY) + 'px';
        panel.style.right = 'auto'; // 取消右侧固定
    });
    
    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            header.style.cursor = 'grab';
            // 保存位置
            saveBatchPanelState(panel);
            console.log('[批量面板] 拖动完成');
        }
    });
    
    console.log('[批量面板] 拖拽移动功能已初始化');
}

// 根据高度更新tall-layout类（横向布局专用）
function updateTallLayoutClass(panel, height) {
    const threshold = 200; // 高度阈值：200px
    
    if (height >= threshold) {
        if (!panel.classList.contains('tall-layout')) {
            panel.classList.add('tall-layout');
            console.log('[批量面板] 高度>=200px，切换到纵向单列布局');
        }
    } else {
        if (panel.classList.contains('tall-layout')) {
            panel.classList.remove('tall-layout');
            console.log('[批量面板] 高度<200px，切换到横向多列布局');
        }
    }
}

// 初始化批量面板的调整大小功能（四边和四角）
function initBatchPanelResize(panel) {
    const handles = panel.querySelectorAll('.resize-handle');
    if (handles.length === 0) return;
    
    let isResizing = false;
    let startX, startY, startWidth, startHeight, startLeft, startTop;
    let direction = '';
    
    handles.forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            
            const rect = panel.getBoundingClientRect();
            startWidth = rect.width;
            startHeight = rect.height;
            startLeft = rect.left;
            startTop = rect.top;
            
            direction = handle.dataset.direction;
            
            // 防止文字选中
            e.preventDefault();
            e.stopPropagation();
            
            console.log('[批量面板] 开始调整大小:', direction);
        });
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        
        const isVertical = panel.classList.contains('vertical-batch-layout');
        const minWidth = isVertical ? 200 : 800;
        const maxWidth = isVertical ? 500 : 2000;
        const minHeight = isVertical ? 200 : 10; // 横向布局最小高度10px，真正极限
        const maxHeight = window.innerHeight * 0.8;
        
        let newWidth = startWidth;
        let newHeight = startHeight;
        let newLeft = startLeft;
        let newTop = startTop;
        
        // 根据方向调整
        if (direction.includes('e')) {
            newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + deltaX));
        }
        if (direction.includes('w')) {
            newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth - deltaX));
            newLeft = startLeft + (startWidth - newWidth);
        }
        if (direction.includes('s')) {
            newHeight = Math.min(maxHeight, Math.max(minHeight, startHeight + deltaY));
        }
        if (direction.includes('n')) {
            newHeight = Math.min(maxHeight, Math.max(minHeight, startHeight - deltaY));
            newTop = startTop + (startHeight - newHeight);
        }
        
        panel.style.width = newWidth + 'px';
        panel.style.height = newHeight + 'px';  // 始终设置高度为计算值，实现无极调整
        
        // 根据高度动态切换横向/纵向布局（只对横向布局生效）
        if (!isVertical) {
            updateTallLayoutClass(panel, newHeight);
        }
        
        if (direction.includes('w')) {
            panel.style.left = newLeft + 'px';
            panel.style.right = 'auto';
        }
        if (direction.includes('n')) {
            panel.style.top = newTop + 'px';
            panel.style.bottom = 'auto';
        }
    });
    
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            
            // 最终确认布局类型
            const isVertical = panel.classList.contains('vertical-batch-layout');
            if (!isVertical) {
                const currentHeight = parseFloat(panel.style.height) || panel.offsetHeight;
                updateTallLayoutClass(panel, currentHeight);
            }
            
            // 保存大小
            saveBatchPanelState(panel);
            console.log('[批量面板] 调整大小完成，当前高度:', panel.style.height);
        }
    });
    
    console.log('[批量面板] 四边四角调整大小功能已初始化');
}

// 初始化窗口大小变化监听器（横向布局自适应）
function initBatchPanelWindowResize(panel) {
    let resizeTimer;
    window.addEventListener('resize', () => {
        // 使用防抖，避免频繁触发
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const batchPanel = document.getElementById('batch-action-panel');
            if (!batchPanel) return;
            
            // 只在横向布局时自动调整宽度
            if (batchPanel.classList.contains('horizontal-batch-layout')) {
                const viewportWidth = window.innerWidth;
                const currentWidth = parseFloat(batchPanel.style.width) || 1000;
                const maxPanelWidth = Math.min(viewportWidth * 0.95, 2000);
                
                // 如果当前宽度超过了新的最大宽度，自动调整
                if (currentWidth > maxPanelWidth) {
                    batchPanel.style.width = `${maxPanelWidth}px`;
                    console.log('[批量面板] 窗口缩小，自动调整宽度:', maxPanelWidth);
                }
                
                // 确保面板仍然居中
                batchPanel.style.left = '50%';
                batchPanel.style.transform = 'translateX(-50%)';
            }
        }, 200); // 防抖延迟200ms
    });
    
    console.log('[批量面板] 窗口大小变化监听器已初始化');
}

// 切换批量面板布局（横向/纵向）
let batchPanelHorizontal = false; // 默认纵向
function toggleBatchPanelLayout() {
    const batchPanel = document.getElementById('batch-action-panel');
    if (!batchPanel) return;
    
    batchPanelHorizontal = !batchPanelHorizontal;
    
    if (batchPanelHorizontal) {
        batchPanel.classList.add('horizontal-batch-layout');
        batchPanel.classList.remove('vertical-batch-layout');
        
        // 根据当前窗口大小计算合适的宽度
        const viewportWidth = window.innerWidth;
        const maxPanelWidth = Math.min(viewportWidth * 0.95, 2000); // 最大不超过窗口95%或2000px
        const defaultWidth = Math.min(1000, maxPanelWidth); // 默认1000px或更小
        
        // 恢复横向布局的默认样式
        batchPanel.style.width = `${defaultWidth}px`;
        batchPanel.style.height = 'auto'; // 初始高度自适应，之后可无极调整
        batchPanel.style.minWidth = '800px';
        batchPanel.style.maxWidth = '95vw';
        batchPanel.style.minHeight = '10px'; // 真正的极限压缩，最小10px
        batchPanel.style.maxHeight = '80vh';
        batchPanel.style.left = '50%';
        batchPanel.style.right = 'auto';
        batchPanel.style.transform = 'translateX(-50%)';
        batchPanel.style.bottom = '80px';
        batchPanel.style.top = 'auto';
        
        console.log('[批量面板] 横向布局宽度自适应:', { viewportWidth, defaultWidth, maxPanelWidth });
        
        // 延迟检查高度并设置tall-layout类
        setTimeout(() => {
            const currentHeight = batchPanel.offsetHeight;
            updateTallLayoutClass(batchPanel, currentHeight);
        }, 50);
        
        console.log('[批量面板] 切换到横向布局');
        // 更新按钮文字
        const btn = batchPanel.querySelector('[data-action="toggle-batch-layout"] span');
        if (btn) {
            const lang = currentLang || 'zh_CN';
            btn.textContent = lang === 'zh_CN' ? '纵向' : 'Vert';
        }
    } else {
        batchPanel.classList.remove('horizontal-batch-layout');
        batchPanel.classList.add('vertical-batch-layout');
        batchPanel.classList.remove('tall-layout'); // 纵向布局不需要tall-layout
        
        // 设置纵向布局的默认样式
        batchPanel.style.width = '280px';
        batchPanel.style.height = 'auto'; // 初始高度自适应，之后可无极调整
        batchPanel.style.minWidth = '200px';
        batchPanel.style.maxWidth = '500px';
        batchPanel.style.minHeight = '200px';
        batchPanel.style.maxHeight = '80vh';
        batchPanel.style.left = 'auto';
        batchPanel.style.right = '20px';
        batchPanel.style.transform = 'none';
        batchPanel.style.bottom = '80px';
        batchPanel.style.top = 'auto';
        
        console.log('[批量面板] 切换到纵向布局');
        // 更新按钮文字
        const btn = batchPanel.querySelector('[data-action="toggle-batch-layout"] span');
        if (btn) {
            const lang = currentLang || 'zh_CN';
            btn.textContent = lang === 'zh_CN' ? '横向' : 'Horiz';
        }
    }
    
    // 保存状态
    try {
        localStorage.setItem('batchPanelLayout', batchPanelHorizontal ? 'horizontal' : 'vertical');
        // 保存当前位置和大小
        saveBatchPanelState(batchPanel);
    } catch (e) {
        console.error('[批量面板] 保存布局状态失败:', e);
    }
}

// 保存批量面板的位置和大小
function saveBatchPanelState(panel) {
    try {
        const isVertical = panel.classList.contains('vertical-batch-layout');
        const isVisible = panel && panel.style.display !== 'none';
        const state = {
            left: panel.style.left,
            top: panel.style.top,
            bottom: panel.style.bottom,
            right: panel.style.right,
            width: panel.style.width,
            height: panel.style.height,
            transform: panel.style.transform,
            layout: isVertical ? 'vertical' : 'horizontal',
            visible: isVisible
        };
        localStorage.setItem('batchPanelState', JSON.stringify(state));
        console.log('[批量面板] 状态已保存:', state);
    } catch (e) {
        console.error('[批量面板] 保存状态失败:', e);
    }
}

// 恢复批量面板的位置和大小
function restoreBatchPanelState(panel, treeContainer) {
    try {
        const savedState = localStorage.getItem('batchPanelState');
        const savedLayout = localStorage.getItem('batchPanelLayout');
        
        if (savedState) {
            const state = JSON.parse(savedState);
            console.log('[批量面板] 恢复状态:', state);
            
            // 先恢复布局类型
            if (savedLayout === 'vertical' || state.layout === 'vertical') {
                panel.classList.remove('horizontal-batch-layout');
                panel.classList.add('vertical-batch-layout');
                batchPanelHorizontal = false;
                
                // 纵向布局恢复
                panel.style.width = state.width || '280px';
                panel.style.height = state.height || 'auto';
                panel.style.minWidth = '200px';
                panel.style.maxWidth = '500px';
                panel.style.minHeight = '200px';
                panel.style.maxHeight = '80vh';
                panel.style.right = state.right || '20px';
                panel.style.left = 'auto';
                panel.style.transform = 'none';
                if (state.top) panel.style.top = state.top;
                if (state.bottom) panel.style.bottom = state.bottom;
            } else {
                // 横向布局恢复
                panel.classList.add('horizontal-batch-layout');
                panel.classList.remove('vertical-batch-layout');
                batchPanelHorizontal = true;
                
                panel.style.width = state.width || '1000px';
                panel.style.height = state.height || 'auto';
                panel.style.minWidth = '800px';
                panel.style.maxWidth = '95vw';
                panel.style.minHeight = '150px';
                panel.style.maxHeight = '80vh';
                panel.style.left = state.left || '50%';
                panel.style.right = 'auto';
                panel.style.transform = state.transform || 'translateX(-50%)';
                if (state.top) panel.style.top = state.top;
                if (state.bottom) panel.style.bottom = state.bottom;
            }
            
            console.log('[批量面板] 状态恢复完成');
        } else {
            console.log('[批量面板] 没有保存的状态，使用默认纵向布局');
            
            // 首次显示，使用默认纵向布局设置
            panel.classList.remove('horizontal-batch-layout');
            panel.classList.add('vertical-batch-layout');
            batchPanelHorizontal = false;
            
            // 设置纵向布局的默认样式
            panel.style.width = '280px';
            panel.style.height = 'auto';
            panel.style.minWidth = '200px';
            panel.style.maxWidth = '500px';
            panel.style.minHeight = '200px';
            panel.style.maxHeight = '80vh';
            panel.style.left = 'auto';
            panel.style.right = '20px';
            panel.style.transform = 'none';
            panel.style.bottom = '80px';
            panel.style.top = 'auto';
            
            console.log('[批量面板] 首次显示使用默认纵向布局');
        }
    } catch (e) {
        console.error('[批量面板] 恢复状态失败:', e);
    }
}

// 隐藏批量面板，显示顶部工具栏
function hideBatchPanel() {
    const batchPanel = document.getElementById('batch-action-panel');
    if (batchPanel) {
        batchPanel.style.display = 'none';
        // 保存隐藏状态
        saveBatchPanelState(batchPanel);
    }
    
    // 显示顶部工具栏
    updateBatchToolbar();
    const toolbar = document.getElementById('batch-toolbar');
    if (toolbar) {
        toolbar.style.display = 'flex';
    }
    
    console.log('[批量面板] 已隐藏，显示顶部工具栏');
}

// 显示批量面板，隐藏顶部工具栏
function showBatchPanel() {
    const batchPanel = document.getElementById('batch-action-panel');
    
    // 如果面板不存在，创建它
    if (!batchPanel) {
        const fakeEvent = { preventDefault: () => {}, stopPropagation: () => {} };
        showBatchContextMenu(fakeEvent);
        console.log('[批量面板] 重新创建批量菜单');
    } else {
        // 如果面板已存在，直接显示
        batchPanel.style.display = 'block';
        console.log('[批量面板] 显示已有面板');
        // 保存显示状态
        saveBatchPanelState(batchPanel);
    }
    
    // 隐藏顶部工具栏
    const toolbar = document.getElementById('batch-toolbar');
    if (toolbar) {
        toolbar.style.display = 'none';
    }
    
    console.log('[批量面板] 已显示，隐藏顶部工具栏');
}

// 切换右键菜单布局（横向/纵向）
let contextMenuHorizontal = true;  // 默认改为横向布局
function toggleContextMenuLayout() {
    contextMenuHorizontal = !contextMenuHorizontal;
    
    const contextMenu = document.getElementById('bookmark-context-menu');
    if (!contextMenu) return;
    
    if (contextMenuHorizontal) {
        contextMenu.classList.add('horizontal-layout');
        console.log('[右键菜单] 切换到横向布局');
    } else {
        contextMenu.classList.remove('horizontal-layout');
        console.log('[右键菜单] 切换到纵向布局');
    }
    
    // 保存状态到localStorage
    try {
        localStorage.setItem('contextMenuLayout', contextMenuHorizontal ? 'horizontal' : 'vertical');
    } catch (e) {
        console.error('[右键菜单] 保存布局状态失败:', e);
    }
}

// 恢复保存的右键菜单布局状态
function restoreContextMenuLayout() {
    try {
        const savedLayout = localStorage.getItem('contextMenuLayout');
        if (savedLayout === 'vertical') {
            // 用户曾经切换到纵向，恢复为纵向
            contextMenuHorizontal = false;
            const contextMenu = document.getElementById('bookmark-context-menu');
            if (contextMenu) {
                contextMenu.classList.remove('horizontal-layout');
                console.log('[右键菜单] 恢复纵向布局');
            }
        } else {
            // 默认为横向布局（包括首次访问）
            contextMenuHorizontal = true;
            const contextMenu = document.getElementById('bookmark-context-menu');
            if (contextMenu) {
                contextMenu.classList.add('horizontal-layout');
                console.log('[右键菜单] 恢复/设置默认横向布局');
            }
        }
    } catch (e) {
        console.error('[右键菜单] 恢复布局状态失败:', e);
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
    window.initBatchToolbar = initBatchToolbar;
    window.updateBatchToolbar = updateBatchToolbar;
    window.showBatchPanel = showBatchPanel;
    window.hideBatchPanel = hideBatchPanel;
    window.initKeyboardShortcuts = initKeyboardShortcuts;
    window.initClickSelect = initClickSelect;
    window.enterSelectMode = enterSelectMode;
    window.exitSelectMode = exitSelectMode;
    window.toggleContextMenuLayout = toggleContextMenuLayout;
    window.restoreContextMenuLayout = restoreContextMenuLayout;
    
    // 页面加载时恢复布局
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', restoreContextMenuLayout);
    } else {
        restoreContextMenuLayout();
    }
}
