import { useMemo, useRef, useState } from "react";
import { searchEnds, type EndChoice } from "../logic/projectEdit";

/**
 * "Goes to": texto libre con una lista propia de destinos que contienen lo
 * escrito (`searchEnds`); flechas para moverse, Enter o clic para elegir. Se
 * confirma con Enter o al salir; Esc vuelve al valor guardado.
 */
export function GoesToInput({ initial, choices, onCommit }: { initial: string; choices: EndChoice[]; onCommit: (text: string) => void }) {
  const [text, setText] = useState(initial);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const found = useMemo(() => (open ? searchEnds(choices, text) : []), [open, choices, text]);
  const commit = (value = text) => {
    setOpen(false);
    if (value.trim() !== initial) onCommit(value.trim());
  };
  const pick = (label: string) => {
    setText(label);
    commit(label);
  };
  // Fija a la ventana: la tabla del pinout recorta lo que se sale de ella.
  const box = open && found.length > 0 ? input.current?.getBoundingClientRect() : undefined;
  return (
    <>
      <input
        ref={input}
        className="cn-cell cn-mono"
        value={text}
        placeholder="X4:2, SP1, G1, PDM30 OUT11…"
        aria-label="Goes to"
        aria-autocomplete="list"
        onChange={(e) => {
          setText(e.currentTarget.value);
          setOpen(true);
          setActive(-1);
        }}
        onBlur={() => commit()}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            const step = e.key === "ArrowDown" ? 1 : -1;
            setActive((i) => Math.max(-1, Math.min(found.length - 1, i + step)));
          }
          if (e.key === "Enter") {
            if (active >= 0 && found[active]) pick(found[active]);
            else commit();
          }
          if (e.key === "Escape") {
            setText(initial);
            setOpen(false);
          }
        }}
      />
      {box && (
        <ul className="goes-to-list" role="listbox" style={{ left: box.left, top: box.bottom + 2, minWidth: box.width }}>
          {found.map((label, i) => (
            <li
              key={label}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : undefined}
              // mousedown, no click: el clic llegaría después del blur, que ya confirmó lo escrito.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(label);
              }}
            >
              {label}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
