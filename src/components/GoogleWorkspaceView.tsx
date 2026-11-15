import React, { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  HardDrive,
  Image as ImageIcon,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { toBatchCsv } from '../shared/ruleEngine';
import type { BatchRawInput, WorkbenchState } from '../shared/types';
import {
  deleteDriveFile,
  downloadDriveFileText,
  downloadDriveImageAsDataUrl,
  exportWorkbookToNewSpreadsheet,
  getSpreadsheetMetadata,
  listDriveFiles,
  loadGooglePicker,
  openGooglePicker,
  readSheetTabValues,
  sheetValuesToCsv,
  syncBatchLogToExistingSheetTab,
  uploadDriveFile,
  type DriveFileItem,
  type PickedFileItem,
  type SpreadsheetMetadata,
} from '../lib/googleWorkspace';
import { GoogleSignInButton } from './GoogleSignInButton';
import {
  WorkspaceConfirmModal,
  type WorkspaceConfirmRequest,
} from './WorkspaceConfirmModal';

interface GoogleWorkspaceViewProps {
  state: WorkbenchState;
  user: User | null;
  accessToken: string | null;
  needsAuth: boolean;
  isLoggingIn: boolean;
  onLogin: () => Promise<void>;
  onLogout: () => Promise<void>;
  onAuthExpired: () => void;
  handleBulkAddRecords: (items: Array<Partial<BatchRawInput>>) => Promise<void>;
  onImportCsvText: (csvText: string, mode: 'append' | 'replace') => Promise<number>;
  onImportJsonSnapshot: (snapshotText: string) => Promise<number>;
  onOpenBatchLog?: () => void;
  onNotify: (msg: string) => void;
}

const fmtDate = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const isImageFile = (mime: string, name: string) =>
  mime.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif)$/i.test(name);

const isSpreadsheetFile = (mime: string) =>
  mime === 'application/vnd.google-apps.spreadsheet';

const isCsvFile = (mime: string, name: string) =>
  mime === 'text/csv' || /\.csv$/i.test(name);

const isJsonFile = (mime: string, name: string) =>
  mime === 'application/json' || /\.json$/i.test(name);

