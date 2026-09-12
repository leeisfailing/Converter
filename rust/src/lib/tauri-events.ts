import { isTauri } from "@tauri-apps/api/core";
import { listen, type Event } from "@tauri-apps/api/event";

/** Dispose immediately even when native listener registration is still pending. */
export function subscribeToEvent<T>(name: string, handler: (event: Event<T>) => void) {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  if (isTauri()) {
    void listen<T>(name, (event) => { if (!disposed) handler(event); }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    }).catch((error) => { if (!disposed) console.warn(`Unable to listen for ${name}:`, error); });
  }
  return () => { disposed = true; unlisten?.(); };
}
