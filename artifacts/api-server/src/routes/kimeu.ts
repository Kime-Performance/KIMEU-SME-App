import { randomUUID } from "node:crypto";
import { getUpcomingWorkshops } from "../lib/kimeu/calendar";
import { getCourses, requireCourseWriter } from "../lib/kimeu/courses";
import { getPracticals, savePractical, savePracticalSchedule } from "../lib/kimeu/practicals";
import { Router, type IRouter } from "express";
import {
  AppendKimeuClinicianNoteBody,
  AppendKimeuClinicianNoteResponse,
  CompleteKimeuSessionBody,
  CompleteKimeuSessionParams,
  CompleteKimeuSessionResponse,
  GetKimeuBootstrapResponse,
  GetKimeuCoursesResponse,
  GetKimeuPracticalsParams,
  GetKimeuPracticalsResponse,
  SaveKimeuPracticalParams,
  SaveKimeuPracticalBody,
  SaveKimeuPracticalResponse,
  SaveKimeuPracticalScheduleParams,
  SaveKimeuPracticalScheduleBody,
  SaveKimeuPracticalScheduleResponse,
  GetKimeuSessionParams,
  GetKimeuSessionResponse,
  GetKimeuTodayResponse,
  GetKimeuUpcomingResponse,
  OpenKimeuSessionBody,
  OpenKimeuSessionResponse,
  SaveKimeuAttendanceBody,
  SaveKimeuAttendanceParams,
  SaveKimeuAttendanceResponse,
} from "@workspace/api-zod";
import {
  getBootstrapForRequest,
  hasKimeuDomain,
  KIMEU_ROLES,
  requireActiveAppUser,
  requireRole,
  requireWorkshopAccess,
  signedInEmail,
  type AppUser,
} from "../lib/kimeu/access";
import {
  formatSheetTimestamp,
  getBasicReadiness,
  headerIndex,
  headersFor,
  KimeuError,
  NOTE_VISIBILITY_HEADER,
  normalizeEmail,
  readTab,
  appendSparseInputRow,
  testCopyReadiness,
  withPracticalWriteLock,
} from "../lib/kimeu/sheets";
import {
  completeSession,
  getSessionDetail,
  getSessionRecord,
  getToday,
  openSession,
  saveAttendance,
} from "../lib/kimeu/sessions";

const router: IRouter = Router();

router.post("/kimeu/courses/:workshopId/practical-schedule", async (req, res): Promise<void> => {
  const params = requireValidRequest(SaveKimeuPracticalScheduleParams.safeParse(req.params), "workshop ID");
  const body = requireValidRequest(SaveKimeuPracticalScheduleBody.safeParse(req.body), "practical schedule");
  const user = await requireActiveAppUser(req);
  requireRole(user, "Admin", "RD");
  requireWorkshopAccess(user, params.workshopId);
  res.setHeader("Cache-Control", "no-store");
  res.json(SaveKimeuPracticalScheduleResponse.parse(await savePracticalSchedule(user, params.workshopId, body)));
});

router.get("/kimeu/courses/:workshopId/practicals", async (req, res): Promise<void> => {
  const params = requireValidRequest(GetKimeuPracticalsParams.safeParse(req.params), "workshop ID");
  const user = await requireActiveAppUser(req);
  requireWorkshopAccess(user, params.workshopId);
  res.setHeader("Cache-Control", "no-store");
  res.json(GetKimeuPracticalsResponse.parse(await getPracticals(user, params.workshopId)));
});

router.post("/kimeu/courses/:workshopId/practicals", async (req, res): Promise<void> => {
  const params = requireValidRequest(SaveKimeuPracticalParams.safeParse(req.params), "workshop ID");
  const body = requireValidRequest(SaveKimeuPracticalBody.safeParse(req.body), "practical sign-off");
  const user = await requireActiveAppUser(req);
  requireRole(user, "RD");
  requireWorkshopAccess(user, params.workshopId);
  res.setHeader("Cache-Control", "no-store");
  res.json(SaveKimeuPracticalResponse.parse(await savePractical(user, params.workshopId, body)));
});

router.get("/kimeu/courses", async (req, res, next): Promise<void> => {
  try {
    const user = await requireActiveAppUser(req);
    res.setHeader("Cache-Control", "no-store");
    res.json(GetKimeuCoursesResponse.parse(await getCourses(user)));
  } catch (error) {
    next(error);
  }
});

