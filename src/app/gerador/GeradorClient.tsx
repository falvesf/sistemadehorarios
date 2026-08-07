'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { generateSchedule, updateSlotTeacher } from './actions';

type ScheduleEntry = {
  id: string;
  dayOfWeek: number;
  period: number;
  isFixed: boolean;
  class: { name: string; level: string };
  subject: { name: string };
  teacher: { id: string; name: string } | null;
};

type Teacher = { id: string; name: string };

export default function GeradorClient({ initialSchedules, teachers }: { initialSchedules: ScheduleEntry[], teachers: Teacher[] }) {
  const { showToast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [mode, setMode] = useState<'REPAIR' | 'SCRATCH'>('REPAIR');
  
  // States for Editing Slot
  const [editingSlot, setEditingSlot] = useState<ScheduleEntry | null>(null);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('');
  const [isSavingSlot, setIsSavingSlot] = useState(false);
  const [schedules, setSchedules] = useState<ScheduleEntry[]>(initialSchedules);

  const handleGenerateClick = (selectedMode: 'REPAIR' | 'SCRATCH') => {
    setMode(selectedMode);
    setShowConfirmModal(true);
  };

  const handleConfirmGeneration = async () => {
    setShowConfirmModal(false);
    setIsGenerating(true);
    showToast('Iniciando o motor de geração...', 'info');

    try {
      const result = await generateSchedule(mode);
      if (result.success) {
        showToast(result.message, 'success');
        // In a real scenario, we'd fetch the new schedules and highlight differences
      } else {
        showToast('Erro ao gerar.', 'error');
      }
    } catch (error) {
      showToast('Erro ao comunicar com o motor.', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSlotClick = (slot: ScheduleEntry) => {
    setEditingSlot(slot);
    setSelectedTeacherId(slot.teacher?.id || '');
  };

  const handleSaveSlot = async () => {
    if (!editingSlot) return;
    setIsSavingSlot(true);
    try {
      const res = await updateSlotTeacher(editingSlot.id, selectedTeacherId || null);
      if (res?.success) {
        showToast('Professor atualizado para esta disciplina com sucesso!', 'success');
        setEditingSlot(null);
        // Note: Next.js revalidatePath will refresh the page props on the next navigation or automatically if using server components properly.
        // For an immediate local update, we can also refresh the router.
        window.location.reload(); 
      } else {
        showToast('Erro ao atualizar horário.', 'error');
      }
    } catch (e) {
      showToast('Erro interno.', 'error');
    } finally {
      setIsSavingSlot(false);
    }
  };

  // Agrupar schedules por turma
  const classesMap = new Map<string, ScheduleEntry[]>();
  schedules.forEach(s => {
    if (!classesMap.has(s.class.name)) classesMap.set(s.class.name, []);
    classesMap.get(s.class.name)!.push(s);
  });
  
  const classNames = Array.from(classesMap.keys());
  const days = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];

  return (
    <>
      <div className="table-container" style={{ padding: '2rem', textAlign: 'center', marginBottom: '2rem' }}>
        <h2 style={{ marginBottom: '1rem' }}>Controle do Motor Gerador</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
          Escolha como deseja que o algoritmo trabalhe. Recomendamos o modo de <strong>Recálculo</strong> para preservar a grade atual.
        </p>
        
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
          <button 
            className="btn btn-primary" 
            style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', opacity: isGenerating ? 0.7 : 1 }}
            onClick={() => handleGenerateClick('REPAIR')}
            disabled={isGenerating}
          >
            {isGenerating && mode === 'REPAIR' ? '⏳ Recalculando...' : '✨ Recalcular Conflitos (Recomendado)'}
          </button>

          <button 
            className="btn btn-secondary" 
            style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', opacity: isGenerating ? 0.7 : 1 }}
            onClick={() => handleGenerateClick('SCRATCH')}
            disabled={isGenerating}
          >
             {isGenerating && mode === 'SCRATCH' ? '⏳ Gerando...' : '⚠️ Gerar do Zero'}
          </button>
        </div>
      </div>

      <h3 style={{ marginBottom: '1rem' }}>Grade de Horários Atual</h3>
      
      {classNames.map(className => {
        const classSchedules = classesMap.get(className) || [];
        // Max period in this class
        const maxPeriod = classSchedules.reduce((max, s) => s.period > max ? s.period : max, 0) || 5;

        return (
          <div key={className} className="table-container" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
            <h4 style={{ color: 'var(--primary-color)', marginBottom: '1rem', fontSize: '1.2rem' }}>Turma: {className}</h4>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr>
                    <th style={{ borderBottom: '2px solid var(--border-color)', padding: '0.5rem', textAlign: 'left' }}>Aula</th>
                    {days.map((d, i) => (
                      <th key={d} style={{ borderBottom: '2px solid var(--border-color)', padding: '0.5rem', textAlign: 'left' }}>{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: maxPeriod }).map((_, periodIndex) => {
                    const period = periodIndex + 1;
                    return (
                      <tr key={period} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '0.5rem', fontWeight: 'bold', color: 'var(--text-secondary)' }}>{period}ª Aula</td>
                        {days.map((_, dayIndex) => {
                          const day = dayIndex + 1; // 1 to 5
                          const slot = classSchedules.find(s => s.dayOfWeek === day && s.period === period);
                          return (
                            <td key={day} style={{ padding: '0.5rem' }}>
                              {slot ? (
                                <div 
                                  onClick={() => handleSlotClick(slot)}
                                  style={{ 
                                    backgroundColor: slot.isFixed ? '#fef3c7' : 'var(--bg-primary)', 
                                    padding: '0.5rem', 
                                    borderRadius: 'var(--radius-sm)',
                                    border: '1px solid var(--border-color)',
                                    cursor: 'pointer',
                                    transition: 'border-color 0.2s'
                                  }}
                                  onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--primary-color)'}
                                  onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                                  title="Clique para trocar o professor desta disciplina"
                                >
                                  <div style={{ fontWeight: 'bold' }}>{slot.subject.name}</div>
                                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                                    {slot.teacher ? slot.teacher.name : 'Sem Prof.'}
                                  </div>
                                </div>
                              ) : (
                                <div style={{ color: '#ccc', fontStyle: 'italic', padding: '0.5rem' }}>Vago</div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <Modal 
        isOpen={showConfirmModal} 
        onClose={() => !isGenerating && setShowConfirmModal(false)}
        title={mode === 'REPAIR' ? 'Confirmar Recálculo' : 'Atenção: Geração do Zero'}
      >
        <p style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>
          {mode === 'REPAIR' 
            ? 'O sistema tentará resolver os conflitos de horário alterando apenas o necessário e preservando a maior parte da grade atual. Deseja continuar?'
            : 'ATENÇÃO: A grade inteira será apagada e o algoritmo tentará encaixar todas as aulas novamente do zero. Isso mudará completamente os horários atuais. Deseja continuar?'
          }
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          <button className="btn btn-secondary" onClick={() => setShowConfirmModal(false)}>Cancelar</button>
          <button className={mode === 'REPAIR' ? 'btn btn-primary' : 'btn btn-primary'} style={mode === 'SCRATCH' ? { backgroundColor: 'var(--danger-color)' } : {}} onClick={handleConfirmGeneration}>
            Sim, Iniciar
          </button>
        </div>
      </Modal>

      <Modal 
        isOpen={!!editingSlot}
        onClose={() => !isSavingSlot && setEditingSlot(null)}
        title="Trocar Professor da Disciplina"
      >
        {editingSlot && (
          <>
            <p style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>
              Alterar o professor de <strong>{editingSlot.subject.name}</strong> da turma <strong>{editingSlot.class.name}</strong>.
              Isso atualizará a Grade Curricular desta turma para este professor.
            </p>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Novo Professor</label>
              <select 
                className="input" 
                value={selectedTeacherId} 
                onChange={e => setSelectedTeacherId(e.target.value)}
              >
                <option value="">(Sem Professor)</option>
                {teachers.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
              <button className="btn btn-secondary" onClick={() => setEditingSlot(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSaveSlot} disabled={isSavingSlot}>
                {isSavingSlot ? 'Salvando...' : 'Salvar Alteração'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
