'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { generateSchedule, updateSlotTeacher, createSlot, deleteSlot, exportSchedule, importSchedule, restoreDefaultSchedule } from './actions';

type ScheduleEntry = {
  id: string;
  dayOfWeek: number;
  period: number;
  isFixed: boolean;
  class: { name: string; level: string; shift: string };
  subject: { name: string };
  teacher: { id: string; name: string } | null;
};

type Teacher = { id: string; name: string };

type TimeSlot = {
  id: string;
  level: string;
  shift: string;
  dayOfWeek: number;
  period: number;
  startTime: string;
  endTime: string;
};

type Subject = { id: string; name: string };

export default function GeradorClient({
  initialSchedules,
  teachers,
  timeSlots,
  subjects,
  classes,
}: {
  initialSchedules: ScheduleEntry[];
  teachers: Teacher[];
  timeSlots: TimeSlot[];
  subjects: Subject[];
  classes: { id: string; name: string; level: string; shift: string }[];
}) {
  const { showToast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [mode, setMode] = useState<'REPAIR' | 'SCRATCH'>('REPAIR');

  // States for Editing Slot
  const [editingSlot, setEditingSlot] = useState<ScheduleEntry | null>(null);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('');
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');
  const [isSavingSlot, setIsSavingSlot] = useState(false);
  const [schedules, setSchedules] = useState<ScheduleEntry[]>(initialSchedules);

  // Import/Export/Restore states
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  const router = useRouter();

  useEffect(() => {
    setSchedules(initialSchedules);
  }, [initialSchedules]);

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
        showToast(result.message || 'Sucesso!', 'success');
      } else {
        showToast('Erro ao gerar.', 'error');
      }
    } catch {
      showToast('Erro ao comunicar com o motor.', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSlotClick = (slot: ScheduleEntry | null, classId: string, day: number, period: number, classLevel: string, classShift: string) => {
    if (slot) {
      setEditingSlot(slot);
      setSelectedTeacherId(slot.teacher?.id || '');
      setSelectedSubjectId(slot.subject.id);
    } else {
      // Creating new slot - open modal with class/day/period pre-filled
      setEditingSlot({
        id: `new-${classId}-${day}-${period}`,
        dayOfWeek: day,
        period: period,
        isFixed: false,
        class: classes.find(c => c.id === classId) || { name: '', level: classLevel, shift: classShift },
        subject: { id: '', name: '' },
        teacher: null,
      } as ScheduleEntry);
      setSelectedTeacherId('');
      setSelectedSubjectId('');
    }
  };

  const handleSaveSlot = async () => {
    if (!editingSlot) return;
    setIsSavingSlot(true);
    try {
      const isNew = editingSlot.id.startsWith('new-');
      let res;
      if (isNew) {
        if (!selectedSubjectId) { showToast('Selecione uma disciplina.', 'error'); return; }
        res = await createSlot({
          classId: editingSlot.class.id,
          subjectId: selectedSubjectId,
          teacherId: selectedTeacherId || null,
          dayOfWeek: editingSlot.dayOfWeek,
          period: editingSlot.period,
        });
      } else {
        res = await updateSlotTeacher(editingSlot.id, selectedTeacherId || null);
      }
      if (res?.success) {
        showToast(isNew ? 'Aula adicionada!' : 'Professor atualizado!', 'success');
        setEditingSlot(null);
        router.refresh();
      } else {
        showToast('Erro ao salvar.', 'error');
      }
    } catch {
      showToast('Erro interno.', 'error');
    } finally {
      setIsSavingSlot(false);
    }
  };

  const handleDeleteSlot = async (slot: ScheduleEntry) => {
    if (!confirm('Remover esta aula?')) return;
    try {
      const res = await deleteSlot(slot.id);
      if (res?.success) {
        showToast('Aula removida.', 'success');
        router.refresh();
      } else {
        showToast('Erro ao remover.', 'error');
      }
    } catch {
      showToast('Erro interno.', 'error');
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const blob = await exportSchedule();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `grade-horarios-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Grade exportada!', 'success');
    } catch {
      showToast('Erro ao exportar.', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async () => {
    if (!importFile) { showToast('Selecione um arquivo.', 'error'); return; }
    setIsImporting(true);
    try {
      const text = await importFile.text();
      const res = await importSchedule(text);
      if (res?.success) {
        showToast('Grade importada!', 'success');
        setShowImportModal(false);
        setImportFile(null);
        router.refresh();
      } else {
        showToast(res?.error || 'Erro ao importar.', 'error');
      }
    } catch {
      showToast('Erro ao ler arquivo.', 'error');
    } finally {
      setIsImporting(false);
    }
  };

  const handleRestoreDefault = async () => {
    if (!confirm('Restaurar grade padrão? Isso sobrescreverá a grade atual.')) return;
    setIsRestoring(true);
    try {
      const res = await restoreDefaultSchedule();
      if (res?.success) {
        showToast('Grade padrão restaurada!', 'success');
        router.refresh();
      } else {
        showToast('Erro ao restaurar.', 'error');
      }
    } catch {
      showToast('Erro interno.', 'error');
    } finally {
      setIsRestoring(false);
    }
  };

  // Helper: get the time label for a given class+period combo.
  // We use Monday (dayOfWeek=1) as the representative day for most classes,
  // but fall back to any day if Monday doesn't have that slot.
  const getSlotTime = (level: string, shift: string, period: number): string | null => {
    const ts =
      timeSlots.find(t => t.level === level && t.shift === shift && t.period === period && t.dayOfWeek === 1) ??
      timeSlots.find(t => t.level === level && t.shift === shift && t.period === period);
    return ts ? `${ts.startTime}–${ts.endTime}` : null;
  };

  // Group schedules by class name
  const classesMap = new Map<string, ScheduleEntry[]>();
  schedules.forEach(s => {
    if (!classesMap.has(s.class.name)) classesMap.set(s.class.name, []);
    classesMap.get(s.class.name)!.push(s);
  });

  const classNames = Array.from(classesMap.keys());
  const days = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];

  return (
    <>
      <div className="table-container" style={{ padding: '2rem', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
          <div>
            <h2 style={{ marginBottom: '0.5rem' }}>Controle do Motor Gerador</h2>
            <p style={{ color: 'var(--text-secondary)' }}>
              Escolha como deseja que o algoritmo trabalhe. Recomendamos o modo de <strong>Recálculo</strong> para preservar a grade atual.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={handleExport} disabled={isExporting}>
              {isExporting ? 'Exportando...' : '📤 Exportar Grade'}
            </button>
            <button className="btn btn-secondary" onClick={() => setShowImportModal(true)} disabled={isImporting}>
              {isImporting ? 'Importando...' : '📥 Importar Grade'}
            </button>
            <button className="btn btn-secondary" onClick={handleRestoreDefault} disabled={isRestoring} style={{ backgroundColor: 'var(--warning-color)', borderColor: 'var(--warning-color)' }}>
              {isRestoring ? 'Restaurando...' : '🔄 Restaurar Padrão'}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
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

      <h3 style={{ marginBottom: '1rem', padding: '0 2rem' }}>Grade de Horários Atual</h3>

      {classNames.map(className => {
        const classSchedules = classesMap.get(className) || [];
        const maxPeriod = classSchedules.reduce((max, s) => (s.period > max ? s.period : max), 0) || 6;
        // Determine level and shift from the first schedule entry for this class
        const firstEntry = classSchedules[0];
        const classInfo = classes.find(c => c.name === className);
        const classLevel = firstEntry?.class.level ?? classInfo?.level ?? 'FUND2';
        const classShift = firstEntry?.class.shift ?? classInfo?.shift ?? 'MORNING';

        return (
          <div key={className} className="table-container" style={{ padding: '1.5rem', marginBottom: '2rem', marginHorizontal: '2rem' }}>
            <h4 style={{ color: 'var(--primary-color)', marginBottom: '1rem', fontSize: '1.2rem' }}>
              Turma: {className}
            </h4>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr>
                    <th style={{ borderBottom: '2px solid var(--border-color)', padding: '0.5rem', textAlign: 'left', minWidth: '90px' }}>
                      Aula
                    </th>
                    {days.map(d => (
                      <th key={d} style={{ borderBottom: '2px solid var(--border-color)', padding: '0.5rem', textAlign: 'left' }}>
                        {d}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: maxPeriod }).map((_, periodIndex) => {
                    const period = periodIndex + 1;
                    const timeLabel = getSlotTime(classLevel, classShift, period);
                    return (
                      <tr key={period} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '0.5rem', minWidth: '90px' }}>
                          <div style={{ fontWeight: 'bold', color: 'var(--text-secondary)' }}>{period}ª Aula</div>
                          {timeLabel && (
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', opacity: 0.7, marginTop: '2px' }}>
                              {timeLabel}
                            </div>
                          )}
                        </td>
                        {days.map((_, dayIndex) => {
                          const day = dayIndex + 1;
                          const slot = classSchedules.find(s => s.dayOfWeek === day && s.period === period);
                          const classId = classes.find(c => c.name === className)?.id || '';
                          return (
                            <td key={day} style={{ padding: '0.5rem' }}>
                              {slot ? (
                                <div
                                  onClick={() => handleSlotClick(slot, classId, day, period, classLevel, classShift)}
                                  style={{
                                    backgroundColor: slot.isFixed ? '#fef3c7' : 'var(--bg-primary)',
                                    padding: '0.5rem',
                                    borderRadius: 'var(--radius-sm)',
                                    border: '1px solid var(--border-color)',
                                    cursor: 'pointer',
                                    transition: 'border-color 0.2s',
                                    position: 'relative',
                                  }}
                                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--primary-color)')}
                                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-color)')}
                                  title="Clique para editar"
                                >
                                  <div style={{ fontWeight: 'bold' }}>{slot.subject.name}</div>
                                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                                    {slot.teacher ? slot.teacher.name : 'Sem Prof.'}
                                  </div>
                                  {!slot.isFixed && (
                                    <button
                                      onClick={e => { e.stopPropagation(); handleDeleteSlot(slot); }}
                                      style={{
                                        position: 'absolute',
                                        top: '2px',
                                        right: '2px',
                                        padding: '2px 6px',
                                        fontSize: '0.7rem',
                                        background: 'var(--danger-color)',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: 'var(--radius-sm)',
                                        cursor: 'pointer',
                                      }}
                                    >
                                      ✕
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <div
                                  onClick={() => handleSlotClick(null, classId, day, period, classLevel, classShift)}
                                  style={{
                                    color: '#888',
                                    fontStyle: 'italic',
                                    padding: '0.5rem',
                                    border: '2px dashed var(--border-color)',
                                    borderRadius: 'var(--radius-sm)',
                                    cursor: 'pointer',
                                    backgroundColor: 'var(--bg-secondary)',
                                    transition: 'border-color 0.2s, background-color 0.2s',
                                  }}
                                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary-color)'; e.currentTarget.style.backgroundColor = 'rgba(79,70,229,0.05)'; }}
                                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'; }}
                                  title="Clique para adicionar aula"
                                >
                                  + Adicionar
                                </div>
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

      {/* ── Modal de Confirmação ────────────────────────────────── */}
      <Modal
        isOpen={showConfirmModal}
        onClose={() => !isGenerating && setShowConfirmModal(false)}
        title={mode === 'REPAIR' ? 'Confirmar Recálculo' : 'Atenção: Geração do Zero'}
      >
        <p style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>
          {mode === 'REPAIR'
            ? 'O sistema tentará resolver os conflitos de horário alterando apenas o necessário e preservando a maior parte da grade atual. Deseja continuar?'
            : 'ATENÇÃO: A grade inteira será apagada e o algoritmo tentará encaixar todas as aulas novamente do zero. Isso mudará completamente os horários atuais. Deseja continuar?'}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          <button className="btn btn-secondary" onClick={() => setShowConfirmModal(false)}>
            Cancelar
          </button>
          <button
            className="btn btn-primary"
            style={mode === 'SCRATCH' ? { backgroundColor: 'var(--danger-color)' } : {}}
            onClick={handleConfirmGeneration}
          >
            Sim, Iniciar
          </button>
        </div>
      </Modal>

      {/* ── Modal de Edição/Adição de Aula ─────────────────────────── */}
      <Modal
        isOpen={!!editingSlot}
        onClose={() => !isSavingSlot && setEditingSlot(null)}
        title={editingSlot?.id.startsWith('new-') ? 'Adicionar Nova Aula' : 'Editar Aula'}
      >
        {editingSlot && (
          <>
            <p style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>
              {editingSlot.id.startsWith('new-')
                ? `Adicionar aula na <strong>${editingSlot.class.name}</strong>, ${days[editingSlot.dayOfWeek - 1]}, ${editingSlot.period}ª aula.`
                : `Alterar a aula de <strong>${editingSlot.subject.name}</strong> da turma <strong>${editingSlot.class.name}</strong>.`}
            </p>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                Disciplina {editingSlot.id.startsWith('new-') ? '*' : ''}
              </label>
              <select className="input" value={selectedSubjectId} onChange={e => setSelectedSubjectId(e.target.value)}>
                <option value="">Selecione...</option>
                {subjects.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                Professor
              </label>
              <select className="input" value={selectedTeacherId} onChange={e => setSelectedTeacherId(e.target.value)}>
                <option value="">(Sem Professor)</option>
                {teachers.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
              {editingSlot.id.startsWith('new-') && (
                <button className="btn btn-secondary" onClick={() => setEditingSlot(null)}>
                  Cancelar
                </button>
              )}
              <button className="btn btn-primary" onClick={handleSaveSlot} disabled={isSavingSlot}>
                {isSavingSlot ? 'Salvando...' : editingSlot.id.startsWith('new-') ? 'Adicionar' : 'Salvar Alteração'}
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* ── Modal de Importação ──────────────────────────────────── */}
      <Modal
        isOpen={showImportModal}
        onClose={() => !isImporting && setShowImportModal(false)}
        title="Importar Grade (JSON)"
      >
        <p style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Selecione um arquivo JSON exportado anteriormente. Isso substituirá toda a grade atual.
        </p>
        <div style={{ marginBottom: '1.5rem' }}>
          <input
            type="file"
            accept=".json"
            className="input"
            onChange={e => setImportFile(e.target.files?.[0] || null)}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          <button className="btn btn-secondary" onClick={() => { setShowImportModal(false); setImportFile(null); }}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={handleImport} disabled={isImporting || !importFile}>
            {isImporting ? 'Importando...' : 'Importar'}
          </button>
        </div>
      </Modal>
    </>
  );
}
