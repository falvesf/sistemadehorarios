'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { ConfirmModal } from '@/components/ConfirmModal';
import { updateCurriculum, createCurriculum, deleteCurriculum, deleteClass, updateClass } from '../actions';
import styles from '../professores/professores.module.css';

type Curriculum = {
  id: string;
  classesPerWeek: number;
  Subject: { name: string };
  teacherId: string | null;
  Teacher: { id: string; name: string } | null;
};

type Turma = {
  id: string;
  name: string;
  level: string;
  shift: string;
  Curriculum: Curriculum[];
};

type Teacher = {
  id: string;
  name: string;
};

type Subject = {
  id: string;
  name: string;
};

export default function TurmasClient({ turmas, teachers, subjects }: { turmas: Turma[], teachers: Teacher[], subjects: Subject[] }) {
  const { showToast } = useToast();
  const router = useRouter();
  const [editingTurma, setEditingTurma] = useState<Turma | null>(null);
  
  // States for Class details
  const [className, setClassName] = useState('');
  const [classLevel, setClassLevel] = useState('');
  const [classShift, setClassShift] = useState('');

  // Local state for the curriculum being edited to allow bulk save
  const [localCurriculums, setLocalCurriculums] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Confirm dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmDeleteCurriculumId, setConfirmDeleteCurriculumId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  // State for adding new discipline to grade
  const [newSubjectId, setNewSubjectId] = useState('');

  const handleEditClick = (turma: Turma) => {
    setEditingTurma(turma);
    setClassName(turma.name);
    setClassLevel(turma.level);
    setClassShift(turma.shift);
    // clone curriculums for editing
    setLocalCurriculums(turma.Curriculum.map(c => ({ ...c })));
    setNewSubjectId('');
    setConfirmDeleteCurriculumId(null);
  };

  const handleCurriculumChange = (curriculumId: string, field: 'classesPerWeek' | 'teacherId', value: any) => {
    setLocalCurriculums(prev => prev.map(c => {
      if (c.id === curriculumId) {
        const parsed = field === 'classesPerWeek' ? parseInt(value) || 0 : value;
        return { ...c, [field]: parsed };
      }
      return c;
    }));
  };

  const handleAddSubjectToGrade = () => {
    if (!newSubjectId || !editingTurma) return;
    const subject = subjects.find(s => s.id === newSubjectId);
    setLocalCurriculums(prev => [...prev, {
      id: `new-${Date.now()}`,
      classId: editingTurma!.id,
      subjectId: newSubjectId,
      Subject: { name: subject?.name || '' },
      classesPerWeek: 1,
      teacherId: null,
      Teacher: null,
      _isNew: true,
    }]);
    setNewSubjectId('');
  };

  const handleRemoveSubjectFromGrade = async (curriculumId: string) => {
    if (curriculumId.startsWith('new-')) {
      setLocalCurriculums(prev => prev.filter(c => c.id !== curriculumId));
      return;
    }
    const result = await deleteCurriculum(curriculumId);
    if (result?.error) {
      showToast(result.error, 'error');
      return;
    }
    setLocalCurriculums(prev => prev.filter(c => c.id !== curriculumId));
    showToast('Disciplina removida da grade.', 'success');
  };

  const usedSubjectIds = localCurriculums.map(c => c.subjectId);
  const availableSubjects = subjects.filter(s => !usedSubjectIds.includes(s.id));

  const handleSave = async () => {
    if (!className.trim()) {
      showToast('O nome da turma não pode ficar vazio.', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const classRes = await updateClass(editingTurma!.id, { name: className, level: classLevel, shift: classShift });
      if (!classRes?.success) {
         showToast(classRes?.error?.includes('Unique constraint') ? 'Já existe uma turma com esse nome.' : 'Erro ao atualizar turma.', 'error');
         setIsSaving(false);
         return; 
      }

      // Save each curriculum sequentially to avoid race conditions
      for (let idx = 0; idx < localCurriculums.length; idx++) {
        const c = localCurriculums[idx];
        if (c._isNew) {
          const res = await createCurriculum(editingTurma!.id, c.subjectId, Number(c.classesPerWeek), c.teacherId === '' ? null : c.teacherId);
          if (res?.success && res.id) {
            localCurriculums[idx] = { ...c, id: res.id, _isNew: false };
          }
        } else {
          await updateCurriculum(c.id, Number(c.classesPerWeek), c.teacherId === '' ? null : c.teacherId);
        }
      }
      setLocalCurriculums([...localCurriculums]);
      showToast('Turma e Grade atualizadas com sucesso!', 'success');
      setEditingTurma(null);
      router.refresh();
    } catch (e) {
      showToast('Erro ao atualizar a turma.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteClass = async () => {
    if (!editingTurma) return;
    setConfirmOpen(true);
  };

  const executeDeleteClass = async () => {
    if (!editingTurma) return;
    setConfirmOpen(false);
    setIsSaving(true);
    try {
      const res = await deleteClass(editingTurma.id);
      if (res?.success) {
        showToast('Turma excluída com sucesso!', 'success');
        setEditingTurma(null);
      } else {
        showToast('Erro ao excluir turma.', 'error');
      }
    } catch (e) {
      showToast('Erro interno.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === turmas.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(turmas.map(t => t.id)));
    }
  };

  const handleBulkDelete = async () => {
    setBulkDeleteConfirm(false);
    const count = selectedIds.size;
    setIsSaving(true);
    let deleted = 0;
    try {
      for (const id of selectedIds) {
        const res = await deleteClass(id);
        if (res?.success) deleted++;
      }
      showToast(`${deleted} turma(s) excluída(s).${deleted < count ? ` ${count - deleted} não puderam ser excluídas.` : ''}`, deleted > 0 ? 'success' : 'error');
      setSelectedIds(new Set());
      router.refresh();
    } catch {
      showToast('Erro ao excluir turmas.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className="table-container">
        {selectedIds.size > 0 && (
          <div style={{ marginBottom: '1rem' }}>
            <button
              className="btn btn-secondary"
              style={{ color: 'var(--danger-color)', borderColor: 'var(--danger-color)' }}
              onClick={() => setBulkDeleteConfirm(true)}
            >
              Excluir {selectedIds.size} selecionada(s)
            </button>
          </div>
        )}
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: 'center', width: '40px' }}>
                <input
                  type="checkbox"
                  checked={selectedIds.size === turmas.length && turmas.length > 0}
                  onChange={toggleSelectAll}
                />
              </th>
              <th>Turma</th>
              <th>Nível</th>
              <th>Turno</th>
              <th>Grade Curricular (Matéria - Prof)</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {turmas.map(t => (
              <tr key={t.id} style={{ backgroundColor: selectedIds.has(t.id) ? '#f0f0ff' : undefined }}>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(t.id)}
                    onChange={() => toggleSelect(t.id)}
                  />
                </td>
                <td><strong>{t.name}</strong></td>
                <td>{t.level}</td>
                <td>{t.shift === 'MORNING' ? 'Manhã' : 'Tarde'}</td>
                <td>
                  <div className={styles.curriculumList}>
                    {t.Curriculum.map(c => (
                      <span key={c.id} className={styles.curriculumItem}>
                        <strong>{c.Subject.name}</strong> 
                        {c.Teacher ? ` (${c.Teacher.name})` : ''} 
                        <span style={{opacity: 0.6}}> - {c.classesPerWeek}x</span>
                      </span>
                    ))}
                    {t.Curriculum.length === 0 && <span className={styles.empty}>Grade vazia</span>}
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn btn-secondary" onClick={() => handleEditClick(t)}>Editar Grade</button>
                    <button
                      className="btn btn-secondary"
                      style={{ color: 'var(--danger-color)', borderColor: 'var(--danger-color)' }}
                      onClick={() => {
                        setEditingTurma(t);
                        setConfirmOpen(true);
                      }}
                    >
                      Excluir
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal isOpen={!!editingTurma} onClose={() => setEditingTurma(null)} title={`Editar Turma`}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
          <div>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Nome da Turma</label>
            <input 
              type="text" 
              className="input" 
              value={className} 
              onChange={e => setClassName(e.target.value)} 
            />
          </div>
          <div>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Nível</label>
            <select className="input" value={classLevel} onChange={e => setClassLevel(e.target.value)}>
              <option value="INFANTIL">Infantil</option>
              <option value="FUND1">Fund. I</option>
              <option value="FUND2">Fund. II</option>
              <option value="MEDIO">Médio</option>
            </select>
          </div>
          <div>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Turno</label>
            <select className="input" value={classShift} onChange={e => setClassShift(e.target.value)}>
              <option value="MORNING">Manhã</option>
              <option value="AFTERNOON">Tarde</option>
            </select>
          </div>
        </div>

        <hr style={{ border: 0, borderTop: '1px solid var(--border-color)', margin: '1.5rem 0' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h4 style={{ color: 'var(--primary-color)', margin: 0 }}>Grade Curricular</h4>
          <span style={{
            fontSize: '0.9rem',
            fontWeight: 'bold',
            color: 'var(--primary-color)',
            backgroundColor: '#ede9fe',
            padding: '0.25rem 0.75rem',
            borderRadius: 'var(--radius-sm)',
          }}>
            {localCurriculums.reduce((sum, c) => sum + c.classesPerWeek, 0)} aulas
          </span>
        </div>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
          Ajuste a quantidade de aulas na semana e o professor responsável por cada disciplina.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem', maxHeight: '40vh', overflowY: 'auto', paddingRight: '0.5rem' }}>
          {localCurriculums.map(c => (
            <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr auto', gap: '1rem', alignItems: 'center' }}>
              <strong style={{ fontSize: '0.875rem' }}>{c.Subject?.name || '???'}</strong>
              
              <input 
                type="number" 
                className="input" 
                value={c.classesPerWeek} 
                min="1" 
                max="20"
                onChange={e => handleCurriculumChange(c.id, 'classesPerWeek', e.target.value)}
                title="Aulas por semana"
              />

              <select 
                className="input" 
                value={c.teacherId || ''} 
                onChange={e => handleCurriculumChange(c.id, 'teacherId', e.target.value)}
              >
                <option value="">(Sem Professor)</option>
                {teachers.map(prof => (
                  <option key={prof.id} value={prof.id}>{prof.name}</option>
                ))}
              </select>

              <button
                className="btn"
                onClick={() => handleRemoveSubjectFromGrade(c.id)}
                style={{ backgroundColor: 'var(--danger-color)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
                title="Remover disciplina da grade"
              >
                ✕
              </button>
            </div>
          ))}
          {localCurriculums.length === 0 && <p style={{color: 'var(--text-secondary)'}}>Nenhuma disciplina vinculada.</p>}
        </div>

        {availableSubjects.length > 0 && (
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', alignItems: 'center' }}>
            <select className="input" value={newSubjectId} onChange={e => setNewSubjectId(e.target.value)} style={{ flex: 1 }}>
              <option value="">Adicionar disciplina...</option>
              {availableSubjects.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button className="btn btn-primary" onClick={handleAddSubjectToGrade} disabled={!newSubjectId}>
              + Adicionar
            </button>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
          <button className="btn btn-secondary" style={{ color: 'var(--danger-color)', borderColor: 'var(--danger-color)' }} onClick={handleDeleteClass} disabled={isSaving}>
            Excluir Turma
          </button>
          
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button className="btn btn-secondary" onClick={() => setEditingTurma(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Salvando...' : 'Salvar Alterações'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={executeDeleteClass}
        title="Excluir Turma"
        message={`Tem certeza que deseja apagar a turma ${editingTurma?.name} inteira do sistema? Isso apagará toda a grade curricular e horários associados a ela e não pode ser desfeito.`}
        confirmLabel="Excluir"
        variant="danger"
      />

      <ConfirmModal
        isOpen={bulkDeleteConfirm}
        onClose={() => setBulkDeleteConfirm(false)}
        onConfirm={handleBulkDelete}
        title="Excluir Turmas"
        message={`Tem certeza que deseja excluir ${selectedIds.size} turma(s) selecionada(s)? Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        variant="danger"
      />
    </>
  );
}
