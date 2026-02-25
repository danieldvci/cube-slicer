"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Canvas, useFrame, useThree, ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Environment, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import {
  CUBE_VERTICES,
  CUTTING_PLANES,
  PIECE_COLORS,
  sliceCube,
  computePieceMetrics,
  computeCongruenceGroups,
  type SlicedPiece,
  type CuttingPlane,
  type PieceMetrics,
} from "@/lib/geometry";
import type { CSGPolygon } from "@/lib/csg";

// ─── Types ───────────────────────────────────────────────────

interface PieceMeshData {
  geometry: THREE.BufferGeometry;
  centroid: THREE.Vector3;
  color: string;
  index: number;
  polygons: CSGPolygon[];
  groupId: number;
}

// ─── Vertex Label (pure canvas sprite, no font files) ────────

function VertexLabel({ name, position }: { name: string; position: THREE.Vector3 }) {
  const labelPos = position.clone().multiplyScalar(1.3);

  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;

    ctx.beginPath();
    ctx.arc(64, 64, 48, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(10, 10, 15, 0.85)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 56px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name, 64, 68);

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, [name]);

  return (
    <sprite position={labelPos} scale={[0.45, 0.45, 0.45]}>
      <spriteMaterial map={texture} transparent depthTest={false} />
    </sprite>
  );
}
// ─── Piece Mesh ──────────────────────────────────────────────

function PieceMesh({
  data,
  isSelected,
  isTakingOut,
  anySelected,
  explosion,
  showWireframe,
  showPieceNumbers,
  globalOpacity,
  onClick,
  onPointerOver,
  onPointerOut,
}: {
  data: PieceMeshData;
  isSelected: boolean;
  isTakingOut: boolean;
  anySelected: boolean;
  explosion: number;
  showWireframe: boolean;
  showPieceNumbers: boolean;
  globalOpacity: number;
  onClick: () => void;
  onPointerOver: () => void;
  onPointerOut: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const edgeRef = useRef<THREE.LineSegments>(null);
  const spriteRef = useRef<THREE.Sprite>(null);
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);
  const targetPos = useRef(new THREE.Vector3());
  const targetScale = useRef(1);
  const targetOpacity = useRef(1);

  // Label offset: centroid direction pushed outward
  const labelOffset = useMemo(() => {
    const dir = data.centroid.clone();
    const len = dir.length();
    if (len > 0.001) dir.normalize();
    return data.centroid.clone().add(dir.multiplyScalar(0.15));
  }, [data.centroid]);

  // Piece number texture
  const numberTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.beginPath();
    ctx.arc(64, 64, 48, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(10, 10, 15, 0.75)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 56px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(data.index + 1), 64, 68);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, [data.index]);

  useFrame(() => {
    if (!meshRef.current) return;

    const dir = data.centroid.clone();
    const len = dir.length();
    if (len > 0.001) dir.normalize();

    // Default exploded position
    let pos = dir.clone().multiplyScalar(explosion * 2);
    let scale = 1;
    let opacity = 1;

    if (isTakingOut && anySelected && !isSelected) {
      opacity = 0;
      scale = 0.3;
    }

    // Smooth lerp
    targetPos.current.lerp(pos, 0.1);
    targetScale.current += (scale - targetScale.current) * 0.1;
    targetOpacity.current += (opacity - targetOpacity.current) * 0.1;

    meshRef.current.position.copy(targetPos.current);
    const s = targetScale.current;
    meshRef.current.scale.set(s, s, s);

    const mat = meshRef.current.material as THREE.MeshStandardMaterial;
    const finalOpacity = targetOpacity.current * globalOpacity;
    mat.opacity = finalOpacity;
    mat.transparent = finalOpacity < 0.99;
    mat.wireframe = showWireframe;

    if (isSelected) {
      mat.emissive.setHex(0xffffff);
      mat.emissiveIntensity = 0.12;
    } else {
      mat.emissive.setHex(0x000000);
      mat.emissiveIntensity = 0;
    }

    meshRef.current.visible = finalOpacity > 0.02;

    // Update edge visibility
    if (edgeRef.current) {
      edgeRef.current.visible = meshRef.current.visible && !showWireframe;
    }

    // Update sprite label position and visibility
    if (spriteRef.current) {
      spriteRef.current.position.copy(targetPos.current).add(labelOffset);
      spriteRef.current.visible = showPieceNumbers && finalOpacity > 0.02;
      (spriteRef.current.material as THREE.SpriteMaterial).opacity = finalOpacity;
    }
  });

  const edgesGeom = useMemo(() => {
    return new THREE.EdgesGeometry(data.geometry, 15);
  }, [data.geometry]);

  return (
    <group>
      <mesh
        ref={meshRef}
        geometry={data.geometry}
        onPointerDown={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          pointerDownPos.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          if (pointerDownPos.current) {
            const dx = e.clientX - pointerDownPos.current.x;
            const dy = e.clientY - pointerDownPos.current.y;
            if (dx * dx + dy * dy < 25) {
              onClick();
            }
            pointerDownPos.current = null;
          }
        }}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          onPointerOver();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          onPointerOut();
          document.body.style.cursor = "default";
        }}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color={data.color}
          metalness={0.12}
          roughness={0.5}
          side={THREE.DoubleSide}
        />
        <lineSegments ref={edgeRef} geometry={edgesGeom}>
          <lineBasicMaterial color="#000000" opacity={0.15} transparent />
        </lineSegments>
      </mesh>
      <sprite ref={spriteRef} position={labelOffset} scale={[0.35, 0.35, 0.35]}>
        <spriteMaterial map={numberTexture} transparent depthTest={false} />
      </sprite>
    </group>
  );
}

