import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Row, Space, Statistic, Typography } from 'antd';
import { useNavigation } from '../store/navigation.js';

export function DashboardPage(): React.JSX.Element {
  const setPage = useNavigation((state) => state.setPage);
  const products = useQuery({
    queryKey: ['products'],
    queryFn: () => window.desktop.products.list(),
  });
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => window.desktop.jobs.list() });
  const running = jobs.data?.filter((job) => ['QUEUED', 'RUNNING'].includes(job.state)).length ?? 0;
  const failed = jobs.data?.filter((job) => job.state === 'FAILED').length ?? 0;
  return (
    <>
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>首页</Typography.Title>
          <Typography.Text type="secondary">
            产品事实、本地任务和 AI 文案都保存在本机。
          </Typography.Text>
        </div>
        <Space>
          <Button onClick={() => setPage('products')}>管理产品</Button>
          <Button type="primary" onClick={() => setPage('copywriting')}>
            创建文案
          </Button>
        </Space>
      </div>
      <Row gutter={[16, 16]}>
        <Col span={8}>
          <Card className="metric-card">
            <Statistic title="产品数量" value={products.data?.length ?? 0} />
          </Card>
        </Col>
        <Col span={8}>
          <Card className="metric-card">
            <Statistic title="进行中任务" value={running} />
          </Card>
        </Col>
        <Col span={8}>
          <Card className="metric-card">
            <Statistic title="失败任务" value={failed} />
          </Card>
        </Col>
        <Col span={24}>
          <Alert
            type="info"
            showIcon
            message="v0.1 范围"
            description="当前版本只提供桌面基础、产品库与 AI 文案。图片生成、视频生成、素材索引、自动剪辑和数字人功能默认不显示。"
          />
        </Col>
      </Row>
    </>
  );
}
