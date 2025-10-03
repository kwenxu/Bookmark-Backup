// =======================================================
// 自动备份定时器 - UI设置模块
// Auto Backup Timer - UI Settings Module
// =======================================================

import {
    DEFAULT_SETTINGS,
    getAutoBackupSettings,
    saveAutoBackupSettings,
    updateBackupMode,
    updateRegularTimeConfig,
    addSpecificTimeSchedule,
    removeSpecificTimeSchedule,
    updateSpecificTimeSchedule
} from './storage.js';

const browserAPI = (function() {
    if (typeof chrome !== 'undefined') {
        if (typeof browser !== 'undefined') {
            return browser;
        }
        return chrome;
    }
    throw new Error('不支持的浏览器');
})();

// =======================================================
// UI文本配置
// =======================================================

const UI_TEXT = {
    zh_CN: {
        realtimeBackup: '实时备份',
        regularTime: '常规时间',
        specificTime: '特定时间',
        
        realtimeDesc: '当检测到「数量/结构变化」时立即执行备份',
        regularDesc: '按照设定的时间规则定期执行备份',
        specificDesc: '在指定的特定时间点执行备份',
        
        weekDays: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
        defaultTime: '默认时间',
        hourInterval: '小时间隔',
        minuteInterval: '分钟间隔',
        every: '每',
        hour: '小时',
        minute: '分钟',
        
        addSchedule: '添加计划',
        maxSchedules: '最多可添加5个计划',
        deleteSchedule: '删除',
        enableSchedule: '启用',
        scheduleTime: '计划时间',
        noSchedules: '暂无计划',
        
        enableFeature: '启用此功能',
        selectWeekDays: '选择备份日期'
    },
    en: {
        realtimeBackup: 'Realtime Backup',
        regularTime: 'Regular Time',
        specificTime: 'Specific Time',
        
        realtimeDesc: 'Backup immediately when quantity/structure changes are detected',
        regularDesc: 'Backup periodically according to set time rules',
        specificDesc: 'Backup at specified time points',
        
        weekDays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
        defaultTime: 'Default Time',
        hourInterval: 'Hour Interval',
        minuteInterval: 'Minute Interval',
        every: 'Every',
        hour: 'hour(s)',
        minute: 'minute(s)',
        
        addSchedule: 'Add Schedule',
        maxSchedules: 'Max 5 schedules allowed',
        deleteSchedule: 'Delete',
        enableSchedule: 'Enable',
        scheduleTime: 'Schedule Time',
        noSchedules: 'No schedules',
        
        enableFeature: 'Enable this feature',
        selectWeekDays: 'Select backup days'
    }
};

// =======================================================
// UI构建函数
// =======================================================

/**
 * 获取当前语言
 * @returns {Promise<string>} 'zh_CN' 或 'en'
 */
async function getCurrentLanguage() {
    try {
        const result = await browserAPI.storage.local.get(['preferredLang']);
        return result.preferredLang || 'zh_CN';
    } catch (error) {
        return 'zh_CN';
    }
}

/**
 * 获取UI文本
 * @param {string} key - 文本键
 * @param {string} lang - 语言
 * @returns {string|Array} 文本内容
 */
function getText(key, lang = 'zh_CN') {
    return UI_TEXT[lang][key] || UI_TEXT.zh_CN[key] || key;
}

/**
 * 创建三个备份模式的UI容器（插入到自动备份设置区域）
 * @param {string} lang - 语言
 * @returns {HTMLElement} 容器元素
 */
function createAutoBackupTimerUI(lang) {
    const container = document.createElement('div');
    container.id = 'autoBackupTimerContainer';
    container.style.cssText = `
        margin-top: 10px;
    `;
    
    // 创建实时备份块
    const realtimeBlock = createRealtimeBackupBlock(lang);
    
    // 创建常规时间块
    const regularBlock = createRegularTimeBlock(lang);
    
    // 创建特定时间块
    const specificBlock = createSpecificTimeBlock(lang);
    
    container.appendChild(realtimeBlock);
    container.appendChild(regularBlock);
    container.appendChild(specificBlock);
    
    return container;
}

/**
 * 创建实时备份块
 * @param {string} lang - 语言
 * @returns {HTMLElement}
 */
