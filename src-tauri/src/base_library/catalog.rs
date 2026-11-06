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
    /// Contacto de la familia (pin y socket) y tapón; un solo contacto por familia (plan 4.1).
    pub(super) contacts: Option<FamilyContacts>,
    pub(super) seal_plug: Option<&'static str>,
}

pub(super) struct FamilyContacts {
    pub(super) pin: &'static str,
    pub(super) socket: &'static str,
    /// Cómo está hecho ("solid", "stamped"): Deutsch vende los dos con distinto número.
    pub(super) kind: &'static str,
    pub(super) gauge_min: &'static str,
    pub(super) gauge_max: &'static str,
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
        contacts: Some(FamilyContacts {
            pin: "0460-202-16141",
            socket: "0462-201-16141",
            kind: "solid",
            gauge_min: "20 AWG",
            gauge_max: "16 AWG",
        }),
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
        contacts: Some(FamilyContacts {
            pin: "0460-202-20141",
            socket: "0462-201-20141",
            kind: "solid",
            gauge_min: "24 AWG",
            gauge_max: "20 AWG",
        }),
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
        contacts: Some(FamilyContacts {
            pin: "0460-204-12141",
            socket: "0462-203-12141",
            kind: "solid",
            gauge_min: "14 AWG",
            gauge_max: "12 AWG",
        }),
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
        // Terminales de 0,35–0,5 mm² (TE); los sellos de cable no están en el modelo.
        contacts: Some(FamilyContacts {
            pin: "282404-1",
            socket: "282403-1",
            kind: "stamped",
            gauge_min: "22 AWG",
            gauge_max: "20 AWG",
        }),
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
/// y 2026-10-21), sin contraparte en la base. Las VAG del arnés son hembra
/// (con terminales hembra; el macho va en la bobina o la sonda). Las que el taller nombra por su planilla (Mini Timer, "ORIGINAL")
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
    /// Contactos que lleva, si se conocen: el primero es el de la carcasa; los
    /// otros, del mismo tamaño, los toma contacts.rs para los calibres que el
    /// primero no admite. Del género de la carcasa.
    pub(super) contacts: &'static [Contact],
    pub(super) seal_plug: Option<&'static str>,
}

pub(super) struct Contact {
    pub(super) part_number: &'static str,
    pub(super) manufacturer: &'static str,
    pub(super) description: &'static str,
    pub(super) gauge_min: &'static str,
    pub(super) gauge_max: &'static str,
}

const MIL_20_PIN: &[Contact] = &[Contact {
    part_number: "M39029/4-110",
    manufacturer: "MIL-DTL-26482",
    description: "Size 20 crimp pin contact, 24–20 AWG (MIL-DTL-26482 Series 2)",
    gauge_min: "24 AWG",
    gauge_max: "20 AWG",
}];

const MIL_20_SOCKET: &[Contact] = &[Contact {
    part_number: "M39029/5-115",
    manufacturer: "MIL-DTL-26482",
    description: "Size 20 crimp socket contact, 24–20 AWG (MIL-DTL-26482 Series 2)",
    gauge_min: "24 AWG",
    gauge_max: "20 AWG",
}];

/// Terminales hembra sellados de GT 150 (catálogo Delphi "GT Series", pág. 1.6).
/// Los sellos de cable (blanco 1,20–1,90 mm, azul 1,86–2,40 mm) no están en el modelo.
const GT150_SEALED_SOCKETS: &[Contact] = &[
    Contact {
        part_number: "12191818",
        manufacturer: "Aptiv / Delphi",
        description: "GT 150 sealed female terminal, 0.35–0.5 mm²",
        gauge_min: "0.35 mm²",
        gauge_max: "0.5 mm²",
    },
    Contact {
        part_number: "12191819",
        manufacturer: "Aptiv / Delphi",
        description: "GT 150 sealed female terminal, 0.75–1.0 mm²",
        gauge_min: "0.75 mm²",
        gauge_max: "1.0 mm²",
    },
];

/// Junior Power Timer 2.8 hembra con sello de cable (catálogo TE 889759-3):
/// el terminal de las fichas que el taller llama "Mini Timer" (EV1) y de la
/// bobina VAG.
const JPT_SEALED_SOCKETS: &[Contact] = &[
    Contact {
        part_number: "929931-1",
        manufacturer: "TE",
        description: "Junior Power Timer 2.8 receptacle contact, single wire seal, 0.22–0.5 mm²",
        gauge_min: "0.22 mm²",
        gauge_max: "0.5 mm²",
    },
    Contact {
        part_number: "929930-1",
        manufacturer: "TE",
        description: "Junior Power Timer 2.8 receptacle contact, single wire seal, 0.5–1.0 mm²",
        gauge_min: "0.5 mm²",
        gauge_max: "1.0 mm²",
    },
];

