import { useState } from "react";
import type { Library, SignalType } from "../../model/library";
import { TrashIcon } from "../../components/icons";
import { nextId } from "../../logic/projectEdit";
import { FilterBar, matchesSearch } from "./shared";

export function SignalTypesTab({ library, setLibrary }: { library: Library; setLibrary: (l: Library) => void }) {
  const [search, setSearch] = useState("");

  function update(id: number, patch: Partial<SignalType>) {
    setLibrary({ ...library, signal_types: library.signal_types.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  }
  function add() {
    const id = nextId(library.signal_types.map((s) => s.id));
    setLibrary({ ...library, signal_types: [...library.signal_types, { id, name: "", default_color: "" }] });
  }
  function remove(id: number) {
    setLibrary({ ...library, signal_types: library.signal_types.filter((s) => s.id !== id) });
  }

  const visible = library.signal_types.filter((st) => matchesSearch(search, [st.name, st.default_color]));

  return (
    <section>
      <p className="hint">
        The default wire color for each category (5V, GND, CAN, 12V…). Not just signal wires — any wire picks its
        suggested color from here based on what it carries.
      </p>
      <FilterBar search={search} setSearch={setSearch} placeholder="Search category, color…" count={visible.length} total={library.signal_types.length} />
      <table>
        <thead>
          <tr><th>Category</th><th>Default color</th><th></th></tr>
        </thead>
        <tbody>
          {visible.map((st) => (
            <tr key={st.id}>
              <td><input value={st.name} onChange={(e) => update(st.id, { name: e.currentTarget.value })} placeholder="e.g. 5V, GND, CAN" /></td>
              <td><input value={st.default_color} onChange={(e) => update(st.id, { default_color: e.currentTarget.value })} placeholder="e.g. violet" /></td>
              <td>
                <button className="icon-button" onClick={() => remove(st.id)} title="Delete" aria-label="Delete color">
                  <TrashIcon />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="button-ghost-accent" onClick={add}>+ New</button>
    </section>
  );
}
