# dn42-portal 全代码库深度安全与架构审查报告

> **审查说明**：本次审查对 `dn42-portal` 全量代码（涵盖后端核心服务、数据存储层、加密验签体系、端口分配引擎、单源规则系统、CLI/WASM Linux 运行时、前端 GUI 组件与宿主通信层）进行了系统性审计。
> 本报告**只定位隐患与缺陷，未改动任何源码**。

---

## 📊 缺陷与隐患总览

| 编号 | 类别 | 严重级别 | 隐患简述 | 涉及文件 / 行号 |
| :--- | :--- | :---: | :--- | :--- |
| **H1** | 安全与执行 | 🔴 高危 | `peer new` 草稿解析 `eval` 未转义，存在命令注入与语法崩溃风险 | [`cli/cli-src/bin/peer`](file:///g:/Akira/Agents_Workspace/anti/dn42-portal/cli/cli-src/bin/peer#L166-L203) |
| **H2** | 安全与执行 | 🔴 高危 | `read_line_edit` 特殊字符（`$`, `"`, `` ` ``）引发变量求值与注入 | [`cli/cli-src/etc/dn42-lib.sh`](file:///g:/Akira/Agents_Workspace/anti/dn42-portal/cli/cli-src/etc/dn42-lib.sh#L306) |
| **H3** | 数据完整性 | 🔴 高危 | 内置编辑器 `nano` 保存时使用 `printf '%b'` 破坏字面量反斜杠 | [`cli/cli-src/bin/nano`](file:///g:/Akira/Agents_Workspace/anti/dn42-portal/cli/cli-src/bin/nano#L138) |
| **H4** | 并发与状态 | 🔴 高危 | 账本读-算-写缺乏事务锁，并发互联申请存在端口分配竞争覆盖 | [`server/services/portLedgerService.js`](file:///g:/Akira/Agents_Workspace/anti/dn42-portal/server/services/portLedgerService.js#L38-L106) |
| **M1** | 契约对齐 | 🟠 中危 | 密码长度前后端契约错位（GUI 提示/放行 6 位 vs 后端强制拦截 8 位） | [`PasswordModal.tsx`](file:///g:/Akira/Agents_Workspace/anti/dn42-portal/gui/src/components/PasswordModal.tsx#L21), [`authService.js`](file:///g:/Akira/Agents_Workspace/anti/dn42-portal/server/services/authService.js#L322) |
| **M2** | 配置生成 | 🟠 中危 | 管理员 WG 配置片段在指定 Endpoint + 自定义 clientPort 时缺失端口 | [`server/services/configEngine.js`](file:///g:/Akira/Agents_Workspace/anti/dn42-portal/server/services/configEngine.js#L95-L98) |
| **M3** | 可靠性 | 🟠 中危 | Telegram 通知 Markdown V1 未转义下划线等符号，导致通知静默失败 | [`server/services/notificationService.js`](file:///g:/Akira/Agents_Workspace/anti/dn42-portal/server/services/notificationService.js#L23-L56) |
| **M4** | 防御深度 | 🟠 中危 | 静态资源处理未显式做 `path.resolve` 边界校验（Windows 路径隔离） | [`server/index.js`](file:///g:/Akira/Agents_Workspace/anti/dn42-portal/server/index.js#L248-L277) |
| **L1** | 状态持久化 | 🟡 低危 | `rememberMe: false` 仍被宿主网关写入 `localStorage`，刷新后未登出 | [`cli/public/index.html`](file:///g:/Akira/Agents_Workspace/anti/dn42-portal/cli/public/index.html#L347-L364) |
| **L2** | 容错处理 | 🟡 低危 | `whois` 脚本单行 `sed` 正则提取在复杂对象时存在解析截断风险 | [`cli/cli-src/bin/whois`](file:///g:/Akira/Agents_Workspace/anti/dn42-portal/cli/cli-src/bin/whois#L27-L43) |

---

## 🔍 详细问题分析与风险评估

### 🔴 H1：`peer new` 草稿解析 `eval` 未转义命令注入与语法崩溃

- **文件定位**：[`cli/cli-src/bin/peer:L166-203`](file:///g:/Akira/Agents_Workspace/anti/dn42-portal/cli/cli-src/bin/peer#L166-L203)
- **代码片段**：
  ```awk
  eval "$(awk '
    ...
    if (key=="node") printf "parsed_node=%s\n", val
    else if (key=="link-localipv6(lla)" ...) printf "parsed_lla=%s\n", val
    ...
  ' "$draft_file")"
  ```
- **隐患根因**：
  `awk` 输出的赋值语句未给 `%s` 加上双引号或转义（如输出 `parsed_node=JP-TYO-1 (Tokyo Hub)` 或 `parsed_ep=my host.dn42`）。当 shell 执行 `eval` 时：
  1. 如果值中含有空格和括号（例如用户在节点后附带了注释），shell 会将括号当作子 shell 执行：`sh: syntax error: unexpected "("`，导致互联向导直接崩溃并退出。
  2. 如果值中含有 `$(reboot)` 等指令，会在 `eval` 过程中被执行。
- **修复建议**：
  在 `awk` 的 `printf` 输出中统一使用安全转义包裹双引号，例如 `printf "parsed_node=\"%s\"\n", val`，并在 awk 提取前过滤危险的 `$` 与反引号。

---

### 🔴 H2：`read_line_edit` 特殊字符引发变量求值与注入

- **文件定位**：[`cli/cli-src/etc/dn42-lib.sh:L306`](file:///g:/Akira/Agents_Workspace/anti/dn42-portal/cli/cli-src/etc/dn42-lib.sh#L306)
- **代码片段**：
  ```bash
  if [ -n "$_target_var" ]; then
    eval "$_target_var=\"\$_buf\""
  fi
  ```
- **隐患根因**：
  `read_line_edit` 在读取用户输入（如密码、ASN、确认提示）后，使用 `eval "$_target_var=\"\$_buf\""` 将缓冲区回填给变量。
  如果用户输入的密码或字段包含 `$`、`"`、`` ` `` 或 `\`（例如密码为 `p@ss$word"123`）：
  - shell 在 `eval` 阶段会展开 `$_buf` 内的 `$word` 变量（被置为空），并将 `"` 当作字符串截断，导致最终设置的密码与用户真实输入的按键不一致，甚至产生语法错误。
- **修复建议**：
  避免使用 `eval` 展开 `_buf` 的内容，改用安全回填方式（如 `export "$_target_var=$_buf"` 或临时变量传参）。

---

### 🔴 H3：内置编辑器 `nano` 保存时 `printf '%b'` 破坏字面量反斜杠

- **文件定位**：[`cli/cli-src/bin/nano:L130-142`](file:///g:/Akira/Agents_Workspace/anti/dn42-portal/cli/cli-src/bin/nano#L130-L142)
- **代码片段**：
  ```bash
  save_file() {
    _tmp_out="${FILE}.tmp.$$"
    _i=0
    _buf=""
    while [ "$_i" -lt "$NUM_LINES" ]; do
      eval "_l=\$L_$_i"
      _buf="${_buf}${_l}\n"
      _i=$((_i + 1))
    done
    printf '%b' "$_buf" > "$_tmp_out"
    mv -f "$_tmp_out" "$FILE"
    ...
  }
  ```
- **隐患根因**：
  `printf '%b'` 在 POSIX / Busybox 标准下会**自动解释并转义参数中的所有反斜杠序列**（如 `\t` 转为制表符、`\n` 转为换行、`\0` 视为 NUL 截断、`\\` 变为 `\`）。
  如果用户在编辑器中编辑包含字面量反斜杠的配置文件或脚本，经 `nano` 保存后，所有的 `\` 都会被自动展开或截断变形。
- **修复建议**：
  改用标准行输出 `printf '%s\n'` 逐行写入或通过文件流重定向，杜绝 `%b` 的自动转义。

---

### 🔴 H4：服务端并发端口分配与账本读写竞争条件 (Race Condition)

- **文件定位**：[`server/services/portLedgerService.js:L38-106`](file:///g:/Akira/Agents_Workspace/anti/dn42-portal/server/services/portLedgerService.js#L38-L106)、[`server/storage/fileStore.js:L48-79`](file:///g:/Akira/Agents_Workspace/anti/dn42-portal/server/storage/fileStore.js#L48-L79)
- **代码片段**：
  ```javascript
  static async allocateAndLockPort({ nodeId, asn, requestedPort = 'auto', sessionId = '', description = '' }) {
    const ledger = await this.getLedger(); // 1. 读磁盘
    ... // 2. 内存计算可用端口 / 冲突偏移
    ledger[nodeId].push(entry);
    await this.saveLedger(ledger); // 3. 异步排队写磁盘
  }
  ```
- **隐患根因**：
  `FileStore.writeJson` 只在最后的写入阶段维护了一个 Promise 队列，但**读 -> 算 -> 写**的完整事务并未被互斥锁保护。
  当同一毫秒内有两个并发请求到达后端申请同一节点时：
  1. 请求 A 读取 `port_ledger.json`（版本 1）。
  2. 请求 B 读取 `port_ledger.json`（版本 1）。
  3. 请求 A 计算分配端口 23143，并将结果推入写入队列（版本 2）。
  4. 请求 B 由于读取的是版本 1，同样计算出端口 23143，并将结果推入写入队列（版本 3）。
  5. 最终结果：两个会话被分配了**同一个端口**，且后写入的文件覆盖了先写入的会话记录。
- **修复建议**：
  将整个 `allocateAndLockPort` 事务过程（从读取、冲突偏移计算到保存）纳入节点级或文件级的异步互斥排队锁（Async Mutex）中。

---

### 🟠 M1：密码最小长度前后端契约错位 (GUI 6 位 vs 后端 8 位)

- **文件定位**：
  - 前端：[`gui/src/components/PasswordModal.tsx:L21, L80`](file:///g:/Akira/Agents_Workspace/anti/dn42-portal/gui/src/components/PasswordModal.tsx#L21) (`placeholder="At least 6 characters"`, `password.length < 6`)
  - 前端：[`gui/src/components/AuthModal.tsx:L168`](file:///g:/Akira/Agents_Workspace/anti/dn42-portal/gui/src/components/AuthModal.tsx#L168) (`newPassword.length < 6`)
  - 后端：[`server/services/authService.js:L322`](file:///g:/Akira/Agents_Workspace/anti/dn42-portal/server/services/authService.js#L322) (`newPassword.length < 8`)
  - 后端：[`server/controllers/authController.js:L89`](file:///g:/Akira/Agents_Workspace/anti/dn42-portal/server/controllers/authController.js#L89) (`newPassword.length < 8`)
- **隐患表现**：
  前端两个密码弹窗（登录后改密 `PasswordModal` 与首次 SSH 验签后设密 `AuthModal`）的校验逻辑与文案提示均允许 6 位及以上密码；但后端 API 严格拦截 `< 8` 位的密码并返回错误。
  **现场症状**：用户在 GUI 输入 6 位或 7 位密码时前端显示校验合法，点击提交后却被后端报错拦截（`Password must be at least 8 characters long`），造成表单体验卡顿与迷惑。
- **修复建议**：
  统一前后端规则，将前端 GUI 的密码长度校验与 placeholder 全部同步为 8 位（`>= 8`）。

---

### 🟠 M2：管理员 WG 配置片段在指定 Endpoint 时缺失端口号

- **文件定位**：[`server/services/configEngine.js:L95-98`](file:///g:/Akira/Agents_Workspace/anti/dn42-portal/server/services/configEngine.js#L95-L98)
- **代码片段**：
  ```javascript
  const serverWireguardSnippet = `[Peer]
  PublicKey = ${clientPublicKey}
  ${clientEndpoint ? `Endpoint = ${clientEndpoint}\n` : ''}AllowedIPs = ${peerAllowedIps.join(', ')}
  `;
  ```
- **隐患根因**：
  在表单输入与校验中，`clientEndpoint` 是纯主机名/IP（无端口后缀，如 `myhost.dn42`）。
  若客户端设定了监听端口（例如 `clientPort = 23143`），生成的给管理员侧 WireGuard 片段中却直接渲染了 `Endpoint = myhost.dn42`（缺少 `:23143`）。
  WireGuard 规定 `Endpoint` 必须包含端口（如 `ip:port` 或 `host:port`），否则在执行 `wg set` / `wg-quick` 时会报语法解析错误。
- **修复建议**：
  当 `clientEndpoint` 存在且 `clientPort` 不是 `auto` 时，自动拼接端口：`${clientEndpoint}:${clientPort}`；若为 `auto` 则由客户端漫游连接（或不写 Endpoint）。

---

### 🟠 M3：Telegram 通知 Markdown V1 解析报错导致静默丢通知

- **文件定位**：[`server/services/notificationService.js:L23-56`](file:///g:/Akira/Agents_Workspace/anti/dn42-portal/server/services/notificationService.js#L23-L56)
- **代码片段**：
  ```javascript
  const message = `${actionText}
  ...
  • *Assigned Port*: \`${hostPort}\`${session.assigned?.isShifted ? ' _(Auto-Shifted)_' : ''}
  ...
  `;
  await fetch(url, { body: JSON.stringify({ chat_id, text: message, parse_mode: 'Markdown' }) });
  ```
- **隐患根因**：
  Telegram API 的旧版 `Markdown`（V1）解析器对未转义的下划线 `_`、星号 `*` 及括号极其敏感。
  若 `session.asName` 包含下划线（如 `AKIRA_DN42`）、或者公钥/端口文案中包含 `_(Auto-Shifted)_`，Telegram 服务器会直接拒绝并返回 HTTP 400 `Bad Request: can't parse entities`。
  该异常被内部 `try...catch` 静默忽略，导致特定 ASN 的申请通知丢失。
- **修复建议**：
  改用 `parse_mode: 'HTML'`（使用 `<b>`, `<code>`, `<i>` 标签，极度稳健且无需转义下划线），或在发送前对 Markdown 特殊字符做全局转义。

---

### 🟠 M4：静态文件服务防御深度缺失（Windows 路径隔离）

- **文件定位**：[`server/index.js:L248-277`](file:///g:/Akira/Agents_Workspace/anti/dn42-portal/server/index.js#L248-L277)
- **代码片段**：
  ```javascript
  let relPath = pathname.slice(guiRoute.length).replace(/^\/+/, '');
  let targetFile = path.join(guiDist, relPath);
  ```
- **隐患根因**：
  虽然 WHATWG URL 标准在大多数情况下会将 `/../` 规范化为 `/`，但在 Windows 平台下，反斜杠 `\`、特殊编码（如 `%5c`）或畸形路径片段可能绕过简单的正则替换。缺少显式的 `path.resolve(targetFile).startsWith(baseDir)` 边界检查。
- **修复建议**：
  在所有静态文件读取前，增加统一的路径越界判定：
  ```javascript
  const resolved = path.resolve(baseDir, relPath);
  if (!resolved.startsWith(path.resolve(baseDir))) {
    return sendJson(res, 403, errorEnvelope('Forbidden', null, 403));
  }
  ```

---

### 🟡 L1：`rememberMe: false` 仍被宿主网关持久化至 `localStorage`

- **文件定位**：[`cli/public/index.html:L347-364`](file:///g:/Akira/Agents_Workspace/anti/dn42-portal/cli/public/index.html#L347-L364)
- **代码片段**：
  ```javascript
  if (data && data.success && data.data && data.data.token) {
    localStorage.setItem('dn42_auth_token', data.data.token);
  }
  ```
- **隐患根因**：
  当用户在 CLI 登录选择 `Remember login for 30 days? [Y/n]: n`（即 `rememberMe = false`）时，宿主网关拦截器未区分请求体中的 `rememberMe` 状态，依然将 Token 写入了长期有效的 `localStorage`。
  用户刷新浏览器或打开 `/gui` 时，依然会被自动识别为登录态，违背了临时登录的语义。
- **修复建议**：
  在网关拦截器中解析请求体，若 `rememberMe === false` 则使用 `sessionStorage` 存储，或在窗口关闭时自动清理。

---

### 🟡 L2：`whois` 脚本单行 `sed` 正则提取在复杂对象时存在解析截断风险

- **文件定位**：[`cli/cli-src/bin/whois:L27-43`](file:///g:/Akira/Agents_Workspace/anti/dn42-portal/cli/cli-src/bin/whois#L27-L43)
- **隐患根因**：
  `whois` 脚本使用 `sed -n 's/.*"identity":{\(.*\)}.*/\1/p'` 提取整个对象，然后再进行二次截取。若字段中包含转义花括号或嵌套属性，正则贪婪匹配会导致后续字段（如 `descr`, `maintainer`）提取为空。
- **修复建议**：
  改用 `dn42-lib.sh` 现成的 `json_field "$resp" asName` 统一函数逐个字段提取。

---

## 📋 总结与维护建议

1. **核心链路非常扎实**：
   - 验签体系（OpenSSH 4 级容错）、JWT HMAC 签名、Scrypt 密码哈希、单源规则系统（`rules.js` / `rules.sh` / `validator.js`）完全保持严格一致。
   - WASM Linux 终端与 Web GUI 的双向 Token 镜像工作良好。
2. **重点关注项**：
   - Shell 脚本层（`peer`、`read_line_edit`、`nano`）中与 `eval` 和 `printf '%b'` 相关的转义安全性需要做一次系统性的引号收紧。
   - 后端 `portLedgerService` 建议补充内存事务锁，保证极端高并发下的绝对原子性。
   - 前端 GUI 的密码长度（6 位 vs 8 位）与 Telegram 通知 HTML 化属于极低成本但能显著提升鲁棒性的优化点。