// ─── Cutting Plane Visualization ─────────────────────────────

function CutPlaneViz({
  plane,
  active,
  opacity,
}: {
  plane: CuttingPlane;
  active: boolean;
  opacity: number;
}) {
  if (!active) return null;

  const normal = plane.normal.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    normal
  );

  return (
    <mesh quaternion={quaternion}>
      <planeGeometry args={[3.5, 3.5]} />
      <meshBasicMaterial
        color="#2A9D8F"
        transparent
        opacity={opacity * 0.06}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

// ─── Deselect Sphere (click-without-drag on void) ───────────

function DeselectSphere({ onDeselect }: { onDeselect: () => void }) {
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);

  return (
    <mesh
      visible={false}
      position={[0, 0, 0]}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        pointerDownPos.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e: ThreeEvent<PointerEvent>) => {
        if (pointerDownPos.current) {
          const dx = e.clientX - pointerDownPos.current.x;
          const dy = e.clientY - pointerDownPos.current.y;
          if (dx * dx + dy * dy < 25) {
            onDeselect();
          }
          pointerDownPos.current = null;
        }
      }}
    >
      <sphereGeometry args={[20, 8, 8]} />
      <meshBasicMaterial side={THREE.BackSide} />
    </mesh>
  );
}

// ─── Scene ───────────────────────────────────────────────────

