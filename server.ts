import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import {
  AUDIT_ISSUES,
  DEFAULT_SETTINGS,
  PRICE_DATA,
  SEED_BATCH,
  TESTING_SAMPLE_BATCH,
  VARIETY_REFERENCE,
  WORKBOOK_FORMULAS,
} from './src/shared/seedData.ts';
import {
  computePortfolioSummary,
  evaluateBatch,
  evaluateSingleRow,
  normalizeDatasetGrade,
  parseBatchCsv,
} from './src/shared/ruleEngine.ts';
import type {
  BatchRawInput,
  WorkbenchState,
  WorkbookSettings,
} from './src/shared/types.ts';

interface PersistedData {
  settings: WorkbookSettings;
  batchInputs: BatchRawInput[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'workbench-state.json');

function ensureStore(): PersistedData {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    const initial: PersistedData = {
      settings: { ...DEFAULT_SETTINGS, autoAccept: false },
      batchInputs: structuredClone(SEED_BATCH),
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PersistedData>;
    return {
      settings: {
        ...DEFAULT_SETTINGS,
        ...(parsed.settings || {}),
        autoAccept: false,
      },
      batchInputs: Array.isArray(parsed.batchInputs)
        ? parsed.batchInputs
        : structuredClone(SEED_BATCH),
    };
  } catch {
    const fallback: PersistedData = {
      settings: { ...DEFAULT_SETTINGS, autoAccept: false },
      batchInputs: structuredClone(SEED_BATCH),
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(fallback, null, 2), 'utf-8');
    return fallback;
  }
}

function saveStore(data: PersistedData): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const normalized: PersistedData = {
    settings: { ...data.settings, autoAccept: false },
    batchInputs: data.batchInputs,
  };
  const tmpFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(normalized, null, 2), 'utf-8');
  fs.renameSync(tmpFile, DATA_FILE);
}

function buildWorkbenchState(store: PersistedData): WorkbenchState {
  const { evaluatedRows, reviewQueue } = evaluateBatch(
    store.batchInputs,
    store.settings,
  );
  const summary = computePortfolioSummary(evaluatedRows, store.settings);
  return {
    settings: store.settings,
    batchRows: evaluatedRows,
    reviewQueue,
    summary,
    priceData: PRICE_DATA,
    varietyReference: VARIETY_REFERENCE,
    workbookFormulas: WORKBOOK_FORMULAS,
    auditIssues: AUDIT_ISSUES,
  };
}

