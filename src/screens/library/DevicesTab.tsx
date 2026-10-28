import { useState } from "react";
import { partLabel, type ConnectorDef, type DeviceDef, type DeviceDefConnector, type Library, type Part } from "../../model/library";
import milStd1560 from "../../data/mil-std-1560.json";
import { connectorFace, type MilArrangements } from "../../logic/connectorFace";
import { ConnectorFaceView } from "../../components/ConnectorFaceView";
import { applyPaste, devicePinRows, nextDeviceId, setDevicePin } from "../../logic/devicePins";
import { addPart, removePart, updatePart, updateSubtype } from "../../logic/libraryEdit";
import { PastePinout } from "./PastePinout";
import { matchesSearch, numberOrNull, type TabProps } from "./shared";

/**
 * Dispositivos (PDM, ECU, volante del cliente…): lista + ficha, como
 * Connectors. Cada conector del dispositivo es una carcasa del arnés (la que se
 * compra) con todas sus vías listadas: se escribe nombre y función de cada
 * pin, o se pega la tabla que mandó el cliente. La cara dibujada muestra el
 * nombre de cada pin. Lógica en devicePins.ts.
 */
export function DeviceDefsTab({ library, setLibrary, partById }: TabProps) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const rows = library.device_defs.flatMap((dd) => {
    const part = partById(dd.part_id);
    return part ? [{ dd, part }] : [];
  });
  const visible = rows.filter(({ part }) => matchesSearch(search, [part.part_number, part.manufacturer, part.description]));
  const selected = rows.find((r) => r.dd.part_id === selectedId) ?? visible[0] ?? null;

  function addDevice() {
    const next = addPart(library, "device", "device_defs", (partId) => ({ part_id: partId, connectors: [] }));
    setLibrary(next);
    setSelectedId(next.parts[next.parts.length - 1].id);
    setSearch("");
  }
  function deleteDevice(partId: number) {
    const index = visible.findIndex((r) => r.dd.part_id === partId);
    setSelectedId((visible[index + 1] ?? visible[index - 1])?.dd.part_id ?? null);
    setLibrary(removePart(library, "device_defs", partId));
  }

  return (
    <section className="lib-master-detail">
      <aside className="lib-list">
        <div className="lib-list-filters">
          <input value={search} onChange={(e) => setSearch(e.currentTarget.value)} placeholder="Search devices" aria-label="Search devices" />
        </div>
        <div className="lib-list-rows">
          {visible.map(({ dd, part }) => {
            const { named, total } = pinCount(library, dd);
            return (
              <button key={dd.part_id} className={dd.part_id === selected?.dd.part_id ? "lib-list-row selected" : "lib-list-row"} onClick={() => setSelectedId(dd.part_id)}>
                <span className="lib-list-pn">{part.part_number || "(no part number)"}</span>
                <span className="lib-list-count">{named}/{total}</span>
                <span className="lib-list-meta">
                  {dd.connectors.length === 0 ? "no connectors" : `${dd.connectors.length} connector${dd.connectors.length === 1 ? "" : "s"} · ${dd.connectors.map((c) => c.label || "?").join(", ")}`}
                </span>
              </button>
            );
          })}
          {visible.length === 0 && <p className="hint lib-list-empty">{rows.length === 0 ? "No devices yet." : "No devices match."}</p>}
        </div>
        <div className="lib-list-footer">
          <button className="button-ghost-accent" onClick={addDevice}>+ New device</button>
        </div>
      </aside>

      {selected ? (
        <DeviceDetail
          key={selected.dd.part_id}
          library={library}
          dd={selected.dd}
          part={selected.part}
          onPart={(patch) => setLibrary(updatePart(library, selected.part.id, patch))}
          onDd={(patch) => setLibrary(updateSubtype<"device_defs", DeviceDef>(library, "device_defs", selected.dd.part_id, patch))}
          onDelete={() => deleteDevice(selected.dd.part_id)}
        />
      ) : (
        <div className="lib-detail">
          <p className="hint">No devices yet: “+ New device”, then add its connectors and their pin names.</p>
        </div>
      )}
    </section>
  );
}

