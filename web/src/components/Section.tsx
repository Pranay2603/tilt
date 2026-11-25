import type { ReactNode } from "react";
import { Reveal } from "./Reveal";

export function Section({
  id,
  no,
  label,
  title,
  children,
}: {
  id: string;
  no: number;
  label: string;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section" id={id}>
      <div className="wrap sheet">
        <aside className="rail">
          <span className="rail-no">§{no}</span>
          <span className="rail-label mono">{label}</span>
        </aside>
        <div className="body">
          <Reveal>
            <h2>{title}</h2>
          </Reveal>
          {children}
        </div>
      </div>
    </section>
  );
}
