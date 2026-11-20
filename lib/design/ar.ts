"use client";

import type * as THREE from "three";

/**
 * Opens the room's cabinets in AR at true size. iPhone and iPad use AR Quick
 * Look with a USDZ made in the browser; Android uses Scene Viewer with a GLB
 * stored for it. Scaling is turned off on both, so a pinch cannot shrink the
 * kitchen and mislead anyone about fit.
 */

export type ArKind = "quicklook" | "sceneviewer" | null;

export function arKind(): ArKind {
  if (typeof document === "undefined") return null;
  if (document.createElement("a").relList.supports?.("ar")) return "quicklook";
  if (/android/i.test(navigator.userAgent)) return "sceneviewer";
  return null;
}

export async function openAr(kind: Exclude<ArKind, null>, model: THREE.Object3D, upload: (glb: Blob) => Promise<string>, title: string) {
  if (kind === "quicklook") {
    const { USDZExporter } = await import("three/examples/jsm/exporters/USDZExporter.js");
    const data = await new USDZExporter().parseAsync(model);
    const url = URL.createObjectURL(new Blob([data], { type: "model/vnd.usdz+zip" }));
    // Quick Look only opens from a link marked rel="ar" that holds an image.
    const a = document.createElement("a");
    a.rel = "ar";
    a.href = `${url}#allowsContentScaling=0`;
    a.appendChild(document.createElement("img"));
    a.click();
    return;
  }
  const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
  const data = (await new GLTFExporter().parseAsync(model, { binary: true })) as ArrayBuffer;
  const file = await upload(new Blob([data], { type: "model/gltf-binary" }));
  const back = window.location.href;
  window.location.href =
    `intent://arvr.google.com/scene-viewer/1.2?file=${encodeURIComponent(file)}&mode=ar_only&resizable=false&title=${encodeURIComponent(title)}` +
    `#Intent;scheme=https;package=com.google.ar.core;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(back)};end;`;
}
