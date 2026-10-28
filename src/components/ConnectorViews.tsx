import type { Library } from "../model/library";
import { IMAGE_VIEWS, useConnectorImage, useImageViews, type ImageView } from "../platform/connectorImages";
import { ConnectorFaceView } from "./ConnectorFaceView";

/**
 * Cara dibujada del conector (con las vías usadas resaltadas) y las imágenes
 * cargadas en la biblioteca para su parte (frontal primero).
 */
export function ConnectorViews({ library, partId, only, used }: { library: Library; partId: number; only?: ImageView; used?: Set<string> }) {
  const def = library.connector_defs.find((d) => d.part_id === partId);
  const present = useImageViews(partId);
  if (!def) return null;
  return (
    <div className="connector-views">
      <ConnectorFaceView def={def} used={used} />
      {IMAGE_VIEWS.filter((v) => (!only || v.view === only) && present.includes(v.view)).map(({ view, label }) => (
        <ConnectorPhoto key={view} partId={partId} view={view} label={label} />
      ))}
    </div>
  );
}

function ConnectorPhoto({ partId, view, label }: { partId: number; view: ImageView; label: string }) {
  const src = useConnectorImage(partId, view);
  return (
    <figure>
      {src ? <img src={src} alt={`${label} view`} /> : <span className="hint">…</span>}
      <figcaption className="field-label">{label} view</figcaption>
    </figure>
  );
}
