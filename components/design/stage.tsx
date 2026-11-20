"use client";

import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Edges, Environment, Html, Lightformer, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { RotateCw } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { catalogItem, type CatalogItem } from "@/lib/design/catalog";
import type { Piece, Shell } from "@/lib/design/layout";
import { wallsOf } from "@/lib/design/snap";

/**
 * The Design Room's 3D view. The scene works in feet: room inches (x east,
 * y north) become scene x = x / 12 and z = -y / 12. Plan looks straight down
 * with no perspective; 3D orbits the room with the walls nearest the camera
 * faded so the cabinets stay in view.
 */

export type ViewMode = "plan" | "3d";

export type StageApi = {
  /** The point on the floor under a screen position, in room inches, or null off the floor. */
  toFloor: (clientX: number, clientY: number) => [number, number] | null;
  canvas: () => HTMLCanvasElement;
};

type Props = {
  shell: Shell;
  pieces: Piece[];
  selected: string | null;
  /** The piece being dragged, if it does not fit where it is. */
  blocked: string | null;
  mode: ViewMode;
  /** Bottom of the screen the dock covers, in pixels, so the room is framed above it. */
  dockHeight: number;
  editable: boolean;
  onReady: (api: StageApi) => void;
  onPieceDown: (id: string, event: PointerEvent) => void;
  onSelect: (id: string | null) => void;
  onRotate: (id: string) => void;
};

const FT = 1 / 12;
const WALL = 4.5;

export function Stage(props: Props) {
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true, toneMapping: THREE.NeutralToneMapping }}
      onPointerMissed={() => props.onSelect(null)}
    >
      <ambientLight intensity={0.35} />
      <directionalLight position={[-6, 14, 8]} intensity={1.6} />
      <directionalLight position={[8, 6, -6]} intensity={0.35} />
      <Environment resolution={128}>
        <Lightformer intensity={1.6} position={[0, 10, 0]} rotation-x={Math.PI / 2} scale={[20, 20, 1]} />
        <Lightformer intensity={0.6} position={[-12, 4, 4]} rotation-y={Math.PI / 2} scale={[20, 6, 1]} />
      </Environment>
      <Room {...props} />
    </Canvas>
  );
}

