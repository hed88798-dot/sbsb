import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Progress, Table, Tag, Typography } from 'antd';
import type { JobDTOv1 } from '@app/contracts';

const colors: Record<JobDTOv1['state'], string> = {
  QUEUED: 'default',
  RUNNING: 'processing',
  SUCCEEDED: 'success',
  FAILED: 'error',
  CANCELLED: 'warning',
  INTERRUPTED: 'orange',
};

export function JobsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const jobs = useQuery({
    queryKey: ['jobs'],
    queryFn: () => window.desktop.jobs.list(),
    refetchInterval: 1_000,
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>任务记录</Typography.Title>
          <Typography.Text type="secondary">
            成功、失败、取消、超时和异常中断都会保留明确状态。
          </Typography.Text>
        </div>
      </div>
      <Card>
        <Table
          rowKey="job_id"
          loading={jobs.isLoading}
          dataSource={jobs.data ?? []}
          columns={[
            { title: '任务', dataIndex: 'job_type', width: 140 },
            {
              title: '状态',
              dataIndex: 'state',
              width: 130,
              render: (state: JobDTOv1['state']) => <Tag color={colors[state]}>{state}</Tag>,
            },
            {
              title: '进度',
              dataIndex: 'progress',
              width: 180,
              render: (value: number) => (
                <Progress percent={Math.round(value * 100)} size="small" />
              ),
            },
            {
              title: '创建时间',
              dataIndex: 'created_at',
              width: 190,
              render: (value: string) => new Date(value).toLocaleString('zh-CN'),
            },
            {
              title: '错误',
              render: (_: unknown, job: JobDTOv1) =>
                job.error_message ? `${job.error_code}: ${job.error_message}` : '—',
            },
            {
              title: '操作',
              width: 100,
              render: (_: unknown, job: JobDTOv1) =>
                ['QUEUED', 'RUNNING'].includes(job.state) ? (
                  <Button
                    danger
                    size="small"
                    onClick={() =>
                      window.desktop.jobs
                        .cancel(job.job_id)
                        .then(() => queryClient.invalidateQueries({ queryKey: ['jobs'] }))
                    }
                  >
                    取消
                  </Button>
                ) : null,
            },
          ]}
        />
      </Card>
    </>
  );
}
