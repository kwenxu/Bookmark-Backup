// =============================================================================
// 数据库管理器
// 统一管理三个存储库，处理浏览器事件，协调数据同步
// =============================================================================

/**
 * 数据库管理器
 */
class DatabaseManager {
  constructor() {
    this.allHistory = new AllHistoryDatabase();        // 存储库1：所有历史
    this.bookmarks = new BookmarkDatabase();           // 存储库2：书签库
    this.bookmarkHistory = new BookmarkHistoryDatabase(); // 存储库3：书签历史
    
    this.initialized = false;
    this.eventListenersAttached = false;
    this.saveTimer = null;
    this.rematchTimer = null;
    
    this.browserAPI = getBrowserAPI();
  }

  /**
   * 初始化数据库（从缓存恢复或全量加载）
   * @param {Object} options - 选项
   * @param {boolean} options.forceRefresh - 是否强制全量刷新
   * @returns {Promise<Object>} 初始化结果
   */
  async initialize(options = {}) {
    console.log('[DatabaseManager] 开始初始化...');
    const startTime = Date.now();
    const { forceRefresh = false } = options;

    try {
      // 尝试从缓存恢复
      let hasCache = false;
      if (!forceRefresh) {
        const [restored1, restored2, restored3] = await Promise.all([
          this.allHistory.restore(),
          this.bookmarks.restore(),
          this.bookmarkHistory.restore()
        ]);
        hasCache = restored1 || restored2 || restored3;
      }

      if (hasCache) {
        console.log('[DatabaseManager] 从缓存恢复成功');
        console.log('- 存储库1:', this.allHistory.getStats());
        console.log('- 存储库2:', this.bookmarks.getStats());
        console.log('- 存储库3:', this.bookmarkHistory.getStats());

        // 后台执行增量更新
        this.performIncrementalUpdate().catch(err => {
          console.error('[DatabaseManager] 增量更新失败:', err);
        });
      } else {
        console.log('[DatabaseManager] 无缓存，执行全量加载');
        await this.performFullLoad();
      }

      // 附加事件监听器
      this.attachEventListeners();

      this.initialized = true;
      const duration = Date.now() - startTime;
      
      console.log('[DatabaseManager] 初始化完成，耗时:', duration, 'ms');
      
      return {
        success: true,
        fromCache: hasCache,
        duration: duration,
        stats: this.getStats()
      };
    } catch (error) {
      console.error('[DatabaseManager] 初始化失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 执行全量加载
   * @returns {Promise<void>}
   */
  async performFullLoad() {
    console.log('[DatabaseManager] 执行全量加载...');
    
    try {
      // 1. 加载书签（先加载，用于后续匹配）
      await this.bookmarks.loadFromBrowser();
      
      // 2. 加载所有历史记录
      await this.allHistory.loadFromBrowser({
        startTime: 0,
        endTime: Date.now()
      });
      
      // 3. 重建书签历史库（从存储库1和2匹配）
      this.bookmarkHistory.rebuildFrom(this.allHistory, this.bookmarks);
      
      // 4. 保存所有数据
      await this.saveAll();
      
      console.log('[DatabaseManager] 全量加载完成');
    } catch (error) {
      console.error('[DatabaseManager] 全量加载失败:', error);
      throw error;
    }
  }

  /**
   * 执行增量更新
   * @returns {Promise<void>}
   */
  async performIncrementalUpdate() {
    console.log('[DatabaseManager] 执行增量更新...');
    
    try {
      const lastSyncTime = this.allHistory.getLastSyncTime();
      const now = Date.now();
      
      if (lastSyncTime === 0) {
        console.log('[DatabaseManager] 无同步记录，跳过增量更新');
        return;
      }
      
      // 1. 重新加载书签（快速，确保最新）
      await this.bookmarks.loadFromBrowser();
      
      // 2. 增量加载历史记录（仅加载最后同步时间之后的）
      const newRecords = await this.allHistory.loadFromBrowser({
        startTime: lastSyncTime,
        endTime: now
      });
      
      // 3. 检查新记录是否匹配书签，如果匹配则添加到存储库3
      let matched = 0;
      for (const record of newRecords) {
        if (this.bookmarks.matches(record)) {
          this.bookmarkHistory.add(record);
          matched++;
        }
      }
      
      console.log('[DatabaseManager] 增量更新完成，新增', newRecords.length, '条，匹配', matched, '条');
      
      // 4. 保存
      await this.saveAll();
    } catch (error) {
      console.error('[DatabaseManager] 增量更新失败:', error);
    }
  }

  /**
   * 附加浏览器事件监听器
   */
  attachEventListeners() {
    if (this.eventListenersAttached) {
      console.log('[DatabaseManager] 事件监听器已附加');
      return;
    }

    if (!this.browserAPI) {
      console.warn('[DatabaseManager] 浏览器API不可用，无法附加事件监听器');
      return;
    }

    console.log('[DatabaseManager] 附加事件监听器...');

    // 监听历史记录访问
    if (this.browserAPI.history?.onVisited) {
      this.browserAPI.history.onVisited.addListener(async (visitItem) => {
        await this.handleHistoryVisited(visitItem);
      });
      console.log('[DatabaseManager] ✓ history.onVisited');
    }

    // 监听书签创建
    if (this.browserAPI.bookmarks?.onCreated) {
      this.browserAPI.bookmarks.onCreated.addListener(async (id, bookmark) => {
        await this.handleBookmarkCreated(bookmark);
      });
      console.log('[DatabaseManager] ✓ bookmarks.onCreated');
    }

    // 监听书签删除
    if (this.browserAPI.bookmarks?.onRemoved) {
      this.browserAPI.bookmarks.onRemoved.addListener(async (id, removeInfo) => {
        await this.handleBookmarkRemoved(removeInfo);
      });
      console.log('[DatabaseManager] ✓ bookmarks.onRemoved');
    }

    // 监听书签修改
    if (this.browserAPI.bookmarks?.onChanged) {
      this.browserAPI.bookmarks.onChanged.addListener(async (id, changeInfo) => {
        await this.handleBookmarkChanged(id, changeInfo);
      });
      console.log('[DatabaseManager] ✓ bookmarks.onChanged');
    }

    // 监听历史记录删除
    if (this.browserAPI.history?.onVisitRemoved) {
      this.browserAPI.history.onVisitRemoved.addListener(async (removeInfo) => {
        await this.handleHistoryVisitRemoved(removeInfo);
      });
      console.log('[DatabaseManager] ✓ history.onVisitRemoved');
    }

    this.eventListenersAttached = true;
  }

  /**
   * 处理历史记录访问事件（增量添加）
   * @param {Object} visitItem - 访问项
   */
  async handleHistoryVisited(visitItem) {
    if (!visitItem || !visitItem.url) return;

    console.log('[DatabaseManager] 历史记录访问:', visitItem.url);

    try {
      const record = {
        id: generateId(),
        url: normalizeUrl(visitItem.url),
        title: normalizeTitle(visitItem.title) || visitItem.url,
        visitTime: visitItem.visitTime || Date.now(),
        visitCount: 1,
        transition: visitItem.transition || 'link'
      };

      // 添加到存储库1
      this.allHistory.add(record);

      // ✨ 使用 matches() 实现 URL + 标题双重匹配
      // 检查是否匹配书签，如果匹配则添加到存储库3
      if (this.bookmarks.matches(record)) {
        this.bookmarkHistory.add(record);
        console.log('[DatabaseManager] 匹配书签（URL或标题），添加到存储库3');
      }

      // 延迟保存
      this.scheduleSave();

      // ✨ 立即派发事件（不延迟），确保UI实时更新
      this.emit('updated', { 
        type: 'history', 
        action: 'visited',
        url: record.url
      });
    } catch (error) {
      console.error('[DatabaseManager] 处理访问事件失败:', error);
    }
  }

  /**
   * 处理书签创建事件（增量添加）
   * @param {Object} bookmark - 书签对象
   */
  async handleBookmarkCreated(bookmark) {
    console.log('[DatabaseManager] 书签创建:', bookmark.url);

    try {
      // 添加到存储库2
      this.bookmarks.add(bookmark);

      // ✨ 检查存储库1中是否有匹配的历史记录（URL 或标题匹配）
      const historyRecords = this.allHistory.getByUrlOrTitle(bookmark.url, bookmark.title);
      if (historyRecords.length > 0) {
        // 有匹配的历史记录，添加到存储库3
        for (const record of historyRecords) {
          this.bookmarkHistory.add(record);
        }
        console.log('[DatabaseManager] 添加', historyRecords.length, '条历史记录到存储库3 (URL+标题匹配)');
      }

      // 延迟保存
      this.scheduleSave();

      // ✨ 立即派发事件（不延迟），确保UI实时更新
      this.emit('updated', { 
        type: 'bookmark', 
        action: 'created',
        url: bookmark.url
      });
    } catch (error) {
      console.error('[DatabaseManager] 处理书签创建失败:', error);
    }
  }

  /**
   * 处理书签删除事件（减量删除）
   * @param {Object} removeInfo - 删除信息
   */
  async handleBookmarkRemoved(removeInfo) {
    console.log('[DatabaseManager] 书签删除:', removeInfo.node?.url);

    try {
      const url = removeInfo.node?.url;
      const title = removeInfo.node?.title;

      // 从存储库2删除
      this.bookmarks.remove(url, title);

      // ✨ 从存储库3删除该URL的所有记录
      // 注意：如果通过标题匹配的记录，也需要删除
      // 但由于标题可能对应多个URL，这里只删除URL匹配的记录
      if (url) {
        this.bookmarkHistory.removeByUrl(url);
      }

      // 延迟保存
      this.scheduleSave();

      // ✨ 立即派发事件（不延迟），确保UI实时更新
      this.emit('updated', { 
        type: 'bookmark', 
        action: 'removed',
        url: url
      });
    } catch (error) {
      console.error('[DatabaseManager] 处理书签删除失败:', error);
    }
  }

  /**
   * 处理书签修改事件
   * @param {string} id - 书签ID
   * @param {Object} changeInfo - 变更信息
   */
  async handleBookmarkChanged(id, changeInfo) {
    console.log('[DatabaseManager] 书签修改:', changeInfo);

    try {
      this.bookmarks.update(id, changeInfo);

      // 如果URL或标题改变，需要重新匹配
      if (changeInfo.url || changeInfo.title) {
        this.scheduleRematch();
      }
    } catch (error) {
      console.error('[DatabaseManager] 处理书签修改失败:', error);
    }
  }

  /**
   * 处理历史记录删除事件（减量删除）
   * @param {Object} removeInfo - 删除信息
   */
  async handleHistoryVisitRemoved(removeInfo) {
    console.log('[DatabaseManager] 历史记录删除:', removeInfo);

    try {
      // 情况1：清除所有历史
      if (removeInfo.allHistory) {
        console.log('[DatabaseManager] 清除所有历史记录');
        this.allHistory.clear();
        this.bookmarkHistory.clear();
        
        // 延迟保存
        this.scheduleSave();
        
        // ✨ 立即派发事件（不延迟），确保UI实时更新
        this.emit('updated', { 
          type: 'history', 
          action: 'cleared' 
        });
        return;
      }

      // 情况2：删除指定URL
      if (Array.isArray(removeInfo.urls) && removeInfo.urls.length > 0) {
        console.log('[DatabaseManager] 删除指定URL:', removeInfo.urls);

        for (const url of removeInfo.urls) {
          // 从存储库1删除
          this.allHistory.removeByUrl(url);

          // ✨ 如果是书签（URL或标题匹配），从存储库3删除
          if (this.bookmarks.hasUrl(url)) {
            this.bookmarkHistory.removeByUrl(url);
          }
        }

        // 延迟保存
        this.scheduleSave();
        
        // ✨ 立即派发事件（不延迟），确保UI实时更新
        this.emit('updated', { 
          type: 'history', 
          action: 'removed',
          urls: removeInfo.urls
        });
      }
    } catch (error) {
      console.error('[DatabaseManager] 处理历史删除失败:', error);
    }
  }

  /**
   * 延迟保存（防抖）
   */
  scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveAll().catch(err => {
        console.error('[DatabaseManager] 延迟保存失败:', err);
      });
      this.saveTimer = null;
    }, 2000); // 2秒后保存
  }

