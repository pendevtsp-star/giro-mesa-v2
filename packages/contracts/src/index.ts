import { z } from "zod";

export type {
  components as ApiComponents,
  operations as ApiOperations,
  paths as ApiPaths,
  webhooks as ApiWebhooks,
} from "./generated-api.js";

export const idSchema = z.uuid();
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(254)
  .refine((email) => !email.endsWith("@system.giromesa.invalid"), "E-mail reservado.");
export const moneyCentsSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((timezone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
      return true;
    } catch {
      return false;
    }
  }, "Timezone IANA inválida.");

export const isoWeekdaySchema = z.number().int().min(1).max(7);
const clockTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const httpUrlSchema = z
  .url()
  .max(2_000)
  .refine((value) => /^https?:\/\//i.test(value), "Use uma URL HTTP(S).");

export const businessHoursPeriodSchema = z
  .object({
    start: clockTimeSchema,
    end: clockTimeSchema,
    endsNextDay: z.boolean().default(false),
  })
  .strict()
  .superRefine((period, context) => {
    const start = Number(period.start.slice(0, 2)) * 60 + Number(period.start.slice(3));
    const end = Number(period.end.slice(0, 2)) * 60 + Number(period.end.slice(3));
    if (start === end) {
      context.addIssue({
        code: "custom",
        path: ["end"],
        message: "Use open24h para um período de 24 horas.",
      });
    } else if ((!period.endsNextDay && end < start) || (period.endsNextDay && end > start)) {
      context.addIssue({
        code: "custom",
        path: ["endsNextDay"],
        message: "endsNextDay deve indicar corretamente a virada do dia.",
      });
    }
  });

function overlappingPeriodIndex(
  periods: Array<{ start: string; end: string; endsNextDay: boolean }>,
) {
  const intervals = periods
    .map((period, index) => ({
      index,
      start: Number(period.start.slice(0, 2)) * 60 + Number(period.start.slice(3)),
      end:
        Number(period.end.slice(0, 2)) * 60 +
        Number(period.end.slice(3)) +
        (period.endsNextDay ? 1_440 : 0),
    }))
    .sort((left, right) => left.start - right.start);
  for (let index = 1; index < intervals.length; index += 1) {
    const current = intervals[index];
    const previous = intervals[index - 1];
    if (current && previous && current.start < previous.end) return current.index;
  }
  return null;
}

const closedHoursRuleSchema = z.object({ mode: z.literal("closed") }).strict();
const open24HoursRuleSchema = z.object({ mode: z.literal("open24h") }).strict();
const periodsHoursRuleSchema = z
  .object({
    mode: z.literal("periods"),
    periods: z.array(businessHoursPeriodSchema).min(1).max(8),
  })
  .strict()
  .superRefine((rule, context) => {
    const overlap = overlappingPeriodIndex(rule.periods);
    if (overlap !== null) {
      context.addIssue({
        code: "custom",
        path: ["periods", overlap],
        message: "Períodos de funcionamento não podem se sobrepor.",
      });
    }
  });

const hoursRuleSchema = z.discriminatedUnion("mode", [
  closedHoursRuleSchema,
  open24HoursRuleSchema,
  periodsHoursRuleSchema,
]);

export const businessHoursDaySchema = z.discriminatedUnion("mode", [
  z.object({ weekday: isoWeekdaySchema, mode: z.literal("closed") }).strict(),
  z.object({ weekday: isoWeekdaySchema, mode: z.literal("open24h") }).strict(),
  z
    .object({
      weekday: isoWeekdaySchema,
      mode: z.literal("periods"),
      periods: z.array(businessHoursPeriodSchema).min(1).max(8),
    })
    .strict()
    .superRefine((day, context) => {
      const overlap = overlappingPeriodIndex(day.periods);
      if (overlap !== null) {
        context.addIssue({
          code: "custom",
          path: ["periods", overlap],
          message: "Períodos de funcionamento não podem se sobrepor.",
        });
      }
    }),
]);

const exceptionDateSchema = z.iso.date().refine((date) => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(date);
}, "Data inválida.");

