import { useState } from "react";
import { Handle, Position, BaseEdge, EdgeLabelRenderer, getStraightPath, type Node as FlowNode, type Edge, type NodeProps, type EdgeProps } from "@xyflow/react";
import type { HarnessNodeData, Issue, SegmentEdgeData } from "./flowData";

/** Cómo se dibuja cada nodo y cada segmento del diagrama (componentes de React Flow). */

/**
 * Handles invisibles en el centro (los segmentos van de centro a centro y el
 * bloque tapa el tramo interior) + un "+" que aparece al pasar el mouse:
 * arrastrarlo crea una rama nueva (ver onConnectEnd).
 */
function CenterHandles() {
  // Tamaño cero: React Flow engancha la línea en el borde superior del handle
  // (Position.Top), así que con el tamaño por defecto (6 px) todas las líneas
  // terminaban 3 px por encima del centro del nodo.
  const style = {
    top: "50%",
    left: "50%",
    width: 0,
    height: 0,
    minWidth: 0,
    minHeight: 0,
    border: 0,
    opacity: 0,
    pointerEvents: "none" as const,
  };
  return (
    <>
      <Handle id="c-t" type="target" position={Position.Top} style={style} isConnectable={false} />
      <Handle id="c-s" type="source" position={Position.Top} style={style} isConnectable={false} />
      <Handle id="branch" type="source" position={Position.Right} className="dg-branch-handle" title="Drag to add a branch" />
    </>
  );
}

function IssueDot({ issue }: { issue: Issue | null }) {
  if (!issue) return null;
  return <span className={`status-dot status-dot-${issue}`} title={issue === "error" ? "Has errors (see Checks)" : "Has warnings (see Checks)"} />;
}

function HarnessNode({ data }: NodeProps<FlowNode<HarnessNodeData>>) {
  const d = data;
  if (d.variant === "point") {
    return (
      <div className={`dg-point${d.selected ? " dg-selected" : ""}`}>
        <CenterHandles />
        <div className="dg-point-labels">
          {d.notes.map((n) => (
            <div key={n}>{n}</div>
          ))}
          {d.distanceLabel && <div className="dg-distance">{d.distanceLabel}</div>}
          {d.issue && (
            <div>
              <IssueDot issue={d.issue} />
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div
      className={`dg-block${d.variant === "ground" ? " dg-ground" : ""}${d.pending ? " dg-pending" : ""}${d.missing ? " dg-missing" : ""}${d.selected ? " dg-selected" : ""}`}
    >
      <CenterHandles />
      <div className="dg-block-head">
        {d.variant === "ground" && <GroundSymbol />}
        {/* El nombre es lo que se lee en la mesa; el ID va debajo (Martin). */}
        <span className={d.subtitle ? "dg-title" : "dg-id"}>{d.subtitle || d.title}</span>
        {d.gender && (
          <span className={`dg-gender dg-gender-${d.gender}`} title={d.gender === "M" ? "Male" : d.gender === "F" ? "Female" : "Gender unknown (no ConnectorDef in library)"}>
            {d.gender}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <IssueDot issue={d.issue} />
      </div>
      {d.subtitle && <div className="dg-name dg-name-id">{d.title}</div>}
      {d.distanceLabel && <div className="dg-distance">{d.distanceLabel}</div>}
      {(d.pending || d.missing || d.isMain || d.notes.length > 0) && (
        <div className="dg-tags">
          {d.missing && <span className="dg-tag">{d.missing}</span>}
          {d.isMain && <span className="dg-tag">main</span>}
          {d.pending && <span className="dg-tag dg-tag-warning">pending</span>}
          {d.notes.map((n) => (
            <span key={n} className="dg-tag">{n}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function GroundSymbol() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <line x1="6" y1="0" x2="6" y2="5" />
      <line x1="1" y1="5" x2="11" y2="5" />
      <line x1="3" y1="8" x2="9" y2="8" />
      <line x1="5" y1="11" x2="7" y2="11" />
    </svg>
  );
}

function SegmentEdge({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<Edge<SegmentEdgeData>>) {
  const [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const d = data!;
  const strong = d.selected || d.highlight !== "none";
  const stroke = strong ? "var(--accent)" : "var(--text-muted)";
  const strokeWidth = d.highlight === "wire" || d.selected ? 4 : d.highlight === "net" ? 3 : 2;
  const [editing, setEditing] = useState(false);
  // Enter o perder el foco confirman; un largo no válido (vacío, 0) se descarta.
  function commitLength(text: string) {
    if (!editing) return;
    const mm = Number(text);
    if (mm > 0 && mm !== d.lengthMm) d.onLengthChange(mm);
    setEditing(false);
  }
  const labelStyle = { transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` };
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke, strokeWidth }} interactionWidth={16} />
      <EdgeLabelRenderer>
        {editing ? (
          <input
            className="dg-edge-input nodrag nopan"
            style={labelStyle}
            type="number"
            min={1}
            defaultValue={d.lengthMm}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => commitLength(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitLength(e.currentTarget.value);
              if (e.key === "Escape") setEditing(false);
              e.stopPropagation();
            }}
            aria-label="Segment length (mm)"
          />
        ) : (
          <div className="dg-edge-label-group nodrag nopan" style={labelStyle}>
            <button
              className={`dg-edge-label${d.selected ? " dg-edge-label-selected" : ""}`}
              onClick={d.onSelect}
              onDoubleClick={() => setEditing(true)}
              title="Double-click to edit the length"
            >
              <IssueDot issue={d.issue} />
              {d.label}
              {d.diameter && <span className="dg-muted"> · Ø{d.diameter}</span>}
            </button>
            {d.selected && (
              // stopPropagation: el label vive en otra capa (portal), pero el click igual
              // sube por React hasta el segmento, que lo volvería a seleccionar.
              <button
                className="dg-edge-action"
                onClick={(e) => {
                  e.stopPropagation();
                  d.onSplit();
                }}
                title="Split this segment in two with a breakout in the middle"
              >
                + breakout
              </button>
            )}
          </div>
        )}
        {d.markers.map((m) => (
          <div
            key={m.label}
            className="dg-marker"
            style={{
              transform: `translate(-50%, -50%) translate(${sourceX + (targetX - sourceX) * m.t}px, ${sourceY + (targetY - sourceY) * m.t}px)`,
            }}
          >
            <span className="dg-marker-dot" />
            <span className="dg-marker-label">{m.label}</span>
          </div>
        ))}
      </EdgeLabelRenderer>
    </>
  );
}

export const nodeTypes = { harness: HarnessNode };
export const edgeTypes = { segment: SegmentEdge };
