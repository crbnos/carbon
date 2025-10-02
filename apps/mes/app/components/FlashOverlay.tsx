"use client";

import { useEffect, useRef, useState } from "react";

type FlashVariant = "success" | "error";

class FlashOverlayManager {
  private listeners: Set<(variant: FlashVariant) => void> = new Set();

  flash(variant: FlashVariant) {
    this.listeners.forEach((listener) => listener(variant));
  }

  subscribe(listener: (variant: FlashVariant) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const flashOverlay = new FlashOverlayManager();

export function FlashOverlay() {
  const [activeVariant, setActiveVariant] = useState<FlashVariant | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;

    const unsubscribe = flashOverlay.subscribe((variant) => {
      setActiveVariant(variant);
      setIsVisible(true);

      // Play victory sound for success
      if (variant === "success") {
        if (!audioRef.current) {
          audioRef.current = new Audio("/victory.mp3");
        }
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {
          // Ignore errors if audio can't play
        });
      }

      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        setIsVisible(false);
        setActiveVariant(null);
      }, 300);
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  if (!activeVariant) return null;

  const gradientColor =
    activeVariant === "success" ? "34, 197, 94" : "239, 68, 68";

  return (
    <div
      className={`fixed inset-0 pointer-events-none z-[9999] transition-opacity duration-300 ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
      style={{
        background: `radial-gradient(circle, transparent 20%, rgba(${gradientColor}, 0.6) 100%)`,
      }}
    />
  );
}
