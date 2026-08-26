import type { FactConflictV1, ProductFactSnapshotV1 } from '@app/contracts';
import { sha256 } from '@app/domain-product';

export interface FactRegressionFixtureV1 {
  id: string;
  workflow: 'GENERATE' | 'OPTIMIZE' | 'DEDUPE_LIGHT' | 'DEDUPE_MEDIUM' | 'DEDUPE_DEEP';
  snapshot: ProductFactSnapshotV1;
  output: string;
  expectedConflictField: FactConflictV1['field'] | null;
}

function snapshot(index: number): ProductFactSnapshotV1 {
  const facts = {
    schema_version: '1.0' as const,
    product_id: `synthetic_product_${index}`,
    name: `合成锁定产品${index}`,
    aliases: [`锁定别名${index}`],
    ingredients: `合成成分${index}%`,
    specification: `${100 + index}g/袋`,
    target_object: '猪',
    approved_scope: `仅用于合成批准范围${index}`,
    usage: `每次${10 + index}g`,
    contraindications: [`合成禁忌${index}`],
    forbidden_claims: [`保证治愈${index}`],
  };
  return { ...facts, snapshot_hash: sha256(facts) };
}

export const factRegressionFixtures: FactRegressionFixtureV1[] = Array.from(
  { length: 10 },
  (_, index) => {
    const facts = snapshot(index);
    const correct = `${facts.name}，规格：${facts.specification}，适用对象${facts.target_object}。批准范围：${facts.approved_scope}。用法用量${facts.usage}。禁忌：${facts.contraindications[0]}。`;
    return [
      {
        id: `fact-${index}-generate-correct`,
        workflow: 'GENERATE' as const,
        snapshot: facts,
        output: correct,
        expectedConflictField: null,
      },
      {
        id: `fact-${index}-optimize-correct`,
        workflow: 'OPTIMIZE' as const,
        snapshot: facts,
        output: `先说重点：${correct}`,
        expectedConflictField: null,
      },
      {
        id: `fact-${index}-specification`,
        workflow: 'DEDUPE_LIGHT' as const,
        snapshot: facts,
        output: `${facts.name}，规格：${500 + index}g/袋，适用对象猪。`,
        expectedConflictField: 'specification' as const,
      },
      {
        id: `fact-${index}-target`,
        workflow: 'DEDUPE_MEDIUM' as const,
        snapshot: facts,
        output: `${facts.name}适用于鸡，规格：${facts.specification}。`,
        expectedConflictField: 'target_object' as const,
      },
      {
        id: `fact-${index}-approved`,
        workflow: 'DEDUPE_DEEP' as const,
        snapshot: facts,
        output: `${facts.name}，批准范围：可用于改变后的批准用途${index}。`,
        expectedConflictField: 'approved_scope' as const,
      },
      {
        id: `fact-${index}-contraindication`,
        workflow: 'OPTIMIZE' as const,
        snapshot: facts,
        output: `${facts.name}没有任何禁忌，可以放心使用。`,
        expectedConflictField: 'contraindications' as const,
      },
      {
        id: `fact-${index}-name`,
        workflow: 'GENERATE' as const,
        snapshot: facts,
        output: `产品名称：合成替代产品${index}，规格：${facts.specification}。`,
        expectedConflictField: 'name' as const,
      },
      {
        id: `fact-${index}-usage`,
        workflow: 'DEDUPE_LIGHT' as const,
        snapshot: facts,
        output: `${facts.name}，用法用量每次${50 + index}g。`,
        expectedConflictField: 'usage' as const,
      },
      {
        id: `fact-${index}-ingredients`,
        workflow: 'DEDUPE_MEDIUM' as const,
        snapshot: facts,
        output: `${facts.name}，主要成分：替代成分${index}%。`,
        expectedConflictField: 'ingredients' as const,
      },
      {
        id: `fact-${index}-forbidden`,
        workflow: 'DEDUPE_DEEP' as const,
        snapshot: facts,
        output: `${facts.name}${facts.forbidden_claims[0]}。`,
        expectedConflictField: 'forbidden_claims' as const,
      },
    ];
  },
).flat();
