export type FloorPoint = { x: number; y: number };

export type FloorRectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

function dot(point: FloorPoint, axis: FloorPoint) {
  return point.x * axis.x + point.y * axis.y;
}

export function rotatedRectangleCorners(rectangle: FloorRectangle): FloorPoint[] {
  const radians = (rectangle.rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const centerX = rectangle.x;
  const centerY = rectangle.y;
  const halfWidth = rectangle.width / 2;
  const halfHeight = rectangle.height / 2;
  return [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ].map((point) => ({
    x: centerX + point.x * cosine - point.y * sine,
    y: centerY + point.x * sine + point.y * cosine,
  }));
}

export function pointInPolygon(point: FloorPoint, polygon: readonly FloorPoint[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const current = polygon[index];
    const prior = polygon[previous];
    if (!current || !prior) continue;
    const onEdge =
      Math.abs(
        (point.y - prior.y) * (current.x - prior.x) - (point.x - prior.x) * (current.y - prior.y),
      ) < 1e-7 &&
      point.x >= Math.min(prior.x, current.x) - 1e-7 &&
      point.x <= Math.max(prior.x, current.x) + 1e-7 &&
      point.y >= Math.min(prior.y, current.y) - 1e-7 &&
      point.y <= Math.max(prior.y, current.y) + 1e-7;
    if (onEdge) return true;
    if (
      current.y > point.y !== prior.y > point.y &&
      point.x < ((prior.x - current.x) * (point.y - current.y)) / (prior.y - current.y) + current.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function polygonContainsPolygon(
  boundary: readonly FloorPoint[],
  candidate: readonly FloorPoint[],
) {
  if (!candidate.every((point) => pointInPolygon(point, boundary))) return false;
  const orientation = (a: FloorPoint, b: FloorPoint, c: FloorPoint) =>
    Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  for (let candidateIndex = 0; candidateIndex < candidate.length; candidateIndex += 1) {
    const candidateStart = candidate[candidateIndex];
    const candidateEnd = candidate[(candidateIndex + 1) % candidate.length];
    if (!candidateStart || !candidateEnd) continue;
    for (let boundaryIndex = 0; boundaryIndex < boundary.length; boundaryIndex += 1) {
      const boundaryStart = boundary[boundaryIndex];
      const boundaryEnd = boundary[(boundaryIndex + 1) % boundary.length];
      if (!boundaryStart || !boundaryEnd) continue;
      const first = orientation(candidateStart, candidateEnd, boundaryStart);
      const second = orientation(candidateStart, candidateEnd, boundaryEnd);
      const third = orientation(boundaryStart, boundaryEnd, candidateStart);
      const fourth = orientation(boundaryStart, boundaryEnd, candidateEnd);
      if (first * second < 0 && third * fourth < 0) return false;
    }
  }
  return true;
}

export function convexPolygonsOverlap(left: readonly FloorPoint[], right: readonly FloorPoint[]) {
  for (const polygon of [left, right]) {
    for (let index = 0; index < polygon.length; index += 1) {
      const start = polygon[index];
      const end = polygon[(index + 1) % polygon.length];
      if (!start || !end) continue;
      const axis = { x: -(end.y - start.y), y: end.x - start.x };
      const leftProjection = left.map((point) => dot(point, axis));
      const rightProjection = right.map((point) => dot(point, axis));
      const leftMin = Math.min(...leftProjection);
      const leftMax = Math.max(...leftProjection);
      const rightMin = Math.min(...rightProjection);
      const rightMax = Math.max(...rightProjection);
      if (leftMax <= rightMin + 1e-7 || rightMax <= leftMin + 1e-7) return false;
    }
  }
  return true;
}

export function floorPlacementConflicts(
  placement: FloorRectangle,
  roomBoundary: readonly FloorPoint[],
  occupied: readonly FloorRectangle[],
  barriers: readonly FloorRectangle[],
) {
  const corners = rotatedRectangleCorners(placement);
  return {
    outsideRoom: !polygonContainsPolygon(roomBoundary, corners),
    overlapsObject: occupied.some((item) =>
      convexPolygonsOverlap(corners, rotatedRectangleCorners(item)),
    ),
    overlapsBarrier: barriers.some((item) =>
      convexPolygonsOverlap(corners, rotatedRectangleCorners(item)),
    ),
  };
}