function nextPhotoId(existing: BatchRawInput[]): string {
  let maxNum = 0;
  for (const r of existing) {
    const m = /^PH(\d+)$/i.exec(r.photoId.trim());
    if (m) {
      const n = Number(m[1]);
      if (n > maxNum) maxNum = n;
    }
  }
  return `PH${String(maxNum + 1).padStart(3, '0')}`;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/state', (_req, res) => {
    const store = ensureStore();
    res.json(buildWorkbenchState(store));
  });

  app.post('/api/batch', (req, res) => {
    const store = ensureStore();
    const body = req.body as Partial<BatchRawInput>;
    const photoId = (body.photoId || '').trim() || nextPhotoId(store.batchInputs);

    if (store.batchInputs.some((r) => r.photoId.toUpperCase() === photoId.toUpperCase())) {
      res.status(409).json({ error: `Photo_ID ${photoId} already exists in Batch Log.` });
      return;
    }

    const suggestedGrade = (body.suggestedGrade || '').trim();
    const datasetGrade = normalizeDatasetGrade(body.datasetGrade || '', suggestedGrade);

    // Rule R7: Proposals always enter pending Review Queue with blank User_Action & Status
    const newRow: BatchRawInput = {
      photoId,
      filename: (body.filename || `${photoId.toLowerCase()}.jpg`).trim(),
      proposedSeries: body.proposedSeries || 'Classic Morgan',
      coinYear: body.coinYear === '' || body.coinYear === undefined ? '' : Number(body.coinYear),
      coinMint: (body.coinMint || '').trim(),
      proposedVariety: (body.proposedVariety || '').trim(),
      confidencePct:
        body.confidencePct === '' || body.confidencePct === undefined
          ? ''
          : Math.max(0, Math.min(100, Number(body.confidencePct))),
      suggestedGrade,
      datasetGrade,
      guideLow:
        body.guideLow === '' || body.guideLow === undefined ? '' : Number(body.guideLow),
      guideHigh:
        body.guideHigh === '' || body.guideHigh === undefined ? '' : Number(body.guideHigh),
      userAction: '',
      finalId: '',
      finalValue: '',
      valueSourceAsOf: store.settings.priceAsOf,
      diagnosticNotes: (body.diagnosticNotes || '').trim(),
      status: '',
      imageDataUrl: typeof body.imageDataUrl === 'string' ? body.imageDataUrl : undefined,
    };

    store.batchInputs.push(newRow);
    saveStore(store);
    res.status(201).json(buildWorkbenchState(store));
  });

  app.post('/api/batch/bulk', (req, res) => {
    const store = ensureStore();
    const { items } = req.body as { items?: Array<Partial<BatchRawInput>> };

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'items array is required.' });
      return;
    }

    const existingIds = new Set(
      store.batchInputs.map((r) => r.photoId.toUpperCase()),
    );
    const addedIds: string[] = [];

    for (const body of items) {
      let photoId = (body.photoId || '').trim();
      if (!photoId || existingIds.has(photoId.toUpperCase())) {
        photoId = nextPhotoId(store.batchInputs);
      }
      existingIds.add(photoId.toUpperCase());

      const suggestedGrade = (body.suggestedGrade || '').trim();
      const datasetGrade = normalizeDatasetGrade(
        body.datasetGrade || '',
        suggestedGrade,
      );

      // Rule R7: Bulk uploaded photos enter pending Review Queue with blank User_Action & Status
      const newRow: BatchRawInput = {
        photoId,
        filename: (body.filename || `${photoId.toLowerCase()}.jpg`).trim(),
        proposedSeries: body.proposedSeries || 'Classic Morgan',
        coinYear:
          body.coinYear === '' || body.coinYear === undefined
            ? ''
            : Number(body.coinYear),
        coinMint: (body.coinMint || '').trim(),
        proposedVariety: (body.proposedVariety || '').trim(),
        confidencePct:
          body.confidencePct === '' || body.confidencePct === undefined
            ? ''
            : Math.max(0, Math.min(100, Number(body.confidencePct))),
        suggestedGrade,
        datasetGrade,
        guideLow:
          body.guideLow === '' || body.guideLow === undefined
            ? ''
            : Number(body.guideLow),
        guideHigh:
          body.guideHigh === '' || body.guideHigh === undefined
            ? ''
            : Number(body.guideHigh),
        userAction: '',
        finalId: '',
        finalValue: '',
        valueSourceAsOf: store.settings.priceAsOf,
        diagnosticNotes: (body.diagnosticNotes || '').trim(),
        status: '',
        imageDataUrl:
          typeof body.imageDataUrl === 'string' ? body.imageDataUrl : undefined,
      };

      store.batchInputs.push(newRow);
      addedIds.push(photoId);
    }

    saveStore(store);
    res.status(201).json({
      added: addedIds.length,
      addedIds,
      state: buildWorkbenchState(store),
    });
  });

  app.put('/api/batch/bulk-status', (req, res) => {
    const store = ensureStore();
    const { photoIds, status } = req.body as {
      photoIds?: string[];
      status?: BatchRawInput['status'];
    };

    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      res.status(400).json({ error: 'photoIds array is required.' });
      return;
    }

    const validStatuses: Array<BatchRawInput['status']> = ['Reviewed', 'Flagged', ''];
    if (status === undefined || !validStatuses.includes(status)) {
      res.status(400).json({ error: 'Invalid status value.' });
      return;
    }

    const targetSet = new Set(photoIds.map((id) => String(id).trim().toUpperCase()));
    const updatedIds: string[] = [];
    const skipped: Array<{ photoId: string; reason: string }> = [];

    store.batchInputs = store.batchInputs.map((row) => {
      if (!targetSet.has(row.photoId.toUpperCase())) return row;
      const candidate: BatchRawInput = { ...row, status };
      const evaluated = evaluateSingleRow(candidate, store.settings);
      if (evaluated.isBlocked) {
        skipped.push({ photoId: row.photoId, reason: evaluated.guardrailCheck });
        return row;
      }
      updatedIds.push(row.photoId);
      return candidate;
    });

    if (updatedIds.length === 0 && skipped.length > 0) {
      res.status(400).json({
        error: `Blocked by guardrails: ${skipped.map((s) => `${s.photoId} (${s.reason})`).join('; ')}`,
      });
      return;
    }

    saveStore(store);
    res.json({
      updatedIds,
      skipped,
      state: buildWorkbenchState(store),
    });
  });

  app.put('/api/batch/bulk-metadata', (req, res) => {
    const store = ensureStore();
    const { photoIds, patch } = req.body as {
      photoIds?: string[];
      patch?: Partial<BatchRawInput>;
    };

    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      res.status(400).json({ error: 'photoIds array is required.' });
      return;
    }
    if (!patch || typeof patch !== 'object') {
      res.status(400).json({ error: 'patch object is required.' });
      return;
    }

    if (patch.coinYear !== undefined && patch.coinYear !== '') {
      const y = Number(patch.coinYear);
      if (!Number.isInteger(y) || y < 1794 || y > 2100) {
        res.status(400).json({
          error: 'Coin Year must be a valid 4-digit year between 1794 and 2100.',
        });
        return;
      }
    }

    const targetSet = new Set(photoIds.map((id) => String(id).trim().toUpperCase()));
    const blocked: Array<{ photoId: string; reason: string }> = [];
    const updatedIds: string[] = [];

    const nextBatch = store.batchInputs.map((row) => {
      if (!targetSet.has(row.photoId.toUpperCase())) return row;

      const nextSuggestedGrade =
        patch.suggestedGrade !== undefined
          ? String(patch.suggestedGrade).trim()
          : row.suggestedGrade;
      const nextDatasetGrade =
        patch.datasetGrade !== undefined
          ? patch.datasetGrade
          : patch.suggestedGrade !== undefined
            ? normalizeDatasetGrade('', nextSuggestedGrade)
            : row.datasetGrade;

      const candidate: BatchRawInput = {
        ...row,
        proposedSeries: patch.proposedSeries ?? row.proposedSeries,
        coinYear:
          patch.coinYear !== undefined
            ? patch.coinYear === ''
              ? ''
              : Number(patch.coinYear)
            : row.coinYear,
        coinMint:
          patch.coinMint !== undefined ? String(patch.coinMint).trim() : row.coinMint,
        proposedVariety:
          patch.proposedVariety !== undefined
            ? String(patch.proposedVariety).trim()
            : row.proposedVariety,
        suggestedGrade: nextSuggestedGrade,
        datasetGrade: nextDatasetGrade,
        diagnosticNotes:
          patch.diagnosticNotes !== undefined
            ? String(patch.diagnosticNotes).trim()
            : row.diagnosticNotes,
      };

      const evaluated = evaluateSingleRow(candidate, store.settings);
      if (evaluated.isBlocked) {
        blocked.push({ photoId: row.photoId, reason: evaluated.guardrailCheck });
      }
      updatedIds.push(row.photoId);
      return candidate;
    });

    if (blocked.length > 0) {
      res.status(400).json({
        error: `Rule Engine blocked bulk update: ${blocked
          .map((b) => `${b.photoId} (${b.reason})`)
          .join('; ')}`,
        blocked,
      });
      return;
    }

    store.batchInputs = nextBatch;
    saveStore(store);
    res.json({
      updated: updatedIds.length,
      updatedIds,
      state: buildWorkbenchState(store),
    });
  });

  app.put('/api/batch/:photoId', (req, res) => {
    const store = ensureStore();
    const targetId = req.params.photoId.trim();
    const index = store.batchInputs.findIndex(
      (r) => r.photoId.toUpperCase() === targetId.toUpperCase(),
    );
    if (index === -1) {
      res.status(404).json({ error: `Record ${targetId} not found.` });
      return;
    }

    const current = store.batchInputs[index];
    const patch = req.body as Partial<BatchRawInput>;

    const candidate: BatchRawInput = {
      ...current,
      proposedSeries: patch.proposedSeries ?? current.proposedSeries,
      coinYear: patch.coinYear !== undefined ? patch.coinYear : current.coinYear,
      coinMint: patch.coinMint !== undefined ? patch.coinMint : current.coinMint,
      proposedVariety:
        patch.proposedVariety !== undefined ? patch.proposedVariety : current.proposedVariety,
      confidencePct:
        patch.confidencePct !== undefined ? patch.confidencePct : current.confidencePct,
      suggestedGrade:
        patch.suggestedGrade !== undefined ? patch.suggestedGrade : current.suggestedGrade,
      datasetGrade:
        patch.datasetGrade !== undefined ? patch.datasetGrade : current.datasetGrade,
      guideLow: patch.guideLow !== undefined ? patch.guideLow : current.guideLow,
      guideHigh: patch.guideHigh !== undefined ? patch.guideHigh : current.guideHigh,
      userAction: patch.userAction !== undefined ? patch.userAction : current.userAction,
      finalId: patch.finalId !== undefined ? patch.finalId : current.finalId,
      finalValue: patch.finalValue !== undefined ? patch.finalValue : current.finalValue,
      valueSourceAsOf:
        patch.valueSourceAsOf !== undefined
          ? patch.valueSourceAsOf
          : current.valueSourceAsOf,
      diagnosticNotes:
        patch.diagnosticNotes !== undefined
          ? patch.diagnosticNotes
          : current.diagnosticNotes,
      status: patch.status !== undefined ? patch.status : current.status,
    };

    const evaluated = evaluateSingleRow(candidate, store.settings);
    if (evaluated.isBlocked) {
      res.status(400).json({ error: evaluated.guardrailCheck });
      return;
    }

    store.batchInputs[index] = candidate;
    saveStore(store);
    res.json(buildWorkbenchState(store));
  });

  app.post('/api/batch/bulk-delete', (req, res) => {
    const store = ensureStore();
    const { photoIds } = req.body as { photoIds?: string[] };

    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      res.status(400).json({ error: 'photoIds array is required.' });
      return;
    }

    const targetSet = new Set(photoIds.map((id) => String(id).trim().toUpperCase()));
    const deletedIds: string[] = [];
    store.batchInputs = store.batchInputs.filter((row) => {
      if (targetSet.has(row.photoId.toUpperCase())) {
        deletedIds.push(row.photoId);
        return false;
      }
      return true;
    });

    saveStore(store);
    res.json({
      deleted: deletedIds.length,
      deletedIds,
      state: buildWorkbenchState(store),
    });
  });

  app.delete('/api/batch/:photoId', (req, res) => {
    const store = ensureStore();
    const targetId = req.params.photoId.trim().toUpperCase();
    store.batchInputs = store.batchInputs.filter(
      (r) => r.photoId.toUpperCase() !== targetId,
    );
    saveStore(store);
    res.json(buildWorkbenchState(store));
  });

  app.post('/api/batch/load-sample', (_req, res) => {
    const store = ensureStore();
    const existingIds = new Set(store.batchInputs.map((r) => r.photoId.toUpperCase()));
    let added = 0;
    for (const sample of TESTING_SAMPLE_BATCH) {
      if (!existingIds.has(sample.photoId.toUpperCase())) {
        store.batchInputs.push(structuredClone(sample));
        added++;
      }
    }
    saveStore(store);
    res.json({ added, state: buildWorkbenchState(store) });
  });

  app.post('/api/batch/reset', (_req, res) => {
    const store: PersistedData = {
      settings: { ...DEFAULT_SETTINGS, autoAccept: false },
      batchInputs: structuredClone(SEED_BATCH),
    };
    saveStore(store);
    res.json(buildWorkbenchState(store));
  });

  app.post('/api/batch/import-csv', (req, res) => {
    const store = ensureStore();
    const { csvText, mode } = req.body as { csvText?: string; mode?: 'append' | 'replace' };
    if (!csvText || typeof csvText !== 'string') {
      res.status(400).json({ error: 'csvText string is required.' });
      return;
    }
    const parsed = parseBatchCsv(csvText);
    if (parsed.length === 0) {
      res.status(400).json({ error: 'No valid rows found in CSV (requires Photo_ID column).' });
      return;
    }

    if (mode === 'replace') {
      store.batchInputs = parsed;
    } else {
      const byId = new Map(store.batchInputs.map((r) => [r.photoId.toUpperCase(), r]));
      for (const row of parsed) {
        byId.set(row.photoId.toUpperCase(), row);
      }
      store.batchInputs = Array.from(byId.values());
    }
    saveStore(store);
    res.json({ imported: parsed.length, state: buildWorkbenchState(store) });
  });

  app.post('/api/batch/import-json', (req, res) => {
    const store = ensureStore();
    const { snapshot, mode } = req.body as {
      snapshot?: { batchRows?: Partial<BatchRawInput>[]; batchInputs?: Partial<BatchRawInput>[] } | Array<Partial<BatchRawInput>>;
      mode?: 'append' | 'replace';
    };

    const rawList = Array.isArray(snapshot)
      ? snapshot
      : Array.isArray(snapshot?.batchRows)
        ? snapshot.batchRows
        : Array.isArray(snapshot?.batchInputs)
          ? snapshot.batchInputs
          : null;

    if (!rawList || rawList.length === 0) {
      res.status(400).json({ error: 'JSON file does not contain valid batchRows or batchInputs records.' });
      return;
    }

    const parsed: BatchRawInput[] = rawList
      .filter((r) => r && typeof r.photoId === 'string' && r.photoId.trim() !== '')
      .map((r) => {
        const suggestedGrade = String(r.suggestedGrade || '').trim();
        return {
          photoId: String(r.photoId).trim(),
          filename: String(r.filename || `${String(r.photoId).toLowerCase()}.jpg`).trim(),
          proposedSeries: r.proposedSeries || 'Classic Morgan',
          coinYear: r.coinYear === '' || r.coinYear === undefined ? '' : Number(r.coinYear),
          coinMint: String(r.coinMint || '').trim(),
          proposedVariety: String(r.proposedVariety || '').trim(),
          confidencePct:
            r.confidencePct === '' || r.confidencePct === undefined
              ? ''
              : Math.max(0, Math.min(100, Number(r.confidencePct))),
          suggestedGrade,
          datasetGrade: normalizeDatasetGrade(r.datasetGrade || '', suggestedGrade),
          guideLow: r.guideLow === '' || r.guideLow === undefined ? '' : Number(r.guideLow),
          guideHigh: r.guideHigh === '' || r.guideHigh === undefined ? '' : Number(r.guideHigh),
          userAction: r.userAction || '',
          finalId: String(r.finalId || '').trim(),
          finalValue: r.finalValue === '' || r.finalValue === undefined ? '' : Number(r.finalValue),
          valueSourceAsOf: String(r.valueSourceAsOf || store.settings.priceAsOf),
          diagnosticNotes: String(r.diagnosticNotes || '').trim(),
          status: r.status || '',
          imageDataUrl: typeof r.imageDataUrl === 'string' ? r.imageDataUrl : undefined,
        };
      });

    if (parsed.length === 0) {
      res.status(400).json({ error: 'No valid records with photoId found in JSON snapshot.' });
      return;
    }

    if (mode === 'replace') {
      store.batchInputs = parsed;
    } else {
      const byId = new Map(store.batchInputs.map((r) => [r.photoId.toUpperCase(), r]));
      for (const row of parsed) {
        byId.set(row.photoId.toUpperCase(), row);
      }
      store.batchInputs = Array.from(byId.values());
    }

    saveStore(store);
    res.json({ imported: parsed.length, state: buildWorkbenchState(store) });
  });

  app.put('/api/settings', (req, res) => {
    const store = ensureStore();
    const body = req.body as Partial<WorkbookSettings>;
    const clampPct = (v: unknown, fallback: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : fallback;
    };
    const spot = Number(body.silverSpot);

    store.settings = {
      confidenceThreshold: clampPct(
        body.confidenceThreshold,
        store.settings.confidenceThreshold,
      ),
      highCutoff: clampPct(body.highCutoff, store.settings.highCutoff),
      mediumFloor: clampPct(body.mediumFloor, store.settings.mediumFloor),
      silverSpot: Number.isFinite(spot) && spot > 0 ? Number(spot.toFixed(2)) : store.settings.silverSpot,
      priceAsOf:
        typeof body.priceAsOf === 'string' && body.priceAsOf.trim()
          ? body.priceAsOf.trim()
          : store.settings.priceAsOf,
      autoAccept: false,
    };
    saveStore(store);
    res.json(buildWorkbenchState(store));
  });

  app.post('/api/analyze-coin', async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(503).json({
        error: 'GEMINI_API_KEY is not configured in environment secrets. Enter coin metadata manually.',
      });
      return;
    }

    const { imageBase64, mimeType, filename } = req.body as {
      imageBase64?: string;
      mimeType?: string;
      filename?: string;
    };

    if (!imageBase64 || !mimeType) {
      res.status(400).json({ error: 'imageBase64 and mimeType are required.' });
      return;
    }

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const base64Data = imageBase64.includes(',')
        ? imageBase64.split(',')[1]
        : imageBase64;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
            {
              text: `Analyze this U.S. silver dollar photograph (filename: ${filename || 'coin.jpg'}). Provide a strictly preliminary, advisory numismatic attribution proposal. Identify the most likely series ("Classic Morgan", "2021+ Morgan", "Peace", "American Silver Eagle", or "Other"), 4-digit year, mint mark code ("P", "O", "S", "CC", "D", or "W"), notable variety or privy mark if visible, your honest confidence percentage (0-100; lower if obscured, blurry, or reverse/obverse missing), suggested grade (e.g. G4, F12, AU55, MS63), preliminary low/high retail USD guide range, and brief diagnostic notes.`,
            },
          ],
        },
        config: {
          systemInstruction:
            'You are an assistant numismatist generating strictly advisory preliminary coin proposals. Never invent certainty when a date, mintmark, or reverse is unclear—lower confidencePct below 70 whenever uncertain.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              proposedSeries: {
                type: Type.STRING,
                description:
                  'One of: Classic Morgan, 2021+ Morgan, Peace, American Silver Eagle, Other',
              },
              coinYear: {
                type: Type.INTEGER,
                description: '4-digit mint year',
              },
              coinMint: {
                type: Type.STRING,
                description: 'Mint code such as P, O, S, CC, D, or W',
              },
              proposedVariety: {
                type: Type.STRING,
                description: 'Detected VAM, privy mark, or Standard Strike',
              },
              confidencePct: {
                type: Type.INTEGER,
                description: 'Confidence score from 0 to 100',
              },
              suggestedGrade: {
                type: Type.STRING,
                description: 'Short grade code like G4, F12, MS60, MS63, MS65',
              },
              guideLow: {
                type: Type.NUMBER,
                description: 'Preliminary low USD estimate',
              },
              guideHigh: {
                type: Type.NUMBER,
                description: 'Preliminary high USD estimate',
              },
              diagnosticNotes: {
                type: Type.STRING,
                description: 'Concise visual observations and caveats',
              },
            },
          },
        },
      });

      const text = (response.text ?? '{}').trim();
      const proposal = JSON.parse(text);
      res.json({ proposal });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gemini Vision request failed';
      res.status(502).json({ error: msg });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