router.get("/kimeu/upcoming", async (req, res, next): Promise<void> => {
  try {
    await requireActiveAppUser(req);
    res.setHeader("Cache-Control", "no-store");
    res.json(GetKimeuUpcomingResponse.parse(await getUpcomingWorkshops()));
  } catch (error) {
    next(error);
  }
});

// Safe, unauthenticated configuration probe for development; never exposes sheet IDs or data.
router.get("/kimeu/dev-readiness", async (_req, res, next): Promise<void> => {
  if (process.env.NODE_ENV !== "development") {
    res.sendStatus(404);
    return;
  }
  try {
    const result = await testCopyReadiness();
    res.json({
      configured: result.configured,
      notePrivacyReady: result.notePrivacyReady,
      writeEnabled: result.writeEnabled,
      missing: result.missing,
    });
  } catch (error) {
    next(error);
  }
});

function requireValidRequest<T>(
  result: { success: boolean; data?: T; error?: { message: string } },
  label: string,
): T {
  if (!result.success || result.data === undefined) {
    throw new KimeuError(
      `Invalid ${label}: ${result.error?.message ?? "request validation failed"}`,
      400,
      "INVALID_REQUEST",
    );
  }
  return result.data;
}

function requireSessionWriter(user: AppUser): void {
  requireRole(user, "SME Assist", "SME Lead");
}

function requireAssignedSession(user: AppUser, workshopId: string): void {
  requireWorkshopAccess(user, workshopId);
}

function authorRoleFor(user: AppUser, stage: string): string {
  const preferred = /foundation/i.test(stage)
    ? "SME Assist"
    : /fellowship|enrichment/i.test(stage)
      ? "SME Lead"
      : undefined;
  if (preferred && user.roles.includes(preferred)) return preferred;
  return user.roles[0] ?? "KIMEU user";
}

router.get("/kimeu/bootstrap", async (req, res): Promise<void> => {
  const email = await signedInEmail(req);
  if (!hasKimeuDomain(email)) {
    const response = GetKimeuBootstrapResponse.parse({
      readiness: getBasicReadiness(),
      user: null,
      access: "domain_denied",
    });
    res.json(response);
    return;
  }
  const response = GetKimeuBootstrapResponse.parse(
    await getBootstrapForRequest(req),
  );
  res.json(response);
});

router.get("/kimeu/today", async (req, res): Promise<void> => {
  const user = await requireActiveAppUser(req);
  requireRole(user, ...KIMEU_ROLES);
  const response = GetKimeuTodayResponse.parse(await getToday(user));
  res.json(response);
});

router.post("/kimeu/sessions", async (req, res): Promise<void> => {
  const body = requireValidRequest(
    OpenKimeuSessionBody.safeParse(req.body),
    "session",
  );
  const user = await requireActiveAppUser(req);
  requireRole(user, ...KIMEU_ROLES);
  requireSessionWriter(user);
  requireAssignedSession(user, body.workshopId);
  await requireCourseWriter(user, body.workshopId);
  const sessionDate = body.sessionDate.toISOString().slice(0, 10);
  const response = OpenKimeuSessionResponse.parse(
    await openSession(user, body.workshopId, sessionDate),
  );
  res.json(response);
});

router.get("/kimeu/sessions/:sessionId", async (req, res): Promise<void> => {
  const params = requireValidRequest(
    GetKimeuSessionParams.safeParse(req.params),
    "session ID",
  );
  const user = await requireActiveAppUser(req);
  const detail = await getSessionDetail(params.sessionId);
  requireAssignedSession(user, detail.session.workshopId);
  const { internalRoster: _roster, internalSession: _session, ...responseData } =
    detail;
  const response = GetKimeuSessionResponse.parse(responseData);
  res.json(response);
});

router.post(
  "/kimeu/sessions/:sessionId/attendance",
  async (req, res): Promise<void> => {
    const params = requireValidRequest(
      SaveKimeuAttendanceParams.safeParse(req.params),
      "session ID",
    );
    const body = requireValidRequest(
      SaveKimeuAttendanceBody.safeParse(req.body),
      "attendance",
    );
    const user = await requireActiveAppUser(req);
    requireSessionWriter(user);
    const session = await getSessionRecord(params.sessionId);
    requireAssignedSession(user, session.workshopId);
    await requireCourseWriter(user, session.workshopId);
    const response = SaveKimeuAttendanceResponse.parse(
      await saveAttendance(user, params.sessionId, body.marks),
    );
    res.json(response);
  },
);

