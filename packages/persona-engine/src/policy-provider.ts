import type { ActivityPolicy } from '@persona/core';

export interface PolicyProvider {
  getPolicyByKey(key: string): ActivityPolicy | null;
}

export class StaticPolicyProvider implements PolicyProvider {
  private readonly policies: ReadonlyMap<string, ActivityPolicy>;

  constructor(policies: Record<string, ActivityPolicy>) {
    this.policies = new Map(Object.entries(policies));
  }

  getPolicyByKey(key: string): ActivityPolicy | null {
    return this.policies.get(key) ?? null;
  }
}
