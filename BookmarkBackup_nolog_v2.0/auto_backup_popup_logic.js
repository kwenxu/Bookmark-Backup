// =============================================================================
// 自动备份设置对话框逻辑
// 处理UI交互、选项卡切换、设置保存等功能
// =============================================================================

// 自动备份相关的全局变量
let autoBackupSettingsDialog = null;
let currentAutoBackupTab = 'realtime';

// 默认设置
const defaultAutoBackupSettings = {
    mode: 'realtime',
    cyclicSettings: {
        enabled: false,
        days: 0,
        hours: 0,
        minutes: 30
    },
    scheduledSettings: {
        time1: { enabled: false, time: '09:30' },
        time2: { enabled: false, time: '16:00' }
    }
};

/**
 * 初始化自动备份设置对话框
 */
function initializeAutoBackupDialog() {
    // 获取对话框元素
    autoBackupSettingsDialog = document.getElementById('autoBackupSettingsDialog');
    
    if (!autoBackupSettingsDialog) {
        console.error('自动备份设置对话框元素未找到');
        return;
    }
    
    // 绑定按钮事件
    bindAutoBackupDialogEvents();
    
    // 绑定选项卡切换
    bindTabSwitchEvents();
    
    // 绑定切换开关事件
    bindToggleEvents();
    
    console.log('自动备份设置对话框已初始化');
}

/**
 * 绑定对话框基本事件
 */
function bindAutoBackupDialogEvents() {
    // 自动备份设置按钮
    const autoBackupSettingsBtn = document.getElementById('autoBackupSettingsBtn');
    if (autoBackupSettingsBtn) {
        autoBackupSettingsBtn.addEventListener('click', openAutoBackupDialog);
    }
    
    // 关闭按钮
    const closeBtn = document.getElementById('closeAutoBackupSettings');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeAutoBackupDialog);
    }
    
    // 保存按钮
    const saveBtn = document.getElementById('saveAutoBackupSettings');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveAutoBackupSettings);
    }
    
    // 恢复默认按钮
    const restoreBtn = document.getElementById('restoreAutoBackupDefaults');
    if (restoreBtn) {
        restoreBtn.addEventListener('click', restoreAutoBackupDefaults);
    }
    
    // 点击对话框外部关闭
    if (autoBackupSettingsDialog) {
        autoBackupSettingsDialog.addEventListener('click', (event) => {
            if (event.target === autoBackupSettingsDialog) {
                closeAutoBackupDialog();
            }
        });
    }
}

/**
 * 绑定选项卡切换事件
 */
function bindTabSwitchEvents() {
    const tabButtons = document.querySelectorAll('.tab-button');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.dataset.tab;
            switchAutoBackupTab(tabName);
        });
    });
}

/**
 * 绑定切换开关事件
 */
function bindToggleEvents() {
    // 循环自动备份开关
    const cyclicToggle = document.getElementById('cyclicAutoToggle');
    if (cyclicToggle) {
        cyclicToggle.addEventListener('click', toggleCyclicAutoBackup);
    }
    
    // 定时备份开关
    const scheduled1Toggle = document.getElementById('scheduledToggle1');
    const scheduled2Toggle = document.getElementById('scheduledToggle2');
    
    if (scheduled1Toggle) {
        scheduled1Toggle.addEventListener('click', () => toggleScheduledBackup(1));
    }
    
    if (scheduled2Toggle) {
        scheduled2Toggle.addEventListener('click', () => toggleScheduledBackup(2));
    }
}

/**
 * 打开自动备份设置对话框
 */
async function openAutoBackupDialog() {
    if (!autoBackupSettingsDialog) {
        console.error('自动备份设置对话框未初始化');
        return;
    }
    
    // 加载当前设置
    await loadAutoBackupSettings();
    
    // 显示对话框
    autoBackupSettingsDialog.style.display = 'flex';
    
    // 设置焦点到第一个输入框
    const firstInput = autoBackupSettingsDialog.querySelector('input[type="number"], input[type="time"]');
    if (firstInput) {
        setTimeout(() => firstInput.focus(), 100);
    }
}

/**
 * 关闭自动备份设置对话框
 */
function closeAutoBackupDialog() {
    if (autoBackupSettingsDialog) {
        autoBackupSettingsDialog.style.display = 'none';
    }
}

/**
 * 切换选项卡
 * @param {string} tabName - 选项卡名称
 */
function switchAutoBackupTab(tabName) {
    // 更新当前选项卡
    currentAutoBackupTab = tabName;
    
    // 更新选项卡按钮状态
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
        if (button.dataset.tab === tabName) {
            button.classList.add('active');
            button.style.backgroundColor = 'var(--theme-accent-color)';
            button.style.color = 'white';
        } else {
            button.classList.remove('active');
            button.style.backgroundColor = 'transparent';
            button.style.color = 'var(--theme-text-secondary)';
        }
    });
    
    // 显示/隐藏对应的选项卡内容
    const tabContents = document.querySelectorAll('.tab-content');
    tabContents.forEach(content => {
        if (content.id === `${tabName}Tab`) {
            content.style.display = 'block';
        } else {
            content.style.display = 'none';
        }
    });
}

