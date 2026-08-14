'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { ConfirmModal } from '@/components/ConfirmModal';
import { createSubject, updateSubject, deleteSubject } from './actions';

type Subject = {
  id: string;
  name: string;
  _count: { Curriculum: number; Schedule: number };
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) { showToast('Digite o nome da disciplina.', 'error'); return; }
    setIsSaving(true);
    try {
      const res = await createSubject(newName);
      if (res.success) {
        showToast('Disciplina criada!', 'success');
        setSubjects(prev => [...prev, { id: res.id || Date.now().toString(), name: newName.trim(), _count: { Curriculum: 0, Schedule: 0 } }]);
        setNewName('');
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

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === subjects.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(subjects.map(s => s.id)));
    }
  };

  const handleBulkDelete = async () => {
    setBulkDeleteConfirm(false);
    const count = selectedIds.size;
    setIsSaving(true);
    let deleted = 0;
    let errors = 0;
    try {
      for (const id of selectedIds) {
        const res = await deleteSubject(id);
        if (res?.success) deleted++;
        else errors++;
      }
      if (deleted > 0) {
        showToast(`${deleted} disciplina(s) excluída(s).${errors > 0 ? ` ${errors} não puderam ser excluídas (vinculadas a grades).` : ''}`, deleted === count ? 'success' : 'info');
      } else {
        showToast('Nenhuma disciplina pôde ser excluída. Verifique se estão vinculadas a grades.', 'error');
      }
      setSelectedIds(new Set());
      router.refresh();
    } catch {
      showToast('Erro ao excluir disciplinas.', 'error');
    } finally {
      setIsSaving(false);
    }
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

        {selectedIds.size > 0 && (
          <div style={{ marginBottom: '1rem' }}>
            <button
              className="btn btn-secondary"
              style={{ color: 'var(--danger-color)', borderColor: 'var(--danger-color)' }}
              onClick={() => setBulkDeleteConfirm(true)}
            >
              Excluir {selectedIds.size} selecionado(s)
            </button>
          </div>
        )}

        {subjects.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>Nenhuma disciplina cadastrada.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr>
                <th style={{ borderBottom: '2px solid var(--border-color)', padding: '0.75rem 0.5rem', textAlign: 'center', width: '40px' }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.size === subjects.length && subjects.length > 0}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th style={{ borderBottom: '2px solid var(--border-color)', padding: '0.75rem 0.5rem', textAlign: 'left' }}>Nome</th>
                <th style={{ borderBottom: '2px solid var(--border-color)', padding: '0.75rem 0.5rem', textAlign: 'center' }}>Grades</th>
                <th style={{ borderBottom: '2px solid var(--border-color)', padding: '0.75rem 0.5rem', textAlign: 'center' }}>Horários</th>
                <th style={{ borderBottom: '2px solid var(--border-color)', padding: '0.75rem 0.5rem', textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map(s => (
                <tr key={s.id} style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: selectedIds.has(s.id) ? '#f0f0ff' : undefined }}>
                  <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(s.id)}
                      onChange={() => toggleSelect(s.id)}
                    />
                  </td>
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
                    {s._count.Curriculum}
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    {s._count.Schedule}
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
                          className="btn btn-secondary"
                          style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem', color: 'var(--danger-color)', borderColor: 'var(--danger-color)' }}
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

      <ConfirmModal
        isOpen={bulkDeleteConfirm}
        onClose={() => setBulkDeleteConfirm(false)}
        onConfirm={handleBulkDelete}
        title="Excluir Disciplinas"
        message={`Tem certeza que deseja excluir ${selectedIds.size} disciplina(s) selecionada(s)? Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        variant="danger"
      />
    </>
  );
}
