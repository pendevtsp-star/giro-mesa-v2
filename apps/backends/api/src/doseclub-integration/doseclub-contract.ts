export const DOSECLUB_INTEGRATION_PATH = "/v1/integrations/giromesa" as const;

export const DOSECLUB_OPERATION_STATUSES = [
  "reserved",
  "committed",
  "canceled",
  "expired",
  "reversed",
] as const;

export type DoseClubOperationStatus = (typeof DOSECLUB_OPERATION_STATUSES)[number];

export interface DoseClubHealth {
  status: "ok";
  tenantId: string;
  integrationAccountId: string;
}

export interface DoseClubEligibleProduct {
  externalProductId: string;
  name: string;
  brand: string | null;
}

export interface DoseClubOfferSummary {
  externalOfferId: string;
  name: string;
  type: "individual" | "combo_pool";
}

export interface DoseClubEligibleMembership {
  externalClubId: string;
  status: "active";
  offer: DoseClubOfferSummary;
  remainingDoses: number;
  reservedDoses: number;
  availableDoses: number;
  doseMl: number;
  eligibleProducts: DoseClubEligibleProduct[];
}

export interface ListEligibleMembershipsRequest {
  externalCustomerId: string;
  externalBranchId: string;
  externalProductId?: string;
}

export interface ListEligibleMembershipsResponse {
  memberships: DoseClubEligibleMembership[];
}

export interface ReserveConsumptionRequest {
  externalCustomerId: string;
  externalBranchId: string;
  externalProductId: string;
  externalClubId: string;
  externalCommandId: string;
  externalCommandItemId: string;
  doses: number;
  idempotencyKey: string;
  reason?: string;
}

export interface CommitReservationRequest {
  operationId: string;
  idempotencyKey: string;
  externalStockMovementId?: string;
}

export interface CancelReservationRequest {
  operationId: string;
  idempotencyKey: string;
  reason?: string;
}

export interface ReverseConsumptionRequest {
  operationId: string;
  externalReversalId: string;
  idempotencyKey: string;
  reason: string;
}

export interface DoseClubOperation {
  operationId: string;
  status: DoseClubOperationStatus;
  externalCommandId: string;
  externalCommandItemId: string;
  externalClubId: string;
  externalBranchId: string;
  externalProductId: string;
  doses: number;
  availableDoses: number;
  reservedAt: string;
  expiresAt: string;
  committedAt: string | null;
  canceledAt: string | null;
  expiredAt: string | null;
  reversedAt: string | null;
  updatedAt: string;
}

export interface DoseClubIntegrationClient {
  health(): Promise<DoseClubHealth>;
  listEligibleMemberships(
    request: ListEligibleMembershipsRequest,
  ): Promise<ListEligibleMembershipsResponse>;
  reserveConsumption(request: ReserveConsumptionRequest): Promise<DoseClubOperation>;
  commitReservation(request: CommitReservationRequest): Promise<DoseClubOperation>;
  cancelReservation(request: CancelReservationRequest): Promise<DoseClubOperation>;
  reverseConsumption(request: ReverseConsumptionRequest): Promise<DoseClubOperation>;
  getOperation(operationId: string): Promise<DoseClubOperation>;
}
