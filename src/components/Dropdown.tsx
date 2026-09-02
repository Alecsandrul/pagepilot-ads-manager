import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The trigger button; the panel renders below it. */
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  width?: number;
}

/** Minimal dropdown with outside click close. */
export default function Dropdown({ open, onClose, trigger, children, align = "right", width = 260 }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {trigger}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            [align]: 0,
            zIndex: 30,
            width,
            background: "#fff",
            border: "1px solid #DFE1E6",
            borderRadius: 10,
            boxShadow: "0 4px 16px rgba(28,43,51,0.12)",
            padding: 8,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
