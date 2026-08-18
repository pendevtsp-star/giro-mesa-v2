import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Icon,
  Modal,
  SearchField,
  SegmentedTabs,
  Toast,
} from "@giromesa/ui";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import {
  dateLabel,
  type ManagementScope,
  operationalKey,
  type Person,
  type PersonTimelineData,
  parsePeople,
  parsePeopleCapabilities,
  parsePeopleDirectory,
  parsePeopleIndicators,
  parsePersonTimeline,
  parseTimeTrackingReport,
  RemoteGate,
  type TimeTrackingReport,
  useRemote,
} from "../../management.shared";

function workedMinutes(
  entry: { id: string; clockedInAt: string; clockedOutAt: string | null },
  breaks: Array<{ timeEntryId: string; startedAt: string; endedAt: string | null }>,
) {
  const end = entry.clockedOutAt ? new Date(entry.clockedOutAt).getTime() : Date.now();
  const gross = Math.max(0, end - new Date(entry.clockedInAt).getTime());
  const paused = breaks
    .filter((item) => item.timeEntryId === entry.id && item.endedAt)
    .reduce(
      (sum, item) =>
        sum +
        Math.max(
          0,
          new Date(item.endedAt as string).getTime() - new Date(item.startedAt).getTime(),
        ),
      0,
    );
  return Math.max(0, Math.round((gross - paused) / 60_000));
}

