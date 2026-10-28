//! Los datos de la biblioteca base: familias, carcasas, cables y termos, tal cual el catálogo.

pub(super) struct Family {
    pub(super) manufacturer: &'static str,
    pub(super) series: &'static str,
    pub(super) contact_size: &'static str,
    pub(super) suggested_termination: Option<&'static str>,
    /// (vías, carcasa con pines = macho, carcasa con sockets = hembra)
    pub(super) members: &'static [(usize, &'static str, &'static str)],
    pub(super) male_kind: &'static str,
    pub(super) female_kind: &'static str,
    /// Contacto sólido de la familia (pin, socket, calibre mín., calibre máx.) y tapón de
    /// la familia; un solo contacto por familia (plan 4.1).
    pub(super) contacts: Option<(&'static str, &'static str, &'static str, &'static str)>,
    pub(super) seal_plug: Option<&'static str>,
}

pub(super) const FAMILIES: &[Family] = &[
    Family {
        manufacturer: "TE / Deutsch",
        series: "DT",
        contact_size: "16",
        suggested_termination: Some("adhesive_heatshrink"),
        members: &[
            (2, "DT04-2P", "DT06-2S"),
            (3, "DT04-3P", "DT06-3S"),
            (4, "DT04-4P", "DT06-4S"),
            (6, "DT04-6P", "DT06-6S"),
            (8, "DT04-08PA", "DT06-08SA"),
            (12, "DT04-12PA", "DT06-12SA"),
        ],
        male_kind: "receptacle, pin contacts",
        female_kind: "plug, socket contacts",
        contacts: Some(("0460-202-16141", "0462-201-16141", "20 AWG", "16 AWG")),
        seal_plug: Some("0413-217-1605"),
    },
    Family {
        manufacturer: "TE / Deutsch",
        series: "DTM",
        contact_size: "20",
        suggested_termination: Some("adhesive_heatshrink"),
        members: &[
            (2, "DTM04-2P", "DTM06-2S"),
            (3, "DTM04-3P", "DTM06-3S"),
            (4, "DTM04-4P", "DTM06-4S"),
            (6, "DTM04-6P", "DTM06-6S"),
            (8, "DTM04-08PA", "DTM06-08SA"),
            (12, "DTM04-12PA", "DTM06-12SA"),
        ],
        male_kind: "receptacle, pin contacts",
        female_kind: "plug, socket contacts",
        contacts: Some(("0460-202-20141", "0462-201-20141", "24 AWG", "20 AWG")),
        seal_plug: Some("0413-204-2005"),
    },
    Family {
        manufacturer: "TE / Deutsch",
        series: "DTP",
        contact_size: "12",
        suggested_termination: Some("adhesive_heatshrink"),
        members: &[(2, "DTP04-2P", "DTP06-2S"), (4, "DTP04-4P", "DTP06-4S")],
        male_kind: "receptacle, pin contacts",
        female_kind: "plug, socket contacts",
        contacts: Some(("0460-204-12141", "0462-203-12141", "14 AWG", "12 AWG")),
        seal_plug: Some("0413-003-1205"),
    },
    Family {
        manufacturer: "TE",
        series: "Superseal 1.5",
        contact_size: "1.5",
        suggested_termination: None,
        members: &[
            (2, "282104-1", "282080-1"),
            (3, "282105-1", "282087-1"),
            (4, "282106-1", "282088-1"),
            (5, "282107-1", "282089-1"),
            (6, "282108-1", "282090-1"),
        ],
        male_kind: "tab housing",
        female_kind: "receptacle housing",
        // Superseal: terminales y sellos individuales todavía sin cargar.
        contacts: None,
        seal_plug: None,
    },
];

/// Carcasas sueltas, sin contraparte en la base: el AMP Superseal 1.0 hembra
/// que enchufa en el MoTeC PDM30 (A 34 vías, B 26) y la línea M1; el macho va
/// en el dispositivo. (número de parte, vías, uso).
pub(super) const SUPERSEAL_10: &[(&str, usize, &str)] = &[
    ("3-1437290-7", 26, "mates MoTeC PDM30 B / M1 26-pin"),
    ("4-1437290-0", 34, "mates MoTeC PDM30 A / M1 34-pin"),
];

/// Pines hembra (sockets) Superseal 1.0: número de parte y rango de calibre.
/// El de 20 AWG es el de las carcasas; con otro calibre, contacts.rs elige el
/// que corresponde (mismo tamaño y género).
pub(super) const SUPERSEAL_10_SOCKETS: &[(&str, &str, &str)] = &[
    ("3-1447221-4", "20 AWG", "20 AWG"),
    ("3-1447221-5", "22 AWG", "22 AWG"),
    ("3-1447221-3", "18 AWG", "16 AWG"),
];
pub(super) const SUPERSEAL_10_CAVITY_PLUG: &str = "4-1437284-3";

/// Otras carcasas sueltas del lado del arnés (pedidos de Martin, 2026-10-15
/// y 2026-10-21), sin contraparte en la base. Las VAG del arnés son macho
/// (Martin). Las que el taller nombra por su planilla (Mini Timer, "ORIGINAL")
/// van con ese nombre hasta tener el número de parte real.
pub(super) struct Housing {
    pub(super) part_number: &'static str,
    pub(super) manufacturer: &'static str,
    pub(super) series: &'static str,
    pub(super) gender: &'static str,
    pub(super) contact_size: &'static str,
    pub(super) shell_size: Option<&'static str>,
    pub(super) suggested_termination: Option<&'static str>,
    pub(super) cavities: &'static [&'static str],
    pub(super) description: &'static str,
    /// Contacto (número de parte, calibre mín., calibre máx.) y tapón, si se conocen.
    pub(super) contact: Option<(&'static str, &'static str, &'static str)>,
    pub(super) seal_plug: Option<&'static str>,
}

