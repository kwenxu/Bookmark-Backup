// =============================================================================
// 存储库3：书签关联历史记录数据库
// 存储匹配到书签的历史记录（存储库1 ∩ 存储库2）
// =============================================================================

/**
 * 书签历史记录数据库
 */
class BookmarkHistoryDatabase {
  constructor() {
    this.storageKey = 'bb_bookmark_history_v2';
    this.records = new Map(); // Map<'YYYY-MM-DD', Record[]>
    this.urlSet = new Set();  // 快速查询用的URL集合
    this.lastUpdateTime = 0;
    this.initialized = false;
  }

  /**
   * 从持久化存储恢复数据
   * @returns {Promise<boolean>} 是否成功恢复
   */
  async restore() {
    try {
      console.log('[BookmarkHistoryDB] 开始恢复数据...');
      const cached = await readStorage(this.storageKey);
      
      if (!cached || !Array.isArray(cached.records)) {
        console.log('[BookmarkHistoryDB] 无缓存数据');
        return false;
      }

      this.records = deserializeMap(cached.records);
      this.urlSet = deserializeSet(cached.urlSet || []);
      this.lastUpdateTime = cached.lastUpdateTime || 0;
      this.initialized = true;

      console.log('[BookmarkHistoryDB] 恢复完成，天数:', this.records.size, 'URL数:', this.urlSet.size);
      return true;
    } catch (error) {
      console.error('[BookmarkHistoryDB] 恢复失败:', error);
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
        lastUpdateTime: this.lastUpdateTime,
        records: serializeMap(this.records),
        urlSet: serializeSet(this.urlSet)
      };
      await writeStorage(this.storageKey, data);
      console.log('[BookmarkHistoryDB] 保存完成，天数:', this.records.size);
    } catch (error) {
      console.error('[BookmarkHistoryDB] 保存失败:', error);
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
    
    const url = normalizeUrl(record.url);
    if (url) {
      this.urlSet.add(url);
    }

    this.lastUpdateTime = Date.now();
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

    this.urlSet.delete(normalizedUrl);

    if (removed > 0) {
      console.log('[BookmarkHistoryDB] 删除URL记录:', url, '共', removed, '条');
      this.lastUpdateTime = Date.now();
    }
    return removed;
  }

  /**
   * 清空所有记录
   */
  clear() {
    const count = this.getRecordCount();
    this.records.clear();
    this.urlSet.clear();
    this.lastUpdateTime = Date.now();
    console.log('[BookmarkHistoryDB] 清空所有记录，共', count, '条');
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
   * 获取所有书签URL集合
   * @returns {Set} URL集合
   */
  getAllUrls() {
    return new Set(this.urlSet);
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
   * 判断URL是否存在
   * @param {string} url - URL
   * @returns {boolean}
   */
  hasUrl(url) {
    const normalizedUrl = normalizeUrl(url);
    return normalizedUrl ? this.urlSet.has(normalizedUrl) : false;
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
      urls: this.urlSet.size,
      lastUpdateTime: this.lastUpdateTime,
      initialized: this.initialized
    };
  }

  /**
   * 从存储库1和存储库2重建数据
   * @param {AllHistoryDatabase} allHistoryDB - 所有历史记录数据库
   * @param {BookmarkDatabase} bookmarkDB - 书签数据库
   * @returns {number} 匹配的记录数
   */
  rebuildFrom(allHistoryDB, bookmarkDB) {
    console.log('[BookmarkHistoryDB] 开始重建数据（URL + 标题并集匹配）...');
    
    this.clear();
    
    let matched = 0;
    let urlMatched = 0;
    let titleMatched = 0;
    const allRecords = allHistoryDB.getAllRecords();
    
    for (const [dateKey, records] of allRecords.entries()) {
      for (const record of records) {
        // ✨ 使用 bookmarkDB.matches() 实现 URL + 标题并集匹配
        if (bookmarkDB.matches(record)) {
          this.add(record);
          matched++;
          
          // 统计匹配类型（用于调试）
          const url = normalizeUrl(record.url);
          const title = normalizeTitle(record.title);
          if (url && bookmarkDB.hasUrl(url)) urlMatched++;
          if (title && bookmarkDB.hasTitle(title)) titleMatched++;
        }
      }
    }
    
    console.log('[BookmarkHistoryDB] 重建完成，匹配', matched, '条记录');
    console.log('  - URL匹配:', urlMatched, '条');
    console.log('  - 标题匹配:', titleMatched, '条');
    return matched;
  }
}

// 导出（兼容不同模块系统）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BookmarkHistoryDatabase;
}
