import { Section } from "./Section";
import { Reveal } from "./Reveal";

type Status = "done" | "next" | "todo";

const ENTRIES: { no: string; title: string; text: string; status: Status; date?: string }[] = [
  {
    no: "01",
    title: "Engine",
    text: "Thompson sampling over Beta posteriors, a seeded PRNG, and a deterministic simulator. Pure TypeScript, shared by the server and this page. 16 tests.",
    status: "done",
    date: "25 Nov",
  },
  {
    no: "02",
    title: "Service",
    text: "NestJS API on PostgreSQL. Sticky assignments, one conversion per visitor, and counts the database itself refuses to let go wrong.",
    status: "done",
    date: "25 Nov",
  },
  {
    no: "03",
    title: "Fast path",
    text: "Requests are served from Redis with atomic Lua scripts. A BullMQ worker writes to PostgreSQL with idempotent, retryable jobs, and a wiped cache rebuilds itself. 18 tests against real Redis and PostgreSQL.",
    status: "done",
    date: "25 Nov",
  },
  {
    no: "04",
    title: "Load test",
    text: "k6 runs against the live service. Requests per second, p99 latency, and a check that no assignment or reward is lost.",
    status: "next",
  },
  {
    no: "05",
    title: "Contextual mode and SDK",
    text: "Per-user features so the best variant can differ by audience, plus a small npm package for apps.",
    status: "todo",
  },
];

const MARK: Record<Status, string> = { done: "Done", next: "In progress", todo: "Planned" };

export function Log() {
  return (
    <Section id="log" no={5} label="Lab log" title={<>What exists, and what does not yet.</>}>
      <ol className="log">
        {ENTRIES.map((e, i) => (
          <Reveal key={e.no} delay={i * 60}>
            <li className={`entry ${e.status}`}>
              <span className="entry-no mono">{e.no}</span>
              <div>
                <h3>{e.title}</h3>
                <p>{e.text}</p>
              </div>
              <span className="entry-status mono">
                {MARK[e.status]}
                {e.date ? ` · ${e.date}` : ""}
              </span>
            </li>
          </Reveal>
        ))}
      </ol>
    </Section>
  );
}