function Room({ shell, pieces, selected, blocked, mode, dockHeight, editable, onReady, onPieceDown, onSelect, onRotate }: Props) {
  const { camera, gl, size } = useThree();
  const bounds = useMemo(() => {
    const xs = shell.walls.map(([x]) => x);
    const ys = shell.walls.map(([, y]) => y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }, [shell]);
  const center = useMemo(
    () => new THREE.Vector3(((bounds.minX + bounds.maxX) / 2) * FT, 0, (-(bounds.minY + bounds.maxY) / 2) * FT),
    [bounds],
  );
  const controls = useRef<OrbitControlsImpl>(null);

  // Floor picking for drags, which follow the pointer outside the canvas's own events.
  useEffect(() => {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ray = new THREE.Raycaster();
    const hit = new THREE.Vector3();
    onReady({
      toFloor(clientX, clientY) {
        const rect = gl.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        return ray.ray.intersectPlane(plane, hit) ? [hit.x / FT, -hit.z / FT] : null;
      },
      canvas: () => gl.domElement,
    });
  }, [camera, gl, onReady]);

  // Frame the room above the dock.
  const roomW = (bounds.maxX - bounds.minX) * FT;
  const roomD = (bounds.maxY - bounds.minY) * FT;
  const usable = Math.max(200, size.height - dockHeight - 110);
  const zoom = Math.min(size.width / (roomW + 3), usable / (roomD + 3));
  // Shift the view so the room sits in the space above the dock.
  const lift = ((dockHeight - 40) / 2 / zoom) * 1;

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    if (mode === "plan") {
      c.target.set(center.x, 0, center.z + lift);
      camera.position.set(center.x, 40, center.z + lift);
      camera.up.set(0, 0, -1);
    } else {
      camera.up.set(0, 1, 0);
      const reach = Math.max(roomW, roomD) * 1.35 + 6;
      c.target.set(center.x, 2, center.z);
      camera.position.set(center.x + reach * 0.35, reach * 0.85, center.z + reach * 0.9);
    }
    camera.lookAt(c.target);
    c.update();
  }, [mode, center, camera, lift, roomW, roomD]);

  // A press on a piece moves the piece, not the camera. This runs before the
  // camera controls see the press, so they never start panning.
  const piecesGroup = useRef<THREE.Group>(null);
  useEffect(() => {
    if (!editable) return;
    const ray = new THREE.Raycaster();
    const hold = (e: PointerEvent) => {
      const c = controls.current;
      const group = piecesGroup.current;
      if (!c || !group) return;
      const onHandle = e.target instanceof Element && e.target.closest(".rotate-handle");
      if (!onHandle && e.target !== gl.domElement) return;
      const rect = gl.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
      if (!onHandle && !ray.intersectObject(group, true).length) return;
      c.enabled = false;
      const release = () => {
        c.enabled = true;
        window.removeEventListener("pointerup", release);
        window.removeEventListener("pointercancel", release);
      };
      window.addEventListener("pointerup", release);
      window.addEventListener("pointercancel", release);
    };
    window.addEventListener("pointerdown", hold, { capture: true });
    return () => window.removeEventListener("pointerdown", hold, { capture: true });
  }, [camera, gl, editable]);

  const down = (id: string) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    onSelect(id);
    if (editable) onPieceDown(id, e.nativeEvent);
  };

  const chosen = pieces.find((p) => p.id === selected);

  return (
    <>
      {mode === "plan" ? (
        <OrthographicCamera makeDefault zoom={zoom} near={0.1} far={200} position={[center.x, 40, center.z]} />
      ) : (
        <PerspectiveCamera makeDefault fov={40} near={0.1} far={400} />
      )}
      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={0.1}
        enableRotate={mode === "3d"}
        maxPolarAngle={1.45}
        minDistance={4}
        maxDistance={60}
        minZoom={zoom * 0.6}
        maxZoom={zoom * 4}
        screenSpacePanning
        mouseButtons={mode === "plan" ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN } : undefined}
        touches={mode === "plan" ? { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN } : undefined}
      />

      <Floor shell={shell} />
      <Grid bounds={bounds} />
      <Walls shell={shell} mode={mode} center={center} />

      <group ref={piecesGroup}>
        {pieces.map((p) => {
          const item = catalogItem(p.item);
          if (!item) return null;
          return (
            <PieceModel
              key={p.id}
              piece={p}
              item={item}
              mode={mode}
              selected={p.id === selected}
              blocked={p.id === blocked}
              onPointerDown={down(p.id)}
            />
          );
        })}
      </group>

      {chosen && editable && (
        <RotateHandle piece={chosen} onRotate={() => onRotate(chosen.id)} />
      )}
    </>
  );
}

function Floor({ shell }: { shell: Shell }) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape(shell.walls.map(([x, y]) => new THREE.Vector2(x * FT, y * FT)));
    const g = new THREE.ShapeGeometry(shape);
    // The shape is drawn on x and y; lay it on the floor with plan north toward -z.
    g.rotateX(-Math.PI / 2);
    return g;
  }, [shell]);
  return (
    <mesh geometry={geometry} position-y={-0.01} receiveShadow>
      <meshStandardMaterial color="#1a1b1d" roughness={0.85} />
    </mesh>
  );
}

