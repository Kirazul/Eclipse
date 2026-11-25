/**
 * The viewer engine. `createEngine` is the only way in; the site talks to the
 * returned object and reads ./stores. The engine also sits on `window.eclipse`, so
 * tests read the same numbers Khada's window API gives.
 */
import type { EngineDebug, EngineOptions, ViewerEngine } from "./api";
import { EclipseEngine, type EngineExtras } from "./engine";

export type { EngineDebug, EngineOptions, ViewerEngine } from "./api";
export * from "./stores";

export function createEngine(options: EngineOptions & EngineExtras): ViewerEngine {
  const engine = new EclipseEngine(options);
  if (typeof window !== "undefined") {
    (window as unknown as { eclipse: ViewerEngine & EngineDebug }).eclipse = engine;
  }
  return engine;
}
