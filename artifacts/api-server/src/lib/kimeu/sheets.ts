import { google, type sheets_v4 } from "googleapis";

export const MASTER_SHEET_ID = "1cXPmoIV0El9aGjwsac9sszhjFYOpz0C0QFx4GoxSaxM";
export const NOTE_VISIBILITY_HEADER = "Visibility";
export const APP_TIME_ZONE = "America/Los_Angeles";

const READ_CACHE_MS = 30_000;
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const ALLOWED_TABS = new Set([
  "03a-KIMEU Workshops",
  "03b-Advanced Workshop Log",
  "03c-Foundations Tracker",
  "03d-Fellowship Review Log",
  "03e-KIMEU Prior Status",
  "03f-Session Log",
  "03g-Clinician Notes",
  "03h-App Users",
]);
const WRITE_ALLOWLIST: Record<string, ReadonlySet<string>> = {
  "03b-Advanced Workshop Log": new Set([
    "Attended",
    "Attendance Confirmed By",
    "Last Updated By",
    "Last Updated",
  ]),
  "03c-Foundations Tracker": new Set([
    "Session Date",
    "Attended (SME)",
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
let sheetsClient: sheets_v4.Sheets | undefined;
let sheetsClientSecretFingerprint: string | undefined;

function configuration() {
  const sheetId = process.env.KIMEU_SHEET_ID?.trim() || "";
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || "";
  const missing: string[] = [];
  if (!sheetId) missing.push("KIMEU_SHEET_ID");
  if (!serviceAccountJson) missing.push("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (sheetId && sheetId === MASTER_SHEET_ID) {
    missing.push("The master spreadsheet is blocked; configure a test copy.");
  }
  return {
    sheetId,
    serviceAccountJson,
    configured: Boolean(
      sheetId && serviceAccountJson && sheetId !== MASTER_SHEET_ID,
    ),
    missing,
  };
}

export function getBasicReadiness() {
  const config = configuration();
  return {
    configured: config.configured,
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

function getSheetsClient(): sheets_v4.Sheets {
  const config = configuration();
  if (!config.configured) {
    throw new KimeuError(
      "Google Sheets is not configured for a test copy.",
      503,
      "SHEET_NOT_CONFIGURED",
    );
  }
  if (sheetsClient && sheetsClientSecretFingerprint === config.serviceAccountJson) {
    return sheetsClient;
  }

  try {
    const credentials = JSON.parse(config.serviceAccountJson) as {
      type?: string;
      project_id?: string;
      private_key?: string;
      client_email?: string;
    };
    if (
      credentials.type !== "service_account" ||
      !credentials.private_key ||
      !credentials.client_email
    ) {
      throw new Error("Invalid service-account fields");
    }
    const auth = new google.auth.GoogleAuth({
      credentials: {
        type: "service_account",
        project_id: credentials.project_id,
        private_key: credentials.private_key,
        client_email: credentials.client_email,
      },
      scopes: SCOPES,
    });
    sheetsClient = google.sheets({ version: "v4", auth });
    sheetsClientSecretFingerprint = config.serviceAccountJson;
    return sheetsClient;
  } catch {
    throw new KimeuError(
      "The Google service-account secret is invalid.",
      503,
      "SHEET_CREDENTIAL_INVALID",
    );
  }
}

function getSheetId(): string {
  const config = configuration();
  if (!config.configured) {
    throw new KimeuError(
      "Google Sheets is not configured for a test copy.",
      503,
      "SHEET_NOT_CONFIGURED",
    );
  }
  return config.sheetId;
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
  const cacheKey = `${name}:${headerRow}:${dataStartRow}`;
  const cached = snapshotCache.get(cacheKey);
  if (!options.force && cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const client = getSheetsClient();
  try {
    const response = await client.spreadsheets.values.get({
      spreadsheetId: getSheetId(),
      range: `${quoteSheetName(name)}!A1:AZ`,
      valueRenderOption: "FORMATTED_VALUE",
      majorDimension: "ROWS",
    });
    const rows = (response.data.values ?? []).map((row) =>
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
      "The configured test spreadsheet could not be read. Check its ID and service-account access.",
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
    await getSheetsClient().spreadsheets.values.batchUpdate({
      spreadsheetId: getSheetId(),
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data,
      },
    });
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
    await getSheetsClient().spreadsheets.values.batchUpdate({
      spreadsheetId: getSheetId(),
      requestBody: { valueInputOption: "USER_ENTERED", data },
    });
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
    await getSheetsClient().spreadsheets.values.batchUpdate({
      spreadsheetId: getSheetId(),
      requestBody: { valueInputOption: "USER_ENTERED", data },
    });
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

export async function appendSparseInputRow(
  tabName: string,
  updates: Array<{ header: string; value: CellValue }>,
  options: { headerRow?: number; dataStartRow?: number; autoHeaders?: string[] } = {},
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
  try {
    await getSheetsClient().spreadsheets.values.batchUpdate({
      spreadsheetId: getSheetId(),
      requestBody: { valueInputOption: "USER_ENTERED", data },
    });
    invalidateTab(tabName);
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
    if (key.startsWith(`${name}:`)) snapshotCache.delete(key);
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
      sheetId: null as string | null,
      notePrivacyReady,
      writeEnabled: missing.every(
        (item) =>
          item === "03g-Clinician Notes: Visibility (needed to protect private notes)",
      ),
      missing,
    };
  } catch {
    return {
      configured: false,
      sheetId: null as string | null,
      notePrivacyReady: false,
      writeEnabled: false,
      missing: [...missing, "The test spreadsheet is not readable by the service account."],
    };
  }
}
