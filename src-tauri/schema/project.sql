-- Datos de un proyecto (= un arnés). Ver ../../CLAUDE.md sección 4.2.
-- Los *_library_part_id referencian filas de la biblioteca (archivo separado,
-- ver library.sql); SQLite no valida foreign keys entre archivos, la
-- integridad se resuelve en la capa de aplicación.

CREATE TABLE IF NOT EXISTS project (
    id                          INTEGER PRIMARY KEY CHECK (id = 1),
    name                        TEXT NOT NULL,
    harness_code                TEXT NOT NULL,
    client                      TEXT,
    revision                    TEXT,
    main_connector_instance_id  INTEGER,
    markup_pct                  REAL NOT NULL DEFAULT 0,
    default_cut_margin_pct      REAL NOT NULL DEFAULT 10,
    default_twist_pitch_factor  REAL NOT NULL DEFAULT 8,
    fill_factor                 REAL NOT NULL DEFAULT 0.75,
    labor_hours                 REAL NOT NULL DEFAULT 0,
    labor_rate_usd              REAL NOT NULL DEFAULT 0,
    -- materiales sobre lo comprado (packs completos) en vez de lo usado
    cost_on_purchased           INTEGER NOT NULL DEFAULT 0,
    -- repuesto por categoría de parte, JSON {"contact": 10, ...} (%)
    spare_pcts                  TEXT NOT NULL DEFAULT '{}',
    -- largos de corte redondeados hacia arriba a este múltiplo (mm); NULL = sin redondeo
    cut_round_mm                REAL
);

CREATE TABLE IF NOT EXISTS nodes (
    id                          INTEGER PRIMARY KEY,
    kind                        TEXT NOT NULL CHECK (kind IN ('connector_end', 'breakout', 'splice_point', 'ground_point')),
    -- terminación solo aplica a breakouts
    termination                 TEXT CHECK (termination IN ('t_mold', 'adhesive_heatshrink', 'none')),
    -- t_mold_defs si termination = 't_mold', covering_defs si 'adhesive_heatshrink'
    termination_library_part_id INTEGER,
    -- posición en el diagrama de armado (no escalado); NULL hasta acomodarlo
    diagram_x                   REAL,
    diagram_y                   REAL,
    -- largo de la pieza de termo con adhesivo sobre el breakout (mm; solo para BOM/costo)
    adhesive_heatshrink_length_mm REAL
);

CREATE TABLE IF NOT EXISTS segments (
    id                          INTEGER PRIMARY KEY,
    node_a_id                   INTEGER NOT NULL REFERENCES nodes(id),
    node_b_id                   INTEGER NOT NULL REFERENCES nodes(id),
    length_mm                   REAL NOT NULL,
    twist_pitch_mm              REAL,
    covering_library_part_id    INTEGER
);

CREATE TABLE IF NOT EXISTS connector_instances (
    id                          INTEGER PRIMARY KEY,
    short_id                    TEXT NOT NULL UNIQUE,
    name                        TEXT NOT NULL,
    library_part_id             INTEGER NOT NULL,
    -- conector de un dispositivo de la biblioteca (device_def_connectors.id): nombres de pin
    device_connector_id         INTEGER,
    node_id                     INTEGER NOT NULL REFERENCES nodes(id),
    termination                 TEXT CHECK (termination IN ('boot_straight', 'boot_90', 'adhesive_heatshrink', 'none')),
    -- accessory_defs si termination es boot_straight/boot_90, covering_defs si es adhesive_heatshrink
    termination_library_part_id INTEGER,
    backshell_library_part_id   INTEGER,
    status                      TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('complete', 'pending')),
    is_interconnect             INTEGER NOT NULL DEFAULT 0 CHECK (is_interconnect IN (0, 1)),
    mates_with                  TEXT
);

CREATE TABLE IF NOT EXISTS cavity_assignments (
    id                          INTEGER PRIMARY KEY,
    connector_instance_id       INTEGER NOT NULL REFERENCES connector_instances(id) ON DELETE CASCADE,
    cavity_id                   TEXT NOT NULL,
    -- contacto y tapón: del connector_def de la biblioteca, no por vía
    external_reference          TEXT,
    UNIQUE (connector_instance_id, cavity_id)
);