export const businessHoursExceptionSchema = z.discriminatedUnion("mode", [
  z.object({ date: exceptionDateSchema, mode: z.literal("closed") }).strict(),
  z.object({ date: exceptionDateSchema, mode: z.literal("open24h") }).strict(),
  z
    .object({
      date: exceptionDateSchema,
      mode: z.literal("periods"),
      periods: z.array(businessHoursPeriodSchema).min(1).max(8),
    })
    .strict()
    .superRefine((exception, context) => {
      const overlap = overlappingPeriodIndex(exception.periods);
      if (overlap !== null) {
        context.addIssue({
          code: "custom",
          path: ["periods", overlap],
          message: "Períodos de funcionamento não podem se sobrepor.",
        });
      }
    }),
]);

type HoursRule = z.infer<typeof hoursRuleSchema>;

function hoursRuleIntervals(rule: HoursRule, dayOffset: number) {
  if (rule.mode === "closed") return [];
  if (rule.mode === "open24h") return [{ start: dayOffset, end: dayOffset + 1_440 }];
  return rule.periods.map((period) => {
    const start = Number(period.start.slice(0, 2)) * 60 + Number(period.start.slice(3));
    const end = Number(period.end.slice(0, 2)) * 60 + Number(period.end.slice(3));
    return {
      start: dayOffset + start,
      end: dayOffset + end + (period.endsNextDay ? 1_440 : 0),
    };
  });
}

export const businessHoursSchema = z
  .object({
    weekly: z.array(businessHoursDaySchema).length(7),
    exceptions: z.array(businessHoursExceptionSchema).max(366).default([]),
  })
  .strict()
  .superRefine((schedule, context) => {
    const weekdays = schedule.weekly.map((day) => day.weekday);
    if (new Set(weekdays).size !== weekdays.length) {
      context.addIssue({
        code: "custom",
        path: ["weekly"],
        message: "Cada dia da semana deve aparecer uma única vez.",
      });
    }
    const dates = schedule.exceptions.map((exception) => exception.date);
    if (new Set(dates).size !== dates.length) {
      context.addIssue({
        code: "custom",
        path: ["exceptions"],
        message: "Cada data excepcional deve aparecer uma única vez.",
      });
    }

    const weekMinutes = 7 * 1_440;
    const intervals = schedule.weekly.flatMap((day) =>
      hoursRuleIntervals(day, (day.weekday - 1) * 1_440),
    );
    for (let leftIndex = 0; leftIndex < intervals.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < intervals.length; rightIndex += 1) {
        const left = intervals[leftIndex];
        const right = intervals[rightIndex];
        if (!left || !right) continue;
        if (
          [-weekMinutes, 0, weekMinutes].some((shift) => {
            const shiftedStart = right.start + shift;
            const shiftedEnd = right.end + shift;
            return left.start < shiftedEnd && shiftedStart < left.end;
          })
        ) {
          context.addIssue({
            code: "custom",
            path: ["weekly"],
            message: "Períodos semanais não podem se sobrepor, inclusive após a meia-noite.",
          });
          return;
        }
      }
    }
  });

export const establishmentPresentationSchema = z
  .object({
    displayName: z.string().trim().min(1).max(160),
    slogan: z.string().trim().max(300).nullable().default(null),
    logoUrl: httpUrlSchema.nullable().default(null),
    primaryColor: colorSchema,
    accentColor: colorSchema,
    notice: z.string().trim().max(1_000).nullable().default(null),
    address: z.string().trim().max(500).nullable().default(null),
    phone: z.string().trim().max(40).nullable().default(null),
    instagram: z.string().trim().max(120).nullable().default(null),
    openingHours: z.string().trim().max(1_000).nullable().default(null),
    serviceTaxNotice: z.string().trim().max(500).nullable().default(null),
    corkageFeeNotice: z.string().trim().max(500).nullable().default(null),
    wifi: z
      .object({ ssid: z.string().trim().max(120), password: z.string().max(120) })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();

export const establishmentSettingsSchema = z
  .object({
    organization: z
      .object({
        id: idSchema,
        legalName: z.string().trim().min(2).max(160),
        tradeName: z.string().trim().min(2).max(120),
        document: z.string().trim().min(1).max(32),
      })
      .strict(),
    unit: z
      .object({
        id: idSchema,
        name: z.string().trim().min(2).max(120),
        timezone: timezoneSchema,
      })
      .strict(),
    presentation: establishmentPresentationSchema,
    businessHours: businessHoursSchema,
    publication: z
      .object({
        active: z.boolean(),
        publishedAt: z.iso.datetime({ offset: true }).nullable(),
        hasUnpublishedChanges: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const updateOrganizationSettingsSchema = z
  .object({ tradeName: z.string().trim().min(2).max(120) })
  .strict();

export const updateUnitSettingsSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    timezone: timezoneSchema,
    presentation: establishmentPresentationSchema,
    businessHours: businessHoursSchema,
  })
  .strict();

export const copyUnitSettingsSchema = z
  .object({ targetUnitIds: z.array(idSchema).min(1).max(100) })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.targetUnitIds).size !== input.targetUnitIds.length) {
      context.addIssue({
        code: "custom",
        path: ["targetUnitIds"],
        message: "Cada unidade de destino deve aparecer uma única vez.",
      });
    }
  });

