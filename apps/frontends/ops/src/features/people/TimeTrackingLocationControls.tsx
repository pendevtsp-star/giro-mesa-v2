// biome-ignore-all lint/a11y/noLabelWithoutControl: UI controls render native inputs nested in their labels.
import { Button, Card, Input } from "@giromesa/ui";
import { useMemo, useState } from "react";
import type { TimeTrackingLocation } from "../../management.shared";
import {
  distanceMeters,
  hasAcceptableLocationAccuracy,
  openStreetMapEmbedUrl,
  openStreetMapSearchUrl,
  parseLocationNumber,
  requestDeviceLocation,
} from "./time-tracking-location";

type PrimaryLocation = {
  address: string;
  latitude: string;
  longitude: string;
  radiusMeters: string;
  accuracyToleranceMeters: string;
};

function newLocation(primary: PrimaryLocation): TimeTrackingLocation {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `location-${Date.now()}`,
    label: "Novo local permitido",
    address: "",
    latitude: parseLocationNumber(primary.latitude) ?? 0,
    longitude: parseLocationNumber(primary.longitude) ?? 0,
    radiusMeters: parseLocationNumber(primary.radiusMeters) ?? 100,
    accuracyToleranceMeters: parseLocationNumber(primary.accuracyToleranceMeters) ?? 50,
  };
}

