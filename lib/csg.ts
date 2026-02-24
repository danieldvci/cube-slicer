/**
 * CSG (Constructive Solid Geometry) Library
 *
 * Implements plane-based splitting of convex/concave meshes into manifold pieces.
 * Uses a BSP-inspired polygon splitting approach with cap generation.
 */

import * as THREE from "three";

const EPSILON = 1e-5;

// Classification constants
const COPLANAR = 0;
const BACK = 1;
const FRONT = 2;
const SPANNING = 3;

// ─── Vertex ──────────────────────────────────────────────────

export class CSGVertex {
  pos: THREE.Vector3;
  normal: THREE.Vector3;

  constructor(pos: THREE.Vector3, normal?: THREE.Vector3) {
    this.pos = pos.clone();
    this.normal = normal ? normal.clone() : new THREE.Vector3();
  }

  clone(): CSGVertex {
    return new CSGVertex(this.pos, this.normal);
  }

  flip(): void {
    this.normal.negate();
  }

  interpolate(other: CSGVertex, t: number): CSGVertex {
    return new CSGVertex(
      this.pos.clone().lerp(other.pos, t),
      this.normal.clone().lerp(other.normal, t).normalize()
    );
  }
}

// ─── Plane ───────────────────────────────────────────────────

export class CSGPlane {
  normal: THREE.Vector3;
  w: number;

  constructor(normal: THREE.Vector3, w: number) {
    this.normal = normal;
    this.w = w;
  }

  static fromPoints(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): CSGPlane {
    const n = new THREE.Vector3()
      .crossVectors(
        new THREE.Vector3().subVectors(b, a),
        new THREE.Vector3().subVectors(c, a)
      )
      .normalize();
    return new CSGPlane(n, n.dot(a));
  }

  clone(): CSGPlane {
    return new CSGPlane(this.normal.clone(), this.w);
  }

  flip(): void {
    this.normal.negate();
    this.w = -this.w;
  }

  classifyVertex(point: THREE.Vector3): number {
    const t = this.normal.dot(point) - this.w;
    if (t < -EPSILON) return BACK;
    if (t > EPSILON) return FRONT;
    return COPLANAR;
  }

  splitPolygon(
    polygon: CSGPolygon,
    coplanarFront: CSGPolygon[],
    coplanarBack: CSGPolygon[],
    front: CSGPolygon[],
    back: CSGPolygon[]
  ): void {
    let polygonType = 0;
    const types: number[] = [];

    for (const v of polygon.vertices) {
      const t = this.classifyVertex(v.pos);
      polygonType |= t;
      types.push(t);
    }

    switch (polygonType) {
      case COPLANAR:
        (this.normal.dot(polygon.plane.normal) > 0 ? coplanarFront : coplanarBack).push(polygon);
        break;
      case FRONT:
        front.push(polygon);
        break;
      case BACK:
        back.push(polygon);
        break;
      case SPANNING: {
        const f: CSGVertex[] = [];
        const b: CSGVertex[] = [];

        for (let i = 0; i < polygon.vertices.length; i++) {
          const j = (i + 1) % polygon.vertices.length;
          const ti = types[i];
          const tj = types[j];
          const vi = polygon.vertices[i];
          const vj = polygon.vertices[j];

          if (ti !== BACK) f.push(vi.clone());
          if (ti !== FRONT) b.push(vi.clone());

          if ((ti | tj) === SPANNING) {
            const edge = new THREE.Vector3().subVectors(vj.pos, vi.pos);
            const denom = this.normal.dot(edge);
            const t = Math.abs(denom) > EPSILON
              ? (this.w - this.normal.dot(vi.pos)) / denom
              : 0.5;
            const clamped = Math.max(0, Math.min(1, t));
            const v = vi.interpolate(vj, clamped);
            f.push(v.clone());
            b.push(v.clone());
          }
        }

        if (f.length >= 3) front.push(new CSGPolygon(f, polygon.shared));
        if (b.length >= 3) back.push(new CSGPolygon(b, polygon.shared));
        break;
      }
    }
  }
}

// ─── Polygon ─────────────────────────────────────────────────

export class CSGPolygon {
  vertices: CSGVertex[];
  shared: unknown;
  plane: CSGPlane;

  constructor(vertices: CSGVertex[], shared?: unknown) {
    this.vertices = vertices;
    this.shared = shared;
    this.plane = CSGPlane.fromPoints(
      vertices[0].pos,
      vertices[1].pos,
      vertices[2].pos
    );
  }

  clone(): CSGPolygon {
    return new CSGPolygon(
      this.vertices.map((v) => v.clone()),
      this.shared
    );
  }

  flip(): void {
    this.vertices.reverse().forEach((v) => v.flip());
    this.plane.flip();
  }
}

// ─── Cap Generation ──────────────────────────────────────────

function buildLoops(edges: [THREE.Vector3, THREE.Vector3][]): THREE.Vector3[][] {
  if (edges.length === 0) return [];

  const remaining = edges.map(([a, b]) => [a.clone(), b.clone()] as [THREE.Vector3, THREE.Vector3]);
  const loops: THREE.Vector3[][] = [];
  const tolerance = 0.01;

  const vecEq = (a: THREE.Vector3, b: THREE.Vector3) => a.distanceTo(b) < tolerance;

  while (remaining.length > 0) {
    const loop: THREE.Vector3[] = [];
    const first = remaining.splice(0, 1)[0];
    loop.push(first[0], first[1]);

    let maxIter = remaining.length + 10;
    while (maxIter-- > 0) {
      const last = loop[loop.length - 1];
      if (vecEq(last, loop[0]) && loop.length > 2) {
        loop.pop();
        break;
      }
      let found = false;
      for (let i = 0; i < remaining.length; i++) {
        const [a, b] = remaining[i];
        if (vecEq(last, a)) {
          loop.push(b);
          remaining.splice(i, 1);
          found = true;
          break;
        } else if (vecEq(last, b)) {
          loop.push(a);
          remaining.splice(i, 1);
          found = true;
          break;
        }
      }
      if (!found) break;
    }
    if (loop.length >= 3) loops.push(loop);
  }

  return loops;
}

