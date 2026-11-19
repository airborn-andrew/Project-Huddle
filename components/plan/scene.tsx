"use client";

import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Edges, Environment, Lightformer, OrbitControls, useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { levelHeights, type Level } from "@/lib/levels";
import type { Category, Room } from "@/lib/types";

export type LayerState = "pending" | "active" | "done";
export type RoomLook = { active: boolean; layers: Partial<Record<Category, LayerState>> };


/** Walls are cut down like a dollhouse so every room stays in view. */
const CUTAWAY = 0.5;

const partCategory: Record<string, Category> = {
  floor: "Flooring",
  walls: "Paint",
  baseboard: "Baseboard",
  door: "Doors",
  cabinets: "Cabinets",
  appliances: "Appliances",
  fixtures: "Fixtures",
  insulation: "Insulation",
};

type Part = { name: string; level: string; room: string; kind: string; geometry: THREE.BufferGeometry };

/** Scene position of a room's center (plan y is north, the scene's -z). */
export function roomAnchor(room: Room, levelY: Record<string, number>, height = 0): [number, number, number] {
  const y = levelY[room.level] ?? 0;
  if (room.level === "crawlspace") {
    // The crawlspace sits under the house, so its label hangs off the front edge.
    const south = Math.min(...room.polygon.map(([, y]) => y));
    return [room.center[0], y + 1.3 * CUTAWAY + height, -south + 1.5];
  }
  return [room.center[0], y + height, -room.center[1]];
}

/** Scene position for a label that covers the whole house. */
const houseAnchor: [number, number, number] = [0, 0.2, 0];

/**
 * Labels, bubbles and the picked-room marker are plain page elements with ids
 * like "anchor-kitchen". Each frame this moves them to their room's spot on screen.
 */
function Projector({ rooms, levels, root }: { rooms: Room[]; levels: Level[]; root: React.RefObject<THREE.Group | null> }) {
  const { camera, size } = useThree();
  const points = useMemo(
    () => [
      ...rooms.map((r) => ({ id: r.id, at: new THREE.Vector3(...roomAnchor(r, levelHeights(levels), 0.2)) })),
      { id: "house", at: new THREE.Vector3(...houseAnchor) },
    ],
    [rooms, levels],
  );
  const v = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const lift = root.current?.position.y ?? 0;
    for (const p of points) {
      const el = document.getElementById(`anchor-${p.id}`);
      if (!el) continue;
      v.copy(p.at);
      v.y += lift;
      v.project(camera);
      let x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      // Keep a work bubble on screen when its room is near the edge.
      const bubble = el.firstElementChild as HTMLElement | null;
      if (bubble?.classList.contains("bubble")) {
        const half = bubble.offsetWidth / 2 + 12;
        x = Math.min(Math.max(x, half), size.width - half);
      }
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      el.style.visibility = v.z < 1 ? "visible" : "hidden";
    }
  });

  return null;
}

export type SceneProps = {
  model: string;
  levels: Level[];
  rooms: Room[];
  looks: Record<string, RoomLook>;
  selected: string | null;
  /** The level the camera is frozen over, or null for the whole house. */
  focus: string | null;
  onSelect: (room: string | null) => void;
  resetKey: number;
  reducedMotion: boolean;
  onInteract: () => void;
  /** Called with the camera's heading so the compass can turn with the plan. */
  onHeading: (radians: number) => void;
};

export function Scene(props: SceneProps) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ fov: 32, near: 0.5, far: 600, position: [10, 52, 62] }}
      // A neutral tone curve keeps true white and true black; the default film curve dulls both.
      gl={{ antialias: true, alpha: true, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1 }}
      onPointerMissed={() => props.onSelect(null)}
    >
      {/* One strong key light shapes the house; little fill, so the floors stay black. */}
      <ambientLight intensity={0.22} />
      <directionalLight position={[-20, 40, 18]} intensity={1.9} />
      <directionalLight position={[25, 18, -20]} intensity={0.3} />
      <Environment resolution={128}>
        <Lightformer intensity={1.8} position={[0, 12, 0]} rotation-x={Math.PI / 2} scale={[40, 20, 1]} />
        <Lightformer intensity={0.8} position={[-30, 6, 10]} rotation-y={Math.PI / 2} scale={[30, 8, 1]} />
        <Lightformer intensity={0.5} position={[30, 4, -10]} rotation-y={-Math.PI / 2} scale={[30, 6, 1]} />
      </Environment>
      <House {...props} />
      <CameraRig {...props} />
    </Canvas>
  );
}

