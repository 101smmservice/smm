export interface ActionPolicy {
  maxPerDay: number;
  probabilityPerEncounter: number;
}

export interface ActivityPolicy {
  stage: string;
  maxSessionMinutes: number;
  sessionsPerDay: [number, number];
  actions: {
    view: ActionPolicy;
    like: ActionPolicy;
    follow: ActionPolicy;
    post: ActionPolicy;
    comment: ActionPolicy;
  };
  minIntervalMinutes: [number, number];
  skipDayProbability: number;
}
