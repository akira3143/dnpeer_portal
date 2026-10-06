# DN42 Peering Portal 2.0

> High-Performance Single Source of Truth Dual-Frontend DN42 Peering Portal  
> Dual Frontend: In-Browser WebAssembly Linux Terminal CLI (`/`) + Modern Responsive Web GUI (`/gui`)

---

## ✨ 核心特性矩阵 (Core Features Matrix)

- 🖥️ **双端协同体验 (Dual Frontend Architecture)**  
  - **In-Browser WASM Terminal (`/`)**: 基于 v86 x86 虚拟化与定制 BusyBox Linux，提供真实终端的彩色交互式 CLI（支持语法高亮、实时提示、自动补全与即时格式校验）。  
  - **Modern Responsive Web GUI (`/gui`)**: 基于 Vue 3、Vite 与 Tailwind CSS 构建，针对桌面与移动端深度适配，集成抽屉式节点管理与即刻配置生成。
- ⚡ **Zero-Fork CLI 极速引擎 (Zero-Fork POSIX Shell)**  
  针对 WebAssembly 仿真环境下的进程生成损耗进行了彻底优化。所有 `peer ls` 与规则验证逻辑均由纯 POSIX Shell 字符串内建操作与参数展开驱动，**消除全部 `sed` / `grep` / `awk` 子进程派生**，列表与交互性能提升 80% 以上。
- 📡 **双轨心跳雷达示波器 (Dual Heartbeat Radar Scope)**  
  全新 52px 极简紧凑型 SVG 动态示波器：
  - **动态电脉冲波形**：单点电脉冲沿曲线自右向左（从最新数据向历史数据）匀速流动；
  - **等宽 HUD 刻度与对称度量**：右上角 `font-mono` 自适应动态峰值标尺，同行动态排布 `Rx Volume` 与 `Tx Volume`，最大化界面空间利用率。
- 📊 **24 小时滚动遥测环形缓冲区 (24-Hour Rolling Telemetry)**  
  会话内置 48 采样点环形滑动窗口（30 分钟粒度），基于增量差分算法精准计算 24 小时真实收发流量，具备节点重启计数器清零自动保护。
- 🔐 **三模身份认证网关 (Multi-Method Authentication)**  
  - **口令认证**：经典密码登录，加盐哈希保护；
  - **DN42 WHOIS 邮箱验证码**：集成 Resend API，向 DN42 注册人邮箱投递 6 位动态验证码，内置 30 秒倒计时防刷与重放防御；
  - **OpenSSH 离线签名认证**：支持 `ed25519`、`ecdsa`、`rsa` 及 `ed25519-sk`/`ecdsa-sk` FIDO2 硬件安全密钥，通过 challenge-response 零凭据泄露离线验签。
- 🛡️ **单源真理架构 (SSOT - Single Source of Truth)**  
  所有业务规则与验证常数统一于 `shared/rules/rules.yaml`。由代码生成器一键编译为前端 JS 校验器、服务端验证模块及 CLI POSIX Shell 脚本，100% 杜绝跨端规则漂移。
- 🌐 **分布式边缘探针 (Distributed Edge Node Probes)**  
  一键部署轻量 Bash 探针守护进程，定期采集 WireGuard 握手状态与端口占用，通过 `bird-lgproxy` / `birdc` 实时抓取 BGP 会话状态，并支持断网离线缓存容灾。
- ⚙️ **智能端口与路由编排 (Port & BGP Orchestration)**  
  - 端口公式：`20000 + (ASN % 10000)`，自带端口账本冲突检测与自动递增避让（+10000）；
  - 原生支持 MP-BGP ENH（Extended Next Hop）及 Link-Local（`fe80::`）Option A 路由汇聚规范，自动生成 `wg-quick`、`systemd-networkd` 与 `bird2` 配置。
- 📦 **免构建即时运行 (Zero-Build Clone-and-Run)**  
  GUI 生产编译产物（`gui/dist/`）、CLI rootfs 映像（`cli/public/rootfs.dat`）及 WASM 核心运行时均纳入版本控制，生产服务器克隆即可启动，无需安装前端编译工具链。

---

## 🚀 一键安装 (One-Click Install)

> [!TIP]
> **免构建直接运行 (Zero-Build Clone-and-Run)**  
> 安装脚本在服务器上**无需任何现场编译**，即使 512MB 内存的轻量 VPS 亦可秒级启动。

### 1. 主控服务（Master Server）

```bash
# 自动一键安装（克隆仓库 → 生产依赖 → .env → DN42 registry → 交互式初始化管理员 → systemd 守护）
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/akira3143/dnpeer_portal/main/deploy/install.sh)"

# 或本地执行
sudo bash deploy/install.sh
```

安装脚本会引导完成管理员 ASN 与初始口令设置，并自动生成高强度 JWT 密钥。

#### 服务管理
```bash
systemctl status dn42-portal     # 查看服务状态
systemctl restart dn42-portal    # 重启服务
journalctl -u dn42-portal -f     # 实时查看运行日志
```

#### 升级与更新
```bash
# 重跑安装脚本：自动执行 git pull 并同步依赖
sudo bash /opt/dn42-portal/deploy/install.sh
sudo systemctl restart dn42-portal
```

