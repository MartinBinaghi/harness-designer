-- Biblioteca de partes (separada de los proyectos). Ver ../../CLAUDE.md sección 4.1.
-- Etapa 4: se agregan CoveringDef (termocontraíble/sleeving) y AccessoryDef de tipo
-- boot. Molde en T (breakout) queda para más adelante — ver docs/BITACORA.md.

CREATE TABLE IF NOT EXISTS parts (
    id              INTEGER PRIMARY KEY,
    part_number     TEXT NOT NULL,
    manufacturer    TEXT,
    description     TEXT,
    category        TEXT NOT NULL CHECK (category IN (
                        'connector', 'device', 'contact', 'seal_plug',
                        'wire', 'splice', 'component', 'covering', 'accessory'
                    )),
    purchase_unit   TEXT NOT NULL CHECK (purchase_unit IN ('unit', 'meter')),
    qty_per_pack    REAL NOT NULL DEFAULT 1,
    price_usd       REAL,
    price_date      TEXT
);

CREATE TABLE IF NOT EXISTS connector_defs (
    part_id                 INTEGER PRIMARY KEY REFERENCES parts(id) ON DELETE CASCADE,
    gender                  TEXT NOT NULL CHECK (gender IN ('male', 'female')),
    series                  TEXT,
    shell_size              TEXT,
    counterpart_id          INTEGER REFERENCES connector_defs(part_id),
    -- parte trasera (por donde tiene que pasar el termo con adhesivo):
    -- redonda -> back_diameter_mm; rectangular -> back_width_mm x back_height_mm
    back_shape              TEXT CHECK (back_shape IN ('round', 'rectangular')),
    back_diameter_mm        REAL,
    back_width_mm           REAL,
    back_height_mm          REAL,
    suggested_termination   TEXT CHECK (suggested_termination IN ('boot', 'adhesive_heatshrink', 'none')),
    -- contacto de cada vía con cable y tapón de las vías sin usar (uno por
    -- conector); sin FK: si se borra la parte, Checks avisa que falta
    contact_part_id         INTEGER,
    seal_plug_part_id       INTEGER,
    -- largo de la pieza de termo con adhesivo detrás del conector (mm)
    adhesive_heatshrink_length_mm REAL
);

-- Cavidades: identificador tal cual el fabricante (1, 2... / A, B... / a, b...),
-- distinguiendo mayúsculas y minúsculas.
CREATE TABLE IF NOT EXISTS connector_def_cavities (
    connector_def_id   INTEGER NOT NULL REFERENCES connector_defs(part_id) ON DELETE CASCADE,
    cavity_id           TEXT NOT NULL,
    contact_size         TEXT NOT NULL,
    PRIMARY KEY (connector_def_id, cavity_id)
);

