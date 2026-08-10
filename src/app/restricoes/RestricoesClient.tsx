'use client';

import { useState, useMemo } from 'react';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { addCapelaRule, deleteCapelaRule, saveTimeSlots } from './actions';

type Teacher = { id: string; name: string };
type Class = { id: string; name: string; shift: string };
type Schedule = {
  id: string;
  class: { name: string; shift: string; level: string };
  teacher: { name: string } | null;
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
  capelaRules,
  initialTimeSlots,
}: {
  teachers: Teacher[];
  classes: Class[];
  capelaRules: Schedule[];
  initialTimeSlots: TimeSlot[];
}) {
  const { showToast } = useToast();

  // ── Chapel states ───────────────────────────────────────────
  const [capelaClassIds, setCapelaClassIds] = useState<string[]>([]);
  const [capelaDay, setCapelaDay] = useState<number>(3);
  const [capelaPeriod, setCapelaPeriod] = useState<number>(1);
  const [capelaTeacherId, setCapelaTeacherId] = useState<string>(teachers.length > 0 ? teachers[0].id : '');
  const [isAddingCapela, setIsAddingCapela] = useState(false);

  // ── TimeSlots states ────────────────────────────────────────
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>(initialTimeSlots);
  const [tsLevel, setTsLevel] = useState<string>('FUND2');
  const [tsShift, setTsShift] = useState<string>('MORNING');
  const [isSavingTimeSlots, setIsSavingTimeSlots] = useState(false);

  // ── Assistente modal state ──────────────────────────────────
  const [showAssistant, setShowAssistant] = useState(false);
  const [astStart, setAstStart] = useState('07:15');
  const [astDuration, setAstDuration] = useState(45);
  const [astBreakMin, setAstBreakMin] = useState(20);
  const [astBreakAfter, setAstBreakAfter] = useState(3);
  const TOTAL_PERIODS = 6;

  const astEndPreview = useMemo(
    () => calcEndTime(astStart, astDuration, astBreakMin, astBreakAfter, TOTAL_PERIODS),
    [astStart, astDuration, astBreakMin, astBreakAfter]
  );

  // ── Constants ───────────────────────────────────────────────
  const days = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
  const morningPeriods = [1, 2, 3, 4, 5, 6];
  const afternoonPeriods = [7, 8, 9, 10, 11, 12];

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

  /** Assistente: gera horários e aplica ao estado local para todos os 5 dias */
  const handleApplyAssistant = () => {
    let cur = astStart;
    const generated: { period: number; startTime: string; endTime: string }[] = [];
    for (let p = 1; p <= TOTAL_PERIODS; p++) {
      const end = addMinutes(cur, astDuration);
      generated.push({ period: p, startTime: cur, endTime: end });
      cur = end;
      if (p === astBreakAfter && p < TOTAL_PERIODS) cur = addMinutes(cur, astBreakMin);
    }

    setTimeSlots(prev =>
      prev.map(ts => {
        if (ts.level !== tsLevel || ts.shift !== tsShift) return ts;
        const gen = generated.find(g => g.period === ts.period);
        if (!gen) return ts;
        return { ...ts, startTime: gen.startTime, endTime: gen.endTime };
      })
    );
    setShowAssistant(false);
    showToast('Horários preenchidos! Clique em "Salvar Configurações" para confirmar.', 'info');
  };

  const handleAddCapela = async () => {
    if (capelaClassIds.length === 0) { showToast('Selecione ao menos uma turma.', 'error'); return; }
    if (!capelaTeacherId) { showToast('Selecione o professor.', 'error'); return; }
    setIsAddingCapela(true);
    const res = await addCapelaRule(capelaClassIds, capelaDay, capelaPeriod, capelaTeacherId);
    if (res.success) {
      showToast('Regra de Capela adicionada com sucesso!', 'success');
      setCapelaClassIds([]);
    } else {
      showToast('Erro ao adicionar regra.', 'error');
    }
    setIsAddingCapela(false);
  };

  const handleDeleteCapela = async (id: string) => {
    if (confirm('Remover esta regra de capela?')) {
      const res = await deleteCapelaRule(id);
      if (res.success) showToast('Regra removida.', 'success');
      else showToast('Erro ao remover.', 'error');
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
    const level = rule.class.level;

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
          <table className="table" style={{ marginTop: '1rem' }}>
            <thead>
              <tr>
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
                  <tr key={rule.id}>
                    <td>{rule.class.name}</td>
                    <td>{days[rule.dayOfWeek - 1]}</td>
                    <td>
                      {formatPeriodName(rule.period)} ({rule.period <= 6 ? 'Manhã' : 'Tarde'})
                      {timeRange && (
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          {timeRange}
                        </span>
                      )}
                    </td>
                    <td>{rule.teacher?.name || 'Sem Professor'}</td>
                    <td>
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
        )}
      </div>

      {/* ── Modal Assistente de preenchimento ────────────────────── */}
      <Modal
        isOpen={showAssistant}
        onClose={() => setShowAssistant(false)}
        title={`🪄 Assistente de Horários — ${tsLevel === 'INFANTIL' ? 'Infantil' : tsLevel === 'FUND1' ? 'Fund. I' : 'Fund. II'} / ${tsShift === 'MORNING' ? 'Manhã' : 'Tarde'}`}
      >
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
          Preencha os parâmetros abaixo. Os horários serão calculados automaticamente e aplicados a todos os dias da semana para o nível e turno selecionados.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Duração de cada aula (min)</label>
            <input
              type="number"
              className="input"
              value={astDuration}
              min={15}
              max={120}
              onChange={e => setAstDuration(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Tempo de intervalo (min)</label>
            <input
              type="number"
              className="input"
              value={astBreakMin}
              min={0}
              max={60}
              onChange={e => setAstBreakMin(Number(e.target.value))}
            />
          </div>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Intervalo após qual aula?</label>
          <select className="input" value={astBreakAfter} onChange={e => setAstBreakAfter(Number(e.target.value))}>
            {morningPeriods.slice(0, TOTAL_PERIODS - 1).map(p => (
              <option key={p} value={p}>Após a {p}ª aula</option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <label className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Início da 1ª aula</label>
          <input
            type="time"
            className="input"
            value={astStart}
            onChange={e => setAstStart(e.target.value)}
            style={{ width: '150px' }}
          />
        </div>

        {/* Preview */}
        <div style={{
          display: 'flex',
          gap: '1.5rem',
          padding: '1rem',
          backgroundColor: 'var(--background-color)',
          borderRadius: 'var(--radius-md)',
          marginBottom: '1rem',
          flexWrap: 'wrap',
        }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Quantidade de aulas</div>
            <div style={{ fontWeight: 'bold' }}>{TOTAL_PERIODS}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Início da 1ª aula</div>
            <div style={{ fontWeight: 'bold' }}>{astStart}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Término da última aula</div>
            <div style={{ fontWeight: 'bold', color: 'var(--primary-color)' }}>{astEndPreview}</div>
          </div>
        </div>

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
    </>
  );
}