#### 服务卸载
```bash
sudo bash deploy/uninstall.sh           # 卸载服务（保留配置与数据）
sudo bash deploy/uninstall.sh --purge   # 彻底卸载（清除数据与用户）
```

---

### 2. 边缘探针节点（Edge Node Probe）

边缘节点（如 JP-2 / HK-1 / US-SJC-1）通过探针将实时 WireGuard 握手与 BIRD BGP 状态汇报至主控。探针安装命令由主控动态生成：

```bash
# 在主控服务器执行（自动生成带专属安全 Token 的一键安装指令）
dnp probe <NODE_ID>
# 例如:
dnp probe US-SJC-1
```

将控制台输出的单行命令粘贴至目标边缘节点执行即可。探针每 5 分钟定时上报，并在 `/etc/wireguard` 配置变更时即时触发同步。

#### 探针卸载
```bash
sudo bash deploy/uninstall-probe.sh           # 卸载探针服务（保留配置）
sudo bash deploy/uninstall-probe.sh --purge   # 彻底清除探针与身份
```

---

### 3. 手动部署（可选）

```bash
git clone https://github.com/akira3143/dnpeer_portal.git
cd dnpeer_portal
npm ci --omit=dev
cp .env.example .env && vim .env          # 配置 AUTH_JWT_SECRET 等
cp portal.config.example.yaml portal.config.yaml && vim portal.config.yaml
git clone --depth 1 https://git.dn42.dev/dn42/registry server/data/registry
npm start                                  # 默认监听 127.0.0.1:4242
```

---

## ⚙️ 核心配置文件

### 1. `portal.config.yaml`（主控业务配置，支持 200ms 热重载）
- **`guiPath`**: 现代 Web GUI 的访问路由前缀（默认为 `"/gui"`，根路径 `"/"` 为 WASM CLI）；
- **`network`**: 本地自治系统信息（ASN、网络名称、IPv4/IPv6 地址池、维护人信息）；
- **`nodes`**: PoP 边缘节点列表（节点 ID、flag、WireGuard 公钥、公网端点、LLA/ULA 隧道 IP、`lgProxyUrl` 等）；
- **`contacts`**: 网站公示的联系方式（Telegram、DN42 WHOIS、Matrix 等）；
- **`admins`**: 具备超级管理员权限的数字 ASN 列表。

### 2. `.env`（环境与安全凭证）
- **`PORT` / `HOST`**: 监听端口（默认 `4242`）与绑定地址（默认 `127.0.0.1`）；
- **`AUTH_JWT_SECRET`**: 用于 JWT 签名的高熵随机字符串；
- **`RESEND_API_KEY` / `RESEND_FROM`**: （可选）Resend 邮件服务凭证，用于 DN42 WHOIS 邮箱验证码登录；
- **`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`**: （可选）Telegram Bot 通知推送；
- **`REGISTRY_SYNC_INTERVAL_MS`**: （可选）DN42 官方 Registry 定时同步周期（默认 600,000 毫秒 = 10 分钟）。

---

## 💻 开发者规范与二次构建 (Developer & Build Protocol)

> [!IMPORTANT]
> **本地开发一致性约束 (Single Source & Pre-build Constraint)**  
> - CLI 脚本唯一开发源位于 `cli/cli-src/`；
> - Web GUI 源码位于 `gui/src/`；
> - 单源校验规则源文件位于 `shared/rules/rules.yaml`；
> - 任何修改了上述源码的变更，**提交前必须在本地执行完整构建**（`npm run build`），并将编译产物（`gui/dist/`、`cli/public/rootfs.dat`、`shared/generated/`）同源码一并提交入 Git。

```bash
# 安装完整开发依赖
npm install
npm --prefix gui install

# 全量构建：单源规则生成 + Web GUI Vite 编译 + CLI rootfs 打包
npm run build

# 或构建独立模块
npm run build:rules  # 编译 shared/rules/rules.yaml -> JS & POSIX Shell
npm run build:gui    # 编译 Web GUI (Vite -> gui/dist/)
npm run build:cli    # 打包 WebAssembly CLI 根文件系统 (cli/public/rootfs.dat)
```

---

## 🛠️ 管理员工具 (Admin CLI)

主控服务器内置管理命令行工具 `bin/dnp.js`（全局链接为 `dnp`）：

```bash
# 查看所有 PoP 节点的实时连接状态、公钥及最近心跳时间
dnp probe

# 为指定边缘节点签发探针 Token 并打印一键部署命令
dnp probe US-SJC-1
```

---

## 🧪 自动化测试体系 (Automated Testing)

项目拥有健全的自动化测试矩阵，覆盖安全防御、单源一致性、WASM 虚拟化、多因素认证与端到端交互：

```bash
# 运行全量单元测试与集成测试 (20 个套件，226 项测试全部通过)
npm test

# 运行数据零污染回归测试 (5 轮连续幂等性验证)
node tests/fixtures/run_5_times.js

# 运行无头 Chrome 真实 WASM 与 Web GUI 端到端验证
node tests/fixtures/browser_wasm_runner.js
```