function createRealtimeBackupBlock(lang) {
    const block = document.createElement('div');
    block.className = 'config-section';
    block.style.cssText = 'margin-bottom: 8px;';
    
    block.innerHTML = `
        <div class="config-header collapsed" id="realtimeBackupHeader" data-mode="realtime">
            <h2>
                <span id="realtimeBackupTitle">${getText('realtimeBackup', lang)}</span>
            </h2>
            <div style="display: flex; align-items: center;">
                <button id="realtimeBackupToggle" class="toggle-button" data-state="off" style="width: 60px; height: 30px; border-radius: 15px; background-color: #ccc; border: none; position: relative; cursor: pointer; padding: 0; transition: background-color 0.3s ease; margin-right: 10px;">
                    <div class="toggle-circle" style="width: 24px; height: 24px; background-color: white; border-radius: 50%; position: absolute; top: 3px; left: 3px; transition: all 0.3s ease; box-shadow: 0 1px 3px rgba(0,0,0,0.2);"></div>
                </button>
                <div class="toggle-icon"></div>
            </div>
        </div>
        <div class="config-content" id="realtimeBackupContent" style="display: none;">
            <div class="setting-desc-row" style="padding: 15px 15px 10px 15px;">
                <div id="realtimeBackupSpacer" style="width: 0px; min-width: 0px; flex-shrink: 0;"></div>
                <div id="realtimeBackupDesc1" style="font-size: 14px; line-height: 1.5; color: var(--theme-text-secondary);">
                    ${getText('realtimeDesc', lang)}
                </div>
            </div>
        </div>
    `;
    
    return block;
}

/**
 * 创建常规时间块
 * @param {string} lang - 语言
 * @returns {HTMLElement}
 */
function createRegularTimeBlock(lang) {
    const block = document.createElement('div');
    block.className = 'config-section';
    block.style.cssText = 'margin-bottom: 8px;';
    
    const weekDays = getText('weekDays', lang);
    // 调整显示顺序：周一到周日（但保持data-day与存储的映射：0=周日, 1=周一, ..., 6=周六）
    const displayOrder = [1, 2, 3, 4, 5, 6, 0]; // 周一到周日
    const weekCheckboxes = displayOrder.map(dayIndex => `
        <label style="display: inline-flex; align-items: center; margin-right: 8px; cursor: pointer;">
            <input type="checkbox" class="week-day-checkbox" data-day="${dayIndex}" checked 
                   style="margin-right: 3px; cursor: pointer; width: 14px; height: 14px;">
            <span style="font-size: 12px;">${weekDays[dayIndex]}</span>
        </label>
    `).join('');
    
    block.innerHTML = `
        <div class="config-header" id="regularTimeHeader" data-mode="regular">
            <h2>
                <span>${getText('regularTime', lang)}</span>
            </h2>
            <div style="display: flex; align-items: center;">
                <button id="regularTimeToggle" class="toggle-button" data-state="on" style="width: 60px; height: 30px; border-radius: 15px; background-color: #4CAF50; border: none; position: relative; cursor: pointer; padding: 0; transition: background-color 0.3s ease; margin-right: 10px;">
                    <div class="toggle-circle" style="width: 24px; height: 24px; background-color: white; border-radius: 50%; position: absolute; top: 3px; right: 3px; transition: all 0.3s ease; box-shadow: 0 1px 3px rgba(0,0,0,0.2);"></div>
                </button>
                <div class="toggle-icon"></div>
            </div>
        </div>
        <div class="config-content" id="regularTimeContent" style="display: block; padding: 15px;">
            <div style="font-size: 13px; line-height: 1.6; color: var(--theme-text-secondary); margin-bottom: 15px;">
                ${getText('regularDesc', lang)}
            </div>
            
            <!-- 整体居中容器 -->
            <div style="max-width: 600px; margin: 0 auto;">
                
                <!-- 周开关和默认时间区域 -->
                <div style="margin-bottom: 15px; padding: 12px; background-color: var(--theme-bg-secondary); border-radius: 6px;">
                    <!-- 选择备份日期 -->
                    <div style="margin-bottom: 10px;">
                        <span class="week-days-label" style="font-weight: 500; font-size: 13px; color: var(--theme-text-primary);">
                            ${getText('selectWeekDays', lang)}:
                        </span>
                    </div>
                    
                    <!-- 周勾选框 -->
                    <div style="display: flex; justify-content: center; flex-wrap: wrap; gap: 8px; margin-bottom: 10px;">
                        ${weekCheckboxes}
                    </div>
                    
                    <!-- 默认时间行 -->
                    <div style="display: grid; grid-template-columns: 120px 1fr 80px; gap: 10px; align-items: center;">
                        <span class="default-time-label" style="font-size: 13px; color: var(--theme-text-primary);">
                            ${getText('defaultTime', lang)}:
                        </span>
                        <div style="display: grid; grid-template-columns: 25px 100px 45px; justify-content: center; gap: 6px;">
                            <div></div>
                            <input type="time" id="regularDefaultTime" value="10:00" 
                                   style="padding: 4px 8px; border-radius: 4px; border: 1px solid var(--theme-input-border); 
                                          font-size: 13px; color: var(--theme-text-primary); background-color: var(--theme-input-bg); width: 100px;">
                            <div></div>
                        </div>
                        <div></div>
                    </div>
                </div>
                
                <!-- 小时间隔 -->
                <div style="margin-bottom: 15px; padding: 12px; background-color: var(--theme-bg-secondary); border-radius: 6px;">
                    <div style="display: grid; grid-template-columns: 120px 1fr 80px; gap: 10px; align-items: center;">
                        <span class="hour-interval-label" style="font-weight: 500; font-size: 13px; color: var(--theme-text-primary);">
                            ${getText('hourInterval', lang)}:
                        </span>
                        <div style="display: grid; grid-template-columns: 50px 50px 70px; justify-content: center; gap: 6px; align-items: center;">
                            <span class="hour-every-label" style="font-size: 13px; text-align: right;">${getText('every', lang)}</span>
                            <input type="number" id="hourIntervalValue" min="1" max="24" value="2" 
                                   style="width: 50px; padding: 4px; border-radius: 4px; border: 1px solid var(--theme-input-border); 
                                          font-size: 13px; text-align: center; background-color: var(--theme-input-bg); 
                                          color: var(--theme-text-primary);">
                            <span class="hour-unit-label" style="font-size: 13px; text-align: left;">${getText('hour', lang)}</span>
                        </div>
                        <div style="display: flex; justify-content: center;">
                            <label class="switch">
                                <input type="checkbox" id="hourIntervalSwitch">
                                <span class="slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                
                <!-- 分钟间隔 -->
                <div style="margin-bottom: 10px; padding: 12px; background-color: var(--theme-bg-secondary); border-radius: 6px;">
                    <div style="display: grid; grid-template-columns: 120px 1fr 80px; gap: 10px; align-items: center;">
                        <span class="minute-interval-label" style="font-weight: 500; font-size: 13px; color: var(--theme-text-primary);">
                            ${getText('minuteInterval', lang)}:
                        </span>
                        <div style="display: grid; grid-template-columns: 50px 50px 70px; justify-content: center; gap: 6px; align-items: center;">
                            <span class="minute-every-label" style="font-size: 13px; text-align: right;">${getText('every', lang)}</span>
                            <input type="number" id="minuteIntervalValue" min="1" max="59" value="30" 
                                   style="width: 50px; padding: 4px; border-radius: 4px; border: 1px solid var(--theme-input-border); 
                                          font-size: 13px; text-align: center; background-color: var(--theme-input-bg); 
                                          color: var(--theme-text-primary);">
                            <span class="minute-unit-label" style="font-size: 13px; text-align: left;">${getText('minute', lang)}</span>
                        </div>
                        <div style="display: flex; justify-content: center;">
                            <label class="switch">
                                <input type="checkbox" id="minuteIntervalSwitch" checked>
                                <span class="slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                
            </div>
        </div>
    `;
    
    return block;
}

