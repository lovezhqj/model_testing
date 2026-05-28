import './globals.css';

export const metadata = {
  title: 'KK大模型实时监控 — AI 模型服务状态',
  description: '实时监控 AI 模型服务响应时间，24 小时状态可视化面板',
  keywords: ['AI', '模型监控', '响应时间', '服务状态'],
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
