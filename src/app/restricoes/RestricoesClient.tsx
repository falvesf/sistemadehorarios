'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { getTeacherAvailability, saveTeacherAvailability, addCapelaRule, deleteCapelaRule } from './actions';

type Teacher = { id: string; name: string };
type Class = { id: string; name: string; shift: string };
type Schedule = { id: string; class: { name: string; shift: string }; teacher: { name: string } | null; dayOfWeek: number; period: number };
type AvailabilitySlot = { dayOfWeek: number; period: number; isAvailable: boolean };

export default function RestricoesClient({ teachers, classes, capelaRules }: { teachers: Teacher[], classes: Class[], capelaRules: Schedule[] }) {
  const { showToast } = useToast();
  const [showAvailabilityModal, setShowAvailabilityModal] = useState(false);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('');
  const [grid, setGrid] = useState<AvailabilitySlot[]>([]);
  const [isLoadingGrid, setIsLoadingGrid] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Capela states
  const [capelaClassIds, setCapelaClassIds] = useState<string[]>([]);
  const [capelaDay, setCapelaDay] = useState<number>(3); // 3 = Quarta
  const [capelaPeriod, setCapelaPeriod] = useState<number>(1);
  const [capelaTeacherId, setCapelaTeacherId] = useState<string>(teachers.length > 0 ? teachers[0].id : '');
  const [isAddingCapela, setIsAddingCapela] = useState(false);

  const days = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
  const morningPeriods = [1, 2, 3, 4, 5, 6];
  const afternoonPeriods = [7, 8, 9, 10, 11, 12];
  const allPeriods = [...morningPeriods, ...afternoonPeriods];

  const createDefaultGrid = () => {
    const defaultGrid: AvailabilitySlot[] = [];
    for (let d = 1; d <= 5; d++) {
      allPeriods.forEach(p => {
        defaultGrid.push({ dayOfWeek: d, period: p, isAvailable: true });
      });
    }
    return defaultGrid;
  };

  useEffect(() => {
    if (showAvailabilityModal && selectedTeacherId) {
      loadGrid(selectedTeacherId);
    } else if (showAvailabilityModal && !selectedTeacherId && teachers.length > 0) {
      setSelectedTeacherId(teachers[0].id);
    }
  }, [showAvailabilityModal, selectedTeacherId, teachers]);

  const loadGrid = async (teacherId: string) => {
    setIsLoadingGrid(true);
    try {
      const savedAvailabilities = await getTeacherAvailability(teacherId);
      const newGrid = createDefaultGrid();
      savedAvailabilities.forEach(saved => {
        const index = newGrid.findIndex(g => g.dayOfWeek === saved.dayOfWeek && g.period === saved.period);
        if (index !== -1) {
          newGrid[index].isAvailable = saved.isAvailable;
        }
      });
      setGrid(newGrid);
    } catch (e) {
      showToast('Erro ao carregar disponibilidade.', 'error');
    } finally {
      setIsLoadingGrid(false);
    }
  };

  const handleToggleSlot = (dayOfWeek: number, period: number) => {
    setGrid(prev => prev.map(slot => 
      (slot.dayOfWeek === dayOfWeek && slot.period === period) 
        ? { ...slot, isAvailable: !slot.isAvailable }
        : slot
    ));
  };

  const handleToggleAllShift = (dayOfWeek: number, isMorning: boolean) => {
    const periodsToToggle = isMorning ? morningPeriods : afternoonPeriods;
    // Check if all are currently available
    const areAllAvailable = periodsToToggle.every(p => {
      const slot = grid.find(g => g.dayOfWeek === dayOfWeek && g.period === p);
      return slot ? slot.isAvailable : true;
    });

    // If all are available, block all. Otherwise, make all available.
    setGrid(prev => prev.map(slot => 
      (slot.dayOfWeek === dayOfWeek && periodsToToggle.includes(slot.period))
        ? { ...slot, isAvailable: !areAllAvailable }
        : slot
    ));
  };

  const handleSaveSettings = () => {
    showToast('Configurações visuais salvas!', 'success');
  };

  const handleSaveAvailability = async () => {
    if (!selectedTeacherId) return;
    setIsSaving(true);
    try {
      const slotsToSave = grid.filter(g => !g.isAvailable); 
      await saveTeacherAvailability(selectedTeacherId, slotsToSave);
      setShowAvailabilityModal(false);
      showToast('Disponibilidade do professor salva!', 'success');
    } catch (e) {
      showToast('Erro ao salvar disponibilidade.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddCapela = async () => {
    if (capelaClassIds.length === 0) {
      showToast('Selecione ao menos uma turma.', 'error');
      return;
    }
    if (!capelaTeacherId) {
      showToast('Selecione o professor.', 'error');
      return;
    }
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

  const toggleCapelaClass = (classId: string) => {
    setCapelaClassIds(prev => prev.includes(classId) ? prev.filter(id => id !== classId) : [...prev, classId]);
  };
  const toggleAllCapelaClasses = (shift: string) => {
    const shiftClasses = classes.filter(c => c.shift === shift).map(c => c.id);
    const hasAll = shiftClasses.every(id => capelaClassIds.includes(id));
    if (hasAll) {
      setCapelaClassIds(prev => prev.filter(id => !shiftClasses.includes(id)));
    } else {
      setCapelaClassIds(prev => Array.from(new Set([...prev, ...shiftClasses])));
    }
  };

  const formatPeriodName = (p: number) => {
    if (p <= 6) return `${p}ª`;
    return `${p - 6}ª`;
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '2rem' }}>
        <div>
          <h1>Regras e Capela</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Configure os turnos, regras fixas e indisponibilidade de professores.</p>
        </div>
        <button className="btn btn-primary" onClick={handleSaveSettings}>Salvar Configurações</button>
      </div>

      <div className="table-container" style={{ padding: '2rem', marginBottom: '2rem' }}>
        <h3 style={{ marginBottom: '1rem', color: 'var(--primary-color)' }}>Horários e Intervalos (Visuais)</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
          Configurações visuais de duração para exibição da grade final.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div>
            <label className="input-label" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Duração aula - Manhã / Tarde</label>
            <input type="text" className="input" defaultValue="50 minutos (Inf/Fund I), 45 min (Fund II)" />
          </div>
          <div>
            <label className="input-label" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Horário de Início (Manhã)</label>
            <input type="text" className="input" defaultValue="07:15" />
          </div>
        </div>
      </div>

      <div className="table-container" style={{ padding: '2rem', marginBottom: '2rem' }}>
        <h3 style={{ marginBottom: '1rem', color: 'var(--primary-color)' }}>Regras Fixas: Capela</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
          Defina regras dinâmicas de Capela. Você pode associar a Capela para múltiplas turmas em diferentes horários e dias.
        </p>
        
        <div style={{ backgroundColor: 'var(--background-color)', padding: '1.5rem', borderRadius: 'var(--radius-md)', marginBottom: '2rem' }}>
          <h4 style={{ marginBottom: '1rem' }}>Adicionar Nova Regra</h4>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '150px' }}>
              <label className="input-label" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Dia da Semana</label>
              <select className="input" value={capelaDay} onChange={e => setCapelaDay(Number(e.target.value))}>
                <option value={1}>Segunda-feira</option>
                <option value={2}>Terça-feira</option>
                <option value={3}>Quarta-feira</option>
                <option value={4}>Quinta-feira</option>
                <option value={5}>Sexta-feira</option>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: '150px' }}>
              <label className="input-label" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Período</label>
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
              <label className="input-label" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Professor</label>
              <select className="input" value={capelaTeacherId} onChange={e => setCapelaTeacherId(e.target.value)}>
                {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label className="input-label" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Turmas Participantes</label>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => toggleAllCapelaClasses('MORNING')}>Selecionar Toda Manhã</button>
              <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => toggleAllCapelaClasses('AFTERNOON')}>Selecionar Toda Tarde</button>
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
                      fontSize: '0.875rem'
                    }}
                  >
                    {c.name} ({c.shift === 'MORNING' ? 'M' : 'T'})
                  </button>
                )
              })}
            </div>
          </div>
          <button className="btn btn-primary" onClick={handleAddCapela} disabled={isAddingCapela}>Adicionar Regra de Capela</button>
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
              {capelaRules.map(rule => (
                <tr key={rule.id}>
                  <td>{rule.class.name}</td>
                  <td>{days[rule.dayOfWeek - 1]}</td>
                  <td>{formatPeriodName(rule.period)} ({rule.period <= 6 ? 'Manhã' : 'Tarde'})</td>
                  <td>{rule.teacher?.name || 'Sem Professor'}</td>
                  <td>
                    <button className="btn btn-secondary" style={{ color: 'var(--danger-color)', borderColor: 'var(--danger-color)' }} onClick={() => handleDeleteCapela(rule.id)}>Excluir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="table-container" style={{ padding: '2rem' }}>
        <h3 style={{ marginBottom: '1rem', color: 'var(--primary-color)' }}>Restrições de Professores</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
          Bloqueie dias inteiros ou horários específicos em que um professor não pode dar aula (Manhã ou Tarde).
        </p>
        <button className="btn btn-secondary" onClick={() => setShowAvailabilityModal(true)}>Configurar Disponibilidade Específica</button>
      </div>

      <Modal 
        isOpen={showAvailabilityModal} 
        onClose={() => setShowAvailabilityModal(false)}
        title="Disponibilidade Específica"
      >
        <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>Selecione um professor para bloquear seus horários indisponíveis. (Verde = Disponível / Vermelho = Bloqueado)</p>
        
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Professor</label>
          <select 
            className="input" 
            value={selectedTeacherId} 
            onChange={e => setSelectedTeacherId(e.target.value)}
          >
             {teachers.map(t => (
               <option key={t.id} value={t.id}>{t.name}</option>
             ))}
          </select>
        </div>

        {isLoadingGrid ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Carregando grade...</div>
        ) : (
          <div style={{ overflowX: 'auto', marginBottom: '1.5rem', maxHeight: '50vh' }}>
            <h4 style={{ marginBottom: '0.5rem', color: 'var(--primary-color)' }}>Turno da Manhã</h4>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: '0.875rem', marginBottom: '2rem' }}>
              <thead>
                <tr>
                  <th style={{ padding: '0.5rem', borderBottom: '2px solid var(--border-color)' }}>Aula</th>
                  {days.map((d, index) => (
                    <th key={d} style={{ padding: '0.5rem', borderBottom: '2px solid var(--border-color)' }}>
                      <div style={{ marginBottom: '0.5rem' }}>{d}</div>
                      <button className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem' }} onClick={() => handleToggleAllShift(index + 1, true)}>Bloquear Tudo</button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {morningPeriods.map(period => (
                  <tr key={period} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '0.5rem', fontWeight: 'bold', color: 'var(--text-secondary)' }}>{period}ª</td>
                    {days.map((_, index) => {
                      const dayOfWeek = index + 1;
                      const slot = grid.find(g => g.dayOfWeek === dayOfWeek && g.period === period);
                      const isAvail = slot ? slot.isAvailable : true;
                      return (
                        <td key={dayOfWeek} style={{ padding: '0.25rem' }}>
                          <button
                            onClick={() => handleToggleSlot(dayOfWeek, period)}
                            style={{
                              width: '100%', padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer',
                              fontWeight: 'bold', color: 'white', backgroundColor: isAvail ? 'var(--success-color)' : 'var(--danger-color)',
                              transition: 'opacity 0.2s', opacity: isAvail ? 0.9 : 1
                            }}
                          >
                            {isAvail ? 'Livre' : 'X'}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>

            <h4 style={{ marginBottom: '0.5rem', color: 'var(--primary-color)' }}>Turno da Tarde</h4>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: '0.875rem' }}>
              <thead>
                <tr>
                  <th style={{ padding: '0.5rem', borderBottom: '2px solid var(--border-color)' }}>Aula</th>
                  {days.map((d, index) => (
                    <th key={d} style={{ padding: '0.5rem', borderBottom: '2px solid var(--border-color)' }}>
                      <div style={{ marginBottom: '0.5rem' }}>{d}</div>
                      <button className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem' }} onClick={() => handleToggleAllShift(index + 1, false)}>Bloquear Tudo</button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {afternoonPeriods.map(period => (
                  <tr key={period} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '0.5rem', fontWeight: 'bold', color: 'var(--text-secondary)' }}>{period - 6}ª</td>
                    {days.map((_, index) => {
                      const dayOfWeek = index + 1;
                      const slot = grid.find(g => g.dayOfWeek === dayOfWeek && g.period === period);
                      const isAvail = slot ? slot.isAvailable : true;
                      return (
                        <td key={dayOfWeek} style={{ padding: '0.25rem' }}>
                          <button
                            onClick={() => handleToggleSlot(dayOfWeek, period)}
                            style={{
                              width: '100%', padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer',
                              fontWeight: 'bold', color: 'white', backgroundColor: isAvail ? 'var(--success-color)' : 'var(--danger-color)',
                              transition: 'opacity 0.2s', opacity: isAvail ? 0.9 : 1
                            }}
                          >
                            {isAvail ? 'Livre' : 'X'}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          <button className="btn btn-secondary" onClick={() => setShowAvailabilityModal(false)}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSaveAvailability} disabled={isSaving || isLoadingGrid}>
            {isSaving ? 'Salvando...' : 'Salvar Bloqueios'}
          </button>
        </div>
      </Modal>
    </>
  );
}
