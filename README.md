# DN42 Peering Portal

这是一个用于 DN42 网络的轻量自助 Peering 辅助工具。旨在帮助网络管理员简化多节点隧道开通、配置生成与会话状态查看流程。

> **说明**：本项目为 Vibe 产物，仅为满足个人使用需求而创建，全量代码与架构由 AI 辅助探索与交互迭代完成。

---

## 🌟 主要功能

- **双界面支持**：提供现代 Web 界面（`/gui`）与基于 WebAssembly 的网页终端（`/`），方便不同习惯的用户使用。
- **状态与流量展示**：实时展示 WireGuard 握手状态、BGP 会话状态及近期的流量走势。
- **多样化身份验证**：支持常规账号密码、DN42 WHOIS 邮箱动态验证码，以及基于 OpenSSH 密钥的离线签名验证。
- **配置生成与端口规划**：根据 ASN 规则辅助规划监听端口，并提供可直接复制的 WireGuard 与 BIRD 配置文件。
- **轻量探针协同**：提供简短的 Bash 探针脚本，便于分布式多 PoP 节点上报状态。
- **开箱即用**：前端与终端环境已预先打包入库，常规部署无需在服务器配置前端编译环境。

---

## 🚀 部署与使用

### 1. 主控端安装（Master Server）

在支持 systemd 的 Linux 服务器上执行一键脚本：

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/akira3143/dnpeer_portal/main/deploy/install.sh)"
```

脚本将协助完成基础目录创建、管理员账号初始化及 systemd 服务的注册。

常用管理命令：
```bash
systemctl status dn42-portal     # 查看运行状态
systemctl restart dn42-portal    # 重启服务
journalctl -u dn42-portal -f     # 查看运行日志
```

如需更新至最新版本：
```bash
sudo bash /opt/dn42-portal/deploy/install.sh
sudo systemctl restart dn42-portal
```

### 2. 边缘节点探针（PoP Probes）

若在多台服务器上运行节点，可在主控端生成对应的探针接入命令：

```bash
dnp probe <节点标识>
```

将控制台输出的指令复制到目标边缘节点运行即可。

---

## ⚙️ 配置文件说明

- **`portal.config.yaml`**：维护本网 ASN、联系方式及各 PoP 节点的端点与隧道地址。保存后服务会自动热重载。
- **`.env`**：配置监听端口、JWT 密钥以及可选的邮件验证（Resend）或 Telegram 机器人通知凭据。

---

## 💻 本地开发与测试

若需调整前端界面或终端脚本：

```bash
# 安装依赖
npm install
npm --prefix gui install

# 编译打包（生成前端静态资源与终端映像）
npm run build

# 运行自动化测试
npm test
```

> [!NOTE]
> 为保持免编译直接运行的特性，若修改了 `gui/` 或 `cli/cli-src/` 源码，请在提交前执行 `npm run build` 并将打包产物一同纳入版本控制。

---

## 🙏 致谢与引用 (Credits & Acknowledgements)

本项目在实现过程中参考并借用了以下开源项目的能力与实现，特此致谢：

- [tombl/linux](https://github.com/tombl/linux) - 浏览器端 WebAssembly Linux 内核与 VirtIO 运行时支持
- [bird-lg-go](https://github.com/xddxdd/bird-lg-go) - BIRD Looking Glass 代理服务（Go 实现）与状态查询支持

---

## 📄 开源协议 (License)

本项目采用 [MIT 许可证](LICENSE) 开源。
