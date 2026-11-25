import { useInView } from "../lib/useInView";
import type { CSSProperties, ReactNode } from "react";

export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const style = { "--d": `${delay}ms` } as CSSProperties;
  return (
    <div ref={ref} className={`reveal ${seen ? "is-in" : ""} ${className}`} style={style}>
      {children}
    </div>
  );
}
