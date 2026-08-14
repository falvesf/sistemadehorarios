'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { ConfirmModal } from '@/components/ConfirmModal';
import { updateTeacher, createTeacher, deleteTeacher, saveTeacherCurriculums, getClassesAndSubjects } from '../actions';
import { getTeacherAvailability, saveTeacherAvailability } from '../restricoes/actions';
import styles from './professores.module.css';

type Teacher = {
  id: string;
  name: string;
  type: string;
  Curriculum: {
    id: string;
    Class: { name: string; shift: string };
    Subject: { name: string };
  }[];
};

type AvailabilitySlot = { dayOfWeek: number; period: number; isAvailable: boolean };

type TimeSlot = {
  id: string;
  level: string;
  shift: string;
  dayOfWeek: number;
  period: number;
  startTime: string;
  endTime: string;
};

const days = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
const morningPeriods = [1, 2, 3, 4, 5, 6];
const afternoonPeriods = [7, 8, 9, 10, 11, 12];
const allPeriods = [...morningPeriods, ...afternoonPeriods];

function createDefaultGrid(): AvailabilitySlot[] {
  const grid: AvailabilitySlot[] = [];
  for (let d = 1; d <= 5; d++) {
    allPeriods.forEach(p => grid.push({ dayOfWeek: d, period: p, isAvailable: true }));
  }
  return grid;
}

