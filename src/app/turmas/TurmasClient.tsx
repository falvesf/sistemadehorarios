'use client';

import { useState } from 'react';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { ConfirmModal } from '@/components/ConfirmModal';
import { updateCurriculum, deleteClass, updateClass } from '../actions';
import styles from '../professores/professores.module.css';

type Curriculum = {
  id: string;
  classesPerWeek: number;
  subject: { name: string };
  teacherId: string | null;
  teacher: { id: string; name: string } | null;
};

type Turma = {
  id: string;
  name: string;
  level: string;
  shift: string;
  curriculums: Curriculum[];
};

type Teacher = {
  id: string;
  name: string;
};

export default function TurmasClient({ turmas, teachers }: { turmas: Turma[], teachers: Teacher[] }) {
  const { showToast } = useToast();
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

  const handleEditClick = (turma: Turma) => {
    setEditingTurma(turma);
    setClassName(turma.name);
    setClassLevel(turma.level);
    setClassShift(turma.shift);
    // clone curriculums for editing
    setLocalCurriculums(turma.curriculums.map(c => ({ ...c })));
  };

  const handleCurriculumChange = (curriculumId: string, field: 'classesPerWeek' | 'teacherId', value: any) => {
    setLocalCurriculums(prev => prev.map(c => {
      if (c.id === curriculumId) {
        return { ...c, [field]: value };
      }
      return c;
    }));
  };

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

      // call updateCurriculum for each changed item sequentially (or Promise.all)
      await Promise.all(
        localCurriculums.map(c => updateCurriculum(c.id, Number(c.classesPerWeek), c.teacherId === '' ? null : c.teacherId))
      );
      showToast('Turma e Grade atualizadas com sucesso!', 'success');
      setEditingTurma(null);
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

  return (
    <>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Turma</th>
              <th>Nível</th>
              <th>Turno</th>
              <th>Grade Curricular (Matéria - Prof)</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {turmas.map(t => (
              <tr key={t.id}>
                <td><strong>{t.name}</strong></td>
                <td>{t.level}</td>
                <td>{t.shift === 'MORNING' ? 'Manhã' : 'Tarde'}</td>
                <td>
                  <div className={styles.curriculumList}>
                    {t.curriculums.map(c => (
                      <span key={c.id} className={styles.curriculumItem}>
                        <strong>{c.subject.name}</strong> 
                        {c.teacher ? ` (${c.teacher.name})` : ''} 
                        <span style={{opacity: 0.6}}> - {c.classesPerWeek}x</span>
                      </span>
                    ))}
                    {t.curriculums.length === 0 && <span className={styles.empty}>Grade vazia</span>}
                  </div>
                </td>
                <td>
                  <button className="btn btn-secondary" onClick={() => handleEditClick(t)}>Editar Grade</button>
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

        <h4 style={{ marginBottom: '0.5rem', color: 'var(--primary-color)' }}>Grade Curricular</h4>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
          Ajuste a quantidade de aulas na semana e o professor responsável por cada disciplina.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem', maxHeight: '40vh', overflowY: 'auto', paddingRight: '0.5rem' }}>
          {localCurriculums.map(c => (
            <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr', gap: '1rem', alignItems: 'center' }}>
              <strong style={{ fontSize: '0.875rem' }}>{c.subject.name}</strong>
              
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
            </div>
          ))}
          {localCurriculums.length === 0 && <p style={{color: 'var(--text-secondary)'}}>Nenhuma disciplina vinculada.</p>}
        </div>

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
    </>
  );
}