/**
 * 创建特定时间块
 * @param {string} lang - 语言
 * @returns {HTMLElement}
 */
function createSpecificTimeBlock(lang) {
    const block = document.createElement('div');
    block.className = 'config-section';
    block.style.cssText = 'margin-bottom: 8px;';
    
    block.innerHTML = `
        <div class="config-header collapsed" id="specificTimeHeader" data-mode="specific">
            <h2>
                <span>${getText('specificTime', lang)}</span>
            </h2>
            <div style="display: flex; align-items: center;">
                <button id="specificTimeToggle" class="toggle-button" data-state="off" style="width: 60px; height: 30px; border-radius: 15px; background-color: #ccc; border: none; position: relative; cursor: pointer; padding: 0; transition: background-color 0.3s ease; margin-right: 10px;">
                    <div class="toggle-circle" style="width: 24px; height: 24px; background-color: white; border-radius: 50%; position: absolute; top: 3px; left: 3px; transition: all 0.3s ease; box-shadow: 0 1px 3px rgba(0,0,0,0.2);"></div>
                </button>
                <div class="toggle-icon"></div>
            </div>
        </div>
        <div class="config-content" id="specificTimeContent" style="display: none; padding: 15px;">
            <div style="font-size: 13px; line-height: 1.6; color: var(--theme-text-secondary); margin-bottom: 15px;">
                ${getText('specificDesc', lang)}（${getText('maxSchedules', lang)}）
            </div>
            
            <!-- 添加计划区域 -->
            <div style="margin-bottom: 20px; padding: 15px; background-color: var(--theme-bg-secondary); border-radius: 6px;">
                <div style="font-weight: 500; margin-bottom: 12px; font-size: 14px; color: var(--theme-text-primary);">
                    ${getText('addSchedule', lang)}
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <input type="datetime-local" id="newScheduleDatetime" 
                           style="flex: 1; padding: 8px 12px; border-radius: 4px; border: 1px solid var(--theme-input-border); 
                                  font-size: 14px; color: var(--theme-text-primary); background-color: var(--theme-input-bg);">
                    <button id="addScheduleBtn" 
                            style="padding: 8px 20px; background-color: #4CAF50; color: white; border: none; 
                                   border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 500;
                                   transition: background-color 0.2s;">
                        ${getText('addSchedule', lang)}
                    </button>
                </div>
            </div>
            
            <!-- 计划列表 -->
            <div id="schedulesList" style="max-height: 300px; overflow-y: auto;">
                <!-- 计划项会动态插入这里 -->
            </div>
        </div>
    `;
    
    return block;
}

