'use client';

import { useState } from 'react';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';

export default function RestricoesClient() {
  const { showToast } = useToast();
  const [showAvailabilityModal, setShowAvailabilityModal] = useState(false);

  const handleSaveSettings = () => {
    // Simulando salvar configurações gerais
    showToast('Configurações salvas com sucesso!', 'success');
  };

  const handleSaveAvailability = () => {
    setShowAvailabilityModal(false);
    showToast('Disponibilidade do professor atualizada!', 'success');
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '2rem' }}>
        <div>
          <h1>Regras e Capela</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Configure as janelas de horários, intervalos e indisponibilidade de professores.</p>
        </div>
        <button className="btn btn-primary" onClick={handleSaveSettings}>Salvar Configurações</button>
      </div>

      <div className="table-container" style={{ padding: '2rem' }}>
        <h3 style={{ marginBottom: '1rem', color: 'var(--primary-color)' }}>Horários e Intervalos (Turnos)</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
          Personalize a duração de cada aula (45 min, 50 min) e os horários exatos de intervalo para a Educação Infantil, Fund I e Fund II.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
          <div>
            <label className="input-label" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Duração aula - Manhã</label>
            <input type="text" className="input" defaultValue="50 minutos (Inf/Fund I), 45 min (Fund II)" />
          </div>
          <div>
            <label className="input-label" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Horário de Início</label>
            <input type="text" className="input" defaultValue="07:15" />
          </div>
        </div>

        <hr style={{ border: 0, borderTop: '1px solid var(--border-color)', margin: '2rem 0' }} />

        <h3 style={{ marginBottom: '1rem', color: 'var(--primary-color)' }}>Dia de Capela</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
          Defina em qual dia da semana ocorre a Capela e quais turmas participam em qual horário. O motor irá reservar este horário.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
          <div>
            <label className="input-label" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Dia da Semana</label>
            <select className="input" defaultValue="Quarta-feira">
              <option value="Segunda-feira">Segunda-feira</option>
              <option value="Terça-feira">Terça-feira</option>
              <option value="Quarta-feira">Quarta-feira</option>
              <option value="Quinta-feira">Quinta-feira</option>
              <option value="Sexta-feira">Sexta-feira</option>
            </select>
          </div>
          <div>
            <label className="input-label" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Professor Responsável</label>
            <select className="input" defaultValue="Istanlley">
              <option value="Istanlley">Istanlley</option>
              <option value="Outro">Outro</option>
            </select>
          </div>
        </div>

        <hr style={{ border: 0, borderTop: '1px solid var(--border-color)', margin: '2rem 0' }} />

        <h3 style={{ marginBottom: '1rem', color: 'var(--primary-color)' }}>Restrições de Professores</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
          Bloqueie dias inteiros ou horários específicos em que um professor não pode dar aula (ex: professor atua em escola estadual).
        </p>
        <button className="btn btn-secondary" onClick={() => setShowAvailabilityModal(true)}>Configurar Disponibilidade Específica</button>
      </div>

      <Modal 
        isOpen={showAvailabilityModal} 
        onClose={() => setShowAvailabilityModal(false)}
        title="Disponibilidade Específica"
      >
        <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>Selecione um professor para bloquear seus horários indisponíveis.</p>
        
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Professor</label>
          <select className="input">
             <option>Carregando professores...</option>
          </select>
        </div>

        <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '1rem', marginBottom: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
           Grade de seleção de horários será implementada aqui.
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          <button className="btn btn-secondary" onClick={() => setShowAvailabilityModal(false)}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSaveAvailability}>Salvar Bloqueios</button>
        </div>
      </Modal>
    </>
  );
}
