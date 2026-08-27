import type { FactConflictV1, ProductFactSnapshotV1 } from '@app/contracts';

const species = ['猪', '鸡', '牛', '羊', '鸭', '鹅', '犬', '狗', '猫', '兔'];
const quantityPattern = /\d+(?:\.\d+)?\s*(?:mg|g|kg|ml|l|克|千克|毫升|升|袋|瓶|支|片|粒|%)/giu;

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

function extractQuantities(value: string): string[] {
  return [...value.matchAll(quantityPattern)].map((match) => normalize(match[0]));
}

function evidence(text: string, start: number, end: number): string {
  return text.slice(Math.max(0, start - 18), Math.min(text.length, end + 24));
}

function addConflict(
  conflicts: FactConflictV1[],
  field: FactConflictV1['field'],
  expected: string,
  foundEvidence: string,
  message: string,
): void {
  if (!conflicts.some((item) => item.field === field && item.evidence === foundEvidence)) {
    conflicts.push({ field, expected, evidence: foundEvidence, message });
  }
}

function checkLabeledFact(
  conflicts: FactConflictV1[],
  field: FactConflictV1['field'],
  expected: string,
  aliases: string[],
  text: string,
  label: RegExp,
): void {
  if (!expected) return;
  for (const match of text.matchAll(label)) {
    const claimed = match[1]?.trim() ?? '';
    if (!claimed) continue;
    const allowed = [expected, ...aliases];
    if (!allowed.some((value) => normalize(claimed).includes(normalize(value)))) {
      addConflict(conflicts, field, expected, match[0], `${field} 与锁定事实冲突`);
    }
  }
}

export function checkProductFacts(
  snapshot: ProductFactSnapshotV1,
  output: string,
): FactConflictV1[] {
  const conflicts: FactConflictV1[] = [];

  checkLabeledFact(
    conflicts,
    'name',
    snapshot.name,
    snapshot.aliases,
    output,
    /产品(?:名称|名)(?:为|是|：|:)\s*([^，。；;\n]{2,40})/gu,
  );
  checkLabeledFact(
    conflicts,
    'ingredients',
    snapshot.ingredients,
    [],
    output,
    /(?:主要)?成分(?:为|是|：|:)\s*([^。；;\n]{2,80})/gu,
  );
  checkLabeledFact(
    conflicts,
    'approved_scope',
    snapshot.approved_scope,
    [],
    output,
    /批准(?:范围|用途)(?:为|是|：|:)\s*([^。；;\n]{2,100})/gu,
  );

  const expectedSpecification = new Set(extractQuantities(snapshot.specification));
  for (const match of output.matchAll(/规格(?:为|是|：|:)?\s*([^，。；;\n]{1,80})/gu)) {
    const found = extractQuantities(match[1] ?? '');
    if (found.some((quantity) => !expectedSpecification.has(quantity))) {
      addConflict(
        conflicts,
        'specification',
        snapshot.specification,
        match[0],
        '规格数值与锁定事实冲突',
      );
    }
  }

  const expectedUsage = new Set(extractQuantities(snapshot.usage));
  for (const match of output.matchAll(/(?:用法用量|用量|每次|每日)([^。；;\n]{0,100})/gu)) {
    const found = extractQuantities(match[0]);
    if (found.some((quantity) => !expectedUsage.has(quantity))) {
      addConflict(conflicts, 'usage', snapshot.usage, match[0], '用法用量数值与锁定事实冲突');
    }
  }

  const allowedSpecies = species.filter((item) => snapshot.target_object.includes(item));
  const outputSpecies = species.filter((item) => output.includes(item));
  const unexpectedSpecies = outputSpecies.filter((item) => !allowedSpecies.includes(item));
  if (allowedSpecies.length > 0 && unexpectedSpecies.length > 0) {
    const index = output.indexOf(unexpectedSpecies[0] ?? '');
    addConflict(
      conflicts,
      'target_object',
      snapshot.target_object,
      evidence(output, index, index + (unexpectedSpecies[0]?.length ?? 0)),
      '适用对象与锁定事实冲突',
    );
  }

  if (
    snapshot.contraindications.length > 0 &&
    /(?:无|没有|不存在)(?:任何)?禁忌|禁忌(?:为|是|：|:)\s*无/gu.test(output)
  ) {
    addConflict(
      conflicts,
      'contraindications',
      snapshot.contraindications.join('；'),
      '无禁忌',
      '模型删除了锁定禁忌',
    );
  }

  for (const claim of snapshot.forbidden_claims) {
    if (claim && output.includes(claim)) {
      addConflict(conflicts, 'forbidden_claims', claim, claim, '输出包含锁定禁用表述');
    }
  }

  return conflicts;
}
