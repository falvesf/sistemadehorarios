'use client';

import { useState } from 'react';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';

export default function GeradorClient() {
  const { showToast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const handleGenerateClick = () => {
    setShowConfirmModal(true);
  };

  const handleConfirmGeneration = async () => {
    setShowConfirmModal(false);
    setIsGenerating(true);
    showToast('Iniciando o motor de geração de horários...', 'info');

    try {
      // Simulate API call for now
      await new Promise(r => setTimeout(r, 2000));
      
      showToast('Horários gerados com sucesso!', 'success');
    } catch (error) {
      showToast('Erro ao gerar horários. Tente novamente.', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <>
      <div className="table-container" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
        <h2>Pronto para iniciar?</h2>
        <p>O algoritmo levará em consideração a disponibilidade dos professores, turmas, dias de capela e evitará colisões.</p>
        <br />
        <button 
          className="btn btn-primary" 
          style={{ padding: '1rem 2rem', fontSize: '1.25rem', opacity: isGenerating ? 0.7 : 1 }}
          onClick={handleGenerateClick}
          disabled={isGenerating}
        >
          {isGenerating ? '⏳ Gerando Horários...' : '✨ Iniciar Geração Automática'}
        </button>
      </div>

      <Modal 
        isOpen={showConfirmModal} 
        onClose={() => setShowConfirmModal(false)}
        title="Confirmar Geração"
      >
        <p style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>
          Atenção: Iniciar uma nova geração de horários irá sobrescrever a grade gerada anteriormente (exceto os horários fixos como Capela). Deseja continuar?
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          <button className="btn btn-secondary" onClick={() => setShowConfirmModal(false)}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleConfirmGeneration}>Sim, Gerar Horários</button>
        </div>
      </Modal>
    </>
  );
}