/** A faint one-foot grid over the room. */
function Grid({ bounds }: { bounds: { minX: number; maxX: number; minY: number; maxY: number } }) {
  const geometry = useMemo(() => {
    const pts: number[] = [];
    for (let x = Math.ceil(bounds.minX / 12) * 12; x <= bounds.maxX; x += 12) pts.push(x * FT, 0, -bounds.minY * FT, x * FT, 0, -bounds.maxY * FT);
    for (let y = Math.ceil(bounds.minY / 12) * 12; y <= bounds.maxY; y += 12) pts.push(bounds.minX * FT, 0, -y * FT, bounds.maxX * FT, 0, -y * FT);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [bounds]);
  return (
    <lineSegments geometry={geometry} position-y={0.001}>
      <lineBasicMaterial color="#ffffff" transparent opacity={0.07} />
    </lineSegments>
  );
}

type Slab = { key: string; x: number; z: number; length: number; y0: number; y1: number; angle: number; outward: THREE.Vector3; window?: boolean };

/** Each wall as solid slabs around its doors and windows, standing just outside the room's outline. */
function wallSlabs(shell: Shell): Slab[] {
  const slabs: Slab[] = [];
  wallsOf(shell).forEach((wall, i) => {
    const [ax, ay] = wall.from;
    const [bx, by] = wall.to;
    const len = Math.hypot(bx - ax, by - ay);
    const dir = [(bx - ax) / len, (by - ay) / len];
    const at = (t: number) => [ax + dir[0] * t, ay + dir[1] * t];
    const along = (p: [number, number]) => (p[0] - ax) * dir[0] + (p[1] - ay) * dir[1];
    const onWall = shell.openings
      .map((o) => ({ ...o, t0: Math.min(along(o.from), along(o.to)), t1: Math.max(along(o.from), along(o.to)) }))
      .filter((o) => {
        const off = (p: [number, number]) => Math.abs((p[0] - ax) * wall.normal[0] + (p[1] - ay) * wall.normal[1]);
        return off(o.from) < 1 && off(o.to) < 1 && o.t1 > 0 && o.t0 < len;
      })
      .sort((a, b) => a.t0 - b.t0);
    const outward = new THREE.Vector3(-wall.normal[0], 0, wall.normal[1]);
    const add = (t0: number, t1: number, y0: number, y1: number, window = false) => {
      if (t1 - t0 < 0.5 || y1 - y0 < 0.5) return;
      const [mx, my] = at((t0 + t1) / 2);
      slabs.push({
        key: `${i}-${t0}-${y0}`,
        x: (mx - (wall.normal[0] * WALL) / 2) * FT,
        z: -(my - (wall.normal[1] * WALL) / 2) * FT,
        length: (t1 - t0) * FT,
        y0: y0 * FT,
        y1: y1 * FT,
        angle: Math.atan2(dir[1], dir[0]),
        outward,
        window,
      });
    };
    let t = 0;
    for (const o of onWall) {
      add(t, o.t0, 0, shell.height);
      add(o.t0, o.t1, o.top, shell.height);
      if (o.kind === "window") {
        add(o.t0, o.t1, 0, o.bottom);
        add(o.t0, o.t1, o.bottom, o.top, true);
      }
      t = o.t1;
    }
    add(t, len, 0, shell.height);
  });
  return slabs;
}

function Walls({ shell, mode, center }: { shell: Shell; mode: ViewMode; center: THREE.Vector3 }) {
  // From above, a door reads as a gap: only the parts of each wall that stand on the floor show, plus window glass.
  const all = useMemo(() => wallSlabs(shell), [shell]);
  const slabs = useMemo(() => (mode === "plan" ? all.filter((s) => s.y0 === 0 || s.window) : all), [all, mode]);
  const mats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const toCamera = useMemo(() => new THREE.Vector3(), []);

  // In 3D, walls between the camera and the room fade so the room stays in view.
  useFrame(({ camera }) => {
    slabs.forEach((s, i) => {
      const m = mats.current[i];
      if (!m) return;
      toCamera.set(camera.position.x - center.x, 0, camera.position.z - center.z);
      const facing = mode === "3d" && toCamera.dot(s.outward) > 0;
      const goal = s.window ? 0.18 : facing ? 0.12 : 0.92;
      m.opacity += (goal - m.opacity) * 0.2;
      m.depthWrite = m.opacity > 0.5;
    });
  });

  return (
    <>
      {slabs.map((s, i) => (
        <mesh key={s.key} position={[s.x, (s.y0 + s.y1) / 2, s.z]} rotation-y={s.angle}>
          <boxGeometry args={[s.length, s.y1 - s.y0, WALL * FT]} />
          <meshStandardMaterial
            ref={(m) => {
              mats.current[i] = m;
            }}
            color={s.window ? "#ffffff" : "#d9dadc"}
            roughness={s.window ? 0.1 : 0.7}
            transparent
            opacity={0.92}
          />
        </mesh>
      ))}
    </>
  );
}

function PieceModel({
  piece,
  item,
  mode,
  selected,
  blocked,
  onPointerDown,
}: {
  piece: Piece;
  item: CatalogItem;
  mode: ViewMode;
  selected: boolean;
  blocked: boolean;
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
}) {
  const w = item.width * FT;
  const d = item.depth * FT;
  const h = item.height * FT;
  // Wall cabinets read as outlines from above, so the floor pieces under them stay visible.
  const overhead = mode === "plan" && item.layer === "wall";
  const edge = blocked ? "#ff453a" : "#ffffff";
  return (
    <group position={[piece.x * FT, item.elevation * FT, -piece.y * FT]} rotation-y={(piece.rotation * Math.PI) / 180}>
      <mesh position-y={h / 2} onPointerDown={onPointerDown}>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial
          color={selected ? "#5a5c61" : "#3a3b3f"}
          roughness={0.55}
          metalness={0.05}
          transparent={overhead}
          opacity={overhead ? 0.35 : 1}
          depthWrite={!overhead}
        />
        <Edges threshold={20} color={edge} transparent opacity={selected || blocked ? 1 : 0.55} />
      </mesh>
      {item.counter && mode === "3d" && (
        <mesh position={[0, h + 0.75 * FT, 0.5 * FT]}>
          <boxGeometry args={[w, 1.5 * FT, d + 1 * FT]} />
          <meshStandardMaterial color="#c8c9cc" roughness={0.35} />
        </mesh>
      )}
      {mode === "plan" && <PlanMarks item={item} top={h + 0.05 * FT} color={edge} faint={overhead} />}
    </group>
  );
}

/**
 * What a piece shows from above: its front edge, so which way it faces reads
 * at a glance, plus burners on a range and a basin in a sink base.
 */
function PlanMarks({ item, top, color, faint }: { item: CatalogItem; top: number; color: string; faint: boolean }) {
  const w = item.width * FT;
  const d = item.depth * FT;
  const opacity = faint ? 0.4 : 0.85;
  return (
    <group position-y={top}>
      <mesh position-z={d / 2 - 0.75 * FT}>
        <boxGeometry args={[w - 2 * FT, 0.05 * FT, 1.5 * FT]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} />
      </mesh>
      {item.kind === "range" &&
        [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ].map(([sx, sz]) => (
          <mesh key={`${sx}${sz}`} position={[sx * w * 0.24, 0, sz * d * 0.22]} rotation-x={-Math.PI / 2}>
            <ringGeometry args={[2.6 * FT, 3.2 * FT, 32]} />
            <meshBasicMaterial color={color} transparent opacity={opacity} />
          </mesh>
        ))}
      {item.kind === "sink" && (
        <mesh position-z={0.5 * FT} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[Math.min(w, d) * 0.3, Math.min(w, d) * 0.3 + 0.6 * FT, 4, 1, Math.PI / 4]} />
          <meshBasicMaterial color={color} transparent opacity={opacity} />
        </mesh>
      )}
    </group>
  );
}

/** The turn button sits on the piece's front corner, clear of where people grab it. */
function RotateHandle({ piece, onRotate }: { piece: Piece; onRotate: () => void }) {
  const item = catalogItem(piece.item)!;
  return (
    <group position={[piece.x * FT, item.elevation * FT, -piece.y * FT]} rotation-y={(piece.rotation * Math.PI) / 180}>
      <Html position={[(item.width / 2) * FT, item.height * FT, (item.depth / 2) * FT]} center zIndexRange={[20, 10]}>
        <button type="button" className="rotate-handle glass" aria-label="Turn a quarter turn" onClick={onRotate}>
          <RotateCw />
        </button>
      </Html>
    </group>
  );
}
