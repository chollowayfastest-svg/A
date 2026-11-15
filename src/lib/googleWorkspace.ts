import { toBatchCsv } from '../shared/ruleEngine';
import type { BatchEvaluatedRow, WorkbenchState } from '../shared/types';

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
}

export interface PickedFileItem {
  id: string;
  name: string;
  mimeType: string;
  url?: string;
}

export interface SpreadsheetTabInfo {
  sheetId: number;
  title: string;
  rowCount?: number;
  columnCount?: number;
}

export interface SpreadsheetMetadata {
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  sheets: SpreadsheetTabInfo[];
}

export type PickerMode = 'images' | 'spreadsheets' | 'all';

interface PickerBuilderInstance {
  addView: (view: unknown) => PickerBuilderInstance;
  enableFeature: (feature: unknown) => PickerBuilderInstance;
  setOAuthToken: (token: string) => PickerBuilderInstance;
  setOrigin: (origin: string) => PickerBuilderInstance;
  setTitle: (title: string) => PickerBuilderInstance;
  setCallback: (
    cb: (data: {
      action: string;
      docs?: Array<{ id: string; name: string; mimeType: string; url?: string }>;
    }) => void,
  ) => PickerBuilderInstance;
  build: () => { setVisible: (visible: boolean) => void };
}

declare global {
  interface Window {
    gapi?: {
      load: (
        api: string,
        options: { callback: () => void; onerror?: () => void } | (() => void),
      ) => void;
    };
    google?: {
      picker?: {
        PickerBuilder: new () => PickerBuilderInstance;
        ViewId: {
          DOCS: string;
          DOCS_IMAGES: string;
          SPREADSHEETS: string;
        };
        Feature: {
          MULTISELECT_ENABLED: string;
        };
        Action: {
          PICKED: string;
          CANCEL: string;
        };
      };
    };
  }
}

let pickerLoadPromise: Promise<void> | null = null;

export function loadGooglePicker(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Picker is only available in the browser.'));
  }
  if (window.google?.picker?.PickerBuilder) {
    return Promise.resolve();
  }
  if (pickerLoadPromise) return pickerLoadPromise;

  pickerLoadPromise = new Promise<void>((resolve, reject) => {
    const onGapiReady = () => {
      if (!window.gapi) {
        reject(new Error('Google API loader failed to initialize.'));
        return;
      }
      window.gapi.load('picker', {
        callback: () => {
          if (window.google?.picker?.PickerBuilder) {
            resolve();
          } else {
            reject(new Error('Google Picker library failed to load.'));
          }
        },
        onerror: () => reject(new Error('Failed to load Google Picker script.')),
      });
    };

    if (window.gapi) {
      onGapiReady();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://apis.google.com/js/api.js"]',
    );
    if (existing) {
      existing.addEventListener('load', onGapiReady, { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('Unable to load Google API script.')),
        { once: true },
      );
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.defer = true;
    script.onload = onGapiReady;
    script.onerror = () => reject(new Error('Unable to load Google API script.'));
    document.head.appendChild(script);
  }).catch((err) => {
    pickerLoadPromise = null;
    throw err;
  });

  return pickerLoadPromise;
}

export async function openGooglePicker(options: {
  accessToken: string;
  mode: PickerMode;
  multiselect?: boolean;
  title?: string;
}): Promise<PickedFileItem[]> {
  await loadGooglePicker();
  const pickerNs = window.google?.picker;
  if (!pickerNs) {
    throw new Error('Google Picker is unavailable.');
  }

  const pickerOrigin =
    window.location.ancestorOrigins &&
    window.location.ancestorOrigins.length > 0
      ? window.location.ancestorOrigins[
          window.location.ancestorOrigins.length - 1
        ]
      : window.location.origin;

  return new Promise<PickedFileItem[]>((resolve) => {
    const viewId =
      options.mode === 'images'
        ? pickerNs.ViewId.DOCS_IMAGES
        : options.mode === 'spreadsheets'
          ? pickerNs.ViewId.SPREADSHEETS
          : pickerNs.ViewId.DOCS;

    const builder = new pickerNs.PickerBuilder()
      .addView(viewId)
      .setOAuthToken(options.accessToken)
      .setOrigin(pickerOrigin);

    if (options.title) {
      builder.setTitle(options.title);
    }

    if (options.multiselect) {
      builder.enableFeature(pickerNs.Feature.MULTISELECT_ENABLED);
    }

    builder.setCallback(
      (data: {
        action: string;
        docs?: Array<{ id: string; name: string; mimeType: string; url?: string }>;
      }) => {
        if (data.action === pickerNs.Action.PICKED && Array.isArray(data.docs)) {
          resolve(
            data.docs.map((doc) => ({
              id: doc.id,
              name: doc.name,
              mimeType: doc.mimeType,
              url: doc.url,
            })),
          );
        } else if (data.action === pickerNs.Action.CANCEL) {
          resolve([]);
        }
      },
    );

    const picker = builder.build();
    picker.setVisible(true);
  });
}

