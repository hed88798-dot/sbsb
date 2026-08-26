import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  List,
  Row,
  Select,
  Slider,
  Space,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import type { CopywritingGenerateRequestV1 } from '@app/contracts';

type Mode = CopywritingGenerateRequestV1['mode'];

interface CopyForm {
  product_id?: string;
  direction: string;
  target_duration_seconds: number;
  style: string;
  colloquial_level: number;
  requirements: string;
  source_text?: string;
  optimize_operation?: CopywritingGenerateRequestV1['optimize_operation'];
  dedupe_level?: CopywritingGenerateRequestV1['dedupe_level'];
}

const defaultValues: CopyForm = {
  direction: '产品介绍',
  target_duration_seconds: 30,
  style: '专业清晰',
  colloquial_level: 1,
  requirements: '',
};

export function CopywritingPage(): React.JSX.Element {
  const { message } = App.useApp();
  const [form] = Form.useForm<CopyForm>();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('CREATE');
  const [jobId, setJobId] = useState<string | null>(null);
  const products = useQuery({
    queryKey: ['products'],
    queryFn: () => window.desktop.products.list(),
  });
  const jobs = useQuery({
    queryKey: ['jobs'],
    queryFn: () => window.desktop.jobs.list(),
    refetchInterval: jobId ? 700 : false,
  });
  const currentJob = jobs.data?.find((job) => job.job_id === jobId);
  const result = useQuery({
    queryKey: ['copywriting-result', jobId],
    queryFn: () => window.desktop.copywriting.getResult(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (query) => (query.state.data ? false : 700),
  });
  const submit = async (values: CopyForm) => {
    try {
      const job = await window.desktop.copywriting.generate({
        schema_version: '1.0',
        request_id: `copy_${crypto.randomUUID()}`,
        mode,
        ...values,
      });
      setJobId(job.job_id);
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void message.success('文案任务已进入队列');
    } catch {
      void message.error('无法创建文案任务，请检查必填项');
    }
  };
  const needsSource = mode === 'OPTIMIZE' || mode === 'DEDUPE';
  return (
    <>
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>AI 文案</Typography.Title>
          <Typography.Text type="secondary">
            所有产品事实先形成锁定快照，再交给文本能力接口。
          </Typography.Text>
        </div>
      </div>
      <Tabs
        activeKey={mode}
        onChange={(key) => {
          setMode(key as Mode);
          setJobId(null);
        }}
        items={[
          { key: 'CREATE', label: '创作文案' },
          { key: 'PRODUCT', label: '产品文案' },
          { key: 'OPTIMIZE', label: '优化' },
          { key: 'DEDUPE', label: '去重' },
        ]}
      />
      <Row gutter={[18, 18]} align="top">
        <Col span={12}>
          <Card title="输入">
            <Form
              form={form}
              layout="vertical"
              initialValues={defaultValues}
              onFinish={(values) => void submit(values)}
            >
              <Form.Item
                name="product_id"
                label="产品"
                rules={
                  mode === 'PRODUCT' ? [{ required: true, message: '产品文案必须选择产品' }] : []
                }
              >
                <Select
                  allowClear
                  placeholder={mode === 'PRODUCT' ? '请选择锁定事实产品' : '可选'}
                  options={(products.data ?? []).map((product) => ({
                    value: product.product_id,
                    label: product.name,
                  }))}
                />
              </Form.Item>
              {needsSource && (
                <Form.Item
                  name="source_text"
                  label="原文"
                  rules={[{ required: true, message: '请输入原文' }]}
                >
                  <Input.TextArea rows={8} maxLength={20000} showCount />
                </Form.Item>
              )}
              {mode === 'OPTIMIZE' && (
                <Form.Item name="optimize_operation" label="优化方式" rules={[{ required: true }]}>
                  <Select
                    options={[
                      { value: 'STRUCTURE', label: '结构优化' },
                      { value: 'OPENING', label: '开头优化' },
                      { value: 'COMPRESS', label: '压缩' },
                      { value: 'EXPAND', label: '扩写' },
                      { value: 'COLLOQUIAL', label: '口语化' },
                    ]}
                  />
                </Form.Item>
              )}
              {mode === 'DEDUPE' && (
                <Form.Item name="dedupe_level" label="去重强度" rules={[{ required: true }]}>
                  <Select
                    options={[
                      { value: 'LIGHT', label: '轻度' },
                      { value: 'MEDIUM', label: '中度' },
                      { value: 'DEEP', label: '深度' },
                    ]}
                  />
                </Form.Item>
              )}
              <Form.Item name="direction" label="内容方向">
                <Input />
              </Form.Item>
              <Space align="start" size="large">
                <Form.Item name="target_duration_seconds" label="目标时长（秒）">
                  <InputNumber min={5} max={600} />
                </Form.Item>
                <Form.Item name="style" label="风格">
                  <Select
                    style={{ width: 180 }}
                    options={['专业清晰', '口语自然', '科普解释', '痛点直入', '带货节奏'].map(
                      (value) => ({ value }),
                    )}
                  />
                </Form.Item>
              </Space>
              <Form.Item name="colloquial_level" label="口语化程度">
                <Slider min={0} max={3} marks={{ 0: '书面', 1: '轻', 2: '中', 3: '强' }} />
              </Form.Item>
              <Form.Item name="requirements" label="用户需求">
                <Input.TextArea rows={3} />
              </Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                loading={currentJob?.state === 'RUNNING'}
                block
              >
                创建文案任务
              </Button>
            </Form>
          </Card>
        </Col>
        <Col span={12}>
          <Card
            title="结果"
            extra={
              currentJob && (
                <Tag
                  color={
                    currentJob.state === 'FAILED'
                      ? 'red'
                      : currentJob.state === 'SUCCEEDED'
                        ? 'green'
                        : 'blue'
                  }
                >
                  {currentJob.state}
                </Tag>
              )
            }
          >
            {!jobId && (
              <Typography.Text type="secondary">
                提交任务后，结果会在这里显示。页面无需持续等待一个长 Promise。
              </Typography.Text>
            )}
            {currentJob?.state === 'FAILED' && (
              <Alert
                type="error"
                showIcon
                message={currentJob.error_message ?? '任务失败'}
                description={currentJob.error_code}
              />
            )}
            {currentJob && ['QUEUED', 'RUNNING'].includes(currentJob.state) && (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Alert
                  type="info"
                  showIcon
                  message="任务执行中"
                  description={`进度 ${Math.round(currentJob.progress * 100)}%`}
                />
                <Button
                  danger
                  onClick={() =>
                    window.desktop.jobs
                      .cancel(currentJob.job_id)
                      .then(() => queryClient.invalidateQueries({ queryKey: ['jobs'] }))
                  }
                >
                  取消任务
                </Button>
              </Space>
            )}
            {result.data?.result_status === 'REVIEW_REQUIRED' && (
              <Alert
                type="warning"
                showIcon
                message="发现产品事实冲突，需要人工确认"
                description={
                  <List
                    size="small"
                    dataSource={result.data.fact_conflicts}
                    renderItem={(conflict) => (
                      <List.Item>
                        <strong>{conflict.field}</strong>：{conflict.message}（锁定：
                        {conflict.expected}；证据：{conflict.evidence}）
                      </List.Item>
                    )}
                  />
                }
              />
            )}
            {result.data && (
              <>
                <Typography.Paragraph className="fact-result" copyable>
                  {result.data.text}
                </Typography.Paragraph>
                <Space wrap>
                  <Tag>
                    {result.data.prompt_template_id} v{result.data.prompt_template_version}
                  </Tag>
                  <Tag>{result.data.provider_alias}</Tag>
                  <Tag>{result.data.provider_model}</Tag>
                </Space>
              </>
            )}
          </Card>
        </Col>
      </Row>
    </>
  );
}
