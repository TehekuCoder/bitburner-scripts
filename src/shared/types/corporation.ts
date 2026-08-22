export interface CorporationState {
  hasCorp: boolean;
  corpName?: string;
  funds: number;
  revenue: number;
  expenses: number;
  divisions: string[];
  stage: string; // z.B. "AGRI_BOOTSTRAP", "TOBACCO_DEV", "PUBLIC"
  investmentOffer: number;
  corpRecentLogs: string[];
}