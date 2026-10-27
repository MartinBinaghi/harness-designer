import { useCallback, useRef, useState } from "react";

const DEBOUNCE_MS = 500;

/**
 * Espejo local de un documento (project o library) cuya copia autoritativa,
 * con el historial real de undo/redo, vive en el backend. Tipear en un campo
 * dispara `edit` en cada tecla (igual que antes), pero el commit al backend
 * (y el paso de historial que genera) se junta tras una pausa — así un undo
 * deshace "lo que se tipeó en este campo", no una tecla.
 */
export function useBackedState<T>(initial: T, commit: (value: T) => Promise<void>) {
  const [value, setValue] = useState<T>(initial);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<T | null>(null);

  const cancelTimer = () => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
  };

  // Manda el último valor pendiente al backend ahora mismo, sin esperar la
  // pausa de tipeo. Hay que await-earlo antes de pedir undo/redo/abrir otro
  // documento, para no dejar una edición en el aire que llegue después.
  const flush = useCallback(async () => {
    cancelTimer();
    if (pending.current !== null) {
      const toSend = pending.current;
      pending.current = null;
      await commit(toSend);
    }
  }, [commit]);

  const edit = useCallback(
    (next: T) => {
      setValue(next);
      pending.current = next;
      cancelTimer();
      timer.current = window.setTimeout(() => void flush(), DEBOUNCE_MS);
    },
    [flush],
  );

  // Descarta cualquier edición pendiente sin mandarla — para usar justo antes
  // de reemplazar el documento entero (abrir otro archivo, cargar el ejemplo),
  // donde el backend ya tiene el estado nuevo y lo pendiente quedaría viejo.
  const cancel = useCallback(() => {
    cancelTimer();
    pending.current = null;
  }, []);

  // Reemplaza el espejo local sin pasar por `commit` — para cuando el backend
  // ya es la fuente de verdad (abrir/cargar ejemplo, resultado de undo/redo).
  const reset = useCallback((next: T) => {
    cancelTimer();
    pending.current = null;
    setValue(next);
  }, []);

  return { value, edit, cancel, reset, flush };
}