function House({ model, levels, rooms, looks, selected, focus, onSelect, reducedMotion }: SceneProps) {
  const { scene } = useGLTF(model);
  const root = useRef<THREE.Group>(null);

  const parts = useMemo(() => {
    const list: Part[] = [];
    scene.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      const [level, room, rawPart = ""] = o.name.split("__");
      list.push({
        name: o.name,
        level,
        room,
        kind: rawPart.replace(/_\d+$/, ""),
        geometry: (o as THREE.Mesh).geometry,
      });
    });
    return list;
  }, [scene]);

  const mats = useMemo(() => makeMaterials(), []);
  const levelY = useMemo(() => levelHeights(levels), [levels]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const still = reducedMotion || focus !== null;
    if (root.current) root.current.position.y = still ? 0 : Math.sin(t * 0.55) * 0.15;
  });

  const click = (room: string) => (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    e.stopPropagation();
    onSelect(room === selected ? null : room);
  };

  return (
    <group ref={root}>
      {parts.map((p) => {
        const look = looks[p.room];
        const y = levelY[p.level] ?? 0;
        // With a level in focus, levels above it are hidden and levels below fade
        // to a faint outline of floors and walls.
        const faded = focus !== null && p.level !== focus;
        if (faded && (levelY[p.level] ?? 0) > (levelY[focus] ?? 0)) return null;
        if (faded && !["floor", "walls", "ground", "stem"].includes(p.kind)) return null;
        const dim = selected !== null && p.room !== selected && p.room !== "house" && p.kind === "floor";
        const { material, edges, visible } = faded
          ? { material: mats.ghost, edges: false as const, visible: true }
          : pickMaterial(p, look, mats, p.room === selected, dim);
        if (!visible) return null;
        const clickable = !faded && (p.kind === "floor" || p.kind === "ground" || p.kind === "insulation");
        return (
          <mesh
            key={p.name}
            geometry={p.geometry}
            material={material}
            position-y={y}
            scale-y={CUTAWAY}
            renderOrder={material.transparent ? 2 : 1}
            onClick={clickable ? click(p.kind === "floor" ? p.room : "crawlspace") : undefined}
          >
            {edges && <Edges threshold={25} color="#ffffff" transparent opacity={edges} />}
          </mesh>
        );
      })}
      <Projector rooms={rooms} levels={levels} root={root} />
    </group>
  );
}