CREATE TABLE IF NOT EXISTS device_defs (
    part_id     INTEGER PRIMARY KEY REFERENCES parts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS device_def_connectors (
    id                  INTEGER PRIMARY KEY,
    device_def_id       INTEGER NOT NULL REFERENCES device_defs(part_id) ON DELETE CASCADE,
    label               TEXT NOT NULL,
    connector_def_id    INTEGER NOT NULL REFERENCES connector_defs(part_id),
    UNIQUE (device_def_id, label)
);

CREATE TABLE IF NOT EXISTS device_def_pins (
    id                          INTEGER PRIMARY KEY,
    device_def_connector_id     INTEGER NOT NULL REFERENCES device_def_connectors(id) ON DELETE CASCADE,
    cavity_id                   TEXT NOT NULL,
    name                        TEXT NOT NULL,
    function                    TEXT,
    UNIQUE (device_def_connector_id, cavity_id)
);

CREATE TABLE IF NOT EXISTS contact_defs (
    part_id         INTEGER PRIMARY KEY REFERENCES parts(id) ON DELETE CASCADE,
    gender          TEXT NOT NULL CHECK (gender IN ('male', 'female')),
    contact_size    TEXT NOT NULL,
    gauge_min       TEXT,
    gauge_max       TEXT
);

CREATE TABLE IF NOT EXISTS seal_plug_defs (
    part_id         INTEGER PRIMARY KEY REFERENCES parts(id) ON DELETE CASCADE,
    contact_size    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wire_defs (
    part_id                 INTEGER PRIMARY KEY REFERENCES parts(id) ON DELETE CASCADE,
    gauge                   TEXT NOT NULL,
    spec                    TEXT,
    color                   TEXT,
    outer_diameter_mm       REAL NOT NULL,
    default_cut_margin_pct  REAL
);

-- Conductores internos de un cable multiconductor comprado (par trenzado, apantallado).
CREATE TABLE IF NOT EXISTS wire_def_conductors (
    id             INTEGER PRIMARY KEY,
    wire_def_id    INTEGER NOT NULL REFERENCES wire_defs(part_id) ON DELETE CASCADE,
    label          TEXT,
    gauge          TEXT,
    color          TEXT,
    is_shield      INTEGER NOT NULL DEFAULT 0 CHECK (is_shield IN (0, 1))
);

CREATE TABLE IF NOT EXISTS splice_defs (
    part_id     INTEGER PRIMARY KEY REFERENCES parts(id) ON DELETE CASCADE,
    gauge_min   TEXT,
    gauge_max   TEXT,
    max_wires   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS component_defs (
    part_id             INTEGER PRIMARY KEY REFERENCES parts(id) ON DELETE CASCADE,
    component_type      TEXT NOT NULL,
    value                TEXT,
    package             TEXT
);

-- Termocontraíble/sleeving (normalmente Raychem). Ver CLAUDE.md sección 4.1 y 9.2.
CREATE TABLE IF NOT EXISTS covering_defs (
    part_id                     INTEGER PRIMARY KEY REFERENCES parts(id) ON DELETE CASCADE,
    supplied_diameter_mm        REAL NOT NULL,
    shrunk_diameter_mm          REAL NOT NULL,
    shrunk_wall_thickness_mm    REAL NOT NULL,
    has_adhesive                INTEGER NOT NULL DEFAULT 0 CHECK (has_adhesive IN (0, 1))
);

-- Molde en T (transición de breakout, 3 patas). Ver CLAUDE.md sección 4.1 y 9.4.
-- "Otros" accesorios (backshells, etiquetas) quedan para cuando haya lógica de
-- calce para ellos.
CREATE TABLE IF NOT EXISTS t_mold_defs (
    part_id     INTEGER PRIMARY KEY REFERENCES parts(id) ON DELETE CASCADE,
    overlap_mm  REAL NOT NULL
);

-- Las 3 patas de un molde en T, sin orden semántico fijo (no hay una pata
-- "de entrada" distinguida en el catálogo): se emparejan con los segmentos
-- del breakout por tamaño al calcular el calce (ver calc::t_mold_fit).
CREATE TABLE IF NOT EXISTS t_mold_def_legs (
    t_mold_def_id       INTEGER NOT NULL REFERENCES t_mold_defs(part_id) ON DELETE CASCADE,
    position            INTEGER NOT NULL CHECK (position IN (0, 1, 2)),
    min_diameter_mm     REAL NOT NULL,
    max_diameter_mm     REAL NOT NULL,
    leg_length_mm       REAL NOT NULL,
    PRIMARY KEY (t_mold_def_id, position)
);

-- Boots (recto/90°). Ver CLAUDE.md sección 4.1 y 9.3. "Otros" accesorios
-- (backshells, etiquetas) quedan para cuando haya lógica de calce para ellos.
CREATE TABLE IF NOT EXISTS accessory_defs (
    part_id                     INTEGER PRIMARY KEY REFERENCES parts(id) ON DELETE CASCADE,
    orientation                 TEXT NOT NULL CHECK (orientation IN ('straight', 'right_angle')),
    cable_side_min_diameter_mm  REAL NOT NULL,
    cable_side_max_diameter_mm  REAL NOT NULL,
    leg_length_mm               REAL NOT NULL,
    overlap_mm                  REAL NOT NULL
);

-- Conectores compatibles con un boot: por serie + tamaño de carcasa del ConnectorDef.
CREATE TABLE IF NOT EXISTS accessory_def_connector_matches (
    accessory_def_id    INTEGER NOT NULL REFERENCES accessory_defs(part_id) ON DELETE CASCADE,
    series              TEXT NOT NULL,
    shell_size          TEXT NOT NULL,
    PRIMARY KEY (accessory_def_id, series, shell_size)
);

CREATE TABLE IF NOT EXISTS signal_types (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    default_color   TEXT NOT NULL
);

-- Fotos de los conectores (vista frontal con la numeración, lateral, trasera)
-- como data URL, achicadas a 800 px. Aparte de las fichas: no viajan con cada
-- edición de la biblioteca ni se reescriben al guardarla (ver lib.rs). Sin FK
-- a connector_defs a propósito: guardar una ficha la borra y la vuelve a
-- insertar, y una cascada se llevaría sus fotos; las que quedan sin conector
-- se limpian al abrir la biblioteca.
CREATE TABLE IF NOT EXISTS connector_def_images (
    part_id     INTEGER NOT NULL,
    view        TEXT NOT NULL CHECK (view IN ('front', 'side', 'back')),
    data        TEXT NOT NULL,
    PRIMARY KEY (part_id, view)
);