export type BusinessHoursPeriod = z.infer<typeof businessHoursPeriodSchema>;
export type BusinessHoursDay = z.infer<typeof businessHoursDaySchema>;
export type BusinessHoursException = z.infer<typeof businessHoursExceptionSchema>;
export type BusinessHours = z.infer<typeof businessHoursSchema>;
export type EstablishmentPresentation = z.infer<typeof establishmentPresentationSchema>;
export type EstablishmentSettings = z.infer<typeof establishmentSettingsSchema>;
export type UpdateOrganizationSettingsInput = z.infer<typeof updateOrganizationSettingsSchema>;
export type UpdateUnitSettingsInput = z.infer<typeof updateUnitSettingsSchema>;
export type CopyUnitSettingsInput = z.infer<typeof copyUnitSettingsSchema>;

export const operationalCapabilitySchema = z.enum([
  "operations:payments:record",
  "operations:tabs:close",
  "operations:charges:adjust",
  "operations:exceptions:request",
  "operations:exceptions:approve",
  "operations:tabs:open",
  "operations:reception:manage",
  "operations:reception:seat",
  "operations:tables:turnover",
]);

export const operationalCapabilityAliases = {
  "payments:write": ["operations:payments:record"],
  "cashier:write": [
    "operations:payments:record",
    "operations:tabs:close",
    "operations:charges:adjust",
    "operations:tabs:open",
  ],
} as const;

export const paymentTerminalProviderSchema = z.enum([
  "rede",
  "paygo",
  "stone",
  "getnet",
  "cielo",
  "pagbank",
]);
export const paymentTerminalStatusSchema = z.enum([
  "disabled",
  "pending",
  "homologated",
  "suspended",
]);
export const integratedPaymentMethodSchema = z.enum(["credit_card", "debit_card", "pix"]);
export const paymentAttemptStatusSchema = z.enum([
  "created",
  "processing",
  "approved",
  "declined",
  "canceled",
  "unknown",
  "reversed",
]);

const paymentCardCandidatePattern = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;

function hasLuhnValidPaymentCardNumber(value: string) {
  for (const candidate of value.matchAll(paymentCardCandidatePattern)) {
    const digits = candidate[0].replace(/[ -]/g, "");
    let sum = 0;
    let doubleDigit = false;
    for (let index = digits.length - 1; index >= 0; index -= 1) {
      let digit = Number(digits[index]);
      if (doubleDigit) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      doubleDigit = !doubleDigit;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

function paymentOpaqueIdentifierSchema(minLength: number, maxLength: number, pattern: RegExp) {
  return z
    .string()
    .trim()
    .min(minLength)
    .max(maxLength)
    .regex(pattern)
    .refine((value) => !hasLuhnValidPaymentCardNumber(value), {
      message: "O identificador não pode conter número de cartão.",
    });
}

export const paymentAttemptCreateSchema = z
  .object({
    method: integratedPaymentMethodSchema,
    amountCents: z.number().int().positive().max(2_147_483_647),
    installments: z.number().int().min(1).max(24).default(1),
    installationId: idSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.method !== "credit_card" && input.installments !== 1) {
      context.addIssue({
        code: "custom",
        path: ["installments"],
        message: "Parcelamento está disponível somente no crédito.",
      });
    }
  });

export const paymentDeviceResultSchema = z
  .object({
    resultId: paymentOpaqueIdentifierSchema(8, 160, /^[A-Za-z0-9._:/-]+$/),
    status: z.enum(["processing", "approved", "declined", "canceled", "unknown"]),
    providerReference: paymentOpaqueIdentifierSchema(1, 120, /^[A-Za-z0-9._:/-]+$/).optional(),
    authorizationCode: paymentOpaqueIdentifierSchema(1, 64, /^[A-Za-z0-9._-]+$/).optional(),
    failureCode: paymentOpaqueIdentifierSchema(1, 80, /^[A-Z0-9_]+$/).optional(),
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.status === "approved" && !input.providerReference) {
      context.addIssue({
        code: "custom",
        path: ["providerReference"],
        message: "A aprovação exige a referência sanitizada do provedor.",
      });
    }
    if (input.status !== "approved" && input.authorizationCode) {
      context.addIssue({
        code: "custom",
        path: ["authorizationCode"],
        message: "Código de autorização só é aceito em pagamentos aprovados.",
      });
    }
  });

export const paymentReversalCreateSchema = z
  .object({ reason: z.string().trim().min(3).max(500) })
  .strict();

const sha256HexSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-f0-9]{64}$/);
const p256PublicKeySpkiSchema = z
  .string()
  .trim()
  .min(100)
  .max(256)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);

