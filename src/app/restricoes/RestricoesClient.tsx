'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { ConfirmModal } from '@/components/ConfirmModal';
import { addCapelaRule, deleteCapelaRule, updateCapelaRule, saveTimeSlots, addSubjectAlias, deleteSubjectAlias } from './actions';

type Teacher = { id: string; name: string };
type Class = { id: string; name: string; shift: string };
type Schedule = {
  id: string;
  Class: { name: string; shift: string; level: string };
  Teacher: { id: string; name: string } | null;
  dayOfWeek: number;
  period: number;
};
type TimeSlot = {
  id: string;
  level: string;
  shift: string;
  dayOfWeek: number;
  period: number;
  startTime: string;
  endTime: string;
};

// ── Utility ─────────────────────────────────────────────────────
function addMinutes(timeStr: string, mins: number): string {
  const [h, m] = timeStr.split(':').map(Number);
  const date = new Date(2000, 0, 1, h, m);
  date.setMinutes(date.getMinutes() + mins);
  return date.toTimeString().slice(0, 5);
}

function calcEndTime(start: string, durationMin: number, breakMin: number, breakAfter: number, totalPeriods = 6): string {
  let cur = start;
  for (let p = 1; p <= totalPeriods; p++) {
    cur = addMinutes(cur, durationMin);
    if (p === breakAfter && p < totalPeriods) cur = addMinutes(cur, breakMin);
  }
  return cur;
}

// ────────────────────────────────────────────────────────────────