async function handleGoogleApiError(res: Response, fallback: string): Promise<never> {
  let detail = fallback;
  try {
    const data = await res.json();
    if (data?.error?.message) {
      detail = data.error.message;
    }
  } catch {
    // ignore JSON parse errors
  }
  const err = new Error(detail) as Error & { status?: number };
  err.status = res.status;
  throw err;
}

export async function listDriveFiles(
  accessToken: string,
  filter: 'all' | 'images' | 'spreadsheets' | 'data' = 'all',
  searchQuery = '',
): Promise<DriveFileItem[]> {
  const clauses: string[] = ['trashed = false'];

  if (filter === 'images') {
    clauses.push("mimeType contains 'image/'");
  } else if (filter === 'spreadsheets') {
    clauses.push("mimeType = 'application/vnd.google-apps.spreadsheet'");
  } else if (filter === 'data') {
    clauses.push(
      "(mimeType = 'text/csv' or mimeType = 'application/json' or name contains '.csv' or name contains '.json')",
    );
  } else {
    clauses.push(
      "(mimeType contains 'image/' or mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'text/csv' or mimeType = 'application/json' or name contains '.csv' or name contains '.json')",
    );
  }

  const trimmed = searchQuery.trim();
  if (trimmed) {
    const escaped = trimmed.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    clauses.push(`name contains '${escaped}'`);
  }

  const params = new URLSearchParams({
    q: clauses.join(' and '),
    fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink)',
    orderBy: 'modifiedTime desc',
    pageSize: '30',
  });

  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    await handleGoogleApiError(res, 'Failed to list Google Drive files.');
  }
  const data = (await res.json()) as { files?: DriveFileItem[] };
  return data.files || [];
}

async function blobToCompressedDataUrl(
  blob: Blob,
  fallbackMime: string,
): Promise<{ dataUrl: string; mimeType: string }> {
  const mimeType = blob.type || fallbackMime || 'image/jpeg';
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Failed to decode Drive image.'));
    };
    reader.onerror = () => reject(new Error('Failed to read Drive image blob.'));
    reader.readAsDataURL(blob);
  });

  if (blob.size <= 550 * 1024) {
    return { dataUrl: rawDataUrl, mimeType };
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 1280;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({ dataUrl: rawDataUrl, mimeType });
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve({
        dataUrl: canvas.toDataURL('image/jpeg', 0.85),
        mimeType: 'image/jpeg',
      });
    };
    img.onerror = () => resolve({ dataUrl: rawDataUrl, mimeType });
    img.src = rawDataUrl;
  });
}

export async function downloadDriveImageAsDataUrl(
  accessToken: string,
  fileId: string,
  fallbackMime = 'image/jpeg',
): Promise<{ dataUrl: string; mimeType: string }> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok) {
    await handleGoogleApiError(res, 'Failed to download image from Google Drive.');
  }
  const blob = await res.blob();
  return blobToCompressedDataUrl(blob, fallbackMime);
}

export async function downloadDriveFileText(
  accessToken: string,
  fileId: string,
): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok) {
    await handleGoogleApiError(res, 'Failed to download file from Google Drive.');
  }
  return res.text();
}

