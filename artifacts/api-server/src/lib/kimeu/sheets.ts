import { ReplitConnectors, type ProxyOptions } from "@replit/connectors-sdk";
import { resolveSheetConfiguration } from "./sheet-configuration";

export { MASTER_SHEET_ID } from "./sheet-configuration";
export const NOTE_VISIBILITY_HEADER = "Visibility";
export const APP_TIME_ZONE = "America/Los_Angeles";

const READ_CACHE_MS = 30_000;
const ALLOWED_TABS = new Set([
  "03a-KIMEU Workshops",
  "03b-Advanced Workshop Log",
  "03c-Foundations Tracker",
  "03d-Fellowship Review Log",
  "03e-KIMEU Prior Status",
  "03f-Session Log",
  "03g-Clinician Notes",
  "03h-App Users",
  "03i-RD Onboarding",
]);
const WRITE_ALLOWLIST: Record<string, ReadonlySet<string>> = {
  "03h-App Users": new Set(["App Role(s)", "Workshop IDs"]),
  "03i-RD Onboarding": new Set([
    "Record ID", "PT Email", "Workshop ID", "Week", "Session Date", "Minutes",
    "Attended", "RD Result", "Signed By", "Signed At", "Notes", "Last Updated By", "Last Updated",
  ]),
  "03b-Advanced Workshop Log": new Set([
    "PT Email",
    "PT Name",
    "Workshop ID",
    "Session Date",
    "Attended",
    "Attendance Confirmed By",
    "Practical Date",
    "Practical Result",
    "Practical Scored By (RD)",
    "Last Updated By",
    "Last Updated",
  ]),
  "03c-Foundations Tracker": new Set([
    "PT Email",
    "Session Date",
    "Attended (SME)",
    "Practical Date",
    "Practical Result",
    "Last Updated By",
    "Last Updated",
  ]),
  "03f-Session Log": new Set([
    "Session ID",
    "Workshop ID",
    "Session Date",
    "Lead SME",
    "Session Status",
    "Session Notes",
    "Changes for Next Session",
    "Last Updated By",
    "Last Updated",
  ]),
  "03g-Clinician Notes": new Set([
    "Note ID",
    "Created",
    "PT Email",
    "Note Type",
    "Workshop ID",
    "Session ID",
    "Review ID",
    "Note",
    "Follow-up Needed",
    "Follow-up Due",
    "Follow-up Done",
    "Author",
    "Author Role",
    NOTE_VISIBILITY_HEADER,
  ]),
};

export class KimeuError extends Error {
  constructor(
    message: string,
    readonly status = 500,
    readonly code = "KIMEU_ERROR",
  ) {
    super(message);
    this.name = "KimeuError";
  }
}

export type CellValue = string | number | boolean;
function safeInputValue(value: CellValue): CellValue {
  return typeof value === "string" && /^[=+@-]/.test(value.trimStart())
    ? `'${value}`
    : value;
}
export type SheetSnapshot = {
  rows: string[][];
  headerRow: number;
  dataStartRow: number;
};
type CachedSnapshot = { expiresAt: number; value: SheetSnapshot };

const snapshotCache = new Map<string, CachedSnapshot>();
let sheetsConnector: ReplitConnectors | undefined;
let practicalWriteTail: Promise<void> = Promise.resolve();

// Serialize practical/history read-modify-writes within this server process.
export async function withPracticalWriteLock<T>(action: () => Promise<T>): Promise<T> {
  const previous = practicalWriteTail;
  let release!: () => void;
  practicalWriteTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try { return await action(); } finally { release(); }
}

function configuration() {
  return resolveSheetConfiguration(process.env.KIMEU_SHEET_ID, process.env.KIMEU_ENABLE_LIVE_WRITES);
}

export function getBasicReadiness() {
  const config = configuration();
  return {
    configured: config.configured,
    trackingMode: config.trackingMode,
    sheetId: null as string | null,
    notePrivacyReady: false,
    writeEnabled: config.configured,
    missing: config.missing,
  };
}

export function getSheetIdForAdmin(): string | null {
  const config = configuration();
  return config.configured ? config.sheetId : null;
}

function getSheetId(): string {
  const config = configuration();
  if (!config.configured) {
    throw new KimeuError(
      "Google Sheets tracking is not configured or live writes have not been approved.",
      503,
      "SHEET_NOT_CONFIGURED",
    );
  }
  return config.sheetId;
}

