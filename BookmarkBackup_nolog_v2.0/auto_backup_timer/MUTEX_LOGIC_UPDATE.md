# 互斥逻辑更新记录

## 📋 更新内容

### 旧的逻辑（三个完全互斥）
```
实时备份 ⟷ 常规时间 ⟷ 特定时间
（任何时候只能有一个开启）
```

### 新的逻辑
```
实时备份 ⟷ (常规时间 + 特定时间)

规则：
1. 实时备份 与 (常规时间 + 特定时间) 互斥
2. 常规时间和特定时间可以同时开启
3. 每个都可以独立关闭/开启
4. 默认开启：常规时间
```

---

## ✅ 修改内容

### 1. 默认配置 (storage.js)
```javascript
export const DEFAULT_SETTINGS = {
    backupMode: 'regular',  // 默认为常规时间
    regularTime: {
        enabled: true,      // 常规时间默认开启
        // ...
    },
    specificTime: {
        enabled: false,     // 特定时间默认关闭
        // ...
    }
};
```

### 2. 模式切换逻辑 (settings-ui.js - setupModeSwitchEvents)

#### 实时备份开关
```javascript
if (newState) {
    // 开启实时备份 → 关闭常规和特定
    setToggleState(toggles.realtime, true);
    setToggleState(toggles.regular, false);
    setToggleState(toggles.specific, false);
} else {
    // 关闭实时备份 → 允许全部关闭
    setToggleState(toggles.realtime, false);
}
```

#### 常规时间开关
```javascript
if (newState) {
    // 开启常规时间 → 关闭实时备份，特定时间保持不变
    setToggleState(toggles.realtime, false);
    setToggleState(toggles.regular, true);
    // specificState 保持不变
} else {
    // 关闭常规时间 → 允许关闭
    setToggleState(toggles.regular, false);
}
```

#### 特定时间开关
```javascript
if (newState) {
    // 开启特定时间 → 关闭实时备份，常规时间保持不变
    setToggleState(toggles.realtime, false);
    setToggleState(toggles.specific, true);
    // regularState 保持不变
} else {
    // 关闭特定时间 → 允许关闭
    setToggleState(toggles.specific, false);
}
```

### 3. 状态存储
```javascript
async function updateEnabledStates(realtime, regular, specific) {
    settings.regularTime.enabled = regular;
    settings.specificTime.enabled = specific;
    
    // 设置备份模式
    if (realtime) {
        settings.backupMode = 'realtime';
    } else if (regular && specific) {
        settings.backupMode = 'both';      // 两个都开启
    } else if (regular) {
        settings.backupMode = 'regular';
    } else if (specific) {
        settings.backupMode = 'specific';
    } else {
        settings.backupMode = 'none';      // 全部关闭
    }
}
```

### 4. 加载设置 (loadSettings)
```javascript
// 根据设置更新开关状态
const isRealtime = settings.backupMode === 'realtime';
const regularEnabled = settings.regularTime?.enabled || false;
const specificEnabled = settings.specificTime?.enabled || false;

setToggleState(realtimeToggle, isRealtime);
setToggleState(regularToggle, regularEnabled);
setToggleState(specificToggle, specificEnabled);
```

### 5. 恢复默认 (setupActionButtons)
```javascript
restoreBtn.addEventListener('click', async () => {
    // 恢复为默认配置（常规时间开启）
    await saveAutoBackupSettings(DEFAULT_SETTINGS);
    
    // 重新加载UI
    await loadSettings();
    
    // 通知后台
    browserAPI.runtime.sendMessage({ 
        action: 'autoBackupModeChanged', 
        mode: 'regular',
        regularEnabled: true,
        specificEnabled: false
    });
});
```

---

## 🎯 使用场景

### 场景1：只使用常规时间（默认）
```
✅ 常规时间  ON
❌ 特定时间  OFF
❌ 实时备份  OFF
```

### 场景2：同时使用常规和特定
```
✅ 常规时间  ON
✅ 特定时间  ON
❌ 实时备份  OFF
```

### 场景3：只使用实时备份
```
❌ 常规时间  OFF  (被强制关闭)
❌ 特定时间  OFF  (被强制关闭)
✅ 实时备份  ON
```

### 场景4：关闭所有备份
```
❌ 常规时间  OFF
❌ 特定时间  OFF
❌ 实时备份  OFF
```

---

## 🔄 操作流程

### 用户操作：开启实时备份
```
1. 点击"实时备份"开关
2. 实时备份 → ON（绿色）
3. 常规时间 → OFF（灰色，自动关闭）
4. 特定时间 → OFF（灰色，自动关闭）
5. backupMode = 'realtime'
```

### 用户操作：开启常规时间
```
1. 点击"常规时间"开关
2. 常规时间 → ON（绿色）
3. 实时备份 → OFF（灰色，自动关闭）
4. 特定时间 → 保持当前状态
5. backupMode = 'regular' 或 'both'（如果特定时间也开启）
```

### 用户操作：同时开启常规和特定
```
1. 点击"常规时间"开关 → ON
2. 点击"特定时间"开关 → ON
3. 实时备份 → OFF（被互斥）
4. backupMode = 'both'
```

---

## 📤 后台消息格式

```javascript
{
    action: 'autoBackupModeChanged',
    mode: 'realtime' | 'regular' | 'specific' | 'both' | 'none',
    regularEnabled: boolean,
    specificEnabled: boolean
}
```

---

## 🧪 测试清单

### 基本互斥测试
- [ ] 开启实时备份 → 常规和特定自动关闭
- [ ] 开启常规时间 → 实时自动关闭，特定保持
- [ ] 开启特定时间 → 实时自动关闭，常规保持
- [ ] 同时开启常规和特定 → 两个都是ON，实时是OFF

### 关闭测试
- [ ] 可以关闭实时备份
- [ ] 可以关闭常规时间
- [ ] 可以关闭特定时间
- [ ] 可以全部关闭

### 默认状态测试
- [ ] 首次打开：常规时间ON，其他OFF
- [ ] 恢复默认：常规时间ON，其他OFF
- [ ] 重新加载：保持之前的状态

### 存储测试
- [ ] 状态正确保存到 storage
- [ ] 重启扩展后状态保持
- [ ] backupMode 正确反映当前状态

### 后台通知测试
- [ ] 切换模式时发送正确的消息
- [ ] regularEnabled 和 specificEnabled 参数正确
- [ ] background.js 正确处理新的消息格式

---

## 📝 相关文件

- `auto_backup_timer/storage.js` - 默认配置，导出 DEFAULT_SETTINGS
- `auto_backup_timer/settings-ui.js` - 互斥逻辑，事件处理，按钮处理
- `popup.js` - 可能需要移除旧的恢复默认逻辑（如果有）

---

**更新完成！** 🎉

现在用户可以：
1. 同时开启常规时间和特定时间
2. 或者单独使用实时备份
3. 三个功能可以独立关闭
4. 默认开启常规时间