function hoursLabel(minutes: number) {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}min`;
}

function formatCents(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function anomalyLabel(code: string) {
  return (
    {
      long_open_shift: "Turno longo",
      missing_clock_out: "Sem saída",
      open_break: "Pausa aberta",
      late_arrival: "Entrada atrasada",
      overlapping_shift: "Turnos sobrepostos",
      short_break: "Pausa abaixo do mínimo",
      overtime_limit_exceeded: "Hora extra acima do limite",
      multiple_devices: "Múltiplos dispositivos",
      mock_location: "Localização simulada",
      clock_skew: "Relógio do dispositivo divergente",
      missing_device: "Dispositivo não identificado",
      pending_correction: "Correção pendente",
    }[code] ?? code
  );
}

function dateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function timelineExceptions(timeline: PersonTimelineData) {
  let absences = 0;
  let earlyDepartures = 0;
  for (const schedule of timeline.schedules) {
    const start = new Date(schedule.startsAt).getTime();
    const end = new Date(schedule.endsAt).getTime();
    const entry = timeline.entries.find(
      (item) =>
        new Date(item.clockedInAt).getTime() < end &&
        (!item.clockedOutAt || new Date(item.clockedOutAt).getTime() > start),
    );
    if (!entry && end < Date.now()) absences += 1;
    if (entry?.clockedOutAt && new Date(entry.clockedOutAt).getTime() < end) earlyDepartures += 1;
  }
  return { absences, earlyDepartures };
}

type PeopleSection = "today" | "team" | "schedules" | "time" | "settings";
type PeopleFilter = "all" | "active" | "inactive" | "unlinked" | "on_shift";
type Confirmation =
  | { kind: "close-period" }
  | { kind: "reopen-period"; closureId: string }
  | { kind: "reject-correction"; correctionId: string }
  | { kind: "person-status"; personId: string; active: boolean }
  | { kind: "cancel-schedule"; scheduleId: string }
  | {
      kind: "commission";
      commissionId: string;
      action: "approve" | "reject" | "pay" | "cancel";
    };

function confirmationTitle(confirmation: Confirmation | null) {
  if (!confirmation) return "Confirmar ação";
  if (confirmation.kind === "close-period") return "Fechar período";
  if (confirmation.kind === "reopen-period") return "Reabrir período";
  if (confirmation.kind === "reject-correction") return "Rejeitar correção";
  if (confirmation.kind === "person-status")
    return confirmation.active ? "Reativar pessoa" : "Inativar pessoa";
  if (confirmation.kind === "cancel-schedule") return "Cancelar escala";
  return "Atualizar comissão";
}

function confirmationCopy(confirmation: Confirmation | null) {
  if (confirmation?.kind === "close-period")
    return "Após o fechamento, alterações diretas serão bloqueadas e exigirão correção aprovada.";
  if (confirmation?.kind === "reopen-period")
    return "Informe o motivo auditável da reabertura deste período.";
  if (confirmation?.kind === "reject-correction")
    return "Informe por que a correção não pode ser aprovada.";
  if (confirmation?.kind === "person-status")
    return confirmation.active
      ? "Informe o motivo da reativação."
      : "A inativação será bloqueada se existir turno aberto. Informe o motivo.";
  if (confirmation?.kind === "cancel-schedule") return "Informe o motivo do cancelamento.";
  return "Informe uma nota para a trilha de auditoria da comissão.";
}

function confirmationNoteRequired(confirmation: Confirmation | null) {
  return confirmation?.kind !== "close-period";
}

function permissionReason(reason: string | null) {
  if (reason === "TIME_TRACKING_POLICY_DENIED")
    return "O proprietário desabilitou a consulta de ponto para este perfil nesta unidade.";
  if (reason === "ROLE_NOT_ALLOWED") return "Este perfil não possui acesso ao módulo Pessoas.";
  return "Alterações de geolocalização, tolerâncias e fechamento permanecem restritas ao proprietário da unidade.";
}

export function RealPeoplePage({ scope }: { scope: ManagementScope }) {
  const remote = useRemote(scope, api.management.people, parsePeople);
  const capabilities = useRemote(scope, api.management.peopleCapabilities, parsePeopleCapabilities);
  const canConfigureTracking =
    capabilities.state.status === "ready"
      ? capabilities.state.data.canConfigure
      : scope.profileId === "owner";
  const [section, setSection] = useState<PeopleSection>("today");
  const [actionId, setActionId] = useState("");
  const [actionError, setActionError] = useState("");
  const [feedback, setFeedback] = useState<{
    message: string;
    tone: "success" | "danger" | "info";
  } | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmationNote, setConfirmationNote] = useState("");
  const [peopleQuery, setPeopleQuery] = useState("");
  const [peopleFilter, setPeopleFilter] = useState<PeopleFilter>("all");
  const [peopleRole, setPeopleRole] = useState("all");
  const [peoplePage, setPeoplePage] = useState(1);
  const [directoryRevision, setDirectoryRevision] = useState(0);
  const directoryMounted = useRef(false);
  const directory = useRemote(
    { ...scope, refreshToken: directoryRevision },
    (organizationId, unitId) =>
      api.management.peopleDirectory(organizationId, unitId, {
        q: peopleQuery.trim() || undefined,
        status: peopleFilter,
        role: peopleRole === "all" ? undefined : peopleRole,
        page: peoplePage,
        pageSize: 20,
      }),
    parsePeopleDirectory,
  );
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [editPersonName, setEditPersonName] = useState("");
  const [editPersonRole, setEditPersonRole] = useState("");
  const [editPersonCode, setEditPersonCode] = useState("");
  const [editPersonIdentityId, setEditPersonIdentityId] = useState("");
  const [editPersonHourlyRate, setEditPersonHourlyRate] = useState("");
  const [personName, setPersonName] = useState("");
  const [roleLabel, setRoleLabel] = useState("");
  const [employmentCode, setEmploymentCode] = useState("");
  const [personIdentityId, setPersonIdentityId] = useState("");
  const [schedulePersonId, setSchedulePersonId] = useState("");
  const [scheduleStart, setScheduleStart] = useState("");
  const [scheduleEnd, setScheduleEnd] = useState("");
  const [breakMinutes, setBreakMinutes] = useState("0");
  const [scheduleNotes, setScheduleNotes] = useState("");
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [batchPersonIds, setBatchPersonIds] = useState<string[]>([]);
  const [batchPreview, setBatchPreview] = useState<{
    schedules: Array<{ personId: string; startsAt: string; endsAt: string }>;
    conflicts: Array<{ personId: string; message: string }>;
  } | null>(null);
  const [timePersonId, setTimePersonId] = useState("");
  const [clockedInAt, setClockedInAt] = useState("");
  const [trackingMode, setTrackingMode] = useState<"off" | "all" | "selected">("off");
  const [geofenceEnabled, setGeofenceEnabled] = useState(true);
  const [locationLabel, setLocationLabel] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [radiusMeters, setRadiusMeters] = useState("100");
  const [accuracyToleranceMeters, setAccuracyToleranceMeters] = useState("50");
  const [managerCanView, setManagerCanView] = useState(false);
  const [financeCanView, setFinanceCanView] = useState(false);
  const [antiFraudEnabled, setAntiFraudEnabled] = useState(true);
  const [offlineEnabled, setOfflineEnabled] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [managerAlertOnAnomaly, setManagerAlertOnAnomaly] = useState(true);
  const [lateToleranceMinutes, setLateToleranceMinutes] = useState("15");
  const [minimumBreakMinutes, setMinimumBreakMinutes] = useState("0");
  const [maxOvertimeMinutes, setMaxOvertimeMinutes] = useState("120");
  const [longShiftAlertMinutes, setLongShiftAlertMinutes] = useState("720");
  const [reminderBeforeShiftMinutes, setReminderBeforeShiftMinutes] = useState("15");
  const [reminderAfterShiftMinutes, setReminderAfterShiftMinutes] = useState("15");
  const [selectedPersonIds, setSelectedPersonIds] = useState<string[]>([]);
  const [reportFrom, setReportFrom] = useState(() =>
    dateInputValue(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
  );
  const [reportTo, setReportTo] = useState(() => dateInputValue(new Date()));
  const [report, setReport] = useState<TimeTrackingReport | null>(null);
  const [commissionRuleName, setCommissionRuleName] = useState("");
  const [commissionRate, setCommissionRate] = useState("");
  const [commissionPersonId, setCommissionPersonId] = useState("");
  const [commissionRuleId, setCommissionRuleId] = useState("");
  const [commissionBase, setCommissionBase] = useState("");
  const [commissionAmount, setCommissionAmount] = useState("");
  const [indicatorsRevision, setIndicatorsRevision] = useState(0);
  const indicatorsMounted = useRef(false);
  const indicators = useRemote(
    { ...scope, refreshToken: indicatorsRevision },
    (organizationId, unitId) =>
      api.management.peopleOperationalIndicators(organizationId, unitId, {
        from: reportFrom,
        to: reportTo,
        comparisonMode: "none",
      }),
    parsePeopleIndicators,
  );
  const [timeline, setTimeline] = useState<
    | { status: "idle" | "loading" }
    | { status: "ready"; data: PersonTimelineData }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const timelineRequest = useRef(0);
  useEffect(() => {
    if (remote.state.status !== "ready") return;
    const settings = remote.state.data.settings;
    setTrackingMode(settings.mode);
    setGeofenceEnabled(settings.geofenceEnabled);
    setLocationLabel(settings.locationLabel ?? "");
    setLatitude(settings.latitude?.toString() ?? "");
    setLongitude(settings.longitude?.toString() ?? "");
    setRadiusMeters(String(settings.radiusMeters));
    setAccuracyToleranceMeters(String(settings.accuracyToleranceMeters));
    setManagerCanView(settings.managerCanView);
    setFinanceCanView(settings.financeCanView);
    setAntiFraudEnabled(settings.antiFraudEnabled);
    setOfflineEnabled(settings.offlineEnabled);
    setNotificationsEnabled(settings.notificationsEnabled);
    setManagerAlertOnAnomaly(settings.managerAlertOnAnomaly);
    setLateToleranceMinutes(String(settings.lateToleranceMinutes));
    setMinimumBreakMinutes(String(settings.minimumBreakMinutes));
    setMaxOvertimeMinutes(String(settings.maxOvertimeMinutes));
    setLongShiftAlertMinutes(String(settings.longShiftAlertMinutes));
    setReminderBeforeShiftMinutes(String(settings.reminderBeforeShiftMinutes));
    setReminderAfterShiftMinutes(String(settings.reminderAfterShiftMinutes));
    setSelectedPersonIds(remote.state.data.selectedPersonIds);
  }, [remote.state]);
  const directoryKey = `${peopleFilter}:${peoplePage}:${peopleRole}:${peopleQuery}`;
  useEffect(() => {
    void directoryKey;
    if (!directoryMounted.current) {
      directoryMounted.current = true;
      return;
    }
    const timer = globalThis.setTimeout(() => setDirectoryRevision((value) => value + 1), 300);
    return () => globalThis.clearTimeout(timer);
  }, [directoryKey]);
  const indicatorsKey = `${reportFrom}:${reportTo}`;
  useEffect(() => {
    void indicatorsKey;
    if (!indicatorsMounted.current) {
      indicatorsMounted.current = true;
      return;
    }
    const timer = globalThis.setTimeout(() => setIndicatorsRevision((value) => value + 1), 300);
    return () => globalThis.clearTimeout(timer);
  }, [indicatorsKey]);
  const personById = useMemo(() => {
    if (remote.state.status !== "ready") return new Map<string, Person>();
    const items =
      directory.state.status === "ready"
        ? [...remote.state.data.people, ...directory.state.data.items]
        : remote.state.data.people;
    return new Map(items.map((person) => [person.id, person]));
  }, [directory.state, remote.state]);
  const visiblePeople = useMemo(() => {
    return directory.state.status === "ready" ? directory.state.data.items : [];
  }, [directory.state]);
  function failAction(error: unknown, fallback: string) {
    const message = error instanceof Error ? error.message : fallback;
    setActionError(message);
    setFeedback({ message, tone: "danger" });
  }
  async function clockOut(entryId: string) {
    setActionId(entryId);
    setActionError("");
    try {
      await api.management.clockOut(
        scope.organizationId,
        scope.unitId,
        entryId,
        new Date().toISOString(),
      );
      setFeedback({ message: "Saída registrada com sucesso.", tone: "success" });
      remote.retry();
    } catch (error) {
      failAction(error, "Não foi possível registrar a saída.");
    } finally {
      setActionId("");
    }
  }
  async function createPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionId("new-person");
    setActionError("");
    try {
      await api.management.createPerson(scope.organizationId, scope.unitId, {
        name: personName.trim(),
        roleLabel: roleLabel.trim(),
        employmentCode: employmentCode.trim() || undefined,
        identityId: personIdentityId || undefined,
      });
      setPersonName("");
      setRoleLabel("");
      setEmploymentCode("");
      setPersonIdentityId("");
      setFeedback({ message: "Pessoa cadastrada na unidade.", tone: "success" });
      remote.retry();
    } catch (error) {
      failAction(error, "Não foi possível cadastrar a pessoa.");
    } finally {
      setActionId("");
    }
  }
  function openPerson(person: Person) {
    const request = ++timelineRequest.current;
    setSelectedPersonId(person.id);
    setEditPersonName(person.name);
    setEditPersonRole(person.roleLabel);
    setEditPersonCode(person.employmentCode ?? "");
    setEditPersonIdentityId(person.identityId ?? "");
    setEditPersonHourlyRate(
      person.hourlyRateCents === null ? "" : String(person.hourlyRateCents / 100),
    );
    setTimeline({ status: "loading" });
    void api.management
      .personTimeline(scope.organizationId, scope.unitId, person.id, {
        from: reportFrom,
        to: reportTo,
        comparisonMode: "none",
      })
      .then(parsePersonTimeline)
      .then((data) => {
        if (timelineRequest.current === request) setTimeline({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (timelineRequest.current !== request) return;
        setTimeline({
          status: "error",
          message: error instanceof Error ? error.message : "Não foi possível carregar o espelho.",
        });
      });
  }
  async function savePerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPersonId) return;
    setActionId(`person-${selectedPersonId}`);
    setActionError("");
    try {
      await api.management.updatePerson(scope.organizationId, scope.unitId, selectedPersonId, {
        name: editPersonName.trim(),
        roleLabel: editPersonRole.trim(),
        employmentCode: editPersonCode.trim() || null,
        identityId: editPersonIdentityId || null,
        hourlyRateCents: editPersonHourlyRate
          ? Math.round(Number(editPersonHourlyRate) * 100)
          : null,
        expectedUpdatedAt: personById.get(selectedPersonId)?.updatedAt,
      });
      setFeedback({ message: "Cadastro atualizado.", tone: "success" });
      remote.retry();
      directory.retry();
    } catch (error) {
      failAction(error, "Não foi possível atualizar o cadastro.");
    } finally {
      setActionId("");
    }
  }
  async function changePersonStatus(personId: string, active: boolean, reason: string) {
    setActionId(`person-status-${personId}`);
    setActionError("");
    try {
      await api.management.changePersonStatus(
        scope.organizationId,
        scope.unitId,
        personId,
        active,
        reason,
      );
      setFeedback({
        message: active ? "Pessoa reativada." : "Pessoa inativada.",
        tone: "success",
      });
      setSelectedPersonId(null);
      remote.retry();
      directory.retry();
      return true;
    } catch (error) {
      failAction(error, `Não foi possível ${active ? "reativar" : "inativar"} a pessoa.`);
      return false;
    } finally {
      setActionId("");
    }
  }
  async function createSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (new Date(scheduleEnd) <= new Date(scheduleStart)) {
      failAction(null, "O fim da escala deve ser posterior ao início.");
      return;
    }
    setActionId("schedule");
    setActionError("");
    try {
      await api.management.createSchedule(scope.organizationId, scope.unitId, {
        personId: schedulePersonId,
        startsAt: new Date(scheduleStart).toISOString(),
        endsAt: new Date(scheduleEnd).toISOString(),
        breakMinutes: Number(breakMinutes),
        notes: scheduleNotes.trim() || undefined,
      });
      setScheduleStart("");
      setScheduleEnd("");
      setScheduleNotes("");
      setFeedback({ message: "Escala cadastrada.", tone: "success" });
      remote.retry();
    } catch (error) {
      failAction(error, "Não foi possível criar a escala.");
    } finally {
      setActionId("");
    }
  }
  function editSchedule(scheduleId: string) {
    if (remote.state.status !== "ready") return;
    const schedule = remote.state.data.schedules.find((item) => item.id === scheduleId);
    if (!schedule) return;
    setEditingScheduleId(schedule.id);
    setSchedulePersonId(schedule.personId);
    setScheduleStart(schedule.startsAt.slice(0, 16));
    setScheduleEnd(schedule.endsAt.slice(0, 16));
    setBreakMinutes(String(schedule.breakMinutes));
    setScheduleNotes(schedule.notes ?? "");
  }
  async function saveSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingScheduleId) return;
    if (new Date(scheduleEnd) <= new Date(scheduleStart)) {
      failAction(null, "O fim da escala deve ser posterior ao início.");
      return;
    }
    setActionId(`schedule-${editingScheduleId}`);
    setActionError("");
    try {
      await api.management.updatePeopleSchedule(
        scope.organizationId,
        scope.unitId,
        editingScheduleId,
        {
          startsAt: new Date(scheduleStart).toISOString(),
          endsAt: new Date(scheduleEnd).toISOString(),
          breakMinutes: Number(breakMinutes),
          notes: scheduleNotes.trim() || null,
          expectedUpdatedAt:
            remote.state.status === "ready"
              ? remote.state.data.schedules.find((schedule) => schedule.id === editingScheduleId)
                  ?.updatedAt
              : undefined,
        },
      );
      setEditingScheduleId(null);
      setFeedback({ message: "Escala atualizada.", tone: "success" });
      remote.retry();
    } catch (error) {
      failAction(error, "Não foi possível atualizar a escala.");
    } finally {
      setActionId("");
    }
  }
  async function cancelSchedule(scheduleId: string, reason: string) {
    setActionId(`schedule-${scheduleId}`);
    setActionError("");
    try {
      await api.management.cancelPeopleSchedule(
        scope.organizationId,
        scope.unitId,
        scheduleId,
        reason,
      );
      setFeedback({ message: "Escala cancelada.", tone: "success" });
      remote.retry();
      return true;
    } catch (error) {
      failAction(error, "Não foi possível cancelar a escala.");
      return false;
    } finally {
      setActionId("");
    }
  }
  function batchScheduleBody() {
    return {
      schedules: batchPersonIds.map((personId) => ({
        personId,
        startsAt: new Date(scheduleStart).toISOString(),
        endsAt: new Date(scheduleEnd).toISOString(),
        breakMinutes: Number(breakMinutes),
        ...(scheduleNotes.trim() ? { notes: scheduleNotes.trim() } : {}),
      })),
    };
  }
  async function previewScheduleBatch() {
    if (!batchPersonIds.length || !scheduleStart || !scheduleEnd) return;
    if (new Date(scheduleEnd) <= new Date(scheduleStart)) {
      failAction(null, "O fim da escala deve ser posterior ao início.");
      return;
    }
    setActionId("schedule-batch-preview");
    setActionError("");
    try {
      const body = batchScheduleBody();
      const response = (await api.management.previewPeopleSchedulesBatch(
        scope.organizationId,
        scope.unitId,
        body,
      )) as {
        conflicts?: Array<{
          index?: number;
          code?: string;
          conflictingScheduleIds?: string[];
        }>;
      };
      setBatchPreview({
        schedules: body.schedules,
        conflicts: Array.isArray(response.conflicts)
          ? response.conflicts.map((conflict) => ({
              personId: body.schedules[conflict.index ?? -1]?.personId ?? "",
              message:
                conflict.code === "SCHEDULE_OVERLAP"
                  ? `Conflito com ${conflict.conflictingScheduleIds?.length ?? 1} escala(s).`
                  : "Conflito com outra escala.",
            }))
          : [],
      });
    } catch (error) {
      failAction(error, "Não foi possível validar o lote de escalas.");
    } finally {
      setActionId("");
    }
  }
  async function createScheduleBatch() {
    if (!batchPreview || batchPreview.conflicts.length) return;
    setActionId("schedule-batch");
    setActionError("");
    try {
      await api.management.createPeopleSchedulesBatch(
        scope.organizationId,
        scope.unitId,
        batchScheduleBody(),
        operationalKey("schedule-batch"),
      );
      setBatchPreview(null);
      setBatchPersonIds([]);
      setFeedback({ message: "Escalas do lote cadastradas.", tone: "success" });
      remote.retry();
    } catch (error) {
      failAction(error, "Não foi possível cadastrar o lote de escalas.");
    } finally {
      setActionId("");
    }
  }
  async function createTimeEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionId("time-entry");
    setActionError("");
    try {
      await api.management.createTimeEntry(
        scope.organizationId,
        scope.unitId,
        {
          personId: timePersonId,
          clockedInAt: new Date(clockedInAt).toISOString(),
          source: "manual",
        },
        operationalKey("time-entry"),
      );
      setClockedInAt("");
      setFeedback({ message: "Entrada manual registrada.", tone: "success" });
      remote.retry();
    } catch (error) {
      failAction(error, "Não foi possível abrir o ponto.");
    } finally {
      setActionId("");
    }
  }

  async function saveTrackingSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionId("tracking-settings");
    setActionError("");
    try {
      await api.management.updateTimeTrackingSettings(scope.organizationId, scope.unitId, {
        mode: trackingMode,
        geofenceEnabled,
        locationLabel: locationLabel.trim() || undefined,
        latitude: latitude ? Number(latitude) : undefined,
        longitude: longitude ? Number(longitude) : undefined,
        radiusMeters: Number(radiusMeters),
        accuracyToleranceMeters: Number(accuracyToleranceMeters),
        managerCanView,
        financeCanView,
        antiFraudEnabled,
        offlineEnabled,
        notificationsEnabled,
        managerAlertOnAnomaly,
        lateToleranceMinutes: Number(lateToleranceMinutes),
        minimumBreakMinutes: Number(minimumBreakMinutes),
        maxOvertimeMinutes: Number(maxOvertimeMinutes),
        longShiftAlertMinutes: Number(longShiftAlertMinutes),
        reminderBeforeShiftMinutes: Number(reminderBeforeShiftMinutes),
        reminderAfterShiftMinutes: Number(reminderAfterShiftMinutes),
        selectedPersonIds,
      });
      setFeedback({ message: "Política de ponto atualizada.", tone: "success" });
      remote.retry();
    } catch (error) {
      failAction(error, "Não foi possível salvar a política de ponto.");
    } finally {
      setActionId("");
    }
  }
  async function loadReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionId("time-report");
    setActionError("");
    try {
      setReport(
        parseTimeTrackingReport(
          await api.management.timeTrackingReport(scope.organizationId, scope.unitId, {
            from: reportFrom,
            to: reportTo,
          }),
        ),
      );
      setFeedback({ message: "Relatório atualizado para o período informado.", tone: "info" });
    } catch (error) {
      failAction(error, "Não foi possível carregar o relatório.");
    } finally {
      setActionId("");
    }
  }
  async function closePeriod(reason?: string) {
    if (scope.profileId !== "owner") return false;
    setActionId("close-period");
    setActionError("");
    try {
      await api.management.closeTimeTrackingPeriod(
        scope.organizationId,
        scope.unitId,
        {
          from: reportFrom,
          to: reportTo,
          reason: reason?.trim() || undefined,
        },
        operationalKey("time-closure"),
      );
      setFeedback({ message: "Período fechado para alterações diretas.", tone: "success" });
      remote.retry();
      return true;
    } catch (error) {
      failAction(error, "Não foi possível fechar o período.");
      return false;
    } finally {
      setActionId("");
    }
  }
  async function reopenPeriod(closureId: string, reason: string) {
    if (scope.profileId !== "owner") return false;
    setActionId(closureId);
    setActionError("");
    try {
      await api.management.reopenTimeTrackingPeriod(
        scope.organizationId,
        scope.unitId,
        closureId,
        { reason },
        operationalKey("time-closure-reopen"),
      );
      setFeedback({ message: "Período reaberto.", tone: "success" });
      remote.retry();
      return true;
    } catch (error) {
      failAction(error, "Não foi possível reabrir o período.");
      return false;
    } finally {
      setActionId("");
    }
  }
  function downloadReport() {
    if (!report) return;
    const header =
      "funcionario,data,entrada,saida,horas_trabalhadas,pausas,horas_extras,valor_hora, custo_estimado,anomalias";
    const lines = report.rows.map((row) =>
      [
        row.personName,
        row.summary.date,
        row.clockedInAt,
        row.clockedOutAt ?? "",
        hoursLabel(row.summary.workedMinutes),
        hoursLabel(row.summary.breakMinutes),
        hoursLabel(row.summary.overtimeMinutes),
        row.hourlyRateCents === null ? "" : formatCents(row.hourlyRateCents),
        row.estimatedLaborCostCents === null ? "" : formatCents(row.estimatedLaborCostCents),
        row.summary.anomalyCodes.map(anomalyLabel).join(" | "),
      ]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(","),
    );
    const blob = new Blob([`${header}\n${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ponto-${report.from}-${report.to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  async function decideCorrection(
    correctionId: string,
    decision: "approve" | "reject",
    reviewNote?: string,
  ) {
    if (decision === "reject" && !reviewNote) return false;
    setActionId(correctionId);
    setActionError("");
    try {
      await api.management.decideTimeCorrection(scope.organizationId, scope.unitId, correctionId, {
        decision,
        reviewNote,
      });
      setFeedback({
        message: decision === "approve" ? "Correção aprovada." : "Correção rejeitada.",
        tone: "success",
      });
      remote.retry();
      return true;
    } catch (error) {
      failAction(error, "Não foi possível analisar a correção.");
      return false;
    } finally {
      setActionId("");
    }
  }
  async function createCommissionRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionId("commission-rule");
    setActionError("");
    try {
      await api.management.createCommissionRule(scope.organizationId, scope.unitId, {
        name: commissionRuleName.trim(),
        basisPoints: Math.round(Number(commissionRate) * 100),
      });
      setCommissionRuleName("");
      setCommissionRate("");
      setFeedback({ message: "Regra de comissão cadastrada.", tone: "success" });
      remote.retry();
    } catch (error) {
      failAction(error, "Não foi possível cadastrar a regra de comissão.");
    } finally {
      setActionId("");
    }
  }
  async function createCommission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionId("commission");
    setActionError("");
    try {
      await api.management.createCommission(
        scope.organizationId,
        scope.unitId,
        {
          personId: commissionPersonId,
          ruleId: commissionRuleId || undefined,
          baseCents: Math.round(Number(commissionBase) * 100),
          amountCents: commissionRuleId ? undefined : Math.round(Number(commissionAmount) * 100),
        },
        operationalKey("commission"),
      );
      setCommissionBase("");
      setCommissionAmount("");
      setFeedback({ message: "Comissão lançada como pendente.", tone: "success" });
      remote.retry();
    } catch (error) {
      failAction(error, "Não foi possível lançar a comissão.");
    } finally {
      setActionId("");
    }
  }
  async function transitionCommission(
    commissionId: string,
    action: "approve" | "reject" | "pay" | "cancel",
    note?: string,
  ) {
    setActionId(`commission-${commissionId}`);
    setActionError("");
    try {
      await api.management.transitionCommission(
        scope.organizationId,
        scope.unitId,
        commissionId,
        { action, note: note?.trim() || "Atualização operacional" },
        operationalKey(`commission-${action}`),
      );
      setFeedback({ message: "Situação da comissão atualizada.", tone: "success" });
      remote.retry();
      return true;
    } catch (error) {
      failAction(error, "Não foi possível atualizar a comissão.");
      return false;
    } finally {
      setActionId("");
    }
  }
  async function updateAssignments(enabled: boolean) {
    if (!batchPersonIds.length) return;
    setActionId("tracking-assignments-batch");
    setActionError("");
    try {
      await api.management.updateTimeTrackingAssignmentsBatch(
        scope.organizationId,
        scope.unitId,
        { personIds: batchPersonIds, enabled },
        operationalKey("tracking-assignments-batch"),
      );
      setFeedback({
        message: enabled
          ? "Ponto habilitado para a seleção."
          : "Ponto desabilitado para a seleção.",
        tone: "success",
      });
      remote.retry();
    } catch (error) {
      failAction(error, "Não foi possível atualizar a seleção.");
    } finally {
      setActionId("");
    }
  }
  async function exportSelectedPeople(format: "csv" | "json") {
    if (!batchPersonIds.length) return;
    setActionId(`people-export-${format}`);
    setActionError("");
    try {
      const response = (await api.management.exportPeople(scope.organizationId, scope.unitId, {
        personIds: batchPersonIds,
        format,
      })) as { filename?: string; content?: string; rows?: unknown[] };
      const content =
        typeof response.content === "string"
          ? response.content
          : Array.isArray(response.rows)
            ? JSON.stringify(response.rows, null, 2)
            : null;
      if (content === null) throw new Error("Exportação sem conteúdo.");
      const blob = new Blob([content], {
        type: format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = response.filename || `pessoas.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
      setFeedback({ message: "Exportação preparada.", tone: "success" });
    } catch (error) {
      failAction(error, "Não foi possível exportar a seleção.");
    } finally {
      setActionId("");
    }
  }
  async function confirmPendingAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmation) return;
    let succeeded = false;
    if (confirmation.kind === "close-period") succeeded = await closePeriod(confirmationNote);
    if (confirmation.kind === "reopen-period") {
      if (!confirmationNote.trim()) return;
      succeeded = await reopenPeriod(confirmation.closureId, confirmationNote.trim());
    }
    if (confirmation.kind === "reject-correction") {
      if (!confirmationNote.trim()) return;
      succeeded = await decideCorrection(
        confirmation.correctionId,
        "reject",
        confirmationNote.trim(),
      );
    }
    if (confirmation.kind === "person-status") {
      if (!confirmationNote.trim()) return;
      succeeded = await changePersonStatus(
        confirmation.personId,
        confirmation.active,
        confirmationNote.trim(),
      );
    }
    if (confirmation.kind === "cancel-schedule") {
      if (!confirmationNote.trim()) return;
      succeeded = await cancelSchedule(confirmation.scheduleId, confirmationNote.trim());
    }
    if (confirmation.kind === "commission") {
      if (!confirmationNote.trim()) return;
      succeeded = await transitionCommission(
        confirmation.commissionId,
        confirmation.action,
        confirmationNote,
      );
    }
    if (!succeeded) return;
    setConfirmation(null);
    setConfirmationNote("");
  }
  if (remote.state.status === "error" && remote.state.httpStatus === 403) {
    return (
      <Card className="people-permission-card remote-state" role="alert">
        <Icon name="people" size={22} />
        <div>
          <strong>Acesso a Pessoas não autorizado</strong>
          <p>
            O proprietário desabilitou a consulta para este perfil nesta unidade. Solicite a
            permissão de ponto ao responsável pela operação.
          </p>
          {remote.state.requestId && <small>Referência: {remote.state.requestId}</small>}
        </div>
        <Button onClick={remote.retry} size="sm" variant="secondary">
          Tentar novamente
        </Button>
      </Card>
    );
  }
  return (
    <RemoteGate remote={remote}>
      {(data) => (
        <div className="growth-stack people-page">
          <Card className="people-overview">
            <div className="people-overview__header">
              <div>
                <p className="eyebrow">Visão da equipe</p>
                <h2>Operação de pessoas</h2>
              </div>
              <div className="gm-observability-row">
                <span
                  className="gm-pill"
                  data-tone={data.settings.mode === "off" ? "warning" : "positive"}
                >
                  <Icon name="clock" size={13} />
                  {data.settings.mode === "off" ? "Ponto desativado" : "Ponto ativo"}
                </span>
                <span className="gm-pill">
                  <Icon name="people" size={13} />
                  {data.canManage ? "Gestão habilitada" : "Somente consulta"}
                </span>
              </div>
            </div>
            <section className="people-overview__metrics" aria-label="Resumo operacional da equipe">
              <div>
                <span>Equipe ativa</span>
                <strong>{data.people.filter((person) => person.active).length}</strong>
                <small>de {data.people.length} cadastradas</small>
              </div>
              <div>
                <span>Em turno</span>
                <strong>{data.timeEntries.filter((entry) => !entry.clockedOutAt).length}</strong>
                <small>pontos abertos agora</small>
              </div>
              <div>
                <span>Pendências</span>
                <strong>
                  {data.alerts.length + data.anomalies.length + data.corrections.length}
                </strong>
                <small>alertas e análises</small>
              </div>
              <div>
                <span>Sem acesso</span>
                <strong>
                  {data.people.filter((person) => person.active && !person.identityId).length}
                </strong>
                <small>pessoas ativas sem conta</small>
              </div>
            </section>
          </Card>
          {section === "today" && indicators.state.status === "ready" && (
            <Card className="people-list-card people-indicators-card">
              <div className="card-header">
                <div>
                  <p className="eyebrow">Indicadores operacionais</p>
                  <h2>Escala × realizado</h2>
                </div>
                <Badge
                  tone={
                    indicators.state.data.coverage.laborCost === "complete" ? "success" : "warning"
                  }
                >
                  {indicators.state.data.period.from} a {indicators.state.data.period.to}
                </Badge>
              </div>
              <div className="people-indicator-grid">
                <div>
                  <span>Escalas</span>
                  <strong>{indicators.state.data.indicators.scheduledShifts}</strong>
                </div>
                <div>
                  <span>Faltas</span>
                  <strong>{indicators.state.data.indicators.absences}</strong>
                </div>
                <div>
                  <span>Atrasos</span>
                  <strong>{indicators.state.data.indicators.lateArrivals}</strong>
                </div>
                <div>
                  <span>Atrasos recorrentes</span>
                  <strong>{indicators.state.data.indicators.recurringLatePeople}</strong>
                </div>
                <div>
                  <span>Horas extras</span>
                  <strong>{hoursLabel(indicators.state.data.indicators.overtimeMinutes)}</strong>
                </div>
                <div>
                  <span>Custo de pessoal</span>
                  <strong>{formatCents(indicators.state.data.indicators.laborCostCents)}</strong>
                </div>
                <div>
                  <span>Custo sobre receita</span>
                  <strong>
                    {indicators.state.data.indicators.laborCostPercentage === null
                      ? "Sem cobertura"
                      : `${(indicators.state.data.indicators.laborCostPercentage * 100).toFixed(1)}%`}
                  </strong>
                </div>
              </div>
              <p className="people-coverage-note">
                Cobertura: escalas{" "}
                {indicators.state.data.coverage.schedules === "complete" ? "completa" : "parcial"}
                {"; "}
                ponto{" "}
                {indicators.state.data.coverage.timeEntries === "complete" ? "completo" : "parcial"}
                {"; "}custo{" "}
                {indicators.state.data.coverage.laborCost === "complete" ? "calculado" : "parcial"}
                {indicators.state.data.coverage.missingHourlyRatePeople
                  ? ` · ${indicators.state.data.coverage.missingHourlyRatePeople} pessoa(s) sem valor/hora.`
                  : "."}
              </p>
            </Card>
          )}
          <div className="people-command-bar gm-toolbar">
            <SegmentedTabs
              active={section}
              items={[
                {
                  id: "today",
                  label: "Hoje",
                  count: data.alerts.length + data.anomalies.length + data.corrections.length,
                  tone: data.alerts.length + data.anomalies.length ? "warning" : undefined,
                },
                { id: "team", label: "Equipe", count: data.people.length },
                { id: "schedules", label: "Escalas", count: data.schedules.length },
                {
                  id: "time",
                  label: "Ponto e relatórios",
                  count: data.timeEntries.filter((entry) => !entry.clockedOutAt).length,
                },
                { id: "settings", label: "Configurações" },
              ]}
              label="Área do módulo Pessoas"
              onChange={(nextSection) => {
                setSection(nextSection);
                setActionError("");
              }}
            />
          </div>
          {actionError && (
            <p className="people-page__error" role="alert">
              {actionError}
            </p>
          )}
          {section === "settings" && canConfigureTracking && (
            <details className="action-panel people-policy-panel">
              <summary>
                <span>
                  <strong>Política de ponto</strong>
                  <small>Defina quem registra, o raio e quem pode consultar.</small>
                </span>
                <Icon name="plus" size={18} />
              </summary>
              <p className="form-hint people-policy-note">
                O GPS é capturado somente no registro de entrada, pausa ou saída. Não há
                rastreamento contínuo.
              </p>
              <form
                className="action-form people-policy-form"
                onSubmit={(event) => void saveTrackingSettings(event)}
              >
                <label>
                  Aplicação
                  <select
                    value={trackingMode}
                    onChange={(event) => setTrackingMode(event.target.value as typeof trackingMode)}
                  >
                    <option value="off">Desativado</option>
                    <option value="all">Todos os funcionários ativos</option>
                    <option value="selected">Somente selecionados</option>
                  </select>
                </label>
                <label>
                  Local do restaurante
                  <input
                    value={locationLabel}
                    onChange={(event) => setLocationLabel(event.target.value)}
                    placeholder="Ex.: Unidade Centro"
                  />
                </label>
                <label>
                  Latitude
                  <input
                    inputMode="decimal"
                    min={-90}
                    max={90}
                    required={trackingMode !== "off"}
                    step="any"
                    type="number"
                    value={latitude}
                    onChange={(event) => setLatitude(event.target.value)}
                  />
                </label>
                <label>
                  Longitude
                  <input
                    inputMode="decimal"
                    min={-180}
                    max={180}
                    required={trackingMode !== "off"}
                    step="any"
                    type="number"
                    value={longitude}
                    onChange={(event) => setLongitude(event.target.value)}
                  />
                </label>
                <label>
                  Raio permitido (m)
                  <input
                    min={25}
                    max={5000}
                    required
                    type="number"
                    value={radiusMeters}
                    onChange={(event) => setRadiusMeters(event.target.value)}
                  />
                </label>
                <label>
                  Tolerância GPS (m)
                  <input
                    min={0}
                    max={500}
                    required
                    type="number"
                    value={accuracyToleranceMeters}
                    onChange={(event) => setAccuracyToleranceMeters(event.target.value)}
                  />
                </label>
                <label className="action-form__check">
                  <input
                    checked={geofenceEnabled}
                    onChange={(event) => setGeofenceEnabled(event.target.checked)}
                    type="checkbox"
                  />
                  Bloquear marcações fora do raio
                </label>
                <label className="action-form__check">
                  <input
                    checked={managerCanView}
                    onChange={(event) => setManagerCanView(event.target.checked)}
                    type="checkbox"
                  />
                  Permitir consulta ao gerente
                </label>
                <label className="action-form__check">
                  <input
                    checked={financeCanView}
                    onChange={(event) => setFinanceCanView(event.target.checked)}
                    type="checkbox"
                  />
                  Permitir consulta ao contador
                </label>
                <label className="action-form__check">
                  <input
                    checked={antiFraudEnabled}
                    onChange={(event) => setAntiFraudEnabled(event.target.checked)}
                    type="checkbox"
                  />
                  Detectar sinais de fraude
                </label>
                <label className="action-form__check">
                  <input
                    checked={offlineEnabled}
                    onChange={(event) => setOfflineEnabled(event.target.checked)}
                    type="checkbox"
                  />
                  Permitir marcação offline
                </label>
                <label className="action-form__check">
                  <input
                    checked={notificationsEnabled}
                    onChange={(event) => setNotificationsEnabled(event.target.checked)}
                    type="checkbox"
                  />
                  Exibir alertas automáticos
                </label>
                <label className="action-form__check">
                  <input
                    checked={managerAlertOnAnomaly}
                    onChange={(event) => setManagerAlertOnAnomaly(event.target.checked)}
                    type="checkbox"
                  />
                  Alertar sobre anomalias
                </label>
                <label>
                  Tolerância de atraso (min)
                  <input
                    min={0}
                    max={120}
                    type="number"
                    value={lateToleranceMinutes}
                    onChange={(event) => setLateToleranceMinutes(event.target.value)}
                  />
                </label>
                <label>
                  Pausa mínima (min)
                  <input
                    min={0}
                    max={1440}
                    type="number"
                    value={minimumBreakMinutes}
                    onChange={(event) => setMinimumBreakMinutes(event.target.value)}
                  />
                </label>
                <label>
                  Limite de hora extra (min)
                  <input
                    min={0}
                    max={720}
                    type="number"
                    value={maxOvertimeMinutes}
                    onChange={(event) => setMaxOvertimeMinutes(event.target.value)}
                  />
                </label>
                <label>
                  Alerta de turno longo (min)
                  <input
                    min={60}
                    max={1440}
                    type="number"
                    value={longShiftAlertMinutes}
                    onChange={(event) => setLongShiftAlertMinutes(event.target.value)}
                  />
                </label>
                <label>
                  Lembrete antes da escala (min)
                  <input
                    min={0}
                    max={240}
                    type="number"
                    value={reminderBeforeShiftMinutes}
                    onChange={(event) => setReminderBeforeShiftMinutes(event.target.value)}
                  />
                </label>
                <label>
                  Lembrete após a escala (min)
                  <input
                    min={0}
                    max={240}
                    type="number"
                    value={reminderAfterShiftMinutes}
                    onChange={(event) => setReminderAfterShiftMinutes(event.target.value)}
                  />
                </label>
                {trackingMode === "selected" && (
                  <fieldset className="action-form__wide">
                    <legend>Funcionários habilitados</legend>
                    {data.people
                      .filter((person) => person.active && person.identityId)
                      .map((person) => (
                        <label className="action-form__check" key={person.id}>
                          <input
                            checked={selectedPersonIds.includes(person.id)}
                            onChange={(event) =>
                              setSelectedPersonIds((current) =>
                                event.target.checked
                                  ? [...new Set([...current, person.id])]
                                  : current.filter((id) => id !== person.id),
                              )
                            }
                            type="checkbox"
                          />
                          {person.name} · {person.roleLabel}
                        </label>
                      ))}
                  </fieldset>
                )}
                <Button disabled={actionId === "tracking-settings"} type="submit">
                  {actionId === "tracking-settings" ? "Salvando…" : "Salvar política"}
                </Button>
              </form>
            </details>
          )}
          {section === "settings" && !canConfigureTracking && (
            <Card className="people-permission-card">
              <Icon name="settings" size={20} />
              <div>
                <h2>Política definida pelo proprietário</h2>
                <p>
                  {capabilities.state.status === "ready" && capabilities.state.data.reason
                    ? permissionReason(capabilities.state.data.reason)
                    : "Seu perfil possui acesso de consulta. Alterações de geolocalização, tolerâncias e fechamento permanecem restritas ao proprietário da unidade."}
                </p>
              </div>
            </Card>
          )}
          {section === "team" && data.canManage && (
            <details className="action-panel">
              <summary>
                <span>
                  <strong>Nova pessoa</strong>
                  <small>Cadastre função e identificação interna.</small>
                </span>
                <Icon name="plus" size={18} />
              </summary>
              <form className="action-form" onSubmit={(event) => void createPerson(event)}>
                <label>
                  Nome
                  <input
                    minLength={2}
                    onChange={(event) => setPersonName(event.target.value)}
                    required
                    value={personName}
                  />
                </label>
                <label>
                  Função
                  <input
                    minLength={1}
                    onChange={(event) => setRoleLabel(event.target.value)}
                    placeholder="Ex.: Garçom"
                    required
                    value={roleLabel}
                  />
                </label>
                <label>
                  Código interno
                  <input
                    onChange={(event) => setEmploymentCode(event.target.value)}
                    value={employmentCode}
                  />
                </label>
                <label>
                  Conta de acesso
                  <select
                    onChange={(event) => setPersonIdentityId(event.target.value)}
                    value={personIdentityId}
                  >
                    <option value="">Sem conta vinculada</option>
                    {data.accounts
                      .filter(
                        (account) =>
                          !data.people.some((person) => person.identityId === account.id),
                      )
                      .map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.displayName} · {account.email}
                        </option>
                      ))}
                  </select>
                </label>
                <Button
                  disabled={
                    actionId === "new-person" ||
                    personName.trim().length < 2 ||
                    roleLabel.trim().length < 1
                  }
                  type="submit"
                >
                  {actionId === "new-person" ? "Salvando…" : "Cadastrar pessoa"}
                </Button>
              </form>
            </details>
          )}
          {data.canManage && (section === "schedules" || section === "time") && (
            <div className="quick-actions-grid">
              {section === "schedules" && (
                <details className="action-panel">
                  <summary>
                    <span>
                      <strong>Nova escala</strong>
                      <small>Defina início, fim e intervalo.</small>
                    </span>
                    <Icon name="plus" size={18} />
                  </summary>
                  <form className="action-form" onSubmit={(event) => void createSchedule(event)}>
                    <label className="action-form__wide">
                      Pessoa
                      <select
                        onChange={(event) => setSchedulePersonId(event.target.value)}
                        required
                        value={schedulePersonId}
                      >
                        <option value="">Selecione</option>
                        {data.people
                          .filter((person) => person.active)
                          .map((person) => (
                            <option key={person.id} value={person.id}>
                              {person.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Início
                      <input
                        onChange={(event) => setScheduleStart(event.target.value)}
                        required
                        type="datetime-local"
                        value={scheduleStart}
                      />
                    </label>
                    <label>
                      Fim
                      <input
                        onChange={(event) => setScheduleEnd(event.target.value)}
                        required
                        type="datetime-local"
                        value={scheduleEnd}
                      />
                    </label>
                    <label>
                      Intervalo (min)
                      <input
                        max={1440}
                        min={0}
                        onChange={(event) => setBreakMinutes(event.target.value)}
                        required
                        type="number"
                        value={breakMinutes}
                      />
                    </label>
                    <label className="action-form__wide">
                      Observação
                      <input
                        maxLength={1000}
                        onChange={(event) => setScheduleNotes(event.target.value)}
                        placeholder="Opcional"
                        value={scheduleNotes}
                      />
                    </label>
                    <Button
                      disabled={
                        actionId === "schedule" ||
                        !schedulePersonId ||
                        !scheduleStart ||
                        !scheduleEnd
                      }
                      type="submit"
                    >
                      Salvar escala
                    </Button>
                  </form>
                </details>
              )}
              {section === "time" && (
                <details className="action-panel">
                  <summary>
                    <span>
                      <strong>Abrir ponto manual</strong>
                      <small>Registre a entrada com trilha de auditoria.</small>
                    </span>
                    <Icon name="plus" size={18} />
                  </summary>
                  <form className="action-form" onSubmit={(event) => void createTimeEntry(event)}>
                    <label>
                      Pessoa
                      <select
                        onChange={(event) => setTimePersonId(event.target.value)}
                        required
                        value={timePersonId}
                      >
                        <option value="">Selecione</option>
                        {data.people
                          .filter((person) => person.active)
                          .map((person) => (
                            <option key={person.id} value={person.id}>
                              {person.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Entrada
                      <input
                        onChange={(event) => setClockedInAt(event.target.value)}
                        required
                        type="datetime-local"
                        value={clockedInAt}
                      />
                    </label>
                    <Button
                      disabled={actionId === "time-entry" || !timePersonId || !clockedInAt}
                      type="submit"
                    >
                      Registrar entrada
                    </Button>
                  </form>
                </details>
              )}
            </div>
          )}
          {section === "today" && data.alerts.length > 0 && (
            <Card className="people-attention-card people-attention-card--warning">
              <div className="card-header">
                <div>
                  <p className="eyebrow">Notificações</p>
                  <h2>Ações pendentes do ponto</h2>
                </div>
                <Badge tone="warning">{data.alerts.length}</Badge>
              </div>
              <div className="management-list">
                {data.alerts.slice(0, 12).map((alert) => (
                  <div
                    className="management-row"
                    key={`${alert.type}-${alert.personId}-${alert.timeEntryId ?? alert.message}`}
                  >
                    <span>
                      <strong>{personById.get(alert.personId)?.name ?? "Funcionário"}</strong>
                      <small>{alert.message}</small>
                    </span>
                    <Badge tone={alert.severity === "danger" ? "danger" : "warning"}>
                      {anomalyLabel(alert.type)}
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {section === "today" && data.anomalies.length > 0 && (
            <Card className="people-attention-card people-attention-card--danger">
              <div className="card-header">
                <div>
                  <p className="eyebrow">Atenção</p>
                  <h2>Anomalias do ponto</h2>
                </div>
                <Badge tone="warning">{data.anomalies.length}</Badge>
              </div>
              <div className="management-list">
                {data.anomalies.map((anomaly) => (
                  <div className="management-row" key={anomaly.timeEntryId}>
                    <span>
                      <strong>{personById.get(anomaly.personId)?.name ?? "Funcionário"}</strong>
                      <small>
                        {anomaly.date} · {anomaly.anomalyCodes.map(anomalyLabel).join(", ")}
                      </small>
                    </span>
                    <Badge tone="warning">{hoursLabel(anomaly.workedMinutes)}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {section === "today" && data.canManage && data.corrections.length > 0 && (
            <Card className="people-attention-card people-attention-card--warning">
              <div className="card-header">
                <div>
                  <p className="eyebrow">Aprovação</p>
                  <h2>Correções aguardando análise</h2>
                </div>
                <Badge tone="warning">{data.corrections.length}</Badge>
              </div>
              <div className="management-list">
                {data.corrections.map((correction) => (
                  <div className="management-row" key={correction.id}>
                    <span>
                      <strong>{personById.get(correction.personId)?.name ?? "Funcionário"}</strong>
                      <small>
                        {dateLabel(correction.requestedClockedInAt)} · {correction.reason}
                        {correction.requiresSpecialApproval ? " · Aprovação do proprietário" : ""}
                      </small>
                    </span>
                    <span className="time-clock-banner__actions">
                      <Button
                        disabled={
                          actionId === correction.id ||
                          (correction.requiresSpecialApproval && scope.profileId !== "owner")
                        }
                        onClick={() => void decideCorrection(correction.id, "approve")}
                        size="sm"
                      >
                        Aprovar
                      </Button>
                      <Button
                        disabled={
                          actionId === correction.id ||
                          (correction.requiresSpecialApproval && scope.profileId !== "owner")
                        }
                        onClick={() => {
                          setActionError("");
                          setConfirmation({
                            kind: "reject-correction",
                            correctionId: correction.id,
                          });
                          setConfirmationNote("");
                        }}
                        size="sm"
                        variant="secondary"
                      >
                        Rejeitar
                      </Button>
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {section === "time" && (
            <Card className="people-report-card">
              <div className="card-header">
                <div>
                  <p className="eyebrow">Fechamento</p>
                  <h2>Relatório de horas</h2>
                </div>
                {report && (
                  <Badge tone={report.totals.anomalies ? "warning" : "success"}>
                    {hoursLabel(report.totals.workedMinutes)}
                  </Badge>
                )}
              </div>
              <form
                className="action-form people-report-form"
                onSubmit={(event) => void loadReport(event)}
              >
                <label>
                  De
                  <input
                    type="date"
                    required
                    value={reportFrom}
                    onChange={(event) => setReportFrom(event.target.value)}
                  />
                </label>
                <label>
                  Até
                  <input
                    type="date"
                    required
                    value={reportTo}
                    onChange={(event) => setReportTo(event.target.value)}
                  />
                </label>
                <Button disabled={actionId === "time-report"} type="submit">
                  {actionId === "time-report" ? "Carregando…" : "Consultar horas"}
                </Button>
                {report && (
                  <Button onClick={downloadReport} type="button" variant="secondary">
                    Exportar CSV
                  </Button>
                )}
                {scope.profileId === "owner" && (
                  <Button
                    disabled={actionId === "close-period"}
                    onClick={() => {
                      setActionError("");
                      setConfirmation({ kind: "close-period" });
                      setConfirmationNote("");
                    }}
                    type="button"
                    variant="secondary"
                  >
                    {actionId === "close-period" ? "Fechando…" : "Fechar período"}
                  </Button>
                )}
              </form>
              {report && (
                <p className="form-hint">
                  {report.totals.entries} turno(s) · {hoursLabel(report.totals.breakMinutes)} em
                  pausas · {hoursLabel(report.totals.overtimeMinutes)} extras ·{" "}
                  {report.totals.anomalies} com anomalia · custo estimado{" "}
                  {formatCents(report.totals.laborCostCents)} ·{" "}
                  {report.totals.laborCostPercentage === null
                    ? "receita sem dados"
                    : `${(report.totals.laborCostPercentage * 100).toFixed(1)}% da receita`}
                </p>
              )}
              {report && report.rows.length > 0 && (
                <DataTable
                  caption="Detalhamento do relatório de horas"
                  className="people-report-table"
                >
                  <thead>
                    <tr>
                      <th scope="col">Pessoa</th>
                      <th scope="col">Entrada</th>
                      <th scope="col">Saída</th>
                      <th scope="col">Trabalhado</th>
                      <th scope="col">Pausas</th>
                      <th scope="col">Extras</th>
                      <th scope="col">Custo estimado</th>
                      <th scope="col">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.personName}</strong>
                          <small className="people-report-table__date">{row.summary.date}</small>
                        </td>
                        <td>{dateLabel(row.clockedInAt)}</td>
                        <td>{row.clockedOutAt ? dateLabel(row.clockedOutAt) : "Em andamento"}</td>
                        <td>{hoursLabel(row.summary.workedMinutes)}</td>
                        <td>{hoursLabel(row.summary.breakMinutes)}</td>
                        <td>{hoursLabel(row.summary.overtimeMinutes)}</td>
                        <td>
                          {row.estimatedLaborCostCents === null
                            ? "Não calculado"
                            : formatCents(row.estimatedLaborCostCents)}
                        </td>
                        <td>
                          {row.summary.anomalyCodes.length ? (
                            <Badge tone="warning">
                              {row.summary.anomalyCodes.map(anomalyLabel).join(", ")}
                            </Badge>
                          ) : (
                            <Badge tone="success">Regular</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              )}
              {report && report.rows.length === 0 && (
                <EmptyState
                  description="Ajuste o período ou confirme se houve registros de ponto."
                  icon="◷"
                  title="Nenhum turno no período"
                />
              )}
              {data.closures.length > 0 && (
                <div className="management-list">
                  {data.closures.map((closure) => (
                    <div className="management-row" key={closure.id}>
                      <span>
                        <strong>
                          Período fechado: {closure.periodStart} a {closure.periodEnd}
                        </strong>
                        <small>{closure.reason ?? "Alterações exigem correção aprovada."}</small>
                      </span>
                      {scope.profileId === "owner" && (
                        <Button
                          disabled={actionId === closure.id}
                          onClick={() => {
                            setActionError("");
                            setConfirmation({ kind: "reopen-period", closureId: closure.id });
                            setConfirmationNote("");
                          }}
                          size="sm"
                          variant="secondary"
                        >
                          Reabrir
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
          {section === "today" && (
            <div className="people-grid people-today-grid">
              <Card className="people-list-card">
                <div className="card-header">
                  <div>
                    <p className="eyebrow">Agora</p>
                    <h2>Turnos em andamento</h2>
                  </div>
                  <Badge tone="info">
                    {data.timeEntries.filter((entry) => !entry.clockedOutAt).length}
                  </Badge>
                </div>
                <div className="management-list">
                  {data.timeEntries
                    .filter((entry) => !entry.clockedOutAt)
                    .map((entry) => (
                      <div className="management-row people-row" key={entry.id}>
                        <span className="people-row__icon" aria-hidden="true">
                          <Icon name="clock" size={17} />
                        </span>
                        <span>
                          <strong>
                            {personById.get(entry.personId)?.name ?? "Pessoa não encontrada"}
                          </strong>
                          <small>
                            Entrada {dateLabel(entry.clockedInAt)} ·{" "}
                            {hoursLabel(workedMinutes(entry, data.breaks))}
                          </small>
                        </span>
                        {data.canManage && (
                          <Button
                            disabled={actionId === entry.id}
                            onClick={() => void clockOut(entry.id)}
                            size="sm"
                            variant="secondary"
                          >
                            Registrar saída
                          </Button>
                        )}
                      </div>
                    ))}
                  {!data.timeEntries.some((entry) => !entry.clockedOutAt) && (
                    <EmptyState
                      description="As próximas entradas aparecerão aqui."
                      icon="◷"
                      title="Nenhum turno aberto"
                    />
                  )}
                </div>
              </Card>
              <Card className="people-list-card">
                <div className="card-header">
                  <div>
                    <p className="eyebrow">Planejado para hoje</p>
                    <h2>Entradas e saídas previstas</h2>
                  </div>
                </div>
                <div className="management-list">
                  {data.schedules
                    .filter(
                      (schedule) =>
                        new Date(schedule.startsAt).toDateString() === new Date().toDateString(),
                    )
                    .slice(0, 12)
                    .map((schedule) => {
                      const startsAt = new Date(schedule.startsAt).getTime();
                      const endsAt = new Date(schedule.endsAt).getTime();
                      const matchingEntry = data.timeEntries.find(
                        (entry) =>
                          entry.personId === schedule.personId &&
                          new Date(entry.clockedInAt).getTime() < endsAt &&
                          (!entry.clockedOutAt ||
                            new Date(entry.clockedOutAt).getTime() > startsAt),
                      );
                      const scheduleState = matchingEntry?.clockedOutAt
                        ? { label: "Turno encerrado", tone: "success" as const }
                        : matchingEntry
                          ? { label: "Em turno", tone: "success" as const }
                          : startsAt > Date.now()
                            ? { label: "Aguardando entrada", tone: "neutral" as const }
                            : endsAt > Date.now()
                              ? { label: "Entrada pendente", tone: "warning" as const }
                              : { label: "Janela encerrada", tone: "neutral" as const };
                      return (
                        <div className="management-row" key={schedule.id}>
                          <span>
                            <strong>
                              {personById.get(schedule.personId)?.name ?? "Pessoa não encontrada"}
                            </strong>
                            <small>
                              {dateLabel(schedule.startsAt)} até {dateLabel(schedule.endsAt)} ·{" "}
                              {schedule.breakMinutes} min de intervalo
                            </small>
                          </span>
                          <Badge tone={scheduleState.tone}>{scheduleState.label}</Badge>
                        </div>
                      );
                    })}
                  {!data.schedules.some(
                    (schedule) =>
                      new Date(schedule.startsAt).toDateString() === new Date().toDateString(),
                  ) && (
                    <EmptyState
                      description="Cadastre uma escala para orientar o turno de hoje."
                      icon="＋"
                      title="Sem escalas para hoje"
                    />
                  )}
                </div>
              </Card>
            </div>
          )}

          {section === "team" && data.people.length > 0 && (
            <>
              <div className="people-team-tools gm-toolbar">
                <SearchField
                  onChange={(event) => {
                    setPeopleQuery(event.target.value);
                    setPeoplePage(1);
                  }}
                  placeholder="Buscar por nome ou função"
                  value={peopleQuery}
                />
                <select
                  aria-label="Filtrar situação da pessoa"
                  className="gm-control gm-control--compact"
                  onChange={(event) => {
                    setPeopleFilter(event.target.value as PeopleFilter);
                    setPeoplePage(1);
                  }}
                  value={peopleFilter}
                >
                  <option value="all">Todas as situações</option>
                  <option value="active">Ativas</option>
                  <option value="inactive">Inativas</option>
                  <option value="unlinked">Sem conta vinculada</option>
                  <option value="on_shift">Em turno agora</option>
                </select>
                <select
                  aria-label="Filtrar por função"
                  className="gm-control gm-control--compact"
                  onChange={(event) => {
                    setPeopleRole(event.target.value);
                    setPeoplePage(1);
                  }}
                  value={peopleRole}
                >
                  <option value="all">Todas as funções</option>
                  {[...new Set(data.people.map((person) => person.roleLabel))]
                    .sort((left, right) => left.localeCompare(right, "pt-BR"))
                    .map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                </select>
              </div>
              {data.canManage && batchPersonIds.length > 0 && (
                <section className="people-batch-bar" aria-label="Ações em lote">
                  <strong>{batchPersonIds.length} selecionada(s)</strong>
                  <Button
                    disabled={actionId !== ""}
                    onClick={() => void updateAssignments(true)}
                    size="sm"
                    variant="secondary"
                  >
                    Habilitar ponto
                  </Button>
                  <Button
                    disabled={actionId !== ""}
                    onClick={() => void updateAssignments(false)}
                    size="sm"
                    variant="secondary"
                  >
                    Desabilitar ponto
                  </Button>
                  <Button
                    disabled={actionId !== ""}
                    onClick={() => void exportSelectedPeople("csv")}
                    size="sm"
                    variant="ghost"
                  >
                    Exportar CSV
                  </Button>
                  <Button onClick={() => setBatchPersonIds([])} size="sm" variant="ghost">
                    Limpar
                  </Button>
                </section>
              )}
              <Card className="people-list-card">
                <div className="card-header">
                  <div>
                    <p className="eyebrow">Equipe</p>
                    <h2>Pessoas da unidade</h2>
                  </div>
                  <Badge tone="success">
                    {directory.state.status === "ready"
                      ? `${directory.state.data.pagination.total} encontrada(s)`
                      : "Consultando"}
                  </Badge>
                </div>
                <div className="management-list">
                  {visiblePeople.map((person) => (
                    <div
                      className={`management-row people-row ${data.canManage ? "people-row--selectable" : ""}`}
                      key={person.id}
                    >
                      {data.canManage && (
                        <input
                          aria-label={`Selecionar ${person.name}`}
                          checked={batchPersonIds.includes(person.id)}
                          onChange={(event) =>
                            setBatchPersonIds((current) =>
                              event.target.checked
                                ? [...new Set([...current, person.id])]
                                : current.filter((id) => id !== person.id),
                            )
                          }
                          type="checkbox"
                        />
                      )}
                      <span className="people-row__icon" aria-hidden="true">
                        <Icon name="user" size={17} />
                      </span>
                      <span>
                        <strong>{person.name}</strong>
                        <small>
                          {person.roleLabel} · {person.identityId ? "Conta vinculada" : "Sem conta"}
                        </small>
                      </span>
                      <Badge tone={person.active ? "success" : "neutral"}>
                        {person.active ? "Ativa" : "Inativa"}
                      </Badge>
                      <Button onClick={() => openPerson(person)} size="sm" variant="ghost">
                        Ver detalhes
                      </Button>
                    </div>
                  ))}
                  {directory.state.status === "loading" && (
                    <p className="people-directory-status" role="status">
                      Carregando pessoas…
                    </p>
                  )}
                  {directory.state.status === "ready" && !visiblePeople.length && (
                    <EmptyState
                      description="Altere a busca ou os filtros selecionados."
                      icon="⌕"
                      title="Nenhuma pessoa encontrada"
                    />
                  )}
                  {directory.state.status === "error" && (
                    <p className="people-page__error" role="alert">
                      {directory.state.message}
                    </p>
                  )}
                </div>
                {directory.state.status === "ready" &&
                  directory.state.data.pagination.pageCount > 1 && (
                    <nav className="people-pagination" aria-label="Paginação da equipe">
                      <Button
                        disabled={peoplePage <= 1}
                        onClick={() => setPeoplePage((page) => Math.max(1, page - 1))}
                        size="sm"
                        variant="secondary"
                      >
                        Anterior
                      </Button>
                      <span>
                        Página {directory.state.data.pagination.page} de{" "}
                        {directory.state.data.pagination.pageCount}
                      </span>
                      <Button
                        disabled={peoplePage >= directory.state.data.pagination.pageCount}
                        onClick={() => setPeoplePage((page) => page + 1)}
                        size="sm"
                        variant="secondary"
                      >
                        Próxima
                      </Button>
                    </nav>
                  )}
              </Card>
            </>
          )}

          {section === "team" && !data.people.length && (
            <Card className="people-list-card">
              <EmptyState
                description="Cadastre pessoas para administrar escalas, ponto e comissões."
                icon="＋"
                title="Equipe ainda não cadastrada"
              />
            </Card>
          )}

          {section === "team" &&
            capabilities.state.status === "ready" &&
            (data.canManage ||
              capabilities.state.data.canApproveCommissions ||
              capabilities.state.data.canPayCommissions) && (
              <Card className="people-commission-card">
                <div className="card-header">
                  <div>
                    <p className="eyebrow">Remuneração variável</p>
                    <h2>Comissões</h2>
                  </div>
                  <Badge tone="info">{data.commissions.length} lançadas</Badge>
                </div>
                {data.canManage && (
                  <div className="people-commission-forms">
                    <form
                      className="action-form"
                      onSubmit={(event) => void createCommissionRule(event)}
                    >
                      <label>
                        Nome da regra
                        <input
                          maxLength={120}
                          onChange={(event) => setCommissionRuleName(event.target.value)}
                          placeholder="Ex.: Venda do salão"
                          required
                          value={commissionRuleName}
                        />
                      </label>
                      <label>
                        Percentual (%)
                        <input
                          max={100}
                          min={0}
                          onChange={(event) => setCommissionRate(event.target.value)}
                          required
                          step="0.01"
                          type="number"
                          value={commissionRate}
                        />
                      </label>
                      <Button
                        disabled={
                          actionId === "commission-rule" ||
                          !commissionRuleName.trim() ||
                          commissionRate === ""
                        }
                        type="submit"
                        variant="secondary"
                      >
                        Cadastrar regra
                      </Button>
                    </form>
                    <form
                      className="action-form"
                      onSubmit={(event) => void createCommission(event)}
                    >
                      <label>
                        Pessoa
                        <select
                          onChange={(event) => setCommissionPersonId(event.target.value)}
                          required
                          value={commissionPersonId}
                        >
                          <option value="">Selecione</option>
                          {data.people
                            .filter((person) => person.active)
                            .map((person) => (
                              <option key={person.id} value={person.id}>
                                {person.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Regra
                        <select
                          onChange={(event) => setCommissionRuleId(event.target.value)}
                          value={commissionRuleId}
                        >
                          <option value="">Valor manual</option>
                          {data.commissionRules
                            .filter((rule) => rule.active)
                            .map((rule) => (
                              <option key={rule.id} value={rule.id}>
                                {rule.name} · {(rule.basisPoints / 100).toFixed(2)}%
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Base da comissão (R$)
                        <input
                          max={21474836.47}
                          min={0}
                          onChange={(event) => setCommissionBase(event.target.value)}
                          required
                          step="0.01"
                          type="number"
                          value={commissionBase}
                        />
                      </label>
                      {!commissionRuleId && (
                        <label>
                          Comissão manual (R$)
                          <input
                            max={21474836.47}
                            min={0}
                            onChange={(event) => setCommissionAmount(event.target.value)}
                            required
                            step="0.01"
                            type="number"
                            value={commissionAmount}
                          />
                        </label>
                      )}
                      <Button
                        disabled={
                          actionId === "commission" ||
                          !commissionPersonId ||
                          !commissionBase ||
                          (!commissionRuleId && !commissionAmount)
                        }
                        type="submit"
                      >
                        Lançar comissão
                      </Button>
                    </form>
                  </div>
                )}
                <div className="management-list">
                  {data.commissions.slice(0, 20).map((commission) => (
                    <div className="management-row people-commission-row" key={commission.id}>
                      <span>
                        <strong>
                          {personById.get(commission.personId)?.name ?? "Pessoa não encontrada"}
                        </strong>
                        <small>
                          Base {formatCents(commission.baseCents)} · criado em{" "}
                          {dateLabel(commission.createdAt)}
                        </small>
                      </span>
                      <strong>{formatCents(commission.amountCents)}</strong>
                      <Badge
                        tone={
                          commission.status === "canceled" || commission.status === "rejected"
                            ? "danger"
                            : commission.status === "paid"
                              ? "success"
                              : "info"
                        }
                      >
                        {commission.status === "pending"
                          ? "Pendente"
                          : commission.status === "approved"
                            ? "Aprovada"
                            : commission.status === "rejected"
                              ? "Rejeitada"
                              : commission.status === "paid"
                                ? "Paga"
                                : "Cancelada"}
                      </Badge>
                      <span className="time-clock-banner__actions">
                        {commission.status === "pending" &&
                          capabilities.state.status === "ready" &&
                          capabilities.state.data.canApproveCommissions && (
                            <>
                              <Button
                                onClick={() => {
                                  setConfirmation({
                                    kind: "commission",
                                    commissionId: commission.id,
                                    action: "approve",
                                  });
                                  setConfirmationNote("");
                                }}
                                size="sm"
                              >
                                Aprovar
                              </Button>
                              <Button
                                onClick={() => {
                                  setConfirmation({
                                    kind: "commission",
                                    commissionId: commission.id,
                                    action: "reject",
                                  });
                                  setConfirmationNote("");
                                }}
                                size="sm"
                                variant="secondary"
                              >
                                Rejeitar
                              </Button>
                            </>
                          )}
                        {commission.status === "approved" &&
                          capabilities.state.status === "ready" &&
                          capabilities.state.data.canPayCommissions && (
                            <Button
                              onClick={() => {
                                setConfirmation({
                                  kind: "commission",
                                  commissionId: commission.id,
                                  action: "pay",
                                });
                                setConfirmationNote("");
                              }}
                              size="sm"
                            >
                              Marcar paga
                            </Button>
                          )}
                        {(commission.status === "pending" || commission.status === "approved") &&
                          capabilities.state.status === "ready" &&
                          capabilities.state.data.canApproveCommissions && (
                            <Button
                              onClick={() => {
                                setConfirmation({
                                  kind: "commission",
                                  commissionId: commission.id,
                                  action: "cancel",
                                });
                                setConfirmationNote("");
                              }}
                              size="sm"
                              variant="ghost"
                            >
                              Cancelar
                            </Button>
                          )}
                      </span>
                    </div>
                  ))}
                  {!data.commissions.length && (
                    <EmptyState
                      description="Cadastre uma regra ou informe um valor manual."
                      icon="$"
                      title="Nenhuma comissão lançada"
                    />
                  )}
                </div>
              </Card>
            )}

          {section === "schedules" && data.canManage && (
            <details className="action-panel people-batch-panel">
              <summary>
                <span>
                  <strong>Escalas em lote</strong>
                  <small>Selecione pessoas, revise conflitos e só então confirme.</small>
                </span>
                <Icon name="plus" size={18} />
              </summary>
              <div className="people-batch-schedule">
                <fieldset>
                  <legend>Pessoas</legend>
                  {data.people
                    .filter((person) => person.active)
                    .map((person) => (
                      <label className="action-form__check" key={person.id}>
                        <input
                          checked={batchPersonIds.includes(person.id)}
                          onChange={(event) =>
                            setBatchPersonIds((current) =>
                              event.target.checked
                                ? [...new Set([...current, person.id])]
                                : current.filter((id) => id !== person.id),
                            )
                          }
                          type="checkbox"
                        />
                        {person.name}
                      </label>
                    ))}
                </fieldset>
                <div className="action-form">
                  <label>
                    Início
                    <input
                      required
                      type="datetime-local"
                      value={scheduleStart}
                      onChange={(event) => {
                        setScheduleStart(event.target.value);
                        setBatchPreview(null);
                      }}
                    />
                  </label>
                  <label>
                    Fim
                    <input
                      required
                      type="datetime-local"
                      value={scheduleEnd}
                      onChange={(event) => {
                        setScheduleEnd(event.target.value);
                        setBatchPreview(null);
                      }}
                    />
                  </label>
                  <label>
                    Intervalo (min)
                    <input
                      min={0}
                      max={1440}
                      type="number"
                      value={breakMinutes}
                      onChange={(event) => {
                        setBreakMinutes(event.target.value);
                        setBatchPreview(null);
                      }}
                    />
                  </label>
                  <label>
                    Observação
                    <input
                      maxLength={1000}
                      value={scheduleNotes}
                      onChange={(event) => {
                        setScheduleNotes(event.target.value);
                        setBatchPreview(null);
                      }}
                    />
                  </label>
                  <Button
                    disabled={
                      !batchPersonIds.length || !scheduleStart || !scheduleEnd || actionId !== ""
                    }
                    onClick={() => void previewScheduleBatch()}
                    type="button"
                    variant="secondary"
                  >
                    Pré-visualizar lote
                  </Button>
                </div>
                {batchPreview && (
                  <div className="people-batch-preview" role="status">
                    <strong>{batchPreview.schedules.length} escala(s) na prévia</strong>
                    {batchPreview.conflicts.length ? (
                      <ul>
                        {batchPreview.conflicts.map((conflict) => (
                          <li key={`${conflict.personId}-${conflict.message}`}>
                            {personById.get(conflict.personId)?.name ?? "Pessoa"}:{" "}
                            {conflict.message}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>Nenhum conflito detectado. O lote está pronto para confirmação.</p>
                    )}
                    <Button
                      disabled={batchPreview.conflicts.length > 0 || actionId !== ""}
                      onClick={() => void createScheduleBatch()}
                      type="button"
                    >
                      Confirmar lote
                    </Button>
                  </div>
                )}
              </div>
            </details>
          )}

          {section === "schedules" && (
            <Card className="people-list-card">
              <div className="card-header">
                <div>
                  <p className="eyebrow">Planejamento</p>
                  <h2>Escalas cadastradas</h2>
                </div>
                <Badge tone="info">{data.schedules.length}</Badge>
              </div>
              <div className="management-list">
                {data.schedules.map((schedule) => (
                  <div className="management-row" key={schedule.id}>
                    <span>
                      <strong>
                        {personById.get(schedule.personId)?.name ?? "Pessoa não encontrada"}
                      </strong>
                      <small>
                        {dateLabel(schedule.startsAt)} até {dateLabel(schedule.endsAt)}
                      </small>
                    </span>
                    <Badge tone="neutral">{schedule.breakMinutes} min de intervalo</Badge>
                    {data.canManage && schedule.status !== "canceled" && (
                      <span className="time-clock-banner__actions">
                        <Button
                          onClick={() => editSchedule(schedule.id)}
                          size="sm"
                          variant="secondary"
                        >
                          Editar
                        </Button>
                        <Button
                          onClick={() => {
                            setConfirmation({ kind: "cancel-schedule", scheduleId: schedule.id });
                            setConfirmationNote("");
                          }}
                          size="sm"
                          variant="ghost"
                        >
                          Cancelar
                        </Button>
                      </span>
                    )}
                  </div>
                ))}
                {!data.schedules.length && (
                  <EmptyState
                    description="Use “Nova escala” para planejar o próximo turno."
                    icon="＋"
                    title="Nenhuma escala cadastrada"
                  />
                )}
              </div>
            </Card>
          )}

          {section === "time" && (
            <Card className="people-list-card">
              <div className="card-header">
                <div>
                  <p className="eyebrow">Ponto</p>
                  <h2>Turnos e horas trabalhadas</h2>
                </div>
              </div>
              <div className="management-list">
                {data.timeEntries.map((entry) => (
                  <div className="management-row people-row" key={entry.id}>
                    <span className="people-row__icon" aria-hidden="true">
                      <Icon name="clock" size={17} />
                    </span>
                    <span>
                      <strong>
                        {personById.get(entry.personId)?.name ?? "Pessoa não encontrada"}
                      </strong>
                      <small>
                        {dateLabel(entry.clockedInAt)} ·{" "}
                        {hoursLabel(workedMinutes(entry, data.breaks))}·{" "}
                        {entry.clockedOutAt ? "Encerrado" : "Em andamento"}
                      </small>
                    </span>
                    {!entry.clockedOutAt && data.canManage && (
                      <Button
                        disabled={actionId === entry.id}
                        onClick={() => void clockOut(entry.id)}
                        size="sm"
                        variant="secondary"
                      >
                        {actionId === entry.id ? "Registrando…" : "Registrar saída"}
                      </Button>
                    )}
                  </div>
                ))}
                {!data.timeEntries.length && (
                  <EmptyState
                    description="Abra um ponto manual ou aguarde a próxima marcação."
                    icon="◷"
                    title="Nenhum turno registrado"
                  />
                )}
              </div>
            </Card>
          )}

          <Modal
            isOpen={editingScheduleId !== null}
            onClose={() => setEditingScheduleId(null)}
            size="sm"
            title="Editar escala"
          >
            <form className="action-form" onSubmit={(event) => void saveSchedule(event)}>
              <label>
                Início
                <input
                  required
                  type="datetime-local"
                  value={scheduleStart}
                  onChange={(event) => setScheduleStart(event.target.value)}
                />
              </label>
              <label>
                Fim
                <input
                  required
                  type="datetime-local"
                  value={scheduleEnd}
                  onChange={(event) => setScheduleEnd(event.target.value)}
                />
              </label>
              <label>
                Intervalo (min)
                <input
                  min={0}
                  max={1440}
                  required
                  type="number"
                  value={breakMinutes}
                  onChange={(event) => setBreakMinutes(event.target.value)}
                />
              </label>
              <label className="action-form__wide">
                Observação
                <input
                  maxLength={1000}
                  value={scheduleNotes}
                  onChange={(event) => setScheduleNotes(event.target.value)}
                />
              </label>
              <div className="people-modal-actions action-form__wide">
                <Button
                  onClick={() => setEditingScheduleId(null)}
                  type="button"
                  variant="secondary"
                >
                  Cancelar
                </Button>
                <Button disabled={actionId !== ""} type="submit">
                  Salvar escala
                </Button>
              </div>
            </form>
          </Modal>

          <Modal
            isOpen={selectedPersonId !== null}
            onClose={() => {
              timelineRequest.current += 1;
              setSelectedPersonId(null);
              setTimeline({ status: "idle" });
            }}
            size="lg"
            title={personById.get(selectedPersonId ?? "")?.name ?? "Detalhes da pessoa"}
          >
            {selectedPersonId && personById.get(selectedPersonId) && (
              <div className="people-person-detail">
                <div className="gm-observability-row">
                  <Badge tone={personById.get(selectedPersonId)?.active ? "success" : "neutral"}>
                    {personById.get(selectedPersonId)?.active ? "Ativa" : "Inativa"}
                  </Badge>
                  <span className="gm-pill">
                    {personById.get(selectedPersonId)?.identityId
                      ? "Conta vinculada"
                      : "Sem conta vinculada"}
                  </span>
                  <span className="gm-pill">{personById.get(selectedPersonId)?.roleLabel}</span>
                </div>
                {personById.get(selectedPersonId)?.hourlyRateCents !== null && (
                  <p className="people-person-detail__rate">
                    Valor por hora:{" "}
                    {formatCents(personById.get(selectedPersonId)?.hourlyRateCents ?? 0)}
                  </p>
                )}
                {data.canManage && (
                  <form
                    className="action-form people-person-edit"
                    onSubmit={(event) => void savePerson(event)}
                  >
                    <label>
                      Nome
                      <input
                        minLength={2}
                        onChange={(event) => setEditPersonName(event.target.value)}
                        required
                        value={editPersonName}
                      />
                    </label>
                    <label>
                      Função
                      <input
                        minLength={1}
                        onChange={(event) => setEditPersonRole(event.target.value)}
                        required
                        value={editPersonRole}
                      />
                    </label>
                    <label>
                      Código interno
                      <input
                        maxLength={80}
                        onChange={(event) => setEditPersonCode(event.target.value)}
                        value={editPersonCode}
                      />
                    </label>
                    <label>
                      Valor por hora (R$)
                      <input
                        max={21474836.47}
                        min={0}
                        onChange={(event) => setEditPersonHourlyRate(event.target.value)}
                        step="0.01"
                        type="number"
                        value={editPersonHourlyRate}
                      />
                    </label>
                    <label className="action-form__wide">
                      Conta de acesso
                      <select
                        onChange={(event) => setEditPersonIdentityId(event.target.value)}
                        value={editPersonIdentityId}
                      >
                        <option value="">Sem conta vinculada</option>
                        {data.accounts
                          .filter(
                            (account) =>
                              account.id === editPersonIdentityId ||
                              !data.people.some((person) => person.identityId === account.id),
                          )
                          .map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.displayName} · {account.email}
                            </option>
                          ))}
                      </select>
                    </label>
                    <div className="people-person-edit__actions action-form__wide">
                      <Button disabled={actionId === `person-${selectedPersonId}`} type="submit">
                        Salvar alterações
                      </Button>
                      <Button
                        disabled={actionId !== ""}
                        onClick={() => {
                          const person = personById.get(selectedPersonId);
                          if (!person) return;
                          setConfirmation({
                            kind: "person-status",
                            personId: person.id,
                            active: !person.active,
                          });
                          setConfirmationNote("");
                        }}
                        type="button"
                        variant={personById.get(selectedPersonId)?.active ? "danger" : "secondary"}
                      >
                        {personById.get(selectedPersonId)?.active ? "Inativar" : "Reativar"}
                      </Button>
                    </div>
                  </form>
                )}
                <section>
                  <h3>Espelho operacional</h3>
                  <p className="people-person-detail__empty">
                    Escala, ponto, pausas, divergências e comissões abaixo usam apenas registros
                    persistidos nesta unidade.
                  </p>
                  {timeline.status === "loading" && <p role="status">Carregando espelho…</p>}
                  {timeline.status === "error" && (
                    <p className="people-page__error" role="alert">
                      {timeline.message}
                    </p>
                  )}
                  {timeline.status === "ready" && (
                    <>
                      <div className="people-reconciliation-grid">
                        <div>
                          <span>Previsto</span>
                          <strong>
                            {hoursLabel(timeline.data.reconciliation.scheduledMinutes)}
                          </strong>
                        </div>
                        <div>
                          <span>Realizado</span>
                          <strong>{hoursLabel(timeline.data.reconciliation.workedMinutes)}</strong>
                        </div>
                        <div>
                          <span>Atrasos</span>
                          <strong>{timeline.data.reconciliation.lateArrivals}</strong>
                        </div>
                        <div>
                          <span>Faltas</span>
                          <strong>{timelineExceptions(timeline.data).absences}</strong>
                        </div>
                        <div>
                          <span>Saídas antecipadas</span>
                          <strong>{timelineExceptions(timeline.data).earlyDepartures}</strong>
                        </div>
                        <div>
                          <span>Horas extras</span>
                          <strong>
                            {hoursLabel(timeline.data.reconciliation.overtimeMinutes)}
                          </strong>
                        </div>
                      </div>
                      <p className="people-coverage-note">
                        Cobertura no fuso {timeline.data.period.timezone}: escalas{" "}
                        {timeline.data.coverage.schedules === "complete" ? "completas" : "parciais"}
                        , ponto{" "}
                        {timeline.data.coverage.timeEntries === "complete" ? "completo" : "parcial"}{" "}
                        e custo{" "}
                        {timeline.data.coverage.laborCost === "complete" ? "completo" : "parcial"}.
                      </p>
                      {timeline.data.entries.length > 0 && (
                        <DataTable caption="Conciliação individual de escala e ponto">
                          <thead>
                            <tr>
                              <th scope="col">Data</th>
                              <th scope="col">Previsto</th>
                              <th scope="col">Realizado</th>
                              <th scope="col">Extras</th>
                              <th scope="col">Situação</th>
                            </tr>
                          </thead>
                          <tbody>
                            {timeline.data.entries.map((entry) => (
                              <tr key={entry.id}>
                                <td>{entry.summary.date}</td>
                                <td>
                                  {entry.summary.scheduledMinutes === null
                                    ? "Sem escala"
                                    : hoursLabel(entry.summary.scheduledMinutes)}
                                </td>
                                <td>{hoursLabel(entry.summary.workedMinutes)}</td>
                                <td>{hoursLabel(entry.summary.overtimeMinutes)}</td>
                                <td>
                                  {entry.summary.anomalyCodes.length
                                    ? entry.summary.anomalyCodes.map(anomalyLabel).join(", ")
                                    : "Regular"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </DataTable>
                      )}
                      <p className="people-person-detail__empty">
                        Correções de ponto são solicitadas pelo próprio colaborador no registro
                        afetado pelo painel de ponto.
                      </p>
                    </>
                  )}
                </section>
                <section>
                  <h3>Escalas recentes</h3>
                  <div className="management-list">
                    {data.schedules
                      .filter((schedule) => schedule.personId === selectedPersonId)
                      .slice(0, 8)
                      .map((schedule) => (
                        <div className="management-row" key={schedule.id}>
                          <span>
                            <strong>{dateLabel(schedule.startsAt)}</strong>
                            <small>
                              até {dateLabel(schedule.endsAt)} · {schedule.breakMinutes} min de
                              intervalo
                            </small>
                          </span>
                        </div>
                      ))}
                    {!data.schedules.some((schedule) => schedule.personId === selectedPersonId) && (
                      <p className="people-person-detail__empty">Nenhuma escala cadastrada.</p>
                    )}
                  </div>
                </section>
                <section>
                  <h3>Registros de ponto</h3>
                  <div className="management-list">
                    {data.timeEntries
                      .filter((entry) => entry.personId === selectedPersonId)
                      .slice(0, 8)
                      .map((entry) => (
                        <div className="management-row" key={entry.id}>
                          <span>
                            <strong>{dateLabel(entry.clockedInAt)}</strong>
                            <small>
                              {hoursLabel(workedMinutes(entry, data.breaks))} ·{" "}
                              {entry.clockedOutAt ? "Encerrado" : "Em andamento"} ·{" "}
                              {data.summaries.find((summary) => summary.timeEntryId === entry.id)
                                ?.scheduledMinutes === null
                                ? "Sem escala associada"
                                : `Previsto ${hoursLabel(
                                    data.summaries.find(
                                      (summary) => summary.timeEntryId === entry.id,
                                    )?.scheduledMinutes ?? 0,
                                  )}`}
                            </small>
                          </span>
                        </div>
                      ))}
                    {!data.timeEntries.some((entry) => entry.personId === selectedPersonId) && (
                      <p className="people-person-detail__empty">Nenhum ponto registrado.</p>
                    )}
                  </div>
                </section>
                {capabilities.state.status === "ready" &&
                  (capabilities.state.data.canApproveCommissions ||
                    capabilities.state.data.canPayCommissions) && (
                    <section>
                      <h3>Comissões recentes</h3>
                      <div className="management-list">
                        {data.commissions
                          .filter((commission) => commission.personId === selectedPersonId)
                          .slice(0, 8)
                          .map((commission) => (
                            <div className="management-row" key={commission.id}>
                              <span>
                                <strong>{formatCents(commission.amountCents)}</strong>
                                <small>{dateLabel(commission.createdAt)}</small>
                              </span>
                              <Badge tone="info">{commission.status}</Badge>
                            </div>
                          ))}
                        {!data.commissions.some(
                          (commission) => commission.personId === selectedPersonId,
                        ) && (
                          <p className="people-person-detail__empty">Nenhuma comissão lançada.</p>
                        )}
                      </div>
                    </section>
                  )}
              </div>
            )}
          </Modal>

          <Modal
            isOpen={confirmation !== null}
            onClose={() => {
              setConfirmation(null);
              setConfirmationNote("");
              setActionError("");
            }}
            size="sm"
            title={confirmationTitle(confirmation)}
          >
            <form className="gm-form-stack" onSubmit={(event) => void confirmPendingAction(event)}>
              <p className="people-confirmation-copy">{confirmationCopy(confirmation)}</p>
              {actionError && (
                <p className="people-page__error" role="alert">
                  {actionError}
                </p>
              )}
              <label className="gm-field">
                {confirmationNoteRequired(confirmation) ? "Motivo" : "Motivo opcional"}
                <textarea
                  className="gm-control gm-control--textarea"
                  maxLength={1000}
                  minLength={confirmation?.kind === "commission" ? 2 : 5}
                  onChange={(event) => setConfirmationNote(event.target.value)}
                  required={confirmationNoteRequired(confirmation)}
                  value={confirmationNote}
                />
              </label>
              <div className="people-modal-actions">
                <Button
                  disabled={actionId !== ""}
                  onClick={() => {
                    setConfirmation(null);
                    setConfirmationNote("");
                    setActionError("");
                  }}
                  type="button"
                  variant="secondary"
                >
                  Cancelar
                </Button>
                <Button
                  disabled={actionId !== ""}
                  type="submit"
                  variant={confirmation?.kind === "close-period" ? "danger" : "primary"}
                >
                  {actionId ? "Confirmando…" : "Confirmar"}
                </Button>
              </div>
            </form>
          </Modal>

          {feedback && (
            <Toast
              message={feedback.message}
              onDismiss={() => setFeedback(null)}
              title={feedback.tone === "success" ? "Concluído" : undefined}
              tone={feedback.tone}
            />
          )}
        </div>
      )}
    </RemoteGate>
  );
}