/**
 * 渲染计划列表
 * @param {Array} schedules - 计划数组
 * @param {string} lang - 语言
 */
function renderSchedulesList(schedules, lang) {
    const container = document.getElementById('schedulesList');
    if (!container) return;
    
    if (schedules.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 30px; color: var(--theme-text-secondary); font-size: 14px;">
                ${getText('noSchedules', lang)}
            </div>
        `;
        return;
    }
    
    container.innerHTML = schedules.map((schedule, index) => {
        const datetime = new Date(schedule.datetime);
        const dateStr = datetime.toLocaleDateString(lang === 'zh_CN' ? 'zh-CN' : 'en-US');
        const timeStr = datetime.toLocaleTimeString(lang === 'zh_CN' ? 'zh-CN' : 'en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        const isPast = datetime.getTime() < Date.now();
        const statusColor = schedule.executed ? '#999' : (isPast ? '#ff9800' : '#4CAF50');
        const statusText = schedule.executed ? '已执行' : (isPast ? '待执行' : '待触发');
        
        return `
            <div class="schedule-item" data-schedule-id="${schedule.id}" 
                 style="margin-bottom: 10px; padding: 12px; background-color: var(--theme-bg-elevated); 
                        border-radius: 6px; border: 1px solid var(--theme-border-primary);
                        display: flex; align-items: center; justify-content: space-between;">
                <div style="flex: 1;">
                    <div style="display: flex; align-items: center; margin-bottom: 6px;">
                        <span style="font-weight: 500; font-size: 14px; color: var(--theme-text-primary);">
                            ${dateStr} ${timeStr}
                        </span>
                        <span style="margin-left: 10px; padding: 2px 8px; border-radius: 10px; 
                                     font-size: 12px; background-color: ${statusColor}22; color: ${statusColor};">
                            ${statusText}
                        </span>
                    </div>
                    <div style="font-size: 12px; color: var(--theme-text-secondary);">
                        ${getText('scheduleTime', lang)}: ${schedule.datetime}
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <label class="switch">
                        <input type="checkbox" class="schedule-enable-switch" 
                               data-schedule-id="${schedule.id}" ${schedule.enabled ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                    <button class="schedule-delete-btn" data-schedule-id="${schedule.id}"
                            style="padding: 6px 12px; background-color: #ff3b30; color: white; border: none; 
                                   border-radius: 4px; cursor: pointer; font-size: 13px;
                                   transition: background-color 0.2s;">
                        ${getText('deleteSchedule', lang)}
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    // 绑定事件
    bindScheduleItemEvents();
}

/**
 * 绑定计划项事件
 */
function bindScheduleItemEvents() {
    // 启用/禁用开关
    const switches = document.querySelectorAll('.schedule-enable-switch');
    switches.forEach(sw => {
        sw.addEventListener('change', async (e) => {
            const scheduleId = e.target.dataset.scheduleId;
            await updateSpecificTimeSchedule(scheduleId, { enabled: e.target.checked });
            // 通知后台重启定时器
            browserAPI.runtime.sendMessage({ action: 'restartAutoBackupTimer' });
        });
    });
    
    // 删除按钮
    const deleteBtns = document.querySelectorAll('.schedule-delete-btn');
    deleteBtns.forEach(btn => {
        btn.addEventListener('change', async (e) => {
            const scheduleId = e.target.dataset.scheduleId;
            if (confirm('确定删除这个计划吗？')) {
                await removeSpecificTimeSchedule(scheduleId);
                // 重新加载UI
                await loadSettings();
                // 通知后台重启定时器
                browserAPI.runtime.sendMessage({ action: 'restartAutoBackupTimer' });
            }
        });
    });
}

// =======================================================
// 事件处理函数
// =======================================================

/**
 * 初始化UI事件监听
 */
async function initializeUIEvents() {
    const lang = await getCurrentLanguage();
    
    // 折叠/展开事件
    setupCollapseEvents();
    
    // 模式切换事件
    setupModeSwitchEvents();
    
    // 常规时间配置事件
    setupRegularTimeEvents();
    
    // 特定时间配置事件
    setupSpecificTimeEvents(lang);
    
    // 恢复默认和保存按钮
    setupActionButtons();
}

/**
 * 设置操作按钮事件（恢复默认、保存）
 */
function setupActionButtons() {
    // 恢复默认按钮
    const restoreBtn = document.getElementById('restoreAutoBackupDefaults');
    if (restoreBtn) {
        restoreBtn.addEventListener('click', async () => {
            try {
                // 恢复为默认配置（常规时间开启）
                await saveAutoBackupSettings(DEFAULT_SETTINGS);
                
                // 重新加载UI
                await loadSettings();
                
                // 显示提示
                const indicator = document.getElementById('autoBackupSettingsSavedIndicator');
                if (indicator) {
                    indicator.style.display = 'block';
                    indicator.style.opacity = '1';
                    setTimeout(() => {
                        indicator.style.opacity = '0';
                        setTimeout(() => { indicator.style.display = 'none'; }, 300);
                    }, 1200);
                }
                
                // 通知后台
                browserAPI.runtime.sendMessage({ 
                    action: 'autoBackupModeChanged', 
                    mode: 'regular',
                    regularEnabled: true,
                    specificEnabled: false
                });
            } catch (error) {
                console.error('恢复默认失败:', error);
            }
        });
    }
    
    // 保存按钮
    const saveBtn = document.getElementById('saveAutoBackupSettings');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            // 显示保存成功提示
            const indicator = document.getElementById('autoBackupSettingsSavedIndicator');
            if (indicator) {
                indicator.style.display = 'block';
                indicator.style.opacity = '1';
                setTimeout(() => {
                    indicator.style.opacity = '0';
                    setTimeout(() => { indicator.style.display = 'none'; }, 300);
                }, 1200);
            }
            
            // 关闭对话框
            setTimeout(() => {
                const dialog = document.getElementById('autoBackupSettingsDialog');
                if (dialog) dialog.style.display = 'none';
            }, 600);
        });
    }
}

