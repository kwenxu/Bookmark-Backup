// =============================================================================
// Anki 数据库模块 (Bookmark Anki Database)
// =============================================================================
// 用于管理书签的 Anki 卡片数据和 SM-2 记忆曲线算法

// 浏览器 API（独立定义，避免与 history.js 冲突）
const ankiBrowserAPI = (typeof chrome !== 'undefined' && chrome.runtime) ? chrome : 
                       (typeof browser !== 'undefined' ? browser : null);

// 配置
const ANKI_CONFIG = {
    DB_NAME: 'BookmarkAnkiDB',
    DB_VERSION: 1,
    STORE_NAME: 'anki_cards',
    
    // 默认权重
    DEFAULT_WEIGHTS: {
        freshness: 0.15,      // 新鲜度权重
        coldness: 0.25,       // 冷门度权重
        shallowRead: 0.30,    // 浅阅读度权重（最重要）
        forgetting: 0.25      // 遗忘度权重
    },
    
    // 默认阈值
    DEFAULT_THRESHOLDS: {
        freshness: 30,        // 30天内的新书签优先
        coldness: 10,         // 点击<10次的优先
        shallowRead: 5,       // 活跃<5分钟的优先 (分钟)
        forgetting: 14        // 超过14天未访问的优先
    },
    
    // SM-2 算法默认值
    DEFAULT_EASE: 2.5,
    MIN_EASE: 1.3,
    DEFAULT_INTERVAL: 1
};

// =============================================================================
// IndexedDB 操作
// =============================================================================

let ankiDb = null;

async function openAnkiDatabase() {
    if (ankiDb) return ankiDb;
    
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(ANKI_CONFIG.DB_NAME, ANKI_CONFIG.DB_VERSION);
        
        request.onerror = () => {
            console.error('[AnkiDB] 打开数据库失败:', request.error);
            reject(request.error);
        };
        
        request.onsuccess = () => {
            ankiDb = request.result;
            console.log('[AnkiDB] 数据库打开成功');
            resolve(ankiDb);
        };
        
        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            
            if (!database.objectStoreNames.contains(ANKI_CONFIG.STORE_NAME)) {
                const store = database.createObjectStore(ANKI_CONFIG.STORE_NAME, { 
                    keyPath: 'bookmarkId'
                });
                
                store.createIndex('url', 'url', { unique: false });
                store.createIndex('nextReview', 'nextReview', { unique: false });
                store.createIndex('priority', 'priority', { unique: false });
                
                console.log('[AnkiDB] 创建 anki_cards 表');
            }
        };
    });
}

async function getAnkiCard(bookmarkId) {
    try {
        const database = await openAnkiDatabase();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction([ANKI_CONFIG.STORE_NAME], 'readonly');
            const store = transaction.objectStore(ANKI_CONFIG.STORE_NAME);
            const request = store.get(bookmarkId);
            
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('[AnkiDB] getAnkiCard 错误:', error);
        return null;
    }
}