/// MCP 1.5K hembra con sello de cable, para pin de 0,6 mm (catálogo TE 1307998-2).
const MCP_15K_SEALED_SOCKETS: &[Contact] = &[
    Contact {
        part_number: "1241379-1",
        manufacturer: "TE",
        description: "MCP 1.5K receptacle contact, single wire seal, 0.20–0.35 mm²",
        gauge_min: "0.2 mm²",
        gauge_max: "0.35 mm²",
    },
    Contact {
        part_number: "1241381-1",
        manufacturer: "TE",
        description: "MCP 1.5K receptacle contact, single wire seal, 0.5–1.0 mm²",
        gauge_min: "0.5 mm²",
        gauge_max: "1.0 mm²",
    },
];

/// Vías del inserto 24-61 de MIL-DTL-26482 Serie 2 (mismas letras que el 25-61
/// de MIL-STD-1560, confirmado con fotos del MS3476L24-61P).
const MIL_61: &[&str] = &[
    "A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "R", "S", "T", "U", "V",
    "W", "X", "Y", "Z", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "m", "n", "p", "q",
    "r", "s", "t", "u", "v", "w", "x", "y", "z", "AA", "BB", "CC", "DD", "EE", "FF", "GG", "HH",
    "JJ", "KK", "LL", "MM", "NN", "PP",
];

/// Vías del inserto 20-41 de MIL-DTL-26482 Serie 2 (leídas de las fotos del
/// MS3476A20-41P; distingue mayúsculas: no hay I, O, Q, l ni o).
const MIL_41: &[&str] = &[
    "A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "R", "S", "T", "U", "V",
    "W", "X", "Y", "Z", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "m", "n", "p", "q",
    "r", "s", "t",
];

pub(super) const OTHER_HOUSINGS: &[Housing] = &[
    Housing {
        part_number: "1J0 973 724",
        manufacturer: "VAG",
        series: "VAG",
        gender: "female",
        contact_size: "Mini Timer",
        shell_size: None,
        suggested_termination: None,
        cavities: &["1", "2", "3", "4"],
        description: "VAG 4-way ignition coil connector (Audi/VW coils)",
        contacts: JPT_SEALED_SOCKETS,
        seal_plug: None,
    },
    Housing {
        part_number: "1J0 973 733",
        manufacturer: "VAG",
        series: "VAG",
        gender: "female",
        contact_size: "Micro Timer",
        shell_size: None,
        suggested_termination: None,
        cavities: &["1", "2", "3", "4", "5", "6"],
        description: "VAG 6-way connector, mates the Bosch LSU 4.2 lambda sensor (the LSU 4.9 takes Bosch 1 928 404 669)",
        contacts: &[],
        seal_plug: None,
    },
    Housing {
        part_number: "1 928 404 669",
        manufacturer: "Bosch",
        series: "Bosch BAK",
        gender: "female",
        contact_size: "MCP 1.5K",
        shell_size: None,
        suggested_termination: None,
        cavities: &["1", "2", "3", "4", "5", "6"],
        description: "Bosch 6-way BAK connector, code 1: mates the Bosch LSU 4.9 lambda sensor (sensor connector 1 928 404 687)",
        contacts: MCP_15K_SEALED_SOCKETS,
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
        contacts: &[],
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
        contacts: MIL_20_PIN,
        seal_plug: Some("MS27488-20"),
    },
    // El "interco" de Martin (2026-11-06): plug negro con dado rojo, sin contactos
    // puestos. Marcado Corsair, J, 2616, c.
    Housing {
        part_number: "MS3476A20-41P",
        manufacturer: "Corsair",
        series: "MIL-DTL-26482 II",
        gender: "male",
        contact_size: "20",
        shell_size: Some("20"),
        suggested_termination: Some("boot"),
        cavities: MIL_41,
        description: "MIL-DTL-26482 Series 2 bayonet plug, shell 20, 41 × size 20 pin contacts",
        contacts: MIL_20_PIN,
        seal_plug: Some("MS27488-20"),
    },
    // Fotos y datos de Martin (2026-11-06): receptáculo de brida cuadrada, sockets,
    // el mismo inserto 24-61. Motor interno; marcado "2607B", "aero jan".
    Housing {
        part_number: "MS3470A24-61S",
        manufacturer: "Aero JAN",
        series: "MIL-DTL-26482 II",
        gender: "female",
        contact_size: "20",
        shell_size: Some("24"),
        suggested_termination: Some("boot"),
        cavities: MIL_61,
        description: "MIL-DTL-26482 Series 2 bayonet wall-mount receptacle, square flange, shell 24, 61 × size 20 socket contacts",
        contacts: MIL_20_SOCKET,
        seal_plug: Some("MS27488-20"),
    },
    // Foto de Martin (2026-11-06): marca Delphi, sello azul y traba lila; 13519047
    // es la GT 150 sellada 3 vías hembra del catálogo, sin codificado USCAR.
    Housing {
        part_number: "13519047",
        manufacturer: "Aptiv / Delphi",
        series: "GT 150",
        gender: "female",
        contact_size: "GT 150",
        shell_size: None,
        suggested_termination: None,
        cavities: &["A", "B", "C"],
        description: "GT 150 sealed 3-way female connector assembly (part number to confirm on the part)",
        contacts: GT150_SEALED_SOCKETS,
        seal_plug: Some("15305171"),
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
        contacts: JPT_SEALED_SOCKETS,
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
        contacts: JPT_SEALED_SOCKETS,
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
        contacts: &[],
        seal_plug: None,
    },
];

