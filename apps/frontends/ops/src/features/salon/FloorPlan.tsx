import {
  convexPolygonsOverlap,
  floorPlacementConflicts,
  rotatedRectangleCorners,
} from "@giromesa/domain/floor-geometry";
import { Button, Input, NativeSelect } from "@giromesa/ui";
import {
  Fragment,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

const PLAN_WIDTH = 1_000;
const PLAN_HEIGHT = 620;
const PLAN_ASPECT = PLAN_WIDTH / PLAN_HEIGHT;
const TABLE_WIDTH = 122;
const TABLE_HEIGHT = 76;
const MIN_TABLE_SIZE = 48;
const MAX_TABLE_SIZE = 260;
const MAX_COORDINATE = 1_000_000;

export type FloorPlanStatus =
  | "available"
  | "free"
  | "occupied"
  | "attention"
  | "closing"
  | "reserved"
  | "needs_cleaning"
  | "cleaning";

export type FloorPlanTableShape = "round" | "square" | "rectangle";

export interface FloorPlanGeometry {
  width: number;
  height: number;
  rotation: number;
  shape: FloorPlanTableShape;
}

export interface FloorPlanItem {
  id: string;
  operationId: string;
  label: string;
  seats: number;
  areaId: string;
  areaLabel: string;
  status: FloorPlanStatus;
  layoutX?: number | null;
  layoutY?: number | null;
  width?: number | null;
  height?: number | null;
  rotation?: number | null;
  shape?: FloorPlanTableShape | null;
  sectionColor?: string;
  sectionLabel?: string;
  responsible?: string;
  valueLabel?: string;
  groupId?: string;
  groupLabel?: string;
  accountCount?: number;
  hidden?: boolean;
  dimmed?: boolean;
  disabledReason?: string;
}

export interface FloorPlanPosition {
  tableId: string;
  roomId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  shape: FloorPlanTableShape;
}

export interface FloorPlanTableDetails {
  tableId: string;
  label: string;
  seats: number;
  roomId: string;
}

export interface FloorPlanElement {
  id: string;
  roomId: string;
  kind: "label" | "barrier";
  label?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface FloorPlanZone {
  id: string;
  label: string;
  points: Array<{ x: number; y: number }>;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FloorPlanZonePosition {
  roomId: string;
  points: Array<{ x: number; y: number }>;
}

export interface FloorPlanViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface FloorPlanStation {
  id: string;
  label: string;
  areaId: string;
  areaLabel: string;
  description: string;
  valueLabel?: string;
}

export type FloorPlanLayoutScope = "permanent" | "shift";

export interface JoinedShiftLayout {
  positions: FloorPlanPosition[];
  unplacedIds: string[];
}

const statusLabels: Record<FloorPlanStatus, string> = {
  available: "Livre",
  free: "Livre",
  occupied: "Ocupada",
  attention: "Chamando",
  closing: "Pediu conta",
  reserved: "Reservada",
  needs_cleaning: "A limpar",
  cleaning: "Em limpeza",
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function compactLabel(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

export function floorPlanDensity(tableCount: number): "normal" | "dense" | "very-dense" {
  if (tableCount > 300) return "very-dense";
  if (tableCount > 120) return "dense";
  return "normal";
}

function zoneWithBounds(
  id: string,
  label: string,
  points: Array<{ x: number; y: number }>,
): FloorPlanZone {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    id,
    label,
    points,
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

function buildZones(
  items: Array<{ areaId: string; areaLabel: string }>,
  savedZones: Array<{ id: string; label: string; points: Array<{ x: number; y: number }> }> = [],
): FloorPlanZone[] {
  const areas = [
    ...new Map(
      items.map((item) => [item.areaId, { id: item.areaId, label: item.areaLabel }]),
    ).values(),
  ];
  if (areas.length === 0) return [];
  const gap = 20;
  const marginX = 24;
  const marginY = 26;
  let cursorX = marginX;
  const zones: FloorPlanZone[] = [];
  for (const area of areas) {
    const saved = savedZones.find((zone) => zone.id === area.id);
    if (saved) {
      let zone = zoneWithBounds(area.id, area.label, saved.points);
      const blockers = zones.filter(
        (candidate) =>
          zone.y < candidate.y + candidate.height + gap && zone.y + zone.height + gap > candidate.y,
      );
      if (
        blockers.some(
          (candidate) =>
            zone.x < candidate.x + candidate.width + gap && zone.x + zone.width + gap > candidate.x,
        )
      ) {
        const nextX = Math.max(...blockers.map((candidate) => candidate.x + candidate.width)) + gap;
        const offset = nextX - zone.x;
        zone = zoneWithBounds(
          area.id,
          area.label,
          zone.points.map((point) => ({ ...point, x: point.x + offset })),
        );
      }
      zones.push(zone);
      cursorX = Math.max(cursorX, zone.x + zone.width + gap);
      continue;
    }
    const count = Math.max(1, items.filter((item) => item.areaId === area.id).length);
    const columns = Math.min(6, Math.max(2, Math.ceil(Math.sqrt(count))));
    const rows = Math.ceil(count / columns);
    const width = Math.max(420, columns * (TABLE_WIDTH + 22) + 48);
    const height = Math.max(300, rows * (TABLE_HEIGHT + 24) + 120);
    const x = cursorX;
    cursorX += width + gap;
    zones.push(
      zoneWithBounds(area.id, area.label, [
        { x, y: marginY },
        { x: x + width, y: marginY },
        { x: x + width, y: marginY + height },
        { x, y: marginY + height },
      ]),
    );
  }
  return zones;
}

function pointInsidePolygon(
  point: { x: number; y: number },
  polygon: Array<{ x: number; y: number }>,
) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    if (!currentPoint || !previousPoint) continue;
    const crosses =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function geometryFor(item: FloorPlanItem): FloorPlanGeometry {
  const shape = item.shape ?? "rectangle";
  const width = clamp(item.width ?? TABLE_WIDTH, MIN_TABLE_SIZE, MAX_TABLE_SIZE);
  const height = clamp(
    shape === "square" || shape === "round"
      ? (item.height ?? width)
      : (item.height ?? TABLE_HEIGHT),
    MIN_TABLE_SIZE,
    MAX_TABLE_SIZE,
  );
  return { width, height, rotation: item.rotation ?? 0, shape };
}

export function floorPlanRectanglesOverlap(
  left: { x: number; y: number; width: number; height: number; rotation?: number },
  right: { x: number; y: number; width: number; height: number; rotation?: number },
) {
  return convexPolygonsOverlap(
    rotatedRectangleCorners({ ...left, rotation: left.rotation ?? 0 }),
    rotatedRectangleCorners({ ...right, rotation: right.rotation ?? 0 }),
  );
}

export function floorPlanPlacementAllowed(
  placement: { x: number; y: number; width: number; height: number; rotation?: number },
  roomBoundary: readonly { x: number; y: number }[],
  occupied: readonly { x: number; y: number; width: number; height: number; rotation?: number }[],
  barriers: readonly { x: number; y: number; width: number; height: number; rotation?: number }[],
) {
  const normalized = { ...placement, rotation: placement.rotation ?? 0 };
  const boundary = floorPlacementConflicts(
    { ...normalized, width: normalized.width + 16, height: normalized.height + 16 },
    roomBoundary,
    [],
    [],
  );
  const collision = floorPlacementConflicts(
    normalized,
    roomBoundary,
    occupied.map((item) => ({ ...item, rotation: item.rotation ?? 0 })),
    barriers.map((item) => ({ ...item, rotation: item.rotation ?? 0 })),
  );
  return !boundary.outsideRoom && !collision.overlapsObject && !collision.overlapsBarrier;
}

export function floorPlanKeyboardMovement(key: string, step = 10) {
  const movements: Record<string, { x: number; y: number }> = {
    ArrowLeft: { x: -step, y: 0 },
    ArrowRight: { x: step, y: 0 },
    ArrowUp: { x: 0, y: -step },
    ArrowDown: { x: 0, y: step },
  };
  return movements[key] ?? null;
}

function tableFitsZone(
  x: number,
  y: number,
  zone: FloorPlanZone,
  geometry: Pick<FloorPlanGeometry, "width" | "height" | "rotation"> = {
    width: TABLE_WIDTH,
    height: TABLE_HEIGHT,
    rotation: 0,
  },
) {
  return rotatedRectangleCorners({
    x,
    y,
    width: geometry.width + 16,
    height: geometry.height + 16,
    rotation: geometry.rotation,
  }).every((point) => pointInsidePolygon(point, zone.points));
}

export function buildFloorPlanPositions(
  items: FloorPlanItem[],
  stations: FloorPlanStation[] = [],
  savedZones: Array<{ id: string; label: string; points: Array<{ x: number; y: number }> }> = [],
  elements: FloorPlanElement[] = [],
) {
  const zones = buildZones([...items, ...stations], savedZones);
  const positions: Record<string, { x: number; y: number }> = {};
  const unpositionedIds: string[] = [];
  for (const zone of zones) {
    const areaItems = items.filter((item) => item.areaId === zone.id);
    const stationOffset = stations.some((station) => station.areaId === zone.id) ? 38 : 0;
    const candidates: Array<{ x: number; y: number }> = [];
    for (
      let y = zone.y + 62 + stationOffset + TABLE_HEIGHT / 2;
      y <= zone.y + zone.height - TABLE_HEIGHT / 2 - 12;
      y += TABLE_HEIGHT + 24
    ) {
      for (
        let x = zone.x + TABLE_WIDTH / 2 + 12;
        x <= zone.x + zone.width - TABLE_WIDTH / 2 - 12;
        x += TABLE_WIDTH + 22
      ) {
        if (tableFitsZone(x, y, zone)) candidates.push({ x, y });
      }
    }
    const occupied: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
      rotation: number;
    }> = [];
    const barriers = elements.flatMap((element) =>
      element.kind === "barrier" && element.roomId === zone.id
        ? [
            {
              x: element.x,
              y: element.y,
              width: element.width,
              height: element.height,
              rotation: element.rotation,
            },
          ]
        : [],
    );
    const ordered = [...areaItems].sort(
      (left, right) =>
        Number(right.layoutX !== null && right.layoutX !== undefined) -
        Number(left.layoutX !== null && left.layoutX !== undefined),
    );
    for (const item of ordered) {
      const geometry = geometryFor(item);
      const persisted =
        item.layoutX !== null &&
        item.layoutX !== undefined &&
        item.layoutY !== null &&
        item.layoutY !== undefined
          ? { x: item.layoutX, y: item.layoutY }
          : null;
      const position =
        persisted &&
        floorPlanPlacementAllowed({ ...persisted, ...geometry }, zone.points, occupied, barriers)
          ? persisted
          : candidates.find((candidate) =>
              floorPlanPlacementAllowed(
                { ...candidate, ...geometry },
                zone.points,
                occupied,
                barriers,
              ),
            );
      if (!position) {
        unpositionedIds.push(item.id);
        continue;
      }
      positions[item.id] = position;
      occupied.push({ ...position, ...geometry });
    }
  }
  const rightEdge = Math.max(PLAN_WIDTH, ...zones.map((zone) => zone.x + zone.width));
  const topEdge = Math.min(0, ...zones.map((zone) => zone.y));
  for (const [index, tableId] of unpositionedIds.entries()) {
    positions[tableId] = {
      x: rightEdge + 100 + (index % 4) * (TABLE_WIDTH + 22),
      y: topEdge + 90 + Math.floor(index / 4) * (TABLE_HEIGHT + 24),
    };
  }
  return { positions, zones, unpositionedIds };
}

export function buildJoinedShiftLayout(
  items: FloorPlanItem[],
  tableIds: string[],
  anchorId: string,
  stations: FloorPlanStation[] = [],
  savedZones: Array<{ id: string; label: string; points: Array<{ x: number; y: number }> }> = [],
  elements: FloorPlanElement[] = [],
): JoinedShiftLayout {
  const selectedIds = [...new Set(tableIds)];
  const anchor = items.find((item) => item.id === anchorId);
  if (!anchor || selectedIds.length < 2) return { positions: [], unplacedIds: selectedIds };

  const layout = buildFloorPlanPositions(items, stations, savedZones, elements);
  const anchorPosition = layout.positions[anchor.id];
  const targetZone = layout.zones.find((zone) => zone.id === anchor.areaId);
  if (!anchorPosition || !targetZone) return { positions: [], unplacedIds: selectedIds };

  const occupied = items.flatMap((item) => {
    const position = layout.positions[item.id];
    return position && !selectedIds.includes(item.id) && item.areaId === targetZone.id
      ? [{ ...position, ...geometryFor(item) }]
      : [];
  });
  const barriers = elements.flatMap((element) =>
    element.kind === "barrier" && element.roomId === targetZone.id
      ? [
          {
            x: element.x,
            y: element.y,
            width: element.width,
            height: element.height,
            rotation: element.rotation,
          },
        ]
      : [],
  );
  const anchorGeometry = geometryFor(anchor);
  const placed: FloorPlanPosition[] = [
    { tableId: anchor.id, roomId: targetZone.id, ...anchorPosition, ...anchorGeometry },
  ];
  const used = [...occupied, { ...anchorPosition, ...anchorGeometry }];
  const stepX = TABLE_WIDTH + 22;
  const stepY = TABLE_HEIGHT + 24;
  const offsets: Array<{ x: number; y: number }> = [];
  for (let ring = 1; ring <= 6; ring += 1) {
    for (let column = -ring; column <= ring; column += 1) {
      offsets.push({ x: column * stepX, y: -ring * stepY });
      offsets.push({ x: column * stepX, y: ring * stepY });
    }
    for (let row = -ring + 1; row < ring; row += 1) {
      offsets.push({ x: -ring * stepX, y: row * stepY });
      offsets.push({ x: ring * stepX, y: row * stepY });
    }
  }

  const unplacedIds: string[] = [];
  for (const tableId of selectedIds.filter((id) => id !== anchor.id)) {
    const item = items.find((candidateItem) => candidateItem.id === tableId);
    const geometry = item
      ? geometryFor(item)
      : { width: TABLE_WIDTH, height: TABLE_HEIGHT, rotation: 0, shape: "rectangle" as const };
    const candidate = offsets
      .map((offset) => ({ x: anchorPosition.x + offset.x, y: anchorPosition.y + offset.y }))
      .find((position) =>
        floorPlanPlacementAllowed({ ...position, ...geometry }, targetZone.points, used, barriers),
      );
    if (!candidate) {
      unplacedIds.push(tableId);
      continue;
    }
    placed.push({
      tableId,
      roomId: targetZone.id,
      ...candidate,
      ...geometry,
    });
    used.push({ ...candidate, ...geometry });
  }
  return { positions: placed, unplacedIds };
}

function viewportDimensions(zoom: number, aspect: number) {
  if (aspect < PLAN_ASPECT) {
    const height = PLAN_HEIGHT / zoom;
    return { width: height * aspect, height };
  }
  const width = PLAN_WIDTH / zoom;
  return { width, height: width / aspect };
}

function clampViewport(viewport: FloorPlanViewport, _aspect: number): FloorPlanViewport {
  return { ...viewport, zoom: clamp(viewport.zoom, 0.2, 4) };
}

export function zoomFloorPlanViewport(
  viewport: FloorPlanViewport,
  aspect: number,
  zoom: number,
  anchor = { x: 0.5, y: 0.5 },
) {
  const currentSize = viewportDimensions(viewport.zoom, aspect);
  const nextSize = viewportDimensions(clamp(zoom, 0.2, 4), aspect);
  const worldX = viewport.x + currentSize.width * anchor.x;
  const worldY = viewport.y + currentSize.height * anchor.y;
  return clampViewport(
    {
      zoom,
      x: worldX - nextSize.width * anchor.x,
      y: worldY - nextSize.height * anchor.y,
    },
    aspect,
  );
}

export function fitFloorPlanViewport(
  points: Array<{ x: number; y: number }>,
  aspect: number,
): FloorPlanViewport {
  if (points.length === 0) return { x: 0, y: 0, zoom: 1 };
  const minimumX = Math.min(...points.map((point) => point.x));
  const maximumX = Math.max(...points.map((point) => point.x));
  const minimumY = Math.min(...points.map((point) => point.y));
  const maximumY = Math.max(...points.map((point) => point.y));
  const base = viewportDimensions(1, aspect);
  const targetWidth = Math.max(TABLE_WIDTH * 2, maximumX - minimumX + 48);
  const targetHeight = Math.max(TABLE_HEIGHT * 2, maximumY - minimumY + 48);
  const zoom = clamp(
    Math.min(points.length === 1 ? 1.8 : 4, base.width / targetWidth, base.height / targetHeight),
    0.2,
    4,
  );
  const size = viewportDimensions(zoom, aspect);
  return clampViewport(
    {
      zoom,
      x: (minimumX + maximumX) / 2 - size.width / 2,
      y: (minimumY + maximumY) / 2 - size.height / 2,
    },
    aspect,
  );
}

export function parseFloorPlanViewport(value: string | null): FloorPlanViewport | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<FloorPlanViewport>;
    if (
      typeof parsed.x !== "number" ||
      !Number.isFinite(parsed.x) ||
      typeof parsed.y !== "number" ||
      !Number.isFinite(parsed.y) ||
      typeof parsed.zoom !== "number" ||
      !Number.isFinite(parsed.zoom)
    ) {
      return null;
    }
    return { x: parsed.x, y: parsed.y, zoom: parsed.zoom };
  } catch {
    return null;
  }
}

export function resolveFloorPlanFullscreenTarget(element: HTMLElement | null) {
  return element?.closest<HTMLElement>("[data-salon-operation-shell]") ?? element;
}

export function FloorPlan({
  items,
  elements = [],
  selectedIds,
  focusId,
  joinMode,
  stations = [],
  zones = [],
  editableZoneIds,
  viewportStorageKey,
  canEdit = false,
  editActionLabel = "Editar planta",
  saveActionLabel = "Salvar planta",
  editingDescription = "Arraste as mesas e salve a nova organização.",
  layoutScope = "permanent",
  editRequestKey = 0,
  operateRequestKey = 0,
  canEditElements = layoutScope === "permanent",
  editorTool = "move",
  editableItemIds,
  onSelect,
  onSelectStation,
  onSavePositions,
  onEditingChange,
  onEditSelect,
  onArchiveTable,
}: {
  items: FloorPlanItem[];
  elements?: FloorPlanElement[];
  selectedIds: string[];
  focusId?: string | null;
  joinMode: boolean;
  stations?: FloorPlanStation[];
  zones?: Array<{ id: string; label: string; points: Array<{ x: number; y: number }> }>;
  editableZoneIds?: string[];
  viewportStorageKey?: string;
  canEdit?: boolean;
  editActionLabel?: string;
  saveActionLabel?: string;
  editingDescription?: string;
  layoutScope?: FloorPlanLayoutScope;
  editRequestKey?: number;
  operateRequestKey?: number;
  canEditElements?: boolean;
  editorTool?: "move" | "assign";
  editableItemIds?: string[];
  onSelect: (operationId: string) => void;
  onSelectStation?: (stationId: string) => void;
  onSavePositions?: (
    positions: FloorPlanPosition[],
    zones: FloorPlanZonePosition[],
    elements: FloorPlanElement[],
    tableDetails: FloorPlanTableDetails[],
  ) => boolean | Promise<boolean>;
  onEditingChange?: (editing: boolean) => void;
  onEditSelect?: (tableId: string) => void;
  onArchiveTable?: (tableId: string) => boolean | Promise<boolean>;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const keyboardRef = useRef<HTMLButtonElement>(null);
  const layersRef = useRef<HTMLDetailsElement>(null);
  const focusedIdRef = useRef<string | null>(null);
  const editRequestRef = useRef(0);
  const operateRequestRef = useRef(0);
  const panRef = useRef<
    | {
        pointerId: number;
        clientX: number;
        clientY: number;
        viewport: FloorPlanViewport;
      }
    | undefined
  >(undefined);
  const pannedRef = useRef(false);
  const dragRef = useRef<
    | { pointerId: number; tableId: string; areaId: string; offsetX: number; offsetY: number }
    | undefined
  >(undefined);
  const elementDragRef = useRef<
    { pointerId: number; elementId: string; offsetX: number; offsetY: number } | undefined
  >(undefined);
  const resizeRef = useRef<
    | {
        pointerId: number;
        tableId: string;
        start: { x: number; y: number };
        geometry: FloorPlanGeometry;
      }
    | undefined
  >(undefined);
  const zoneDragRef = useRef<{ pointerId: number; zoneId: string; pointIndex: number } | undefined>(
    undefined,
  );
  const gridId = `floor-plan-grid-${useId().replaceAll(":", "")}`;
  const layout = useMemo(
    () => buildFloorPlanPositions(items, stations, zones, elements),
    [elements, items, stations, zones],
  );
  const [draftPositions, setDraftPositions] = useState(layout.positions);
  const [draftGeometry, setDraftGeometry] = useState<Record<string, FloorPlanGeometry>>(() =>
    Object.fromEntries(items.map((item) => [item.id, geometryFor(item)])),
  );
  const [draftTableDetails, setDraftTableDetails] = useState<
    Record<string, Omit<FloorPlanTableDetails, "tableId">>
  >(() =>
    Object.fromEntries(
      items.map((item) => [item.id, { label: item.label, seats: item.seats, roomId: item.areaId }]),
    ),
  );
  const [draftElements, setDraftElements] = useState(elements);
  const [selectedEditorTarget, setSelectedEditorTarget] = useState<{
    kind: "table" | "element";
    id: string;
  } | null>(null);
  const [draftAreaIds, setDraftAreaIds] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((item) => [item.id, item.areaId])),
  );
  const [draftZones, setDraftZones] = useState(layout.zones);
  const [draftUnpositioned, setDraftUnpositioned] = useState(() => new Set(layout.unpositionedIds));
  const [surfaceAspect, setSurfaceAspect] = useState(PLAN_ASPECT);
  const [viewport, setViewport] = useState<FloorPlanViewport>(() => {
    if (!viewportStorageKey || typeof window === "undefined") return { x: 0, y: 0, zoom: 1 };
    const saved = parseFloorPlanViewport(window.localStorage.getItem(viewportStorageKey));
    return saved ? clampViewport(saved, PLAN_ASPECT) : { x: 0, y: 0, zoom: 1 };
  });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(true);
  const [layersOpen, setLayersOpen] = useState(false);
  const [layers, setLayers] = useState({ space: true, tables: true, operation: true });
  const positions = editing ? draftPositions : layout.positions;
  const visibleElements = editing ? draftElements : elements;
  const visibleZones = editing ? draftZones : layout.zones;
  const visibleItems = useMemo(() => items.filter((item) => !item.hidden), [items]);
  const density = floorPlanDensity(visibleItems.length);
  const contentPoints = useMemo(
    () => [
      ...visibleZones.flatMap((zone) => zone.points),
      ...visibleItems.flatMap((item) => {
        const position = positions[item.id];
        return position ? [position] : [];
      }),
      ...visibleElements.flatMap((element) => [
        { x: element.x - element.width / 2, y: element.y - element.height / 2 },
        { x: element.x + element.width / 2, y: element.y + element.height / 2 },
      ]),
    ],
    [positions, visibleElements, visibleItems, visibleZones],
  );
  const { width: viewWidth, height: viewHeight } = viewportDimensions(viewport.zoom, surfaceAspect);

  useEffect(() => {
    if (!editing) {
      setDraftPositions(layout.positions);
      setDraftGeometry(Object.fromEntries(items.map((item) => [item.id, geometryFor(item)])));
      setDraftTableDetails(
        Object.fromEntries(
          items.map((item) => [
            item.id,
            { label: item.label, seats: item.seats, roomId: item.areaId },
          ]),
        ),
      );
      setDraftElements(elements);
      setSelectedEditorTarget(null);
      setDraftAreaIds(Object.fromEntries(items.map((item) => [item.id, item.areaId])));
      setDraftZones(layout.zones);
      setDraftUnpositioned(new Set(layout.unpositionedIds));
    }
  }, [editing, elements, items, layout.positions, layout.unpositionedIds, layout.zones]);

  useEffect(() => {
    if (
      !editRequestKey ||
      editRequestRef.current === editRequestKey ||
      !canEdit ||
      !onSavePositions
    ) {
      return;
    }
    editRequestRef.current = editRequestKey;
    setDraftPositions(layout.positions);
    setDraftGeometry(Object.fromEntries(items.map((item) => [item.id, geometryFor(item)])));
    setDraftTableDetails(
      Object.fromEntries(
        items.map((item) => [
          item.id,
          { label: item.label, seats: item.seats, roomId: item.areaId },
        ]),
      ),
    );
    setDraftElements(elements);
    setSelectedEditorTarget(null);
    setDraftAreaIds(Object.fromEntries(items.map((item) => [item.id, item.areaId])));
    setDraftZones(layout.zones);
    setDraftUnpositioned(new Set(layout.unpositionedIds));
    setLayers({ space: true, tables: true, operation: true });
    setEditing(true);
    onEditingChange?.(true);
  }, [canEdit, editRequestKey, elements, items, layout, onEditingChange, onSavePositions]);

  useEffect(() => {
    if (!operateRequestKey || operateRequestRef.current === operateRequestKey) return;
    operateRequestRef.current = operateRequestKey;
    setDraftPositions(layout.positions);
    setDraftGeometry(Object.fromEntries(items.map((item) => [item.id, geometryFor(item)])));
    setDraftTableDetails(
      Object.fromEntries(
        items.map((item) => [
          item.id,
          { label: item.label, seats: item.seats, roomId: item.areaId },
        ]),
      ),
    );
    setDraftElements(elements);
    setDraftAreaIds(Object.fromEntries(items.map((item) => [item.id, item.areaId])));
    setDraftZones(layout.zones);
    setDraftUnpositioned(new Set(layout.unpositionedIds));
    setSelectedEditorTarget(null);
    setEditing(false);
    onEditingChange?.(false);
  }, [elements, items, layout, onEditingChange, operateRequestKey]);

  useEffect(() => {
    const onFullscreenChange = () =>
      setFullscreen(
        document.fullscreenElement === resolveFloorPlanFullscreenTarget(wrapperRef.current),
      );
    onFullscreenChange();
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    if (fullscreen && contentPoints.length > 0) {
      setViewport(fitFloorPlanViewport(contentPoints, surfaceAspect));
    }
  }, [contentPoints, fullscreen, surfaceAspect]);

  useEffect(() => {
    if (!viewportStorageKey || typeof window === "undefined") return;
    window.localStorage.setItem(viewportStorageKey, JSON.stringify(viewport));
  }, [viewport, viewportStorageKey]);

  useEffect(() => {
    if (!layersOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!layersRef.current?.contains(event.target as Node)) setLayersOpen(false);
    };
    const closeWithEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setLayersOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [layersOpen]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.height === 0) return;
      const nextAspect = entry.contentRect.width / entry.contentRect.height;
      setSurfaceAspect(nextAspect);
      setViewport((current) => clampViewport(current, nextAspect));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!focusId) {
      focusedIdRef.current = null;
      return;
    }
    if (focusedIdRef.current === focusId) return;
    const position = positions[focusId];
    if (!position) return;
    focusedIdRef.current = focusId;
    const zoom = 1.65;
    const focusedViewport = viewportDimensions(zoom, surfaceAspect);
    setViewport(
      clampViewport(
        {
          zoom,
          x: position.x - focusedViewport.width / 2,
          y: position.y - focusedViewport.height / 2,
        },
        surfaceAspect,
      ),
    );
  }, [focusId, positions, surfaceAspect]);

  function worldPoint(event: ReactPointerEvent<SVGSVGElement | SVGGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: viewport.x + ((event.clientX - rect.left) / rect.width) * viewWidth,
      y: viewport.y + ((event.clientY - rect.top) / rect.height) * viewHeight,
    };
  }

  function changeZoom(delta: number) {
    setViewport((current) => zoomFloorPlanViewport(current, surfaceAspect, current.zoom + delta));
  }

  function handleWheel(event: ReactWheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const anchor = {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
    setViewport((current) =>
      zoomFloorPlanViewport(
        current,
        surfaceAspect,
        current.zoom * Math.exp(-event.deltaY * 0.0015),
        anchor,
      ),
    );
  }

  function handlePlanPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (editing) return;
    keyboardRef.current?.focus({ preventScroll: true });
    pannedRef.current = false;
    panRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      viewport,
    };
  }

  function updateZonePoint(
    zoneId: string,
    pointIndex: number,
    update: (point: { x: number; y: number }) => { x: number; y: number },
  ) {
    setDraftZones((current) =>
      current.map((zone) =>
        zone.id === zoneId
          ? zoneWithBounds(
              zone.id,
              zone.label,
              zone.points.map((point, index) => (index === pointIndex ? update(point) : point)),
            )
          : zone,
      ),
    );
  }

  function updateGeometry(tableId: string, update: Partial<FloorPlanGeometry>) {
    const item = items.find((candidate) => candidate.id === tableId);
    if (!item) return;
    const base = draftGeometry[tableId] ?? geometryFor(item);
    const shape = update.shape ?? base.shape;
    const width = clamp(update.width ?? base.width, MIN_TABLE_SIZE, MAX_TABLE_SIZE);
    const next = {
      ...base,
      ...update,
      width,
      height: clamp(
        shape === "square" || shape === "round"
          ? (update.width ?? update.height ?? width)
          : (update.height ?? base.height),
        MIN_TABLE_SIZE,
        MAX_TABLE_SIZE,
      ),
      rotation: ((Math.round(update.rotation ?? base.rotation) % 360) + 360) % 360,
      shape,
    };
    const position = draftPositions[tableId];
    const zone = visibleZones.find(
      (candidate) => candidate.id === (draftAreaIds[tableId] ?? item.areaId),
    );
    if (position && zone && !tablePlacementAllowed(tableId, position, next, zone)) return;
    setDraftGeometry((current) => ({ ...current, [tableId]: next }));
  }

  function tablePlacementAllowed(
    tableId: string,
    position: { x: number; y: number },
    geometry: FloorPlanGeometry,
    zone: FloorPlanZone,
  ) {
    const candidate = { ...position, ...geometry };
    const occupied = visibleItems.flatMap((item) => {
      if (item.id === tableId) return [];
      const otherPosition = draftPositions[item.id] ?? positions[item.id];
      if (!otherPosition) return [];
      return [{ ...otherPosition, ...(draftGeometry[item.id] ?? geometryFor(item)) }];
    });
    const barriers = draftElements.flatMap((element) =>
      element.kind === "barrier"
        ? [
            {
              x: element.x,
              y: element.y,
              width: element.width,
              height: element.height,
              rotation: element.rotation,
            },
          ]
        : [],
    );
    return floorPlanPlacementAllowed(candidate, zone.points, occupied, barriers);
  }

  function updateElement(elementId: string, update: Partial<FloorPlanElement>) {
    const current = draftElements.find((element) => element.id === elementId);
    if (!current) return;
    const next = {
      ...current,
      ...update,
      width: clamp(update.width ?? current.width, 24, 600),
      height: clamp(update.height ?? current.height, 8, 300),
      rotation: ((Math.round(update.rotation ?? current.rotation) % 360) + 360) % 360,
    };
    if (next.kind === "barrier") {
      const zone = visibleZones.find((candidate) => candidate.id === next.roomId);
      if (
        !zone ||
        !rotatedRectangleCorners(next).every((point) => pointInsidePolygon(point, zone.points))
      ) {
        return;
      }
      const overlapsTable = visibleItems.some((item) => {
        const position = draftPositions[item.id] ?? positions[item.id];
        if (!position) return false;
        return convexPolygonsOverlap(
          rotatedRectangleCorners(next),
          rotatedRectangleCorners({
            ...position,
            ...(draftGeometry[item.id] ?? geometryFor(item)),
          }),
        );
      });
      if (overlapsTable) return;
    }
    setDraftElements((elements) =>
      elements.map((element) => (element.id === elementId ? next : element)),
    );
  }

  function handlePlanKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const horizontalStep = viewWidth * 0.12;
    const verticalStep = viewHeight * 0.12;
    const movements: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -horizontalStep, y: 0 },
      ArrowRight: { x: horizontalStep, y: 0 },
      ArrowUp: { x: 0, y: -verticalStep },
      ArrowDown: { x: 0, y: verticalStep },
    };
    const movement = movements[event.key];
    if (movement) {
      event.preventDefault();
      setViewport((current) =>
        clampViewport(
          { ...current, x: current.x + movement.x, y: current.y + movement.y },
          surfaceAspect,
        ),
      );
      return;
    }
    if (["+", "="].includes(event.key)) {
      event.preventDefault();
      changeZoom(0.25);
      return;
    }
    if (event.key === "-") {
      event.preventDefault();
      changeZoom(-0.25);
      return;
    }
    if (["0", "Home"].includes(event.key)) {
      event.preventDefault();
      setViewport(fitFloorPlanViewport(contentPoints, surfaceAspect));
    }
  }

  function fitSelection() {
    const selectedPoints = visibleItems.flatMap((item) => {
      const position = selectedIds.includes(item.operationId) ? positions[item.id] : undefined;
      return position ? [position] : [];
    });
    setViewport(fitFloorPlanViewport(selectedPoints, surfaceAspect));
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const zoneDrag = zoneDragRef.current;
    if (zoneDrag?.pointerId === event.pointerId) {
      const point = worldPoint(event);
      updateZonePoint(zoneDrag.zoneId, zoneDrag.pointIndex, () => ({
        x: Math.round(clamp(point.x, -MAX_COORDINATE, MAX_COORDINATE) / 10) * 10,
        y: Math.round(clamp(point.y, -MAX_COORDINATE, MAX_COORDINATE) / 10) * 10,
      }));
      return;
    }
    const resize = resizeRef.current;
    if (resize?.pointerId === event.pointerId) {
      const point = worldPoint(event);
      const deltaX = Math.abs(point.x - resize.start.x) * 2;
      const deltaY = Math.abs(point.y - resize.start.y) * 2;
      updateGeometry(resize.tableId, {
        width: Math.max(MIN_TABLE_SIZE, deltaX),
        height: Math.max(MIN_TABLE_SIZE, deltaY),
      });
      return;
    }
    const elementDrag = elementDragRef.current;
    if (elementDrag?.pointerId === event.pointerId) {
      const point = worldPoint(event);
      const element = draftElements.find((candidate) => candidate.id === elementDrag.elementId);
      if (!element) return;
      const next = {
        x: Math.round((point.x - elementDrag.offsetX) / 10) * 10,
        y: Math.round((point.y - elementDrag.offsetY) / 10) * 10,
      };
      const zone = visibleZones.find((candidate) => pointInsidePolygon(next, candidate.points));
      if (!zone) return;
      if (
        element.kind === "barrier" &&
        visibleItems.some((item) => {
          const position = draftPositions[item.id] ?? positions[item.id];
          if (!position) return false;
          return floorPlanRectanglesOverlap(
            { ...next, width: element.width, height: element.height, rotation: element.rotation },
            { ...position, ...(draftGeometry[item.id] ?? geometryFor(item)) },
          );
        })
      ) {
        return;
      }
      updateElement(element.id, { ...next, roomId: zone.id });
      return;
    }
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) {
      const point = worldPoint(event);
      const zone =
        visibleZones.find((candidate) => pointInsidePolygon(point, candidate.points)) ??
        visibleZones.find((candidate) => candidate.id === draftAreaIds[drag.tableId]);
      if (!zone) return;
      const geometry = draftGeometry[drag.tableId] ?? {
        width: TABLE_WIDTH,
        height: TABLE_HEIGHT,
        rotation: 0,
        shape: "rectangle" as const,
      };
      const x =
        Math.round(
          clamp(
            point.x - drag.offsetX,
            zone.x + geometry.width / 2 + 12,
            zone.x + zone.width - geometry.width / 2 - 12,
          ) / 10,
        ) * 10;
      const y =
        Math.round(
          clamp(
            point.y - drag.offsetY,
            zone.y + geometry.height / 2 + 38,
            zone.y + zone.height - geometry.height / 2 - 12,
          ) / 10,
        ) * 10;
      if (!tablePlacementAllowed(drag.tableId, { x, y }, geometry, zone)) return;
      setDraftPositions((current) => ({ ...current, [drag.tableId]: { x, y } }));
      setDraftAreaIds((current) => ({ ...current, [drag.tableId]: zone.id }));
      setDraftUnpositioned((current) => {
        if (!current.has(drag.tableId)) return current;
        const next = new Set(current);
        next.delete(drag.tableId);
        return next;
      });
      return;
    }
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (Math.hypot(event.clientX - pan.clientX, event.clientY - pan.clientY) > 4) {
      pannedRef.current = true;
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    }
    setViewport(
      clampViewport(
        {
          ...pan.viewport,
          x: pan.viewport.x - ((event.clientX - pan.clientX) / rect.width) * viewWidth,
          y: pan.viewport.y - ((event.clientY - pan.clientY) / rect.height) * viewHeight,
        },
        surfaceAspect,
      ),
    );
  }

  function finishPointer(event: ReactPointerEvent<SVGSVGElement>) {
    const finishedPan = panRef.current?.pointerId === event.pointerId && pannedRef.current;
    if (zoneDragRef.current?.pointerId === event.pointerId) zoneDragRef.current = undefined;
    if (resizeRef.current?.pointerId === event.pointerId) resizeRef.current = undefined;
    if (elementDragRef.current?.pointerId === event.pointerId) elementDragRef.current = undefined;
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = undefined;
    if (panRef.current?.pointerId === event.pointerId) panRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // Preserve the flag through the synthetic click emitted after pointerup, then release it.
    if (finishedPan) window.setTimeout(() => (pannedRef.current = false), 0);
  }

  function startZoneDrag(
    event: ReactPointerEvent<SVGCircleElement>,
    zoneId: string,
    pointIndex: number,
  ) {
    event.stopPropagation();
    event.preventDefault();
    svgRef.current?.setPointerCapture(event.pointerId);
    zoneDragRef.current = { pointerId: event.pointerId, zoneId, pointIndex };
  }

  function startTableDrag(event: ReactPointerEvent<SVGGElement>, item: FloorPlanItem) {
    if (
      !editing ||
      editorTool === "assign" ||
      (editableItemIds && !editableItemIds.includes(item.id))
    ) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    const point = worldPoint(event);
    const position = positions[item.id];
    if (!position) return;
    setSelectedEditorTarget({ kind: "table", id: item.id });
    svgRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      tableId: item.id,
      areaId: draftAreaIds[item.id] ?? item.areaId,
      offsetX: point.x - position.x,
      offsetY: point.y - position.y,
    };
  }

  function startResize(event: ReactPointerEvent<SVGCircleElement>, item: FloorPlanItem) {
    if (!editing) return;
    event.stopPropagation();
    event.preventDefault();
    const position = positions[item.id];
    if (!position) return;
    svgRef.current?.setPointerCapture(event.pointerId);
    setSelectedEditorTarget({ kind: "table", id: item.id });
    resizeRef.current = {
      pointerId: event.pointerId,
      tableId: item.id,
      start: position,
      geometry: draftGeometry[item.id] ?? geometryFor(item),
    };
  }

  function startElementDrag(event: ReactPointerEvent<SVGGElement>, element: FloorPlanElement) {
    if (!editing || !canEditElements) return;
    event.stopPropagation();
    event.preventDefault();
    const point = worldPoint(event);
    svgRef.current?.setPointerCapture(event.pointerId);
    setSelectedEditorTarget({ kind: "element", id: element.id });
    elementDragRef.current = {
      pointerId: event.pointerId,
      elementId: element.id,
      offsetX: point.x - element.x,
      offsetY: point.y - element.y,
    };
  }

  function activate(item: FloorPlanItem) {
    if (pannedRef.current) {
      pannedRef.current = false;
      return;
    }
    if (editing) {
      if (editorTool === "assign" && (!editableItemIds || editableItemIds.includes(item.id))) {
        onEditSelect?.(item.id);
      }
      return;
    }
    if (item.disabledReason) return;
    onSelect(item.operationId);
  }

  function handleTableKey(event: KeyboardEvent<SVGGElement>, item: FloorPlanItem) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (editing && editorTool === "move") {
        setSelectedEditorTarget({ kind: "table", id: item.id });
        return;
      }
      activate(item);
      return;
    }
    if (
      !editing ||
      editorTool !== "move" ||
      (editableItemIds && !editableItemIds.includes(item.id))
    ) {
      return;
    }
    const movement = floorPlanKeyboardMovement(event.key);
    if (!movement) return;
    const position = draftPositions[item.id] ?? positions[item.id];
    const zone = visibleZones.find(
      (candidate) => candidate.id === (draftAreaIds[item.id] ?? item.areaId),
    );
    if (!position || !zone) return;
    event.preventDefault();
    const next = { x: position.x + movement.x, y: position.y + movement.y };
    const geometry = draftGeometry[item.id] ?? geometryFor(item);
    if (!tablePlacementAllowed(item.id, next, geometry, zone)) return;
    setSelectedEditorTarget({ kind: "table", id: item.id });
    setDraftPositions((current) => ({ ...current, [item.id]: next }));
  }

  async function saveLayout() {
    if (!onSavePositions) return;
    setSaving(true);
    const saved = await onSavePositions(
      items.flatMap((item) => {
        if (draftUnpositioned.has(item.id)) return [];
        const position = draftPositions[item.id];
        const geometry = draftGeometry[item.id] ?? geometryFor(item);
        return position
          ? [
              {
                tableId: item.id,
                roomId: draftAreaIds[item.id] ?? item.areaId,
                ...position,
                ...geometry,
              },
            ]
          : [];
      }),
      visibleZones.map((zone) => ({ roomId: zone.id, points: zone.points })),
      draftElements,
      items.map((item) => ({
        tableId: item.id,
        ...(draftTableDetails[item.id] ?? {
          label: item.label,
          seats: item.seats,
          roomId: item.areaId,
        }),
        roomId: draftAreaIds[item.id] ?? draftTableDetails[item.id]?.roomId ?? item.areaId,
      })),
    );
    setSaving(false);
    if (saved !== false) {
      setEditing(false);
      setSelectedEditorTarget(null);
      onEditingChange?.(false);
    }
  }

  function moveFromMinimap(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.type === "pointermove" && event.buttons !== 1) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: minimapBounds.x + ((event.clientX - rect.left) / rect.width) * minimapBounds.width,
      y: minimapBounds.y + ((event.clientY - rect.top) / rect.height) * minimapBounds.height,
    };
    if (event.type === "pointerdown") event.currentTarget.setPointerCapture(event.pointerId);
    setViewport((current) => {
      const size = viewportDimensions(current.zoom, surfaceAspect);
      return clampViewport(
        { ...current, x: point.x - size.width / 2, y: point.y - size.height / 2 },
        surfaceAspect,
      );
    });
  }

  const minimapPadding = 80;
  const minimapBounds = contentPoints.length
    ? {
        x: Math.min(...contentPoints.map((point) => point.x)) - minimapPadding,
        y: Math.min(...contentPoints.map((point) => point.y)) - minimapPadding,
        width:
          Math.max(...contentPoints.map((point) => point.x)) -
          Math.min(...contentPoints.map((point) => point.x)) +
          minimapPadding * 2,
        height:
          Math.max(...contentPoints.map((point) => point.y)) -
          Math.min(...contentPoints.map((point) => point.y)) +
          minimapPadding * 2,
      }
    : { x: 0, y: 0, width: PLAN_WIDTH, height: PLAN_HEIGHT };
  const groups = [
    ...new Set(visibleItems.flatMap((item) => (item.groupId ? [item.groupId] : []))),
  ].map((groupId) => {
    const members = visibleItems.filter((item) => item.groupId === groupId);
    const anchor = members.find((item) => item.id === item.operationId) ?? members[0];
    const center = members.reduce(
      (sum, member) => ({
        x: sum.x + (positions[member.id]?.x ?? 0) / members.length,
        y: sum.y + (positions[member.id]?.y ?? 0) / members.length,
      }),
      { x: 0, y: 0 },
    );
    return { id: groupId, members, anchor, center };
  });
  const selectedEditorTable =
    selectedEditorTarget?.kind === "table"
      ? items.find((item) => item.id === selectedEditorTarget.id)
      : undefined;
  const selectedEditorElement =
    selectedEditorTarget?.kind === "element"
      ? draftElements.find((element) => element.id === selectedEditorTarget.id)
      : undefined;

  function addElement(kind: FloorPlanElement["kind"]) {
    const zone = visibleZones[0];
    if (!zone) return;
    const width = kind === "label" ? 180 : 220;
    const height = kind === "label" ? 44 : 18;
    const tableRectangles = visibleItems.flatMap((item) => {
      const position = draftPositions[item.id] ?? positions[item.id];
      return position ? [{ ...position, ...(draftGeometry[item.id] ?? geometryFor(item)) }] : [];
    });
    const existingBarriers = draftElements.flatMap((element) =>
      element.kind === "barrier" && element.roomId === zone.id
        ? [
            {
              x: element.x,
              y: element.y,
              width: element.width,
              height: element.height,
              rotation: element.rotation,
            },
          ]
        : [],
    );
    const available =
      kind === "label"
        ? { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 }
        : Array.from({ length: 8 }, (_, row) =>
            Array.from({ length: 8 }, (_unused, column) => ({
              x: zone.x + 40 + column * 70,
              y: zone.y + 60 + row * 54,
            })),
          )
            .flat()
            .find((position) =>
              floorPlanPlacementAllowed(
                { ...position, width, height, rotation: 0 },
                zone.points,
                existingBarriers,
                tableRectangles,
              ),
            );
    if (!available) return;
    const element: FloorPlanElement = {
      id: crypto.randomUUID(),
      roomId: zone.id,
      kind,
      label: kind === "label" ? "Novo texto" : undefined,
      x: available.x,
      y: available.y,
      width,
      height,
      rotation: 0,
    };
    setDraftElements((current) => [...current, element]);
    setSelectedEditorTarget({ kind: "element", id: element.id });
  }

  return (
    <div className="floor-plan" ref={wrapperRef}>
      <div className="floor-plan__toolbar">
        <div>
          <span className="floor-plan__title-line">
            <strong>Planta operacional</strong>
            <em>{layoutScope === "shift" ? "Turno atual" : "Espaço permanente"}</em>
          </span>
          <small>
            {editing ? editingDescription : "Arraste para navegar e toque em uma mesa para operar."}
          </small>
        </div>
        <div className="floor-plan__controls">
          {canEdit &&
            !fullscreen &&
            onSavePositions &&
            (editing ? (
              <>
                <Button
                  disabled={saving}
                  onClick={() => {
                    setDraftPositions(layout.positions);
                    setDraftGeometry(
                      Object.fromEntries(items.map((item) => [item.id, geometryFor(item)])),
                    );
                    setDraftElements(elements);
                    setSelectedEditorTarget(null);
                    setDraftAreaIds(
                      Object.fromEntries(items.map((item) => [item.id, item.areaId])),
                    );
                    setDraftZones(layout.zones);
                    setDraftUnpositioned(new Set(layout.unpositionedIds));
                    setEditing(false);
                    onEditingChange?.(false);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  Cancelar
                </Button>
                <Button disabled={saving} onClick={() => void saveLayout()} size="sm">
                  {saving ? "Salvando…" : saveActionLabel}
                </Button>
              </>
            ) : (
              <Button
                onClick={() => {
                  setDraftPositions(layout.positions);
                  setDraftGeometry(
                    Object.fromEntries(items.map((item) => [item.id, geometryFor(item)])),
                  );
                  setDraftElements(elements);
                  setSelectedEditorTarget(null);
                  setDraftAreaIds(Object.fromEntries(items.map((item) => [item.id, item.areaId])));
                  setDraftZones(layout.zones);
                  setDraftUnpositioned(new Set(layout.unpositionedIds));
                  setEditing(true);
                  onEditingChange?.(true);
                }}
                size="sm"
                variant="ghost"
              >
                {editActionLabel}
              </Button>
            ))}
          <details
            className="floor-plan-layers"
            onToggle={(event) => setLayersOpen(event.currentTarget.open)}
            open={layersOpen}
            ref={layersRef}
          >
            <summary>Camadas</summary>
            <fieldset>
              <legend>Elementos visíveis</legend>
              {(
                [
                  ["space", "Espaço físico", "Ambientes, limites e circulação"],
                  ["tables", "Mesas físicas", "Posição e formato das mesas"],
                  ["operation", "Operação do turno", "Praças, estados, grupos e balcão"],
                ] as const
              ).map(([layer, label, description]) => (
                <label key={layer}>
                  <input
                    className="accent-primary"
                    checked={layers[layer]}
                    disabled={editing && layer !== "operation"}
                    onChange={(event) =>
                      setLayers((current) => ({ ...current, [layer]: event.target.checked }))
                    }
                    type="checkbox"
                  />
                  <span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                </label>
              ))}
            </fieldset>
          </details>
          <Button
            aria-label="Diminuir zoom"
            onClick={() => changeZoom(-0.25)}
            size="sm"
            variant="ghost"
          >
            −
          </Button>
          <span aria-live="polite" className="floor-plan__zoom">
            {Math.round(viewport.zoom * 100)}%
          </span>
          <Button
            aria-label="Aumentar zoom"
            onClick={() => changeZoom(0.25)}
            size="sm"
            variant="ghost"
          >
            +
          </Button>
          <Button
            onClick={() => setViewport(fitFloorPlanViewport(contentPoints, surfaceAspect))}
            size="sm"
            variant="ghost"
          >
            Enquadrar casa
          </Button>
          {selectedIds.length > 0 && (
            <Button onClick={fitSelection} size="sm" variant="ghost">
              Enquadrar seleção
            </Button>
          )}
        </div>
      </div>

      {editing && (
        <div className="floor-plan__edit-note" role="status">
          {layoutScope === "shift"
            ? "Movimento temporário ativo: esta organização vale somente até o fim do turno."
            : "Editor permanente ativo: as alterações serão publicadas para os próximos turnos."}{" "}
          A operação das mesas fica bloqueada até salvar ou cancelar.
          {draftUnpositioned.size > 0 &&
            ` ${draftUnpositioned.size} mesa(s) aguardam espaço: amplie a praça e arraste-as para dentro.`}
        </div>
      )}

      {editing && (
        <section className="floor-plan-editor" aria-label="Ferramentas do editor">
          {canEditElements && (
            <div className="floor-plan-editor__create">
              <Button onClick={() => addElement("label")} size="sm" variant="ghost">
                + Texto
              </Button>
              <Button onClick={() => addElement("barrier")} size="sm" variant="ghost">
                + Barreira
              </Button>
            </div>
          )}
          {selectedEditorTable ? (
            <div className="floor-plan-editor__fields">
              <strong>
                {draftTableDetails[selectedEditorTable.id]?.label ?? selectedEditorTable.label}
              </strong>
              {layoutScope === "permanent" && (
                <>
                  <label htmlFor="floor-editor-table-name">
                    Nome
                    <Input
                      aria-label="Nome da mesa"
                      id="floor-editor-table-name"
                      maxLength={60}
                      minLength={1}
                      onChange={(event) =>
                        setDraftTableDetails((current) => ({
                          ...current,
                          [selectedEditorTable.id]: {
                            ...(current[selectedEditorTable.id] ?? {
                              label: selectedEditorTable.label,
                              seats: selectedEditorTable.seats,
                              roomId: selectedEditorTable.areaId,
                            }),
                            label: event.target.value,
                          },
                        }))
                      }
                      value={
                        draftTableDetails[selectedEditorTable.id]?.label ??
                        selectedEditorTable.label
                      }
                    />
                  </label>
                  <label htmlFor="floor-editor-table-seats">
                    Lugares
                    <Input
                      aria-label="Lugares da mesa"
                      id="floor-editor-table-seats"
                      max={100}
                      min={1}
                      onChange={(event) =>
                        setDraftTableDetails((current) => ({
                          ...current,
                          [selectedEditorTable.id]: {
                            ...(current[selectedEditorTable.id] ?? {
                              label: selectedEditorTable.label,
                              seats: selectedEditorTable.seats,
                              roomId: selectedEditorTable.areaId,
                            }),
                            seats: Number(event.target.value),
                          },
                        }))
                      }
                      type="number"
                      value={
                        draftTableDetails[selectedEditorTable.id]?.seats ??
                        selectedEditorTable.seats
                      }
                    />
                  </label>
                  <label htmlFor="floor-editor-table-room">
                    Ambiente
                    <NativeSelect
                      aria-label="Ambiente da mesa"
                      id="floor-editor-table-room"
                      onChange={(event) => {
                        const roomId = event.target.value;
                        setDraftTableDetails((current) => ({
                          ...current,
                          [selectedEditorTable.id]: {
                            ...(current[selectedEditorTable.id] ?? {
                              label: selectedEditorTable.label,
                              seats: selectedEditorTable.seats,
                              roomId: selectedEditorTable.areaId,
                            }),
                            roomId,
                          },
                        }));
                        setDraftAreaIds((current) => ({
                          ...current,
                          [selectedEditorTable.id]: roomId,
                        }));
                        const zone = visibleZones.find((candidate) => candidate.id === roomId);
                        const geometry =
                          draftGeometry[selectedEditorTable.id] ?? geometryFor(selectedEditorTable);
                        if (zone) {
                          let available: { x: number; y: number } | undefined;
                          for (
                            let y = zone.y + geometry.height / 2 + 48;
                            y <= zone.y + zone.height - geometry.height / 2 - 12 && !available;
                            y += geometry.height + 24
                          ) {
                            for (
                              let x = zone.x + geometry.width / 2 + 12;
                              x <= zone.x + zone.width - geometry.width / 2 - 12;
                              x += geometry.width + 22
                            ) {
                              if (
                                tablePlacementAllowed(
                                  selectedEditorTable.id,
                                  { x, y },
                                  geometry,
                                  zone,
                                )
                              ) {
                                available = { x, y };
                                break;
                              }
                            }
                          }
                          if (available) {
                            setDraftPositions((current) => ({
                              ...current,
                              [selectedEditorTable.id]: available,
                            }));
                            setDraftUnpositioned((current) => {
                              const next = new Set(current);
                              next.delete(selectedEditorTable.id);
                              return next;
                            });
                          } else {
                            setDraftUnpositioned((current) =>
                              new Set(current).add(selectedEditorTable.id),
                            );
                          }
                        }
                      }}
                      value={
                        draftAreaIds[selectedEditorTable.id] ??
                        draftTableDetails[selectedEditorTable.id]?.roomId ??
                        selectedEditorTable.areaId
                      }
                    >
                      {visibleZones.map((zone) => (
                        <option key={zone.id} value={zone.id}>
                          {zone.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                </>
              )}
              <label htmlFor="floor-editor-table-shape">
                Formato
                <NativeSelect
                  aria-label="Formato da mesa"
                  id="floor-editor-table-shape"
                  onChange={(event) =>
                    updateGeometry(selectedEditorTable.id, {
                      shape: event.target.value as FloorPlanTableShape,
                    })
                  }
                  value={
                    (draftGeometry[selectedEditorTable.id] ?? geometryFor(selectedEditorTable))
                      .shape
                  }
                >
                  <option value="rectangle">Retangular</option>
                  <option value="square">Quadrada</option>
                  <option value="round">Redonda</option>
                </NativeSelect>
              </label>
              <label htmlFor="floor-editor-table-width">
                Largura
                <Input
                  aria-label="Largura da mesa"
                  id="floor-editor-table-width"
                  max={MAX_TABLE_SIZE}
                  min={MIN_TABLE_SIZE}
                  onChange={(event) =>
                    updateGeometry(selectedEditorTable.id, { width: Number(event.target.value) })
                  }
                  type="number"
                  value={
                    (draftGeometry[selectedEditorTable.id] ?? geometryFor(selectedEditorTable))
                      .width
                  }
                />
              </label>
              <label htmlFor="floor-editor-table-height">
                Altura
                <Input
                  aria-label="Altura da mesa"
                  id="floor-editor-table-height"
                  disabled={
                    (draftGeometry[selectedEditorTable.id] ?? geometryFor(selectedEditorTable))
                      .shape !== "rectangle"
                  }
                  max={MAX_TABLE_SIZE}
                  min={MIN_TABLE_SIZE}
                  onChange={(event) =>
                    updateGeometry(selectedEditorTable.id, { height: Number(event.target.value) })
                  }
                  type="number"
                  value={
                    (draftGeometry[selectedEditorTable.id] ?? geometryFor(selectedEditorTable))
                      .height
                  }
                />
              </label>
              <label htmlFor="floor-editor-table-rotation">
                Rotação
                <Input
                  aria-label="Rotação da mesa"
                  id="floor-editor-table-rotation"
                  max={359}
                  min={-359}
                  onChange={(event) =>
                    updateGeometry(selectedEditorTable.id, { rotation: Number(event.target.value) })
                  }
                  step={5}
                  type="number"
                  value={
                    (draftGeometry[selectedEditorTable.id] ?? geometryFor(selectedEditorTable))
                      .rotation
                  }
                />
              </label>
              {layoutScope === "permanent" && onArchiveTable && (
                <Button
                  onClick={async () => {
                    const label =
                      draftTableDetails[selectedEditorTable.id]?.label ?? selectedEditorTable.label;
                    if (
                      !window.confirm(`Arquivar ${label}? Ela deixarÃ¡ de aparecer na operaÃ§Ã£o.`)
                    ) {
                      return;
                    }
                    const archived = await onArchiveTable(selectedEditorTable.id);
                    if (archived !== false) setSelectedEditorTarget(null);
                  }}
                  size="sm"
                  variant="danger"
                >
                  Arquivar mesa
                </Button>
              )}
            </div>
          ) : selectedEditorElement ? (
            <div className="floor-plan-editor__fields">
              <strong>{selectedEditorElement.kind === "label" ? "Texto" : "Barreira"}</strong>
              {selectedEditorElement.kind === "label" && (
                <label htmlFor="floor-editor-element-label">
                  Conteúdo
                  <Input
                    aria-label="Conteúdo do texto"
                    id="floor-editor-element-label"
                    maxLength={80}
                    onChange={(event) =>
                      updateElement(selectedEditorElement.id, { label: event.target.value })
                    }
                    value={selectedEditorElement.label ?? ""}
                  />
                </label>
              )}
              <label htmlFor="floor-editor-element-width">
                Largura
                <Input
                  aria-label="Largura do elemento"
                  id="floor-editor-element-width"
                  max={600}
                  min={24}
                  onChange={(event) =>
                    updateElement(selectedEditorElement.id, { width: Number(event.target.value) })
                  }
                  type="number"
                  value={selectedEditorElement.width}
                />
              </label>
              <label htmlFor="floor-editor-element-height">
                Altura
                <Input
                  aria-label="Altura do elemento"
                  id="floor-editor-element-height"
                  max={300}
                  min={8}
                  onChange={(event) =>
                    updateElement(selectedEditorElement.id, { height: Number(event.target.value) })
                  }
                  type="number"
                  value={selectedEditorElement.height}
                />
              </label>
              <label htmlFor="floor-editor-element-rotation">
                Rotação
                <Input
                  aria-label="Rotação do elemento"
                  id="floor-editor-element-rotation"
                  max={359}
                  min={-359}
                  onChange={(event) =>
                    updateElement(selectedEditorElement.id, {
                      rotation: Number(event.target.value),
                    })
                  }
                  step={5}
                  type="number"
                  value={selectedEditorElement.rotation}
                />
              </label>
              <Button
                onClick={() => {
                  setDraftElements((current) =>
                    current.filter((element) => element.id !== selectedEditorElement.id),
                  );
                  setSelectedEditorTarget(null);
                }}
                size="sm"
                variant="danger"
              >
                Remover
              </Button>
            </div>
          ) : (
            <small>Selecione uma mesa ou elemento para ajustar tamanho, formato e rotação.</small>
          )}
        </section>
      )}

      <div className="floor-plan__viewport" ref={viewportRef}>
        <svg
          aria-label="Planta interativa do salão"
          className={`floor-plan__svg floor-plan__svg--${density} ${editing ? "floor-plan__svg--editing" : ""}`}
          onPointerCancel={finishPointer}
          onPointerDown={handlePlanPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointer}
          onWheel={handleWheel}
          preserveAspectRatio="xMidYMid meet"
          ref={svgRef}
          viewBox={`${viewport.x} ${viewport.y} ${viewWidth} ${viewHeight}`}
        >
          <title>Planta interativa do salão</title>
          <desc>
            Mesas organizadas por praça. Use os controles de zoom ou arraste o fundo para navegar.
          </desc>
          <defs>
            <pattern height="24" id={gridId} patternUnits="userSpaceOnUse" width="24">
              <path className="floor-plan__grid" d="M 24 0 L 0 0 0 24" />
            </pattern>
          </defs>
          <rect
            className="floor-plan__background"
            fill={`url(#${gridId})`}
            height={MAX_COORDINATE * 2}
            width={MAX_COORDINATE * 2}
            x={-MAX_COORDINATE}
            y={-MAX_COORDINATE}
          />

          {layers.space &&
            visibleZones.map((zone) => (
              <g className="floor-plan-zone" key={zone.id}>
                <path
                  d={`${zone.points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")} Z`}
                />
                <text x={zone.x + 22} y={zone.y + 30}>
                  {compactLabel(zone.label, 28)}
                </text>
                {editing &&
                  (!editableZoneIds || editableZoneIds.includes(zone.id)) &&
                  zone.points.map((point, index) => (
                    <circle
                      aria-label={`Mover canto ${index + 1} de ${zone.label}`}
                      aria-valuemax={MAX_COORDINATE}
                      aria-valuemin={-MAX_COORDINATE}
                      aria-valuenow={point.x}
                      aria-valuetext={`x ${point.x}, y ${point.y}`}
                      className="floor-plan-zone__handle"
                      cx={point.x}
                      cy={point.y}
                      key={`${zone.id}:${point.x}:${point.y}`}
                      onKeyDown={(event) => {
                        const moves: Record<string, { x: number; y: number }> = {
                          ArrowLeft: { x: -10, y: 0 },
                          ArrowRight: { x: 10, y: 0 },
                          ArrowUp: { x: 0, y: -10 },
                          ArrowDown: { x: 0, y: 10 },
                        };
                        const move = moves[event.key];
                        if (!move) return;
                        event.preventDefault();
                        updateZonePoint(zone.id, index, (current) => ({
                          x: clamp(current.x + move.x, -MAX_COORDINATE, MAX_COORDINATE),
                          y: clamp(current.y + move.y, -MAX_COORDINATE, MAX_COORDINATE),
                        }));
                      }}
                      onPointerDown={(event) => startZoneDrag(event, zone.id, index)}
                      r={9}
                      role="slider"
                      tabIndex={0}
                    />
                  ))}
              </g>
            ))}

          {layers.space &&
            visibleElements.map((element) => {
              const selected =
                selectedEditorTarget?.kind === "element" && selectedEditorTarget.id === element.id;
              return (
                // biome-ignore lint/a11y/useSemanticElements: SVG groups cannot contain native HTML buttons.
                <g
                  aria-label={
                    element.kind === "label"
                      ? `Texto: ${element.label ?? "sem conteúdo"}`
                      : "Barreira física"
                  }
                  className={`floor-plan-element floor-plan-element--${element.kind} ${selected ? "floor-plan-element--selected" : ""}`}
                  key={element.id}
                  onKeyDown={(event) => {
                    if (!editing) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedEditorTarget({ kind: "element", id: element.id });
                      return;
                    }
                    if (event.key === "Delete" || event.key === "Backspace") {
                      event.preventDefault();
                      setDraftElements((current) =>
                        current.filter((candidate) => candidate.id !== element.id),
                      );
                      setSelectedEditorTarget(null);
                    }
                  }}
                  onPointerDown={(event) => startElementDrag(event, element)}
                  role="button"
                  tabIndex={editing && canEditElements ? 0 : -1}
                  transform={`translate(${element.x} ${element.y}) rotate(${element.rotation})`}
                >
                  <rect
                    height={element.height}
                    rx={element.kind === "label" ? 8 : 3}
                    width={element.width}
                    x={-element.width / 2}
                    y={-element.height / 2}
                  />
                  {element.kind === "label" && (
                    <text dominantBaseline="middle" textAnchor="middle" x={0} y={0}>
                      {compactLabel(element.label ?? "Texto", 36)}
                    </text>
                  )}
                </g>
              );
            })}

          {layers.operation &&
            stations.map((station) => {
              const zone = visibleZones.find((candidate) => candidate.id === station.areaId);
              if (!zone) return null;
              const x = zone.x + zone.width - 112;
              const y = zone.y + 58;
              return (
                // biome-ignore lint/a11y/useSemanticElements: SVG station groups cannot contain native HTML buttons.
                <g
                  aria-disabled={joinMode}
                  aria-label={`${station.label}. ${station.description}${station.valueLabel ? `. ${station.valueLabel}` : ""}`}
                  className={`floor-plan-station ${joinMode ? "floor-plan-station--disabled" : ""}`}
                  key={station.id}
                  onClick={() => !joinMode && onSelectStation?.(station.id)}
                  onKeyDown={(event) => {
                    if (!joinMode && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      onSelectStation?.(station.id);
                    }
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  role="button"
                  tabIndex={joinMode ? -1 : 0}
                  transform={`translate(${x} ${y})`}
                >
                  <rect height={58} rx={14} width={192} x={-96} y={-29} />
                  <text className="floor-plan-station__label" textAnchor="middle" x={0} y={-6}>
                    {compactLabel(station.label, 24)}
                  </text>
                  <text className="floor-plan-station__meta" textAnchor="middle" x={0} y={14}>
                    {compactLabel(station.valueLabel ?? station.description, 30)}
                  </text>
                </g>
              );
            })}

          {layers.operation &&
            groups.map((group) => {
              if (!group.anchor) return null;
              const anchorPosition = positions[group.anchor.id];
              if (!anchorPosition) return null;
              return (
                <g className="floor-plan-group" key={group.id}>
                  {group.members
                    .filter((member) => member.id !== group.anchor?.id)
                    .map((member) => {
                      const position = positions[member.id];
                      return position ? (
                        <line
                          key={member.id}
                          x1={anchorPosition.x}
                          x2={position.x}
                          y1={anchorPosition.y}
                          y2={position.y}
                        />
                      ) : null;
                    })}
                  <g transform={`translate(${group.center.x - 82} ${group.center.y - 63})`}>
                    <rect height={25} rx={12.5} width={164} />
                    <text textAnchor="middle" x={82} y={17}>
                      {compactLabel(
                        group.anchor.groupLabel ?? `${group.members.length} mesas agrupadas`,
                        27,
                      )}
                    </text>
                  </g>
                </g>
              );
            })}

          {layers.tables &&
            visibleItems.map((item) => {
              const position = positions[item.id];
              if (!position) return null;
              const selected = selectedIds.includes(item.operationId);
              const selectionIndex = selectedIds.indexOf(item.operationId) + 1;
              const isAnchor = item.id === item.operationId;
              const seatLabel = `${item.seats} ${item.seats === 1 ? "lugar" : "lugares"}`;
              const ariaLabel = `${item.label}, ${statusLabels[item.status]}, ${seatLabel}${item.responsible ? `, responsável ${item.responsible}` : ""}${item.disabledReason ? `, indisponível: ${item.disabledReason}` : ""}`;
              const geometry = editing
                ? (draftGeometry[item.id] ?? geometryFor(item))
                : geometryFor(item);
              const priority = ["attention", "closing", "needs_cleaning"].includes(item.status);
              const showState = density !== "very-dense" || selected || priority;
              const showMeta = density === "normal" || selected;
              return (
                <Fragment key={item.id}>
                  {/* biome-ignore lint/a11y/useSemanticElements: SVG table groups cannot contain native HTML buttons. */}
                  <g
                    aria-disabled={Boolean(item.disabledReason)}
                    aria-label={ariaLabel}
                    aria-pressed={selected}
                    className={`floor-plan-table floor-plan-table--${item.status} ${selected ? "floor-plan-table--selected" : ""} ${item.dimmed ? "floor-plan-table--dimmed" : ""} ${item.disabledReason ? "floor-plan-table--disabled" : ""} ${editing && editableItemIds && !editableItemIds.includes(item.id) ? "floor-plan-table--editor-locked" : ""} ${draftUnpositioned.has(item.id) ? "floor-plan-table--unpositioned" : ""}`}
                    onClick={() => activate(item)}
                    onKeyDown={(event) => handleTableKey(event, item)}
                    onPointerDown={(event) => startTableDrag(event, item)}
                    role="button"
                    tabIndex={
                      editing && editableItemIds && !editableItemIds.includes(item.id) ? -1 : 0
                    }
                    transform={`translate(${position.x} ${position.y}) rotate(${geometry.rotation})`}
                  >
                    <title>{item.disabledReason ?? ariaLabel}</title>
                    {layers.operation && item.sectionColor && (
                      <rect
                        className="floor-plan-table__section-halo"
                        fill="none"
                        height={geometry.height + 14}
                        rx={geometry.shape === "round" ? (geometry.height + 14) / 2 : 22}
                        stroke={item.sectionColor}
                        width={geometry.width + 14}
                        x={-(geometry.width + 14) / 2}
                        y={-(geometry.height + 14) / 2}
                      />
                    )}
                    <rect
                      className="floor-plan-table__surface"
                      height={geometry.height}
                      rx={geometry.shape === "round" ? geometry.height / 2 : 18}
                      width={geometry.width}
                      x={-geometry.width / 2}
                      y={-geometry.height / 2}
                    />
                    {layers.operation && (
                      <circle
                        className="floor-plan-table__status"
                        cx={-geometry.width / 2 + 15}
                        cy={-geometry.height / 2 + 14}
                        r={5}
                      />
                    )}
                    <text
                      className="floor-plan-table__label"
                      textAnchor="middle"
                      x={0}
                      y={showState ? (showMeta ? -12 : -4) : 5}
                    >
                      {compactLabel(item.label, 18)}
                    </text>
                    {showState && (
                      <text
                        className="floor-plan-table__state"
                        textAnchor="middle"
                        x={0}
                        y={showMeta ? 8 : 16}
                      >
                        {draftUnpositioned.has(item.id)
                          ? "Posicionar"
                          : layers.operation
                            ? statusLabels[item.status]
                            : seatLabel}
                      </text>
                    )}
                    {showMeta && (
                      <text className="floor-plan-table__meta" textAnchor="middle" x={0} y={27}>
                        {compactLabel(
                          layers.operation ? (item.valueLabel ?? seatLabel) : item.areaLabel,
                          22,
                        )}
                      </text>
                    )}
                    {layers.operation && selected && isAnchor && (
                      <g
                        className="floor-plan-table__selection"
                        transform={`translate(${geometry.width / 2 - 10} ${-geometry.height / 2 + 8})`}
                      >
                        <circle r={13} />
                        <text textAnchor="middle" y={4}>
                          {joinMode ? selectionIndex : "✓"}
                        </text>
                      </g>
                    )}
                    {editing &&
                      editorTool === "move" &&
                      (!editableItemIds || editableItemIds.includes(item.id)) &&
                      selectedEditorTarget?.kind === "table" &&
                      selectedEditorTarget.id === item.id && (
                        <circle
                          aria-label={`Redimensionar ${item.label}`}
                          aria-valuemax={MAX_TABLE_SIZE}
                          aria-valuemin={MIN_TABLE_SIZE}
                          aria-valuenow={Math.round(geometry.width)}
                          aria-valuetext={`${Math.round(geometry.width)} por ${Math.round(geometry.height)}`}
                          className="floor-plan-table__resize-handle"
                          cx={geometry.width / 2}
                          cy={geometry.height / 2}
                          onKeyDown={(event) => {
                            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                            event.preventDefault();
                            event.stopPropagation();
                            const delta = event.key === "ArrowRight" ? 8 : -8;
                            updateGeometry(item.id, {
                              width: geometry.width + delta,
                              ...(geometry.shape === "rectangle"
                                ? { height: geometry.height + delta }
                                : {}),
                            });
                          }}
                          onPointerDown={(event) => startResize(event, item)}
                          r={9}
                          role="slider"
                          tabIndex={0}
                        />
                      )}
                  </g>
                </Fragment>
              );
            })}
        </svg>
        <div className={`floor-plan-minimap ${minimapOpen ? "" : "floor-plan-minimap--closed"}`}>
          <Button
            aria-keyshortcuts="+ - 0 Home ArrowLeft ArrowRight ArrowUp ArrowDown"
            aria-label="Navegar planta com teclado"
            onKeyDown={handlePlanKeyDown}
            ref={keyboardRef}
            type="button"
          >
            Teclado
          </Button>
          <Button
            aria-expanded={minimapOpen}
            onClick={() => setMinimapOpen((current) => !current)}
            type="button"
          >
            {minimapOpen ? "Ocultar mapa" : "Minimapa"}
          </Button>
          {minimapOpen && (
            <svg
              aria-label="Minimapa da planta"
              onPointerDown={moveFromMinimap}
              onPointerMove={moveFromMinimap}
              role="img"
              viewBox={`${minimapBounds.x} ${minimapBounds.y} ${minimapBounds.width} ${minimapBounds.height}`}
            >
              {layers.space &&
                visibleZones.map((zone) => (
                  <polygon
                    className="floor-plan-minimap__zone"
                    key={zone.id}
                    points={zone.points.map((point) => `${point.x},${point.y}`).join(" ")}
                  />
                ))}
              {layers.tables &&
                visibleItems.map((item) => {
                  const position = positions[item.id];
                  return position ? (
                    <circle
                      className={`floor-plan-minimap__table floor-plan-minimap__table--${item.status}`}
                      cx={position.x}
                      cy={position.y}
                      key={item.id}
                      r={10}
                    />
                  ) : null;
                })}
              <rect
                className="floor-plan-minimap__viewport"
                height={viewHeight}
                width={viewWidth}
                x={viewport.x}
                y={viewport.y}
              />
            </svg>
          )}
        </div>
      </div>

      <fieldset className="floor-plan__legend">
        <legend className="gm-sr-only">Legenda da planta</legend>
        {(["free", "occupied", "attention", "closing", "reserved"] as const).map((status) => (
          <span key={status}>
            <i className={`floor-plan__legend-dot floor-plan__legend-dot--${status}`} />
            {statusLabels[status]}
          </span>
        ))}
        {joinMode && <strong>{selectedIds.length} selecionada(s) para junção</strong>}
      </fieldset>
    </div>
  );
}
