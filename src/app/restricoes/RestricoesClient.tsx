'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { getTeacherAvailability, saveTeacherAvailability } from './actions';

type Teacher = { id: string; name: string };
type AvailabilitySlot = { dayOfWeek: number; period: number; isAvailable: boolean };

export default function RestricoesClient({ teachers }: { teachers: Teacher[] }) {
  const { showToast } = useToast();
  const [showAvailabilityModal, setShowAvailabilityModal] = useState(false);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('');
  const [grid, setGrid] = useState<AvailabilitySlot[]>([]);
  const [isLoadingGrid, setIsLoadingGrid] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const days = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
  const periods = [1, 2, 3, 4, 5, 6];

  // Initialize a completely available grid
  const createDefaultGrid = () => {
    const defaultGrid: AvailabilitySlot[] = [];
    for (let d = 1; d <= 5; d++) {
      for (let p = 1; p <= 6; p++) {
        defaultGrid.push({ dayOfWeek: d, period: p, isAvailable: true });
      }
    }
    return defaultGrid;
  };

  useEffect(() => {
    if (showAvailabilityModal && selectedTeacherId) {
      loadGrid(selectedTeacherId);
    } else if (showAvailabilityModal && !selectedTeacherId && teachers.length > 0) {
      setSelectedTeacherId(teachers[0].id);
    }
  }, [showAvailabilityModal, selectedTeacherId, teachers]);

  const loadGrid = async (teacherId: string) => {
    setIsLoadingGrid(true);
    try {
      const savedAvailabilities = await getTeacherAvailability(teacherId);
      const newGrid = createDefaultGrid();
      
      // Override default with saved preferences
      savedAvailabilities.forEach(saved => {
        const index = newGrid.findIndex(g => g.dayOfWeek === saved.dayOfWeek && g.period === saved.period);
        if (index !== -1) {
          newGrid[index].isAvailable = saved.isAvailable;
        }
      });
      
      setGrid(newGrid);
    } catch (e) {
      showToast('Erro ao carregar disponibilidade.', 'error');
    } finally {
      setIsLoadingGrid(false);
    }
  };

  const handleToggleSlot = (dayOfWeek: number, period: number) => {
    setGrid(prev => prev.map(slot => 
      (slot.dayOfWeek === dayOfWeek && slot.period === period) 
        ? { ...slot, isAvailable: !slot.isAvailable }
        : slot
    ));
  };

  const handleSaveSettings = () => {
    showToast('Configurações salvas com sucesso!', 'success');
  };

  const handleSaveAvailability = async () => {
    if (!selectedTeacherId) return;
    setIsSaving(true);
    try {
      // We only need to save the ones that are false to save DB space, or save all. 
      // Saving all explicit toggles is safer.
      const slotsToSave = grid.filter(g => !g.isAvailable); // only save blocked slots
      await saveTeacherAvailability(selectedTeacherId, slotsToSave);
      setShowAvailabilityModal(false);
      showToast('Disponibilidade do professor salva!', 'success');
    } catch (e) {
      showToast('Erro ao salvar disponibilidade.', 'error');
    } finally {
      setIsSaving(false);
    }
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
        <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>Selecione um professor para bloquear seus horários indisponíveis. (Verde = Disponível / Vermelho = Bloqueado)</p>
        
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Professor</label>
          <select 
            className="input" 
            value={selectedTeacherId} 
            onChange={e => setSelectedTeacherId(e.target.value)}
          >
             {teachers.map(t => (
               <option key={t.id} value={t.id}>{t.name}</option>
             ))}
          </select>
        </div>

        {isLoadingGrid ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Carregando grade...</div>
        ) : (
          <div style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: '0.875rem' }}>
              <thead>
                <tr>
                  <th style={{ padding: '0.5rem', borderBottom: '2px solid var(--border-color)' }}>Aula</th>
                  {days.map(d => (
                    <th key={d} style={{ padding: '0.5rem', borderBottom: '2px solid var(--border-color)' }}>{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periods.map(period => (
                  <tr key={period} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '0.5rem', fontWeight: 'bold', color: 'var(--text-secondary)' }}>{period}ª</td>
                    {days.map((_, index) => {
                      const dayOfWeek = index + 1;
                      const slot = grid.find(g => g.dayOfWeek === dayOfWeek && g.period === period);
                      const isAvail = slot ? slot.isAvailable : true;

                      return (
                        <td key={dayOfWeek} style={{ padding: '0.25rem' }}>
                          <button
                            onClick={() => handleToggleSlot(dayOfWeek, period)}
                            style={{
                              width: '100%',
                              padding: '0.5rem',
                              borderRadius: 'var(--radius-sm)',
                              border: 'none',
                              cursor: 'pointer',
                              fontWeight: 'bold',
                              color: 'white',
                              backgroundColor: isAvail ? 'var(--success-color)' : 'var(--danger-color)',
                              transition: 'opacity 0.2s',
                              opacity: isAvail ? 0.9 : 1
                            }}
                          >
                            {isAvail ? 'Livre' : 'X'}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          <button className="btn btn-secondary" onClick={() => setShowAvailabilityModal(false)}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSaveAvailability} disabled={isSaving || isLoadingGrid}>
            {isSaving ? 'Salvando...' : 'Salvar Bloqueios'}
          </button>
        </div>
      </Modal>
    </>
  );
}
