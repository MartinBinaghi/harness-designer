import { choiceKey, connectorChoices, partLabel, type ConnectorChoice, type Library } from "../model/library";

/**
 * Parte de un conector del proyecto: los conectores de dispositivos (PDM30 · A,
 * con los nombres de sus pines) y las carcasas de la biblioteca.
 */
export function ConnectorPartSelect({ library, partId, deviceConnectorId, onChange, placeholder, className }: {
  library: Library;
  partId: number | null;
  deviceConnectorId: number | null;
  onChange: (choice: ConnectorChoice) => void;
  placeholder?: string;
  className?: string;
}) {
  const choices = connectorChoices(library);
  const value = partId == null ? "" : choiceKey(partId, deviceConnectorId);
  const group = (devices: boolean) =>
    choices.filter((c) => (c.deviceConnectorId != null) === devices).map((c) => <option key={c.key} value={c.key}>{c.label}</option>);
  return (
    <select
      className={className}
      value={value}
      onChange={(e) => {
        const choice = choices.find((c) => c.key === e.currentTarget.value);
        if (choice) onChange(choice);
      }}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {value && !choices.some((c) => c.key === value) && <option value={value}>{partLabel(library, partId)} (missing)</option>}
      {library.device_defs.length > 0 && <optgroup label="Device connectors">{group(true)}</optgroup>}
      <optgroup label="Connectors">{group(false)}</optgroup>
    </select>
  );
}