export const paymentDeviceDiagnosticsSchema = z
  .object({
    manufacturer: z.string().trim().min(1).max(120),
    model: z.string().trim().min(1).max(120),
    androidVersion: z.string().trim().min(1).max(64),
    firmwareVersion: z.string().trim().min(1).max(120),
    appVersion: z.string().trim().min(1).max(64),
    packageName: z.string().trim().min(3).max(180),
    signingCertificateSha256: sha256HexSchema,
  })
  .strict();

export const paymentDevicePairingCreateSchema = z
  .object({
    label: z.string().trim().min(2).max(120),
    expiresInSeconds: z.number().int().min(120).max(900).default(300),
  })
  .strict();

export const paymentDevicePairingRedeemSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{8}$/),
    installationId: idSchema,
    publicKeySpki: p256PublicKeySpkiSchema,
    diagnostics: paymentDeviceDiagnosticsSchema,
  })
  .strict();

export const paymentDeviceCredentialRotateSchema = z
  .object({
    rotationId: idSchema,
    newPublicKeySpki: p256PublicKeySpkiSchema,
  })
  .strict();

export const paymentTerminalCertificationSchema = z
  .object({
    provider: paymentTerminalProviderSchema,
    status: z.enum(["approved", "suspended"]),
    diagnostics: paymentDeviceDiagnosticsSchema,
    methods: z.array(integratedPaymentMethodSchema).min(1).max(3),
    maxInstallments: z.number().int().min(1).max(24),
    supports: z
      .object({ cancel: z.boolean(), recover: z.boolean(), reversal: z.boolean() })
      .strict(),
    killSwitchEnabled: z.boolean().default(false),
    killSwitchReason: z.string().trim().min(3).max(500).nullable().default(null),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.killSwitchEnabled && !input.killSwitchReason) {
      context.addIssue({
        code: "custom",
        path: ["killSwitchReason"],
        message: "O kill switch exige um motivo auditável.",
      });
    }
  });

export const paymentTerminalConfigurationSchema = z
  .object({
    provider: paymentTerminalProviderSchema,
    status: paymentTerminalStatusSchema,
    certificationId: idSchema.nullable().optional(),
    methods: z.array(integratedPaymentMethodSchema).max(3),
    maxInstallments: z.number().int().min(1).max(24),
    supports: z.object({
      cancel: z.boolean(),
      recover: z.boolean(),
      reversal: z.boolean(),
    }),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.status === "homologated" && !input.certificationId) {
      context.addIssue({
        code: "custom",
        path: ["certificationId"],
        message: "Terminal homologado exige uma certificação interna.",
      });
    }
    if (input.status === "homologated" && input.methods.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["methods"],
        message: "Terminal homologado exige ao menos um método de pagamento.",
      });
    }
  });

export const paymentReconciliationStatusSchema = z.enum([
  "pending",
  "matched",
  "divergent",
  "settled",
  "reversed",
]);

export const paymentReconciliationInputSchema = z
  .object({
    provider: paymentTerminalProviderSchema,
    providerSettlementId: paymentOpaqueIdentifierSchema(1, 160, /^[A-Za-z0-9._:/-]+$/),
    providerReference: paymentOpaqueIdentifierSchema(1, 120, /^[A-Za-z0-9._:/-]+$/),
    grossCents: z.number().int().positive().max(2_147_483_647),
    feeCents: z.number().int().nonnegative().max(2_147_483_647),
    netCents: z.number().int().nonnegative().max(2_147_483_647),
    expectedSettlementAt: z.iso.datetime({ offset: true }),
    settledAt: z.iso.datetime({ offset: true }).nullable().default(null),
    status: paymentReconciliationStatusSchema,
    source: z.enum(["api", "webhook", "import"]),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.netCents !== input.grossCents - input.feeCents) {
      context.addIssue({
        code: "custom",
        path: ["netCents"],
        message: "Líquido deve ser igual ao bruto menos a taxa.",
      });
    }
    if (input.status === "settled" && !input.settledAt) {
      context.addIssue({
        code: "custom",
        path: ["settledAt"],
        message: "Conciliação liquidada exige a data do crédito.",
      });
    }
  });

