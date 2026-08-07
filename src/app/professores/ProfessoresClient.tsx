'use client';

import { useState } from 'react';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { updateTeacher } from '../actions';
import styles from './professores.module.css';

type Teacher = {
  id: string;
  name: string;
  type: 'REGENTE' | 'AULISTA';
  curriculums: any[];
};

export default function ProfessoresClient({ professores }: { professores: Teacher[] }) {
  const { showToast } = useToast();
  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<'REGENTE' | 'AULISTA'>('REGENTE');
  const [isSaving, setIsSaving] = useState(false);

  const handleEditClick = (teacher: Teacher) => {
    setEditingTeacher(teacher);
    setName(teacher.name);
    setType(teacher.type);
  };

  const handleSave = async () => {
    if (!editingTeacher) return;
    setIsSaving(true);
    try {
      await updateTeacher(editingTeacher.id, { name, type });
      showToast('Professor atualizado com sucesso!', 'success');
      setEditingTeacher(null);
    } catch (e) {
      showToast('Erro ao atualizar professor.', 'error');
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
              <th>Nome</th>
              <th>Tipo</th>
              <th>Turmas/Disciplinas</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {professores.map(p => (
              <tr key={p.id}>
                <td><strong>{p.name}</strong></td>
                <td>
                  <span className={`${styles.badge} ${p.type === 'REGENTE' ? styles.badgeRegente : styles.badgeAulista}`}>
                    {p.type}
                  </span>
                </td>
                <td>
                  <div className={styles.curriculumList}>
                    {p.curriculums.map(c => (
                      <span key={c.id} className={styles.curriculumItem}>
                        {c.class.name} - {c.subject.name}
                      </span>
                    ))}
                    {p.curriculums.length === 0 && <span className={styles.empty}>Nenhuma</span>}
                  </div>
                </td>
                <td>
                  <button className="btn btn-secondary" onClick={() => handleEditClick(p)}>Editar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal isOpen={!!editingTeacher} onClose={() => setEditingTeacher(null)} title="Editar Professor">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
          <div>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Nome</label>
            <input 
              type="text" 
              className="input" 
              value={name} 
              onChange={e => setName(e.target.value)} 
            />
          </div>
          <div>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Tipo</label>
            <select 
              className="input" 
              value={type} 
              onChange={e => setType(e.target.value as 'REGENTE' | 'AULISTA')}
            >
              <option value="REGENTE">Regente</option>
              <option value="AULISTA">Aulista</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          <button className="btn btn-secondary" onClick={() => setEditingTeacher(null)}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </div>
      </Modal>
    </>
  );
}
