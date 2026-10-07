export interface Persona {
  id: string;
  timezone: string;
  locale: string;
  niche: string;
  tone: string;
  topics: string[];
  audience: string;
  activityWindow: {
    startHour: number;
    endHour: number;
    weekendActive: boolean;
  };
}