export default function RestricoesClient({
  teachers,
  classes,
  capelaRules: initialCapelaRules,
  initialTimeSlots,
  initialSubjectAliases,
}: {
  teachers: Teacher[];
  classes: Class[];
  capelaRules: Schedule[];
  initialTimeSlots: TimeSlot[];
  initialSubjectAliases: { id: string; sourceName: string; targetName: string }[];
}) {
  const { showToast } = useToast();
  const router = useRouter();

  // ── Chapel states ───────────────────────────────────────────
  const [capelaRules, setCapelaRules] = useState<Schedule[]>(initialCapelaRules);
  const [capelaClassIds, setCapelaClassIds] = useState<string[]>([]);
  const [capelaDay, setCapelaDay] = useState<number>(3);
  const [capelaPeriod, setCapelaPeriod] = useState<number>(1);
  const [capelaTeacherId, setCapelaTeacherId] = useState<string>(teachers.length > 0 ? teachers[0].id : '');
  const [isAddingCapela, setIsAddingCapela] = useState(false);
  const [editingCapela, setEditingCapela] = useState<{ id: string; classId: string; className: string; dayOfWeek: number; period: number; teacherId: string } | null>(null);
  const [selectedCapelaIds, setSelectedCapelaIds] = useState<Set<string>>(new Set());
  const [bulkEditCapela, setBulkEditCapela] = useState<{ dayOfWeek: number; period: number; teacherId: string } | null>(null);

  // ── Subject Alias states ────────────────────────────────────
  const [subjectAliases, setSubjectAliases] = useState(initialSubjectAliases);
  const [aliasSource, setAliasSource] = useState('');
  const [aliasTarget, setAliasTarget] = useState('Capela');
  const [isAddingAlias, setIsAddingAlias] = useState(false);

  // ── TimeSlots states ────────────────────────────────────────
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>(initialTimeSlots);
  const [tsLevel, setTsLevel] = useState<string>('FUND2');
  const [tsShift, setTsShift] = useState<string>('MORNING');
  const [isSavingTimeSlots, setIsSavingTimeSlots] = useState(false);

  // ── Assistente modal state ──────────────────────────────────
  const [showAssistant, setShowAssistant] = useState(false);
  const [assistantTab, setAssistantTab] = useState<'weekday' | 'friday'>('weekday');

  const getAssistantKey = (level: string, shift: string) => `restricoes-assistant-${level}-${shift}`;

  const loadAssistantConfig = (level: string, shift: string) => {
    if (typeof window === 'undefined') return null;
    const saved = localStorage.getItem(getAssistantKey(level, shift));
    if (saved) {
      try { return JSON.parse(saved); } catch {}
    }
    return null;
  };

  const defaultConfig = {
    astStartWeekday: '07:15', astDurationWeekday: 45, astBreakMinWeekday: 20, astBreakAfterWeekday: 3, astTotalWeekday: 6,
    astStartFriday: '07:15', astDurationFriday: 45, astBreakMinFriday: 20, astBreakAfterFriday: 3, astTotalFriday: 6,
  };

  const savedConfig = loadAssistantConfig(tsLevel, tsShift) || defaultConfig;

  const [astStartWeekday, setAstStartWeekday] = useState(savedConfig.astStartWeekday);
  const [astDurationWeekday, setAstDurationWeekday] = useState(savedConfig.astDurationWeekday);
  const [astBreakMinWeekday, setAstBreakMinWeekday] = useState(savedConfig.astBreakMinWeekday);
  const [astBreakAfterWeekday, setAstBreakAfterWeekday] = useState(savedConfig.astBreakAfterWeekday);
  const [astTotalWeekday, setAstTotalWeekday] = useState(savedConfig.astTotalWeekday);

  const [astStartFriday, setAstStartFriday] = useState(savedConfig.astStartFriday);
  const [astDurationFriday, setAstDurationFriday] = useState(savedConfig.astDurationFriday);
  const [astBreakMinFriday, setAstBreakMinFriday] = useState(savedConfig.astBreakMinFriday);
  const [astBreakAfterFriday, setAstBreakAfterFriday] = useState(savedConfig.astBreakAfterFriday);
  const [astTotalFriday, setAstTotalFriday] = useState(savedConfig.astTotalFriday);

  const [deleteCapelaConfirm, setDeleteCapelaConfirm] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const [deleteAliasConfirm, setDeleteAliasConfirm] = useState<{ open: boolean; id: string | null; source: string }>({ open: false, id: null, source: '' });

  // Save assistant config to localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const config = {
      astStartWeekday, astDurationWeekday, astBreakMinWeekday, astBreakAfterWeekday, astTotalWeekday,
      astStartFriday, astDurationFriday, astBreakMinFriday, astBreakAfterFriday, astTotalFriday,
    };
    localStorage.setItem(getAssistantKey(tsLevel, tsShift), JSON.stringify(config));
  }, [tsLevel, tsShift, astStartWeekday, astDurationWeekday, astBreakMinWeekday, astBreakAfterWeekday, astTotalWeekday, astStartFriday, astDurationFriday, astBreakMinFriday, astBreakAfterFriday, astTotalFriday]);

  // Reload assistant config when level or shift changes
  useEffect(() => {
    const config = loadAssistantConfig(tsLevel, tsShift) || defaultConfig;
    setAstStartWeekday(config.astStartWeekday);
    setAstDurationWeekday(config.astDurationWeekday);
    setAstBreakMinWeekday(config.astBreakMinWeekday);
    setAstBreakAfterWeekday(config.astBreakAfterWeekday);
    setAstTotalWeekday(config.astTotalWeekday);
    setAstStartFriday(config.astStartFriday);
    setAstDurationFriday(config.astDurationFriday);
    setAstBreakMinFriday(config.astBreakMinFriday);
    setAstBreakAfterFriday(config.astBreakAfterFriday);
    setAstTotalFriday(config.astTotalFriday);
  }, [tsLevel, tsShift]);

  const astEndPreviewWeekday = useMemo(
    () => calcEndTime(astStartWeekday, astDurationWeekday, astBreakMinWeekday, astBreakAfterWeekday, astTotalWeekday),
    [astStartWeekday, astDurationWeekday, astBreakMinWeekday, astBreakAfterWeekday, astTotalWeekday]
  );

  const astEndPreviewFriday = useMemo(
    () => calcEndTime(astStartFriday, astDurationFriday, astBreakMinFriday, astBreakAfterFriday, astTotalFriday),
    [astStartFriday, astDurationFriday, astBreakMinFriday, astBreakAfterFriday, astTotalFriday]
  );

  // ── Constants ───────────────────────────────────────────────
  const days = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
  const morningPeriods = [1, 2, 3, 4, 5, 6];
  const afternoonPeriods = [7, 8, 9, 10, 11, 12];
  const allPeriods = [...morningPeriods, ...afternoonPeriods];

  // ── Handlers ─────────────────────────────────────────────────

  const handleSaveSettings = async () => {
    setIsSavingTimeSlots(true);
    const res = await saveTimeSlots(timeSlots);
    if (res.success) showToast('Configurações de horários salvas!', 'success');
    else showToast('Erro ao salvar horários.', 'error');
    setIsSavingTimeSlots(false);
  };

  const updateTimeSlot = (id: string, field: 'startTime' | 'endTime', value: string) => {
    setTimeSlots(prev => prev.map(ts => (ts.id === id ? { ...ts, [field]: value } : ts)));
  };

  /** Assistente: gera horários e aplica ao estado local — Seg-Qui usa config weekday, Sexta usa config friday */
  const handleApplyAssistant = () => {
    const generateSchedule = (start: string, duration: number, breakMin: number, breakAfter: number, total: number) => {
      let cur = start;
      const generated: { period: number; startTime: string; endTime: string }[] = [];
      for (let p = 1; p <= total; p++) {
        const end = addMinutes(cur, duration);
        generated.push({ period: p, startTime: cur, endTime: end });
        cur = end;
        if (p === breakAfter && p < total) cur = addMinutes(cur, breakMin);
      }
      return generated;
    };

    const weekdaySchedule = generateSchedule(astStartWeekday, astDurationWeekday, astBreakMinWeekday, astBreakAfterWeekday, astTotalWeekday);
    const fridaySchedule = generateSchedule(astStartFriday, astDurationFriday, astBreakMinFriday, astBreakAfterFriday, astTotalFriday);

    setTimeSlots(prev =>
      prev.map(ts => {
        if (ts.level !== tsLevel || ts.shift !== tsShift) return ts;
        if (ts.dayOfWeek >= 1 && ts.dayOfWeek <= 4) {
          const gen = weekdaySchedule.find(g => g.period === ts.period);
          if (!gen) return { ...ts, startTime: '', endTime: '' };
          return { ...ts, startTime: gen.startTime, endTime: gen.endTime };
        }
        if (ts.dayOfWeek === 5) {
          const gen = fridaySchedule.find(g => g.period === ts.period);
          if (!gen) return { ...ts, startTime: '', endTime: '' };
          return { ...ts, startTime: gen.startTime, endTime: gen.endTime };
        }
        return ts;
      })
    );
    setShowAssistant(false);
    showToast('Horários preenchidos! Clique em "Salvar Configurações" para confirmar.', 'info');
  };

  const refreshCapelaRules = async () => {
    try {
      const { getCapelaRules } = await import('./actions');
      const rules = await getCapelaRules();
      setCapelaRules(rules);
    } catch {
      router.refresh();
    }
  };

  const handleAddCapela = async () => {
    if (capelaClassIds.length === 0) { showToast('Selecione ao menos uma turma.', 'error'); return; }
    if (!capelaTeacherId) { showToast('Selecione o professor.', 'error'); return; }
    setIsAddingCapela(true);
    const res = await addCapelaRule(capelaClassIds, capelaDay, capelaPeriod, capelaTeacherId);
    if (res.success) {
      showToast('Regra de Capela adicionada com sucesso!', 'success');
      setCapelaClassIds([]);
      await refreshCapelaRules();
    } else {
      showToast('Erro ao adicionar regra.', 'error');
    }
    setIsAddingCapela(false);
  };

  const handleDeleteCapela = async (id: string) => {
    setDeleteCapelaConfirm({ open: true, id });
  };

  const executeDeleteCapela = async () => {
    const id = deleteCapelaConfirm.id;
    setDeleteCapelaConfirm({ open: false, id: null });
    if (!id) return;
    const res = await deleteCapelaRule(id);
    if (res.success) {
      showToast('Regra removida.', 'success');
      await refreshCapelaRules();
    } else {
      showToast('Erro ao remover.', 'error');
    }
  };

  const handleEditCapela = (rule: any) => {
    setEditingCapela({
      id: rule.id,
      classId: rule.classId,
      className: rule.Class?.name || '',
      dayOfWeek: rule.dayOfWeek,
      period: rule.period,
      teacherId: rule.teacherId || '',
    });
  };

  const handleSaveEditCapela = async () => {
    if (!editingCapela) return;
    setIsAddingCapela(true);
    try {
      const res = await updateCapelaRule(editingCapela.id, editingCapela.dayOfWeek, editingCapela.period, editingCapela.teacherId);
      if (res.success) {
        showToast('Regra atualizada!', 'success');
        setEditingCapela(null);
        await refreshCapelaRules();
      } else {
        showToast('Erro ao atualizar.', 'error');
      }
    } catch {
      showToast('Erro interno.', 'error');
    } finally {
      setIsAddingCapela(false);
    }
  };

  const toggleCapelaSelect = (id: string) => {
    setSelectedCapelaIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllCapela = (rules: any[]) => {
    if (selectedCapelaIds.size === rules.length) {
      setSelectedCapelaIds(new Set());
    } else {
      setSelectedCapelaIds(new Set(rules.map(r => r.id)));
    }
  };

  const handleBulkEditCapela = () => {
    const firstRule = capelaRules.find(r => selectedCapelaIds.has(r.id));
    if (!firstRule) return;
    setBulkEditCapela({
      dayOfWeek: firstRule.dayOfWeek,
      period: firstRule.period,
      teacherId: firstRule.Teacher?.id || '',
    });
  };

  const handleSaveBulkEditCapela = async () => {
    if (!bulkEditCapela) return;
    setIsAddingCapela(true);
    let updated = 0;
    for (const id of selectedCapelaIds) {
      const res = await updateCapelaRule(id, bulkEditCapela.dayOfWeek, bulkEditCapela.period, bulkEditCapela.teacherId);
      if (res.success) updated++;
    }
    setSelectedCapelaIds(new Set());
    setBulkEditCapela(null);
    showToast(`${updated} regra(s) atualizada(s)!`, updated > 0 ? 'success' : 'error');
    await refreshCapelaRules();
    setIsAddingCapela(false);
  };

  // ── Subject Alias handlers ──────────────────────────────────
  const handleAddAlias = async () => {
    if (!aliasSource.trim()) { showToast('Digite o nome da disciplina.', 'error'); return; }
    setIsAddingAlias(true);
    try {
      const res = await addSubjectAlias(aliasSource.trim(), aliasTarget.trim());
      if (res.success) {
        showToast(`"${aliasSource}" sera tratada como "${aliasTarget}".`, 'success');
        setAliasSource('');
        // Refresh aliases
        const { getSubjectAliases } = await import('./actions');
        const updated = await getSubjectAliases();
        setSubjectAliases(updated);
      } else {
        showToast(res.error || 'Erro ao adicionar.', 'error');
      }
    } catch {
      showToast('Erro interno.', 'error');
    } finally {
      setIsAddingAlias(false);
    }
  };

  const handleDeleteAlias = async (id: string, source: string) => {
    setDeleteAliasConfirm({ open: true, id, source });
  };

  const executeDeleteAlias = async () => {
    const { id } = deleteAliasConfirm;
    setDeleteAliasConfirm({ open: false, id: null, source: '' });
    if (!id) return;
    const res = await deleteSubjectAlias(id);
    if (res.success) {
      showToast('Regra removida.', 'success');
      const { getSubjectAliases } = await import('./actions');
      const updated = await getSubjectAliases();
      setSubjectAliases(updated);
    } else {
      showToast('Erro ao remover.', 'error');
    }
  };

  const toggleCapelaClass = (classId: string) =>
    setCapelaClassIds(prev => (prev.includes(classId) ? prev.filter(id => id !== classId) : [...prev, classId]));

  const toggleAllCapelaClasses = (shift: string) => {
    const shiftClasses = classes.filter(c => c.shift === shift).map(c => c.id);
    const hasAll = shiftClasses.every(id => capelaClassIds.includes(id));
    if (hasAll) setCapelaClassIds(prev => prev.filter(id => !shiftClasses.includes(id)));
    else setCapelaClassIds(prev => Array.from(new Set([...prev, ...shiftClasses])));
  };

  const formatPeriodName = (p: number) => (p <= 6 ? `${p}ª` : `${p - 6}ª`);

  /**
   * Returns a human-readable time range for a chapel rule.
   * Chapel rules store period 1-6 for morning, 7-12 for afternoon.
   * TimeSlot DB uses period 1-6 per shift, differentiated by the shift field.
   * We also filter by level so Fund II shows its own times.
   */
  const getCapelaTime = (rule: Schedule): string | null => {
    const isMorning = rule.period <= 6;
    const shift = isMorning ? 'MORNING' : 'AFTERNOON';
    const dbPeriod = isMorning ? rule.period : rule.period - 6;
    const level = rule.Class.level;

    const slot =
      timeSlots.find(ts => ts.level === level && ts.shift === shift && ts.period === dbPeriod && ts.dayOfWeek === rule.dayOfWeek) ??
      timeSlots.find(ts => ts.level === level && ts.shift === shift && ts.period === dbPeriod);
    return slot ? `${slot.startTime}–${slot.endTime}` : null;
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '2rem' }}>
        <div>
          <h1>Regras e Capela</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Configure os turnos, horários fixos e regras de Capela.</p>
        </div>
        <button className="btn btn-primary" onClick={handleSaveSettings} disabled={isSavingTimeSlots}>
          {isSavingTimeSlots ? 'Salvando...' : 'Salvar Configurações'}
        </button>
      </div>

      {/* ── Bell Schedules ───────────────────────────────────────── */}
      <div className="table-container" style={{ padding: '2rem', marginBottom: '2rem' }}>
        <h3 style={{ marginBottom: '0.5rem', color: 'var(--primary-color)' }}>Horários Exatos das Aulas (Bell Schedules)</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
          O sistema usará estes horários para detectar sobreposições reais de tempo quando um professor for agendado para níveis diferentes.
        </p>

        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label className="input-label" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
              Nível
            </label>
            <select className="input" value={tsLevel} onChange={e => setTsLevel(e.target.value)}>
              <option value="INFANTIL">Educação Infantil</option>
              <option value="FUND1">Ensino Fundamental I</option>
              <option value="FUND2">Ensino Fundamental II</option>
            </select>
          </div>
          <div>
            <label className="input-label" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
              Turno
            </label>
            <select className="input" value={tsShift} onChange={e => setTsShift(e.target.value)}>
              <option value="MORNING">Manhã</option>
              <option value="AFTERNOON">Tarde</option>
            </select>
          </div>
          <button
            className="btn btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            onClick={() => setShowAssistant(true)}
          >
            🪄 Assistente de preenchimento
          </button>
        </div>

        <div style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: '0.875rem' }}>
            <thead>
              <tr>
                <th style={{ padding: '0.5rem', borderBottom: '2px solid var(--border-color)' }}>Período</th>
                {days.map(d => (
                  <th key={d} style={{ padding: '0.5rem', borderBottom: '2px solid var(--border-color)' }}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {morningPeriods.map(period => (
                <tr key={period} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '0.5rem', fontWeight: 'bold', color: 'var(--text-secondary)' }}>{period}ª Aula</td>
                  {days.map((_, index) => {
                    const dayOfWeek = index + 1;
                    const slot = timeSlots.find(
                      ts => ts.level === tsLevel && ts.shift === tsShift && ts.dayOfWeek === dayOfWeek && ts.period === period
                    );
                    if (!slot) return <td key={dayOfWeek}>-</td>;
                    return (
                      <td key={dayOfWeek} style={{ padding: '0.5rem' }}>
                        <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'center', alignItems: 'center' }}>
                          <input
                            type="time"
                            className="input"
                            style={{ padding: '0.25rem', width: '90px' }}
                            value={slot.startTime}
                            onChange={e => updateTimeSlot(slot.id, 'startTime', e.target.value)}
                          />
                          <span>-</span>
                          <input
                            type="time"
                            className="input"
                            style={{ padding: '0.25rem', width: '90px' }}
                            value={slot.endTime}
                            onChange={e => updateTimeSlot(slot.id, 'endTime', e.target.value)}
                          />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Regras de Capela ─────────────────────────────────────── */}
      <div className="table-container" style={{ padding: '2rem' }}>
        <h3 style={{ marginBottom: '1rem', color: 'var(--primary-color)' }}>Regras Fixas: Capela</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
          Defina regras dinâmicas de Capela. Você pode associar a Capela para múltiplas turmas em diferentes horários e dias.
        </p>

        <div style={{ backgroundColor: 'var(--background-color)', padding: '1.5rem', borderRadius: 'var(--radius-md)', marginBottom: '2rem' }}>
          <h4 style={{ marginBottom: '1rem' }}>Adicionar Nova Regra</h4>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '150px' }}>
              <label className="input-label" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                Dia da Semana
              </label>
              <select className="input" value={capelaDay} onChange={e => setCapelaDay(Number(e.target.value))}>
                <option value={1}>Segunda-feira</option>
                <option value={2}>Terça-feira</option>
                <option value={3}>Quarta-feira</option>
                <option value={4}>Quinta-feira</option>
                <option value={5}>Sexta-feira</option>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: '150px' }}>
              <label className="input-label" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                Período
              </label>
              <select className="input" value={capelaPeriod} onChange={e => setCapelaPeriod(Number(e.target.value))}>
                <optgroup label="Manhã">
                  {morningPeriods.map(p => <option key={p} value={p}>{p}ª Aula (Manhã)</option>)}
                </optgroup>
                <optgroup label="Tarde">
                  {afternoonPeriods.map(p => <option key={p} value={p}>{p - 6}ª Aula (Tarde)</option>)}
                </optgroup>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: '150px' }}>
              <label className="input-label" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                Professor
              </label>
              <select className="input" value={capelaTeacherId} onChange={e => setCapelaTeacherId(e.target.value)}>
                {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label className="input-label" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
              Turmas Participantes
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => toggleAllCapelaClasses('MORNING')}>
                Selecionar Toda Manhã
              </button>
              <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => toggleAllCapelaClasses('AFTERNOON')}>
                Selecionar Toda Tarde
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {classes.map(c => {
                const isSelected = capelaClassIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => toggleCapelaClass(c.id)}
                    style={{
                      padding: '0.5rem',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${isSelected ? 'var(--primary-color)' : 'var(--border-color)'}`,
                      backgroundColor: isSelected ? 'rgba(79, 70, 229, 0.1)' : 'transparent',
                      color: isSelected ? 'var(--primary-color)' : 'inherit',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                    }}
                  >
                    {c.name} ({c.shift === 'MORNING' ? 'M' : 'T'})
                  </button>
                );
              })}
            </div>
          </div>
          <button className="btn btn-primary" onClick={handleAddCapela} disabled={isAddingCapela}>
            Adicionar Regra de Capela
          </button>
        </div>

        <h4 style={{ marginBottom: '1rem' }}>Regras de Capela Cadastradas</h4>
        {capelaRules.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)' }}>Nenhuma regra de Capela configurada.</p>
        ) : (
          <>
            {selectedCapelaIds.size > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <button className="btn btn-secondary" onClick={handleBulkEditCapela}>
                  ✏️ Editar {selectedCapelaIds.size} selecionada(s)
                </button>
              </div>
            )}
            <table className="table" style={{ marginTop: '1rem' }}>
              <thead>
                <tr>
                  <th style={{ width: '40px' }}>
                    <input
                      type="checkbox"
                      checked={selectedCapelaIds.size === capelaRules.length && capelaRules.length > 0}
                      onChange={() => toggleAllCapela(capelaRules)}
                      style={{ cursor: 'pointer' }}
                    />
                  </th>
                  <th>Turma</th>
                  <th>Dia da Semana</th>
                  <th>Período</th>
                  <th>Professor</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {capelaRules.map(rule => {
                  const timeRange = getCapelaTime(rule);
                  return (
                    <tr key={rule.id} style={selectedCapelaIds.has(rule.id) ? { backgroundColor: '#f0f0ff' } : undefined}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedCapelaIds.has(rule.id)}
                          onChange={() => toggleCapelaSelect(rule.id)}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                    <td>{rule.Class.name}</td>
                    <td>{days[rule.dayOfWeek - 1]}</td>
                    <td>
                      {formatPeriodName(rule.period)} ({rule.period <= 6 ? 'Manhã' : 'Tarde'})
                      {timeRange && (
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          {timeRange}
                        </span>
                      )}
                    </td>
                    <td>{rule.Teacher?.name || 'Sem Professor'}</td>
                    <td>
                      <button
                        className="btn btn-secondary"
                        style={{ marginRight: '0.5rem' }}
                        onClick={() => handleEditCapela(rule)}
                      >
                        Editar
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ color: 'var(--danger-color)', borderColor: 'var(--danger-color)' }}
                        onClick={() => handleDeleteCapela(rule.id)}
                      >
                        Excluir
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
           </table>
          </>
        )}
      </div>

      {/* ── Mapeamento de Disciplinas (Aliases) ───────────────────── */}
      <div className="table-container" style={{ padding: '2rem', marginTop: '2rem' }}>
        <h3 style={{ marginBottom: '0.5rem', color: 'var(--primary-color)' }}>Mapeamento de Disciplinas</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
          Defina regras para tratar disciplinas como equivalentes. Ex: "Cultura Geral" sera tratada como "Capela" na grade.
        </p>

        <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '1.5rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', border: '1px solid var(--border-color)' }}>
          <h4 style={{ marginBottom: '1rem' }}>Adicionar Nova Regra</h4>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '150px' }}>
              <label className="input-label" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                Disciplina Original
              </label>
              <input
                className="input"
                type="text"
                placeholder="Ex: Cultura Geral"
                value={aliasSource}
                onChange={e => setAliasSource(e.target.value)}
              />
            </div>
            <div style={{ flex: 1, minWidth: '150px' }}>
              <label className="input-label" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                Tratar como
              </label>
              <input
                className="input"
                type="text"
                placeholder="Ex: Capela"
                value={aliasTarget}
                onChange={e => setAliasTarget(e.target.value)}
              />
            </div>
            <button className="btn btn-primary" onClick={handleAddAlias} disabled={isAddingAlias} style={{ height: '38px' }}>
              {isAddingAlias ? 'Adicionando...' : '+ Adicionar'}
            </button>
          </div>
        </div>

        {subjectAliases.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>Nenhuma regra de mapeamento cadastrada.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr>
                <th style={{ borderBottom: '2px solid var(--border-color)', padding: '0.5rem', textAlign: 'left' }}>Disciplina Original</th>
                <th style={{ borderBottom: '2px solid var(--border-color)', padding: '0.5rem', textAlign: 'left' }}>Tratada Como</th>
                <th style={{ borderBottom: '2px solid var(--border-color)', padding: '0.5rem', textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {subjectAliases.map(alias => (
                <tr key={alias.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '0.75rem 0.5rem', fontWeight: 500 }}>{alias.sourceName}</td>
                  <td style={{ padding: '0.75rem 0.5rem' }}>{alias.targetName}</td>
                  <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                    <button
                      onClick={() => handleDeleteAlias(alias.id, alias.sourceName)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '0.75rem',
                        background: 'var(--danger-color)',
                        color: 'white',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                      }}
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Modal Assistente de preenchimento ────────────────────── */}
      <Modal
        isOpen={showAssistant}
        onClose={() => setShowAssistant(false)}
        title={`🪄 Assistente de Horários — ${tsLevel === 'INFANTIL' ? 'Infantil' : tsLevel === 'FUND1' ? 'Fund. I' : 'Fund. II'} / ${tsShift === 'MORNING' ? 'Manhã' : 'Tarde'}`}
        size="lg"
      >
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
          Configure os horários separadamente para <strong>Segunda a Quinta</strong> e para <strong>Sexta-feira</strong>. As sextas podem ter horários diferenciados devido ao pôr do sol.
        </p>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '2px solid var(--border-color)', marginBottom: '1.5rem' }}>
          <button
            onClick={() => setAssistantTab('weekday')}
            style={{
              flex: 1,
              padding: '0.75rem',
              border: 'none',
              background: assistantTab === 'weekday' ? 'var(--primary-color)' : 'transparent',
              color: assistantTab === 'weekday' ? 'white' : 'var(--text-secondary)',
              fontWeight: assistantTab === 'weekday' ? 600 : 400,
              cursor: 'pointer',
              borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
              fontSize: '0.9rem',
              transition: 'all 0.2s',
            }}
          >
            Segunda a Quinta
          </button>
          <button
            onClick={() => setAssistantTab('friday')}
            style={{
              flex: 1,
              padding: '0.75rem',
              border: 'none',
              background: assistantTab === 'friday' ? 'var(--primary-color)' : 'transparent',
              color: assistantTab === 'friday' ? 'white' : 'var(--text-secondary)',
              fontWeight: assistantTab === 'friday' ? 600 : 400,
              cursor: 'pointer',
              borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
              fontSize: '0.9rem',
              transition: 'all 0.2s',
            }}
          >
            Sexta-feira
          </button>
        </div>

        {/* Tab content */}
        {assistantTab === 'weekday' ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Quantidade de aulas</label>
                <input
                  type="number"
                  className="input"
                  value={astTotalWeekday}
                  min={1}
                  max={12}
                  onChange={e => setAstTotalWeekday(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Duração de cada aula (min)</label>
                <input
                  type="number"
                  className="input"
                  value={astDurationWeekday}
                  min={15}
                  max={120}
                  onChange={e => setAstDurationWeekday(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Tempo de intervalo (min)</label>
                <input
                  type="number"
                  className="input"
                  value={astBreakMinWeekday}
                  min={0}
                  max={60}
                  onChange={e => setAstBreakMinWeekday(Number(e.target.value))}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Intervalo após qual aula?</label>
                <select className="input" value={astBreakAfterWeekday} onChange={e => setAstBreakAfterWeekday(Number(e.target.value))}>
                  {Array.from({ length: astTotalWeekday - 1 }, (_, i) => i + 1).map(p => (
                    <option key={p} value={p}>Após a {p}ª aula</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Início da 1ª aula</label>
                <input
                  type="time"
                  className="input"
                  value={astStartWeekday}
                  onChange={e => setAstStartWeekday(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div style={{
              display: 'flex', gap: '1.5rem', padding: '1rem',
              backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)', marginBottom: '1rem', flexWrap: 'wrap',
            }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Aulas</div>
                <div style={{ fontWeight: 'bold' }}>{astTotalWeekday}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Início</div>
                <div style={{ fontWeight: 'bold' }}>{astStartWeekday}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Término</div>
                <div style={{ fontWeight: 'bold', color: 'var(--primary-color)' }}>{astEndPreviewWeekday}</div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Quantidade de aulas</label>
                <input
                  type="number"
                  className="input"
                  value={astTotalFriday}
                  min={1}
                  max={12}
                  onChange={e => setAstTotalFriday(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Duração de cada aula (min)</label>
                <input
                  type="number"
                  className="input"
                  value={astDurationFriday}
                  min={15}
                  max={120}
                  onChange={e => setAstDurationFriday(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Tempo de intervalo (min)</label>
                <input
                  type="number"
                  className="input"
                  value={astBreakMinFriday}
                  min={0}
                  max={60}
                  onChange={e => setAstBreakMinFriday(Number(e.target.value))}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Intervalo após qual aula?</label>
                <select className="input" value={astBreakAfterFriday} onChange={e => setAstBreakAfterFriday(Number(e.target.value))}>
                  {Array.from({ length: astTotalFriday - 1 }, (_, i) => i + 1).map(p => (
                    <option key={p} value={p}>Após a {p}ª aula</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Início da 1ª aula</label>
                <input
                  type="time"
                  className="input"
                  value={astStartFriday}
                  onChange={e => setAstStartFriday(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div style={{
              display: 'flex', gap: '1.5rem', padding: '1rem',
              backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)', marginBottom: '1rem', flexWrap: 'wrap',
            }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Aulas</div>
                <div style={{ fontWeight: 'bold' }}>{astTotalFriday}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Início</div>
                <div style={{ fontWeight: 'bold' }}>{astStartFriday}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Término</div>
                <div style={{ fontWeight: 'bold', color: 'var(--primary-color)' }}>{astEndPreviewFriday}</div>
              </div>
            </div>
          </>
        )}

        <p style={{ fontSize: '0.8rem', color: 'var(--danger-color)', marginBottom: '1.5rem' }}>
          ⚠️ Os horários existentes deste nível/turno serão substituídos (apenas na tela — lembre de salvar depois).
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          <button className="btn btn-secondary" onClick={() => setShowAssistant(false)}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleApplyAssistant}>
            🪄 Gerar Horários
          </button>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={deleteCapelaConfirm.open}
        onClose={() => setDeleteCapelaConfirm({ open: false, id: null })}
        onConfirm={executeDeleteCapela}
        title="Remover Regra de Capela"
        message="Remover esta regra de capela?"
        confirmLabel="Remover"
        variant="danger"
      />

      <ConfirmModal
        isOpen={deleteAliasConfirm.open}
        onClose={() => setDeleteAliasConfirm({ open: false, id: null, source: '' })}
        onConfirm={executeDeleteAlias}
        title="Remover Mapeamento"
        message={`Remover a regra que trata "${deleteAliasConfirm.source}" como outra disciplina?`}
        confirmLabel="Remover"
        variant="danger"
      />

      {/* ── Modal de Edição de Regra de Capela ──────────────── */}
      {editingCapela && (
        <Modal
          isOpen={true}
          onClose={() => setEditingCapela(null)}
          title={`Editar Regra de Capela — ${editingCapela.className}`}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Dia da Semana</label>
              <select
                className="input"
                value={editingCapela.dayOfWeek}
                onChange={e => setEditingCapela(prev => prev ? { ...prev, dayOfWeek: Number(e.target.value) } : null)}
              >
                {days.map((d, i) => (
                  <option key={i + 1} value={i + 1}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Período</label>
              <select
                className="input"
                value={editingCapela.period}
                onChange={e => setEditingCapela(prev => prev ? { ...prev, period: Number(e.target.value) } : null)}
              >
                {allPeriods.map(p => (
                  <option key={p} value={p}>{formatPeriodName(p)} ({p <= 6 ? 'Manhã' : 'Tarde'})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Professor</label>
              <select
                className="input"
                value={editingCapela.teacherId}
                onChange={e => setEditingCapela(prev => prev ? { ...prev, teacherId: e.target.value } : null)}
              >
                {teachers.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>
            <button className="btn btn-secondary" onClick={() => setEditingCapela(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={handleSaveEditCapela} disabled={isAddingCapela}>
              {isAddingCapela ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Modal de Edição em Massa ───────────────────────────── */}
      {bulkEditCapela && (
        <Modal
          isOpen={true}
          onClose={() => setBulkEditCapela(null)}
          title={`Editar ${selectedCapelaIds.size} Regra(s) de Capela`}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Dia da Semana</label>
              <select
                className="input"
                value={bulkEditCapela.dayOfWeek}
                onChange={e => setBulkEditCapela(prev => prev ? { ...prev, dayOfWeek: Number(e.target.value) } : null)}
              >
                {days.map((d, i) => (
                  <option key={i + 1} value={i + 1}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Período</label>
              <select
                className="input"
                value={bulkEditCapela.period}
                onChange={e => setBulkEditCapela(prev => prev ? { ...prev, period: Number(e.target.value) } : null)}
              >
                {allPeriods.map(p => (
                  <option key={p} value={p}>{formatPeriodName(p)} ({p <= 6 ? 'Manhã' : 'Tarde'})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Professor</label>
              <select
                className="input"
                value={bulkEditCapela.teacherId}
                onChange={e => setBulkEditCapela(prev => prev ? { ...prev, teacherId: e.target.value } : null)}
              >
                {teachers.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>
            <button className="btn btn-secondary" onClick={() => setBulkEditCapela(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={handleSaveBulkEditCapela} disabled={isAddingCapela}>
              {isAddingCapela ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
