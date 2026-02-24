"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Canvas, useFrame, useThree, ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Text, Environment, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import {
  CUBE_VERTICES,
  CUTTING_PLANES,
  PIECE_COLORS,
  sliceCube,
  type SlicedPiece,
  type CuttingPlane,
} from "@/lib/geometry";

// ─── Types ───────────────────────────────────────────────────

interface PieceMeshData {
  geometry: THREE.BufferGeometry;
  centroid: THREE.Vector3;
  color: string;
  index: number;
}

// ─── Vertex Label ────────────────────────────────────────────

function VertexLabel({ name, position }: { name: string; position: THREE.Vector3 }) {
  const labelPos = position.clone().multiplyScalar(1.3);

  return (
    <group position={labelPos}>
      <mesh>
        <sphereGeometry args={[0.06, 16, 16]} />
        <meshBasicMaterial color="#ffffff" opacity={0.6} transparent />
      </mesh>
      <Text
        position={[0, 0.18, 0]}
        fontSize={0.22}
        color="#ffffff"
        anchorX="center"
        anchorY="middle"
        font="/fonts/JetBrainsMono-Bold.woff"
        outlineWidth={0.02}
        outlineColor="#000000"
        depthOffset={-1}
      >
        {name}
      </Text>
    </group>
  );
}

// ─── Piece Mesh ──────────────────────────────────────────────

