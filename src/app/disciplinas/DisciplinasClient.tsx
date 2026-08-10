'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { ConfirmModal } from '@/components/ConfirmModal';
import { createSubject, updateSubject, deleteSubject } from './actions';

type Subject = {
  id: string;
  name: string;
  _count: { curriculums: number; schedules: number };
};

export default function DisciplinasClient({ initialSubjects }: { initialSubjects: Subject[] }) {
  const { showToast } = useToast();
  const router = useRouter();
  const [subjects, setSubjects] = useState(initialSubjects);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: string | null; name: string }>({ open: false, id: null, name: '' });

  const handleCreate = async () => {
    if (!newName.trim()) { showToast('Digite o nome da disciplina.', 'error'); return; }
    setIsSaving(true);
    try {
      const res = await createSubject(newName);
      if (res.success) {
        showToast('Disciplina criada!', 'success');
        setNewName('');
        router.refresh();
      } else {
        showToast(res.error || 'Erro ao criar.', 'error');
      }
    } catch {
      showToast('Erro interno.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdate = async (id: string) => {
    if (!editingName.trim()) { showToast('Nome não pode ser vazio.', 'error'); return; }
    setIsSaving(true);
    try {
      const res = await updateSubject(id, editingName);
      if (res.success) {
        showToast('Disciplina atualizada!', 'success');
        setEditingId(null);
        setEditingName('');
        router.refresh();
      } else {
        showToast(res.error || 'Erro ao atualizar.', 'error');
      }
    } catch {
      showToast('Erro interno.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteClick = (id: string, name: string) => {
    setDeleteConfirm({ open: true, id, name });
  };

  const executeDelete = async () => {
    const { id } = deleteConfirm;
    setDeleteConfirm({ open: false, id: null, name: '' });
    if (!id) return;
    setIsSaving(true);
    try {
      const res = await deleteSubject(id);
      if (res.success) {
        showToast('Disciplina excluída.', 'success');
        router.refresh();
      } else {
        showToast(res.error || 'Erro ao excluir.', 'error');
      }
    } catch {
      showToast('Erro interno.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const startEdit = (id: string, name: string) => {
    setEditingId(id);
    setEditingName(name);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingName('');
  };

  return (
    <>
      <div className="table-container" style={{ padding: '2rem', marginBottom: '2rem' }}>
        <h3 style={{ marginBottom: '1rem', color: 'var(--primary-color)' }}>Nova Disciplina</h3>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, maxWidth: '400px' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
              Nome
            </label>
            <input
              className="input"
              type="text"
              placeholder="Ex: Matemática"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
            />
          </div>
          <button className="btn btn-primary" onClick={handleCreate} disabled={isSaving}>
            {isSaving ? 'Salvando...' : '+ Adicionar'}
          </button>
        </div>
      </div>

      <div className="table-container" style={{ padding: '2rem' }}>
        <h3 style={{ marginBottom: '1rem', color: 'var(--primary-color)' }}>
          Disciplinas Cadastradas ({subjects.length})
        </h3>

        {subjects.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>Nenhuma disciplina cadastrada.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr>
                <th style={{ borderBottom: '2px solid var(--border-color)', padding: '0.75rem 0.5rem', textAlign: 'left' }}>Nome</th>
                <th style={{ borderBottom: '2px solid var(--border-color)', padding: '0.75rem 0.5rem', textAlign: 'center' }}>Grades</th>
                <th style={{ borderBottom: '2px solid var(--border-color)', padding: '0.75rem 0.5rem', textAlign: 'center' }}>Horários</th>
                <th style={{ borderBottom: '2px solid var(--border-color)', padding: '0.75rem 0.5rem', textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map(s => (
                <tr key={s.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '0.75rem 0.5rem' }}>
                    {editingId === s.id ? (
                      <input
                        className="input"
                        type="text"
                        value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleUpdate(s.id);
                          if (e.key === 'Escape') cancelEdit();
                        }}
                        autoFocus
                        style={{ padding: '0.35rem 0.5rem', fontSize: '0.875rem' }}
                      />
                    ) : (
                      <span style={{ fontWeight: 500 }}>{s.name}</span>
                    )}
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    {s._count.curriculums}
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    {s._count.schedules}
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                    {editingId === s.id ? (
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <button
                          className="btn btn-primary"
                          style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}
                          onClick={() => handleUpdate(s.id)}
                          disabled={isSaving}
                        >
                          Salvar
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}
                          onClick={cancelEdit}
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}
                          onClick={() => startEdit(s.id, s.name)}
                        >
                          Editar
                        </button>
                        <button
                          style={{
                            padding: '0.3rem 0.75rem',
                            fontSize: '0.8rem',
                            background: 'var(--danger-color)',
                            color: 'white',
                            border: 'none',
                            borderRadius: 'var(--radius-sm)',
                            cursor: 'pointer',
                          }}
                          onClick={() => handleDeleteClick(s.id, s.name)}
                        >
                          Excluir
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmModal
        isOpen={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, id: null, name: '' })}
        onConfirm={executeDelete}
        title="Excluir Disciplina"
        message={`Tem certeza que deseja excluir "${deleteConfirm.name}"?`}
        confirmLabel="Excluir"
        variant="danger"
      />
    </>
  );
}