/**
 * 切换循环自动备份状态
 */
function toggleCyclicAutoBackup() {
    const toggle = document.getElementById('cyclicAutoToggle');
    if (!toggle) return;
    
    const isEnabled = toggle.dataset.state === 'on';
    const newState = isEnabled ? 'off' : 'on';
    
    // 更新按钮状态
    updateToggleButtonState(toggle, newState);
    
    // 更新输入框可用状态
    updateCyclicInputsState(newState === 'on');
}

/**
 * 切换准点定时备份状态
 * @param {number} slotNumber - 定时器槽位(1或2)
 */
function toggleScheduledBackup(slotNumber) {
    const toggle = document.getElementById(`scheduledToggle${slotNumber}`);
    if (!toggle) return;
    
    const isEnabled = toggle.dataset.state === 'on';
    const newState = isEnabled ? 'off' : 'on';
    
    // 更新按钮状态
    updateToggleButtonState(toggle, newState);
}

/**
 * 更新切换按钮的状态
 * @param {HTMLElement} button - 切换按钮元素
 * @param {string} state - 新状态 ('on' 或 'off')
 */
function updateToggleButtonState(button, state) {
    button.dataset.state = state;
    const circle = button.querySelector('.toggle-circle');
    
    if (state === 'on') {
        button.style.backgroundColor = '#4CAF50';
        if (circle) {
            circle.style.transform = 'translateX(18px)';
            circle.style.left = 'auto';
            circle.style.right = '3px';
        }
    } else {
        button.style.backgroundColor = '#ccc';
        if (circle) {
            circle.style.transform = 'translateX(0px)';
            circle.style.left = '3px';
            circle.style.right = 'auto';
        }
    }
}

/**
 * 更新循环备份输入框的可用状态
 * @param {boolean} enabled - 是否启用
 */
function updateCyclicInputsState(enabled) {
    const inputs = ['cyclicDays', 'cyclicHours', 'cyclicMinutes'];
    
    inputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.disabled = !enabled;
            input.style.opacity = enabled ? '1' : '0.5';
        }
    });
}

/**
 * 加载自动备份设置
 */
async function loadAutoBackupSettings() {
    try {
        const result = await new Promise(resolve => {
            chrome.storage.local.get([
                'autoBackupMode',
                'cyclicAutoBackupSettings',
                'scheduledAutoBackupSettings'
            ], resolve);
        });
        
        // 应用设置到UI
        applySettingsToUI(result);
        
    } catch (error) {
        console.error('加载自动备份设置失败:', error);
        showStatus('加载设置失败', 'error');
    }
}

/**
 * 将设置应用到UI
 * @param {object} settings - 设置对象
 */
function applySettingsToUI(settings) {
    // 设置当前模式
    const mode = settings.autoBackupMode || 'realtime';
    switchAutoBackupTab(mode);
    
    // 循环备份设置
    const cyclicSettings = settings.cyclicAutoBackupSettings || defaultAutoBackupSettings.cyclicSettings;
    
    document.getElementById('cyclicDays').value = cyclicSettings.days || 0;
    document.getElementById('cyclicHours').value = cyclicSettings.hours || 0;
    document.getElementById('cyclicMinutes').value = cyclicSettings.minutes || 30;
    
    const cyclicToggle = document.getElementById('cyclicAutoToggle');
    if (cyclicToggle) {
        updateToggleButtonState(cyclicToggle, cyclicSettings.enabled ? 'on' : 'off');
        updateCyclicInputsState(cyclicSettings.enabled);
    }
    
    // 准点定时设置
    const scheduledSettings = settings.scheduledAutoBackupSettings || defaultAutoBackupSettings.scheduledSettings;
    
    document.getElementById('scheduledTime1').value = scheduledSettings.time1.time || '09:30';
    document.getElementById('scheduledTime2').value = scheduledSettings.time2.time || '16:00';
    
    const toggle1 = document.getElementById('scheduledToggle1');
    const toggle2 = document.getElementById('scheduledToggle2');
    
    if (toggle1) {
        updateToggleButtonState(toggle1, scheduledSettings.time1.enabled ? 'on' : 'off');
    }
    
    if (toggle2) {
        updateToggleButtonState(toggle2, scheduledSettings.time2.enabled ? 'on' : 'off');
    }
}

/**
 * 收集UI中的设置
 * @returns {object} 设置对象
 */
function collectSettingsFromUI() {
    const cyclicToggle = document.getElementById('cyclicAutoToggle');
    const toggle1 = document.getElementById('scheduledToggle1');
    const toggle2 = document.getElementById('scheduledToggle2');
    
    return {
        mode: currentAutoBackupTab,
        cyclicSettings: {
            enabled: cyclicToggle?.dataset.state === 'on',
            days: parseInt(document.getElementById('cyclicDays').value) || 0,
            hours: parseInt(document.getElementById('cyclicHours').value) || 0,
            minutes: parseInt(document.getElementById('cyclicMinutes').value) || 30
        },
        scheduledSettings: {
            time1: {
                enabled: toggle1?.dataset.state === 'on',
                time: document.getElementById('scheduledTime1').value || '09:30'
            },
            time2: {
                enabled: toggle2?.dataset.state === 'on', 
                time: document.getElementById('scheduledTime2').value || '16:00'
            }
        }
    };
}