function PieceMesh({
  data,
  isSelected,
  isInspecting,
  isTakingOut,
  otherSelected,
  explosion,
  showWireframe,
  globalOpacity,
  onClick,
  onPointerOver,
  onPointerOut,
}: {
  data: PieceMeshData;
  isSelected: boolean;
  isInspecting: boolean;
  isTakingOut: boolean;
  otherSelected: boolean;
  explosion: number;
  showWireframe: boolean;
  globalOpacity: number;
  onClick: () => void;
  onPointerOver: () => void;
  onPointerOut: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const edgeRef = useRef<THREE.LineSegments>(null);
  const targetPos = useRef(new THREE.Vector3());
  const targetScale = useRef(1);
  const targetOpacity = useRef(1);

  useFrame(() => {
    if (!meshRef.current) return;

    const dir = data.centroid.clone();
    const len = dir.length();
    if (len > 0.001) dir.normalize();

    // Default exploded position
    let pos = dir.clone().multiplyScalar(explosion * 2);
    let scale = 1;
    let opacity = 1;

    if (isInspecting && isSelected) {
      pos = new THREE.Vector3(0, 0, 0);
      scale = 1.3;
      opacity = 1;
    } else if (isInspecting && otherSelected) {
      opacity = 0;
      scale = 0.3;
    } else if (isTakingOut && isSelected) {
      pos = dir.clone().multiplyScalar(explosion * 2 + 4.5);
      scale = 1.5;
      opacity = 1;
    } else if (isTakingOut && otherSelected) {
      opacity = 0.25;
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

    if (isSelected && !isInspecting) {
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
  });

  const edgesGeom = useMemo(() => {
    return new THREE.EdgesGeometry(data.geometry, 15);
  }, [data.geometry]);

  return (
    <group>
      <mesh
        ref={meshRef}
        geometry={data.geometry}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onClick();
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

// ─── Scene ───────────────────────────────────────────────────

function Scene({
  pieces,
  selectedPiece,
  inspectMode,
  takeOutMode,
  explosion,
  showWireframe,
  showPlanes,
  activePlanes,
  globalOpacity,
  onSelectPiece,
  onHoverPiece,
}: {
  pieces: PieceMeshData[];
  selectedPiece: number | null;
  inspectMode: boolean;
  takeOutMode: boolean;
  explosion: number;
  showWireframe: boolean;
  showPlanes: boolean;
  activePlanes: number[];
  globalOpacity: number;
  onSelectPiece: (index: number | null) => void;
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
          isSelected={selectedPiece === piece.index}
          isInspecting={inspectMode && selectedPiece !== null}
          isTakingOut={takeOutMode && selectedPiece !== null}
          otherSelected={selectedPiece !== null && selectedPiece !== piece.index}
          explosion={explosion}
          showWireframe={showWireframe}
          globalOpacity={globalOpacity}
          onClick={() => onSelectPiece(selectedPiece === piece.index ? null : piece.index)}
          onPointerOver={() => onHoverPiece(piece.index)}
          onPointerOut={() => onHoverPiece(null)}
        />
      ))}

      {/* Click on void to deselect */}
      <mesh
        visible={false}
        position={[0, 0, 0]}
        onClick={() => onSelectPiece(null)}
      >
        <sphereGeometry args={[20, 8, 8]} />
        <meshBasicMaterial side={THREE.BackSide} />
      </mesh>
    </>
  );
}

// ─── Control Panel Components ────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] tracking-[0.2em] uppercase opacity-40 font-semibold mb-2.5">
      {children}
    </div>
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
      <span className="text-[10px] opacity-60">{plane.desc}</span>
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

// ─── Main App ────────────────────────────────────────────────

export default function CubeSlicerApp() {
  const [activePlanes, setActivePlanes] = useState<number[]>([]);
  const [explosion, setExplosion] = useState(0);
  const [selectedPiece, setSelectedPiece] = useState<number | null>(null);
  const [hoveredPiece, setHoveredPiece] = useState<number | null>(null);
  const [inspectMode, setInspectMode] = useState(false);
  const [takeOutMode, setTakeOutMode] = useState(false);
  const [showWireframe, setShowWireframe] = useState(false);
  const [showPlanes, setShowPlanes] = useState(true);
  const [globalOpacity, setGlobalOpacity] = useState(1);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Compute pieces (pure, memoized)
  const slicedPieces: PieceMeshData[] = useMemo(() => {
    const raw = sliceCube(activePlanes);
    return raw.map((piece, i) => ({
      geometry: piece.geometry,
      centroid: piece.centroid,
      color: PIECE_COLORS[i % PIECE_COLORS.length],
      index: i,
    }));
  }, [activePlanes]);

  const togglePlane = useCallback((id: number) => {
    setActivePlanes((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
    setSelectedPiece(null);
    setInspectMode(false);
    setTakeOutMode(false);
  }, []);

  const toggleAllPlanes = useCallback(() => {
    setActivePlanes((prev) =>
      prev.length === 6 ? [] : [0, 1, 2, 3, 4, 5]
    );
    setSelectedPiece(null);
    setInspectMode(false);
    setTakeOutMode(false);
  }, []);

  const handleSelectPiece = useCallback((idx: number | null) => {
    setSelectedPiece(idx);
    if (idx === null) {
      setInspectMode(false);
      setTakeOutMode(false);
    }
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
            {/* Cutting Planes */}
            <section>
              <SectionHeader>Cutting Planes</SectionHeader>
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
            </section>

            {/* Explosion */}
            <section>
              <SectionHeader>Explosion</SectionHeader>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={explosion * 100}
                  onChange={(e) => setExplosion(Number(e.target.value) / 100)}
                  className="flex-1"
                />
                <span className="text-[11px] opacity-40 tabular-nums w-8 text-right">
                  {Math.round(explosion * 100)}%
                </span>
              </div>
            </section>

            {/* Transparency */}
            <section>
              <SectionHeader>Transparency</SectionHeader>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="5"
                  max="100"
                  value={globalOpacity * 100}
                  onChange={(e) => setGlobalOpacity(Number(e.target.value) / 100)}
                  className="flex-1"
                />
                <span className="text-[11px] opacity-40 tabular-nums w-8 text-right">
                  {Math.round(globalOpacity * 100)}%
                </span>
              </div>
            </section>

            {/* Inspection */}
            <section>
              <SectionHeader>Inspection</SectionHeader>
              {selectedPiece !== null ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-[#E63946]/10 text-[#E63946] text-xs">
                    <span
                      className="w-3 h-3 rounded-sm shrink-0"
                      style={{
                        backgroundColor:
                          PIECE_COLORS[selectedPiece % PIECE_COLORS.length],
                      }}
                    />
                    Piece #{selectedPiece + 1} selected
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => {
                        setInspectMode(!inspectMode);
                        setTakeOutMode(false);
                      }}
                      className={`flex-1 py-2 rounded-md text-[11px] font-mono transition-all ${
                        inspectMode
                          ? "bg-[#2A9D8F]/20 text-[#2A9D8F] ring-1 ring-[#2A9D8F]/30"
                          : "bg-white/[0.04] text-white/40 hover:bg-white/[0.07]"
                      }`}
                    >
                      {inspectMode ? "✓ " : ""}Inspect
                    </button>
                    <button
                      onClick={() => {
                        setTakeOutMode(!takeOutMode);
                        setInspectMode(false);
                      }}
                      className={`flex-1 py-2 rounded-md text-[11px] font-mono transition-all ${
                        takeOutMode
                          ? "bg-[#E63946]/20 text-[#E63946] ring-1 ring-[#E63946]/30"
                          : "bg-white/[0.04] text-white/40 hover:bg-white/[0.07]"
                      }`}
                    >
                      {takeOutMode ? "✓ " : ""}Take Out
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedPiece(null);
                      setInspectMode(false);
                      setTakeOutMode(false);
                    }}
                    className="w-full py-1.5 rounded-md border border-white/[0.06] text-white/30 text-[10px] hover:text-white/50 transition-all"
                  >
                    Deselect
                  </button>
                </div>
              ) : (
                <p className="text-[11px] opacity-25 px-1">
                  Click a piece to select it
                </p>
              )}
            </section>

            {/* Piece List */}
            {slicedPieces.length > 1 && (
              <section>
                <SectionHeader>
                  Pieces ({slicedPieces.length})
                </SectionHeader>
                <div className="space-y-0.5 max-h-48 overflow-y-auto pr-1">
                  {slicedPieces.map((piece) => (
                    <button
                      key={piece.index}
                      onClick={() =>
                        handleSelectPiece(
                          piece.index === selectedPiece ? null : piece.index
                        )
                      }
                      className={`flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-[11px] transition-all ${
                        piece.index === selectedPiece
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
                      Piece {piece.index + 1}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* View Options */}
            <section>
              <SectionHeader>View</SectionHeader>
              <div className="space-y-1">
                <button
                  onClick={() => setShowWireframe(!showWireframe)}
                  className={`w-full text-left px-3 py-2 rounded-md text-[11px] transition-all ${
                    showWireframe
                      ? "bg-white/[0.07] text-white"
                      : "bg-white/[0.02] text-white/35 hover:text-white/50"
                  }`}
                >
                  {showWireframe ? "✓ " : "  "}Wireframe
                </button>
                <button
                  onClick={() => setShowPlanes(!showPlanes)}
                  className={`w-full text-left px-3 py-2 rounded-md text-[11px] transition-all ${
                    showPlanes
                      ? "bg-white/[0.07] text-white"
                      : "bg-white/[0.02] text-white/35 hover:text-white/50"
                  }`}
                >
                  {showPlanes ? "✓ " : "  "}Show Planes
                </button>
              </div>
            </section>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-white/[0.04] text-[10px] opacity-25 space-y-1">
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
              selectedPiece={selectedPiece}
              inspectMode={inspectMode}
              takeOutMode={takeOutMode}
              explosion={explosion}
              showWireframe={showWireframe}
              showPlanes={showPlanes}
              activePlanes={activePlanes}
              globalOpacity={globalOpacity}
              onSelectPiece={handleSelectPiece}
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
