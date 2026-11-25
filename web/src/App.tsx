import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { Observation } from "./components/Observation";
import { Experiment } from "./components/Experiment";
import { Method } from "./components/Method";
import { Results } from "./components/Results";
import { Log } from "./components/Log";
import { Footer } from "./components/Footer";

export function App() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Observation />
        <Experiment />
        <Method />
        <Results />
        <Log />
      </main>
      <Footer />
    </>
  );
}
