# Loan Console · 贷款分析台

个人住房贷款计划与提前还款分析控制台。V1 是一个确定性的月度计划模型：默认所有已经到期的期次都按计划偿还，不记录银行真实流水。

## 快速启动

项目运行时要求 Node.js 20+（Fastify 5 和 React Router 7 的运行时要求）。

```bash
nvm use
cp .env.example .env
npm install
npm run admin:create
npm run dev
```

打开 <http://localhost:5173>，使用刚创建的管理员账号登录。

默认 `DATABASE_MODE=memory`，贷款数据保存在 `.local/memory-state.json`，无需先安装 MariaDB。生产环境请设置：

```text
DATABASE_MODE=mysql
DATABASE_URL=mysql://loan_console:password@127.0.0.1:3306/loan_console
SESSION_SECRET=<long-random-secret>
```

然后执行：

```bash
npm run db:migrate
npm run admin:create
npm run build
npm run start --workspace @loan-console/api
```

## 常用命令

```bash
npm test
npm run typecheck
npm run build
npm run admin:reset-password
```

## 设计边界

- 金额和利率在 API 中以字符串传输，核心运算使用 Decimal。
- 还款日期以首期还款日为月度 anchor，支持月末日期和闰年。
- 利率调整、提前还款都在月度还款边界发生。
- 普通还款计划实时生成，不落库；已保存的提前还款方案保存输入、结果快照和计算版本。
- V1 不包含真实还款流水、逾期、罚息、手续费、LPR 自动同步或银行账单接口。

## 部署

`deploy/nginx/loan-console.conf`、`deploy/systemd/loan-console.service` 和 `.github/workflows/deploy-ecs.yml` 是面向低配 ECS 的配置模板。部署前需要替换域名、证书路径和服务器环境文件，不会在本地自动连接 ECS。