async function requestSheets<T>(
  suffix: string,
  options: ProxyOptions = {},
): Promise<T> {
  // The connector manages OAuth and refresh. No service-account JSON is needed.
  const sheetId = getSheetId();
  sheetsConnector ??= new ReplitConnectors();
  const path = `/v4/spreadsheets/${encodeURIComponent(sheetId)}${suffix}`;
  let response = await sheetsConnector.proxy("google-sheet", path, options);
  // A 429 rejects the whole Sheets request. Retry only that explicit rejection,
  // never an ambiguous write timeout or 5xx that might already have committed.
  for (let attempt = 0; response.status === 429 && attempt < 2; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    response = await sheetsConnector.proxy("google-sheet", path, options);
  }
  if (!response.ok) {
    throw new KimeuError(
      response.status === 429
        ? "Google Sheets is temporarily rate-limited. The result could not be confirmed; retry shortly."
        : response.status === 401 || response.status === 403
        ? "The Google Sheets connection needs access to the configured spreadsheet. Check the connected Google account's permissions."
        : response.status === 404
          ? "The configured spreadsheet could not be found by the connected Google account."
          : "Google Sheets could not complete the request. Please retry.",
      503,
      response.status === 429
        ? "SHEET_RATE_LIMITED"
        : response.status === 401 || response.status === 403
        ? "SHEET_ACCESS_DENIED"
        : "SHEET_REQUEST_FAILED",
    );
  }
  return await response.json() as T;
}

async function batchWriteValues(
  data: Array<{ range: string; values: CellValue[][] }>,
): Promise<void> {
  await requestSheets("/values:batchUpdate", {
    method: "POST",
    body: { valueInputOption: "USER_ENTERED", data },
  });
}

export function quoteSheetName(name: string): string {
  if (!ALLOWED_TABS.has(name)) {
    throw new KimeuError("Unsupported KIMEU sheet tab.", 400, "INVALID_TAB");
  }
  return `'${name.replaceAll("'", "''")}'`;
}

export function columnLetter(index: number): string {
  let current = index + 1;
  let result = "";
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

export function headerIndex(headers: string[], name: string): number {
  const index = headers.findIndex((header) => header.trim() === name);
  if (index < 0) {
    throw new KimeuError(
      `Required sheet header is missing: ${name}. No write was made.`,
      409,
      "SHEET_HEADER_MISSING",
    );
  }
  return index;
}

export async function readTab(
  name: string,
  options: { force?: boolean; headerRow?: number; dataStartRow?: number } = {},
): Promise<SheetSnapshot> {
  quoteSheetName(name);
  const headerRow = options.headerRow ?? 2;
  const dataStartRow = options.dataStartRow ?? 3;
  const cacheKey = `${getSheetId()}:${name}:${headerRow}:${dataStartRow}`;
  const cached = snapshotCache.get(cacheKey);
  if (!options.force && cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  try {
    const query = new URLSearchParams({
      valueRenderOption: "FORMATTED_VALUE",
      majorDimension: "ROWS",
    });
    const range = encodeURIComponent(`${quoteSheetName(name)}!A1:ZZ`);
    const response = await requestSheets<{
      values?: Array<Array<string | number | boolean | null>>;
    }>(`/values/${range}?${query}`);
    const rows = (response.values ?? []).map((row) =>
      row.map((value) => (value == null ? "" : String(value))),
    );
    if (!rows[headerRow - 1]?.length) {
      throw new KimeuError(
        `Header row ${headerRow} is missing in ${name}.`,
        409,
        "SHEET_HEADER_ROW_MISSING",
      );
    }
    const value = { rows, headerRow, dataStartRow };
    snapshotCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + READ_CACHE_MS,
    });
    return value;
  } catch (error) {
    if (error instanceof KimeuError) throw error;
    throw new KimeuError(
      "The configured spreadsheet could not be read through the Google Sheets connection.",
      503,
      "SHEET_READ_FAILED",
    );
  }
}

export function headersFor(snapshot: SheetSnapshot): string[] {
  return snapshot.rows[snapshot.headerRow - 1] ?? [];
}