export function TimeTrackingLocationControls({
  primary,
  maxLocationAccuracyMeters,
  locations,
  onLocationsChange,
  onPrimaryChange,
}: {
  primary: PrimaryLocation;
  maxLocationAccuracyMeters: string;
  locations: TimeTrackingLocation[];
  onLocationsChange: (next: TimeTrackingLocation[]) => void;
  onPrimaryChange: (next: Partial<PrimaryLocation>) => void;
}) {
  const [feedback, setFeedback] = useState("");
  const latitude = parseLocationNumber(primary.latitude);
  const longitude = parseLocationNumber(primary.longitude);
  const radiusMeters = parseLocationNumber(primary.radiusMeters);
  const mapUrl =
    latitude === null || longitude === null || radiusMeters === null
      ? null
      : openStreetMapEmbedUrl(latitude, longitude, radiusMeters);
  const permittedLocations = useMemo(
    () => [
      ...(latitude === null || longitude === null || radiusMeters === null
        ? []
        : [
            {
              label: "Local principal",
              latitude,
              longitude,
              radiusMeters,
              accuracyToleranceMeters: parseLocationNumber(primary.accuracyToleranceMeters) ?? 0,
            },
          ]),
      ...locations,
    ],
    [latitude, locations, longitude, primary.accuracyToleranceMeters, radiusMeters],
  );

  async function applyCurrentLocation() {
    try {
      const position = await requestDeviceLocation();
      const maximumAccuracy = parseLocationNumber(maxLocationAccuracyMeters) ?? 100;
      if (!hasAcceptableLocationAccuracy(position, maximumAccuracy)) {
        setFeedback(
          `O navegador encontrou apenas uma localização aproximada (${position.accuracyMeters?.toLocaleString("pt-BR") ?? "precisão desconhecida"} m; máximo ${maximumAccuracy.toLocaleString("pt-BR")} m). O local não foi alterado. Ative a localização precisa e o Wi-Fi ou tente pelo celular no restaurante.`,
        );
        return;
      }
      onPrimaryChange({
        latitude: String(position.latitude),
        longitude: String(position.longitude),
      });
      setFeedback(
        `Localização atual aplicada${position.accuracyMeters ? ` · precisão ${position.accuracyMeters} m` : ""}.`,
      );
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Não foi possível obter sua localização.",
      );
    }
  }

  async function testCurrentLocation() {
    try {
      const position = await requestDeviceLocation();
      const maximumAccuracy = parseLocationNumber(maxLocationAccuracyMeters) ?? 100;
      if (!hasAcceptableLocationAccuracy(position, maximumAccuracy)) {
        setFeedback(
          `Precisão de ${position.accuracyMeters ?? "desconhecida"} m acima do limite de ${maximumAccuracy} m.`,
        );
        return;
      }
      const matches = permittedLocations
        .map((configured) => ({
          label: configured.label,
          distance: distanceMeters(
            configured.latitude,
            configured.longitude,
            position.latitude,
            position.longitude,
          ),
          allowed: configured.radiusMeters + configured.accuracyToleranceMeters,
        }))
        .sort((left, right) => left.distance - right.distance);
      const closest = matches[0];
      if (!closest) {
        setFeedback("Configure ao menos um local antes de testar.");
        return;
      }
      setFeedback(
        closest.distance <= closest.allowed
          ? `Localização aprovada em ${closest.label}: ${Math.round(closest.distance)} m do ponto de referência.`
          : `Localização fora do raio: ${Math.round(closest.distance)} m de ${closest.label}; limite ${closest.allowed} m.`,
      );
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Não foi possível testar a localização.",
      );
    }
  }

  function updateLocation(id: string, patch: Partial<TimeTrackingLocation>) {
    onLocationsChange(
      locations.map((location) => (location.id === id ? { ...location, ...patch } : location)),
    );
  }

  return (
    <fieldset className="time-tracking-location-controls action-form__wide">
      <legend>Locais permitidos</legend>
      <p className="form-hint">
        Informe um endereço de referência, use a localização atual ou abra o mapa para conferir as
        coordenadas. O endereço não é enviado a serviços externos pelo GiroMesa.
      </p>
      <label>
        Endereço de referência
        <Input
          value={primary.address}
          onChange={(event) => onPrimaryChange({ address: event.target.value })}
          placeholder="Ex.: Rua das Flores, 123 — Centro"
        />
      </label>
      <div className="time-tracking-location-controls__actions">
        <Button onClick={() => void applyCurrentLocation()} type="button" variant="secondary">
          Usar minha localização
        </Button>
        <Button onClick={() => void testCurrentLocation()} type="button" variant="secondary">
          Testar localização
        </Button>
        {primary.address.trim() && (
          <a href={openStreetMapSearchUrl(primary.address)} rel="noreferrer" target="_blank">
            Pesquisar endereço no mapa
          </a>
        )}
      </div>
      {feedback && (
        <p className="form-hint" role="status">
          {feedback}
        </p>
      )}
      {mapUrl && (
        <Card className="time-tracking-location-controls__map">
          <iframe src={mapUrl} title="Prévia do local principal no mapa" />
          <span aria-hidden="true">Raio: {radiusMeters} m</span>
        </Card>
      )}
      <div className="time-tracking-location-controls__header">
        <strong>Locais adicionais</strong>
        <Button
          disabled={locations.length >= 10}
          onClick={() => onLocationsChange([...locations, newLocation(primary)])}
          type="button"
          variant="secondary"
        >
          Adicionar local
        </Button>
      </div>
      {locations.map((location) => (
        <Card className="time-tracking-location-controls__location" key={location.id}>
          <label>
            Nome do local
            <Input
              value={location.label}
              onChange={(event) => updateLocation(location.id, { label: event.target.value })}
            />
          </label>
          <label>
            Endereço de referência
            <Input
              value={location.address ?? ""}
              onChange={(event) => updateLocation(location.id, { address: event.target.value })}
            />
          </label>
          <label>
            Latitude
            <Input
              inputMode="decimal"
              max={90}
              min={-90}
              step="any"
              type="number"
              value={location.latitude}
              onChange={(event) => {
                const value = parseLocationNumber(event.target.value);
                if (value !== null) updateLocation(location.id, { latitude: value });
              }}
            />
          </label>
          <label>
            Longitude
            <Input
              inputMode="decimal"
              max={180}
              min={-180}
              step="any"
              type="number"
              value={location.longitude}
              onChange={(event) => {
                const value = parseLocationNumber(event.target.value);
                if (value !== null) updateLocation(location.id, { longitude: value });
              }}
            />
          </label>
          <label>
            Raio (m)
            <Input
              max={5000}
              min={25}
              type="number"
              value={location.radiusMeters}
              onChange={(event) => {
                const value = parseLocationNumber(event.target.value);
                if (value !== null) updateLocation(location.id, { radiusMeters: value });
              }}
            />
          </label>
          <label>
            Tolerância GPS (m)
            <Input
              max={500}
              min={0}
              type="number"
              value={location.accuracyToleranceMeters}
              onChange={(event) => {
                const value = parseLocationNumber(event.target.value);
                if (value !== null) updateLocation(location.id, { accuracyToleranceMeters: value });
              }}
            />
          </label>
          <Button
            onClick={() => onLocationsChange(locations.filter((item) => item.id !== location.id))}
            type="button"
            variant="danger"
          >
            Remover local
          </Button>
        </Card>
      ))}
    </fieldset>
  );
}
