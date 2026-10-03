/// Pila de deshacer/rehacer genérica sobre snapshots del estado completo.
///
/// A la escala de un arnés (cientos de registros) clonar el estado entero en
/// cada edición es más simple que un patrón de comandos con inversas por
/// operación, y suficientemente rápido. Si esto se queda corto (por volumen o
/// por necesitar granularidad campo a campo) se pasa a comandos, no antes.
pub struct History<T: Clone> {
    current: T,
    undo_stack: Vec<T>,
    redo_stack: Vec<T>,
}

impl<T: Clone> History<T> {
    pub fn new(initial: T) -> Self {
        Self {
            current: initial,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        }
    }

    pub fn get(&self) -> &T {
        &self.current
    }

    /// Aplica una edición: guarda el estado previo y reemplaza el actual.
    /// Descarta cualquier redo pendiente (editar después de deshacer abre una
    /// rama nueva).
    pub fn edit(&mut self, new_state: T) {
        self.undo_stack.push(self.current.clone());
        self.current = new_state;
        self.redo_stack.clear();
    }

    pub fn undo(&mut self) -> bool {
        match self.undo_stack.pop() {
            Some(prev) => {
                self.redo_stack.push(std::mem::replace(&mut self.current, prev));
                true
            }
            None => false,
        }
    }

    pub fn redo(&mut self) -> bool {
        match self.redo_stack.pop() {
            Some(next) => {
                self.undo_stack.push(std::mem::replace(&mut self.current, next));
                true
            }
            None => false,
        }
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