router.post(
  "/kimeu/sessions/:sessionId/complete",
  async (req, res): Promise<void> => {
    const params = requireValidRequest(
      CompleteKimeuSessionParams.safeParse(req.params),
      "session ID",
    );
    const body = requireValidRequest(
      CompleteKimeuSessionBody.safeParse(req.body),
      "session completion",
    );
    const user = await requireActiveAppUser(req);
    requireSessionWriter(user);
    const session = await getSessionRecord(params.sessionId);
    requireAssignedSession(user, session.workshopId);
    await requireCourseWriter(user, session.workshopId);
    try {
      const response = CompleteKimeuSessionResponse.parse(
        await completeSession(user, params.sessionId, body),
      );
      res.json(response);
    } catch (error) {
      if (error instanceof KimeuError && error.code === "UNMARKED_ATTENDANCE") {
        let unmarked: string[] = [];
        try {
          unmarked = JSON.parse(error.message) as string[];
        } catch {
          unmarked = [];
        }
        res.status(409).json({
          error: "Confirm the remaining unmarked clinicians before closing.",
          unmarked,
        });
        return;
      }
      throw error;
    }
  },
);

router.post("/kimeu/clinician-notes", async (req, res): Promise<void> => {
  const body = requireValidRequest(
    AppendKimeuClinicianNoteBody.safeParse(req.body),
    "clinician note",
  );
  const user = await requireActiveAppUser(req);
  requireRole(
    user,
    ...KIMEU_ROLES,
  );
  const session = await getSessionRecord(body.sessionId);
  requireAssignedSession(user, session.workshopId);
  if (body.workshopId !== session.workshopId) {
    throw new KimeuError(
      "The note workshop does not match this session.",
      400,
      "NOTE_SESSION_MISMATCH",
    );
  }
  const detail = await getSessionDetail(body.sessionId);
  if (
    !detail.internalRoster.some(
      (person) =>
        normalizeEmail(person.clinicianEmail) ===
        normalizeEmail(body.clinicianEmail),
    )
  ) {
    throw new KimeuError(
      "This clinician is not on the selected session roster.",
      403,
      "CLINICIAN_NOT_ON_ROSTER",
    );
  }

  const readiness = getBasicReadiness();
  if (!readiness.configured) {
    throw new KimeuError(
      "Clinician notes are unavailable until the test sheet is configured.",
      503,
      "SHEET_NOT_CONFIGURED",
    );
  }
  const snapshot = await readTab("03g-Clinician Notes", { force: true });
  const headers = headersFor(snapshot);
  headerIndex(headers, NOTE_VISIBILITY_HEADER);
  const timestamp = formatSheetTimestamp();
  const authorRole = authorRoleFor(user, session.stage);
  const updates: Array<{ header: string; value: string | boolean }> = [
    { header: "Note ID", value: randomUUID() },
    { header: "Created", value: timestamp },
    { header: "PT Email", value: body.clinicianEmail },
    { header: "Note Type", value: body.noteType },
    { header: "Workshop ID", value: body.workshopId },
    { header: "Session ID", value: body.sessionId },
    { header: "Note", value: body.note },
    { header: "Follow-up Needed", value: body.followUpNeeded },
    { header: "Author", value: user.nameInSheets },
    { header: "Author Role", value: authorRole },
    { header: NOTE_VISIBILITY_HEADER, value: body.visibility },
  ];
  if (body.followUpDue) {
    updates.push({
      header: "Follow-up Due",
      value: body.followUpDue.toISOString().slice(0, 10),
    });
  }
  const noteId = String(updates[0].value);
  await withPracticalWriteLock(() => appendSparseInputRow("03g-Clinician Notes", updates, {
    headerRow: 2,
    dataStartRow: 3,
    autoHeaders: ["PT Name (auto)"],
  }));

  const response = AppendKimeuClinicianNoteResponse.parse({
    noteId,
    created: new Date().toISOString(),
    clinicianEmail: body.clinicianEmail,
    visibility: body.visibility,
  });
  res.status(201).json(response);
});

export default router;
