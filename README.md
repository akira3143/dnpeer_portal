# DN42 Peering Portal 2.0

> High-Performance Single Source of Truth Dual-Frontend DN42 Peering Portal  
> Dual Frontend: In-Browser WebAssembly Linux Terminal CLI (`/`) + Modern Responsive Web GUI (`/gui`)

---

## 🚀 部署与运行手册 (Deployment Runbook)

> [!IMPORTANT]
> **全新 Clone 首次启动须知**
> 本项目遵循「代码单源真理」防呆原则：
> - CLI 脚本唯一开发源位于 `cli/cli-src/`；
> - `cli/staging_rootfs/` 为构建目录（由 Git 忽略生成物，仅追踪原生 `bin/busybox`）；
> - **全新克隆仓库后，首次启动服务前必须先执行构建命令**以生成 `rootfs.dat` 与前端静态资源。

### 1. 安装依赖

```bash
# 安装服务端与构建依赖
npm install

# 安装 GUI 前端依赖
npm --prefix gui install
```

### 2. 构建产物

```bash
# 全量构建：单源规则生成 + Web GUI 编译 + CLI rootfs 打包
npm run build

# 或仅构建 CLI 镜像
npm run build:cli

# 或仅构建 Web GUI
npm run build:gui
```

### 3. 配置环境

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑配置与私钥
vim .env
vim portal.config.yaml
```

### 4. 启动服务

```bash
# 生产模式启动 (默认端口 4242)
npm start

# 开发模式热重载
npm run dev
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
