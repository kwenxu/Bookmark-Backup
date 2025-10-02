# 测试指南

## 🔍 问题诊断

### UI 未显示的可能原因
1. **模块加载失败** - ES6 import 错误
2. **函数执行错误** - JavaScript 运行时错误
3. **HTML 容器缺失** - DOM元素未找到
4. **CSS 样式问题** - UI创建了但不可见

---

## 🧪 测试步骤

### 第1步：重新加载扩展
1. 打开 `chrome://extensions/` 或 `edge://extensions/`
2. 找到 Bookmark Backup 扩展
3. 点击刷新按钮 🔄

### 第2步：打开开发者控制台
1. 在扩展页面，点击 **Service Worker** 或 **背景页** 链接
2. 这会打开 background.js 的控制台
3. 同时，点击扩展图标打开 popup
4. 在 popup 上右键 → 检查元素，打开 popup 的控制台

### 第3步：点击"自动备份设置"按钮
打开 popup 后，点击"自动备份设置"按钮，观察控制台输出。

#### 预期看到的日志：
```
[自动备份设置] 开始初始化UI...
[自动备份设置] 容器元素: <div id="autoBackupTimerUIContainer">
[自动备份设置] 容器为空，开始创建UI
[自动备份设置] 当前语言: zh_CN
[自动备份设置] 调用 createAutoBackupTimerUI...
[自动备份设置] UI创建成功: <div id="autoBackupTimerContainer">...</div>
[自动备份设置] UI已插入到容器
[自动备份设置] 初始化UI事件...
[自动备份设置] 加载设置...
[自动备份设置] 初始化完成！
```

#### 如果出现错误：
- **"找不到UI容器元素"** → 检查 popup.html 中是否有 `autoBackupTimerUIContainer`
- **"初始化失败: ..."** → 查看具体错误信息
- **"Cannot find module"** → 检查文件路径和 ES6 import

### 第4步：检查 DOM 结构
在 popup 的控制台中运行：
```javascript
document.getElementById('autoBackupTimerUIContainer')
document.getElementById('autoBackupTimerContainer')
document.getElementById('realtimeBackupToggle')
```

应该都能找到对应的元素。

### 第5步：测试功能
在对话框中，您应该看到：

```
┌─────────────────────────────────────┐
│  自动备份设置                    × │
├─────────────────────────────────────┤
│                                     │
│  实时备份              [ON]        │
│  当检测到「数量/结构变化」时        │
│  立即执行备份                       │
│                                     │
│  (常规时间和特定时间UI也会显示)     │
│                                     │
│  [恢复默认]          [保存]        │
└─────────────────────────────────────┘
```

---

## 🐛 常见问题排查

### 问题1：控制台显示 "Cannot find module"
**原因：** ES6 模块导入路径错误

**解决：**
1. 确认文件存在：
   ```
   auto_backup_timer/
   ├── index.js
   ├── storage.js
   ├── timer.js
   └── settings-ui.js
   ```
2. 检查 popup.js 第4行的导入路径
3. 确认 manifest.json 中 popup.js 的 type 是 "module"

### 问题2：UI创建成功但不显示
**原因：** CSS 样式问题或主题变量未定义

**解决：**
在控制台运行：
```javascript
const container = document.getElementById('autoBackupTimerUIContainer');
console.log('容器样式:', window.getComputedStyle(container));
console.log('容器子元素:', container.children);
```

检查：
- `display` 是否为 `none`
- `visibility` 是否为 `hidden`
- `height` 是否为 `0`

### 问题3：点击"自动备份设置"没有反应
**原因：** 事件监听器未绑定

**解决：**
在控制台运行：
```javascript
const btn = document.getElementById('autoBackupSettingsBtn');
console.log('按钮:', btn);
console.log('事件:', btn ? getEventListeners(btn) : '按钮不存在');
```

### 问题4："autoBackupReason is not defined"
**原因：** syncBookmarks 函数调用缺少参数

**状态：** 已修复（见 BUGFIX.md）

如果仍然出现，检查：
1. background.js 中所有 `syncBookmarks(` 调用
2. 确保都传递了4个参数
3. `updateSyncStatus` 函数签名包含 `autoBackupReason`

---

## ✅ 验证清单

测试完成后，确认以下功能：

### UI显示
- [ ] 自动备份设置对话框能打开
- [ ] 看到"实时备份"块
- [ ] 看到"常规时间"块（可折叠）
- [ ] 看到"特定时间"块（可折叠）
- [ ] 切换按钮可以点击
- [ ] 开关按钮颜色正确（ON=绿色，OFF=灰色）

### 基本交互
- [ ] 点击开关能切换状态
- [ ] 折叠/展开功能正常
- [ ] "恢复默认"按钮有效
- [ ] "保存"按钮有效
- [ ] 保存后显示"设置已保存"提示

### 数据持久化
- [ ] 关闭对话框再打开，设置保持
- [ ] 重新打开扩展，设置保持

### 常规时间功能
- [ ] 周开关能选择
- [ ] 默认时间能设置
- [ ] 小时间隔能启用/设置
- [ ] 分钟间隔能启用/设置

### 特定时间功能
- [ ] 能添加时间计划
- [ ] 能删除时间计划
- [ ] 能启用/禁用计划
- [ ] 最多5个计划的限制有效

### 备份功能
- [ ] 初始化上传不报错
- [ ] 手动备份正常
- [ ] 自动备份正常触发
- [ ] 备份记录有正确备注

---

## 📝 报告问题

如果测试失败，请提供：

1. **完整的错误信息**（从控制台复制）
2. **控制台截图**
3. **操作步骤**（例如：点击了什么，期望什么，实际看到什么）
4. **浏览器版本**（Chrome/Edge + 版本号）

示例：
```
错误：Cannot read property 'style' of null
位置：settings-ui.js:123
操作：点击"自动备份设置"按钮
期望：看到UI
实际：对话框打开但内容为空
浏览器：Chrome 120.0.6099.129
```

---

## 🚀 下一步

测试通过后：
1. 移除调试日志（可选）
2. 提交代码到 Git
3. 创建 Release 版本
4. 编写用户使用手册

测试失败时：
1. 提供详细的错误信息
2. 我会立即修复问题
3. 继续测试循环直到成功