export async function uploadDriveFile(
  accessToken: string,
  params: {
    name: string;
    mimeType: string;
    content: string;
    existingFileId?: string;
  },
): Promise<DriveFileItem> {
  const boundary = `silver_ledger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const metadata = {
    name: params.name,
    mimeType: params.mimeType,
  };
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${params.mimeType}; charset=UTF-8\r\n\r\n` +
    `${params.content}\r\n` +
    `--${boundary}--`;

  const isUpdate = Boolean(params.existingFileId);
  const url = isUpdate
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
        params.existingFileId!,
      )}?uploadType=multipart&fields=id,name,mimeType,modifiedTime,webViewLink`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,webViewLink';

  const res = await fetch(url, {
    method: isUpdate ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    await handleGoogleApiError(res, 'Failed to save file to Google Drive.');
  }
  return (await res.json()) as DriveFileItem;
}

export async function deleteDriveFile(
  accessToken: string,
  fileId: string,
): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok) {
    await handleGoogleApiError(
      res,
      'Failed to delete file from Google Drive (files must have been created or opened with this app).',
    );
  }
}

export function extractSpreadsheetId(input: string): string {
  const clean = input.trim();
  const match = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(clean);
  return match ? match[1] : clean;
}

export async function getSpreadsheetMetadata(
  accessToken: string,
  spreadsheetId: string,
): Promise<SpreadsheetMetadata> {
  const id = extractSpreadsheetId(spreadsheetId);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      id,
    )}?fields=spreadsheetId,properties.title,spreadsheetUrl,sheets.properties(sheetId,title,gridProperties)`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok) {
    await handleGoogleApiError(res, 'Unable to load Google Spreadsheet metadata.');
  }
  const raw = await res.json();
  return {
    spreadsheetId: raw.spreadsheetId,
    title: raw.properties?.title || 'Untitled Spreadsheet',
    spreadsheetUrl:
      raw.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${raw.spreadsheetId}`,
    sheets: Array.isArray(raw.sheets)
      ? raw.sheets.map(
          (s: {
            properties: {
              sheetId: number;
              title: string;
              gridProperties?: { rowCount?: number; columnCount?: number };
            };
          }) => ({
            sheetId: s.properties.sheetId,
            title: s.properties.title,
            rowCount: s.properties.gridProperties?.rowCount,
            columnCount: s.properties.gridProperties?.columnCount,
          }),
        )
      : [],
  };
}

export async function readSheetTabValues(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string,
): Promise<string[][]> {
  const escapedTitle = `'${sheetTitle.replace(/'/g, "''")}'`;
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId,
    )}/values/${encodeURIComponent(escapedTitle)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok) {
    await handleGoogleApiError(res, `Unable to read tab "${sheetTitle}".`);
  }
  const data = (await res.json()) as { values?: unknown[][] };
  if (!Array.isArray(data.values)) return [];
  return data.values.map((row) => row.map((cell) => (cell == null ? '' : String(cell))));
}

const HEADER_ALIASES: Record<string, string> = {
  'photo id': 'Photo_ID',
  photoid: 'Photo_ID',
  photo_id: 'Photo_ID',
  filename: 'Filename',
  'file name': 'Filename',
  'proposed series': 'Proposed_Series',
  series: 'Proposed_Series',
  proposed_series: 'Proposed_Series',
  'coin year': 'Coin_Year',
  year: 'Coin_Year',
  coin_year: 'Coin_Year',
  'coin mint': 'Coin_Mint',
  mint: 'Coin_Mint',
  coin_mint: 'Coin_Mint',
  'proposed variety': 'Proposed_Variety',
  variety: 'Proposed_Variety',
  proposed_variety: 'Proposed_Variety',
  'confidence pct': 'Confidence_Pct',
  'confidence %': 'Confidence_Pct',
  confidence: 'Confidence_Pct',
  confidence_pct: 'Confidence_Pct',
  'suggested grade': 'Suggested_Grade',
  grade: 'Suggested_Grade',
  suggested_grade: 'Suggested_Grade',
  'dataset grade': 'Dataset_Grade',
  dataset_grade: 'Dataset_Grade',
  'guide low': 'Guide_Low',
  guide_low: 'Guide_Low',
  'guide high': 'Guide_High',
  guide_high: 'Guide_High',
  'user action': 'User_Action',
  user_action: 'User_Action',
  'final id': 'Final_ID',
  final_id: 'Final_ID',
  'final value': 'Final_Value',
  final_value: 'Final_Value',
  'value source asof': 'Value_Source_AsOf',
  value_source_asof: 'Value_Source_AsOf',
  'diagnostic notes': 'Diagnostic_Notes',
  notes: 'Diagnostic_Notes',
  diagnostic_notes: 'Diagnostic_Notes',
  status: 'Status',
};

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function sheetValuesToCsv(values: string[][]): string {
  if (values.length === 0) return '';
  const normalizedHeader = values[0].map((h) => {
    const key = h.trim().toLowerCase();
    return HEADER_ALIASES[key] || h.trim();
  });
  const lines = [normalizedHeader.map(escapeCsvCell).join(',')];
  for (let i = 1; i < values.length; i++) {
    lines.push(values[i].map(escapeCsvCell).join(','));
  }
  return lines.join('\n');
}

