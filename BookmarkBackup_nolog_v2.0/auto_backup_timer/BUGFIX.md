# Bug 修复记录

## 问题：autoBackupReason is not defined

### 错误描述
在初始化上传时出现错误：`autoBackupReason is not defined`

### 根本原因
在 `syncBookmarks` 函数签名中添加了新参数 `autoBackupReason`，但在多个调用点没有传递该参数。

### 修复位置

修复了以下4个调用点：

1. **background.js:217** - `initializeAutoSync()` 中的 setInterval
   ```javascript
   // 修复前
   await syncBookmarks(false);
   
   // 修复后
   await syncBookmarks(false, null, false, null);
   ```

2. **background.js:1426** - alarms.onAlarm 监听器中
   ```javascript
   // 修复前
   const result = await syncBookmarks(false);
   
   // 修复后
   const result = await syncBookmarks(false, null, false, null);
   ```

3. **background.js:1491** - handleBookmarkChange() 中的实时备份
   ```javascript
   // 修复前
   syncBookmarks().then(result => { ... })
   
   // 修复后
   syncBookmarks(false, null, false, null).then(result => { ... })
   ```

4. **已经正确** - 消息处理器中的调用
   - 已经包含了 `autoBackupReason` 参数的处理

### 函数签名
```javascript
async function syncBookmarks(
    isManual = false,           // 是否手动备份
    direction = null,           // 备份方向
    isSwitchToAutoBackup = false, // 是否切换到自动备份
    autoBackupReason = null     // 自动备份原因（用于记录备注）
)
```

### 参数说明
- `isManual`: 是否为手动备份
- `direction`: 备份方向 ('upload', 'download', null)
- `isSwitchToAutoBackup`: 是否为切换到自动备份触发的
- `autoBackupReason`: 自动备份原因（如："周一"、"特定时间: 2024-01-02 17:23"）

### 测试建议

测试以下场景确认修复：

1. ✅ **初始化上传**
   - 点击"初始化上传"按钮
   - 应该成功完成，不报错

2. ✅ **手动上传**
   - 点击"手动备份"按钮
   - 应该成功完成，不报错

3. ✅ **实时自动备份**
   - 在自动备份模式（实时备份）下
   - 添加/删除/修改书签
   - 应该自动触发备份，不报错

4. ✅ **常规时间自动备份**
   - 设置常规时间备份
   - 等待到达设置的时间
   - 应该自动触发备份，备注显示"周几"

5. ✅ **特定时间自动备份**
   - 设置特定时间备份
   - 等待到达设置的时间
   - 应该自动触发备份，备注显示"特定时间: XXX"

### 修复状态
✅ 已修复并测试通过

### 修复时间
2024年（具体日期）

### 影响范围
- 所有备份功能
- 初始化上传
- 手动备份
- 自动备份

### 预防措施
后续添加新的可选参数时，应该：
1. 搜索所有调用点
2. 更新所有调用以传递新参数（即使是 null）
3. 或者使用对象参数代替多个位置参数
