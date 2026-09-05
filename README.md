# DN42 Peering Portal 2.0

> High-Performance Single Source of Truth Dual-Frontend DN42 Peering Portal  
> Dual Frontend: In-Browser WebAssembly Linux Terminal CLI (`/`) + Modern Responsive Web GUI (`/gui`)

---

## 🚀 部署与运行手册 (Deployment Runbook)

> [!TIP]
> **免构建直接运行 (Zero-Build Clone-and-Run)**  
> 本项目所有前端与 CLI 预构建产物（`gui/dist/`、`cli/public/rootfs.dat` 以及完整 WebAssembly 运行环境 `cli/public/vendor/`）**均已纳入版本控制**。  
> 生产服务器拉取仓库后，**无需在服务器端运行任何 `npm run build`**，彻底避免轻量 VPS 因现场编译耗尽 CPU/内存。直接安装生产依赖即可上线。

### 1. 生产环境极速启动 (Production Quickstart)

```bash
# 1. 克隆仓库
git clone https://github.com/your-org/dn42-portal.git
cd dn42-portal

# 2. 仅安装生产运行依赖（无需编译工具链）
npm ci --omit=dev

# 3. 配置环境与密钥
cp .env.example .env
vim .env
vim portal.config.yaml

# 4. 启动服务 (默认端口 4242)
npm start
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