function batchRowsTo2DArray(rows: BatchEvaluatedRow[]): (string | number)[][] {
  const csv = toBatchCsv(rows);
  // Parse our deterministic CSV lines back to clean typed cells for Sheets
  const lines = csv.split('\n');
  return lines.map((line, rowIdx) => {
    const cells: string[] = [];
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
        cells.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur);

    if (rowIdx === 0) return cells;
    return cells.map((c, colIdx) => {
      // Numeric columns in Batch Log: Coin_Year(3), Confidence_Pct(6), Lookup_Value(10),
      // Guide_Low(11), Guide_High(12), Guide_Value_Mid(13), Final_Value(16), Review_Seq(20)
      if ([3, 6, 10, 11, 12, 13, 16, 20].includes(colIdx) && c !== '' && !Number.isNaN(Number(c))) {
        return Number(c);
      }
      return c;
    });
  });
}

export async function exportWorkbookToNewSpreadsheet(
  accessToken: string,
  state: WorkbenchState,
): Promise<SpreadsheetMetadata> {
  const title = `Silver Dollar Ledger Workbook (${state.settings.priceAsOf})`;

  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title },
      sheets: [
        { properties: { title: 'Portfolio Summary', gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: 'Batch_Log', gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: 'Review_Queue', gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: 'Price_Data', gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: 'Variety_Reference', gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: 'Settings', gridProperties: { frozenRowCount: 1 } } },
      ],
    }),
  });

  if (!createRes.ok) {
    await handleGoogleApiError(createRes, 'Failed to create Google Sheets workbook.');
  }
  const created = await createRes.json();
  const spreadsheetId = created.spreadsheetId as string;

  const summaryRows: (string | number)[][] = [
    ['Metric', 'Value'],
    ['Total Batch Records', state.summary.totalRecords],
    ['Active Review Queue', state.summary.activeReviewQueue],
    ['Confidence Warnings', state.summary.confidenceWarnings],
    ['Accepted Count', state.summary.acceptedCount],
    ['Custom Overrides', state.summary.customOverridesCount],
    ['Ignored or Flagged (Distinct)', state.summary.ignoredOrFlaggedDistinct],
    ['Total Approved Final Value (USD)', state.summary.totalApprovedFinalValue],
    ['Approved Guide Mid Sum (USD)', state.summary.approvedGuideMidSum],
    ['Guardrail BLOCK Count', state.summary.guardrailBlockCount],
    ['Rows With Dataset Base', state.summary.rowsWithDatasetBase],
    ['Below Dataset Base Count', state.summary.belowBaseCount],
    ['Morgan Melt Floor (USD)', state.summary.meltValuePerMorgan],
    ['Classic Morgan Count', state.summary.seriesCounts.classicMorgan],
    ['2021+ Morgan Count', state.summary.seriesCounts.modernMorgan],
    ['Peace Dollar Count', state.summary.seriesCounts.peace],
    ['American Silver Eagle Count', state.summary.seriesCounts.silverEagle],
    ['Other Count', state.summary.seriesCounts.other],
  ];

  const batchGrid = batchRowsTo2DArray(state.batchRows);
  const queueGrid = batchRowsTo2DArray(state.reviewQueue);

  const priceGrid: (string | number)[][] = [
    [
      'Lookup_Key',
      'Year',
      'Mint_As_Given',
      'Mint_Code',
      'Mintage',
      'G-4',
      'F-12',
      'MS-60',
      'MS-63',
      'MS-65',
      'Key_Date',
      'Source_Quality',
    ],
    ...state.priceData.map((p) => [
      p.Lookup_Key,
      p.Year,
      p.Mint_As_Given,
      p.Mint_Code,
      p.Mintage,
      p['G-4'],
      p['F-12'],
      p['MS-60'],
      p['MS-63'],
      p['MS-65'],
      p.Key_Date,
      p.Source_Quality,
    ]),
  ];

  const varietyGrid: (string | number)[][] = [
    [
      'Variety_ID',
      'Series',
      'Date_Mint',
      'Variety_Name',
      'VAM_or_Code',
      'Key_Diagnostics',
      'Value_Low_USD',
      'Value_High_USD',
      'QC_Note',
    ],
    ...state.varietyReference.map((v) => [
      v.Variety_ID,
      v.Series,
      v.Date_Mint,
      v.Variety_Name,
      v.VAM_or_Code,
      v.Key_Diagnostics,
      v.Value_Low_USD,
      v.Value_High_USD,
      v.QC_Note,
    ]),
  ];

  const settingsGrid: (string | number | boolean)[][] = [
    ['Setting', 'Value'],
    ['Confidence_Threshold_Pct', state.settings.confidenceThreshold],
    ['High_Cutoff_Pct', state.settings.highCutoff],
    ['Medium_Floor_Pct', state.settings.mediumFloor],
    ['Silver_Spot_USD', state.settings.silverSpot],
    ['Price_AsOf', state.settings.priceAsOf],
    ['Auto_Accept_Rule_R7', false],
  ];

  const updateRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId,
    )}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: "'Portfolio Summary'!A1", values: summaryRows },
          { range: "'Batch_Log'!A1", values: batchGrid },
          { range: "'Review_Queue'!A1", values: queueGrid },
          { range: "'Price_Data'!A1", values: priceGrid },
          { range: "'Variety_Reference'!A1", values: varietyGrid },
          { range: "'Settings'!A1", values: settingsGrid },
        ],
      }),
    },
  );

  if (!updateRes.ok) {
    await handleGoogleApiError(updateRes, 'Created spreadsheet, but failed writing workbook data.');
  }

  return {
    spreadsheetId,
    title: created.properties?.title || title,
    spreadsheetUrl:
      created.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    sheets: Array.isArray(created.sheets)
      ? created.sheets.map(
          (s: { properties: { sheetId: number; title: string } }) => ({
            sheetId: s.properties.sheetId,
            title: s.properties.title,
          }),
        )
      : [],
  };
}