/** Pines con nombre / vías de las carcasas, para la lista. */
function pinCount(library: Library, dd: DeviceDef): { named: number; total: number } {
  let named = 0;
  let total = 0;
  for (const c of dd.connectors) {
    const housing = library.connector_defs.find((d) => d.part_id === c.connector_def_id);
    const rows = devicePinRows(c, housing);
    total += rows.length;
    named += rows.filter((r) => r.name).length;
  }
  return { named, total };
}

function housingLabel(library: Library, cd: ConnectorDef): string {
  return `${partLabel(library, cd.part_id)} · ${cd.cavities.length}-way ${cd.gender}`;
}

function DeviceDetail({ library, dd, part, onPart, onDd, onDelete }: {
  library: Library;
  dd: DeviceDef;
  part: Part;
  onPart: (patch: Partial<Part>) => void;
  onDd: (patch: Partial<DeviceDef>) => void;
  onDelete: () => void;
}) {
  const [connectorId, setConnectorId] = useState<number | null>(dd.connectors[0]?.id ?? null);
  const [pickedCavity, setPickedCavity] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const connector = dd.connectors.find((c) => c.id === connectorId) ?? dd.connectors[0] ?? null;
  const housing = connector ? library.connector_defs.find((d) => d.part_id === connector.connector_def_id) : undefined;
  const { named, total } = pinCount(library, dd);

  function setConnector(next: DeviceDefConnector) {
    onDd({ connectors: dd.connectors.map((c) => (c.id === next.id ? next : c)) });
  }
  function addConnector() {
    const housingDef = library.connector_defs[0];
    if (!housingDef) {
      alert("Add at least one connector in Library → Connectors first: each device connector is one of those housings.");
      return;
    }
    const used = new Set(dd.connectors.map((c) => c.label));
    const label = [..."ABCDEFGHJKLMNPRSTUVWXYZ"].find((l) => !used.has(l)) ?? "";
    const id = nextDeviceId(library, "connectors");
    onDd({ connectors: [...dd.connectors, { id, label, connector_def_id: housingDef.part_id, pins: [] }] });
    setConnectorId(id);
    setPasting(false);
  }
  function removeConnector(id: number) {
    const rest = dd.connectors.filter((c) => c.id !== id);
    onDd({ connectors: rest });
    setConnectorId(rest[0]?.id ?? null);
    setPasting(false);
  }
  function pick(cavityId: string) {
    setPickedCavity(cavityId);
    document.getElementById(`dev-pin-${cavityId}`)?.focus();
  }

  const rows = connector ? devicePinRows(connector, housing) : [];
  const names = Object.fromEntries(rows.filter((r) => r.name).map((r) => [r.cavityId, r.name]));
  // Carcasas de serie desconocida (ej. la del PDM) no se dibujan: la tabla ocupa todo el ancho.
  const drawable = !!housing && connectorFace(housing, milStd1560.arrangements as MilArrangements) !== null;

  return (
    <div className="lib-detail dev-detail">
      <div className="lib-detail-header">
        <input className="lib-detail-pn" value={part.part_number} onChange={(e) => onPart({ part_number: e.currentTarget.value })} placeholder="part number" aria-label="Part number" />
        <span className="lib-detail-sub">{dd.connectors.length} connector{dd.connectors.length === 1 ? "" : "s"} · {named}/{total} pins named</span>
        <span className="lib-detail-spacer" />
        <button className="lib-delete" onClick={onDelete}>Delete</button>
      </div>

      <section className="lib-card">
        <div className="lib-fields dev-part-fields">
          <label>
            <span className="field-label">Manufacturer</span>
            <input value={part.manufacturer ?? ""} onChange={(e) => onPart({ manufacturer: e.currentTarget.value || null })} placeholder="—" />
          </label>
          <label>
            <span className="field-label">USD</span>
            <input type="number" value={part.price_usd ?? ""} onChange={(e) => onPart({ price_usd: numberOrNull(e.currentTarget.value) })} placeholder="—" />
          </label>
          <label className="lib-field-wide">
            <span className="field-label">Description</span>
            <input value={part.description ?? ""} onChange={(e) => onPart({ description: e.currentTarget.value || null })} placeholder="e.g. Power distribution module" />
          </label>
        </div>
      </section>

      <div className="dev-connector-chips" role="tablist" aria-label="Device connectors">
        {dd.connectors.map((c) => {
          const h = library.connector_defs.find((d) => d.part_id === c.connector_def_id);
          const r = devicePinRows(c, h);
          return (
            <button key={c.id} role="tab" aria-selected={c.id === connector?.id} className={c.id === connector?.id ? "filter-chip active" : "filter-chip"} onClick={() => { setConnectorId(c.id); setPasting(false); }}>
              {c.label || "?"} · {r.filter((x) => x.name).length}/{r.length}
            </button>
          );
        })}
        <button className="link-button" onClick={addConnector}>+ connector</button>
      </div>

      {connector && (
        <>
          <section className="lib-card dev-connector-head">
            <label className="dev-label">
              <span className="field-label">Label</span>
              <input value={connector.label} onChange={(e) => setConnector({ ...connector, label: e.currentTarget.value })} placeholder="A" />
            </label>
            <label className="dev-housing">
              <span className="field-label">Harness-side housing (what you buy)</span>
              <select value={connector.connector_def_id} onChange={(e) => setConnector({ ...connector, connector_def_id: Number(e.currentTarget.value) })}>
                {library.connector_defs.map((cd) => <option key={cd.part_id} value={cd.part_id}>{housingLabel(library, cd)}</option>)}
              </select>
            </label>
            <button onClick={() => setPasting(!pasting)} aria-pressed={pasting}>Paste pinout…</button>
            <button className="lib-delete" onClick={() => removeConnector(connector.id)}>Delete connector</button>
          </section>

          {pasting && (
            <PastePinout
              cavityIds={housing?.cavities.map((c) => c.cavity_id) ?? []}
              label={connector.label}
              housingName={housing ? partLabel(library, housing.part_id) : "the housing"}
              onCancel={() => setPasting(false)}
              onApply={(pasted, replace) => {
                setConnector(applyPaste(connector, pasted, replace, nextDeviceId(library, "pins")));
                setPasting(false);
              }}
            />
          )}

          <div className="dev-body">
            <section className="lib-card dev-pins">
              <table className="dev-pin-table">
                <thead><tr><th className="dev-col-cav">Cavity</th><th className="dev-col-name">Pin name</th><th>Function</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.cavityId} className={r.cavityId === pickedCavity ? "selected-row" : undefined}>
                      <td className="dev-col-cav">
                        {r.cavityId}
                        {!r.inHousing && <span className="dev-warn" title="This housing has no such cavity: clear it or pick the right housing"> not in housing</span>}
                      </td>
                      <td>
                        <span className="dev-name-cell">
                          <input
                            id={`dev-pin-${r.cavityId}`}
                            className="cn-cell cn-mono"
                            value={r.name}
                            placeholder="—"
                            aria-label={`Pin name of ${r.cavityId}`}
                            onFocus={() => setPickedCavity(r.cavityId)}
                            onChange={(e) => setConnector(setDevicePin(connector, r.cavityId, { name: e.currentTarget.value }, nextDeviceId(library, "pins")))}
                          />
                          {r.alsoOn.length > 0 && <span className="dev-also" title="Same name on another pin: one output split over several pins">also {r.alsoOn.join(", ")}</span>}
                        </span>
                      </td>
                      <td>
                        <input
                          className="cn-cell"
                          value={r.fn}
                          placeholder="—"
                          aria-label={`Function of ${r.cavityId}`}
                          onFocus={() => setPickedCavity(r.cavityId)}
                          onChange={(e) => setConnector(setDevicePin(connector, r.cavityId, { fn: e.currentTarget.value }, nextDeviceId(library, "pins")))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && <p className="hint">The housing has no cavities yet: add them in Library → Connectors.</p>}
              <p className="hint dev-footnote">A name used on two pins (OUT1 on A1 and A10) is one output split over two pins: wire each one.</p>
            </section>
            {drawable && (
              <section className="lib-card dev-face">
                <ConnectorFaceView def={housing} names={names} selected={pickedCavity} onPick={pick} />
              </section>
            )}
          </div>
        </>
      )}
      {!connector && <p className="hint">Add the device's connectors (A, B…) with “+ connector”.</p>}
    </div>
  );
}
