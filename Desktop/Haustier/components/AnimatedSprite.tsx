"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEventHandler } from "react";

type AnimatedSpriteProps = {
  className: string;
  frames: readonly string[];
  frameMs: number;
  label: string;
  renderMode?: "background" | "frames";
  onClick?: MouseEventHandler<HTMLDivElement>;
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
  style,
  children
}: AnimatedSpriteProps) {
  const [frameIndex, setFrameIndex] = useState(0);
  const [loadedFrames, setLoadedFrames] = useState<Record<string, boolean>>({});
  const [lastVisibleFrame, setLastVisibleFrame] = useState<string | null>(null);

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

  const markFrameReady = useCallback((frame: string) => {
    setLoadedFrames((current) => (current[frame] ? current : { ...current, [frame]: true }));
    setLastVisibleFrame((current) => (currentFrame === frame || current === null ? frame : current));
  }, [currentFrame]);

  useEffect(() => {
    if (frames.length === 0) return;

    let cancelled = false;

    frames.forEach((frame) => {
      const image = new Image();
      image.onload = () => {
        if (!cancelled) markFrameReady(frame);
      };
      image.onerror = () => {
        if (!cancelled) markFrameReady(frame);
      };
      image.src = frame;
    });

    return () => {
      cancelled = true;
    };
  }, [frames, framesKey, markFrameReady]);
  const frameStyle = {
    ...style,
    backgroundImage: activeFrame ? `url(${activeFrame})` : undefined
  };

  useEffect(() => {
    if (!framesReady || frames.length <= 1) return;

    let animationFrame = 0;
    let lastTick = performance.now();

    const tick = (now: number) => {
      if (now - lastTick >= frameMs) {
        setFrameIndex((current) => {
          const nextIndex = (current + 1) % frames.length;
          if (loadedFrames[frames[nextIndex]]) setLastVisibleFrame(frames[nextIndex]);
          return nextIndex;
        });
        lastTick = now;
      }

      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(animationFrame);
  }, [frameMs, frames, frames.length, framesReady, loadedFrames]);

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
    <div aria-label={label} className={className} onClick={onClick} role="img" style={frameStyle}>
      {visibleFrames.map((frame) => (
        <img
          alt=""
          className={`spriteFrame${frame === activeFrame ? " active" : " neighbor"}`}
          decoding="sync"
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
