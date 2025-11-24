// =============================================================================
// 存储库1：所有浏览器历史记录数据库
// 存储所有浏览器历史记录（不过滤），永久保留
// =============================================================================

/**
 * 所有历史记录数据库
 */
class AllHistoryDatabase {
  constructor() {
    this.storageKey = 'bb_all_history_v2';
    this.records = new Map(); // Map<'YYYY-MM-DD', Record[]>
    this.lastSyncTime = 0;
    this.initialized = false;
  }

  /**
   * 从持久化存储恢复数据
   * @returns {Promise<boolean>} 是否成功恢复
   */
  async restore() {
    try {
      console.log('[AllHistoryDB] 开始恢复数据...');
      const cached = await readStorage(this.storageKey);
      
      if (!cached || !Array.isArray(cached.records)) {
        console.log('[AllHistoryDB] 无缓存数据');
        return false;
      }

      this.records = deserializeMap(cached.records);
      this.lastSyncTime = cached.lastSyncTime || 0;
      this.initialized = true;

      console.log('[AllHistoryDB] 恢复完成，天数:', this.records.size, '最后同步:', new Date(this.lastSyncTime));
      return true;
    } catch (error) {
      console.error('[AllHistoryDB] 恢复失败:', error);
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
        records: serializeMap(this.records)
      };
      await writeStorage(this.storageKey, data);
      console.log('[AllHistoryDB] 保存完成，天数:', this.records.size);
    } catch (error) {
      console.error('[AllHistoryDB] 保存失败:', error);
    }
  }

  /**
   * 从浏览器加载历史记录
   * @param {Object} options - 选项
   * @param {number} options.startTime - 开始时间戳（0表示全量加载）
   * @param {number} options.endTime - 结束时间戳
   * @returns {Promise<Array>} 新加载的记录
   */
  async loadFromBrowser(options = {}) {
    const browserAPI = getBrowserAPI();
    if (!browserAPI || !browserAPI.history) {
      throw new Error('History API not available');
    }

    const { startTime = 0, endTime = Date.now() } = options;
    const isIncremental = startTime > 0;

    console.log('[AllHistoryDB] 开始加载历史记录', isIncremental ? '(增量)' : '(全量)');

    try {
      // 查询历史记录
      const historyItems = await new Promise((resolve, reject) => {
        browserAPI.history.search({
          text: '',
          startTime: startTime,
          endTime: endTime,
          maxResults: 0  // 不限制数量
        }, (results) => {
          if (browserAPI.runtime && browserAPI.runtime.lastError) {
            reject(browserAPI.runtime.lastError);
          } else {
            resolve(results || []);
          }
        });
      });

      console.log('[AllHistoryDB] 查询到', historyItems.length, '条历史记录');

      // 添加到数据库
      const newRecords = [];
      for (const item of historyItems) {
        if (!item.url) continue;

        const record = {
          id: generateId(),
          url: normalizeUrl(item.url),
          title: normalizeTitle(item.title) || item.url,
          visitTime: item.lastVisitTime || Date.now(),
          visitCount: item.visitCount || 1,
          typedCount: item.typedCount || 0
        };

        this.add(record);
        newRecords.push(record);
      }

      this.lastSyncTime = endTime;
      console.log('[AllHistoryDB] 加载完成，新增', newRecords.length, '条');
      
      return newRecords;
    } catch (error) {
      console.error('[AllHistoryDB] 加载失败:', error);
      throw error;
    }
  }

  /**
   * 添加记录
   * @param {Object} record - 记录对象
   */
  add(record) {
    if (!record || !record.url || !record.visitTime) return;

    const dateKey = getDateKey(record.visitTime);
    if (!this.records.has(dateKey)) {
      this.records.set(dateKey, []);
    }

    this.records.get(dateKey).push(record);
  }

  /**
   * 删除指定URL的所有记录
   * @param {string} url - 要删除的URL
   * @returns {number} 删除的记录数
   */
  removeByUrl(url) {
    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl) return 0;

    let removed = 0;
    for (const [dateKey, records] of this.records.entries()) {
      const filtered = records.filter(r => normalizeUrl(r.url) !== normalizedUrl);
      removed += records.length - filtered.length;

      if (filtered.length === 0) {
        this.records.delete(dateKey);
      } else if (filtered.length < records.length) {
        this.records.set(dateKey, filtered);
      }
    }

    if (removed > 0) {
      console.log('[AllHistoryDB] 删除URL记录:', url, '共', removed, '条');
    }
    return removed;
  }

  /**
   * 清空所有记录
   */
  clear() {
    const count = this.getRecordCount();
    this.records.clear();
    this.lastSyncTime = Date.now();
    console.log('[AllHistoryDB] 清空所有记录，共', count, '条');
  }

  /**
   * 查询指定URL的所有记录
   * @param {string} url - 要查询的URL
   * @returns {Array} 记录数组
   */
  getByUrl(url) {
    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl) return [];

    const results = [];
    for (const records of this.records.values()) {
      for (const record of records) {
        if (normalizeUrl(record.url) === normalizedUrl) {
          results.push(record);
        }
      }
    }
    return results;
  }

  /**
   * 获取指定时间范围的记录
   * @param {number} startTime - 开始时间戳
   * @param {number} endTime - 结束时间戳
   * @returns {Map} 记录 Map
   */
  getRecordsInRange(startTime, endTime) {
    const results = new Map();
    
    for (const [dateKey, records] of this.records.entries()) {
      const dateTime = parseDateKey(dateKey);
      if (dateTime >= startTime && dateTime <= endTime) {
        results.set(dateKey, records);
      }
    }
    
    return results;
  }

  /**
   * 获取所有记录
   * @returns {Map} 所有记录
   */
  getAllRecords() {
    return this.records;
  }

  /**
   * 获取记录总数
   * @returns {number}
   */
  getRecordCount() {
    let count = 0;
    for (const records of this.records.values()) {
      count += records.length;
    }
    return count;
  }

  /**
   * 获取最后同步时间
   * @returns {number}
   */
  getLastSyncTime() {
    return this.lastSyncTime;
  }

  /**
   * 是否有数据
   * @returns {boolean}
   */
  hasData() {
    return this.records.size > 0;
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      days: this.records.size,
      records: this.getRecordCount(),
      lastSyncTime: this.lastSyncTime,
      initialized: this.initialized
    };
  }
}

// 导出（兼容不同模块系统）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AllHistoryDatabase;
}