  /**
   * 延迟重新匹配（防抖）
   */
  scheduleRematch() {
    if (this.rematchTimer) clearTimeout(this.rematchTimer);
    this.rematchTimer = setTimeout(() => {
      console.log('[DatabaseManager] 执行重新匹配（URL+标题双重匹配）');
      this.bookmarkHistory.rebuildFrom(this.allHistory, this.bookmarks);
      
      // 延迟保存
      this.scheduleSave();
      
      // ✨ 立即派发事件（不延迟），确保UI实时更新
      this.emit('updated', { type: 'bookmark', action: 'changed' });
      
      this.rematchTimer = null;
    }, 500); // ✨ 减少延迟到500ms，提高响应速度
  }

  /**
   * 保存所有数据库
   * @returns {Promise<void>}
   */
  async saveAll() {
    try {
      await Promise.all([
        this.allHistory.save(),
        this.bookmarks.save(),
        this.bookmarkHistory.save()
      ]);
    } catch (error) {
      console.error('[DatabaseManager] 保存失败:', error);
    }
  }

  /**
   * 清空所有数据库
   * @returns {Promise<void>}
   */
  async clearAll() {
    console.log('[DatabaseManager] 清空所有数据库');
    this.allHistory.clear();
    this.bookmarks.clear();
    this.bookmarkHistory.clear();
    await this.saveAll();
    this.emit('updated', { type: 'all', action: 'cleared' });
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      allHistory: this.allHistory.getStats(),
      bookmarks: this.bookmarks.getStats(),
      bookmarkHistory: this.bookmarkHistory.getStats(),
      initialized: this.initialized
    };
  }

  /**
   * 派发事件
   * @param {string} eventName - 事件名
   * @param {Object} detail - 事件详情
   */
  emit(eventName, detail) {
    if (typeof document !== 'undefined') {
      const event = new CustomEvent(`browsingData${eventName.charAt(0).toUpperCase() + eventName.slice(1)}`, {
        detail: detail
      });
      document.dispatchEvent(event);
      console.log('[DatabaseManager] 派发事件:', eventName, detail);
    }
  }

  /**
   * 获取所有历史记录数据库
   * @returns {AllHistoryDatabase}
   */
  getAllHistoryDB() {
    return this.allHistory;
  }

  /**
   * 获取书签数据库
   * @returns {BookmarkDatabase}
   */
  getBookmarksDB() {
    return this.bookmarks;
  }

  /**
   * 获取书签历史数据库
   * @returns {BookmarkHistoryDatabase}
   */
  getBookmarkHistoryDB() {
    return this.bookmarkHistory;
  }
}

// 导出（兼容不同模块系统）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DatabaseManager;
}
