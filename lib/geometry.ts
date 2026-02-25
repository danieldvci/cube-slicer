/**
 * Cube Slicer Geometry Module
 *
 * Defines the cube vertices, cutting planes, and slicing logic.
 */

import * as THREE from "three";
import { CSG, CSGPolygon } from "./csg";

// ─── Cube Vertices ───────────────────────────────────────────
// Cube from (-1,-1,-1) to (1,1,1)
// Top face (y=1):    A(-1,1,1), B(1,1,1), C(1,1,-1), D(-1,1,-1)
// Bottom face (y=-1): E(-1,-1,1), F(1,-1,1), G(1,-1,-1), H(-1,-1,-1)

export const CUBE_VERTICES: Record<string, THREE.Vector3> = {
  A: new THREE.Vector3(-1, 1, 1),
  B: new THREE.Vector3(1, 1, 1),
  C: new THREE.Vector3(1, 1, -1),
  D: new THREE.Vector3(-1, 1, -1),
  E: new THREE.Vector3(-1, -1, 1),
  F: new THREE.Vector3(1, -1, 1),
  G: new THREE.Vector3(1, -1, -1),
  H: new THREE.Vector3(-1, -1, -1),
};

// ─── Cutting Planes ──────────────────────────────────────────
// Each plane passes through 4 edges of the cube.
// Plane equation: normal · p = w (all w=0, passing through origin)

export interface CuttingPlane {
  id: number;
  label: string;
  desc: string;
  normal: THREE.Vector3;
  w: number;
}

export const CUTTING_PLANES: CuttingPlane[] = [
  { id: 0, label: "AB–GH", desc: "y = z",  normal: new THREE.Vector3(0, 1, -1),  w: 0 },
  { id: 1, label: "AE–CG", desc: "x = -z", normal: new THREE.Vector3(1, 0, 1),   w: 0 },
  { id: 2, label: "EF–CD", desc: "y = -z", normal: new THREE.Vector3(0, 1, 1),   w: 0 },
  { id: 3, label: "BF–DH", desc: "x = z",  normal: new THREE.Vector3(1, 0, -1),  w: 0 },
  { id: 4, label: "AD–FG", desc: "x = -y", normal: new THREE.Vector3(1, 1, 0),   w: 0 },
  { id: 5, label: "BC–EH", desc: "x = y",  normal: new THREE.Vector3(1, -1, 0),  w: 0 },
];

// ─── Piece Result ────────────────────────────────────────────

export interface SlicedPiece {
  geometry: THREE.BufferGeometry;
  centroid: THREE.Vector3;
  polygons: CSGPolygon[];
}

// ─── Piece Metrics ──────────────────────────────────────────

export interface PieceMetrics {
  vertexCount: number;
  edgeCount: number;
  faceCount: number;
  edgeLengths: number[];
  faceAreas: number[];
  surfaceArea: number;
  volume: number;
  boundingBox: { x: number; y: number; z: number };
}

function roundN(v: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
}

function vecKey(v: THREE.Vector3): string {
  return `${roundN(v.x, 4)},${roundN(v.y, 4)},${roundN(v.z, 4)}`;
}

export function computePieceMetrics(polygons: CSGPolygon[]): PieceMetrics {
  // Unique vertices
  const vertMap = new Map<string, THREE.Vector3>();
  for (const poly of polygons) {
    for (const v of poly.vertices) {
      const k = vecKey(v.pos);
      if (!vertMap.has(k)) vertMap.set(k, v.pos.clone());
    }
  }

  // Unique edges
  const edgeSet = new Set<string>();
  for (const poly of polygons) {
    const verts = poly.vertices;
    for (let i = 0; i < verts.length; i++) {
      const j = (i + 1) % verts.length;
      const ka = vecKey(verts[i].pos);
      const kb = vecKey(verts[j].pos);
      const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      edgeSet.add(ek);
    }
  }

  // Edge lengths
  const edgeLengths: number[] = [];
  for (const ek of Array.from(edgeSet)) {
    const [ka, kb] = ek.split("|");
    const a = vertMap.get(ka)!;
    const b = vertMap.get(kb)!;
    edgeLengths.push(roundN(a.distanceTo(b), 4));
  }
  edgeLengths.sort((a, b) => a - b);

  // True faces: cluster co-planar polygons
  const PLANE_TOL = 0.01;
  const faceClusters: CSGPolygon[][] = [];

  for (const poly of polygons) {
    const n = poly.plane.normal.clone().normalize();
    const d = poly.plane.w;
    let found = false;
    for (const cluster of faceClusters) {
      const cn = cluster[0].plane.normal.clone().normalize();
      const cd = cluster[0].plane.w;
      if (
        Math.abs(n.dot(cn) - 1) < PLANE_TOL &&
        Math.abs(d - cd) < PLANE_TOL
      ) {
        cluster.push(poly);
        found = true;
        break;
      }
    }
    if (!found) faceClusters.push([poly]);
  }

  // Face areas
  function polyArea(poly: CSGPolygon): number {
    let area = 0;
    const verts = poly.vertices;
    for (let i = 2; i < verts.length; i++) {
      const ab = new THREE.Vector3().subVectors(verts[i - 1].pos, verts[0].pos);
      const ac = new THREE.Vector3().subVectors(verts[i].pos, verts[0].pos);
      area += 0.5 * new THREE.Vector3().crossVectors(ab, ac).length();
    }
    return area;
  }

  const faceAreas = faceClusters.map((cluster) => {
    let area = 0;
    for (const poly of cluster) area += polyArea(poly);
    return roundN(area, 4);
  });
  faceAreas.sort((a, b) => a - b);

  const surfaceArea = roundN(faceAreas.reduce((s, a) => s + a, 0), 4);

  // Volume via divergence theorem
  let volume = 0;
  for (const poly of polygons) {
    const verts = poly.vertices;
    for (let i = 2; i < verts.length; i++) {
      const v0 = verts[0].pos;
      const v1 = verts[i - 1].pos;
      const v2 = verts[i].pos;
      volume += v0.dot(new THREE.Vector3().crossVectors(v1, v2));
    }
  }
  volume = roundN(Math.abs(volume) / 6, 4);

  // Bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of Array.from(vertMap.values())) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
    if (v.z > maxZ) maxZ = v.z;
  }

  return {
    vertexCount: vertMap.size,
    edgeCount: edgeSet.size,
    faceCount: faceClusters.length,
    edgeLengths,
    faceAreas,
    surfaceArea,
    volume,
    boundingBox: {
      x: roundN(maxX - minX, 4),
      y: roundN(maxY - minY, 4),
      z: roundN(maxZ - minZ, 4),
    },
  };
}

