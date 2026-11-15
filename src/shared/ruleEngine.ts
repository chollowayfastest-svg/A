import {
  DEFAULT_SETTINGS,
  GRADE_MAP,
  MINT_CODE_MAP,
  PRICE_DATA,
  SEED_BATCH,
  TESTING_SAMPLE_BATCH,
} from './seedData.ts';
import type {
  BatchEvaluatedRow,
  BatchRawInput,
  DatasetGrade,
  PortfolioSummary,
  PriceDataRow,
  QaTestResult,
  WorkbookSettings,
} from './types.ts';

const PRICE_BY_KEY = new Map<string, PriceDataRow>(
  PRICE_DATA.map((row) => [row.Lookup_Key, row]),
);

export function normalizeMintCode(rawMint: string): string {
  const clean = (rawMint || '').trim();
  if (!clean) return '';
  const mapped = MINT_CODE_MAP[clean.toUpperCase()];
  return mapped || clean.toUpperCase();
}

export function normalizeDatasetGrade(
  explicitDatasetGrade: DatasetGrade,
  suggestedGrade: string,
): DatasetGrade {
  if (explicitDatasetGrade) return explicitDatasetGrade;
  const clean = (suggestedGrade || '').trim().toUpperCase();
  return GRADE_MAP[clean] || '';
}

export function evaluateSingleRow(
  raw: BatchRawInput,
  settings: WorkbookSettings,
): Omit<BatchEvaluatedRow, 'reviewSeq'> {
  const mintCode = normalizeMintCode(raw.coinMint);
  const isClassic = raw.proposedSeries === 'Classic Morgan' || raw.proposedSeries === '';
  const dateMintKey =
    raw.coinYear !== '' && mintCode ? `${raw.coinYear}-${mintCode}` : '';

  const priceRow =
    isClassic && dateMintKey ? PRICE_BY_KEY.get(dateMintKey) : undefined;

  const confidenceFlag: 'OK' | 'WARNING' | '' =
    raw.confidencePct === ''
      ? ''
      : Number(raw.confidencePct) >= settings.confidenceThreshold
        ? 'OK'
        : 'WARNING';

  let lookupValue: number | '' = '';
  if (priceRow && raw.datasetGrade) {
    const val = priceRow[raw.datasetGrade];
    if (typeof val === 'number') lookupValue = val;
  }

  const guideValueMid: number | '' =
    raw.guideLow !== '' && raw.guideHigh !== ''
      ? Math.round((Number(raw.guideLow) + Number(raw.guideHigh)) / 2)
      : '';

  const isKeyDate: 'Yes' | 'No' | '' = priceRow ? priceRow.Key_Date : '';
  const datasetSourceQuality = priceRow ? priceRow.Source_Quality : '';

  let valueCheck: 'Below base - verify' | 'No dataset base' | 'OK' | '' = '';
  if (raw.photoId.trim() !== '') {
    if (lookupValue === '' || guideValueMid === '') {
      valueCheck = 'No dataset base';
    } else if (Number(guideValueMid) < Number(lookupValue)) {
      valueCheck = 'Below base - verify';
    } else {
      valueCheck = 'OK';
    }
  }

  // Guardrail_Check enforcing R1–R6 + Custom_ID / Custom_Value Diagnostic_Notes requirement
  let guardrailCheck = '';
  if (raw.userAction !== '') {
    if (raw.userAction === 'Accept' && confidenceFlag === 'WARNING') {
      guardrailCheck = 'BLOCK - low confidence cannot Accept';
    } else if (raw.userAction === 'Accept' && raw.confidencePct === '') {
      guardrailCheck = 'BLOCK - Accept requires confidence';
    } else if (
      raw.userAction === 'Accept' &&
      isKeyDate === 'Yes' &&
      raw.status !== 'Reviewed'
    ) {
      guardrailCheck = 'BLOCK - Key Date requires human review';
    } else if (raw.userAction === 'Custom_ID' && raw.finalId.trim() === '') {
      guardrailCheck = 'BLOCK - Custom_ID requires Final_ID';
    } else if (
      (raw.userAction === 'Custom_ID' || raw.userAction === 'Custom_Value') &&
      raw.diagnosticNotes.trim() === ''
    ) {
      guardrailCheck = 'BLOCK - Custom decision requires Diagnostic_Notes';
    } else if (raw.userAction !== 'Ignore' && raw.finalValue === '') {
      guardrailCheck = 'BLOCK - decision requires Final_Value';
    } else {
      guardrailCheck = 'OK';
    }
  }

  const isBlocked = guardrailCheck.startsWith('BLOCK');

  // Review Queue criterion: not yet Reviewed AND (WARNING OR Flagged OR blank User_Action OR Key Date)
  const inReviewQueue =
    raw.photoId.trim() !== '' &&
    raw.status !== 'Reviewed' &&
    (confidenceFlag === 'WARNING' ||
      raw.status === 'Flagged' ||
      raw.userAction === '' ||
      isKeyDate === 'Yes');

  return {
    ...raw,
    mintCode,
    dateMintKey,
    confidenceFlag,
    lookupValue,
    guideValueMid,
    guardrailCheck,
    isBlocked,
    isKeyDate,
    datasetSourceQuality,
    valueCheck,
    inReviewQueue,
  };
}

