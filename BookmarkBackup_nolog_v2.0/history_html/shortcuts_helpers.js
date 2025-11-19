// Helper to render current keyboard shortcuts in the secondary UI
function updateShortcutsDisplay() {
    const shortcutsContent = document.getElementById('shortcutsContent');
    if (!shortcutsContent) return;

    const lang = typeof currentLang === 'string' ? currentLang : 'zh_CN';

    const render = (shortcuts) => {
        const safe = (value, fallback) => (value && typeof value === 'string') ? value : fallback;
        const key1 = safe(shortcuts.open_current_changes_view, 'Alt+1');
        const key2 = safe(shortcuts.open_backup_history_view, 'Alt+2');
        const key3 = safe(shortcuts.open_canvas_view, 'Alt+3');
        const key4 = safe(shortcuts.open_additions_view, 'Alt+4');

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
                    <table>
                        <thead>
                            <tr>
                                <th>${i18n.shortcutsTableHeaderKey[lang]}</th>
                                <th>${i18n.shortcutsTableHeaderAction[lang]}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td class="shortcuts-key-cell"><kbd>${key1}</kbd></td>
                                <td class="shortcuts-action-cell">${i18n.shortcutCurrentChanges[lang]}</td>
                            </tr>
                            <tr>
                                <td class="shortcuts-key-cell"><kbd>${key2}</kbd></td>
                                <td class="shortcuts-action-cell">${i18n.shortcutHistory[lang]}</td>
                            </tr>
                            <tr>
                                <td class="shortcuts-key-cell"><kbd>${key3}</kbd></td>
                                <td class="shortcuts-action-cell">${i18n.shortcutCanvas[lang]}</td>
                            </tr>
                            <tr>
                                <td class="shortcuts-key-cell"><kbd>${key4}</kbd></td>
                                <td class="shortcuts-action-cell">${i18n.shortcutAdditions[lang]}</td>
                            </tr>
                        </tbody>
                    </table>
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
                    open_current_changes_view: map.open_current_changes_view,
                    open_backup_history_view: map.open_backup_history_view,
                    open_canvas_view: map.open_canvas_view,
                    open_additions_view: map.open_additions_view
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
