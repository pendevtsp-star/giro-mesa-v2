import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  convexPolygonsOverlap,
  floorPlacementConflicts,
  polygonContainsPolygon,
  rotatedRectangleCorners,
} from "./floor-geometry.js";

describe("floor geometry", () => {
  it("rotates around the rectangle center", () => {
    const corners = rotatedRectangleCorners({ x: 0, y: 0, width: 4, height: 2, rotation: 90 });
    assert.ok(corners.every(({ x }) => x >= -1 - 1e-7 && x <= 1 + 1e-7));
    assert.ok(corners.every(({ y }) => y >= -2 - 1e-7 && y <= 2 + 1e-7));
  });

  it("detects overlap but allows edge touching", () => {
    const base = rotatedRectangleCorners({ x: 5, y: 5, width: 10, height: 10, rotation: 0 });
    const overlap = rotatedRectangleCorners({ x: 14, y: 5, width: 10, height: 10, rotation: 0 });
    const touching = rotatedRectangleCorners({ x: 15, y: 5, width: 10, height: 10, rotation: 0 });
    assert.equal(convexPolygonsOverlap(base, overlap), true);
    assert.equal(convexPolygonsOverlap(base, touching), false);
  });

  it("validates room bounds and barriers", () => {
    const room = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    assert.deepEqual(
      floorPlacementConflicts(
        { x: 20, y: 20, width: 10, height: 10, rotation: 45 },
        room,
        [],
        [{ x: 23, y: 23, width: 4, height: 4, rotation: 0 }],
      ),
      { outsideRoom: false, overlapsObject: false, overlapsBarrier: true },
    );
    assert.equal(
      floorPlacementConflicts({ x: 96, y: 96, width: 10, height: 10, rotation: 0 }, room, [], [])
        .outsideRoom,
      true,
    );
  });

  it("rejects an edge that crosses the cutout of a concave room", () => {
    const uShapedRoom = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 7, y: 10 },
      { x: 7, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 10 },
      { x: 0, y: 10 },
    ];
    const bridgeAcrossCutout = rotatedRectangleCorners({
      x: 5,
      y: 5,
      width: 8,
      height: 2,
      rotation: 0,
    });
    assert.equal(
      bridgeAcrossCutout.every((point) =>
        point.x < 3 || point.x > 7 ? point.y >= 0 && point.y <= 10 : false,
      ),
      true,
    );
    assert.equal(polygonContainsPolygon(uShapedRoom, bridgeAcrossCutout), false);
  });
});