export function evaluateBatch(
  rows: BatchRawInput[],
  settings: WorkbookSettings,
): { evaluatedRows: BatchEvaluatedRow[]; reviewQueue: BatchEvaluatedRow[] } {
  let seq = 0;
  const evaluatedRows: BatchEvaluatedRow[] = rows.map((raw) => {
    const partial = evaluateSingleRow(raw, settings);
    const reviewSeq: number | '' = partial.inReviewQueue ? ++seq : '';
    return {
      ...partial,
      reviewSeq,
    };
  });

  const reviewQueue = evaluatedRows.filter((r) => r.inReviewQueue);
  return { evaluatedRows, reviewQueue };
}

export function computePortfolioSummary(
  rows: BatchEvaluatedRow[],
  settings: WorkbookSettings,
): PortfolioSummary {
  const validRows = rows.filter((r) => r.photoId.trim() !== '');
  const totalRecords = validRows.length;
  const activeReviewQueue = validRows.filter((r) => r.reviewSeq !== '').length;
  const confidenceWarnings = validRows.filter(
    (r) => r.confidenceFlag === 'WARNING',
  ).length;
  const acceptedCount = validRows.filter((r) => r.userAction === 'Accept').length;
  const customOverridesCount = validRows.filter(
    (r) => r.userAction === 'Custom_ID' || r.userAction === 'Custom_Value',
  ).length;
  const ignoredOrFlaggedDistinct = validRows.filter(
    (r) => r.userAction === 'Ignore' || r.status === 'Flagged',
  ).length;

  const approvedRows = validRows.filter(
    (r) =>
      r.userAction === 'Accept' ||
      r.userAction === 'Custom_ID' ||
      r.userAction === 'Custom_Value',
  );

  const totalApprovedFinalValue = approvedRows.reduce(
    (sum, r) => sum + (r.finalValue !== '' ? Number(r.finalValue) : 0),
    0,
  );
  const approvedGuideMidSum = approvedRows.reduce(
    (sum, r) => sum + (r.guideValueMid !== '' ? Number(r.guideValueMid) : 0),
    0,
  );

  const confRows = validRows.filter((r) => r.confidencePct !== '');
  const highConfidenceCount = confRows.filter(
    (r) => Number(r.confidencePct) >= settings.highCutoff,
  ).length;
  const mediumConfidenceCount = confRows.filter(
    (r) =>
      Number(r.confidencePct) >= settings.mediumFloor &&
      Number(r.confidencePct) < settings.highCutoff,
  ).length;
  const lowConfidenceCount = confRows.filter(
    (r) => Number(r.confidencePct) < settings.mediumFloor,
  ).length;

  const averageConfidence =
    confRows.length > 0
      ? Number(
          (
            confRows.reduce((s, r) => s + Number(r.confidencePct), 0) /
            confRows.length
          ).toFixed(1),
        )
      : null;

  const guardrailBlockCount = validRows.filter((r) => r.isBlocked).length;
  const rowsWithDatasetBase = validRows.filter(
    (r) => r.lookupValue !== '' && Number(r.lookupValue) > 0,
  ).length;
  const belowBaseCount = validRows.filter(
    (r) => r.valueCheck === 'Below base - verify',
  ).length;

  const classicMorgan = validRows.filter(
    (r) => r.proposedSeries === 'Classic Morgan',
  ).length;
  const modernMorgan = validRows.filter(
    (r) => r.proposedSeries === '2021+ Morgan',
  ).length;
  const peace = validRows.filter((r) => r.proposedSeries === 'Peace').length;
  const silverEagle = validRows.filter(
    (r) => r.proposedSeries === 'American Silver Eagle',
  ).length;
  const other = totalRecords - (classicMorgan + modernMorgan + peace + silverEagle);

  const meltValuePerMorgan = Number((0.7734 * settings.silverSpot).toFixed(2));

  return {
    totalRecords,
    activeReviewQueue,
    confidenceWarnings,
    acceptedCount,
    customOverridesCount,
    ignoredOrFlaggedDistinct,
    totalApprovedFinalValue,
    approvedGuideMidSum,
    highConfidenceCount,
    mediumConfidenceCount,
    lowConfidenceCount,
    averageConfidence,
    guardrailBlockCount,
    rowsWithDatasetBase,
    belowBaseCount,
    meltValuePerMorgan,
    seriesCounts: {
      classicMorgan,
      modernMorgan,
      peace,
      silverEagle,
      other,
    },
  };
}

