"use client";

import { useEffect, useRef } from "react";
import type { PhaserState } from "@/lib/phaser/PetScene";

type PhaserGameProps = {
  stateRef: React.MutableRefObject<PhaserState>;
};

// Renders the Phaser game canvas.
// pointer-events: none so the React stage div above it handles all input.
export function PhaserGame({ stateRef }: PhaserGameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<{ destroy: (r: boolean) => void } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    const init = async () => {
      const PhaserLib = (await import("phaser")).default;
      const { createPetSceneClass } = await import("@/lib/phaser/PetScene");

      if (cancelled) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const PetSceneClass = createPetSceneClass(PhaserLib) as any;
      const scene = new PetSceneClass();
      scene.stateRef = stateRef;

      const game = new PhaserLib.Game({
        type: PhaserLib.WEBGL,
        backgroundColor: "#000000",
        scene,
        parent: container,
        width: container.clientWidth || window.innerWidth,
        height: container.clientHeight || window.innerHeight,
        scale: {
          mode: PhaserLib.Scale.RESIZE,
          autoCenter: PhaserLib.Scale.CENTER_BOTH,
          width: "100%",
          height: "100%",
        },
        render: {
          antialias: true,
          pixelArt: false,
          transparent: false,
          roundPixels: false,
        },
        input: {
          mouse: { preventDefaultWheel: false, target: container },
          touch: { target: container },
        },
        audio: { disableWebAudio: true },
      });

      if (!cancelled) {
        gameRef.current = game;
        // Make Phaser's canvas ignore pointer events — React stage div handles them
        const canvas = container.querySelector("canvas");
        if (canvas) canvas.style.pointerEvents = "none";
      } else {
        game.destroy(true);
      }
    };

    void init();

    return () => {
      cancelled = true;
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
    // stateRef is stable (created with useRef in parent); intentionally empty dep array
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 1,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    />
  );
}
