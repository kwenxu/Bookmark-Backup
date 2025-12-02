// Helper to render current keyboard shortcuts in the secondary UI
function updateShortcutsDisplay() {
    const shortcutsContent = document.getElementById('shortcutsContent');
    if (!shortcutsContent) return;

    const lang = typeof currentLang === 'string' ? currentLang : 'zh_CN';
    const isMac = navigator.platform?.toUpperCase().includes('MAC') || 
                  navigator.userAgent?.toUpperCase().includes('MAC');

    // 格式化快捷键显示（Mac上Alt显示为⌥）
    const formatKey = (key) => {
        if (!key) return key;
        if (isMac) {
            return key.replace(/Alt\+/gi, '⌥');
        }
        return key;
    };

    const render = (shortcuts) => {
        const safe = (value, fallback) => (value && typeof value === 'string') ? value : fallback;
        const defaultPrefix = isMac ? '⌥' : 'Alt+';
        const key2 = formatKey(safe(shortcuts.open_backup_history_view, defaultPrefix + '2'));
        const key3 = formatKey(safe(shortcuts.open_canvas_view, defaultPrefix + '3'));
        const key4 = formatKey(safe(shortcuts.open_additions_view, defaultPrefix + '4'));
        const key5 = formatKey(safe(shortcuts.open_recommend_view, defaultPrefix + '5'));

        shortcutsContent.innerHTML = `
            <div class="shortcuts-card">
                <div class="shortcuts-section">
                    <div class="shortcuts-header-row">
                        <div>${i18n.shortcutsTitle[lang]}</div>
                        <button id="openShortcutsSettingsBtn" class="shortcuts-settings-btn"
                            title="${i18n.shortcutsSettingsTooltip[lang]}">
                            <i class="fas fa-external-link-alt"></i>
                        </button>
                    </div>
                    <div class="shortcuts-columns-header">
                        <span class="shortcuts-key-header">${i18n.shortcutsTableHeaderKey[lang]}</span>
                        <span class="shortcuts-action-header">${i18n.shortcutsTableHeaderAction[lang]}</span>
                    </div>
                    <div class="shortcuts-list">
                        <div class="shortcuts-row">
                            <div class="shortcuts-key"><kbd>${key2}</kbd></div>
                            <div class="shortcuts-action">${i18n.shortcutHistory[lang]}</div>
                        </div>
                        <div class="shortcuts-row">
                            <div class="shortcuts-key"><kbd>${key3}</kbd></div>
                            <div class="shortcuts-action">${i18n.shortcutCanvas[lang]}</div>
                        </div>
                        <div class="shortcuts-row">
                            <div class="shortcuts-key"><kbd>${key4}</kbd></div>
                            <div class="shortcuts-action">${i18n.shortcutAdditions[lang]}</div>
                        </div>
                        <div class="shortcuts-row">
                            <div class="shortcuts-key"><kbd>${key5}</kbd></div>
                            <div class="shortcuts-action">${i18n.shortcutRecommend[lang]}</div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const openBtn = document.getElementById('openShortcutsSettingsBtn');
        if (openBtn && browserAPI && browserAPI.tabs) {
            openBtn.addEventListener('click', () => {
                try {
                    const ua = navigator.userAgent || '';
                    const isEdge = ua.includes('Edg/');
                    const url = isEdge
                        ? 'edge://extensions/shortcuts'
                        : 'chrome://extensions/shortcuts';
                    browserAPI.tabs.create({ url });
                } catch (e) {
                    console.warn('[Shortcuts] 打开浏览器快捷键设置页面失败:', e);
                }
            });
        }
    };

    if (browserAPI && browserAPI.commands && browserAPI.commands.getAll) {
        try {
            browserAPI.commands.getAll((commands) => {
                const map = {};
                if (Array.isArray(commands)) {
                    commands.forEach((c) => {
                        if (!c || !c.name) return;
                        if (c.shortcut) {
                            map[c.name] = c.shortcut;
                        }
                    });
                }
                render({
                    open_backup_history_view: map.open_backup_history_view,
                    open_canvas_view: map.open_canvas_view,
                    open_additions_view: map.open_additions_view,
                    open_recommend_view: map.open_recommend_view
                });
            });
        } catch (e) {
            console.warn('[Shortcuts] 读取快捷键失败，使用默认值:', e);
            render({});
        }
    } else {
        render({});
    }
}