/**
 * 设置折叠/展开事件
 */
function setupCollapseEvents() {
    const headers = ['realtimeBackupHeader', 'regularTimeHeader', 'specificTimeHeader'];
    
    headers.forEach(headerId => {
        const header = document.getElementById(headerId);
        if (!header) return;
        
        header.addEventListener('click', async (e) => {
            // 如果点击的是开关按钮，不触发折叠
            if (e.target.closest('.toggle-button') || e.target.closest('button')) return;
            
            const content = header.nextElementSibling;
            const isCollapsed = header.classList.contains('collapsed');
            
            if (isCollapsed) {
                header.classList.remove('collapsed');
                content.style.display = 'block';
            } else {
                header.classList.add('collapsed');
                content.style.display = 'none';
            }
            
            // 保存折叠状态
            await saveCollapseState(headerId, !isCollapsed);
        });
    });
}

/**
 * 保存折叠状态
 */
async function saveCollapseState(headerId, isCollapsed) {
    try {
        const key = `autoBackupTimer_collapse_${headerId}`;
        await browserAPI.storage.local.set({ [key]: isCollapsed });
    } catch (error) {
        console.error('保存折叠状态失败:', error);
    }
}

/**
 * 加载折叠状态
 */
async function loadCollapseStates() {
    const headers = ['realtimeBackupHeader', 'regularTimeHeader', 'specificTimeHeader'];
    
    for (const headerId of headers) {
        try {
            const key = `autoBackupTimer_collapse_${headerId}`;
            const result = await browserAPI.storage.local.get(key);
            const isCollapsed = result[key];
            
            if (isCollapsed !== undefined) {
                const header = document.getElementById(headerId);
                const content = header?.nextElementSibling;
                
                if (header && content) {
                    if (isCollapsed) {
                        header.classList.add('collapsed');
                        content.style.display = 'none';
                    } else {
                        header.classList.remove('collapsed');
                        content.style.display = 'block';
                    }
                }
            }
        } catch (error) {
            console.error('加载折叠状态失败:', headerId, error);
        }
    }
}

/**
 * 设置模式切换事件
 * 规则：
 * 1. 实时备份 与 (常规时间 + 特定时间) 互斥
 * 2. 常规时间和特定时间可以同时开启
 * 3. 每个都可以独立关闭/开启
 */