// ─── Congruence Groups ──────────────────────────────────────

export function computeCongruenceGroups(pieces: SlicedPiece[]): number[] {
  const signatures: string[] = [];

  for (const piece of pieces) {
    // Unique vertices
    const vertMap = new Map<string, THREE.Vector3>();
    for (const poly of piece.polygons) {
      for (const v of poly.vertices) {
        const k = vecKey(v.pos);
        if (!vertMap.has(k)) vertMap.set(k, v.pos.clone());
      }
    }
    const pts = Array.from(vertMap.values());

    // All pairwise distances, sorted
    const dists: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        dists.push(roundN(pts[i].distanceTo(pts[j]), 3));
      }
    }
    dists.sort((a, b) => a - b);
    signatures.push(dists.join(","));
  }

  // Assign group IDs
  const sigToGroup = new Map<string, number>();
  const groupIds: number[] = [];
  let nextGroup = 0;

  for (const sig of signatures) {
    if (!sigToGroup.has(sig)) {
      sigToGroup.set(sig, nextGroup++);
    }
    groupIds.push(sigToGroup.get(sig)!);
  }

  return groupIds;
}

// ─── Slicing Function ────────────────────────────────────────

function createCubeCSG(): CSG {
  const geom = new THREE.BoxGeometry(2, 2, 2);
  geom.computeVertexNormals();
  const csg = CSG.fromGeometry(geom);
  geom.dispose();
  return csg;
}

/**
 * Non-destructively slice a cube using the given active planes.
 * Rebuilds from scratch each time (pure function).
 */
export function sliceCube(activePlaneIds: number[]): SlicedPiece[] {
  if (activePlaneIds.length === 0) {
    const geom = new THREE.BoxGeometry(2, 2, 2);
    geom.computeVertexNormals();
    return [{ geometry: geom, centroid: new THREE.Vector3(0, 0, 0), polygons: [] }];
  }

  let pieces: CSG[] = [createCubeCSG()];

  for (const planeId of activePlaneIds) {
    const plane = CUTTING_PLANES[planeId];
    const newPieces: CSG[] = [];

    for (const piece of pieces) {
      if (piece.polygons.length === 0) continue;

      const { front, back } = CSG.splitByPlane(piece, plane.normal, plane.w);
      if (front.polygons.length > 0) newPieces.push(front);
      if (back.polygons.length > 0) newPieces.push(back);
    }

    pieces = newPieces;
  }

  return pieces
    .filter((p) => p.polygons.length > 0)
    .map((p) => {
      const geom = p.toGeometry();
      const pos = geom.attributes.position;
      const centroid = new THREE.Vector3();

      for (let i = 0; i < pos.count; i++) {
        centroid.add(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
      }
      centroid.divideScalar(pos.count || 1);

      return { geometry: geom, centroid, polygons: p.polygons };
    });
}

// ─── Piece Colors ────────────────────────────────────────────
// Distinct, high-contrast palette for up to 64 pieces

export const PIECE_COLORS: string[] = [
  "#E63946", "#457B9D", "#2A9D8F", "#E9C46A", "#F4A261",
  "#264653", "#A8DADC", "#1D3557", "#F77F00", "#FCBF49",
  "#D62828", "#003049", "#606C38", "#283618", "#FEFAE0",
  "#DDA15E", "#BC6C25", "#8338EC", "#3A86FF", "#FF006E",
  "#FB5607", "#FFBE0B", "#8AC926", "#6A4C93", "#1982C4",
  "#B5179E", "#7209B7", "#560BAD", "#480CA8", "#3F37C9",
  "#4361EE", "#4895EF", "#4CC9F0", "#EF476F", "#FFD166",
  "#06D6A0", "#118AB2", "#073B4C", "#9B5DE5", "#F15BB5",
  "#FEE440", "#00BBF9", "#00F5D4", "#FF595E", "#FFCA3A",
  "#CDB4DB", "#FFC8DD", "#FFAFCC", "#BDE0FE", "#A2D2FF",
  "#D8E2DC", "#FFE5D9", "#FFCAD4", "#F4ACB7", "#9D8189",
  "#B8B8FF", "#9381FF", "#FFD6FF", "#E7C6FF", "#C8B6FF",
  "#BB3E03", "#AE2012", "#9B2226", "#CA6702", "#EE9B00",
];