/// Carcasas sueltas que enchufan entre sí: (macho, hembra).
pub(super) const MATED_HOUSINGS: &[(&str, &str)] = &[("MS3476L24-61P", "MS3470A24-61S")];

/// Conectores del arnés para la ECU Marelli SRG 140/141, de la hoja "SRG14x
/// connectors" y las fotos de Martin (2026-11-06). Van con el nombre de la hoja
/// hasta tener el número de parte. Tres tamaños de vía (el paso se ve en la
/// pieza; sus contactos todavía no se conocen): los que no se listan son "SRG signal".
pub(super) struct SrgLoom {
    pub(super) part_number: &'static str,
    pub(super) description: &'static str,
    pub(super) ways: usize,
    /// (tamaño de contacto, vías de ese tamaño)
    pub(super) sizes: &'static [(&'static str, &'static [usize])],
}

pub(super) const SRG_LOOM: &[SrgLoom] = &[
    SrgLoom {
        part_number: "SRG14x LOOM A",
        description: "Marelli SRG 140/141 ECU loom connector A, 105-way (name as in the pinout sheet; part number to confirm)",
        ways: 105,
        sizes: &[(
            "SRG medium",
            &[
                1, 2, 3, 4, 22, 23, 24, 25, 43, 44, 45, 46, 64, 65, 66, 67, 85, 86, 87, 88,
            ],
        )],
    },
    SrgLoom {
        part_number: "SRG14x LOOM K",
        description: "Marelli SRG 140/141 ECU loom connector K (B), 91-way: pins 1–6 power (name as in the pinout sheet; part number to confirm)",
        ways: 91,
        sizes: &[
            ("SRG power", &[1, 2, 3, 4, 5, 6]),
            ("SRG medium", &[22, 23, 39, 40, 56, 57, 73, 74, 90, 91]),
        ],
    },
];

/// Boots moldeados Raychem del taller (fotos de las bolsas, 2026-11-06). Los
/// CS-2117 son una variante del 202A…-25-0 que no aparece en el catálogo: se
/// usan los datos del 202A…-25-0. Rango del lado cable: página de TE de cada
/// parte; largo: hoja del distribuidor (la del 222A163 no se encontró: 0 hasta
/// medirla). El solape es provisorio (plan 9.2: mayor que el del termo).
pub(super) struct Boot {
    pub(super) part_number: &'static str,
    pub(super) orientation: &'static str,
    pub(super) cable_min_mm: f64,
    pub(super) cable_max_mm: f64,
    pub(super) length_mm: f64,
    pub(super) description: &'static str,
    /// (serie, tamaño de carcasa) de los conectores con los que calza.
    pub(super) fits: &'static [(&'static str, &'static str)],
}

pub(super) const BOOT_OVERLAP_MM: f64 = 40.0;

pub(super) const BOOTS: &[Boot] = &[
    Boot {
        part_number: "202A142-25-CS-2117-0",
        orientation: "straight",
        cable_min_mm: 7.4,
        cable_max_mm: 25.4,
        length_mm: 66.8,
        description: "Raychem straight boot, size 42, fluid-resistant elastomer; connector end Ø 17.8–31.0 mm",
        fits: &[("MIL-DTL-26482 II", "20")],
    },
    Boot {
        part_number: "202A163-25-CS-2117-0",
        orientation: "straight",
        cable_min_mm: 9.4,
        cable_max_mm: 27.2,
        length_mm: 99.1,
        description: "Raychem straight boot, size 63, fluid-resistant elastomer; connector end Ø 27.4–42.7 mm",
        fits: &[("MIL-DTL-26482 II", "24")],
    },
    Boot {
        part_number: "222A163-25-0",
        orientation: "right_angle",
        cable_min_mm: 9.4,
        cable_max_mm: 27.4,
        length_mm: 0.0,
        description: "Raychem right-angle boot, size 63, fluid-resistant elastomer (leg length to measure)",
        fits: &[("MIL-DTL-26482 II", "24")],
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
