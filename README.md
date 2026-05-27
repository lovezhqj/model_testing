# Model Monitor — AI 模型服务状态监控

实时监控 AI 模型服务响应时间，24 小时状态可视化面板。

## 技术栈

- **框架**: Next.js 14 (App Router)
- **数据库**: Supabase (PostgreSQL)
- **部署**: Vercel + Vercel Cron
- **样式**: Vanilla CSS (深色科技主题)

## 功能

- ⚡ 每 30 分钟自动抓取模型响应时间数据
- 📊 24 小时状态色块可视化监控
- 🟢 绿色：响应时间 < 5秒（正常）
- 🟡 黄色：5~20秒（偏慢）
- 🔴 红色：> 20秒（异常）
- 🗑️ 自动清理 48 小时前的旧数据
- 📱 响应式设计，支持移动端

## 快速开始

### 1. 创建 Supabase 表

在 Supabase SQL Editor 中执行：

```sql
CREATE TABLE model_testing (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  response_time NUMERIC NOT NULL,
  create_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_model_testing_create_time ON model_testing (create_time DESC);
CREATE INDEX idx_model_testing_name ON model_testing (name);
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env.local` 并填入实际值：

```bash
cp .env.example .env.local
```

### 3. 本地开发

```bash
npm install
npm run dev
```

访问 http://localhost:3000 查看监控面板。

### 4. 手动触发数据抓取

```
GET /api/cron/fetch?secret=YOUR_CRON_SECRET
```

## 部署到 Vercel

1. 将代码推送到 GitHub
2. 在 [vercel.com](https://vercel.com) 导入该仓库
3. 在 **Settings → Environment Variables** 中配置：
   - `KKDMX_USERNAME`
   - `KKDMX_PASSWORD`
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `CRON_SECRET`
4. 部署完成后，Vercel Cron 将自动每 30 分钟触发数据抓取

## 环境变量说明

| 变量名 | 说明 |
|--------|------|
| `KKDMX_USERNAME` | kkdmx.com 登录用户名 |
| `KKDMX_PASSWORD` | kkdmx.com 登录密码 |
| `SUPABASE_URL` | Supabase 项目 URL |
| `SUPABASE_ANON_KEY` | Supabase 公开 anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 服务端 key |
| `CRON_SECRET` | Cron 接口鉴权密钥 |
