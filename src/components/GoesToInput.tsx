import { useState } from "react";

/** "Goes to": texto libre con autocompletado; se confirma con Enter o al salir. */
export function GoesToInput({ initial, list, onCommit }: { initial: string; list: string; onCommit: (text: string) => void }) {
  const [text, setText] = useState(initial);
  const commit = () => {
    if (text.trim() !== initial) onCommit(text.trim());
  };
  return (
    <input
      className="cn-cell cn-mono"
      list={list}
      value={text}
      placeholder="X4:2, SP1, G1, PDM30 OUT11…"
      aria-label="Goes to"
      onChange={(e) => setText(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setText(initial);
      }}
    />
  );
}
