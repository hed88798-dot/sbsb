const C3C_SEMANTIC_SHOT_PLANNING_MODEL_ALIAS = 'text.semantic-shot-planning';

export function resolveTextGatewayMaxCost(modelAlias: string): number {
  return modelAlias === C3C_SEMANTIC_SHOT_PLANNING_MODEL_ALIAS ? 2 : 1;
}