export const paymentHomologationRunSchema = z
  .object({
    certificationId: idSchema,
    installationId: idSchema,
    terminalSerialHash: sha256HexSchema,
    environment: z.enum(["sandbox", "homologation", "production"]),
    checklist: z
      .object({
        debitApproved: z.boolean(),
        creditApproved: z.boolean(),
        installmentsApproved: z.boolean(),
        pixApproved: z.boolean(),
        declinedHandled: z.boolean(),
        canceledHandled: z.boolean(),
        networkRecoveryHandled: z.boolean(),
        reversalApproved: z.boolean(),
        receiptValidated: z.boolean(),
      })
      .strict(),
    evidenceReference: z.string().trim().min(3).max(500),
    notes: z.string().trim().max(2_000).nullable().default(null),
  })
  .strict();

export type PaymentTerminalProvider = z.infer<typeof paymentTerminalProviderSchema>;
export type PaymentTerminalStatus = z.infer<typeof paymentTerminalStatusSchema>;
export type IntegratedPaymentMethod = z.infer<typeof integratedPaymentMethodSchema>;
export type PaymentAttemptStatus = z.infer<typeof paymentAttemptStatusSchema>;
export type PaymentAttemptCreateInput = z.infer<typeof paymentAttemptCreateSchema>;
export type PaymentDeviceResultInput = z.infer<typeof paymentDeviceResultSchema>;
export type PaymentReversalCreateInput = z.infer<typeof paymentReversalCreateSchema>;
export type PaymentTerminalConfigurationInput = z.infer<typeof paymentTerminalConfigurationSchema>;
export type PaymentDeviceDiagnosticsInput = z.infer<typeof paymentDeviceDiagnosticsSchema>;
export type PaymentDevicePairingCreateInput = z.infer<typeof paymentDevicePairingCreateSchema>;
export type PaymentDevicePairingRedeemInput = z.infer<typeof paymentDevicePairingRedeemSchema>;
export type PaymentDeviceCredentialRotateInput = z.infer<
  typeof paymentDeviceCredentialRotateSchema
>;
export type PaymentTerminalCertificationInput = z.infer<typeof paymentTerminalCertificationSchema>;
export type PaymentReconciliationInput = z.infer<typeof paymentReconciliationInputSchema>;
export type PaymentHomologationRunInput = z.infer<typeof paymentHomologationRunSchema>;

export const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(12).max(128),
  displayName: z.string().trim().min(2).max(120),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  trustedDevice: z.boolean().default(false),
});

export const publicRegisterSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(12).max(128),
    name: z.string().trim().min(2).max(120),
    termsAccepted: z.union([z.literal(true), z.literal("true")]),
  })
  .transform(({ email, password, name }) => ({ email, password, displayName: name }));

export const publicLoginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(128),
    trustedDevice: z.union([z.boolean(), z.literal("on")]).optional(),
  })
  .transform(({ email, password, trustedDevice }) => ({
    email,
    password,
    trustedDevice: trustedDevice === true || trustedDevice === "on",
  }));

export const registerRequestSchema = z.union([registerSchema, publicRegisterSchema]);
export const loginRequestSchema = z.union([loginSchema, publicLoginSchema]);

export const requestPasswordResetSchema = z.object({ email: emailSchema });
export const confirmPasswordResetSchema = z.object({
  token: z.string().min(32).max(200),
  password: z.string().min(12).max(128),
});

export const createOrganizationSchema = z.object({
  legalName: z.string().trim().min(2).max(160),
  tradeName: z.string().trim().min(2).max(120),
  document: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => /^[A-Z0-9]{12}\d{2}$/.test(value), {
      message: "CNPJ deve conter 14 posições e dois dígitos verificadores numéricos",
    }),
  unitName: z.string().trim().min(2).max(120),
  timezone: z.string().trim().min(3).max(64).default("America/Sao_Paulo"),
});

