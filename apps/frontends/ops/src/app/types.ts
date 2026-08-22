import type { AccessOrganization } from "../auth";
import type { Organization, Profile, Unit } from "../domain";

export type Session = {
  identityId: string;
  profile: Profile;
  organization: Organization;
  unit: Unit;
  membershipId: string;
  organizationId: string;
  unitId: string;
  terminalMode: boolean;
  terminalSessionId?: string;
  actorEpoch?: number;
  platformAdmin: boolean;
  settingsManageUnitIds?: string[];
};

export type ScopeSource = {
  identityId: string;
  identityName: string;
  organizations: AccessOrganization[];
  platformAdmin: boolean;
};

export type SyncState = "online" | "offline" | "syncing";
export type CommandRecorder = (type?: string, payload?: Record<string, unknown>) => void;
