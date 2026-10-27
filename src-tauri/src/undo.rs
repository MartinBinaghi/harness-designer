use std::sync::atomic::{AtomicU64, Ordering};

/// Números de revisión únicos en todo el programa (no se repiten aunque se
/// abra otro archivo): así un resultado guardado para una revisión nunca se
/// confunde con el de otro documento.
static NEXT_REVISION: AtomicU64 = AtomicU64::new(1);

fn next_revision() -> u64 {
    NEXT_REVISION.fetch_add(1, Ordering::Relaxed)
}

/// Pila de deshacer/rehacer genérica sobre snapshots del estado completo.
///
/// A la escala de un arnés (cientos de registros) clonar el estado entero en
/// cada edición es más simple que un patrón de comandos con inversas por
/// operación, y suficientemente rápido. Si esto se queda corto (por volumen o
/// por necesitar granularidad campo a campo) se pasa a comandos, no antes.
///
/// Cada estado lleva su número de revisión: deshacer vuelve al estado anterior
/// *y a su número*, así "sin guardar" es solo "la revisión actual no es la del
/// archivo" (editar y deshacer deja el proyecto como guardado).
pub struct History<T: Clone> {
    current: T,
    undo_stack: Vec<(T, u64)>,
    redo_stack: Vec<(T, u64)>,
    /// Distinta para cada estado distinto (abrir, editar): la clave de los
    /// cálculos ya hechos (ver `AppState::calc`).
    revision: u64,
    /// La revisión que está en el archivo (la de abrir o la del último guardado).
    saved_revision: u64,
}

impl<T: Clone> History<T> {
    pub fn new(initial: T) -> Self {
        let revision = next_revision();
        Self {
            current: initial,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            revision,
            saved_revision: revision,
        }
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn unsaved(&self) -> bool {
        self.revision != self.saved_revision
    }

    pub fn mark_saved(&mut self) {
        self.saved_revision = self.revision;
    }

    pub fn get(&self) -> &T {
        &self.current
    }

    /// Aplica una edición: guarda el estado previo y reemplaza el actual.
    /// Descarta cualquier redo pendiente (editar después de deshacer abre una
    /// rama nueva).
    pub fn edit(&mut self, new_state: T) {
        let prev = std::mem::replace(&mut self.current, new_state);
        self.undo_stack.push((prev, self.revision));
        self.redo_stack.clear();
        self.revision = next_revision();
    }

    pub fn undo(&mut self) -> bool {
        Self::step(
            &mut self.undo_stack,
            &mut self.redo_stack,
            &mut self.current,
            &mut self.revision,
        )
    }

    pub fn redo(&mut self) -> bool {
        Self::step(
            &mut self.redo_stack,
            &mut self.undo_stack,
            &mut self.current,
            &mut self.revision,
        )
    }

    /// Saca un estado (con su revisión) de `from` y deja el actual en `to`.
    fn step(
        from: &mut Vec<(T, u64)>,
        to: &mut Vec<(T, u64)>,
        current: &mut T,
        revision: &mut u64,
    ) -> bool {
        let Some((state, rev)) = from.pop() else {
            return false;
        };
        to.push((std::mem::replace(current, state), *revision));
        *revision = rev;
        true
    }

    /// El estado que vuelve con deshacer: después de editar o rehacer, el de antes.
    pub fn undo_target(&self) -> Option<&T> {
        self.undo_stack.last().map(|(state, _)| state)
    }

    /// El estado que vuelve con rehacer: después de deshacer, el de antes.
    pub fn redo_target(&self) -> Option<&T> {
        self.redo_stack.last().map(|(state, _)| state)
    }

    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn undo_redo_round_trip() {
        let mut h = History::new(0);
        h.edit(1);
        h.edit(2);
        assert_eq!(*h.get(), 2);

        assert!(h.undo());
        assert_eq!(*h.get(), 1);
        assert!(h.undo());
        assert_eq!(*h.get(), 0);
        assert!(!h.undo());

        assert!(h.redo());
        assert_eq!(*h.get(), 1);
    }

    #[test]
    fn editing_after_undo_discards_the_redo_branch() {
        let mut h = History::new(0);
        h.edit(1);
        h.undo();
        h.edit(5);
        assert!(!h.redo());
        assert_eq!(*h.get(), 5);
    }

    #[test]
    fn edits_mark_unsaved_until_saved() {
        let mut h = History::new(0);
        assert!(!h.unsaved());
        h.edit(1);
        assert!(h.unsaved());
        h.mark_saved();
        assert!(!h.unsaved());
        h.undo();
        assert!(h.unsaved());
    }

    #[test]
    fn undoing_back_to_the_saved_state_is_not_unsaved() {
        let mut h = History::new(0);
        h.edit(1);
        h.undo();
        assert!(!h.unsaved()); // igual que el archivo
        h.redo();
        assert!(h.unsaved());
        h.mark_saved();
        h.undo();
        assert!(h.unsaved()); // ahora el archivo tiene el 1
        h.redo();
        assert!(!h.unsaved());
    }

    #[test]
    fn every_distinct_state_has_its_own_revision() {
        let mut h = History::new(0);
        let opened = h.revision();
        h.edit(1);
        let edited = h.revision();
        assert_ne!(edited, opened);
        h.undo();
        assert_eq!(h.revision(), opened); // el mismo estado, la misma revisión
        assert!(!h.undo()); // nada que deshacer: el estado no cambia, la revisión tampoco
        assert_eq!(h.revision(), opened);
        h.redo();
        assert_eq!(h.revision(), edited);
        h.undo();
        h.edit(2); // rama nueva: revisión nueva
        assert!(h.revision() != opened && h.revision() != edited);
        assert_ne!(History::new(0).revision(), opened); // otro documento, otra revisión
    }

    #[test]
    fn can_undo_and_can_redo_reflect_stack_state() {
        let mut h = History::new(0);
        assert!(!h.can_undo());
        assert!(!h.can_redo());
        h.edit(1);
        assert!(h.can_undo());
        assert!(!h.can_redo());
        h.undo();
        assert!(!h.can_undo());
        assert!(h.can_redo());
    }
}
