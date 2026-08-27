import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase, ProductRepository } from '../../packages/local-db/src/index.js';

const migrationsDirectory = resolve(import.meta.dirname, '../../migrations/desktop-sqlite');

const fixture = {
  name: '合成产品A',
  aliases: ['样例A', 'A产品'],
  category: '合成测试',
  target_object: '猪',
  ingredients: '合成成分10%',
  specification: '100g/袋',
  approved_scope: '用于合成测试',
  usage: '每次10g',
  contraindications: ['妊娠期禁用'],
  selling_points: ['结构清晰'],
  description: '不对应真实商品',
  marketing_focus: '事实保持',
  forbidden_claims: ['保证治愈'],
  notes: '',
  industry_metadata: { synthetic: true },
};

describe('ProductRepository', () => {
  it('supports CRUD and references local images without moving them', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'desktop-product-'));
    const imagePath = join(directory, '产品图.jpg');
    writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const { db } = await openDatabase({
      dbPath: join(directory, 'app.db'),
      migrationsDirectory,
    });
    const products = new ProductRepository(db);
    const created = products.create(fixture);
    expect(products.list()).toHaveLength(1);
    const updated = products.update(created.product_id, {
      ...fixture,
      name: '合成产品A升级版',
      aliases: ['升级A'],
    });
    expect(updated.name).toBe('合成产品A升级版');
    expect(updated.aliases).toEqual(['升级A']);
    const withAsset = products.addAssets(created.product_id, [imagePath], 'MAIN');
    expect(withAsset.assets).toHaveLength(1);
    expect(withAsset.assets[0]?.path).toBe(imagePath);
    expect(withAsset.assets[0]?.sha256).toHaveLength(64);
    expect(products.delete(created.product_id)).toBe(true);
    expect(products.get(created.product_id)).toBeNull();
    db.close();
  });
});