function makeMaterials() {
  const glass = (opacity: number) =>
    new THREE.MeshPhysicalMaterial({
      color: "#ffffff",
      transparent: true,
      opacity,
      roughness: 0.18,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  const solid = (color: string, roughness = 0.35, metalness = 0.15, envMapIntensity = 1) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, envMapIntensity });
  return {
    shell: glass(0.3),
    pane: glass(0.1),
    ghost: glass(0.06),
    finish: glass(0.32),
    // Floors take little reflected light, so black reads as black.
    floor: solid("#060607", 0.9, 0, 0.1),
    floorNew: solid("#232326", 0.45, 0.05, 0.35),
    floorSelected: solid("#2a2a2e", 0.3, 0.15),
    floorDim: solid("#030303", 0.4, 0.1),
    // The day's work: white, with no glow.
    activeFloor: solid("#f2f2f4", 0.5, 0),
    // The room the homeowner tapped: every wall glows white, brighter than the day's work.
    selectedWalls: new THREE.MeshStandardMaterial({
      color: "#ffffff",
      emissive: "#ffffff",
      emissiveIntensity: 0.9,
      roughness: 0.4,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    activeLayer: new THREE.MeshStandardMaterial({
      color: "#ffffff",
      roughness: 0.6,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    }),
    doneLayer: solid("#e8e8ea", 0.4, 0),
    ground: solid("#0b0b0c", 0.6, 0),
  };
}

type Mats = ReturnType<typeof makeMaterials>;

function pickMaterial(p: Part, look: RoomLook | undefined, m: Mats, selected: boolean, dim: boolean) {
  const state = look?.layers[partCategory[p.kind]] ?? "pending";
  const out = (material: THREE.Material, edges: number | false = false, visible = true) => ({ material, edges, visible });

  switch (p.kind) {
    case "walls":
      if (p.room === "house") return out(m.shell, 0.65);
      if (selected) return out(m.selectedWalls, 1);
      // A room's wall finish shows once it is painted or while paint is underway.
      if (state === "active") return out(m.activeLayer);
      return out(m.finish, false, state === "done");
    case "stem":
      return out(m.shell, 0.65);
    case "glass":
      return out(m.pane, 0.35);
    case "ground":
      return out(m.ground);
    case "floor":
      if (look?.active) return out(m.activeFloor);
      if (selected) return out(m.floorSelected);
      if (dim) return out(m.floorDim);
      return out(state === "done" ? m.floorNew : m.floor);
    case "baseboard":
      if (state === "active") return out(m.activeLayer);
      return out(m.doneLayer, false, state === "done");
    case "insulation":
      if (state === "active") return out(m.activeLayer, 0.5);
      return state === "done" ? out(m.finish, 0.6) : out(m.ghost, 0.25);
    default:
      // Doors, cabinets, appliances and fixtures: a faint outline until finished.
      if (state === "active") return out(m.activeLayer, 0.8);
      return state === "done" ? out(m.finish, 0.7) : out(m.ghost, 0.22);
  }
}

/** Frames the plan on load and on reset, and flies to a room when one is picked. */
function CameraRig({ levels, rooms, selected, focus, resetKey, reducedMotion, onInteract, onHeading }: SceneProps) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size } = useThree();
  const goal = useRef<{ target: THREE.Vector3; position: THREE.Vector3 } | null>(null);

  const home = useMemo(() => {
    // Portrait screens look at the plan from the east so its long side runs up the screen.
    const portrait = size.width / size.height < 0.9;
    const distance = portrait ? 150 : 78;
    const dir = (portrait ? new THREE.Vector3(0.6, 0.78, 0.1) : new THREE.Vector3(0.12, 0.78, 0.62)).normalize();
    // Aim at the middle of the stacked levels.
    const heights = Object.values(levelHeights(levels));
    const middle = (Math.max(...heights) + Math.min(...heights)) / 2;
    const target = new THREE.Vector3(portrait ? 1 : 0, middle, portrait ? 0 : 0.5);
    return { target, position: target.clone().add(dir.multiplyScalar(distance)) };
  }, [size.width, size.height, levels]);

  useEffect(() => {
    if (focus) return;
    goal.current = { target: home.target.clone(), position: home.position.clone() };
  }, [home, resetKey, focus]);

  // Level focus: straight down over the level, framed to fit the screen.
  useEffect(() => {
    if (!focus) return;
    const onLevel = rooms.filter((r) => r.level === focus).flatMap((r) => r.polygon);
    if (!onLevel.length) return;
    const xs = onLevel.map(([x]) => x);
    const ys = onLevel.map(([, y]) => y);
    const width = Math.max(...xs) - Math.min(...xs);
    const depth = Math.max(...ys) - Math.min(...ys);
    const portrait = size.width / size.height < 0.9;
    const aspect = size.width / size.height;
    const view = 2 * Math.tan(THREE.MathUtils.degToRad(32 / 2));
    // On phones the plan turns so its long side runs up the screen.
    const [across, along] = portrait ? [depth, width] : [width, depth];
    const distance = Math.max(along / view, across / (view * aspect)) * 1.45 + 6;
    const target = new THREE.Vector3((Math.max(...xs) + Math.min(...xs)) / 2, levelHeights(levels)[focus] ?? 0, -(Math.max(...ys) + Math.min(...ys)) / 2);
    // A small sideways offset fixes which way is up on screen: north on wide screens, west on phones.
    const lean = distance * 0.02;
    const offset = portrait ? new THREE.Vector3(lean, distance, 0) : new THREE.Vector3(0, distance, lean);
    goal.current = { target, position: target.clone().add(offset) };
  }, [focus, rooms, levels, size.width, size.height, resetKey]);

  useEffect(() => {
    if (!selected) return;
    const room = rooms.find((r) => r.id === selected);
    if (!room) return;
    const [x, y, z] = roomAnchor(room, levelHeights(levels));
    const center = new THREE.Vector3(x, y, z);
    const portrait = size.width / size.height < 0.9;
    const dir = camera.position.clone().sub(controls.current?.target ?? new THREE.Vector3()).normalize();
    // Keep the current heading, looking down a little more steeply.
    dir.y = Math.max(dir.y, 0.75);
    dir.normalize();
    // Move the aim point so the room clears the detail card: up the screen on
    // phones (card below), left on wider screens (card on the right).
    const toward = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), toward).normalize();
    const target = portrait ? center.clone().add(toward.multiplyScalar(11)) : center.clone().add(right.multiplyScalar(-9));
    goal.current = {
      target,
      position: target.clone().add(dir.multiplyScalar(portrait ? 82 : 68)),
    };
  }, [selected, rooms, levels, camera, size.width, size.height]);

  const heading = useRef(NaN);

  useFrame((_, delta) => {
    const c = controls.current;
    if (!c) return;
    const h = Math.atan2(camera.position.x - c.target.x, camera.position.z - c.target.z);
    if (Number.isNaN(heading.current) || Math.abs(h - heading.current) > 0.005) {
      heading.current = h;
      onHeading(h);
    }
    if (!goal.current) return;
    const k = reducedMotion ? 1 : 1 - Math.exp(-delta * 4.5);
    c.target.lerp(goal.current.target, k);
    camera.position.lerp(goal.current.position, k);
    c.update();
    if (camera.position.distanceTo(goal.current.position) < 0.05) goal.current = null;
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={14}
      maxDistance={230}
      maxPolarAngle={1.3}
      enableRotate={!focus}
      screenSpacePanning={false}
      onStart={() => {
        goal.current = null;
        onInteract();
      }}
    />
  );
}