export const enrollDeviceSchema = z.object({
  label: z.string().trim().min(2).max(120),
  certificateFingerprint: z.string().trim().min(32).max(128).optional(),
});

export const inviteMembershipSchema = z.object({
  email: emailSchema,
  role: z.enum([
    "owner",
    "manager",
    "waiter",
    "cashier",
    "receptionist",
    "busser",
    "kds",
    "delivery",
    "inventory",
    "finance",
    "accountant",
  ]),
  unitId: idSchema.nullable(),
});

export const acceptMembershipInviteSchema = z.object({ token: z.string().min(32).max(200) });

export const activationChecklistSchema = z.object({
  business: z.boolean(),
  unit: z.boolean(),
  catalog: z.boolean(),
  team: z.boolean(),
  production: z.boolean(),
  cashier: z.boolean(),
  fiscalChoice: z.boolean(),
  training: z.boolean(),
  rehearsal: z.boolean(),
});

export const updateOnboardingSchema = z.object({
  checklist: activationChecklistSchema.partial(),
});

export const activateTrialSchema = z.object({
  planSlug: z.enum(["operacao", "crescimento", "rede"]),
});

export const operationalCommandSchema = z.object({
  id: idSchema,
  deviceId: idSchema,
  type: z.string().trim().min(3).max(100),
  version: z.number().int().positive().max(100),
  occurredAt: z.iso.datetime({ offset: true }),
  idempotencyKey: z.string().trim().min(8).max(160),
  payload: z.record(z.string(), z.unknown()),
});

export const billingEventSchema = z.object({
  event: z.enum([
    "START_ONBOARDING",
    "ACTIVATE_TRIAL",
    "CONFIRM_PAYMENT",
    "TRIAL_EXPIRED",
    "PAYMENT_OVERDUE",
    "GRACE_EXPIRED",
    "SUSPEND",
    "RESTORE",
    "CANCEL",
  ]),
});

export const trialApplicationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  phone: z.string().trim().min(10).max(20),
  businessName: z.string().trim().min(2).max(120),
  segment: z.string().trim().min(2).max(80).optional(),
  planSlug: z.enum(["operacao", "crescimento", "rede"]),
  consent: z.literal(true),
});

const planLabelToSlug = {
  Operação: "operacao",
  Crescimento: "crescimento",
  Rede: "rede",
} as const;

export const publicTrialApplicationSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: emailSchema,
    phone: z.string().trim().min(10).max(20),
    businessName: z.string().trim().min(2).max(120),
    segment: z.string().trim().min(2).max(80),
    plan: z.enum(["Operação", "Crescimento", "Rede"]),
    privacyAccepted: z.union([z.literal(true), z.literal("true")]),
  })
  .transform(({ plan, ...input }) => ({
    name: input.name,
    email: input.email,
    phone: input.phone,
    businessName: input.businessName,
    planSlug: planLabelToSlug[plan],
    consent: true as const,
    segment: input.segment,
  }));

export const trialApplicationRequestSchema = z.union([
  trialApplicationSchema,
  publicTrialApplicationSchema,
]);

export const contactRequestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  phone: z.string().trim().min(10).max(20),
  message: z.string().trim().min(5).max(4_000),
  privacyAccepted: z.union([z.literal(true), z.literal("true")]),
});