CREATE TABLE IF NOT EXISTS ground_points (
    id                          INTEGER PRIMARY KEY,
    short_id                    TEXT NOT NULL UNIQUE,
    name                        TEXT NOT NULL,
    terminal_library_part_id    INTEGER,
    node_id                     INTEGER NOT NULL REFERENCES nodes(id)
);

CREATE TABLE IF NOT EXISTS splice_instances (
    id                      INTEGER PRIMARY KEY,
    short_id                TEXT NOT NULL UNIQUE,
    library_part_id         INTEGER NOT NULL,
    node_id                 INTEGER REFERENCES nodes(id),
    segment_id              INTEGER REFERENCES segments(id),
    offset_from_end_mm      REAL,
    offset_from_node_id     INTEGER REFERENCES nodes(id),
    name                    TEXT NOT NULL DEFAULT '',
    CHECK (
        (node_id IS NOT NULL AND segment_id IS NULL)
        OR (node_id IS NULL AND segment_id IS NOT NULL)
    )
);

-- Ubicación física, mismo patrón que splice_instances: en un nodo, o sobre un
-- segmento a X mm de uno de sus extremos.
CREATE TABLE IF NOT EXISTS component_instances (
    id                  INTEGER PRIMARY KEY,
    short_id             TEXT NOT NULL UNIQUE,
    name                 TEXT NOT NULL,
    library_part_id      INTEGER NOT NULL,
    node_id              INTEGER REFERENCES nodes(id),
    segment_id           INTEGER REFERENCES segments(id),
    offset_from_end_mm   REAL,
    offset_from_node_id  INTEGER REFERENCES nodes(id),
    CHECK (
        (node_id IS NOT NULL AND segment_id IS NULL)
        OR (node_id IS NULL AND segment_id IS NOT NULL)
    )
);

-- Cada extremo de cable apunta a UNA ubicación (cavidad, splice, masa o componente),
-- según end_x_kind.
CREATE TABLE IF NOT EXISTS wire_instances (
    id                              INTEGER PRIMARY KEY,
    short_id                        TEXT NOT NULL UNIQUE,
    library_part_id                 INTEGER NOT NULL,
    color                            TEXT,
    signal_type_id                   INTEGER,
    specific_name                    TEXT,
    manual_cut_margin_pct            REAL,
    manual_length_mm                 REAL,   -- largo de corte a mano: manda sobre el calculado
    label                            TEXT,

    end_a_kind                       TEXT NOT NULL CHECK (end_a_kind IN ('cavity', 'splice', 'ground', 'component')),
    end_a_cavity_assignment_id       INTEGER REFERENCES cavity_assignments(id),
    end_a_splice_id                  INTEGER REFERENCES splice_instances(id),
    end_a_ground_point_id            INTEGER REFERENCES ground_points(id),
    end_a_component_instance_id      INTEGER REFERENCES component_instances(id),

    end_b_kind                       TEXT NOT NULL CHECK (end_b_kind IN ('cavity', 'splice', 'ground', 'component')),
    end_b_cavity_assignment_id       INTEGER REFERENCES cavity_assignments(id),
    end_b_splice_id                  INTEGER REFERENCES splice_instances(id),
    end_b_ground_point_id            INTEGER REFERENCES ground_points(id),
    end_b_component_instance_id      INTEGER REFERENCES component_instances(id)
);

CREATE TABLE IF NOT EXISTS twist_groups (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    shielded    INTEGER NOT NULL DEFAULT 0 CHECK (shielded IN (0, 1)),
    drain       INTEGER NOT NULL DEFAULT 0 CHECK (drain IN (0, 1))
);

CREATE TABLE IF NOT EXISTS twist_group_wires (
    twist_group_id      INTEGER NOT NULL REFERENCES twist_groups(id) ON DELETE CASCADE,
    wire_instance_id     INTEGER NOT NULL REFERENCES wire_instances(id) ON DELETE CASCADE,
    PRIMARY KEY (twist_group_id, wire_instance_id)
);
