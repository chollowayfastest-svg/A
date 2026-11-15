export type CoinSeries =
  | 'Classic Morgan'
  | '2021+ Morgan'
  | 'Peace'
  | 'American Silver Eagle'
  | 'Other';

export type DatasetGrade = 'G-4' | 'F-12' | 'MS-60' | 'MS-63' | 'MS-65' | '';

export type UserAction = 'Accept' | 'Custom_ID' | 'Custom_Value' | 'Ignore' | '';

export type ReviewStatus = 'Reviewed' | 'Flagged' | '';

export type SourceQuality = 'Original' | 'Corrected' | 'Estimated';

export interface PriceDataRow {
  Lookup_Key: string;
  Year: number;
  Mint_As_Given: string;
  Mint_Code: string;
  Mintage: number;
  'G-4': number;
  'F-12': number;
  'MS-60': number;
  'MS-63': number;
  'MS-65': number;
  Key_Date: 'Yes' | 'No';
  Source_Quality: SourceQuality;
}

export interface VarietyRow {
  Variety_ID: string;
  Series: string;
  Date_Mint: string;
  Variety_Name: string;
  VAM_or_Code: string;
  Key_Diagnostics: string;
  Value_Low_USD: number;
  Value_High_USD: number;
  QC_Note: string;
}

export interface BatchRawInput {
  photoId: string;
  filename: string;
  proposedSeries: CoinSeries | string;
  coinYear: number | '';
  coinMint: string;
  proposedVariety: string;
  confidencePct: number | '';
  suggestedGrade: string;
  datasetGrade: DatasetGrade;
  guideLow: number | '';
  guideHigh: number | '';
  userAction: UserAction;
  finalId: string;
  finalValue: number | '';
  valueSourceAsOf: string;
  diagnosticNotes: string;
  status: ReviewStatus;
  imageDataUrl?: string;
}

export interface BatchEvaluatedRow extends BatchRawInput {
  mintCode: string;
  dateMintKey: string;
  confidenceFlag: 'OK' | 'WARNING' | '';
  lookupValue: number | '';
  guideValueMid: number | '';
  reviewSeq: number | '';
  guardrailCheck: string;
  isBlocked: boolean;
  isKeyDate: 'Yes' | 'No' | '';
  datasetSourceQuality: SourceQuality | '';
  valueCheck: 'Below base - verify' | 'No dataset base' | 'OK' | '';
  inReviewQueue: boolean;
}

export interface WorkbookSettings {
  confidenceThreshold: number;
  highCutoff: number;
  mediumFloor: number;
  silverSpot: number;
  priceAsOf: string;
  autoAccept: false;
}

export interface PortfolioSummary {
  totalRecords: number;
  activeReviewQueue: number;
  confidenceWarnings: number;
  acceptedCount: number;
  customOverridesCount: number;
  ignoredOrFlaggedDistinct: number;
  totalApprovedFinalValue: number;
  approvedGuideMidSum: number;
  highConfidenceCount: number;
  mediumConfidenceCount: number;
  lowConfidenceCount: number;
  averageConfidence: number | null;
  guardrailBlockCount: number;
  rowsWithDatasetBase: number;
  belowBaseCount: number;
  meltValuePerMorgan: number;
  seriesCounts: {
    classicMorgan: number;
    modernMorgan: number;
    peace: number;
    silverEagle: number;
    other: number;
  };
}

export interface AuditFormulaItem {
  id: string;
  sheet: 'Settings' | 'Batch Log' | 'Portfolio Summary' | 'Review Queue';
  cellRange: string;
  fieldLabel: string;
  formula: string;
  numberFormat: string;
  sampleOutput: string;
  fixSummary: string;
}

export interface AuditIssueItem {
  id: string;
  severity: 'Critical' | 'High' | 'Medium';
  location: string;
  defect: string;
  resolution: string;
}

export interface QaTestResult {
  id: string;
  scope: 'Live State' | 'Rule & Sample Simulation';
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
}

export interface WorkbenchState {
  settings: WorkbookSettings;
  batchRows: BatchEvaluatedRow[];
  reviewQueue: BatchEvaluatedRow[];
  summary: PortfolioSummary;
  priceData: PriceDataRow[];
  varietyReference: VarietyRow[];
  workbookFormulas: AuditFormulaItem[];
  auditIssues: AuditIssueItem[];
}