/// Vías del inserto 24-61 de MIL-DTL-26482 Serie 2 (mismas letras que el 25-61
/// de MIL-STD-1560, confirmado con fotos del MS3476L24-61P).
const MIL_61: &[&str] = &[
    "A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "R", "S", "T", "U", "V",
    "W", "X", "Y", "Z", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "m", "n", "p", "q",
    "r", "s", "t", "u", "v", "w", "x", "y", "z", "AA", "BB", "CC", "DD", "EE", "FF", "GG", "HH",
    "JJ", "KK", "LL", "MM", "NN", "PP",
];

pub(super) const OTHER_HOUSINGS: &[Housing] = &[
    Housing {
        part_number: "1J0 973 724",
        manufacturer: "VAG",
        series: "VAG",
        gender: "male",
        contact_size: "Mini Timer",
        shell_size: None,
        suggested_termination: None,
        cavities: &["1", "2", "3", "4"],
        description: "VAG 4-way ignition coil connector (Audi/VW coils)",
        contact: None,
        seal_plug: None,
    },
    Housing {
        part_number: "1J0 973 733",
        manufacturer: "VAG",
        series: "VAG",
        gender: "male",
        contact_size: "Micro Timer",
        shell_size: None,
        suggested_termination: None,
        cavities: &["1", "2", "3", "4", "5", "6"],
        description: "VAG 6-way connector, mates Bosch LSU 4.9 lambda sensor",
        contact: None,
        seal_plug: None,
    },
    Housing {
        part_number: "SMPW-K-F",
        manufacturer: "Omega",
        series: "Mini thermocouple K",
        gender: "female",
        contact_size: "K",
        shell_size: None,
        suggested_termination: None,
        cavities: &["+", "-"],
        description: "Miniature type K thermocouple socket (yellow); the wider blade is negative",
        contact: None,
        seal_plug: None,
    },
    Housing {
        part_number: "MS3476L24-61P",
        manufacturer: "MIL-DTL-26482",
        series: "MIL-DTL-26482 II",
        gender: "male",
        contact_size: "20",
        shell_size: Some("24"),
        suggested_termination: Some("boot"),
        cavities: MIL_61,
        description: "MIL-DTL-26482 Series 2 bayonet plug, shell 24, 61 × size 20 pin contacts",
        contact: Some(("M39029/58-360", "24 AWG", "20 AWG")),
        seal_plug: Some("MS27488-20"),
    },
    Housing {
        part_number: "MINI TYMER 02W-F",
        manufacturer: "—",
        series: "Mini Timer",
        gender: "female",
        contact_size: "Mini Timer",
        shell_size: None,
        suggested_termination: None,
        cavities: &["1", "2"],
        description: "Mini Timer 2-way female (name as in the workshop sheet; real part number to confirm)",
        contact: None,
        seal_plug: None,
    },
    Housing {
        part_number: "ORIGINAL 03W_F",
        manufacturer: "—",
        series: "Mini Timer",
        gender: "female",
        contact_size: "Mini Timer",
        shell_size: None,
        suggested_termination: None,
        cavities: &["A", "B", "C"],
        description: "3-way female, the sensor's original connector with Mini Timer terminals, A on the left (name as in the workshop sheet; part to confirm)",
        contact: None,
        seal_plug: None,
    },
    Housing {
        part_number: "OJAL 16mm2 M6",
        manufacturer: "—",
        series: "Ring terminal",
        gender: "male",
        contact_size: "16 mm²",
        shell_size: Some("M6"),
        suggested_termination: Some("none"),
        cavities: &["1"],
        description: "Ring terminal (ojal) for 16 mm² wire, 6 mm hole (M6)",
        contact: None,
        seal_plug: None,
    },
];

/// M22759/32 (Raychem Spec 55, ETFE liviano, 150 °C, 600 V): calibre AWG y
/// diámetro exterior nominal en pulgadas, de la hoja de la norma.
pub(super) const M22759_32: &[(u32, f64)] = &[
    (26, 0.032),
    (24, 0.037),
    (22, 0.043),
    (20, 0.050),
    (18, 0.060),
    (16, 0.068),
    (14, 0.085),
    (12, 0.103),
];

/// Raychem DR-25 (2:1, sin adhesivo): medida nominal, suministrado mín.,
/// contraído máx. y pared contraída, en pulgadas.
pub(super) const DR_25: &[(&str, f64, f64, f64)] = &[
    ("1/8", 0.125, 0.063, 0.020),
    ("3/16", 0.187, 0.093, 0.020),
    ("1/4", 0.250, 0.125, 0.025),
    ("3/8", 0.375, 0.187, 0.025),
    ("1/2", 0.500, 0.250, 0.030),
    ("3/4", 0.750, 0.375, 0.035),
    ("1", 1.000, 0.500, 0.040),
];

/// Raychem ATUM (3:1, con adhesivo), para la pieza que pasa por detrás del
/// conector: suministrado / contraído en mm (van en el nombre) y pared
/// contraída aproximada (camisa + adhesivo).
pub(super) const ATUM: &[(f64, f64, f64)] = &[
    (6.0, 2.0, 1.0),
    (12.0, 4.0, 1.6),
    (19.0, 6.0, 1.9),
    (24.0, 8.0, 2.2),
    (40.0, 13.0, 2.5),
];