function escapeCsvCell(value: string | number | undefined): string {
  const str = value === undefined || value === null ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toBatchCsv(rows: BatchEvaluatedRow[]): string {
  const headers = [
    'Photo_ID',
    'Filename',
    'Proposed_Series',
    'Coin_Year',
    'Coin_Mint',
    'Proposed_Variety',
    'Confidence_Pct',
    'Confidence_Flag',
    'Suggested_Grade',
    'Dataset_Grade',
    'Lookup_Value',
    'Guide_Low',
    'Guide_High',
    'Guide_Value_Mid',
    'User_Action',
    'Final_ID',
    'Final_Value',
    'Value_Source_AsOf',
    'Diagnostic_Notes',
    'Status',
    'Review_Seq',
    'Guardrail_Check',
    'Is_Key_Date',
    'Dataset_Source_Quality',
    'Value_Check',
  ];

  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.photoId,
        r.filename,
        r.proposedSeries,
        r.coinYear,
        r.coinMint,
        r.proposedVariety,
        r.confidencePct,
        r.confidenceFlag,
        r.suggestedGrade,
        r.datasetGrade,
        r.lookupValue,
        r.guideLow,
        r.guideHigh,
        r.guideValueMid,
        r.userAction,
        r.finalId,
        r.finalValue,
        r.valueSourceAsOf,
        r.diagnosticNotes,
        r.status,
        r.reviewSeq,
        r.guardrailCheck,
        r.isKeyDate,
        r.datasetSourceQuality,
        r.valueCheck,
      ]
        .map(escapeCsvCell)
        .join(','),
    );
  }
  return lines.join('\n');
}

