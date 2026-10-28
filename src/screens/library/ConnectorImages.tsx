import { useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { readImageAsDataUrl } from "../../platform/imageFile";
import { IMAGE_VIEWS, setConnectorImage, useConnectorImage, type ImageView } from "../../platform/connectorImages";

/**
 * Fotos del conector (frontal con numeración de pines, lateral, trasera): se
 * achican (ver imageFile.ts) y se guardan en el archivo de la biblioteca, aparte
 * de la ficha (ver connectorImages.ts). No entran en deshacer, como un adjunto.
 */
export function ConnectorImages({ partId }: { partId: number }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="connector-images">
      <div className="connector-images-row">
        {IMAGE_VIEWS.map(({ view, label }) => (
          <ImageSlot key={view} partId={partId} view={view} label={label} onError={setError} />
        ))}
      </div>
      {error && <p className="diagram-notice">{error}</p>}
    </div>
  );
}

function ImageSlot({ partId, view, label, onError }: { partId: number; view: ImageView; label: string; onError: (e: string | null) => void }) {
  const src = useConnectorImage(partId, view);
  async function load(file: File | undefined) {
    if (!file) return;
    try {
      onError(null);
      await setConnectorImage(partId, view, await readImageAsDataUrl(file));
    } catch (e) {
      onError(`Couldn't load ${file.name}: ${String(e)}`);
    }
  }
  async function remove() {
    if (!(await ask(`Remove the ${label.toLowerCase()} photo? This can't be undone.`, { kind: "warning" }))) return;
    try {
      onError(null);
      await setConnectorImage(partId, view, null);
    } catch (e) {
      onError(`Couldn't remove the photo: ${String(e)}`);
    }
  }
  return (
    <div className="connector-image-slot">
      <div className="connector-image-box">
        {src ? <img src={src} alt={`${label} view`} /> : <span className="hint">{src === undefined ? "…" : "no image"}</span>}
      </div>
      <div className="connector-image-actions">
        <span>{label}</span>
        <label className="link-button">
          {src ? "Replace…" : "Load…"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
            hidden
            onChange={(e) => {
              void load(e.currentTarget.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
        </label>
        {src && (
          <button className="link-button" onClick={() => void remove()}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
