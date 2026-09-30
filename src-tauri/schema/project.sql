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
    format_version              INTEGER NOT NULL,
    main_connector_instance_id  INTEGER,
    markup_pct                  REAL NOT NULL DEFAULT 0,
    default_cut_margin_pct      REAL NOT NULL DEFAULT 10,
    default_twist_pitch_factor  REAL NOT NULL DEFAULT 8,
    fill_factor                 REAL NOT NULL DEFAULT 0.75,
    labor_hours                 REAL NOT NULL DEFAULT 0,
    labor_rate_usd              REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS device_instances (
    id                  INTEGER PRIMARY KEY,
    name                TEXT NOT NULL,
    library_part_id     INTEGER
);

CREATE TABLE IF NOT EXISTS nodes (
    id                          INTEGER PRIMARY KEY,
    kind                        TEXT NOT NULL CHECK (kind IN ('connector_end', 'breakout', 'splice_point', 'ground_point')),
    -- terminación solo aplica a breakouts
    termination                 TEXT CHECK (termination IN ('t_mold', 'adhesive_heatshrink', 'none')),
    -- solo tiene sentido con termination = 'adhesive_heatshrink' (covering_defs);
    -- 't_mold' todavía no elige una parte específica de biblioteca.
    termination_library_part_id INTEGER
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
    device_instance_id          INTEGER REFERENCES device_instances(id),
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
    contact_library_part_id     INTEGER,
    seal_plug_library_part_id   INTEGER,
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
