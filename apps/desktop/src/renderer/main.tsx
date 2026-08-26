import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { App as AntApp, Card, ConfigProvider, Space, Spin, Tag, Typography } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import 'antd/dist/reset.css';

const queryClient = new QueryClient();

function FoundationSmoke(): React.JSX.Element {
  const products = useQuery({
    queryKey: ['products'],
    queryFn: () => window.desktop.products.list(),
  });
  const jobs = useQuery({
    queryKey: ['jobs'],
    queryFn: () => window.desktop.jobs.list(),
    refetchInterval: 1_000,
  });
  return (
    <main style={{ padding: 32, maxWidth: 960, margin: '0 auto' }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Typography.Title level={2}>桌面基础已启动</Typography.Title>
          <Typography.Text type="secondary">
            Renderer 仅通过安全 preload 访问产品、文案与任务用例。
          </Typography.Text>
        </div>
        <Card title="垂直链路状态">
          {products.isLoading || jobs.isLoading ? (
            <Spin />
          ) : (
            <Space wrap>
              <Tag color="green">SQLite 已连接</Tag>
              <Tag color="blue">产品 {products.data?.length ?? 0}</Tag>
              <Tag color="purple">任务 {jobs.data?.length ?? 0}</Tag>
            </Space>
          )}
        </Card>
      </Space>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <FoundationSmoke />
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
