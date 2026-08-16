import { useCallback, useRef, useState } from 'react';

export interface ModalState {
  open: boolean;
  id: string | null;
}

export function useModalManager() {
  const [currentModal, setCurrentModal] = useState<ModalState>({ open: false, id: null });
  const previousModal = useRef<string | null>(null);

  const openModal = useCallback((id: string) => {
    previousModal.current = currentModal.id;
    setCurrentModal({ open: true, id });
  }, [currentModal.id]);

  const closeModal = useCallback(() => {
    setCurrentModal({ open: false, id: null });
  }, []);

  const isModalOpen = useCallback((id: string) => {
    return currentModal.open && currentModal.id === id;
  }, [currentModal]);

  return { currentModal, openModal, closeModal, isModalOpen };
}