export default function ProfessoresClient({
  professores,
  timeSlots,
}: {
  professores: Teacher[];
  timeSlots: TimeSlot[];
}) {
  const { showToast } = useToast();
  const router = useRouter();
  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('REGENTE');
  const [isSaving, setIsSaving] = useState(false);
  const [mergeConfirm, setMergeConfirm] = useState<{ isOpen: boolean; oldName: string; newName: string }>({
    isOpen: false,
    oldName: '',
    newName: '',
  });
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  // ── Availability states ──────────────────────────────────────
  const [grid, setGrid] = useState<AvailabilitySlot[]>([]);
  const [isLoadingGrid, setIsLoadingGrid] = useState(false);
  // Level selector for viewing times in the availability grid
  const [availLevel, setAvailLevel] = useState<string>('FUND2');

  // ── Curriculum states ────────────────────────────────────────
  const [curriculums, setCurriculums] = useState<{ classId: string; subjectId: string; classesPerWeek: number }[]>([]);
  const [allClasses, setAllClasses] = useState<{ id: string; name: string; level: string; shift: string }[]>([]);
  const [allSubjects, setAllSubjects] = useState<{ id: string; name: string }[]>([]);

  // Load availability grid whenever we open a teacher for editing
  useEffect(() => {
    if (editingTeacher) {
      loadGrid(editingTeacher.id);
      loadCurriculumData(editingTeacher);
    } else {
      setGrid([]);
      setCurriculums([]);
    }
  }, [editingTeacher?.id]);

  const loadGrid = async (teacherId: string) => {
    setIsLoadingGrid(true);
    try {
      const saved = await getTeacherAvailability(teacherId);
      const newGrid = createDefaultGrid();
      saved.forEach(s => {
        // DB: period 1-6 + shift (MORNING/AFTERNOON)
        // Grid: morning 1-6, afternoon 7-12
        const gridPeriod = s.shift === 'AFTERNOON' ? s.period + 6 : s.period;
        const idx = newGrid.findIndex(g => g.dayOfWeek === s.dayOfWeek && g.period === gridPeriod);
        if (idx !== -1) newGrid[idx].isAvailable = s.isAvailable;
      });
      setGrid(newGrid);
    } catch {
      showToast('Erro ao carregar disponibilidade.', 'error');
    } finally {
      setIsLoadingGrid(false);
    }
  };

  const loadCurriculumData = async (teacher: Teacher) => {
    try {
      const { classes, subjects } = await getClassesAndSubjects();
      setAllClasses(classes);
      setAllSubjects(subjects);
      const teacherCurrs = teacher.Curriculum.map(c => {
        const classObj = classes.find((cl: any) => cl.name === c.Class.name);
        const subjectObj = subjects.find((s: any) => s.name === c.Subject.name);
        return {
          classId: classObj?.id || '',
          subjectId: subjectObj?.id || '',
          classesPerWeek: 1,
        };
      }).filter(c => c.classId && c.subjectId);
      setCurriculums(teacherCurrs);
    } catch {
      showToast('Erro ao carregar turmas e disciplinas.', 'error');
    }
  };

  const handleToggleSlot = (dayOfWeek: number, period: number) => {
    setGrid(prev =>
      prev.map(slot =>
        slot.dayOfWeek === dayOfWeek && slot.period === period
          ? { ...slot, isAvailable: !slot.isAvailable }
          : slot
      )
    );
  };

  /**
   * Toggle all slots in a given day column for a given shift.
   * If ALL are blocked → unblock all.  Otherwise → block all.
   */
  const handleToggleAllShift = (dayOfWeek: number, isMorning: boolean) => {
    const periodsToToggle = isMorning ? morningPeriods : afternoonPeriods;
    const areAllBlocked = periodsToToggle.every(p => {
      const slot = grid.find(g => g.dayOfWeek === dayOfWeek && g.period === p);
      return slot ? !slot.isAvailable : false;
    });
    // If all blocked → make all available; else block all
    setGrid(prev =>
      prev.map(slot =>
        slot.dayOfWeek === dayOfWeek && periodsToToggle.includes(slot.period)
          ? { ...slot, isAvailable: areAllBlocked }
          : slot
      )
    );
  };

  /** Returns true if all slots in this column/shift are blocked */
  const areAllBlocked = (dayOfWeek: number, isMorning: boolean): boolean => {
    const periodsToCheck = isMorning ? morningPeriods : afternoonPeriods;
    return periodsToCheck.every(p => {
      const slot = grid.find(g => g.dayOfWeek === dayOfWeek && g.period === p);
      return slot ? !slot.isAvailable : false;
    });
  };

  /** Get time label for a period in the availability grid (uses selectedLevel and Monday as ref day) */
  const getAvailTime = (period: number, isMorning: boolean): string | null => {
    const shift = isMorning ? 'MORNING' : 'AFTERNOON';
    // For morning: period is 1-6 directly. For afternoon: period 7-12 → DB period 1-6.
    const dbPeriod = isMorning ? period : period - 6;
    const ts =
      timeSlots.find(t => t.level === availLevel && t.shift === shift && t.period === dbPeriod && t.dayOfWeek === 1) ??
      timeSlots.find(t => t.level === availLevel && t.shift === shift && t.period === dbPeriod);
    return ts ? `${ts.startTime}–${ts.endTime}` : null;
  };

  // ── Teacher CRUD handlers ────────────────────────────────────

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

  /**
   * Unified save: saves teacher data, availability, and curriculums (when editing).
   */
  const handleSave = async (isForceMerge: boolean = false) => {
    if (!name.trim()) { showToast('O nome não pode ficar vazio.', 'error'); return; }
    setIsSaving(true);
    try {
      if (editingTeacher) {
        // 1. Save teacher basic data
        const res = await updateTeacher(editingTeacher.id, { name, type: type as 'REGENTE' | 'AULISTA' }, isForceMerge);
        if (res?.success) {
          // 2. Save availability
          const slotsToSave = grid.filter(g => !g.isAvailable);
          await saveTeacherAvailability(editingTeacher.id, slotsToSave);
          // 3. Save curriculums
          const validCurriculums = curriculums.filter(c => c.classId && c.subjectId);
          await saveTeacherCurriculums(editingTeacher.id, validCurriculums);
          showToast('Professor salvo com sucesso!', 'success');
          setEditingTeacher(null);
        } else if (res?.error === 'EXISTS' || res?.error?.includes('Unique constraint')) {
          setMergeConfirm({ isOpen: true, oldName: editingTeacher.name, newName: name });
        } else {
          showToast(`Erro: ${res?.error || 'Desconhecido'}`, 'error');
        }
      } else if (isCreating) {
        const res = await createTeacher({ name, type: type as 'REGENTE' | 'AULISTA' });
        if (res?.success) {
          showToast('Professor cadastrado com sucesso!', 'success');
          setIsCreating(false);
        } else {
          showToast(
            res?.error?.includes('Unique constraint') ? 'Este nome já existe.' : `Erro: ${res?.error}`,
            'error'
          );
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
    setDeleteConfirmOpen(true);
  };

  const executeDelete = async () => {
    if (!editingTeacher) return;
    setDeleteConfirmOpen(false);
    setIsSaving(true);
    try {
      const res = await deleteTeacher(editingTeacher.id);
      if (res?.success) {
        showToast('Professor excluído com sucesso!', 'success');
        setEditingTeacher(null);
      } else {
        showToast('Erro ao excluir professor.', 'error');
      }
    } catch {
      showToast('Erro interno.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === professores.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(professores.map(p => p.id)));
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

  const handleBulkDelete = async () => {
    setBulkDeleteConfirm(false);
    setIsSaving(true);
    let deleted = 0;
    for (const id of selectedIds) {
      const res = await deleteTeacher(id);
      if (res?.success) deleted++;
    }
    setSelectedIds(new Set());
    showToast(`${deleted} professor(es) excluído(s)!`, deleted > 0 ? 'success' : 'error');
    router.refresh();
    setIsSaving(false);
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          {selectedIds.size > 0 && (
            <button className="btn btn-secondary" style={{ color: 'var(--danger-color)', borderColor: 'var(--danger-color)' }} onClick={() => setBulkDeleteConfirm(true)}>
              Excluir {selectedIds.size} selecionado(s)
            </button>
          )}
        </div>
        <button className="btn btn-primary" onClick={handleCreateClick}>+ Novo Professor</button>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th style={{ width: '40px' }}>
                <input
                  type="checkbox"
                  checked={selectedIds.size === professores.length && professores.length > 0}
                  onChange={toggleSelectAll}
                  style={{ cursor: 'pointer' }}
                />
              </th>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Turmas/Disciplinas</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {professores.map(p => (
              <tr key={p.id} style={selectedIds.has(p.id) ? { backgroundColor: '#f0f0ff' } : undefined}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(p.id)}
                    onChange={() => toggleSelect(p.id)}
                    style={{ cursor: 'pointer' }}
                  />
                </td>
                <td><strong>{p.name}</strong></td>
                <td>
                  <span className={`${styles.badge} ${p.type === 'REGENTE' ? styles.badgeRegente : styles.badgeAulista}`}>
                    {p.type}
                  </span>
                </td>
                <td>
                  <div className={styles.curriculumList}>
                    {p.Curriculum.map(c => (
                      <span key={c.id} className={styles.curriculumItem}>
                        {c.Class.name} - {c.Subject.name}
                      </span>
                    ))}
                    {p.Curriculum.length === 0 && <span className={styles.empty}>Nenhuma</span>}
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn btn-secondary" onClick={() => handleEditClick(p)}>Editar</button>
                    <button
                      className="btn btn-secondary"
                      style={{ color: 'var(--danger-color)', borderColor: 'var(--danger-color)', padding: '0.35rem 0.6rem', fontSize: '0.8rem' }}
                      onClick={() => { setEditingTeacher(p); setDeleteConfirmOpen(true); }}
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

      {/* ── Modal de Edição / Criação ──────────────────────────────── */}
      <Modal
        isOpen={!!editingTeacher || isCreating}
        onClose={() => { setEditingTeacher(null); setIsCreating(false); }}
        title={isCreating ? 'Novo Professor' : 'Editar Professor'}
        size="lg"
      >
        {/* Dados básicos */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
          <div>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Nome</label>
            <input type="text" className="input" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Tipo</label>
            <select className="input" value={type} onChange={e => setType(e.target.value as 'REGENTE' | 'AULISTA')}>
              <option value="REGENTE">Regente</option>
              <option value="AULISTA">Aulista</option>
            </select>
          </div>
        </div>

        {/* ── Disponibilidade Específica (apenas na edição) ─────── */}
        {editingTeacher && (
          <>
            <hr style={{ border: 0, borderTop: '1px solid var(--border-color)', margin: '1.5rem 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h4 style={{ color: 'var(--primary-color)', margin: 0 }}>Disponibilidade Específica</h4>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Ver horários de:</label>
                <select
                  className="input"
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                  value={availLevel}
                  onChange={e => setAvailLevel(e.target.value)}
                >
                  <option value="INFANTIL">Infantil</option>
                  <option value="FUND1">Fund. I</option>
                  <option value="FUND2">Fund. II</option>
                </select>
              </div>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '1rem' }}>
              Clique nos horários para bloquear os períodos em que este professor não pode dar aula.
              {' '}
              <span style={{ color: 'var(--success-color)', fontWeight: 600 }}>Verde = Livre</span>
              {' · '}
              <span style={{ color: 'var(--danger-color)', fontWeight: 600 }}>Vermelho = Bloqueado</span>
            </p>

            {isLoadingGrid ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Carregando grade...</div>
            ) : (
              <div style={{ overflowX: 'auto', maxHeight: '45vh', marginBottom: '1.5rem' }}>

                {/* ── Manhã ── */}
                <h5 style={{ marginBottom: '0.5rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.05em' }}>
                  Turno da Manhã
                </h5>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: '0.78rem', marginBottom: '1.5rem' }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '0.4rem', borderBottom: '2px solid var(--border-color)', textAlign: 'left', minWidth: '70px' }}>Aula</th>
                      {days.map((d, i) => {
                        const allBlocked = areAllBlocked(i + 1, true);
                        return (
                          <th key={d} style={{ padding: '0.4rem', borderBottom: '2px solid var(--border-color)' }}>
                            <div style={{ marginBottom: '0.3rem' }}>{d}</div>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '0.15rem 0.35rem', fontSize: '0.62rem', whiteSpace: 'nowrap' }}
                              onClick={() => handleToggleAllShift(i + 1, true)}
                            >
                              {allBlocked ? 'Desbloquear Tudo' : 'Bloquear Tudo'}
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {morningPeriods.map(period => {
                      const timeLabel = getAvailTime(period, true);
                      return (
                        <tr key={period} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '0.4rem', textAlign: 'left' }}>
                            <div style={{ fontWeight: 'bold', color: 'var(--text-secondary)' }}>{period}ª</div>
                            {timeLabel && (
                              <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', opacity: 0.7 }}>{timeLabel}</div>
                            )}
                          </td>
                          {days.map((_, i) => {
                            const dow = i + 1;
                            const slot = grid.find(g => g.dayOfWeek === dow && g.period === period);
                            const isAvail = slot ? slot.isAvailable : true;
                            return (
                              <td key={dow} style={{ padding: '0.2rem' }}>
                                <button
                                  onClick={() => handleToggleSlot(dow, period)}
                                  style={{
                                    width: '100%', padding: '0.35rem', borderRadius: 'var(--radius-sm)', border: 'none',
                                    cursor: 'pointer', fontWeight: 'bold', color: 'white',
                                    backgroundColor: isAvail ? 'var(--success-color)' : 'var(--danger-color)',
                                    fontSize: '0.72rem',
                                  }}
                                >
                                  {isAvail ? 'Livre' : 'X'}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* ── Tarde ── */}
                <h5 style={{ marginBottom: '0.5rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.05em' }}>
                  Turno da Tarde
                </h5>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: '0.78rem' }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '0.4rem', borderBottom: '2px solid var(--border-color)', textAlign: 'left', minWidth: '70px' }}>Aula</th>
                      {days.map((d, i) => {
                        const allBlocked = areAllBlocked(i + 1, false);
                        return (
                          <th key={d} style={{ padding: '0.4rem', borderBottom: '2px solid var(--border-color)' }}>
                            <div style={{ marginBottom: '0.3rem' }}>{d}</div>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '0.15rem 0.35rem', fontSize: '0.62rem', whiteSpace: 'nowrap' }}
                              onClick={() => handleToggleAllShift(i + 1, false)}
                            >
                              {allBlocked ? 'Desbloquear Tudo' : 'Bloquear Tudo'}
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {afternoonPeriods.map(period => {
                      const timeLabel = getAvailTime(period, false);
                      return (
                        <tr key={period} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '0.4rem', textAlign: 'left' }}>
                            <div style={{ fontWeight: 'bold', color: 'var(--text-secondary)' }}>{period - 6}ª</div>
                            {timeLabel && (
                              <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', opacity: 0.7 }}>{timeLabel}</div>
                            )}
                          </td>
                          {days.map((_, i) => {
                            const dow = i + 1;
                            const slot = grid.find(g => g.dayOfWeek === dow && g.period === period);
                            const isAvail = slot ? slot.isAvailable : true;
                            return (
                              <td key={dow} style={{ padding: '0.2rem' }}>
                                <button
                                  onClick={() => handleToggleSlot(dow, period)}
                                  style={{
                                    width: '100%', padding: '0.35rem', borderRadius: 'var(--radius-sm)', border: 'none',
                                    cursor: 'pointer', fontWeight: 'bold', color: 'white',
                                    backgroundColor: isAvail ? 'var(--success-color)' : 'var(--danger-color)',
                                    fontSize: '0.72rem',
                                  }}
                                >
                                  {isAvail ? 'Livre' : 'X'}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ── Turmas e Disciplinas (apenas na edição) ─────────── */}
        {editingTeacher && (
          <>
            <hr style={{ border: 0, borderTop: '1px solid var(--border-color)', margin: '1.5rem 0' }} />
            <h4 style={{ color: 'var(--primary-color)', marginBottom: '0.75rem' }}>Turmas e Disciplinas</h4>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '1rem' }}>
              Defina quais turmas e disciplinas este professor irá ministrar.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
              {curriculums.map((curr, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <select
                    className="input"
                    style={{ flex: 2, padding: '0.4rem', fontSize: '0.85rem' }}
                    value={curr.classId}
                    onChange={e => {
                      const newCurrs = [...curriculums];
                      newCurrs[idx].classId = e.target.value;
                      setCurriculums(newCurrs);
                    }}
                  >
                    <option value="">Selecione a turma</option>
                    {allClasses.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.shift === 'MORNING' ? 'Manhã' : 'Tarde'})</option>
                    ))}
                  </select>
                  <select
                    className="input"
                    style={{ flex: 2, padding: '0.4rem', fontSize: '0.85rem' }}
                    value={curr.subjectId}
                    onChange={e => {
                      const newCurrs = [...curriculums];
                      newCurrs[idx].subjectId = e.target.value;
                      setCurriculums(newCurrs);
                    }}
                  >
                    <option value="">Selecione a disciplina</option>
                    {allSubjects.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    className="input"
                    style={{ width: '60px', padding: '0.4rem', fontSize: '0.85rem', textAlign: 'center' }}
                    value={curr.classesPerWeek}
                    min={1}
                    max={10}
                    onChange={e => {
                      const newCurrs = [...curriculums];
                      newCurrs[idx].classesPerWeek = parseInt(e.target.value) || 1;
                      setCurriculums(newCurrs);
                    }}
                  />
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem', color: 'var(--danger-color)' }}
                    onClick={() => setCurriculums(curriculums.filter((_, i) => i !== idx))}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <button
              className="btn btn-secondary"
              style={{ fontSize: '0.85rem' }}
              onClick={() => setCurriculums([...curriculums, { classId: '', subjectId: '', classesPerWeek: 1 }])}
            >
              + Adicionar Disciplina
            </button>
          </>
        )}

        {/* ── Ações do modal ──────────────────────────────────────── */}
        <hr style={{ border: 0, borderTop: '1px solid var(--border-color)', marginBottom: '1rem' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
          {!isCreating ? (
            <button
              className="btn btn-secondary"
              style={{ color: 'var(--danger-color)', borderColor: 'var(--danger-color)' }}
              onClick={handleDelete}
              disabled={isSaving}
            >
              Excluir Professor
            </button>
          ) : <div />}
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button className="btn btn-secondary" onClick={() => { setEditingTeacher(null); setIsCreating(false); }}>
              Cancelar
            </button>
            <button className="btn btn-primary" onClick={() => handleSave(false)} disabled={isSaving}>
              {isSaving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Modal de Mesclagem ────────────────────────────────────── */}
      <Modal
        isOpen={mergeConfirm.isOpen}
        onClose={() => setMergeConfirm({ ...mergeConfirm, isOpen: false })}
        title="Confirmar Mesclagem"
      >
        <div style={{ marginBottom: '1.5rem' }}>
          <p style={{ marginBottom: '1rem' }}>Já existe um professor chamado <strong>{mergeConfirm.newName}</strong>.</p>
          <p style={{ color: 'var(--danger-color)', fontWeight: 'bold' }}>Deseja MESCLAR os dois cadastros?</p>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            Todas as turmas e aulas atribuídas a <em>{mergeConfirm.oldName}</em> serão transferidas para{' '}
            <strong>{mergeConfirm.newName}</strong>, e o cadastro antigo será permanentemente excluído.
          </p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          <button className="btn btn-secondary" onClick={() => setMergeConfirm({ ...mergeConfirm, isOpen: false })} disabled={isSaving}>
            Cancelar
          </button>
          <button
            className="btn btn-primary"
            onClick={() => { setMergeConfirm({ ...mergeConfirm, isOpen: false }); handleSave(true); }}
            disabled={isSaving}
          >
            Confirmar Mesclagem
          </button>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={executeDelete}
        title="Excluir Professor"
        message={`Tem certeza que deseja excluir o(a) professor(a) ${editingTeacher?.name}? As matérias dele(a) ficarão "Sem Professor".`}
        confirmLabel="Excluir"
        variant="danger"
      />

      <ConfirmModal
        isOpen={bulkDeleteConfirm}
        onClose={() => setBulkDeleteConfirm(false)}
        onConfirm={handleBulkDelete}
        title="Excluir Professores"
        message={`Tem certeza que deseja excluir ${selectedIds.size} professor(es) selecionado(s)?`}
        confirmLabel="Excluir Todos"
        variant="danger"
      />
    </>
  );
}
