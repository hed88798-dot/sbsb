import { useEffect } from 'react';
import { Alert, App, Button, Card, Form, Input, Typography } from 'antd';

export function SettingsPage(): React.JSX.Element {
  const { message } = App.useApp();
  const [form] = Form.useForm<{ backend_url: string }>();
  useEffect(() => {
    void window.desktop.settings
      .get('backend_url')
      .then((value) =>
        form.setFieldsValue({ backend_url: value ?? 'https://gateway.example.invalid' }),
      );
  }, [form]);
  return (
    <>
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>设置</Typography.Title>
          <Typography.Text type="secondary">
            桌面端只配置平台 Backend，不接收任何 Provider Key。
          </Typography.Text>
        </div>
      </div>
      <Card style={{ maxWidth: 760 }}>
        <Alert
          type="info"
          showIcon
          message="当前为 Mock Text 路径"
          description="正式 Text Provider 适配、授权和路由属于 Code B。v0.1 桌面端不保存也不打包厂商密钥。"
          style={{ marginBottom: 20 }}
        />
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) =>
            window.desktop.settings
              .set('backend_url', values.backend_url)
              .then(() => message.success('设置已保存'))
          }
        >
          <Form.Item
            name="backend_url"
            label="Backend URL"
            rules={[{ required: true }, { type: 'url', message: '请输入有效 URL' }]}
          >
            <Input placeholder="https://gateway.example.com" />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            保存设置
          </Button>
        </Form>
      </Card>
    </>
  );
}
