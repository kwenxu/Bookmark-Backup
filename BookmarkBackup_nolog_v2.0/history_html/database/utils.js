// =============================================================================
// 数据库工具函数
// =============================================================================

/**
 * 获取浏览器 API（兼容 Chrome/Edge/Firefox）
 */
function getBrowserAPI() {
  return (typeof chrome !== 'undefined' && chrome.runtime) ? chrome : 
         (typeof browser !== 'undefined' && browser.runtime) ? browser : null;
}

/**
 * 获取存储区域（chrome.storage.local）
 */
function getStorageArea() {
  const browserAPI = getBrowserAPI();
  if (browserAPI && browserAPI.storage && browserAPI.storage.local) {
    return browserAPI.storage.local;
  }
  return null;
}

/**
 * 从持久化存储读取数据
 * @param {string} key - 存储键名
 * @returns {Promise<any>} 存储的数据
 */
function readStorage(key) {
  return new Promise((resolve) => {
    const storageArea = getStorageArea();
    if (storageArea) {
      storageArea.get([key], (result) => {
        const browserAPI = getBrowserAPI();
        if (browserAPI && browserAPI.runtime && browserAPI.runtime.lastError) {
          console.warn('[Storage] 读取失败:', browserAPI.runtime.lastError.message);
          resolve(null);
          return;
        }
        resolve(result ? result[key] : null);
      });
      return;
    }

    // 降级到 localStorage
    try {
      const raw = localStorage.getItem(key);
      resolve(raw ? JSON.parse(raw) : null);
    } catch (error) {
      console.warn('[Storage] 读取 localStorage 失败:', error);
      resolve(null);
    }
  });
}

/**
 * 写入持久化存储
 * @param {string} key - 存储键名
 * @param {any} value - 要存储的数据
 * @returns {Promise<void>}
 */
function writeStorage(key, value) {
  return new Promise((resolve) => {
    const storageArea = getStorageArea();
    if (storageArea) {
      storageArea.set({ [key]: value }, () => {
        const browserAPI = getBrowserAPI();
        if (browserAPI && browserAPI.runtime && browserAPI.runtime.lastError) {
          console.warn('[Storage] 写入失败:', browserAPI.runtime.lastError.message);
        }
        resolve();
      });
      return;
    }

    // 降级到 localStorage
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn('[Storage] 写入 localStorage 失败:', error);
    }
    resolve();
  });
}

/**
 * 从 Date 对象生成日期键 'YYYY-MM-DD'
 * @param {Date|number} date - 日期对象或时间戳
 * @returns {string} 日期键
 */
function getDateKey(date) {
  const d = typeof date === 'number' ? new Date(date) : date;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 从日期键解析为时间戳
 * @param {string} dateKey - 'YYYY-MM-DD' 格式的日期键
 * @returns {number} 该日期 00:00:00 的时间戳
 */
function parseDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
}

/**
 * 生成唯一ID
 * @returns {string} 唯一ID
 */
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 规范化 URL（去除末尾斜杠等）
 * @param {string} url - 原始 URL
 * @returns {string|null} 规范化后的 URL
 */
function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return null;
  
  try {
    let normalized = url.trim();
    // 去除末尾斜杠（但保留根路径的斜杠）
    if (normalized.length > 1 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch (e) {
    return null;
  }
}

/**
 * 规范化标题（去除首尾空白）
 * @param {string} title - 原始标题
 * @returns {string|null} 规范化后的标题
 */
function normalizeTitle(title) {
  if (!title || typeof title !== 'string') return null;
  const normalized = title.trim();
  return normalized || null;
}

/**
 * 深拷贝对象（用于避免引用问题）
 * @param {any} obj - 要拷贝的对象
 * @returns {any} 拷贝后的对象
 */
function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime());
  if (obj instanceof Array) return obj.map(item => deepClone(item));
  if (obj instanceof Set) return new Set(Array.from(obj));
  if (obj instanceof Map) return new Map(Array.from(obj));
  
  const cloned = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  return cloned;
}

/**
 * Map 序列化为数组（用于存储）
 * @param {Map} map - Map 对象
 * @returns {Array} 序列化后的数组
 */
function serializeMap(map) {
  return Array.from(map.entries());
}

/**
 * 数组反序列化为 Map
 * @param {Array} arr - 序列化的数组
 * @returns {Map} Map 对象
 */
function deserializeMap(arr) {
  return new Map(arr);
}

/**
 * Set 序列化为数组（用于存储）
 * @param {Set} set - Set 对象
 * @returns {Array} 序列化后的数组
 */
function serializeSet(set) {
  return Array.from(set);
}

/**
 * 数组反序列化为 Set
 * @param {Array} arr - 序列化的数组
 * @returns {Set} Set 对象
 */
function deserializeSet(arr) {
  return new Set(arr);
}

/**
 * 检查浏览器是否支持历史记录 API
 * @returns {boolean}
 */
function hasHistoryAPI() {
  const browserAPI = getBrowserAPI();
  return !!(
    browserAPI &&
    browserAPI.history &&
    typeof browserAPI.history.search === 'function' &&
    typeof browserAPI.history.getVisits === 'function'
  );
}

/**
 * 检查浏览器是否支持书签 API
 * @returns {boolean}
 */
function hasBookmarksAPI() {
  const browserAPI = getBrowserAPI();
  return !!(
    browserAPI &&
    browserAPI.bookmarks &&
    typeof browserAPI.bookmarks.getTree === 'function'
  );
}

/**
 * 防抖函数
 * @param {Function} func - 要防抖的函数
 * @param {number} delay - 延迟时间（毫秒）
 * @returns {Function} 防抖后的函数
 */
function debounce(func, delay) {
  let timer = null;
  return function(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      func.apply(this, args);
      timer = null;
    }, delay);
  };
}

/**
 * 批量处理数组（避免阻塞主线程）
 * @param {Array} items - 要处理的数组
 * @param {Function} processor - 处理函数
 * @param {number} batchSize - 每批处理数量
 * @returns {Promise<void>}
 */
async function processBatch(items, processor, batchSize = 100) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(item => processor(item)));
    
    // 每批之后让出控制权，避免阻塞
    if (i + batchSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
}

// 导出（兼容不同模块系统）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getBrowserAPI,
    getStorageArea,
    readStorage,
    writeStorage,
    getDateKey,
    parseDateKey,
    generateId,
    normalizeUrl,
    normalizeTitle,
    deepClone,
    serializeMap,
    deserializeMap,
    serializeSet,
    deserializeSet,
    hasHistoryAPI,
    hasBookmarksAPI,
    debounce,
    processBatch
  };
}