function Scene({
  pieces,
  selectedPieces,
  takeOutMode,
  explosion,
  showWireframe,
  showPlanes,
  showPieceNumbers,
  activePlanes,
  globalOpacity,
  onTogglePiece,
  onDeselectAll,
  onHoverPiece,
}: {
  pieces: PieceMeshData[];
  selectedPieces: number[];
  takeOutMode: boolean;
  explosion: number;
  showWireframe: boolean;
  showPlanes: boolean;
  showPieceNumbers: boolean;
  activePlanes: number[];
  globalOpacity: number;
  onTogglePiece: (index: number) => void;
  onDeselectAll: () => void;
  onHoverPiece: (index: number | null) => void;
}) {
  return (
    <>
      <PerspectiveCamera makeDefault position={[4, 3, 5]} fov={45} />
      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        minDistance={3}
        maxDistance={15}
        enablePan={false}
      />

      {/* Lighting */}
      <ambientLight intensity={0.45} />
      <directionalLight
        position={[5, 8, 5]}
        intensity={1.3}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={50}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={5}
        shadow-camera-bottom={-5}
      />
      <directionalLight position={[-3, 2, -5]} intensity={0.35} color="#6688ff" />
      <directionalLight position={[0, -3, 3]} intensity={0.2} color="#ff4488" />

      {/* Environment for PBR reflections */}
      <Environment preset="city" />

      {/* Grid */}
      <gridHelper
        args={[10, 20, "#222244", "#151530"]}
        position={[0, -2.2, 0]}
      />

      {/* Vertex labels */}
      {Object.entries(CUBE_VERTICES).map(([name, pos]) => (
        <VertexLabel key={name} name={name} position={pos} />
      ))}

      {/* Cutting plane visualizations */}
      {showPlanes &&
        CUTTING_PLANES.map((plane) => (
          <CutPlaneViz
            key={plane.id}
            plane={plane}
            active={activePlanes.includes(plane.id)}
            opacity={1}
          />
        ))}

      {/* Pieces */}
      {pieces.map((piece) => (
        <PieceMesh
          key={piece.index}
          data={piece}
          isSelected={selectedPieces.includes(piece.index)}
          isTakingOut={takeOutMode && selectedPieces.length > 0}
          anySelected={selectedPieces.length > 0}
          explosion={explosion}
          showWireframe={showWireframe}
          showPieceNumbers={showPieceNumbers}
          globalOpacity={globalOpacity}
          onClick={() => onTogglePiece(piece.index)}
          onPointerOver={() => onHoverPiece(piece.index)}
          onPointerOut={() => onHoverPiece(null)}
        />
      ))}

      {/* Click on void to deselect */}
      <DeselectSphere onDeselect={onDeselectAll} />
    </>
  );
}

// ─── Control Panel Components ────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[12px] tracking-[0.15em] uppercase opacity-70 font-semibold mb-2.5 text-[#2A9D8F]">
      {children}
    </div>
  );
}

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full text-left text-[12px] tracking-[0.15em] uppercase opacity-70 font-semibold mb-2.5 text-[#2A9D8F] hover:opacity-100 transition-opacity"
      >
        <span
          className="inline-block transition-transform duration-200 text-[10px]"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          ▶
        </span>
        {title}
      </button>
      {open && children}
    </section>
  );
}

