import { Mark } from "./Header";

export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap foot-in">
        <p className="foot-brand">
          <Mark /> Tilt
        </p>
        <p className="mono foot-meta">Stack: TypeScript, NestJS, PostgreSQL, Redis, Three.js.</p>
      </div>
    </footer>
  );
}