export const publicMenuCommandSchema = z.object({
  type: z.enum(["place_order", "call_waiter", "request_check"]),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export const publicMenuSlugSchema = z
  .string()
  .trim()
  .min(3)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const idempotencyKeySchema = z.string().trim().min(8).max(160);

export const deliveryAddressSchema = z
  .object({
    street: z.string().trim().min(2).max(160),
    number: z.string().trim().min(1).max(30),
    complement: z.string().trim().max(120).optional(),
    neighborhood: z.string().trim().min(2).max(120),
    city: z.string().trim().min(2).max(120),
    state: z
      .string()
      .trim()
      .length(2)
      .transform((value) => value.toUpperCase()),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{5}-?\d{3}$/),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .strict()
  .superRefine((address, context) => {
    if ((address.latitude === undefined) !== (address.longitude === undefined)) {
      context.addIssue({
        code: "custom",
        path: [address.latitude === undefined ? "latitude" : "longitude"],
        message: "Latitude e longitude devem ser informadas juntas.",
      });
    }
  });

export const deliveryCourierCreateSchema = z
  .object({
    unitId: z.string().uuid(),
    reference: z.string().trim().min(2).max(80),
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(8).max(40).nullable().optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const deliveryCourierStatusSchema = z
  .object({
    status: z.enum(["available", "offline"]),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const deliveryCourierPositionSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    recordedAt: z.string().datetime({ offset: true }).optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const deliveryCourierAssignmentSchema = z
  .object({
    courierId: z.string().uuid(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const deliveryNotificationSchema = z
  .object({
    audience: z.enum(["operations", "customer"]),
    type: z.enum(["status_update", "courier_assigned", "courier_arriving"]),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const publicOrderSchema = z
  .object({
    fulfillment: z.enum(["pickup", "delivery"]),
    customer: z
      .object({
        name: z.string().trim().min(2).max(120),
        phone: z.string().trim().min(10).max(20),
      })
      .strict(),
    items: z
      .array(
        z
          .object({
            productId: z.string().uuid(),
            quantity: z.number().int().min(1).max(99),
            modifierOptionIds: z.array(z.string().uuid()).max(20).default([]),
            notes: z.string().trim().max(180).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    deliveryZone: z.string().trim().min(2).max(120).optional(),
    address: deliveryAddressSchema.optional(),
    paymentMethod: z.literal("pay_on_fulfillment"),
    privacyAccepted: z.literal(true),
    policyVersion: z.string().trim().min(1).max(40),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.fulfillment === "delivery") {
      if (!value.deliveryZone) {
        context.addIssue({ code: "custom", path: ["deliveryZone"], message: "Zona obrigatória." });
      }
      if (!value.address) {
        context.addIssue({ code: "custom", path: ["address"], message: "Endereço obrigatório." });
      }
    } else if (value.deliveryZone || value.address) {
      context.addIssue({
        code: "custom",
        path: ["fulfillment"],
        message: "Retirada não aceita zona ou endereço de entrega.",
      });
    }
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type PublicRegisterInput = z.infer<typeof publicRegisterSchema>;
export type PublicLoginInput = z.infer<typeof publicLoginSchema>;
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;
export type ConfirmPasswordResetInput = z.infer<typeof confirmPasswordResetSchema>;
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type EnrollDeviceInput = z.infer<typeof enrollDeviceSchema>;
export type InviteMembershipInput = z.infer<typeof inviteMembershipSchema>;
export type OperationalCapability = z.infer<typeof operationalCapabilitySchema>;
export type AcceptMembershipInviteInput = z.infer<typeof acceptMembershipInviteSchema>;
export type UpdateOnboardingInput = z.infer<typeof updateOnboardingSchema>;
export type ActivateTrialInput = z.infer<typeof activateTrialSchema>;
export type OperationalCommandInput = z.infer<typeof operationalCommandSchema>;
export type BillingEventInput = z.infer<typeof billingEventSchema>;
export type TrialApplicationInput = z.infer<typeof trialApplicationSchema>;
export type PublicTrialApplicationInput = z.infer<typeof publicTrialApplicationSchema>;
export type ContactRequestInput = z.infer<typeof contactRequestSchema>;
export type PublicMenuCommandInput = z.infer<typeof publicMenuCommandSchema>;
export type PublicOrderInput = z.infer<typeof publicOrderSchema>;
export type DeliveryAddressInput = z.infer<typeof deliveryAddressSchema>;
export type DeliveryCourierCreateInput = z.infer<typeof deliveryCourierCreateSchema>;
export type DeliveryCourierStatusInput = z.infer<typeof deliveryCourierStatusSchema>;
export type DeliveryCourierPositionInput = z.infer<typeof deliveryCourierPositionSchema>;
export type DeliveryCourierAssignmentInput = z.infer<typeof deliveryCourierAssignmentSchema>;
export type DeliveryNotificationInput = z.infer<typeof deliveryNotificationSchema>;
export type RegisterRequestInput = z.infer<typeof registerRequestSchema>;
export type LoginRequestInput = z.infer<typeof loginRequestSchema>;
export type TrialApplicationRequestInput = z.infer<typeof trialApplicationRequestSchema>;

export interface PublicCommercialPlan {
  slug: "operacao" | "crescimento" | "rede";
  name: string;
  monthlyPriceCents: number;
  annualPriceCents: number;
  includedUnits: number;
  entitlements: string[];
}

export interface ApiError {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}