export const GoogleWorkspaceView: React.FC<GoogleWorkspaceViewProps> = ({
  state,
  user,
  accessToken,
  needsAuth,
  isLoggingIn,
  onLogin,
  onLogout,
  onAuthExpired,
  handleBulkAddRecords,
  onImportCsvText,
  onImportJsonSnapshot,
  onOpenBatchLog,
  onNotify,
}) => {
  const [driveFiles, setDriveFiles] = useState<DriveFileItem[]>([]);
  const [driveFilter, setDriveFilter] = useState<
    'all' | 'images' | 'spreadsheets' | 'data'
  >('all');
  const [driveSearch, setDriveSearch] = useState('');
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastPickedBatch, setLastPickedBatch] = useState<PickedFileItem[]>([]);

  // Drive export state
  const [exportFilename, setExportFilename] = useState(
    `silver_dollar_batch_${state.settings.priceAsOf}`,
  );
  const [overwriteTargetId, setOverwriteTargetId] = useState<string>('');
  const [lastDriveLink, setLastDriveLink] = useState<{
    name: string;
    url: string;
  } | null>(null);

  // Google Sheets state
  const [sheetIdInput, setSheetIdInput] = useState('');
  const [sheetMeta, setSheetMeta] = useState<SpreadsheetMetadata | null>(null);
  const [selectedTabTitle, setSelectedTabTitle] = useState('');
  const [tabPreviewRows, setTabPreviewRows] = useState<string[][]>([]);
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [sheetImportMode, setSheetImportMode] = useState<'append' | 'replace'>('append');
  const [lastSheetUrl, setLastSheetUrl] = useState<{
    title: string;
    url: string;
  } | null>(null);

  // Mandatory explicit confirmation modal state
  const [confirmRequest, setConfirmRequest] =
    useState<WorkspaceConfirmRequest | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const handleApiFailure = useCallback(
    (err: unknown, fallback: string) => {
      const status = (err as { status?: number })?.status;
      if (status === 401) {
        onAuthExpired();
        setErrorMsg('Your Google session expired. Please sign in with Google again.');
        return;
      }
      setErrorMsg(err instanceof Error ? err.message : fallback);
    },
    [onAuthExpired],
  );

  const refreshDriveFiles = useCallback(
    async (token: string) => {
      setLoadingFiles(true);
      setErrorMsg(null);
      try {
        const files = await listDriveFiles(token, driveFilter, driveSearch);
        setDriveFiles(files);
      } catch (err) {
        handleApiFailure(err, 'Failed to load Google Drive files.');
      } finally {
        setLoadingFiles(false);
      }
    },
    [driveFilter, driveSearch, handleApiFailure],
  );

  useEffect(() => {
    if (accessToken && !needsAuth) {
      refreshDriveFiles(accessToken);
    }
  }, [accessToken, needsAuth, refreshDriveFiles]);

  const loadSpreadsheetById = useCallback(
    async (idOrUrl: string) => {
      if (!accessToken || !idOrUrl.trim()) return;
      setLoadingSheet(true);
      setErrorMsg(null);
      try {
        const meta = await getSpreadsheetMetadata(accessToken, idOrUrl);
        setSheetMeta(meta);
        setSheetIdInput(meta.spreadsheetId);
        const firstTab = meta.sheets[0]?.title || '';
        setSelectedTabTitle(firstTab);
        if (firstTab) {
          const values = await readSheetTabValues(
            accessToken,
            meta.spreadsheetId,
            firstTab,
          );
          setTabPreviewRows(values);
        } else {
          setTabPreviewRows([]);
        }
      } catch (err) {
        handleApiFailure(err, 'Unable to load spreadsheet metadata.');
      } finally {
        setLoadingSheet(false);
      }
    },
    [accessToken, handleApiFailure],
  );

  const handleTabSelectionChange = async (newTab: string) => {
    setSelectedTabTitle(newTab);
    if (!accessToken || !sheetMeta || !newTab) return;
    setLoadingSheet(true);
    setErrorMsg(null);
    try {
      const values = await readSheetTabValues(
        accessToken,
        sheetMeta.spreadsheetId,
        newTab,
      );
      setTabPreviewRows(values);
    } catch (err) {
      handleApiFailure(err, `Failed to read tab "${newTab}".`);
    } finally {
      setLoadingSheet(false);
    }
  };

  const processPickedImagesForBatch = useCallback(
    async (selectedDocs: PickedFileItem[]) => {
      if (!accessToken || selectedDocs.length === 0) return;

      setBusyAction(
        `Preparing ${selectedDocs.length} selected Drive image(s) for batch processing...`,
      );
      setErrorMsg(null);
      try {
        const batchItems: Array<Partial<BatchRawInput>> = [];
        for (const doc of selectedDocs) {
          let imageDataUrl: string | undefined;
          try {
            const downloaded = await downloadDriveImageAsDataUrl(
              accessToken,
              doc.id,
              doc.mimeType,
            );
            imageDataUrl = downloaded.dataUrl;
          } catch {
            // Preserve selected file metadata even if binary thumbnail download fails
            imageDataUrl = undefined;
          }

          batchItems.push({
            filename: doc.name,
            proposedSeries: 'Classic Morgan',
            diagnosticNotes: [
              `Google Drive Picker ID: ${doc.id}`,
              doc.mimeType ? `MIME: ${doc.mimeType}` : '',
              doc.url ? `Drive URL: ${doc.url}` : '',
            ]
              .filter(Boolean)
              .join(' · '),
            imageDataUrl,
          });
        }

        await handleBulkAddRecords(batchItems);
        setLastPickedBatch(selectedDocs);
      } catch (err) {
        handleApiFailure(
          err,
          'Failed to queue selected Google Drive images for batch processing.',
        );
      } finally {
        setBusyAction(null);
      }
    },
    [accessToken, handleApiFailure, handleBulkAddRecords],
  );

  const handlePickCoinPhotos = async () => {
    if (!accessToken) return;
    setErrorMsg(null);
    try {
      await loadGooglePicker();
      const pickerNs = window.google?.picker;
      if (!pickerNs) {
        throw new Error('Google Picker API is unavailable.');
      }

      const pickerOrigin =
        window.location.ancestorOrigins &&
        window.location.ancestorOrigins.length > 0
          ? window.location.ancestorOrigins[
              window.location.ancestorOrigins.length - 1
            ]
          : window.location.origin;

      const picker = new pickerNs.PickerBuilder()
        .addView(pickerNs.ViewId.DOCS_IMAGES)
        .enableFeature(pickerNs.Feature.MULTISELECT_ENABLED)
        .setOAuthToken(accessToken)
        .setOrigin(pickerOrigin)
        .setTitle('Select Coin Images from Google Drive for Batch Processing')
        .setCallback((data) => {
          if (data.action === pickerNs.Action.PICKED && Array.isArray(data.docs)) {
            const selectedDocs: PickedFileItem[] = data.docs.map((doc) => ({
              id: doc.id,
              name: doc.name,
              mimeType: doc.mimeType,
              url: doc.url,
            }));
            void processPickedImagesForBatch(selectedDocs);
          }
        })
        .build();

      picker.setVisible(true);
    } catch (err) {
      handleApiFailure(err, 'Failed to open Google Picker for coin images.');
    }
  };

  const handlePickAnyDriveFile = async () => {
    if (!accessToken) return;
    setErrorMsg(null);
    try {
      const picked = await openGooglePicker({
        accessToken,
        mode: 'all',
        multiselect: false,
        title: 'Select Spreadsheet, CSV, JSON, or Coin Photo',
      });
      if (picked.length === 0) return;
      const file = picked[0];

      if (isSpreadsheetFile(file.mimeType)) {
        await loadSpreadsheetById(file.id);
        onNotify(`Loaded Google Sheet "${file.name}"`);
      } else if (isImageFile(file.mimeType, file.name)) {
        await processPickedImagesForBatch([
          {
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            url: file.url,
          },
        ]);
      } else if (isCsvFile(file.mimeType, file.name)) {
        setBusyAction(`Importing ${file.name}...`);
        const text = await downloadDriveFileText(accessToken, file.id);
        const imported = await onImportCsvText(text, 'append');
        onNotify(`Imported ${imported} CSV rows from "${file.name}"`);
      } else if (isJsonFile(file.mimeType, file.name)) {
        setBusyAction(`Restoring ${file.name}...`);
        const text = await downloadDriveFileText(accessToken, file.id);
        const imported = await onImportJsonSnapshot(text);
        onNotify(`Imported ${imported} records from "${file.name}"`);
      } else {
        setErrorMsg(
          `Unsupported file type "${file.mimeType}". Select an image, CSV, JSON, or Google Sheet.`,
        );
      }
    } catch (err) {
      handleApiFailure(err, 'Google Picker selection failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handlePickSpreadsheet = async () => {
    if (!accessToken) return;
    setErrorMsg(null);
    try {
      const picked = await openGooglePicker({
        accessToken,
        mode: 'spreadsheets',
        multiselect: false,
        title: 'Select a Google Spreadsheet',
      });
      if (picked.length === 0) return;
      await loadSpreadsheetById(picked[0].id);
      onNotify(`Loaded Google Sheet "${picked[0].name}"`);
    } catch (err) {
      handleApiFailure(err, 'Failed to pick Google Spreadsheet.');
    }
  };

  const handleImportDriveFile = async (file: DriveFileItem) => {
    if (!accessToken) return;
    setErrorMsg(null);
    try {
      if (isSpreadsheetFile(file.mimeType)) {
        await loadSpreadsheetById(file.id);
        onNotify(`Loaded "${file.name}" in Google Sheets Importer`);
        return;
      }
      if (isImageFile(file.mimeType, file.name)) {
        await processPickedImagesForBatch([
          {
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            url: file.webViewLink,
          },
        ]);
        return;
      }
      if (isCsvFile(file.mimeType, file.name)) {
        setBusyAction(`Importing ${file.name}...`);
        const text = await downloadDriveFileText(accessToken, file.id);
        const count = await onImportCsvText(text, 'append');
        onNotify(`Imported ${count} rows from "${file.name}"`);
        return;
      }
      if (isJsonFile(file.mimeType, file.name)) {
        setBusyAction(`Importing ${file.name}...`);
        const text = await downloadDriveFileText(accessToken, file.id);
        const count = await onImportJsonSnapshot(text);
        onNotify(`Imported ${count} records from "${file.name}"`);
      }
    } catch (err) {
      handleApiFailure(err, `Failed to import "${file.name}".`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveToDrive = async (format: 'csv' | 'json') => {
    if (!accessToken) return;
    const baseName = exportFilename.trim() || `silver_dollar_batch_${state.settings.priceAsOf}`;
    const ext = format === 'csv' ? '.csv' : '.json';
    const fullName = baseName.toLowerCase().endsWith(ext)
      ? baseName
      : `${baseName}${ext}`;
    const mimeType = format === 'csv' ? 'text/csv' : 'application/json';
    const content =
      format === 'csv'
        ? toBatchCsv(state.batchRows)
        : JSON.stringify(state, null, 2);

    const existingTarget = overwriteTargetId
      ? driveFiles.find((f) => f.id === overwriteTargetId)
      : undefined;

    const executeUpload = async () => {
      setBusyAction(`Saving ${fullName} to Google Drive...`);
      setErrorMsg(null);
      try {
        const saved = await uploadDriveFile(accessToken, {
          name: fullName,
          mimeType,
          content,
          existingFileId: existingTarget?.id,
        });
        setLastDriveLink({
          name: saved.name,
          url:
            saved.webViewLink ||
            `https://drive.google.com/file/d/${saved.id}/view`,
        });
        onNotify(
          existingTarget
            ? `Updated "${saved.name}" on Google Drive`
            : `Saved "${saved.name}" to Google Drive`,
        );
        await refreshDriveFiles(accessToken);
      } catch (err) {
        handleApiFailure(err, `Failed to save "${fullName}" to Google Drive.`);
      } finally {
        setBusyAction(null);
      }
    };

    if (existingTarget) {
      setConfirmRequest({
        title: 'Overwrite Existing Google Drive File?',
        description:
          'This will replace the contents of the selected file in your Google Drive with the current workbench export.',
        details: [
          `Target File: ${existingTarget.name}`,
          `Drive File ID: ${existingTarget.id}`,
          `New Format: ${format.toUpperCase()} (${state.batchRows.length} rows)`,
        ],
        confirmLabel: 'Confirm Overwrite',
        tone: 'warning',
        onConfirm: executeUpload,
      });
      return;
    }

    await executeUpload();
  };

  const requestDeleteDriveFile = (file: DriveFileItem) => {
    if (!accessToken) return;
    setConfirmRequest({
      title: 'Delete File from Google Drive?',
      description:
        'Are you sure you want to permanently delete this file from Google Drive? This action cannot be undone.',
      details: [`File: ${file.name}`, `Drive ID: ${file.id}`],
      confirmLabel: 'Delete File',
      tone: 'danger',
      onConfirm: async () => {
        try {
          await deleteDriveFile(accessToken, file.id);
          if (overwriteTargetId === file.id) setOverwriteTargetId('');
          onNotify(`Deleted "${file.name}" from Google Drive`);
          await refreshDriveFiles(accessToken);
        } catch (err) {
          handleApiFailure(err, `Unable to delete "${file.name}".`);
        }
      },
    });
  };

  const handleImportSheetTab = async () => {
    if (!sheetMeta || !selectedTabTitle || tabPreviewRows.length < 2) {
      setErrorMsg('Selected tab must contain a header row and at least one data row.');
      return;
    }
    setBusyAction(`Importing "${selectedTabTitle}"...`);
    setErrorMsg(null);
    try {
      const csvText = sheetValuesToCsv(tabPreviewRows);
      const imported = await onImportCsvText(csvText, sheetImportMode);
      onNotify(
        `Imported ${imported} coin row(s) from "${sheetMeta.title}" → "${selectedTabTitle}"`,
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Failed to import rows from Google Sheet.',
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleExportNewWorkbook = async () => {
    if (!accessToken) return;
    setBusyAction('Creating Silver Dollar Ledger workbook in Google Sheets...');
    setErrorMsg(null);
    try {
      const created = await exportWorkbookToNewSpreadsheet(accessToken, state);
      setLastSheetUrl({ title: created.title, url: created.spreadsheetUrl });
      setSheetMeta(created);
      setSheetIdInput(created.spreadsheetId);
      if (created.sheets[0]?.title) {
        setSelectedTabTitle(created.sheets[0].title);
        const vals = await readSheetTabValues(
          accessToken,
          created.spreadsheetId,
          created.sheets[0].title,
        );
        setTabPreviewRows(vals);
      }
      onNotify(`Exported full workbook "${created.title}" to Google Sheets`);
      await refreshDriveFiles(accessToken);
    } catch (err) {
      handleApiFailure(err, 'Failed to export workbook to Google Sheets.');
    } finally {
      setBusyAction(null);
    }
  };

  const requestSyncExistingSheetTab = () => {
    if (!accessToken || !sheetMeta || !selectedTabTitle) return;
    setConfirmRequest({
      title: 'Overwrite Google Sheet Tab?',
      description:
        'This will clear all existing cells in the selected Google Sheet tab and replace them with the current evaluated Batch Log.',
      details: [
        `Spreadsheet: ${sheetMeta.title}`,
        `Target Tab: ${selectedTabTitle}`,
        `Rows to Write: ${state.batchRows.length} coin records (+ header)`,
      ],
      confirmLabel: 'Confirm Overwrite Tab',
      tone: 'warning',
      onConfirm: async () => {
        try {
          await syncBatchLogToExistingSheetTab(
            accessToken,
            sheetMeta.spreadsheetId,
            selectedTabTitle,
            state.batchRows,
          );
          setLastSheetUrl({
            title: sheetMeta.title,
            url: sheetMeta.spreadsheetUrl,
          });
          const refreshed = await readSheetTabValues(
            accessToken,
            sheetMeta.spreadsheetId,
            selectedTabTitle,
          );
          setTabPreviewRows(refreshed);
          onNotify(
            `Updated "${sheetMeta.title}" → "${selectedTabTitle}" (${state.batchRows.length} rows)`,
          );
        } catch (err) {
          handleApiFailure(err, `Failed to update tab "${selectedTabTitle}".`);
        }
      },
    });
  };

  const handleConfirmModalSubmit = async () => {
    if (!confirmRequest) return;
    setConfirmBusy(true);
    try {
      await confirmRequest.onConfirm();
      setConfirmRequest(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  if (needsAuth || !accessToken) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="border border-slate-200 bg-white rounded-lg p-8 space-y-6">
          <div className="flex items-start gap-4">
            <div className="w-11 h-11 rounded-lg bg-[#1E3A5F]/10 text-[#1E3A5F] flex items-center justify-center shrink-0">
              <HardDrive className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-xl font-bold text-slate-900">
                Connect Google Drive, Picker &amp; Google Sheets
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                Sign in with your Google account to browse coin photographs with Google Picker,
                import or back up CSV &amp; JSON appraisal batches on Google Drive, and sync your
                audited Silver Dollar Ledger workbook with Google Sheets.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="border border-slate-200 rounded-md p-3.5 bg-slate-50/70 space-y-1">
              <div className="font-semibold text-slate-900">Google Picker</div>
              <p className="text-slate-600">
                Select coin images, CSVs, or spreadsheets directly from your Drive folders.
              </p>
            </div>
            <div className="border border-slate-200 rounded-md p-3.5 bg-slate-50/70 space-y-1">
              <div className="font-semibold text-slate-900">Google Drive Sync</div>
              <p className="text-slate-600">
                Save evaluated Batch Log CSVs and full JSON workbench snapshots to Drive.
              </p>
            </div>
            <div className="border border-slate-200 rounded-md p-3.5 bg-slate-50/70 space-y-1">
              <div className="font-semibold text-slate-900">Google Sheets</div>
              <p className="text-slate-600">
                Import coin batches from any sheet tab or export all 6 audited workbook tabs.
              </p>
            </div>
          </div>

          {errorMsg && (
            <div className="border border-red-200 bg-red-50 rounded-md px-4 py-2.5 text-sm text-red-900 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="pt-1 flex flex-wrap items-center gap-4">
            <GoogleSignInButton onClick={onLogin} loading={isLoggingIn} />
            <span className="text-xs text-slate-500">
              Tokens are kept in memory only and cleared when you sign out.
            </span>
          </div>
        </div>
      </div>
    );
  }

  const spreadsheetFiles = driveFiles.filter((f) => isSpreadsheetFile(f.mimeType));
  const dataFiles = driveFiles.filter(
    (f) => isCsvFile(f.mimeType, f.name) || isJsonFile(f.mimeType, f.name),
  );

  return (
    <div className="space-y-6">
      {/* Account Status Bar */}
      <div className="border border-slate-200 bg-white rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900 truncate">
              {user?.displayName || 'Google Account Connected'}
            </div>
            <div className="text-xs text-slate-500 font-mono truncate">
              {user?.email || 'Drive, Picker & Sheets active'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {busyAction && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1E3A5F] mr-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {busyAction}
            </span>
          )}
          <button
            type="button"
            onClick={() => refreshDriveFiles(accessToken)}
            disabled={loadingFiles}
            className="px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-300 bg-white hover:bg-slate-50 rounded-md inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingFiles ? 'animate-spin' : ''}`} />
            Refresh Drive
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-300 bg-white hover:bg-slate-50 rounded-md inline-flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="border border-red-200 bg-red-50 rounded-lg px-4 py-3 text-sm text-red-900 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-xs font-semibold text-red-800 hover:underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {lastPickedBatch.length > 0 && (
        <div className="border border-emerald-200 bg-emerald-50 rounded-lg px-4 py-3 text-xs text-emerald-900 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span className="truncate">
              Queued <strong className="font-mono">{lastPickedBatch.length}</strong>{' '}
              Google Drive {lastPickedBatch.length === 1 ? 'image' : 'images'} for batch processing:{' '}
              <span className="font-mono">
                {lastPickedBatch.map((f) => f.name).join(', ')}
              </span>
            </span>
          </div>
          {onOpenBatchLog && (
            <button
              type="button"
              onClick={onOpenBatchLog}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-md shrink-0 cursor-pointer"
            >
              Open Batch Log
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left Column: Google Drive + Google Picker + Backups */}
        <div className="xl:col-span-6 space-y-6">
          {/* Drive Export & Backup Card */}
          <div className="border border-slate-200 bg-white rounded-lg p-5 space-y-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Save Appraisal Backups to Google Drive
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                Export the evaluated Batch Log ({state.batchRows.length} rows) as CSV or a full JSON snapshot to your Google Drive.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Drive Filename
                </label>
                <input
                  type="text"
                  value={exportFilename}
                  onChange={(e) => setExportFilename(e.target.value)}
                  placeholder="silver_dollar_batch"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Destination Mode
                </label>
                <select
                  value={overwriteTargetId}
                  onChange={(e) => setOverwriteTargetId(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                >
                  <option value="">Create new file in Drive</option>
                  {dataFiles.map((f) => (
                    <option key={f.id} value={f.id}>
                      Overwrite: {f.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => handleSaveToDrive('csv')}
                disabled={Boolean(busyAction)}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-md inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                Save Batch CSV to Drive
              </button>

              <button
                type="button"
                onClick={() => handleSaveToDrive('json')}
                disabled={Boolean(busyAction)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 border border-slate-300 bg-white hover:bg-slate-50 rounded-md inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                Save JSON Snapshot to Drive
              </button>

              {lastDriveLink && (
                <a
                  href={lastDriveLink.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-[#1E3A5F] hover:underline inline-flex items-center gap-1 ml-auto"
                >
                  Open {lastDriveLink.name}
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </div>

          {/* Google Picker & Drive File Browser */}
          <div className="border border-slate-200 bg-white rounded-lg overflow-hidden">
            <div className="p-5 border-b border-slate-200 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    Google Picker &amp; Drive Browser
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Pick coin photographs, CSV batches, or JSON snapshots from Google Drive.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePickCoinPhotos}
                    disabled={Boolean(busyAction)}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-md inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    Pick Coin Photos
                  </button>
                  <button
                    type="button"
                    onClick={handlePickAnyDriveFile}
                    disabled={Boolean(busyAction)}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-300 bg-white hover:bg-slate-50 rounded-md inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    Open Picker
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={driveSearch}
                    onChange={(e) => setDriveSearch(e.target.value)}
                    placeholder="Filter Drive files by name..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                  />
                </div>

                <select
                  value={driveFilter}
                  onChange={(e) =>
                    setDriveFilter(
                      e.target.value as 'all' | 'images' | 'spreadsheets' | 'data',
                    )
                  }
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                >
                  <option value="all">All Supported</option>
                  <option value="images">Coin Images</option>
                  <option value="spreadsheets">Spreadsheets</option>
                  <option value="data">CSV &amp; JSON</option>
                </select>
              </div>
            </div>

            <div className="divide-y divide-slate-100 max-h-[380px] overflow-y-auto">
              {loadingFiles ? (
                <div className="p-6 text-center text-xs text-slate-500 inline-flex items-center justify-center gap-2 w-full">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading Google Drive files...
                </div>
              ) : driveFiles.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  No matching coin images, spreadsheets, CSVs, or JSON files found in Google Drive.
                </div>
              ) : (
                driveFiles.map((file) => {
                  const isImg = isImageFile(file.mimeType, file.name);
                  const isSheet = isSpreadsheetFile(file.mimeType);
                  return (
                    <div
                      key={file.id}
                      className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/70"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded border border-slate-200 bg-slate-50 flex items-center justify-center shrink-0 text-slate-600">
                          {isImg ? (
                            <ImageIcon className="w-4 h-4" />
                          ) : isSheet ? (
                            <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                          ) : (
                            <FileText className="w-4 h-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div
                            className="text-xs font-semibold text-slate-900 truncate"
                            title={file.name}
                          >
                            {file.name}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono truncate">
                            {isSheet
                              ? 'Google Sheet'
                              : isImg
                                ? 'Image'
                                : isCsvFile(file.mimeType, file.name)
                                  ? 'CSV'
                                  : 'JSON'}{' '}
                            · Modified {fmtDate(file.modifiedTime)}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleImportDriveFile(file)}
                          disabled={Boolean(busyAction)}
                          className="px-2.5 py-1 text-xs font-semibold text-[#1E3A5F] border border-[#1E3A5F]/30 bg-white hover:bg-slate-100 rounded cursor-pointer disabled:opacity-50"
                        >
                          {isSheet ? 'Open' : isImg ? 'Import Photo' : 'Import'}
                        </button>
                        <button
                          type="button"
                          onClick={() => requestDeleteDriveFile(file)}
                          disabled={Boolean(busyAction)}
                          title={`Delete ${file.name} from Google Drive`}
                          className="p-1.5 text-slate-400 hover:text-red-700 rounded cursor-pointer disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Google Sheets Workbook Importer & Sync */}
        <div className="xl:col-span-6 space-y-6">
          {/* Export New Multi-Tab Workbook */}
          <div className="border border-slate-200 bg-white rounded-lg p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Export Audited Workbook to Google Sheets
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Creates a 6-tab Google Spreadsheet with Portfolio Summary, Batch_Log, Review_Queue, Price_Data, Variety_Reference, and Settings.
                </p>
              </div>
              <button
                type="button"
                onClick={handleExportNewWorkbook}
                disabled={Boolean(busyAction)}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-md inline-flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Export New Google Sheet
              </button>
            </div>

            {lastSheetUrl && (
              <div className="border border-emerald-200 bg-emerald-50 rounded-md px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-emerald-900 truncate">
                  Synced: {lastSheetUrl.title}
                </span>
                <a
                  href={lastSheetUrl.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-emerald-800 hover:underline inline-flex items-center gap-1 shrink-0"
                >
                  Open in Google Sheets
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}
          </div>

          {/* Open, Preview & Sync Existing Google Sheet */}
          <div className="border border-slate-200 bg-white rounded-lg p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Import from or Sync to Existing Google Sheet
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Select a spreadsheet tab by its actual title from spreadsheet metadata.
                </p>
              </div>

              <button
                type="button"
                onClick={handlePickSpreadsheet}
                disabled={Boolean(busyAction)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-300 bg-white hover:bg-slate-50 rounded-md inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Pick Spreadsheet
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={sheetIdInput}
                onChange={(e) => setSheetIdInput(e.target.value)}
                placeholder="Paste Google Sheets URL or Spreadsheet ID..."
                className="flex-1 min-w-[200px] px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
              />
              <button
                type="button"
                onClick={() => loadSpreadsheetById(sheetIdInput)}
                disabled={!sheetIdInput.trim() || loadingSheet}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-md disabled:opacity-45 cursor-pointer"
              >
                {loadingSheet ? 'Loading...' : 'Load Tabs'}
              </button>
            </div>

            {spreadsheetFiles.length > 0 && (
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Or pick from your recent Drive Spreadsheets:
                </label>
                <select
                  value={sheetMeta?.spreadsheetId || ''}
                  onChange={(e) => {
                    if (e.target.value) loadSpreadsheetById(e.target.value);
                  }}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
                >
                  <option value="">Choose a spreadsheet...</option>
                  {spreadsheetFiles.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {sheetMeta && (
              <div className="border-t border-slate-200 pt-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-900">
                      {sheetMeta.title}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500">
                      {sheetMeta.sheets.length} tab(s) detected
                    </div>
                  </div>
                  <a
                    href={sheetMeta.spreadsheetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-semibold text-[#1E3A5F] hover:underline inline-flex items-center gap-1"
                  >
                    Open Sheet
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Worksheet Tab
                    </label>
                    <select
                      value={selectedTabTitle}
                      onChange={(e) => handleTabSelectionChange(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
                    >
                      {sheetMeta.sheets.map((tab) => (
                        <option key={tab.sheetId} value={tab.title}>
                          {tab.title}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Import Mode
                    </label>
                    <select
                      value={sheetImportMode}
                      onChange={(e) =>
                        setSheetImportMode(e.target.value as 'append' | 'replace')
                      }
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
                    >
                      <option value="append">Append / Merge by Photo_ID</option>
                      <option value="replace">Replace current Batch Log</option>
                    </select>
                  </div>
                </div>

                {/* Live Tab Preview */}
                <div className="border border-slate-200 rounded-md overflow-hidden">
                  <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 flex justify-between">
                    <span>Preview: {selectedTabTitle || 'Tab'}</span>
                    <span className="font-mono tabular-nums">
                      {tabPreviewRows.length} row(s)
                    </span>
                  </div>
                  {tabPreviewRows.length === 0 ? (
                    <div className="p-4 text-xs text-slate-500 text-center">
                      This worksheet tab is currently empty.
                    </div>
                  ) : (
                    <div className="overflow-x-auto max-h-48">
                      <table className="w-full text-left border-collapse text-[11px]">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            {tabPreviewRows[0].slice(0, 8).map((col, idx) => (
                              <th
                                key={idx}
                                className="py-1.5 px-2.5 font-semibold text-slate-700 whitespace-nowrap"
                              >
                                {col || `Col ${idx + 1}`}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {tabPreviewRows.slice(1, 6).map((row, rIdx) => (
                            <tr key={rIdx}>
                              {tabPreviewRows[0].slice(0, 8).map((_, cIdx) => (
                                <td
                                  key={cIdx}
                                  className="py-1.5 px-2.5 text-slate-700 whitespace-nowrap max-w-[140px] truncate"
                                >
                                  {row[cIdx] ?? ''}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleImportSheetTab}
                    disabled={
                      tabPreviewRows.length < 2 || Boolean(busyAction) || loadingSheet
                    }
                    className="px-3.5 py-2 text-xs font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-md disabled:opacity-45 cursor-pointer"
                  >
                    Import Tab into Batch Log
                  </button>

                  <button
                    type="button"
                    onClick={requestSyncExistingSheetTab}
                    disabled={!selectedTabTitle || Boolean(busyAction) || loadingSheet}
                    className="px-3.5 py-2 text-xs font-semibold text-amber-900 border border-amber-300 bg-amber-50 hover:bg-amber-100 rounded-md disabled:opacity-45 cursor-pointer"
                  >
                    Overwrite Tab with Batch Log
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <WorkspaceConfirmModal
        request={confirmRequest}
        busy={confirmBusy}
        onCancel={() => !confirmBusy && setConfirmRequest(null)}
        onConfirm={handleConfirmModalSubmit}
      />
    </div>
  );
};
