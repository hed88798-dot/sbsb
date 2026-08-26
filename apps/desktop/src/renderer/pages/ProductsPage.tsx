import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Card,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ProductDTOv1, ProductDataV1 } from '@app/contracts';

const emptyProduct: ProductDataV1 = {
  name: '',
  aliases: [],
  category: '',
  target_object: '',
  ingredients: '',
  specification: '',
  approved_scope: '',
  usage: '',
  contraindications: [],
  selling_points: [],
  description: '',
  marketing_focus: '',
  forbidden_claims: [],
  notes: '',
  industry_metadata: {},
};

type ProductFormData = Omit<ProductDataV1, 'industry_metadata'>;
function formValues(product: ProductDataV1): ProductFormData {
  const { industry_metadata: industryMetadata, ...values } = product;
  void industryMetadata;
  return values;
}
const emptyProductForm = formValues(emptyProduct);

function ProductForm(props: {
  open: boolean;
  product: ProductDTOv1 | null;
  onClose(): void;
  onSave(data: ProductDataV1): Promise<void>;
}): React.JSX.Element {
  const [form] = Form.useForm<ProductFormData>();
  return (
    <Drawer
      title={props.product ? '编辑产品' : '新增产品'}
      width={680}
      open={props.open}
      destroyOnHidden
      onClose={props.onClose}
      afterOpenChange={(open) => {
        if (open) {
          if (props.product) {
            form.setFieldsValue(formValues(props.product));
          } else {
            form.setFieldsValue(emptyProductForm);
          }
        }
      }}
      extra={
        <Button type="primary" onClick={() => form.submit()}>
          保存
        </Button>
      }
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) =>
          props.onSave({
            ...values,
            industry_metadata: props.product?.industry_metadata ?? {},
          })
        }
        initialValues={emptyProductForm}
      >
        <Form.Item
          name="name"
          label="产品名称"
          rules={[{ required: true, message: '请输入产品名称' }]}
        >
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item name="aliases" label="别名">
          <Select mode="tags" tokenSeparators={[',', '，']} placeholder="输入后回车" />
        </Form.Item>
        <Space align="start" size="large" wrap>
          <Form.Item name="category" label="分类">
            <Input />
          </Form.Item>
          <Form.Item name="target_object" label="适用对象">
            <Input placeholder="例如：猪" />
          </Form.Item>
          <Form.Item name="specification" label="规格">
            <Input placeholder="例如：100g/袋" />
          </Form.Item>
        </Space>
        <Form.Item name="ingredients" label="成分 / 组成">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item name="approved_scope" label="批准 / 事实范围">
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item name="usage" label="用法用量">
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item name="contraindications" label="禁忌">
          <Select mode="tags" tokenSeparators={[';', '；']} />
        </Form.Item>
        <Form.Item name="selling_points" label="卖点">
          <Select mode="tags" tokenSeparators={[';', '；']} />
        </Form.Item>
        <Form.Item name="forbidden_claims" label="禁用表述">
          <Select mode="tags" tokenSeparators={[';', '；']} />
        </Form.Item>
        <Form.Item name="description" label="产品描述">
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item name="marketing_focus" label="营销重点">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item name="notes" label="备注">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Drawer>
  );
}

function filename(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? '本地图片';
}