export function cell(
  row: string[] | undefined,
  index: number,
): string {
  return row?.[index]?.trim() ?? "";
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeChoice(value: string): string {
  return value.trim().toLowerCase();
}

export function formatSheetDate(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const usDate = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usDate) {
    return `${usDate[3]}-${usDate[1].padStart(2, "0")}-${usDate[2].padStart(2, "0")}`;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function todayInAppTimeZone(): string {
  return formatSheetDate(new Date().toISOString());
}

export function formatSheetTimestamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

export function sessionIdFor(workshopId: string, sessionDate: string): string {
  return `${workshopId}-${sessionDate.replaceAll("-", "")}`;
}

export function dataRows(snapshot: SheetSnapshot): Array<{
  rowNumber: number;
  values: string[];
}> {
  return snapshot.rows
    .map((values, index) => ({ rowNumber: index + 1, values }))
    .filter((row) => row.rowNumber >= snapshot.dataStartRow);
}

export function findRowByColumnValue(
  snapshot: SheetSnapshot,
  header: string,
  value: string,
  options: { force?: boolean } = {},
): { rowNumber: number; values: string[] } {
  const index = headerIndex(headersFor(snapshot), header);
  const matches = dataRows(snapshot).filter(
    (row) => cell(row.values, index) === value,
  );
  if (matches.length !== 1) {
    throw new KimeuError(
      matches.length === 0
        ? `No matching row was found for ${header}.`
        : `More than one row matches ${header}; no write was made.`,
      matches.length === 0 ? 404 : 409,
      matches.length === 0 ? "SHEET_ROW_NOT_FOUND" : "SHEET_ROW_AMBIGUOUS",
    );
  }
  return matches[0];
}

export async function writeInputCells(
  tabName: string,
  updates: Array<{ rowNumber: number; header: string; value: CellValue }>,
): Promise<void> {
  if (updates.length === 0) return;
  const snapshot = await readTab(tabName, { force: true });
  const headers = headersFor(snapshot);
  const data = updates.map((update) => {
    assertInputHeader(tabName, update.header);
    const column = headerIndex(headers, update.header);
    return {
      range: `${quoteSheetName(tabName)}!${columnLetter(column)}${update.rowNumber}`,
      values: [[safeInputValue(update.value)]],
    };
  });
  try {
    await batchWriteValues(data);
    invalidateTab(tabName);
  } catch (error) {
    if (error instanceof KimeuError) throw error;
    throw new KimeuError(
      "Google Sheets rejected the requested input-cell update.",
      503,
      "SHEET_WRITE_FAILED",
    );
  }
}

export async function writeInputCellsAtColumns(
  tabName: string,
  updates: Array<{
    rowNumber: number;
    columnIndex: number;
    header: string;
    value: CellValue;
  }>,
): Promise<void> {
  if (updates.length === 0) return;
  const snapshot = await readTab(tabName, { force: true });
  const headers = headersFor(snapshot);
  const data = updates.map((update) => {
    assertInputHeader(tabName, update.header);
    if (headers[update.columnIndex]?.trim() !== update.header) {
      throw new KimeuError(
        `The sheet header changed before the write. Expected ${update.header}.`,
        409,
        "SHEET_HEADER_CHANGED",
      );
    }
    return {
      range: `${quoteSheetName(tabName)}!${columnLetter(update.columnIndex)}${update.rowNumber}`,
      values: [[safeInputValue(update.value)]],
    };
  });
  try {
    await batchWriteValues(data);
    invalidateTab(tabName);
  } catch (error) {
    if (error instanceof KimeuError) throw error;
    throw new KimeuError(
      "Google Sheets rejected the requested input-cell update.",
      503,
      "SHEET_WRITE_FAILED",
    );
  }
}

export async function writeMultipleInputCells(
  updates: Array<{
    tabName: string;
    rowNumber: number;
    header: string;
    value: CellValue;
    columnIndex?: number;
  }>,
): Promise<void> {
  if (updates.length === 0) return;
  const snapshots = new Map<string, SheetSnapshot>();
  for (const tabName of new Set(updates.map((item) => item.tabName))) {
    snapshots.set(tabName, await readTab(tabName, { force: true }));
  }
  const data = updates.map((update) => {
    assertInputHeader(update.tabName, update.header);
    const snapshot = snapshots.get(update.tabName);
    if (!snapshot) {
      throw new KimeuError("Sheet metadata is unavailable.", 503, "SHEET_READ_FAILED");
    }
    const headers = headersFor(snapshot);
    const column =
      update.columnIndex === undefined
        ? headerIndex(headers, update.header)
        : update.columnIndex;
    if (headers[column]?.trim() !== update.header) {
      throw new KimeuError(
        `The sheet header changed before the write. Expected ${update.header}.`,
        409,
        "SHEET_HEADER_CHANGED",
      );
    }
    return {
      range: `${quoteSheetName(update.tabName)}!${columnLetter(column)}${update.rowNumber}`,
      values: [[safeInputValue(update.value)]],
    };
  });
  try {
    await batchWriteValues(data);
    for (const tabName of new Set(updates.map((item) => item.tabName))) {
      invalidateTab(tabName);
    }
  } catch {
    throw new KimeuError(
      "Google Sheets rejected the requested input-cell updates.",
      503,
      "SHEET_WRITE_FAILED",
    );
  }
}

function assertInputHeader(tabName: string, header: string): void {
  if (!WRITE_ALLOWLIST[tabName]?.has(header)) {
    throw new KimeuError(
      `Writing to ${tabName}.${header} is not allowed by the KIMEU sheet map.`,
      409,
      "SHEET_WRITE_NOT_ALLOWED",
    );
  }
}

// New clinician rows need the sheet's own relative formulas. Copy only formula
// cells into NEW rows; never overwrite an existing record or use app formulas.
export async function prepareTrackingTemplateRows(tabName: string, firstRow: number, count: number): Promise<void> {
  if (!["03b-Advanced Workshop Log", "03c-Foundations Tracker"].includes(tabName) ||
      !Number.isInteger(firstRow) || firstRow < 5 || !Number.isInteger(count) || count < 1) {
    throw new KimeuError("Invalid new tracking row request.", 400, "INVALID_TEMPLATE_REQUEST");
  }
  const current = await readTab(tabName, { force: true });
  if (firstRow <= current.rows.length) {
    throw new KimeuError("New template rows cannot replace existing rows.", 409, "TEMPLATE_ROW_OCCUPIED");
  }
  const metadata = await requestSheets<{
    sheets: Array<{ properties: { sheetId: number; title: string; gridProperties: { rowCount: number; columnCount: number } } }>;
  }>("?fields=sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))");
  const properties = metadata.sheets.find(s => s.properties.title === tabName)?.properties;
  if (!properties) throw new KimeuError("The tracking tab could not be found.", 409, "SHEET_TAB_MISSING");
  const template = await requestSheets<{ values?: string[][] }>(
    `/values/${encodeURIComponent(`${quoteSheetName(tabName)}!A4:ZZ4`)}?valueRenderOption=FORMULA`);
  const formulas = (template.values?.[0] ?? []).flatMap((value, column) =>
    String(value).startsWith("=") ? [{ column, formula: String(value) }] : []);
  if (!formulas.length || formulas.some(f => /\bARRAYFORMULA\s*\(/i.test(f.formula))) {
    throw new KimeuError("A director must prepare the tracking template before adding PTs. No formulas were changed.", 409, "TEMPLATE_REVIEW_REQUIRED");
  }
  const sheetId = properties.sheetId;
  const requests: unknown[] = [];
  const requiredRows = firstRow + count - 1;
  if (properties.gridProperties.rowCount < requiredRows) {
    requests.push({ appendDimension: { sheetId, dimension: "ROWS", length: requiredRows - properties.gridProperties.rowCount } });
  }
  for (const { column } of formulas) requests.push({
    copyPaste: {
      source: { sheetId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: column, endColumnIndex: column + 1 },
      destination: { sheetId, startRowIndex: firstRow - 1, endRowIndex: firstRow - 1 + count, startColumnIndex: column, endColumnIndex: column + 1 },
      pasteType: "PASTE_FORMULA",
    },
  });
  await requestSheets(":batchUpdate", { method: "POST", body: { requests } });
  invalidateTab(tabName);
}

export async function appendSparseInputRow(
  tabName: string,
  updates: Array<{ header: string; value: CellValue }>,
  options: {
    headerRow?: number; dataStartRow?: number; autoHeaders?: string[];
    additionalWrites?: Array<{ tabName: string; rowNumber: number; columnIndex: number; header: string; value: CellValue }>;
  } = {},
): Promise<number> {
  const snapshot = await readTab(tabName, {
    force: true,
    headerRow: options.headerRow ?? 2,
    dataStartRow: options.dataStartRow ?? 3,
  });
  const headers = headersFor(snapshot);
  const autoHeaders = new Set(options.autoHeaders ?? []);
  const inputIndices = headers
    .map((header, index) => ({ header: header.trim(), index }))
    .filter(({ header }) => header && !autoHeaders.has(header))
    .map(({ index }) => index);
  let lastInputRow = snapshot.dataStartRow - 1;
  for (const row of dataRows(snapshot)) {
    if (inputIndices.some((index) => cell(row.values, index) !== "")) {
      lastInputRow = row.rowNumber;
    }
  }
  const rowNumber = Math.max(snapshot.dataStartRow, lastInputRow + 1);
  const data = updates.map((update) => {
    assertInputHeader(tabName, update.header);
    const column = headerIndex(headers, update.header);
    if (autoHeaders.has(update.header)) {
      throw new KimeuError(
        `Refusing to write to formula column ${update.header}.`,
        409,
        "AUTO_COLUMN_WRITE_BLOCKED",
      );
    }
    return {
      range: `${quoteSheetName(tabName)}!${columnLetter(column)}${rowNumber}`,
      values: [[safeInputValue(update.value)]],
    };
  });
  // Couple sign-off input cells and their append-only audit note in one atomic
  // Sheets values batch. No formula or existing note cell is overwritten.
  const extraSnapshots = new Map<string, SheetSnapshot>();
  for (const extra of options.additionalWrites ?? []) {
    assertInputHeader(extra.tabName, extra.header);
    if (!extraSnapshots.has(extra.tabName)) {
      extraSnapshots.set(extra.tabName, await readTab(extra.tabName, { force: true }));
    }
    const extraHeaders = headersFor(extraSnapshots.get(extra.tabName)!);
    if (extraHeaders[extra.columnIndex]?.trim() !== extra.header) {
      throw new KimeuError("The practical sheet headers changed. Reload before saving.", 409, "SHEET_HEADER_CHANGED");
    }
    data.push({
      range: `${quoteSheetName(extra.tabName)}!${columnLetter(extra.columnIndex)}${extra.rowNumber}`,
      values: [[safeInputValue(extra.value)]],
    });
  }
  try {
    await batchWriteValues(data);
    invalidateTab(tabName);
    for (const extra of options.additionalWrites ?? []) invalidateTab(extra.tabName);
    return rowNumber;
  } catch (error) {
    if (error instanceof KimeuError) throw error;
    throw new KimeuError(
      "Google Sheets rejected the new row. No previous rows were changed.",
      503,
      "SHEET_APPEND_FAILED",
    );
  }
}

export function invalidateTab(name: string): void {
  for (const key of snapshotCache.keys()) {
    if (key.includes(`:${name}:`)) snapshotCache.delete(key);
  }
}

export async function testCopyReadiness() {
  const basic = getBasicReadiness();
  let notePrivacyReady = false;
  const missing = [...basic.missing];
  if (!basic.configured) {
    return { ...basic, missing };
  }
  try {
    const [users, sessions, advanced, foundations, notes] = await Promise.all([
      readTab("03h-App Users", { force: true }),
      readTab("03f-Session Log", { force: true }),
      readTab("03b-Advanced Workshop Log", { force: true, dataStartRow: 4 }),
      readTab("03c-Foundations Tracker", { force: true, dataStartRow: 4 }),
      readTab("03g-Clinician Notes", { force: true }),
    ]);
    const required: Array<[string, SheetSnapshot, string[]]> = [
      ["03h-App Users", users, ["Email", "Name in Sheets", "App Role(s)", "Workshop IDs", "Active"]],
      ["03f-Session Log", sessions, ["Session ID", "Workshop ID", "Session Date", "Session Status", "Session Notes", "Changes for Next Session", "Lead SME", "Last Updated By", "Last Updated"]],
      ["03b-Advanced Workshop Log", advanced, ["PT Email", "PT Name", "Workshop ID", "Session Date", "Attended", "Attendance Confirmed By", "Workshop Status", "Last Updated By", "Last Updated"]],
      ["03c-Foundations Tracker", foundations, ["PT Email", "PT Name", "Last Updated By", "Last Updated"]],
    ];
    for (const [tab, snapshot, requiredHeaders] of required) {
      const headers = headersFor(snapshot);
      for (const header of requiredHeaders) {
        if (!headers.includes(header)) missing.push(`${tab}: ${header}`);
      }
    }
    notePrivacyReady = headersFor(notes).includes(NOTE_VISIBILITY_HEADER);
    if (!notePrivacyReady) {
      missing.push("03g-Clinician Notes: Visibility (needed to protect private notes)");
    }
    return {
      configured: missing.every(
        (item) => item === "03g-Clinician Notes: Visibility (needed to protect private notes)",
      ),
      trackingMode: basic.trackingMode,
      sheetId: null as string | null,
      notePrivacyReady,
      writeEnabled: missing.every(
        (item) =>
          item === "03g-Clinician Notes: Visibility (needed to protect private notes)",
      ),
      missing,
    };
  } catch (error) {
    return {
      configured: false,
      trackingMode: basic.trackingMode,
      sheetId: null as string | null,
      notePrivacyReady: false,
      writeEnabled: false,
      missing: [
        ...missing,
        error instanceof KimeuError
          ? error.message
          : "The configured spreadsheet could not be reached through the Google Sheets connection.",
      ],
    };
  }
}
