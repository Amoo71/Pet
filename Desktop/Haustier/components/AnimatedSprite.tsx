"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEventHandler } from "react";

type AnimatedSpriteProps = {
  className: string;
  frames: readonly string[];
  frameMs: number;
  label: string;
  renderMode?: "background" | "frames";
  onClick?: MouseEventHandler<HTMLDivElement>;
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>;
  onPointerMove?: React.PointerEventHandler<HTMLDivElement>;
  onPointerUp?: React.PointerEventHandler<HTMLDivElement>;
  style?: React.CSSProperties;
  children?: React.ReactNode;
};

export function AnimatedSprite({
  className,
  frames,
  frameMs,
  label,
  renderMode = "frames",
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  style,
  children
}: AnimatedSpriteProps) {
  const [frameIndex, setFrameIndex] = useState(0);
  const [loadedFrames, setLoadedFrames] = useState<Record<string, boolean>>({});
  const [lastVisibleFrame, setLastVisibleFrame] = useState<string | null>(null);

  // Refs so the RAF can read latest values without being a dep (no restart on change)
  const framesRef = useRef(frames);
  framesRef.current = frames;
  const loadedFramesRef = useRef(loadedFrames);

  const framesKey = frames.join("|");
  const currentFrame = frames.length > 0 ? frames[frameIndex % frames.length] : null;
  const framesReady = frames.length > 0 && frames.every((frame) => loadedFrames[frame]);
  const firstLoadedFrame = frames.find((frame) => loadedFrames[frame]) ?? null;
  const visibleFrame = currentFrame && loadedFrames[currentFrame] ? currentFrame : firstLoadedFrame;
  const activeFrame = visibleFrame ?? lastVisibleFrame;

  const visibleFrames = useMemo(() => {
    if (!activeFrame) return [];
    const centerIndex = frames.indexOf(activeFrame);
    if (centerIndex === -1) return [activeFrame];
    const previousFrame = frames[(centerIndex - 1 + frames.length) % frames.length];
    const nextFrame = frames[(centerIndex + 1) % frames.length];
    return Array.from(new Set([previousFrame, activeFrame, nextFrame]));
  }, [activeFrame, frames]);

  // Stable callback — updates the ref immediately then schedules the state update
  const markFrameReady = useCallback((frame: string) => {
    if (!loadedFramesRef.current[frame]) {
      const next = { ...loadedFramesRef.current, [frame]: true };
      loadedFramesRef.current = next;
      setLoadedFrames(next);
    }
  }, []);

  // Preload images whenever frame content changes
  useEffect(() => {
    const f = framesRef.current;
    if (f.length === 0) return;
    let cancelled = false;
    f.forEach((frame) => {
      const image = new Image();
      image.onload = () => { if (!cancelled) markFrameReady(frame); };
      image.onerror = () => { if (!cancelled) markFrameReady(frame); };
      image.src = frame;
    });
    return () => { cancelled = true; };
  // framesKey changes when frame content changes; markFrameReady is stable
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framesKey, markFrameReady]);

  // Animation RAF — deps are ONLY framesReady and frameMs.
  // frames and loadedFrames are read via refs so the RAF never restarts due to
  // individual frame loads or state transitions (eliminates all flicker).
  useEffect(() => {
    if (!framesReady) return;

    let animationFrame = 0;
    let lastTick = performance.now();

    const tick = (now: number) => {
      const f = framesRef.current;
      if (f.length > 1 && now - lastTick >= frameMs) {
        setFrameIndex((current) => {
          const nextIndex = (current + 1) % f.length;
          if (loadedFramesRef.current[f[nextIndex]]) {
            setLastVisibleFrame(f[nextIndex]);
          }
          return nextIndex;
        });
        lastTick = now;
      }
      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [framesReady, frameMs]);

  const frameStyle = {
    ...style,
    backgroundImage: activeFrame ? `url(${activeFrame})` : undefined
  };

  if (renderMode === "background") {
    return (
      <div
        aria-label={label}
        className={className}
        onClick={onClick}
        role="img"
        style={{ ...style, backgroundImage: currentFrame ? `url(${currentFrame})` : undefined }}
      >
        {children}
      </div>
    );
  }

  return (
    <div aria-label={label} className={className} onClick={onClick} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} role="img" style={frameStyle}>
      {visibleFrames.map((frame) => (
        <img
          alt=""
          className={`spriteFrame${frame === activeFrame ? " active" : " neighbor"}`}
          decoding="async"
          draggable={false}
          key={frame}
          loading="eager"
          onError={() => markFrameReady(frame)}
          onLoad={() => markFrameReady(frame)}
          src={frame}
        />
      ))}
      {!activeFrame && !framesReady ? children : null}
    </div>
  );
}