function setupModeSwitchEvents() {
    const toggles = {
        realtime: document.getElementById('realtimeBackupToggle'),
        regular: document.getElementById('regularTimeToggle'),
        specific: document.getElementById('specificTimeToggle')
    };
    
    // 辅助函数：切换按钮状态
    function setToggleState(toggle, enabled) {
        if (!toggle) return;
        if (enabled) {
            toggle.setAttribute('data-state', 'on');
            toggle.style.backgroundColor = '#4CAF50';
            toggle.querySelector('.toggle-circle').style.left = 'auto';
            toggle.querySelector('.toggle-circle').style.right = '3px';
        } else {
            toggle.setAttribute('data-state', 'off');
            toggle.style.backgroundColor = '#ccc';
            toggle.querySelector('.toggle-circle').style.right = 'auto';
            toggle.querySelector('.toggle-circle').style.left = '3px';
        }
    }
    
    // 辅助函数：更新存储中的启用状态
    async function updateEnabledStates(realtime, regular, specific) {
        const settings = await getAutoBackupSettings();
        settings.regularTime.enabled = regular;
        settings.specificTime.enabled = specific;
        
        // 设置备份模式
        if (realtime) {
            settings.backupMode = 'realtime';
        } else if (regular && specific) {
            settings.backupMode = 'both'; // 两个都开启
        } else if (regular) {
            settings.backupMode = 'regular';
        } else if (specific) {
            settings.backupMode = 'specific';
        } else {
            settings.backupMode = 'none'; // 全部关闭
        }
        
        await saveAutoBackupSettings(settings);
        
        // 通知后台
        browserAPI.runtime.sendMessage({ 
            action: 'autoBackupModeChanged', 
            mode: settings.backupMode,
            regularEnabled: regular,
            specificEnabled: specific
        });
    }
    
    // 实时备份开关
    if (toggles.realtime) {
        toggles.realtime.addEventListener('click', async (e) => {
            e.stopPropagation();
            const currentState = toggles.realtime.getAttribute('data-state') === 'on';
            const newState = !currentState;
            
            if (newState) {
                // 开启实时备份，关闭常规和特定
                setToggleState(toggles.realtime, true);
                setToggleState(toggles.regular, false);
                setToggleState(toggles.specific, false);
                await updateEnabledStates(true, false, false);
            } else {
                // 关闭实时备份
                setToggleState(toggles.realtime, false);
                await updateEnabledStates(false, false, false);
            }
        });
    }
    
    // 常规时间开关
    if (toggles.regular) {
        toggles.regular.addEventListener('click', async (e) => {
            e.stopPropagation();
            const currentState = toggles.regular.getAttribute('data-state') === 'on';
            const newState = !currentState;
            const specificState = toggles.specific.getAttribute('data-state') === 'on';
            
            if (newState) {
                // 开启常规时间，关闭实时备份，特定时间保持不变
                setToggleState(toggles.realtime, false);
                setToggleState(toggles.regular, true);
                await updateEnabledStates(false, true, specificState);
                
                // 更新配置
                await saveRegularTimeConfig();
            } else {
                // 关闭常规时间
                setToggleState(toggles.regular, false);
                await updateEnabledStates(false, false, specificState);
            }
        });
    }
    
    // 特定时间开关
    if (toggles.specific) {
        toggles.specific.addEventListener('click', async (e) => {
            e.stopPropagation();
            const currentState = toggles.specific.getAttribute('data-state') === 'on';
            const newState = !currentState;
            const regularState = toggles.regular.getAttribute('data-state') === 'on';
            
            if (newState) {
                // 开启特定时间，关闭实时备份，常规时间保持不变
                setToggleState(toggles.realtime, false);
                setToggleState(toggles.specific, true);
                await updateEnabledStates(false, regularState, true);
            } else {
                // 关闭特定时间
                setToggleState(toggles.specific, false);
                await updateEnabledStates(false, regularState, false);
            }
        });
    }
}

/**
 * 设置常规时间配置事件
 */
function setupRegularTimeEvents() {
    // 周开关
    const weekCheckboxes = document.querySelectorAll('.week-day-checkbox');
    weekCheckboxes.forEach(cb => {
        cb.addEventListener('change', () => saveRegularTimeConfig());
    });
    
    // 默认时间
    const defaultTimeInput = document.getElementById('regularDefaultTime');
    if (defaultTimeInput) {
        defaultTimeInput.addEventListener('change', () => saveRegularTimeConfig());
    }
    
    // 小时间隔开关
    const hourSwitch = document.getElementById('hourIntervalSwitch');
    if (hourSwitch) {
        hourSwitch.addEventListener('change', () => saveRegularTimeConfig());
    }
    
    // 小时间隔值
    const hourValue = document.getElementById('hourIntervalValue');
    if (hourValue) {
        hourValue.addEventListener('change', () => saveRegularTimeConfig());
    }
    
    // 分钟间隔开关
    const minuteSwitch = document.getElementById('minuteIntervalSwitch');
    if (minuteSwitch) {
        minuteSwitch.addEventListener('change', () => saveRegularTimeConfig());
    }
    
    // 分钟间隔值
    const minuteValue = document.getElementById('minuteIntervalValue');
    if (minuteValue) {
        minuteValue.addEventListener('change', () => saveRegularTimeConfig());
    }
}

/**
 * 保存常规时间配置
 */
