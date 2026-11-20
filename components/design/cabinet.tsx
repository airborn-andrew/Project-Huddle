"use client";

import { useTexture } from "@react-three/drei";
import { Suspense, useMemo } from "react";
import * as THREE from "three";
import type { CatalogItem } from "@/lib/design/catalog";
import { paints, type DoorStyle } from "@/lib/design/layout";

/**
 * A cabinet or appliance as it looks in the kitchen. Built from simple boxes
 * at real sizes: a recessed toe kick, a box, drawer and door fronts in the
 * picked style and finish, bar pulls, a countertop, and stainless or black
 * glass appliances. Local space is in feet with the front facing +z and the
 * floor (or the bottom of a wall cabinet) at y = 0.
 */

const FT = 1 / 12;
const TOE = 4;
const GAP = 0.125;

type Front = { x: number; y: number; w: number; h: number; drawer: boolean };

export function CabinetModel({ item, door = "shaker", finish = "white" }: { item: CatalogItem; door?: DoorStyle; finish?: string }) {
  if (item.group === "appliance") return <Appliance item={item} />;
  const photo = !(finish in paints);
  return photo ? (
    <Suspense fallback={<Cabinet item={item} door={door} material={painted("white")} />}>
      <PhotoCabinet item={item} door={door} url={finish} />
    </Suspense>
  ) : (
    <Cabinet item={item} door={door} material={painted(finish as keyof typeof paints)} />
  );
}

function PhotoCabinet({ item, door, url }: { item: CatalogItem; door: DoorStyle; url: string }) {
  const map = useTexture(url);
  const material = useMemo(() => {
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    return new THREE.MeshStandardMaterial({ map, roughness: 0.55, metalness: 0 });
  }, [map]);
  return <Cabinet item={item} door={door} material={material} />;
}

const paintCache = new Map<string, THREE.MeshStandardMaterial>();
function painted(name: keyof typeof paints) {
  if (!paintCache.has(name)) paintCache.set(name, new THREE.MeshStandardMaterial({ color: paints[name], roughness: 0.42, metalness: 0 }));
  return paintCache.get(name)!;
}

