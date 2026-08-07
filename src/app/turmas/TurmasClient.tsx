'use client';

import { useState } from 'react';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { updateCurriculum, deleteClass } from '../actions';
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
  
  // Local state for the curriculum being edited to allow bulk save
  const [localCurriculums, setLocalCurriculums] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const handleEditClick = (turma: Turma) => {
    setEditingTurma(turma);
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
    setIsSaving(true);
    try {
      // call updateCurriculum for each changed item sequentially (or Promise.all)
      await Promise.all(
        localCurriculums.map(c => updateCurriculum(c.id, Number(c.classesPerWeek), c.teacherId === '' ? null : c.teacherId))
      );
      showToast('Grade atualizada com sucesso!', 'success');
      setEditingTurma(null);
    } catch (e) {
      showToast('Erro ao atualizar a grade curricular.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteClass = async () => {
    if (!editingTurma) return;
    if (!confirm(`Tem certeza que deseja apagar a turma ${editingTurma.name} inteira do sistema? Isso apagará toda a grade curricular e horários associados a ela e não pode ser desfeito.`)) return;

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

      <Modal isOpen={!!editingTurma} onClose={() => setEditingTurma(null)} title={`Editar Grade - ${editingTurma?.name}`}>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
          Ajuste a quantidade de aulas na semana e o professor responsável por cada disciplina nesta turma.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
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
    </>
  );
}
