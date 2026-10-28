//! Biblioteca base: carcasas de conectores estandarizados (Deutsch DT/DTM/DTP,
//! TE Superseal 1.5) con el contacto y el tapón de cada familia Deutsch, cable
//! M22759/32 y termocontraíble Raychem (DR-25 sin adhesivo, ATUM con adhesivo),
//! para no cargar a mano lo que es igual en todos los proyectos. Ver
//! docs/BITACORA.md, decisión "Biblioteca base".
//!
//! Conectores, contactos, tapones y termos: cargados sin datasheet a la vista;
//! cada parte lo dice en su descripción ("unverified") hasta que se confirme.
//! Cables: diámetro nominal de la hoja M22759/32 (NASA NEPP, coincide con la
//! tabla publicada por los fabricantes). Precio y medidas traseras quedan
//! vacíos a propósito: dependen del proveedor y del datasheet.

mod build;
mod catalog;
mod merge;
#[cfg(test)]
mod test_fixtures;

/// La base sola (sin sumarla a otra biblioteca): la usan tests de otros módulos.
#[cfg(test)]
pub use build::base_library;
pub use merge::merge_base_library;
