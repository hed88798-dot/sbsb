import {
  DashboardOutlined,
  FileTextOutlined,
  HistoryOutlined,
  ProductOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Layout, Menu } from 'antd';
import type { MenuProps } from 'antd';
import { CopywritingPage } from '../pages/CopywritingPage.js';
import { DashboardPage } from '../pages/DashboardPage.js';
import { JobsPage } from '../pages/JobsPage.js';
import { ProductsPage } from '../pages/ProductsPage.js';
import { SettingsPage } from '../pages/SettingsPage.js';
import { useNavigation, type PageKey } from '../store/navigation.js';

const items: NonNullable<MenuProps['items']> = [
  { key: 'dashboard', icon: <DashboardOutlined />, label: '首页' },
  { key: 'products', icon: <ProductOutlined />, label: '产品库' },
  { key: 'copywriting', icon: <FileTextOutlined />, label: 'AI 文案' },
  { key: 'jobs', icon: <HistoryOutlined />, label: '任务记录' },
  { key: 'settings', icon: <SettingOutlined />, label: '设置' },
];

export function DesktopApp(): React.JSX.Element {
  const { page, setPage } = useNavigation();
  const content = {
    dashboard: <DashboardPage />,
    products: <ProductsPage />,
    copywriting: <CopywritingPage />,
    jobs: <JobsPage />,
    settings: <SettingsPage />,
  }[page];
  return (
    <Layout className="app-layout">
      <Layout.Sider width={220} theme="dark" className="app-sider">
        <div className="brand">
          企业内容工作台<small>Desktop v0.1</small>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[page]}
          items={items}
          onSelect={({ key }) => setPage(key as PageKey)}
        />
      </Layout.Sider>
      <Layout.Content className="app-content">
        <div className="page-wrap">{content}</div>
      </Layout.Content>
    </Layout>
  );
}
