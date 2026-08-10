import { z } from "zod";

const code = z.string().regex(/^\d{6}$/);
const proofShape = {
  code: code.optional(),
  recoveryCode: z.string().min(12).max(64).optional(),
};
const exactlyOneProof = (value: { code?: string; recoveryCode?: string }) =>
  Boolean(value.code) !== Boolean(value.recoveryCode);

export const verifyMfaChallengeSchema = z
  .object({ ...proofShape, challengeToken: z.string().min(32).max(128) })
  .refine(exactlyOneProof, {
    message: "Informe um código MFA ou um código de recuperação.",
  });
export const verifyOAuthMfaSchema = z.object(proofShape).refine(exactlyOneProof, {
  message: "Informe um código MFA ou um código de recuperação.",
});
export const confirmMfaSetupSchema = z.object({ code });
export const disableMfaSchema = z.object(proofShape).refine(exactlyOneProof, {
  message: "Informe um código MFA ou um código de recuperação.",
});

export type VerifyMfaChallengeInput = z.infer<typeof verifyMfaChallengeSchema>;
export type VerifyOAuthMfaInput = z.infer<typeof verifyOAuthMfaSchema>;
export type ConfirmMfaSetupInput = z.infer<typeof confirmMfaSetupSchema>;
export type DisableMfaInput = z.infer<typeof disableMfaSchema>;
