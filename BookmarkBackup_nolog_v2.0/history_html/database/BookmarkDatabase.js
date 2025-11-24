// =============================================================================
// 存储库2：书签数据库
// 存储所有书签的 URL 和标题，用于快速匹配
// =============================================================================

/**
 * 书签数据库
 */
class BookmarkDatabase {
  constructor() {
    this.storageKey = 'bb_bookmarks_v2';
    this.urls = new Set();          // Set<string> 所有书签URL
    this.titles = new Set();        // Set<string> 所有书签标题
    this.urlToTitle = new Map();    // Map<url, title> URL到标题的映射
    this.lastSyncTime = 0;
    this.initialized = false;
  }

  /**
   * 从持久化存储恢复数据
   * @returns {Promise<boolean>} 是否成功恢复
   */
  async restore() {
    try {
      console.log('[BookmarkDB] 开始恢复数据...');
      const cached = await readStorage(this.storageKey);
      
      if (!cached) {
        console.log('[BookmarkDB] 无缓存数据');
        return false;
      }

      this.urls = deserializeSet(cached.urls || []);
      this.titles = deserializeSet(cached.titles || []);
      this.urlToTitle = deserializeMap(cached.urlToTitle || []);
      this.lastSyncTime = cached.lastSyncTime || 0;
      this.initialized = true;

      console.log('[BookmarkDB] 恢复完成，URL数:', this.urls.size, '标题数:', this.titles.size);
      return true;
    } catch (error) {
      console.error('[BookmarkDB] 恢复失败:', error);
      return false;
    }
  }

  /**
   * 保存到持久化存储
   * @returns {Promise<void>}
   */
  async save() {
    try {
      const data = {
        lastSyncTime: this.lastSyncTime,
        urls: serializeSet(this.urls),
        titles: serializeSet(this.titles),
        urlToTitle: serializeMap(this.urlToTitle)
      };
      await writeStorage(this.storageKey, data);
      console.log('[BookmarkDB] 保存完成，URL数:', this.urls.size);
    } catch (error) {
      console.error('[BookmarkDB] 保存失败:', error);
    }
  }

  /**
   * 从浏览器加载书签
   * @returns {Promise<number>} 加载的书签数量
   */
  async loadFromBrowser() {
    const browserAPI = getBrowserAPI();
    if (!browserAPI || !browserAPI.bookmarks) {
      throw new Error('Bookmarks API not available');
    }

    console.log('[BookmarkDB] 开始加载书签...');

    try {
      // 获取书签树
      const bookmarkTree = await new Promise((resolve, reject) => {
        browserAPI.bookmarks.getTree((results) => {
          if (browserAPI.runtime && browserAPI.runtime.lastError) {
            reject(browserAPI.runtime.lastError);
          } else {
            resolve(results || []);
          }
        });
      });

      // 清空旧数据
      this.urls.clear();
      this.titles.clear();
      this.urlToTitle.clear();

      // 递归遍历书签树
      const traverse = (nodes) => {
        if (!Array.isArray(nodes)) return;
        
        for (const node of nodes) {
          if (node.url) {
            // 这是一个书签
            const url = normalizeUrl(node.url);
            const title = normalizeTitle(node.title);
            
            if (url) {
              this.urls.add(url);
              if (title) {
                this.titles.add(title);
                this.urlToTitle.set(url, title);
              }
            }
          }
          
          // 递归处理子节点
          if (node.children) {
            traverse(node.children);
          }
        }
      };

      traverse(bookmarkTree);
      this.lastSyncTime = Date.now();

      console.log('[BookmarkDB] 加载完成，URL数:', this.urls.size, '标题数:', this.titles.size);
      return this.urls.size;
    } catch (error) {
      console.error('[BookmarkDB] 加载失败:', error);
      throw error;
    }
  }

  /**
   * 添加书签
   * @param {Object} bookmark - 书签对象
   */
  add(bookmark) {
    if (!bookmark) return;

    const url = normalizeUrl(bookmark.url);
    const title = normalizeTitle(bookmark.title);

    if (url) {
      this.urls.add(url);
      if (title) {
        this.titles.add(title);
        this.urlToTitle.set(url, title);
      }
      console.log('[BookmarkDB] 添加书签:', url);
    }
  }

  /**
   * 删除书签
   * @param {string} url - 书签URL
   * @param {string} title - 书签标题（可选）
   */
  remove(url, title) {
    const normalizedUrl = normalizeUrl(url);
    const normalizedTitle = normalizeTitle(title);

    if (normalizedUrl) {
      this.urls.delete(normalizedUrl);
      this.urlToTitle.delete(normalizedUrl);
      console.log('[BookmarkDB] 删除书签URL:', normalizedUrl);
    }

    if (normalizedTitle) {
      this.titles.delete(normalizedTitle);
      console.log('[BookmarkDB] 删除书签标题:', normalizedTitle);
    }
  }

  /**
   * 更新书签
   * @param {string} id - 书签ID
   * @param {Object} changeInfo - 变更信息
   */
  update(id, changeInfo) {
    // 如果有旧URL，先删除
    if (changeInfo.oldUrl) {
      const oldUrl = normalizeUrl(changeInfo.oldUrl);
      const oldTitle = this.urlToTitle.get(oldUrl);
      this.remove(oldUrl, oldTitle);
    }

    // 添加新的URL和标题
    if (changeInfo.url || changeInfo.title) {
      this.add({
        url: changeInfo.url || changeInfo.oldUrl,
        title: changeInfo.title
      });
    }
  }

  /**
   * 判断记录是否匹配书签
   * @param {Object} record - 历史记录
   * @returns {boolean} 是否匹配
   */
  matches(record) {
    if (!record) return false;

    const url = normalizeUrl(record.url);
    const title = normalizeTitle(record.title);

    // URL 匹配
    if (url && this.urls.has(url)) {
      return true;
    }

    // 标题匹配
    if (title && this.titles.has(title)) {
      return true;
    }

    return false;
  }

  /**
   * 判断URL是否是书签
   * @param {string} url - URL
   * @returns {boolean}
   */
  hasUrl(url) {
    const normalizedUrl = normalizeUrl(url);
    return normalizedUrl ? this.urls.has(normalizedUrl) : false;
  }

  /**
   * 判断标题是否是书签
   * @param {string} title - 标题
   * @returns {boolean}
   */
  hasTitle(title) {
    const normalizedTitle = normalizeTitle(title);
    return normalizedTitle ? this.titles.has(normalizedTitle) : false;
  }

  /**
   * 获取URL对应的标题
   * @param {string} url - URL
   * @returns {string|null} 标题
   */
  getTitleByUrl(url) {
    const normalizedUrl = normalizeUrl(url);
    return normalizedUrl ? this.urlToTitle.get(normalizedUrl) || null : null;
  }

  /**
   * 获取所有书签URL
   * @returns {Set} URL集合
   */
  getAllUrls() {
    return new Set(this.urls);
  }

  /**
   * 获取所有书签标题
   * @returns {Set} 标题集合
   */
  getAllTitles() {
    return new Set(this.titles);
  }

  /**
   * 清空所有数据
   */
  clear() {
    this.urls.clear();
    this.titles.clear();
    this.urlToTitle.clear();
    console.log('[BookmarkDB] 清空所有数据');
  }

  /**
   * 是否有数据
   * @returns {boolean}
   */
  hasData() {
    return this.urls.size > 0;
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      urls: this.urls.size,
      titles: this.titles.size,
      lastSyncTime: this.lastSyncTime,
      initialized: this.initialized
    };
  }
}

// 导出（兼容不同模块系统）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BookmarkDatabase;
}