export function toRawTemplateCsv(rows: BatchRawInput[]): string {
  const headers = [
    'Photo_ID',
    'Filename',
    'Proposed_Series',
    'Coin_Year',
    'Coin_Mint',
    'Proposed_Variety',
    'Confidence_Pct',
    'Suggested_Grade',
    'Dataset_Grade',
    'Guide_Low',
    'Guide_High',
    'User_Action',
    'Final_ID',
    'Final_Value',
    'Value_Source_AsOf',
    'Diagnostic_Notes',
    'Status',
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.photoId,
        r.filename,
        r.proposedSeries,
        r.coinYear,
        r.coinMint,
        r.proposedVariety,
        r.confidencePct,
        r.suggestedGrade,
        r.datasetGrade,
        r.guideLow,
        r.guideHigh,
        r.userAction,
        r.finalId,
        r.finalValue,
        r.valueSourceAsOf,
        r.diagnosticNotes,
        r.status,
      ]
        .map(escapeCsvCell)
        .join(','),
    );
  }
  return lines.join('\n');
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

export function parseBatchCsv(csvText: string): BatchRawInput[] {
  const lines = csvText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const idx = (name: string) => header.indexOf(name.toLowerCase());

  const get = (cells: string[], key: string) => {
    const i = idx(key);
    return i >= 0 && i < cells.length ? cells[i] : '';
  };

  const numOrEmpty = (v: string): number | '' => {
    if (!v.trim()) return '';
    const n = Number(v);
    return Number.isFinite(n) ? n : '';
  };

  const parsed: BatchRawInput[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    const photoId = get(c, 'Photo_ID');
    if (!photoId) continue;

    const dg = get(c, 'Dataset_Grade') as DatasetGrade;
    const ua = get(c, 'User_Action') as BatchRawInput['userAction'];
    const st = get(c, 'Status') as BatchRawInput['status'];

    parsed.push({
      photoId,
      filename: get(c, 'Filename'),
      proposedSeries: get(c, 'Proposed_Series') || 'Classic Morgan',
      coinYear: numOrEmpty(get(c, 'Coin_Year')),
      coinMint: get(c, 'Coin_Mint'),
      proposedVariety: get(c, 'Proposed_Variety'),
      confidencePct: numOrEmpty(get(c, 'Confidence_Pct')),
      suggestedGrade: get(c, 'Suggested_Grade'),
      datasetGrade: ['G-4', 'F-12', 'MS-60', 'MS-63', 'MS-65'].includes(dg) ? dg : '',
      guideLow: numOrEmpty(get(c, 'Guide_Low')),
      guideHigh: numOrEmpty(get(c, 'Guide_High')),
      userAction: ['Accept', 'Custom_ID', 'Custom_Value', 'Ignore'].includes(ua) ? ua : '',
      finalId: get(c, 'Final_ID'),
      finalValue: numOrEmpty(get(c, 'Final_Value')),
      valueSourceAsOf: get(c, 'Value_Source_AsOf') || '2026-11-14',
      diagnosticNotes: get(c, 'Diagnostic_Notes'),
      status: ['Reviewed', 'Flagged'].includes(st) ? st : '',
    });
  }
  return parsed;
}

