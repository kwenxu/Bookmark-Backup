/**
 * 安全的标签页操作工具
 * 解决用户拖拽标签页时的操作冲突问题
 */

/**
 * 安全地创建新标签页，带有重试机制处理拖拽冲突。
 * @param {Object} createProperties - chrome.tabs.create 的参数
 * @param {number} [maxRetries=3] - 最大重试次数
 * @param {number} [retryDelay=150] - 重试延迟（毫秒）
 * @returns {Promise<chrome.tabs.Tab|null>} 创建的标签页对象，失败返回 null
 */
async function safeCreateTab(createProperties, maxRetries = 3, retryDelay = 150) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await new Promise((resolve, reject) => {
                chrome.tabs.create(createProperties, (tab) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(tab);
                    }
                });
            });
        } catch (error) {
            const errorMsg = error.message || String(error);
            const isDraggingError = errorMsg.includes('user may be dragging') || 
                                   errorMsg.includes('cannot be edited right now') ||
                                   errorMsg.includes('Tabs cannot be edited');
            
            // 如果是拖拽错误且还有重试机会，等待后重试
            if (isDraggingError && attempt < maxRetries) {
                console.log(`[safeCreateTab] 检测到标签页拖拽冲突，等待 ${retryDelay}ms 后重试 (${attempt + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                continue;
            }
            
            // 其他错误或重试次数用尽，记录并返回 null
            console.error('[safeCreateTab] 创建标签页失败:', errorMsg);
            return null;
        }
    }
    return null;
}
