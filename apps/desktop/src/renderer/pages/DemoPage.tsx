import { useState } from 'react';
import { Alert, Button, Card, Input, Select, Space, Table, Typography } from 'antd';
import type { DemoState, RenderJobDTOv1, RenderTimelineSourceDTOv1 } from '@app/contracts';

export function DemoPage(): React.JSX.Element {
  const [text, setText] = useState('');
  const [route, setRoute] = useState<'ANIMAL' | 'PRODUCT'>('ANIMAL');
  const [state, setState] = useState<DemoState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [timelines, setTimelines] = useState<RenderTimelineSourceDTOv1[]>([]);
  const [job, setJob] = useState<RenderJobDTOv1 | null>(null);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Typography.Title level={2}>视频 Demo 工作台</Typography.Title>
      <Alert
        type="info"
        showIcon
        message="离线镜头候选 · 付费模型关闭"
        description="按句切分，由你选择素材类型。此步骤没有调用 AI；确认后才允许进入素材与时间线流程。"
      />
      {error && <Alert type="error" message={error} showIcon />}
      <Card title="1. 输入文案与画面类型">
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input.TextArea
            value={text}
            maxLength={8000}
            rows={5}
            placeholder="输入 2–3 句文案，目标视频时长 15–30 秒"
            onChange={(event) => {
              setText(event.target.value);
              setState(null);
            }}
          />
          <Select
            value={route}
            style={{ width: 180 }}
            options={[
              { value: 'ANIMAL', label: '动物素材' },
              { value: 'PRODUCT', label: '产品素材' },
            ]}
            onChange={(value) => {
              setRoute(value);
              setState(null);
            }}
          />
          <Button
            type="primary"
            loading={busy}
            disabled={!text.trim()}
            onClick={() =>
              void run(async () => {
                setState(await window.desktop.demo.propose({ text, route }));
              })
            }
          >
            生成离线候选
          </Button>
        </Space>
      </Card>
      {state && (
        <Card title="2. 人工审核镜头">
          <Table
            pagination={false}
            rowKey="slot_id"
            dataSource={state.candidate.slots}
            columns={[
              { title: '镜头', dataIndex: 'order_index', render: (value: number) => value + 1 },
              { title: '原文', dataIndex: 'source_text' },
              { title: '画面类型', dataIndex: 'route' },
              { title: '路由状态', dataIndex: 'route_state' },
              { title: '连续性', dataIndex: 'continuity_state' },
            ]}
          />
          <Typography.Paragraph>
            请逐条核对文案覆盖、画面类型与切分。需要修改时，修改文案并重新生成候选。
          </Typography.Paragraph>
          <Button
            type="primary"
            loading={busy}
            disabled={state.stage === 'CONFIRMED'}
            onClick={() =>
              void run(async () => {
                const candidate = state.candidate;
                setState(
                  await window.desktop.demo.confirm({
                    candidate_id: candidate.candidate_id,
                    candidate_revision: candidate.candidate_revision,
                    source_document_id: candidate.source_document_id,
                    source_document_version: candidate.source_document_version,
                    source_document_hash: candidate.source_document_hash,
                  }),
                );
              })
            }
          >
            {state.stage === 'CONFIRMED' ? '已人工确认并保存' : '我已审核，确认此镜头方案'}
          </Button>
          {state.confirmed && (
            <Typography.Paragraph copyable>
              {state.confirmed.shot_plan_id} / v{state.confirmed.shot_plan_version}
            </Typography.Paragraph>
          )}
        </Card>
      )}
      <Card title="3. 正式时间线与 core MP4">
        <Typography.Paragraph>
          素材匹配、旁白和时间线提交完成后，在此刷新。此列表只显示数据库中已提交的时间线。当前界面尚未连接本地素材与旁白导入。
        </Typography.Paragraph>
        <Button
          loading={busy}
          onClick={() =>
            void run(async () => {
              setTimelines(await window.desktop.render.listTimelineSources());
            })
          }
        >
          刷新已提交时间线
        </Button>
        <Table
          pagination={false}
          rowKey="timeline_id"
          dataSource={timelines}
          columns={[
            { title: '时间线', dataIndex: 'timeline_id' },
            { title: '镜头数', dataIndex: 'segment_count' },
            { title: '时长（毫秒）', dataIndex: 'total_duration_ms' },
            {
              title: '操作',
              render: (_, timeline: RenderTimelineSourceDTOv1) => (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setJob(
                        await window.desktop.render.prepareFromTimeline({
                          schema_version: '1.0',
                          timeline_id: timeline.timeline_id,
                          timeline_version: timeline.timeline_version,
                        }),
                      );
                    })
                  }
                >
                  准备渲染
                </Button>
              ),
            },
          ]}
        />
        {job && (
          <Space direction="vertical">
            <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(job, null, 2)}</pre>
            <Space>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setJob(await window.desktop.render.execute(job.job_id));
                  })
                }
              >
                执行正式渲染
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setJob(await window.desktop.render.get(job.job_id));
                  })
                }
              >
                刷新渲染结果
              </Button>
            </Space>
          </Space>
        )}
      </Card>
    </Space>
  );
}