/**
 * 验证设置的有效性
 * @param {object} settings - 设置对象
 * @returns {object} 验证结果
 */
function validateAutoBackupSettings(settings) {
    const errors = [];
    
    // 验证循环备份时间间隔
    if (settings.cyclicSettings.enabled) {
        const { days, hours, minutes } = settings.cyclicSettings;
        const totalMinutes = days * 1440 + hours * 60 + minutes;
        
        if (totalMinutes <= 0) {
            errors.push('循环备份时间间隔必须大于0');
        }
        
        if (days > 30 || hours > 24 || minutes > 60) {
            errors.push('时间输入值超出允许范围');
        }
    }
    
    // 验证准点定时设置
    if (settings.scheduledSettings.time1.enabled || settings.scheduledSettings.time2.enabled) {
        const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
        
        if (settings.scheduledSettings.time1.enabled && !timeRegex.test(settings.scheduledSettings.time1.time)) {
            errors.push('定时1的时间格式无效');
        }
        
        if (settings.scheduledSettings.time2.enabled && !timeRegex.test(settings.scheduledSettings.time2.time)) {
            errors.push('定时2的时间格式无效');
        }
    }
    
    return {
        valid: errors.length === 0,
        errors: errors
    };
}

/**
 * 保存自动备份设置
 */
async function saveAutoBackupSettings() {
    try {
        // 收集UI设置
        const settings = collectSettingsFromUI();
        
        // 验证设置
        const validation = validateAutoBackupSettings(settings);
        if (!validation.valid) {
            showStatus(validation.errors.join('; '), 'error');
            return;
        }
        
        // 显示保存中状态
        showAutoBackupSavedIndicator();
        
        // 保存到存储
        await new Promise((resolve, reject) => {
            chrome.storage.local.set({
                autoBackupMode: settings.mode,
                cyclicAutoBackupSettings: settings.cyclicSettings,
                scheduledAutoBackupSettings: settings.scheduledSettings
            }, () => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve();
                }
            });
        });
        
        // 通知背景脚本更新自动备份系统
        await new Promise((resolve) => {
            chrome.runtime.sendMessage({
                action: 'updateAutoBackupSettings',
                settings: settings
            }, (response) => {
                resolve(response);
            });
        });
        
        console.log('自动备份设置已保存:', settings);
        
        // 延迟关闭对话框
        setTimeout(() => {
            closeAutoBackupDialog();
        }, 1000);
        
    } catch (error) {
        console.error('保存自动备份设置失败:', error);
        showStatus('保存设置失败', 'error');
    }
}

/**
 * 恢复默认设置
 */
async function restoreAutoBackupDefaults() {
    try {
        // 应用默认设置到UI
        applySettingsToUI({
            autoBackupMode: defaultAutoBackupSettings.mode,
            cyclicAutoBackupSettings: defaultAutoBackupSettings.cyclicSettings,
            scheduledAutoBackupSettings: defaultAutoBackupSettings.scheduledSettings
        });
        
        showStatus('已恢复默认设置', 'success', 2000);
        
    } catch (error) {
        console.error('恢复默认设置失败:', error);
        showStatus('恢复默认设置失败', 'error');
    }
}

/**
 * 显示保存成功指示器
 */
function showAutoBackupSavedIndicator() {
    const indicator = document.getElementById('autoBackupSettingsSavedIndicator');
    if (!indicator) return;
    
    indicator.style.display = 'block';
    indicator.style.opacity = '1';
    indicator.style.transform = 'translateY(0)';
    
    setTimeout(() => {
        indicator.style.opacity = '0';
        indicator.style.transform = 'translateY(10px)';
        setTimeout(() => {
            indicator.style.display = 'none';
        }, 300);
    }, 2000);
}

/**
 * 更新右侧状态容器的显示文本
 * @param {string} mode - 当前自动备份模式
 */
function updateRightStatusContainer(mode) {
    const container = document.getElementById('change-description-row');
    if (!container) return;
    
    let statusText = '';
    let statusClass = 'status-info';
    
    switch (mode) {
        case 'realtime':
            statusText = '实时自动备份已开启';
            break;
        case 'cyclic':
            statusText = '循环自动备份已开启';
            break;
        case 'scheduled':
            statusText = '准点定时备份已开启';
            break;
        default:
            statusText = '实时自动备份已开启';
    }
    
    container.innerHTML = `
        <div class="status ${statusClass}" style="
            background-color: var(--theme-status-info-bg);
            color: var(--theme-status-info-text);
            border: 1px solid var(--theme-status-info-border);
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 13px;
            text-align: center;
        ">
            ${statusText}
        </div>
    `;
}

// 导出函数供其他模块使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        initializeAutoBackupDialog,
        openAutoBackupDialog,
        closeAutoBackupDialog,
        updateRightStatusContainer
    };
}