import { api } from "../../api";
import { type PilotScope, parsePilotCatalog, RemoteGate, useRemote } from "../../operations.shared";
import { CatalogExperience } from "./CatalogExperience";
import "./catalog.entry.css";

export function RealCatalogPage({ scope }: { scope: PilotScope }) {
  const remote = useRemote(
    scope,
    () =>
      scope.load("catalog", undefined, () => api.pilot.catalog(scope.organizationId, scope.unitId)),
    parsePilotCatalog,
  );

  return (
    <RemoteGate remote={remote}>
      {(catalog) => (
        <CatalogExperience initialCatalog={catalog} onRetry={remote.retry} scope={scope} />
      )}
    </RemoteGate>
  );
}