export async function syncBatchLogToExistingSheetTab(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string,
  rows: BatchEvaluatedRow[],
): Promise<void> {
  const escapedTitle = `'${sheetTitle.replace(/'/g, "''")}'`;
  const clearRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId,
    )}/values/${encodeURIComponent(escapedTitle)}:clear`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    },
  );
  if (!clearRes.ok) {
    await handleGoogleApiError(clearRes, `Failed to clear tab "${sheetTitle}".`);
  }

  const values = batchRowsTo2DArray(rows);
  const putRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId,
    )}/values/${encodeURIComponent(`${escapedTitle}!A1`)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values }),
    },
  );
  if (!putRes.ok) {
    await handleGoogleApiError(putRes, `Failed to write Batch Log to tab "${sheetTitle}".`);
  }
}

export async function exportFilteredBatchToNewSpreadsheet(
  accessToken: string,
  rows: BatchEvaluatedRow[],
  options?: {
    priceAsOf?: string;
    filterLabel?: string;
  },
): Promise<SpreadsheetMetadata> {
  const datePart = options?.priceAsOf || new Date().toISOString().slice(0, 10);
  const filterSuffix = options?.filterLabel ? ` · ${options.filterLabel}` : '';
  const title = `Silver Dollar Batch Log (${datePart}${filterSuffix}) - ${rows.length} coins`;
  const tabTitle = 'Batch_Log';

  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title },
      sheets: [
        {
          properties: {
            title: tabTitle,
            gridProperties: { frozenRowCount: 1 },
          },
        },
      ],
    }),
  });

  if (!createRes.ok) {
    await handleGoogleApiError(createRes, 'Failed to create Google Sheet.');
  }

  const created = await createRes.json();
  const spreadsheetId = created.spreadsheetId as string;
  const actualTabTitle: string =
    created.sheets?.[0]?.properties?.title || tabTitle;
  const escapedTitle = `'${actualTabTitle.replace(/'/g, "''")}'`;
  const values = batchRowsTo2DArray(rows);

  const putRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId,
    )}/values/${encodeURIComponent(`${escapedTitle}!A1`)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values }),
    },
  );

  if (!putRes.ok) {
    await handleGoogleApiError(
      putRes,
      'Created Google Sheet, but failed to populate batch data.',
    );
  }

  return {
    spreadsheetId,
    title: created.properties?.title || title,
    spreadsheetUrl:
      created.spreadsheetUrl ||
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    sheets: Array.isArray(created.sheets)
      ? created.sheets.map(
          (s: { properties: { sheetId: number; title: string } }) => ({
            sheetId: s.properties.sheetId,
            title: s.properties.title,
          }),
        )
      : [],
  };
}