export function ProductsPage(): React.JSX.Element {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const products = useQuery({
    queryKey: ['products'],
    queryFn: () => window.desktop.products.list(),
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProductDTOv1 | null>(null);
  const [assetRole, setAssetRole] = useState<'MAIN' | 'PACKAGING' | 'DETAIL' | 'OTHER'>('MAIN');
  const selected = useMemo(
    () => products.data?.find((product) => product.product_id === selectedId) ?? null,
    [products.data, selectedId],
  );
  const save = useMutation({
    mutationFn: (data: ProductDataV1) =>
      editing
        ? window.desktop.products.update({
            schema_version: '1.0',
            product_id: editing.product_id,
            data,
          })
        : window.desktop.products.create({ schema_version: '1.0', data }),
    onSuccess: async (product) => {
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      setSelectedId(product.product_id);
      setFormOpen(false);
      void message.success('产品已保存');
    },
    onError: () => void message.error('产品保存失败，请检查输入'),
  });
  const remove = useMutation({
    mutationFn: (productId: string) =>
      window.desktop.products.delete({ schema_version: '1.0', product_id: productId }),
    onSuccess: async () => {
      setSelectedId(null);
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      void message.success('产品已删除');
    },
  });
  const addImages = async () => {
    if (!selected) return;
    const paths = await window.desktop.products.chooseImages();
    if (paths.length === 0) return;
    await window.desktop.products.addAssets({
      schema_version: '1.0',
      product_id: selected.product_id,
      paths,
      role: assetRole,
    });
    await queryClient.invalidateQueries({ queryKey: ['products'] });
    void message.success(`已引用 ${paths.length} 张本地图片，原图未移动`);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>产品库</Typography.Title>
          <Typography.Text type="secondary">产品事实是 AI 文案的锁定来源。</Typography.Text>
        </div>
        <Button
          type="primary"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          新增产品
        </Button>
      </div>
      <Card>
        <Table
          rowKey="product_id"
          loading={products.isLoading}
          dataSource={products.data ?? []}
          rowClassName={() => 'product-row'}
          onRow={(record) => ({ onClick: () => setSelectedId(record.product_id) })}
          columns={[
            { title: '产品名称', dataIndex: 'name' },
            { title: '分类', dataIndex: 'category', render: (value: string) => value || '—' },
            {
              title: '适用对象',
              dataIndex: 'target_object',
              render: (value: string) => value || '—',
            },
            { title: '规格', dataIndex: 'specification', render: (value: string) => value || '—' },
            {
              title: '图片',
              dataIndex: 'assets',
              render: (assets: ProductDTOv1['assets']) => assets.length,
            },
            {
              title: '更新时间',
              dataIndex: 'updated_at',
              render: (value: string) => new Date(value).toLocaleString('zh-CN'),
            },
          ]}
          locale={{ emptyText: <Empty description="还没有产品，先新增一个产品" /> }}
        />
      </Card>
      <Modal
        width={760}
        open={Boolean(selected)}
        title={selected?.name}
        onCancel={() => setSelectedId(null)}
        footer={
          selected
            ? [
                <Popconfirm
                  key="delete"
                  title="确认删除该产品？"
                  onConfirm={() => remove.mutate(selected.product_id)}
                >
                  <Button danger>删除</Button>
                </Popconfirm>,
                <Button
                  key="edit"
                  onClick={() => {
                    setEditing(selected);
                    setFormOpen(true);
                  }}
                >
                  编辑
                </Button>,
                <Button key="close" type="primary" onClick={() => setSelectedId(null)}>
                  关闭
                </Button>,
              ]
            : null
        }
      >
        {selected && (
          <>
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="别名">
                {selected.aliases.join('、') || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="分类">{selected.category || '—'}</Descriptions.Item>
              <Descriptions.Item label="适用对象">
                {selected.target_object || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="规格">{selected.specification || '—'}</Descriptions.Item>
              <Descriptions.Item label="成分" span={2}>
                {selected.ingredients || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="批准范围" span={2}>
                {selected.approved_scope || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="用法用量" span={2}>
                {selected.usage || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="禁忌" span={2}>
                {selected.contraindications.join('；') || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="禁用表述" span={2}>
                {selected.forbidden_claims.join('；') || '—'}
              </Descriptions.Item>
            </Descriptions>
            <Divider>本地产品图片</Divider>
            <Space wrap>
              <Select
                value={assetRole}
                onChange={(value) => setAssetRole(value as typeof assetRole)}
                options={[
                  { value: 'MAIN', label: '主图' },
                  { value: 'PACKAGING', label: '包装' },
                  { value: 'DETAIL', label: '细节' },
                  { value: 'OTHER', label: '其他' },
                ]}
              />
              <Button onClick={() => void addImages()}>选择本地图片</Button>
              <Typography.Text type="secondary">
                只保存引用和哈希，不移动、不覆盖原图
              </Typography.Text>
            </Space>
            <div style={{ marginTop: 12 }}>
              {selected.assets.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未添加图片" />
              ) : (
                selected.assets.map((asset) => (
                  <Tag key={asset.asset_id}>
                    {asset.role} · {filename(asset.path)}
                  </Tag>
                ))
              )}
            </div>
          </>
        )}
      </Modal>
      <ProductForm
        open={formOpen}
        product={editing}
        onClose={() => setFormOpen(false)}
        onSave={(data) => save.mutateAsync(data).then(() => undefined)}
      />
    </>
  );
}