const mats = {
  box: new THREE.MeshStandardMaterial({ color: "#d8d6d0", roughness: 0.6 }),
  toe: new THREE.MeshStandardMaterial({ color: "#1c1c1e", roughness: 0.8 }),
  counter: new THREE.MeshPhysicalMaterial({ color: "#f1f0ec", roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
  pull: new THREE.MeshStandardMaterial({ color: "#2b2c2e", roughness: 0.3, metalness: 0.85 }),
  steel: new THREE.MeshStandardMaterial({ color: "#d3d5d8", roughness: 0.34, metalness: 0.55 }),
  glass: new THREE.MeshPhysicalMaterial({ color: "#0b0b0c", roughness: 0.08, metalness: 0.2, clearcoat: 1 }),
  basin: new THREE.MeshStandardMaterial({ color: "#a9abae", roughness: 0.25, metalness: 0.9 }),
};

/** The door and drawer fronts on a cabinet's face, in inches from its left and bottom. */
function fronts(item: CatalogItem): Front[] {
  const floor = item.layer !== "wall";
  const bottom = floor ? TOE : 0;
  const height = item.height - bottom;
  const leaves = (y: number, h: number): Front[] => {
    const n = item.width <= 21 ? 1 : item.width <= 36 ? 2 : Math.ceil(item.width / 18);
    const w = item.width / n;
    return Array.from({ length: n }, (_, i) => ({ x: i * w, y, w, h, drawer: false }));
  };
  if (item.kind === "drawers") {
    const top = 6;
    const rest = (height - top) / 2;
    return [
      { x: 0, y: bottom + rest * 2, w: item.width, h: top, drawer: true },
      { x: 0, y: bottom + rest, w: item.width, h: rest, drawer: true },
      { x: 0, y: bottom, w: item.width, h: rest, drawer: true },
    ];
  }
  if (item.group === "wall") return leaves(0, item.height);
  if (item.group === "tall") {
    const low = 48;
    return [...leaves(bottom, low), ...leaves(bottom + low, height - low)];
  }
  // Base, sink and island: a drawer (or a false front over the sink) above doors.
  const top = 6;
  const drawers = leaves(bottom + height - top, top).map((f) => ({ ...f, drawer: true }));
  return [...drawers, ...leaves(bottom, height - top)];
}

function Cabinet({ item, door, material }: { item: CatalogItem; door: DoorStyle; material: THREE.Material }) {
  const w = item.width * FT;
  const d = item.depth * FT;
  const floor = item.layer !== "wall";
  const toe = floor ? TOE * FT : 0;
  const top = item.height * FT;
  const faces = useMemo(() => fronts(item), [item]);

  return (
    <group>
      {floor && (
        <mesh position={[0, toe / 2, -0.25 * FT]} castShadow receiveShadow>
          <boxGeometry args={[w - 0.5 * FT, toe, d - 3.5 * FT]} />
          <primitive object={mats.toe} attach="material" />
        </mesh>
      )}
      <mesh position={[0, toe + (top - toe) / 2, -0.4 * FT]} castShadow receiveShadow>
        <boxGeometry args={[w, top - toe, d - 0.8 * FT]} />
        <primitive object={material} attach="material" />
      </mesh>
      {faces.map((f, i) => (
        <group key={i} position={[(f.x + f.w / 2) * FT - w / 2, (f.y + f.h / 2) * FT, d / 2 - 0.4 * FT]}>
          <DoorFront w={(f.w - GAP * 2) * FT} h={(f.h - GAP * 2) * FT} style={f.drawer && door === "raised" ? "shaker" : door} material={material} />
          <Pull
            drawer={f.drawer}
            w={f.w * FT}
            h={f.h * FT}
            // Doors pull on the side away from their hinge: the outer pair meets in the middle.
            side={f.x + f.w / 2 < item.width / 2 ? 1 : -1}
            wall={!floor}
            single={f.w >= item.width - 0.01}
          />
        </group>
      ))}
      {item.counter && (
        <mesh position={[0, top + 0.75 * FT, 0.5 * FT]} castShadow receiveShadow>
          <boxGeometry args={[w, 1.5 * FT, d + 1 * FT]} />
          <primitive object={mats.counter} attach="material" />
        </mesh>
      )}
      {item.kind === "sink" && (
        <mesh position={[0, top + 1.52 * FT, 0.5 * FT]}>
          <boxGeometry args={[w * 0.72, 0.02 * FT, d * 0.6]} />
          <primitive object={mats.basin} attach="material" />
        </mesh>
      )}
    </group>
  );
}

/** One door or drawer front, 3/4" thick. Shaker is a frame around a recessed panel; raised adds a raised center. */
function DoorFront({ w, h, style, material }: { w: number; h: number; style: DoorStyle; material: THREE.Material }) {
  const t = 0.75 * FT;
  if (style === "slab" || w < 6 * FT || h < 5 * FT) {
    return (
      <mesh position-z={t / 2} castShadow>
        <boxGeometry args={[w, h, t]} />
        <primitive object={material} attach="material" />
      </mesh>
    );
  }
  const rail = Math.min(2.5 * FT, w / 4, h / 4);
  return (
    <group>
      <mesh position-z={0.15 * FT}>
        <boxGeometry args={[w - rail, h - rail, 0.3 * FT]} />
        <primitive object={material} attach="material" />
      </mesh>
      {[
        [0, h / 2 - rail / 2, w, rail],
        [0, -h / 2 + rail / 2, w, rail],
        [-w / 2 + rail / 2, 0, rail, h - rail * 2],
        [w / 2 - rail / 2, 0, rail, h - rail * 2],
      ].map(([x, y, fw, fh], i) => (
        <mesh key={i} position={[x, y, t / 2]} castShadow>
          <boxGeometry args={[fw, fh, t]} />
          <primitive object={material} attach="material" />
        </mesh>
      ))}
      {style === "raised" && (
        <mesh position-z={0.45 * FT}>
          <boxGeometry args={[w - rail * 3, h - rail * 3, 0.5 * FT]} />
          <primitive object={material} attach="material" />
        </mesh>
      )}
    </group>
  );
}

function Pull({ drawer, w, h, side, wall, single }: { drawer: boolean; w: number; h: number; side: number; wall: boolean; single: boolean }) {
  const z = 1.1 * FT;
  if (drawer) {
    return (
      <mesh position={[0, 0, z]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.22 * FT, 0.22 * FT, Math.min(w * 0.5, 8 * FT), 12]} />
        <primitive object={mats.pull} attach="material" />
      </mesh>
    );
  }
  const x = single ? w / 2 - 1.75 * FT : side * (w / 2 - 1.75 * FT);
  // Pulls sit near the bottom of wall doors and near the top of base doors.
  const y = wall ? -h / 2 + 3.5 * FT : h / 2 - 3.5 * FT;
  return (
    <mesh position={[x, y, z]}>
      <cylinderGeometry args={[0.22 * FT, 0.22 * FT, Math.min(5 * FT, h * 0.4), 12]} />
      <primitive object={mats.pull} attach="material" />
    </mesh>
  );
}

function Appliance({ item }: { item: CatalogItem }) {
  const w = item.width * FT;
  const d = item.depth * FT;
  const h = item.height * FT;
  const front = d / 2;
  const handle = (x: number, y: number, length: number, across = false) => (
    <mesh position={[x, y, front + 1 * FT]} rotation-z={across ? Math.PI / 2 : 0}>
      <cylinderGeometry args={[0.3 * FT, 0.3 * FT, length, 12]} />
      <primitive object={mats.steel} attach="material" />
    </mesh>
  );
  switch (item.kind) {
    case "refrigerator":
      return (
        <group>
          <mesh position-y={h / 2} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            <primitive object={mats.steel} attach="material" />
          </mesh>
          {/* French doors over a freezer drawer. */}
          <mesh position={[0, h * 0.32, front + 0.02 * FT]}>
            <boxGeometry args={[w - 0.4 * FT, 0.15 * FT, 0.05 * FT]} />
            <primitive object={mats.toe} attach="material" />
          </mesh>
          <mesh position={[0, h * 0.66, front + 0.02 * FT]}>
            <boxGeometry args={[0.15 * FT, h * 0.66, 0.05 * FT]} />
            <primitive object={mats.toe} attach="material" />
          </mesh>
          {handle(-1.2 * FT, h * 0.66, h * 0.4)}
          {handle(1.2 * FT, h * 0.66, h * 0.4)}
          {handle(0, h * 0.28, w * 0.6, true)}
        </group>
      );
    case "range":
      return (
        <group>
          <mesh position-y={h / 2 - 0.5 * FT} castShadow receiveShadow>
            <boxGeometry args={[w, h - 1 * FT, d]} />
            <primitive object={mats.steel} attach="material" />
          </mesh>
          <mesh position={[0, h - 0.5 * FT, 0]}>
            <boxGeometry args={[w, 1 * FT, d]} />
            <primitive object={mats.glass} attach="material" />
          </mesh>
          <mesh position={[0, h * 0.45, front + 0.05 * FT]}>
            <boxGeometry args={[w * 0.72, h * 0.32, 0.1 * FT]} />
            <primitive object={mats.glass} attach="material" />
          </mesh>
          {handle(0, h * 0.7, w * 0.75, true)}
        </group>
      );
    case "dishwasher":
      return (
        <group>
          <mesh position={[0, TOE * FT / 2, -0.25 * FT]}>
            <boxGeometry args={[w - 0.5 * FT, TOE * FT, d - 3.5 * FT]} />
            <primitive object={mats.toe} attach="material" />
          </mesh>
          <mesh position-y={TOE * FT + (h - TOE * FT) / 2} castShadow receiveShadow>
            <boxGeometry args={[w - 0.25 * FT, h - TOE * FT, d]} />
            <primitive object={mats.steel} attach="material" />
          </mesh>
          {handle(0, h - 4 * FT, w * 0.7, true)}
          <mesh position={[0, h + 0.75 * FT, 0.5 * FT]} castShadow receiveShadow>
            <boxGeometry args={[w, 1.5 * FT, d + 1 * FT]} />
            <primitive object={mats.counter} attach="material" />
          </mesh>
        </group>
      );
    default:
      // Microwave hood.
      return (
        <group>
          <mesh position-y={h / 2} castShadow>
            <boxGeometry args={[w, h, d]} />
            <primitive object={mats.steel} attach="material" />
          </mesh>
          <mesh position={[-w * 0.1, h / 2, front + 0.05 * FT]}>
            <boxGeometry args={[w * 0.68, h * 0.7, 0.1 * FT]} />
            <primitive object={mats.glass} attach="material" />
          </mesh>
        </group>
      );
  }
}