export function runQaAcceptanceSuite(
  liveRows: BatchEvaluatedRow[],
  liveSettings: WorkbookSettings,
): QaTestResult[] {
  const results: QaTestResult[] = [];
  const liveSummary = computePortfolioSummary(liveRows, liveSettings);

  // Live state checks
  results.push({
    id: 'QA-L1',
    scope: 'Live State',
    name: 'Price Data Source Quality integrity (38 Original + 9 Corrected + 48 Estimated = 95)',
    passed:
      PRICE_DATA.length === 95 &&
      PRICE_DATA.filter((r) => r.Source_Quality === 'Original').length === 38 &&
      PRICE_DATA.filter((r) => r.Source_Quality === 'Corrected').length === 9 &&
      PRICE_DATA.filter((r) => r.Source_Quality === 'Estimated').length === 48,
    expected: '95 total (38 / 9 / 48)',
    actual: `${PRICE_DATA.length} total (${PRICE_DATA.filter((r) => r.Source_Quality === 'Original').length} / ${PRICE_DATA.filter((r) => r.Source_Quality === 'Corrected').length} / ${PRICE_DATA.filter((r) => r.Source_Quality === 'Estimated').length})`,
  });

  const seqNums = liveRows.map((r) => r.reviewSeq).filter((v): v is number => typeof v === 'number');
  const isContiguous = seqNums.every((n, i) => n === i + 1);
  results.push({
    id: 'QA-L2',
    scope: 'Live State',
    name: 'Review_Seq contiguous distinct numbering (no double-counting)',
    passed: isContiguous && liveSummary.activeReviewQueue === seqNums.length,
    expected: `1..${liveSummary.activeReviewQueue} contiguous`,
    actual: seqNums.length === 0 ? 'Empty (0)' : `[${seqNums.join(', ')}]`,
  });

  results.push({
    id: 'QA-L3',
    scope: 'Live State',
    name: 'Rule R7: Auto-Accept is permanently disabled',
    passed: liveSettings.autoAccept === false,
    expected: 'false',
    actual: String(liveSettings.autoAccept),
  });

  // Isolated seed parity check (Err:539 fix)
  const seedEval = evaluateBatch(SEED_BATCH, DEFAULT_SETTINGS);
  const seedSummary = computePortfolioSummary(seedEval.evaluatedRows, DEFAULT_SETTINGS);
  const ph001 = seedEval.evaluatedRows.find((r) => r.photoId === 'PH001');
  const ph004 = seedEval.evaluatedRows.find((r) => r.photoId === 'PH004');
  results.push({
    id: 'QA-S0',
    scope: 'Rule & Sample Simulation',
    name: 'Seed PH001–PH006 Err:539 fix & Portfolio Summary reconciliation',
    passed:
      ph001?.lookupValue === 250 &&
      ph001?.valueCheck === 'Below base - verify' &&
      ph004?.lookupValue === 650 &&
      ph004?.valueCheck === 'OK' &&
      seedSummary.activeReviewQueue === 1 &&
      seedSummary.totalApprovedFinalValue === 1585 &&
      seedSummary.guardrailBlockCount === 0,
    expected: 'PH001=250 (Below base), PH004=650 (OK), Queue=1, Value=$1,585, BLOCK=0',
    actual: `PH001=${ph001?.lookupValue} (${ph001?.valueCheck}), PH004=${ph004?.lookupValue} (${ph004?.valueCheck}), Queue=${seedSummary.activeReviewQueue}, Value=$${seedSummary.totalApprovedFinalValue}, BLOCK=${seedSummary.guardrailBlockCount}`,
  });

  // PH007–PH014 isolated guardrail & edge-case tests
  const sampleEval = evaluateBatch(TESTING_SAMPLE_BATCH, DEFAULT_SETTINGS).evaluatedRows;
  const byId = (id: string) => sampleEval.find((r) => r.photoId === id);

  const r7 = byId('PH007');
  results.push({
    id: 'QA-PH007',
    scope: 'Rule & Sample Simulation',
    name: 'PH007 (R6): High-conf Key Date Accept without Status=Reviewed must BLOCK',
    passed:
      r7?.mintCode === 'S' &&
      r7?.isKeyDate === 'Yes' &&
      r7?.guardrailCheck === 'BLOCK - Key Date requires human review' &&
      r7?.inReviewQueue === true,
    expected: 'Mint=S, KeyDate=Yes, BLOCK - Key Date requires human review, InQueue=true',
    actual: `Mint=${r7?.mintCode}, KeyDate=${r7?.isKeyDate}, ${r7?.guardrailCheck}, InQueue=${r7?.inReviewQueue}`,
  });

  const r8 = byId('PH008');
  results.push({
    id: 'QA-PH008',
    scope: 'Rule & Sample Simulation',
    name: 'PH008 (R1): Confidence 61% (<70%) cannot Accept -> BLOCK',
    passed:
      r8?.confidenceFlag === 'WARNING' &&
      r8?.guardrailCheck === 'BLOCK - low confidence cannot Accept',
    expected: 'WARNING + BLOCK - low confidence cannot Accept',
    actual: `${r8?.confidenceFlag} + ${r8?.guardrailCheck}`,
  });

  const r9 = byId('PH009');
  results.push({
    id: 'QA-PH009',
    scope: 'Rule & Sample Simulation',
    name: 'PH009 (R3): Custom_ID with blank Final_ID -> BLOCK',
    passed:
      r9?.mintCode === 'O' &&
      r9?.guardrailCheck === 'BLOCK - Custom_ID requires Final_ID',
    expected: 'Mint=O + BLOCK - Custom_ID requires Final_ID',
    actual: `Mint=${r9?.mintCode} + ${r9?.guardrailCheck}`,
  });

  const r10 = byId('PH010');
  results.push({
    id: 'QA-PH010',
    scope: 'Rule & Sample Simulation',
    name: 'PH010 (Custom Notes Rule): Custom_Value without Diagnostic_Notes -> BLOCK',
    passed:
      r10?.mintCode === 'CC' &&
      r10?.guardrailCheck === 'BLOCK - Custom decision requires Diagnostic_Notes',
    expected: 'Mint=CC + BLOCK - Custom decision requires Diagnostic_Notes',
    actual: `Mint=${r10?.mintCode} + ${r10?.guardrailCheck}`,
  });

  const r11 = byId('PH011');
  results.push({
    id: 'QA-PH011',
    scope: 'Rule & Sample Simulation',
    name: 'PH011 (R2): Accept with blank Confidence -> BLOCK',
    passed: r11?.guardrailCheck === 'BLOCK - Accept requires confidence',
    expected: 'BLOCK - Accept requires confidence',
    actual: String(r11?.guardrailCheck),
  });

  const r12 = byId('PH012');
  results.push({
    id: 'QA-PH012',
    scope: 'Rule & Sample Simulation',
    name: 'PH012 (Value Check): 1892-P Guide Mid $600 < Corrected base $800 -> Below base',
    passed:
      r12?.lookupValue === 800 &&
      r12?.datasetSourceQuality === 'Corrected' &&
      r12?.valueCheck === 'Below base - verify' &&
      r12?.guardrailCheck === 'OK',
    expected: 'Lookup=800 (Corrected), Below base - verify, OK',
    actual: `Lookup=${r12?.lookupValue} (${r12?.datasetSourceQuality}), ${r12?.valueCheck}, ${r12?.guardrailCheck}`,
  });

  const r13 = byId('PH013');
  results.push({
    id: 'QA-PH013',
    scope: 'Rule & Sample Simulation',
    name: 'PH013 (Series Bypass): 1921 Peace Dollar skips 1921-P Classic Morgan lookup',
    passed:
      r13?.lookupValue === '' &&
      r13?.isKeyDate === '' &&
      r13?.valueCheck === 'No dataset base' &&
      r13?.inReviewQueue === true,
    expected: 'Lookup="", KeyDate="", No dataset base, InQueue=true',
    actual: `Lookup="${r13?.lookupValue}", KeyDate="${r13?.isKeyDate}", ${r13?.valueCheck}, InQueue=${r13?.inReviewQueue}`,
  });

  const r14 = byId('PH014');
  results.push({
    id: 'QA-PH014',
    scope: 'Rule & Sample Simulation',
    name: 'PH014 (R6 Pass): Key Date 1886-O with Status=Reviewed passes OK and exits Queue',
    passed:
      r14?.isKeyDate === 'Yes' &&
      r14?.lookupValue === 4250 &&
      r14?.guardrailCheck === 'OK' &&
      r14?.inReviewQueue === false,
    expected: 'KeyDate=Yes, Lookup=4250, OK, InQueue=false',
    actual: `KeyDate=${r14?.isKeyDate}, Lookup=${r14?.lookupValue}, ${r14?.guardrailCheck}, InQueue=${r14?.inReviewQueue}`,
  });

  return results;
}
