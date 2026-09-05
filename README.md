# DN42 Peering Portal 2.0

> High-Performance Single Source of Truth Dual-Frontend DN42 Peering Portal  
> Dual Frontend: In-Browser WebAssembly Linux Terminal CLI (`/`) + Modern Responsive Web GUI (`/gui`)

---

## 🚀 一键安装 (One-Click Install)

> [!TIP]
> **免构建直接运行 (Zero-Build Clone-and-Run)**
> 本项目所有前端与 CLI 预构建产物（`gui/dist/`、`cli/public/rootfs.dat` 以及完整 WebAssembly 运行环境 `cli/public/vendor/`）**均已纳入版本控制**。安装脚本在服务器上**无需任何现场编译**，轻量 VPS 也毫无压力。

### 主控服务（Master Server）

```bash
# 安装（自动：克隆仓库 → 依赖 → .env → DN42 registry → 管理员账号 → systemd 启动）
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/akira3143/dnpeer_portal/main/deploy/install.sh)"

# 或本地执行
sudo bash deploy/install.sh
```

安装脚本会交互式引导：管理员 ASN + 管理员密码（ASN 必填、无默认值）；`.env` 自动生成 JWT 密钥（Telegram 通知参数安装后手动补填）。

```bash
# 卸载（保留数据）
sudo bash deploy/uninstall.sh
# 卸载（连同全部数据彻底清除）
sudo bash deploy/uninstall.sh --purge
```

服务管理：
```bash
systemctl status dn42-portal     # 状态
systemctl restart dn42-portal    # 重启
journalctl -u dn42-portal -f     # 日志
```

### 探针节点（Edge Node: JP-2 / HK-1 / US-LA1）

探针安装命令由**主控动态生成**（含节点专属 Token），无需单独脚本：

```bash
# 在主控执行（Token 幂等生成，可重复执行）
dnp probe JP-2
```

复制输出的安装命令，到目标节点执行即可（探针每 5 分钟上报：WG 端口、BGP 会话状态（birdc show protocols）、心跳；`/etc/wireguard` 文件变化即时触发）。

```bash
# 卸载（保留身份）
sudo bash deploy/uninstall-probe.sh
# 卸载（清除一切）
sudo bash deploy/uninstall-probe.sh --purge
```

### 手动部署（可选，不推荐）

```bash
git clone https://github.com/akira3143/dnpeer_portal.git
cd dnpeer_portal
npm ci --omit=dev
cp .env.example .env && vim .env          # 至少改 AUTH_JWT_SECRET
vim portal.config.yaml                    # 节点/隧道信息
git clone --depth 1 https://git.dn42.dev/dn42/registry server/data/registry
npm start                                  # 默认端口 4242
```

---

## 💻 开发者规范与二次构建 (Developer & Build Protocol)

> [!IMPORTANT]
> **本地开发一致性约束 (Single Source & Pre-build Constraint)**  
> - CLI 脚本唯一开发源位于 `cli/cli-src/`；
> - Web GUI 源码位于 `gui/src/`；
> - 任何修改了 `cli/cli-src/` 或 `gui/src/` 的代码变更，**必须在提交前在本地执行完整构建**（`npm run build`），并将更新后的构建产物（`cli/public/rootfs.dat`、`gui/dist/`）**同源码一并提交入 Git**，严禁提交未经构建的源码差异。

### 二次构建步骤（定制开发时使用）

```bash
# 安装完整开发依赖（包含 GUI 构建工具链）
npm install
npm --prefix gui install

# 全量构建：单源规则生成 + Web GUI 编译 + CLI rootfs 打包
npm run build

# 或仅构建指定子模块
npm run build:cli   # 编译 CLI rootfs.dat 与 rules.sh
npm run build:gui   # 编译 Web GUI (Vite -> gui/dist/)
```

---

## 🛠️ 管理员工具 (Admin CLI)

```bash
# 查看所有 PoP 节点实时在线状态与最近心跳
node bin/dnp.js probe
# 或全局链接后执行:
dnp probe

# 生成指定节点的专属一键安装命令（Token 幂等生成，安全隔离）
dnp probe JP-7
```

---

## 🧪 自动化测试

```bash
# 运行全量单元测试与集成测试 (69+ 项)
npm test

# 运行数据零污染回归测试 (5 轮连续验证)
node tests/fixtures/run_5_times.js

# 运行无头 Chrome 真实 WASM 与 GUI 端到端测试
node tests/fixtures/browser_wasm_runner.js
```
