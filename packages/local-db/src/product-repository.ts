import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import type { Database } from 'better-sqlite3';
import {
  productDtoV1Schema,
  type ProductAssetRoleV1,
  type ProductAssetV1,
  type ProductDTOv1,
  type ProductDataV1,
} from './types.js';

interface ProductRow {
  product_id: string;
  name: string;
  category: string;
  target_object: string;
  ingredients: string;
  specification: string;
  approved_scope: string;
  usage: string;
  contraindications_json: string;
  selling_points_json: string;
  description: string;
  marketing_focus: string;
  forbidden_claims_json: string;
  notes: string;
  industry_metadata_json: string;
  created_at: string;
  updated_at: string;
}

interface AssetRow {
  asset_id: string;
  product_id: string;
  source_path: string;
  sha256: string;
  media_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  role: ProductAssetRoleV1;
  created_at: string;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function mediaType(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  return 'image/jpeg';
}

export class ProductRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  list(): ProductDTOv1[] {
    const rows = this.#db
      .prepare('SELECT * FROM products ORDER BY updated_at DESC')
      .all() as ProductRow[];
    return rows.map((row) => this.#map(row));
  }

  get(productId: string): ProductDTOv1 | null {
    const row = this.#db.prepare('SELECT * FROM products WHERE product_id = ?').get(productId) as
      | ProductRow
      | undefined;
    return row ? this.#map(row) : null;
  }

  create(data: ProductDataV1): ProductDTOv1 {
    const productId = `product_${randomUUID()}`;
    const now = new Date().toISOString();
    const write = this.#db.transaction(() => {
      this.#db
        .prepare(
          `INSERT INTO products(
            product_id, name, category, target_object, ingredients, specification,
            approved_scope, usage, contraindications_json, selling_points_json,
            description, marketing_focus, forbidden_claims_json, notes,
            industry_metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          productId,
          data.name,
          data.category,
          data.target_object,
          data.ingredients,
          data.specification,
          data.approved_scope,
          data.usage,
          JSON.stringify(data.contraindications),
          JSON.stringify(data.selling_points),
          data.description,
          data.marketing_focus,
          JSON.stringify(data.forbidden_claims),
          data.notes,
          JSON.stringify(data.industry_metadata),
          now,
          now,
        );
      this.#replaceAliases(productId, data.aliases);
    });
    write.immediate();
    return this.#require(productId);
  }

  update(productId: string, data: ProductDataV1): ProductDTOv1 {
    const now = new Date().toISOString();
    const write = this.#db.transaction(() => {
      const result = this.#db
        .prepare(
          `UPDATE products SET
            name = ?, category = ?, target_object = ?, ingredients = ?, specification = ?,
            approved_scope = ?, usage = ?, contraindications_json = ?, selling_points_json = ?,
            description = ?, marketing_focus = ?, forbidden_claims_json = ?, notes = ?,
            industry_metadata_json = ?, updated_at = ?
          WHERE product_id = ?`,
        )
        .run(
          data.name,
          data.category,
          data.target_object,
          data.ingredients,
          data.specification,
          data.approved_scope,
          data.usage,
          JSON.stringify(data.contraindications),
          JSON.stringify(data.selling_points),
          data.description,
          data.marketing_focus,
          JSON.stringify(data.forbidden_claims),
          data.notes,
          JSON.stringify(data.industry_metadata),
          now,
          productId,
        );
      if (result.changes !== 1) throw new Error('PRODUCT_NOT_FOUND');
      this.#replaceAliases(productId, data.aliases);
    });
    write.immediate();
    return this.#require(productId);
  }

  delete(productId: string): boolean {
    return (
      this.#db.prepare('DELETE FROM products WHERE product_id = ?').run(productId).changes === 1
    );
  }

  addAssets(productId: string, paths: string[], role: ProductAssetRoleV1): ProductDTOv1 {
    this.#require(productId);
    const insert = this.#db.prepare(
      `INSERT OR IGNORE INTO product_assets(
        asset_id, product_id, source_path, sha256, media_type, size_bytes,
        width, height, role, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, '{}', ?)`,
    );
    const write = this.#db.transaction(() => {
      for (const path of paths) {
        const bytes = readFileSync(path);
        const stat = statSync(path);
        insert.run(
          `product_asset_${randomUUID()}`,
          productId,
          path,
          createHash('sha256').update(bytes).digest('hex'),
          mediaType(path),
          stat.size,
          role,
          new Date().toISOString(),
        );
      }
      this.#db
        .prepare('UPDATE products SET updated_at = ? WHERE product_id = ?')
        .run(new Date().toISOString(), productId);
    });
    write.immediate();
    return this.#require(productId);
  }

  #replaceAliases(productId: string, aliases: string[]): void {
    this.#db.prepare('DELETE FROM product_aliases WHERE product_id = ?').run(productId);
    const insert = this.#db.prepare(
      'INSERT INTO product_aliases(alias_id, product_id, alias, normalized_alias) VALUES (?, ?, ?, ?)',
    );
    for (const alias of [...new Set(aliases.map((item) => item.trim()).filter(Boolean))]) {
      insert.run(
        `product_alias_${randomUUID()}`,
        productId,
        alias,
        alias.toLocaleLowerCase('zh-CN'),
      );
    }
  }

  #require(productId: string): ProductDTOv1 {
    const product = this.get(productId);
    if (!product) throw new Error('PRODUCT_NOT_FOUND');
    return product;
  }

  #map(row: ProductRow): ProductDTOv1 {
    const aliases = this.#db
      .prepare('SELECT alias FROM product_aliases WHERE product_id = ? ORDER BY alias')
      .all(row.product_id) as { alias: string }[];
    const assetRows = this.#db
      .prepare('SELECT * FROM product_assets WHERE product_id = ? ORDER BY created_at')
      .all(row.product_id) as AssetRow[];
    const assets: ProductAssetV1[] = assetRows.map((asset) => ({
      schema_version: '1.0',
      asset_id: asset.asset_id,
      product_id: asset.product_id,
      path: asset.source_path,
      sha256: asset.sha256,
      media_type: asset.media_type,
      size_bytes: asset.size_bytes,
      width: asset.width,
      height: asset.height,
      role: asset.role,
      created_at: asset.created_at,
    }));
    return productDtoV1Schema.parse({
      schema_version: '1.0',
      product_id: row.product_id,
      name: row.name,
      aliases: aliases.map((item) => item.alias),
      category: row.category,
      target_object: row.target_object,
      ingredients: row.ingredients,
      specification: row.specification,
      approved_scope: row.approved_scope,
      usage: row.usage,
      contraindications: parseJson<string[]>(row.contraindications_json),
      selling_points: parseJson<string[]>(row.selling_points_json),
      description: row.description,
      marketing_focus: row.marketing_focus,
      forbidden_claims: parseJson<string[]>(row.forbidden_claims_json),
      notes: row.notes,
      industry_metadata: parseJson<Record<string, unknown>>(row.industry_metadata_json),
      assets,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  }
}
