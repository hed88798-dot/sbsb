import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import 'antd/dist/reset.css';
import './styles.css';
import { DesktopApp } from './shell/DesktopApp.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 500, retry: false },
    mutations: { retry: false },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#176b54', borderRadius: 8 } }}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <DesktopApp />
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