function generateCapPolygons(
  polygons: CSGPolygon[],
  plane: CSGPlane,
  side: number
): CSGPolygon[] {
  // Collect edges lying on the cutting plane
  const edgesOnPlane: [THREE.Vector3, THREE.Vector3][] = [];

  for (const poly of polygons) {
    const verts = poly.vertices;
    for (let i = 0; i < verts.length; i++) {
      const j = (i + 1) % verts.length;
      const ci = plane.classifyVertex(verts[i].pos);
      const cj = plane.classifyVertex(verts[j].pos);
      if (ci === COPLANAR && cj === COPLANAR) {
        edgesOnPlane.push([verts[i].pos.clone(), verts[j].pos.clone()]);
      }
    }
  }

  if (edgesOnPlane.length < 3) return [];

  const loops = buildLoops(edgesOnPlane);
  const capPolys: CSGPolygon[] = [];
  const normal = plane.normal.clone().multiplyScalar(side > 0 ? -1 : 1);

  for (const loop of loops) {
    if (loop.length < 3) continue;

    // Fan triangulation from centroid
    const center = new THREE.Vector3();
    for (const p of loop) center.add(p);
    center.divideScalar(loop.length);

    for (let i = 0; i < loop.length; i++) {
      const j = (i + 1) % loop.length;
      const verts = [
        new CSGVertex(center.clone(), normal.clone()),
        new CSGVertex(loop[side > 0 ? j : i].clone(), normal.clone()),
        new CSGVertex(loop[side > 0 ? i : j].clone(), normal.clone()),
      ];
      capPolys.push(new CSGPolygon(verts, null));
    }
  }

  return capPolys;
}

// ─── CSG Solid ───────────────────────────────────────────────

export class CSG {
  polygons: CSGPolygon[];

  constructor() {
    this.polygons = [];
  }

  clone(): CSG {
    const csg = new CSG();
    csg.polygons = this.polygons.map((p) => p.clone());
    return csg;
  }

  static fromPolygons(polygons: CSGPolygon[]): CSG {
    const csg = new CSG();
    csg.polygons = polygons;
    return csg;
  }

  static fromGeometry(geom: THREE.BufferGeometry): CSG {
    const polys: CSGPolygon[] = [];
    const pos = geom.attributes.position;
    const nor = geom.attributes.normal;
    const idx = geom.index;

    if (idx) {
      for (let i = 0; i < idx.count; i += 3) {
        const verts: CSGVertex[] = [];
        for (let j = 0; j < 3; j++) {
          const k = idx.getX(i + j);
          verts.push(
            new CSGVertex(
              new THREE.Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)),
              new THREE.Vector3(nor.getX(k), nor.getY(k), nor.getZ(k))
            )
          );
        }
        polys.push(new CSGPolygon(verts, null));
      }
    } else {
      for (let i = 0; i < pos.count; i += 3) {
        const verts: CSGVertex[] = [];
        for (let j = 0; j < 3; j++) {
          const k = i + j;
          verts.push(
            new CSGVertex(
              new THREE.Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)),
              new THREE.Vector3(nor.getX(k), nor.getY(k), nor.getZ(k))
            )
          );
        }
        polys.push(new CSGPolygon(verts, null));
      }
    }

    return CSG.fromPolygons(polys);
  }

  toGeometry(): THREE.BufferGeometry {
    const vertices: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    let idx = 0;

    for (const p of this.polygons) {
      // Fan triangulation for polygons with >3 vertices
      for (let i = 2; i < p.vertices.length; i++) {
        for (const vi of [0, i - 1, i]) {
          const v = p.vertices[vi];
          vertices.push(v.pos.x, v.pos.y, v.pos.z);
          normals.push(v.normal.x, v.normal.y, v.normal.z);
          indices.push(idx++);
        }
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geom.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    return geom;
  }

  /**
   * Split a CSG solid by a plane, returning front and back halves
   * with properly capped cut faces.
   */
  static splitByPlane(
    csg: CSG,
    planeNormal: THREE.Vector3,
    planeW: number
  ): { front: CSG; back: CSG } {
    const plane = new CSGPlane(planeNormal.clone().normalize(), planeW);
    const frontPolys: CSGPolygon[] = [];
    const backPolys: CSGPolygon[] = [];

    for (const poly of csg.polygons) {
      const cf: CSGPolygon[] = [];
      const cb: CSGPolygon[] = [];
      const f: CSGPolygon[] = [];
      const b: CSGPolygon[] = [];
      plane.splitPolygon(poly, cf, cb, f, b);
      frontPolys.push(...cf, ...f);
      backPolys.push(...cb, ...b);
    }

    // Generate cap polygons for manifold closure
    const capFront = generateCapPolygons(frontPolys, plane, 1);
    const capBack = generateCapPolygons(backPolys, plane, -1);

    frontPolys.push(...capFront);
    backPolys.push(...capBack);

    return {
      front: CSG.fromPolygons(frontPolys),
      back: CSG.fromPolygons(backPolys),
    };
  }
}