function PlaneButton({
  plane,
  active,
  onClick,
}: {
  plane: CuttingPlane;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-between w-full px-3 py-2 rounded-md text-xs font-mono transition-all duration-200 border ${
        active
          ? "bg-gradient-to-r from-[#2A9D8F]/20 to-[#457B9D]/15 text-[#2A9D8F] border-[#2A9D8F]/30"
          : "bg-white/[0.02] text-white/40 border-transparent hover:bg-white/[0.05] hover:text-white/60"
      }`}
    >
      <span className="font-semibold">{plane.label}</span>
      <span className="text-[11px] opacity-70">{plane.desc}</span>
      <span
        className={`w-2 h-2 rounded-full transition-all duration-300 ${
          active
            ? "bg-[#2A9D8F] shadow-[0_0_8px_rgba(42,157,143,0.5)]"
            : "bg-white/10"
        }`}
      />
    </button>
  );
}

function MetricBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1 px-2 py-1.5 rounded bg-white/[0.04] text-center">
      <div className="text-[10px] uppercase tracking-wider opacity-40 mb-0.5">
        {label}
      </div>
      <div className="text-[12px] text-white/80 font-medium tabular-nums">
        {typeof value === "number" && !Number.isInteger(value)
          ? value.toFixed(4)
          : value}
      </div>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────

export default function CubeSlicerApp() {
  const [activePlanes, setActivePlanes] = useState<number[]>([]);
  const [explosion, setExplosion] = useState(0);
  const [selectedPieces, setSelectedPieces] = useState<number[]>([]);
  const [hoveredPiece, setHoveredPiece] = useState<number | null>(null);
  const [takeOutMode, setTakeOutMode] = useState(false);
  const [showWireframe, setShowWireframe] = useState(false);
  const [showPlanes, setShowPlanes] = useState(false);
  const [showPieceNumbers, setShowPieceNumbers] = useState(true);
  const [globalOpacity, setGlobalOpacity] = useState(1);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Compute pieces (pure, memoized)
  const slicedPieces: PieceMeshData[] = useMemo(() => {
    const raw = sliceCube(activePlanes);
    const groupIds = computeCongruenceGroups(raw);
    return raw.map((piece, i) => ({
      geometry: piece.geometry,
      centroid: piece.centroid,
      color: PIECE_COLORS[i % PIECE_COLORS.length],
      index: i,
      polygons: piece.polygons,
      groupId: groupIds[i],
    }));
  }, [activePlanes]);

  // Piece inspector metrics (only when 1 piece selected)
  const inspectedMetrics: PieceMetrics | null = useMemo(() => {
    if (selectedPieces.length !== 1) return null;
    const piece = slicedPieces[selectedPieces[0]];
    if (!piece || piece.polygons.length === 0) return null;
    return computePieceMetrics(piece.polygons);
  }, [selectedPieces, slicedPieces]);

  // Group info: groupId -> { indices, label }
  const groupInfo = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const p of slicedPieces) {
      const arr = map.get(p.groupId) || [];
      arr.push(p.index);
      map.set(p.groupId, arr);
    }
    const labels = new Map<number, string>();
    let labelIdx = 0;
    // Sort group IDs so labels are stable
    const sortedIds = Array.from(map.keys()).sort((a, b) => a - b);
    for (const gid of sortedIds) {
      labels.set(gid, String.fromCharCode(65 + labelIdx));
      labelIdx++;
    }
    return { map, labels };
  }, [slicedPieces]);

  const toggleGroupSelection = useCallback(
    (groupId: number) => {
      const indices = groupInfo.map.get(groupId) || [];
      const allSelected = indices.every((i) => selectedPieces.includes(i));
      if (allSelected) {
        setSelectedPieces((prev) => prev.filter((i) => !indices.includes(i)));
      } else {
        setSelectedPieces((prev) => Array.from(new Set([...prev, ...indices])));
      }
    },
    [groupInfo, selectedPieces]
  );

  const togglePlane = useCallback((id: number) => {
    setActivePlanes((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
    setSelectedPieces([]);
    setTakeOutMode(false);
  }, []);

  const toggleAllPlanes = useCallback(() => {
    setActivePlanes((prev) =>
      prev.length === 6 ? [] : [0, 1, 2, 3, 4, 5]
    );
    setSelectedPieces([]);
    setTakeOutMode(false);
  }, []);

  const togglePieceSelection = useCallback((idx: number) => {
    setSelectedPieces((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
    );
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedPieces([]);
    setTakeOutMode(false);
  }, []);

  return (
    <div className="w-screen h-screen flex flex-col bg-[#0a0a15] text-[#e0e0e8] font-mono overflow-hidden">
      {/* ─── Header ─── */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06] bg-[#0a0a15]/95 backdrop-blur-xl z-20 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-[#E63946] to-[#457B9D] rounded-md flex items-center justify-center text-sm font-bold rotate-[15deg] shadow-lg shadow-[#E63946]/20">
            ⬡
          </div>
          <div>
            <div className="text-sm font-bold tracking-wider text-white">
              CUBE SLICER
            </div>
            <div className="text-[9px] opacity-30 tracking-[0.18em] uppercase">
              Geometric Subdivision Engine
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 text-[11px]">
          <span className="bg-[#2A9D8F]/15 text-[#2A9D8F] px-2.5 py-1 rounded-full text-[11px] font-semibold tabular-nums">
            {slicedPieces.length} piece{slicedPieces.length !== 1 ? "s" : ""}
          </span>
          <span className="opacity-40 tabular-nums">
            {activePlanes.length}/6 cuts
          </span>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden px-2 py-1 rounded bg-white/5 text-white/50 hover:text-white/80 transition-colors"
          >
            {sidebarOpen ? "✕" : "☰"}
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ─── Sidebar ─── */}
        <aside
          className={`${
            sidebarOpen ? "w-72 min-w-[288px]" : "w-0 min-w-0 overflow-hidden"
          } border-r border-white/[0.06] bg-[#0a0a15]/95 backdrop-blur-xl flex flex-col z-10 transition-all duration-300`}
        >
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {/* Cube Vertex Reference */}
            <CollapsibleSection title="Vertex Reference" defaultOpen={false}>
              <div className="flex justify-center">
                <svg
                  viewBox="0 0 160 130"
                  className="w-full max-w-[200px]"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  {/* Back face edges */}
                  <line x1="60" y1="15" x2="140" y2="15" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
                  <line x1="140" y1="15" x2="140" y2="75" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
                  <line x1="60" y1="15" x2="60" y2="75" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
                  <line x1="60" y1="75" x2="140" y2="75" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
                  {/* Connecting edges (back to front) */}
                  <line x1="60" y1="15" x2="20" y2="45" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
                  <line x1="140" y1="15" x2="100" y2="45" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
                  <line x1="60" y1="75" x2="20" y2="105" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
                  <line x1="140" y1="75" x2="100" y2="105" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
                  {/* Front face edges */}
                  <line x1="20" y1="45" x2="100" y2="45" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
                  <line x1="100" y1="45" x2="100" y2="105" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
                  <line x1="20" y1="45" x2="20" y2="105" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
                  <line x1="20" y1="105" x2="100" y2="105" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
                  {/* Top face ABCD (y=1): A front-left, B front-right, C back-right, D back-left */}
                  <text x="15" y="42" fill="#2A9D8F" fontSize="13" fontFamily="monospace" fontWeight="bold" textAnchor="middle">A</text>
                  <text x="105" y="42" fill="#2A9D8F" fontSize="13" fontFamily="monospace" fontWeight="bold" textAnchor="middle">B</text>
                  <text x="145" y="13" fill="rgba(42,157,143,0.6)" fontSize="12" fontFamily="monospace" fontWeight="bold" textAnchor="middle">C</text>
                  <text x="55" y="13" fill="rgba(42,157,143,0.6)" fontSize="12" fontFamily="monospace" fontWeight="bold" textAnchor="middle">D</text>
                  {/* Bottom face EFGH (y=-1): E front-left, F front-right, G back-right, H back-left */}
                  <text x="15" y="120" fill="#E63946" fontSize="13" fontFamily="monospace" fontWeight="bold" textAnchor="middle">E</text>
                  <text x="105" y="120" fill="#E63946" fontSize="13" fontFamily="monospace" fontWeight="bold" textAnchor="middle">F</text>
                  <text x="145" y="80" fill="rgba(230,57,70,0.7)" fontSize="12" fontFamily="monospace" fontWeight="bold" textAnchor="middle">G</text>
                  <text x="55" y="80" fill="rgba(230,57,70,0.7)" fontSize="12" fontFamily="monospace" fontWeight="bold" textAnchor="middle">H</text>
                </svg>
              </div>
              <div className="flex justify-center gap-4 mt-1.5 text-[10px] opacity-50">
                <span className="text-[#2A9D8F]">ABCD top</span>
                <span className="text-[#E63946]">EFGH bottom</span>
              </div>
            </CollapsibleSection>

            {/* Cutting Planes */}
            <CollapsibleSection title="Cutting Planes">
              <div className="space-y-1">
                {CUTTING_PLANES.map((plane) => (
                  <PlaneButton
                    key={plane.id}
                    plane={plane}
                    active={activePlanes.includes(plane.id)}
                    onClick={() => togglePlane(plane.id)}
                  />
                ))}
              </div>
              <button
                onClick={toggleAllPlanes}
                className="mt-2 w-full py-2 rounded-md border border-white/10 bg-white/[0.02] text-white/50 text-[11px] hover:bg-white/[0.05] hover:text-white/70 transition-all"
              >
                {activePlanes.length === 6 ? "Reset All" : "Cut All 6"}
              </button>
            </CollapsibleSection>

            {/* Explosion */}
            <CollapsibleSection title="Explosion">
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={explosion * 100}
                  onChange={(e) => setExplosion(Number(e.target.value) / 100)}
                  className="flex-1"
                />
                <span className="text-[13px] opacity-70 font-medium tabular-nums w-10 text-right">
                  {Math.round(explosion * 100)}%
                </span>
              </div>
            </CollapsibleSection>

            {/* Transparency */}
            <CollapsibleSection title="Transparency">
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="5"
                  max="100"
                  value={globalOpacity * 100}
                  onChange={(e) => setGlobalOpacity(Number(e.target.value) / 100)}
                  className="flex-1"
                />
                <span className="text-[13px] opacity-70 font-medium tabular-nums w-10 text-right">
                  {Math.round(globalOpacity * 100)}%
                </span>
              </div>
            </CollapsibleSection>

            {/* Piece List */}
            {slicedPieces.length > 1 && (
              <section>
                <SectionHeader>
                  Pieces ({slicedPieces.length})
                </SectionHeader>
                <div className="flex gap-1.5 mb-2">
                  <button
                    onClick={() => setSelectedPieces(slicedPieces.map((p) => p.index))}
                    className="flex-1 py-1.5 rounded-md text-[10px] font-mono bg-white/[0.04] text-white/40 hover:bg-white/[0.07] hover:text-white/60 transition-all"
                  >
                    Select All
                  </button>
                  <button
                    onClick={deselectAll}
                    className={`flex-1 py-1.5 rounded-md text-[10px] font-mono transition-all ${
                      selectedPieces.length > 0
                        ? "bg-white/[0.06] text-white/50 hover:bg-white/[0.09]"
                        : "bg-white/[0.02] text-white/20"
                    }`}
                    disabled={selectedPieces.length === 0}
                  >
                    Deselect All
                  </button>
                </div>
                {selectedPieces.length > 0 && (
                  <button
                    onClick={() => setTakeOutMode(!takeOutMode)}
                    className={`w-full mb-2 py-2 rounded-md text-[11px] font-mono transition-all ${
                      takeOutMode
                        ? "bg-[#E63946]/20 text-[#E63946] ring-1 ring-[#E63946]/30"
                        : "bg-white/[0.04] text-white/40 hover:bg-white/[0.07]"
                    }`}
                  >
                    {takeOutMode ? "✓ " : ""}Take Out ({selectedPieces.length})
                  </button>
                )}
                <div className="space-y-0.5 overflow-y-auto pr-1">
                  {slicedPieces.map((piece) => (
                    <button
                      key={piece.index}
                      onClick={() => togglePieceSelection(piece.index)}
                      className={`flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-[11px] transition-all ${
                        selectedPieces.includes(piece.index)
                          ? "bg-white/[0.08] text-white"
                          : piece.index === hoveredPiece
                          ? "bg-white/[0.04] text-white/60"
                          : "text-white/35 hover:text-white/50"
                      }`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: piece.color }}
                      />
                      <span className="flex-1 text-left">
                        Piece {piece.index + 1}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Piece Inspector */}
            {inspectedMetrics && (
              <CollapsibleSection title="Piece Inspector">
                <div className="space-y-3 text-[11px]">
                  {/* Counts row */}
                  <div className="flex gap-2">
                    <MetricBox label="Vertices" value={inspectedMetrics.vertexCount} />
                    <MetricBox label="Edges" value={inspectedMetrics.edgeCount} />
                    <MetricBox label="Faces" value={inspectedMetrics.faceCount} />
                  </div>
                  {/* Surface area & volume */}
                  <div className="flex gap-2">
                    <MetricBox label="Surface Area" value={inspectedMetrics.surfaceArea} />
                    <MetricBox label="Volume" value={inspectedMetrics.volume} />
                  </div>
                  {/* Bounding box */}
                  <div>
                    <div className="text-[10px] uppercase tracking-wider opacity-50 mb-1">
                      Bounding Box
                    </div>
                    <div className="flex gap-2">
                      <MetricBox label="W" value={inspectedMetrics.boundingBox.x} />
                      <MetricBox label="H" value={inspectedMetrics.boundingBox.y} />
                      <MetricBox label="D" value={inspectedMetrics.boundingBox.z} />
                    </div>
                  </div>
                  {/* Edge lengths */}
                  <div>
                    <div className="text-[10px] uppercase tracking-wider opacity-50 mb-1">
                      Edge Lengths ({inspectedMetrics.edgeLengths.length})
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {inspectedMetrics.edgeLengths.map((l, i) => (
                        <span
                          key={i}
                          className="px-1.5 py-0.5 rounded bg-white/[0.05] text-white/60 text-[10px] tabular-nums"
                        >
                          {l.toFixed(4)}
                        </span>
                      ))}
                    </div>
                  </div>
                  {/* Face areas */}
                  <div>
                    <div className="text-[10px] uppercase tracking-wider opacity-50 mb-1">
                      Face Areas ({inspectedMetrics.faceAreas.length})
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {inspectedMetrics.faceAreas.map((a, i) => (
                        <span
                          key={i}
                          className="px-1.5 py-0.5 rounded bg-white/[0.05] text-white/60 text-[10px] tabular-nums"
                        >
                          {a.toFixed(4)}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {/* View Options */}
            <CollapsibleSection title="View">
              <div className="space-y-1">
                <button
                  onClick={() => setShowWireframe(!showWireframe)}
                  className={`w-full text-left px-3 py-2 rounded-md text-[12px] transition-all ${
                    showWireframe
                      ? "bg-white/[0.07] text-white"
                      : "bg-white/[0.02] text-white/35 hover:text-white/50"
                  }`}
                >
                  {showWireframe ? "✓ " : "  "}Wireframe
                </button>
                <button
                  onClick={() => setShowPlanes(!showPlanes)}
                  className={`w-full text-left px-3 py-2 rounded-md text-[12px] transition-all ${
                    showPlanes
                      ? "bg-white/[0.07] text-white"
                      : "bg-white/[0.02] text-white/35 hover:text-white/50"
                  }`}
                >
                  {showPlanes ? "✓ " : "  "}Show Planes
                </button>
                <button
                  onClick={() => setShowPieceNumbers(!showPieceNumbers)}
                  className={`w-full text-left px-3 py-2 rounded-md text-[12px] transition-all ${
                    showPieceNumbers
                      ? "bg-white/[0.07] text-white"
                      : "bg-white/[0.02] text-white/35 hover:text-white/50"
                  }`}
                >
                  {showPieceNumbers ? "✓ " : "  "}Piece Numbers
                </button>
              </div>
            </CollapsibleSection>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-white/[0.04] text-[11px] opacity-40 space-y-1">
            <div>🖱 Drag to orbit</div>
            <div>🔍 Scroll to zoom</div>
            <div>👆 Click piece to select</div>
          </div>
        </aside>

        {/* ─── 3D Viewport ─── */}
        <main className="flex-1 relative">
          <Canvas
            shadows
            gl={{
              antialias: true,
              toneMapping: THREE.ACESFilmicToneMapping,
              toneMappingExposure: 1.1,
            }}
            style={{ background: "#0a0a15" }}
          >
            <Scene
              pieces={slicedPieces}
              selectedPieces={selectedPieces}
              takeOutMode={takeOutMode}
              explosion={explosion}
              showWireframe={showWireframe}
              showPlanes={showPlanes}
              showPieceNumbers={showPieceNumbers}
              activePlanes={activePlanes}
              globalOpacity={globalOpacity}
              onTogglePiece={togglePieceSelection}
              onDeselectAll={deselectAll}
              onHoverPiece={setHoveredPiece}
            />
          </Canvas>

          {/* Viewport overlay: coordinate info */}
          <div className="absolute bottom-4 left-4 text-[10px] opacity-25 tracking-wider pointer-events-none">
            Cube: (−1,−1,−1) → (1,1,1)
          </div>

          {/* Quick cut buttons overlay */}
          <div className="absolute top-4 right-4 flex gap-1">
            {CUTTING_PLANES.map((plane) => (
              <button
                key={plane.id}
                onClick={() => togglePlane(plane.id)}
                title={`${plane.label} (${plane.desc})`}
                className={`w-7 h-7 rounded text-[9px] font-bold flex items-center justify-center transition-all ${
                  activePlanes.includes(plane.id)
                    ? "bg-[#2A9D8F]/30 text-[#2A9D8F] shadow-[0_0_12px_rgba(42,157,143,0.2)]"
                    : "bg-white/[0.04] text-white/20 hover:text-white/40 hover:bg-white/[0.07]"
                }`}
              >
                {plane.id + 1}
              </button>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