async function saveAnkiCard(card) {
    try {
        const database = await openAnkiDatabase();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction([ANKI_CONFIG.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(ANKI_CONFIG.STORE_NAME);
            
            card.updatedAt = Date.now();
            if (!card.createdAt) {
                card.createdAt = Date.now();
            }
            
            const request = store.put(card);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('[AnkiDB] saveAnkiCard 错误:', error);
    }
}

async function deleteAnkiCard(bookmarkId) {
    try {
        const database = await openAnkiDatabase();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction([ANKI_CONFIG.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(ANKI_CONFIG.STORE_NAME);
            const request = store.delete(bookmarkId);
            
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('[AnkiDB] deleteAnkiCard 错误:', error);
        return false;
    }
}

async function getAllAnkiCards() {
    try {
        const database = await openAnkiDatabase();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction([ANKI_CONFIG.STORE_NAME], 'readonly');
            const store = transaction.objectStore(ANKI_CONFIG.STORE_NAME);
            const request = store.getAll();
            
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('[AnkiDB] getAllAnkiCards 错误:', error);
        return [];
    }
}

async function getCardsDueForReview() {
    try {
        const database = await openAnkiDatabase();
        const now = Date.now();
        
        return new Promise((resolve, reject) => {
            const transaction = database.transaction([ANKI_CONFIG.STORE_NAME], 'readonly');
            const store = transaction.objectStore(ANKI_CONFIG.STORE_NAME);
            const index = store.index('nextReview');
            const range = IDBKeyRange.upperBound(now);
            const request = index.getAll(range);
            
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('[AnkiDB] getCardsDueForReview 错误:', error);
        return [];
    }
}

// =============================================================================
// SM-2 算法实现
// =============================================================================

/**
 * SM-2 算法：根据用户评分更新卡片
 * @param {Object} card - 卡片对象
 * @param {number} rating - 评分 (0-4)
 *   0: 完全忘记
 *   1: 困难
 *   2: 一般
 *   3: 简单
 *   4: 太简单
 * @returns {Object} 更新后的卡片
 */
function sm2Update(card, rating) {
    let { ease, interval, reviewCount } = card;
    
    ease = ease || ANKI_CONFIG.DEFAULT_EASE;
    interval = interval || ANKI_CONFIG.DEFAULT_INTERVAL;
    reviewCount = reviewCount || 0;
    
    // 根据评分更新 ease 因子
    const newEase = ease + (0.1 - (3 - rating) * (0.08 + (3 - rating) * 0.02));
    ease = Math.max(ANKI_CONFIG.MIN_EASE, newEase);
    
    // 根据评分更新间隔
    if (rating === 0) {
        // 完全忘记：重置为1天
        interval = 1;
    } else if (rating === 1) {
        // 困难：间隔 × 1.2
        interval = Math.ceil(interval * 1.2);
    } else if (rating === 2) {
        // 一般：间隔 × ease
        interval = Math.ceil(interval * ease);
    } else if (rating === 3) {
        // 简单：间隔 × ease × 1.3
        interval = Math.ceil(interval * ease * 1.3);
    } else if (rating === 4) {
        // 太简单：间隔 × ease × 1.5
        interval = Math.ceil(interval * ease * 1.5);
    }
    
    // 计算下次复习时间
    const nextReview = Date.now() + interval * 24 * 60 * 60 * 1000;
    
    return {
        ...card,
        ease,
        interval,
        nextReview,
        reviewCount: reviewCount + 1,
        lastReviewTime: Date.now()
    };
}

/**
 * 简化的评分系统（3级）
 * @param {Object} card - 卡片对象
 * @param {string} action - 'interested' | 'not_interested' | 'known'
 * @returns {Object} 更新后的卡片
 */
function updateCardByAction(card, action) {
    switch (action) {
        case 'interested':
            // 感兴趣：相当于评分1（困难），缩短间隔
            return sm2Update(card, 1);
        case 'not_interested':
            // 不感兴趣：相当于评分4（太简单），延长间隔
            return sm2Update(card, 4);
        case 'known':
            // 已了解：相当于评分3（简单），适当延长间隔
            return sm2Update(card, 3);
        default:
            return card;
    }
}

// =============================================================================
// 优先级计算
// =============================================================================

/**
 * 计算书签的优先级分数
 * @param {Object} bookmark - 书签对象
 * @param {Object} stats - 统计数据 { clickCount, lastVisitTime, totalActiveMs }
 * @param {Object} weights - 权重配置
 * @param {Object} thresholds - 阈值配置
 * @param {boolean} trackingEnabled - 追踪是否开启
 * @returns {number} 优先级分数 (0-1)
 */
function calculatePriority(bookmark, stats, weights, thresholds, trackingEnabled = true) {
    const now = Date.now();
    
    // 使用默认值
    weights = weights || ANKI_CONFIG.DEFAULT_WEIGHTS;
    thresholds = thresholds || ANKI_CONFIG.DEFAULT_THRESHOLDS;
    
    // 1. 新鲜度：1 - min(添加天数 / threshold, 1)
    const addedDays = bookmark.dateAdded ? 
        (now - bookmark.dateAdded) / (24 * 60 * 60 * 1000) : 30;
    const freshness = 1 - Math.min(addedDays / thresholds.freshness, 1);
    
    // 2. 冷门度：1 - min(点击次数 / threshold, 1)
    const clickCount = stats.clickCount || 0;
    const coldness = 1 - Math.min(clickCount / thresholds.coldness, 1);
    
    // 3. 浅阅读度：1 - min(累计活跃时间 / threshold(分钟), 1)
    const totalActiveMs = stats.totalActiveMs || 0;
    const thresholdMs = thresholds.shallowRead * 60 * 1000;
    const shallowRead = trackingEnabled ? 
        (1 - Math.min(totalActiveMs / thresholdMs, 1)) : 0;
    
    // 4. 遗忘度：min(距上次访问天数 / threshold, 1)
    const lastVisitTime = stats.lastVisitTime || bookmark.dateAdded || (now - 30 * 24 * 60 * 60 * 1000);
    const daysSinceVisit = (now - lastVisitTime) / (24 * 60 * 60 * 1000);
    const forgetting = Math.min(daysSinceVisit / thresholds.forgetting, 1);
    
    // 计算总优先级
    let priority;
    if (trackingEnabled) {
        priority = weights.freshness * freshness +
                   weights.coldness * coldness +
                   weights.shallowRead * shallowRead +
                   weights.forgetting * forgetting;
    } else {
        // 追踪关闭时，重新归一化权重（排除 shallowRead）
        const totalWeight = weights.freshness + weights.coldness + weights.forgetting;
        priority = (weights.freshness / totalWeight) * freshness +
                   (weights.coldness / totalWeight) * coldness +
                   (weights.forgetting / totalWeight) * forgetting;
    }
    
    return Math.min(1, Math.max(0, priority));
}

/**
 * 获取书签的统计数据
 * @param {string} url - 书签URL
 * @param {string} bookmarkId - 书签ID
 * @returns {Object} 统计数据
 */
async function getBookmarkStats(url, bookmarkId) {
    const stats = {
        clickCount: 0,
        lastVisitTime: null,
        totalActiveMs: 0
    };
    
    try {
        // 1. 从浏览器历史获取点击次数和最后访问时间
        if (ankiBrowserAPI.history && ankiBrowserAPI.history.getVisits) {
            const visits = await new Promise((resolve) => {
                ankiBrowserAPI.history.getVisits({ url }, (visits) => {
                    resolve(visits || []);
                });
            });
            
            stats.clickCount = visits.length;
            if (visits.length > 0) {
                stats.lastVisitTime = Math.max(...visits.map(v => v.visitTime));
            }
        }
        
        // 2. 从活跃时间追踪获取累计活跃时间
        if (ankiBrowserAPI.runtime && ankiBrowserAPI.runtime.sendMessage) {
            try {
                const response = await ankiBrowserAPI.runtime.sendMessage({
                    action: 'getBookmarkActiveTime',
                    bookmarkId: bookmarkId
                });
                
                if (response && response.success) {
                    stats.totalActiveMs = response.totalActiveMs || 0;
                }
            } catch (error) {
                // 活跃时间追踪可能未启用
            }
        }
    } catch (error) {
        console.warn('[AnkiDB] getBookmarkStats 错误:', error);
    }
    
    return stats;
}

// =============================================================================
// 书签同步和推荐
// =============================================================================

/**
 * 从书签树同步到 Anki 数据库
 * @param {Array} bookmarks - 书签数组
 */
async function syncBookmarksToAnki(bookmarks) {
    console.log('[AnkiDB] 同步书签到 Anki 数据库:', bookmarks.length, '个');
    
    const existingCards = await getAllAnkiCards();
    const existingMap = new Map(existingCards.map(c => [c.bookmarkId, c]));
    
    for (const bookmark of bookmarks) {
        if (!bookmark.url || !bookmark.id) continue;
        
        let card = existingMap.get(bookmark.id);
        
        if (!card) {
            // 创建新卡片
            card = {
                bookmarkId: bookmark.id,
                url: bookmark.url,
                title: bookmark.title || '',
                ease: ANKI_CONFIG.DEFAULT_EASE,
                interval: ANKI_CONFIG.DEFAULT_INTERVAL,
                nextReview: Date.now(),
                totalActiveMs: 0,
                lastActiveTime: null,
                reviewCount: 0,
                isPinned: false,
                priority: 0,
                dateAdded: bookmark.dateAdded
            };
        } else {
            // 更新现有卡片的基本信息
            card.url = bookmark.url;
            card.title = bookmark.title || card.title;
            card.dateAdded = bookmark.dateAdded || card.dateAdded;
        }
        
        await saveAnkiCard(card);
    }
    
    console.log('[AnkiDB] 同步完成');
}

/**
 * 获取推荐书签列表
 * @param {Object} options - 选项
 * @returns {Array} 推荐书签列表
 */
async function getRecommendedBookmarks(options = {}) {
    const {
        limit = 20,
        weights = null,
        thresholds = null,
        trackingEnabled = true
    } = options;
    
    // 获取所有卡片
    const cards = await getAllAnkiCards();
    if (cards.length === 0) {
        console.log('[AnkiDB] 没有 Anki 卡片');
        return [];
    }
    
    // 计算每个卡片的优先级
    const cardsWithPriority = [];
    
    for (const card of cards) {
        const stats = await getBookmarkStats(card.url, card.bookmarkId);
        const priority = calculatePriority(
            { dateAdded: card.dateAdded },
            stats,
            weights,
            thresholds,
            trackingEnabled
        );
        
        // 更新卡片的统计信息
        card.priority = priority;
        card.clickCount = stats.clickCount;
        card.lastVisitTime = stats.lastVisitTime;
        card.totalActiveMs = stats.totalActiveMs;
        
        cardsWithPriority.push(card);
    }
    
    // 按优先级排序（高优先级在前）
    cardsWithPriority.sort((a, b) => b.priority - a.priority);
    
    // 返回前 N 个
    return cardsWithPriority.slice(0, limit);
}

/**
 * 获取随机推荐（权重随机）
 * @param {Object} options - 选项
 * @returns {Object|null} 随机推荐的书签
 */
async function getRandomRecommendation(options = {}) {
    const recommendations = await getRecommendedBookmarks({ ...options, limit: 50 });
    
    if (recommendations.length === 0) return null;
    
    // 使用优先级作为权重进行加权随机选择
    const totalWeight = recommendations.reduce((sum, r) => sum + r.priority, 0);
    
    if (totalWeight === 0) {
        // 所有优先级都是0，均匀随机
        return recommendations[Math.floor(Math.random() * recommendations.length)];
    }
    
    let random = Math.random() * totalWeight;
    for (const rec of recommendations) {
        random -= rec.priority;
        if (random <= 0) {
            return rec;
        }
    }
    
    return recommendations[0];
}

/**
 * 记录用户对卡片的操作
 * @param {string} bookmarkId - 书签ID
 * @param {string} action - 'open' | 'interested' | 'not_interested' | 'known'
 */
async function recordCardAction(bookmarkId, action) {
    let card = await getAnkiCard(bookmarkId);
    
    if (!card) {
        console.warn('[AnkiDB] 卡片不存在:', bookmarkId);
        return null;
    }
    
    if (action === 'open') {
        // 打开操作：更新最后活跃时间
        card.lastActiveTime = Date.now();
    } else {
        // 其他操作：使用 SM-2 算法更新
        card = updateCardByAction(card, action);
    }
    
    await saveAnkiCard(card);
    return card;
}

// =============================================================================
// 配置管理
// =============================================================================

async function getFormulaConfig() {
    return new Promise((resolve) => {
        ankiBrowserAPI.storage.local.get(['recommendFormulaConfig'], (result) => {
            if (result.recommendFormulaConfig) {
                resolve(result.recommendFormulaConfig);
            } else {
                resolve({
                    weights: { ...ANKI_CONFIG.DEFAULT_WEIGHTS },
                    thresholds: { ...ANKI_CONFIG.DEFAULT_THRESHOLDS }
                });
            }
        });
    });
}

async function saveFormulaConfig(config) {
    return new Promise((resolve) => {
        ankiBrowserAPI.storage.local.set({ recommendFormulaConfig: config }, resolve);
    });
}

async function isTrackingEnabled() {
    return new Promise((resolve) => {
        ankiBrowserAPI.runtime.sendMessage({ action: 'isTrackingEnabled' }, (response) => {
            resolve(response && response.success ? response.enabled : true);
        });
    });
}

// =============================================================================
// 导出
// =============================================================================

// 如果是模块环境
if (typeof window !== 'undefined') {
    window.AnkiDatabase = {
        // 数据库操作
        openAnkiDatabase,
        getAnkiCard,
        saveAnkiCard,
        deleteAnkiCard,
        getAllAnkiCards,
        getCardsDueForReview,
        
        // SM-2 算法
        sm2Update,
        updateCardByAction,
        
        // 优先级计算
        calculatePriority,
        getBookmarkStats,
        
        // 同步和推荐
        syncBookmarksToAnki,
        getRecommendedBookmarks,
        getRandomRecommendation,
        recordCardAction,
        
        // 配置
        getFormulaConfig,
        saveFormulaConfig,
        isTrackingEnabled,
        
        // 常量
        CONFIG: ANKI_CONFIG
    };
}