async function saveRegularTimeConfig() {
    const weekCheckboxes = document.querySelectorAll('.week-day-checkbox');
    const weekDays = Array.from(weekCheckboxes).map(cb => cb.checked);
    
    const defaultTime = document.getElementById('regularDefaultTime')?.value || '10:00';
    const hourEnabled = document.getElementById('hourIntervalSwitch')?.checked || false;
    const hourValue = parseInt(document.getElementById('hourIntervalValue')?.value) || 2;
    const minuteEnabled = document.getElementById('minuteIntervalSwitch')?.checked || false;
    const minuteValue = parseInt(document.getElementById('minuteIntervalValue')?.value) || 15;
    
    const config = {
        enabled: true,
        weekDays,
        defaultTime,
        hourInterval: {
            enabled: hourEnabled,
            hours: hourValue
        },
        minuteInterval: {
            enabled: minuteEnabled,
            minutes: minuteValue
        }
    };
    
    await updateRegularTimeConfig(config);
    
    // 通知后台重启定时器
    browserAPI.runtime.sendMessage({ action: 'restartAutoBackupTimer' });
}

/**
 * 设置特定时间配置事件
 * @param {string} lang - 语言
 */
function setupSpecificTimeEvents(lang) {
    // 添加计划按钮
    const addBtn = document.getElementById('addScheduleBtn');
    if (addBtn) {
        addBtn.addEventListener('click', async () => {
            const datetimeInput = document.getElementById('newScheduleDatetime');
            if (!datetimeInput || !datetimeInput.value) {
                alert(lang === 'zh_CN' ? '请选择时间' : 'Please select time');
                return;
            }
            
            const schedule = await addSpecificTimeSchedule({
                datetime: datetimeInput.value,
                enabled: true
            });
            
            if (schedule) {
                // 清空输入
                datetimeInput.value = '';
                
                // 重新加载UI
                await loadSettings();
                
                // 通知后台重启定时器
                browserAPI.runtime.sendMessage({ action: 'restartAutoBackupTimer' });
            } else {
                alert(lang === 'zh_CN' ? '添加失败，已达到最大数量' : 'Failed to add, max limit reached');
            }
        });
    }
    
    // 设置datetime-local的默认值为当前时间+2小时
    const datetimeInput = document.getElementById('newScheduleDatetime');
    if (datetimeInput) {
        const now = new Date();
        now.setHours(now.getHours() + 2);
        // 使用本地时间格式化，避免时区问题
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        datetimeInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
    }
}

/**
 * 加载并应用设置到UI
 */
async function loadSettings() {
    try {
        const settings = await getAutoBackupSettings();
        const lang = await getCurrentLanguage();
        
        // 加载折叠状态
        await loadCollapseStates();
        
        // 辅助函数：设置toggle状态
        function setToggleState(toggle, enabled) {
            if (!toggle) return;
            if (enabled) {
                toggle.setAttribute('data-state', 'on');
                toggle.style.backgroundColor = '#4CAF50';
                toggle.querySelector('.toggle-circle').style.left = 'auto';
                toggle.querySelector('.toggle-circle').style.right = '3px';
            } else {
                toggle.setAttribute('data-state', 'off');
                toggle.style.backgroundColor = '#ccc';
                toggle.querySelector('.toggle-circle').style.right = 'auto';
                toggle.querySelector('.toggle-circle').style.left = '3px';
            }
        }
        
        // 设置模式开关
        const realtimeToggle = document.getElementById('realtimeBackupToggle');
        const regularToggle = document.getElementById('regularTimeToggle');
        const specificToggle = document.getElementById('specificTimeToggle');
        
        // 根据设置更新开关状态
        const isRealtime = settings.backupMode === 'realtime';
        const regularEnabled = settings.regularTime?.enabled || false;
        const specificEnabled = settings.specificTime?.enabled || false;
        
        setToggleState(realtimeToggle, isRealtime);
        setToggleState(regularToggle, regularEnabled);
        setToggleState(specificToggle, specificEnabled);
        
        // 加载常规时间配置
        if (settings.regularTime) {
            const weekCheckboxes = document.querySelectorAll('.week-day-checkbox');
            weekCheckboxes.forEach((cb, index) => {
                cb.checked = settings.regularTime.weekDays[index];
            });
            
            const defaultTimeInput = document.getElementById('regularDefaultTime');
            if (defaultTimeInput) {
                defaultTimeInput.value = settings.regularTime.defaultTime;
            }
            
            const hourSwitch = document.getElementById('hourIntervalSwitch');
            if (hourSwitch) {
                hourSwitch.checked = settings.regularTime.hourInterval.enabled;
            }
            
            const hourValue = document.getElementById('hourIntervalValue');
            if (hourValue) {
                hourValue.value = settings.regularTime.hourInterval.hours;
            }
            
            const minuteSwitch = document.getElementById('minuteIntervalSwitch');
            if (minuteSwitch) {
                minuteSwitch.checked = settings.regularTime.minuteInterval.enabled;
            }
            
            const minuteValue = document.getElementById('minuteIntervalValue');
            if (minuteValue) {
                minuteValue.value = settings.regularTime.minuteInterval.minutes;
            }
        }
        
        // 加载特定时间配置
        if (settings.specificTime) {
            renderSchedulesList(settings.specificTime.schedules, lang);
        }
    } catch (error) {
        console.error('加载设置失败:', error);
    }
}

