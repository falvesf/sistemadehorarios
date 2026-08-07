'use client';

import { useState } from 'react';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { updateTeacher, createTeacher, deleteTeacher } from '../actions';
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
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<'REGENTE' | 'AULISTA'>('REGENTE');
  const [isSaving, setIsSaving] = useState(false);
  const [mergeConfirm, setMergeConfirm] = useState<{ isOpen: boolean, oldName: string, newName: string }>({ isOpen: false, oldName: '', newName: '' });

  const handleEditClick = (teacher: Teacher) => {
    setEditingTeacher(teacher);
    setName(teacher.name);
    setType(teacher.type);
  };

  const handleCreateClick = () => {
    setName('');
    setType('REGENTE');
    setIsCreating(true);
  };

  const handleSave = async (isForceMerge: boolean = false) => {
    if (!name.trim()) {
      showToast('O nome não pode ficar vazio.', 'error');
      return;
    }
    
    setIsSaving(true);
    try {
      if (editingTeacher) {
        const res = await updateTeacher(editingTeacher.id, { name, type }, isForceMerge);
        if (res?.success) {
          showToast('Professor atualizado com sucesso!', 'success');
          setEditingTeacher(null);
        } else if (res?.error === 'EXISTS' || res?.error?.includes('Unique constraint')) {
          setMergeConfirm({ isOpen: true, oldName: editingTeacher.name, newName: name });
        } else {
          showToast(`Erro: ${res?.error || 'Desconhecido'}`, 'error');
        }
      } else if (isCreating) {
        const res = await createTeacher({ name, type });
        if (res?.success) {
          showToast('Professor cadastrado com sucesso!', 'success');
          setIsCreating(false);
        } else {
          showToast(res?.error?.includes('Unique constraint') ? 'Este nome já existe.' : `Erro: ${res?.error}`, 'error');
        }
      }
    } catch (e: any) {
      showToast(`Erro interno: ${e.message}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingTeacher) return;
    if (!confirm(`Tem certeza que deseja excluir o(a) professor(a) ${editingTeacher.name}? As matérias dele(a) ficarão "Sem Professor".`)) return;
    
    setIsSaving(true);
    try {
      const res = await deleteTeacher(editingTeacher.id);
      if (res?.success) {
        showToast('Professor excluído com sucesso!', 'success');
        setEditingTeacher(null);
      } else {
        showToast('Erro ao excluir professor.', 'error');
      }
    } catch (e) {
      showToast('Erro interno.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
        <button className="btn btn-primary" onClick={handleCreateClick}>+ Novo Professor</button>
      </div>

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

      <Modal isOpen={!!editingTeacher || isCreating} onClose={() => { setEditingTeacher(null); setIsCreating(false); }} title={isCreating ? "Novo Professor" : "Editar Professor"}>
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
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
          {!isCreating ? (
            <button className="btn btn-secondary" style={{ color: 'var(--danger-color)', borderColor: 'var(--danger-color)' }} onClick={handleDelete} disabled={isSaving}>Excluir</button>
          ) : <div></div>}
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button className="btn btn-secondary" onClick={() => { setEditingTeacher(null); setIsCreating(false); }}>Cancelar</button>
            <button className="btn btn-primary" onClick={() => handleSave(false)} disabled={isSaving}>
              {isSaving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={mergeConfirm.isOpen} onClose={() => setMergeConfirm({ ...mergeConfirm, isOpen: false })} title="Confirmar Mesclagem">
        <div style={{ marginBottom: '1.5rem' }}>
          <p style={{ marginBottom: '1rem' }}>
            Já existe um professor chamado <strong>{mergeConfirm.newName}</strong>.
          </p>
          <p style={{ color: 'var(--danger-color)', fontWeight: 'bold' }}>
            Deseja MESCLAR os dois cadastros?
          </p>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            Todas as turmas e aulas atribuídas a <em>{mergeConfirm.oldName}</em> serão transferidas para <strong>{mergeConfirm.newName}</strong>, e o cadastro antigo será permanentemente excluído.
          </p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          <button className="btn btn-secondary" onClick={() => setMergeConfirm({ ...mergeConfirm, isOpen: false })} disabled={isSaving}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => {
            setMergeConfirm({ ...mergeConfirm, isOpen: false });
            handleSave(true);
          }} disabled={isSaving}>
            Confirmar Mesclagem
          </button>
        </div>
      </Modal>
    </>
  );
}
