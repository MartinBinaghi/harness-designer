//! Comparación de calibres en una unidad común (mm² de sección), para el
//! chequeo "calibre fuera del rango del contacto" (plan sección 12). El plan
//! guarda el calibre como texto libre (sección 4.1: "calibre (mm² o AWG)")
//! porque el taller usa ambas notaciones indistintamente; este módulo es el
//! único lugar que las hace comparables.

/// Fórmula estándar de diámetro AWG: el calibre 36 mide 0.127mm, y el
/// diámetro se duplica cada ~6 calibres.
fn awg_to_mm2(awg: f64) -> f64 {
    let diameter_mm = 0.127 * 92f64.powf((36.0 - awg) / 39.0);
    std::f64::consts::PI / 4.0 * diameter_mm * diameter_mm
}

/// Parsea un calibre en texto libre ("22 AWG", "22", "0.5mm²", "0.5 mm2") a
/// mm² de sección, para poder comparar distintas notaciones entre sí.
/// Devuelve `None` si no se puede interpretar (no se valida lo que no se
/// puede parsear). No admite calibres AWG negativos (ej. "0000" para cable
/// de batería) — caso de uso fuera del alcance de esta pasada.
pub fn gauge_to_mm2(text: &str) -> Option<f64> {
    let lower = text.to_lowercase();
    let digits: String = lower.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
    let number: f64 = digits.parse().ok()?;
    if lower.contains("mm") {
        Some(number)
    } else {
        // Número solo o con sufijo "AWG": American Wire Gauge, el default del taller.
        Some(awg_to_mm2(number))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_awg_with_and_without_suffix() {
        let a = gauge_to_mm2("22 AWG").unwrap();
        let b = gauge_to_mm2("22").unwrap();
        assert!((a - b).abs() < 1e-9);
        assert!((a - 0.326).abs() < 0.01); // 22 AWG ≈ 0.326mm², tabla estándar
    }

    #[test]
    fn parses_mm2_directly() {
        assert!((gauge_to_mm2("0.5mm²").unwrap() - 0.5).abs() < 1e-9);
        assert!((gauge_to_mm2("1.5 mm2").unwrap() - 1.5).abs() < 1e-9);
    }

    #[test]
    fn a_lower_awg_number_is_a_thicker_wire() {
        assert!(gauge_to_mm2("10 AWG").unwrap() > gauge_to_mm2("22 AWG").unwrap());
    }

    #[test]
    fn unparseable_gauge_returns_none() {
        assert_eq!(gauge_to_mm2("n/a"), None);
    }
}