/**
 * 应用语言到UI（用于动态切换）
 */
async function applyLanguageToUI() {
    const lang = await getCurrentLanguage();
    
    // 更新标题
    const realtimeTitle = document.getElementById('realtimeBackupTitle');
    if (realtimeTitle) realtimeTitle.textContent = getText('realtimeBackup', lang);
    
    const regularHeader = document.getElementById('regularTimeHeader');
    if (regularHeader) {
        const h2 = regularHeader.querySelector('h2 span');
        if (h2) h2.textContent = getText('regularTime', lang);
    }
    
    const specificHeader = document.getElementById('specificTimeHeader');
    if (specificHeader) {
        const h2 = specificHeader.querySelector('h2 span');
        if (h2) h2.textContent = getText('specificTime', lang);
    }
    
    // 更新实时备份描述
    const realtimeDesc = document.getElementById('realtimeBackupDesc1');
    if (realtimeDesc) realtimeDesc.textContent = getText('realtimeDesc', lang);
    
    // 更新常规时间的文本标签
    const weekDaysLabel = document.querySelector('.week-days-label');
    if (weekDaysLabel) weekDaysLabel.textContent = getText('selectWeekDays', lang) + ':';
    
    const defaultTimeLabel = document.querySelector('.default-time-label');
    if (defaultTimeLabel) defaultTimeLabel.textContent = getText('defaultTime', lang) + ':';
    
    const hourIntervalLabel = document.querySelector('.hour-interval-label');
    if (hourIntervalLabel) hourIntervalLabel.textContent = getText('hourInterval', lang) + ':';
    
    const hourEveryLabel = document.querySelector('.hour-every-label');
    if (hourEveryLabel) hourEveryLabel.textContent = getText('every', lang);
    
    const hourUnitLabel = document.querySelector('.hour-unit-label');
    if (hourUnitLabel) hourUnitLabel.textContent = getText('hour', lang);
    
    const minuteIntervalLabel = document.querySelector('.minute-interval-label');
    if (minuteIntervalLabel) minuteIntervalLabel.textContent = getText('minuteInterval', lang) + ':';
    
    const minuteEveryLabel = document.querySelector('.minute-every-label');
    if (minuteEveryLabel) minuteEveryLabel.textContent = getText('every', lang);
    
    const minuteUnitLabel = document.querySelector('.minute-unit-label');
    if (minuteUnitLabel) minuteUnitLabel.textContent = getText('minute', lang);
    
    // 更新周勾选框的文本
    const weekDays = getText('weekDays', lang);
    const weekCheckboxes = document.querySelectorAll('.week-day-checkbox');
    weekCheckboxes.forEach(cb => {
        const dayIndex = parseInt(cb.getAttribute('data-day'));
        const span = cb.nextElementSibling;
        if (span && span.tagName === 'SPAN') {
            span.textContent = weekDays[dayIndex];
        }
    });
    
    // 更新常规时间描述（如果有）
    const regularContent = document.getElementById('regularTimeContent');
    if (regularContent) {
        const descDiv = regularContent.querySelector('div[style*="margin-bottom: 15px"]');
        if (descDiv) {
            descDiv.textContent = getText('regularDesc', lang);
        }
    }
    
    // 更新特定时间相关文本
    const specificContent = document.getElementById('specificTimeContent');
    if (specificContent) {
        const descDiv = specificContent.querySelector('div[style*="margin-bottom: 15px"]');
        if (descDiv) {
            descDiv.textContent = getText('specificDesc', lang) + '（' + getText('maxSchedules', lang) + '）';
        }
        
        const addScheduleTitle = specificContent.querySelector('div[style*="font-weight: 500"]');
        if (addScheduleTitle) {
            addScheduleTitle.textContent = getText('addSchedule', lang);
        }
        
        const addScheduleBtn = document.getElementById('addScheduleBtn');
        if (addScheduleBtn) {
            addScheduleBtn.textContent = getText('addSchedule', lang);
        }
    }
    
    // 重新渲染特定时间计划列表
    const settings = await getAutoBackupSettings();
    if (settings.specificTime && settings.specificTime.schedules) {
        renderSchedulesList(settings.specificTime.schedules, lang);
    }
}

// =======================================================
// 模块导出
// =======================================================

export {
    createAutoBackupTimerUI,
    initializeUIEvents,
    loadSettings,
    applyLanguageToUI,
    renderSchedulesList
};
