'use client';

import React from 'react';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { ConfirmModal } from '@/components/ConfirmModal';
import { generateSchedule, generateWithConfig, updateSlotTeacher, createSlot, deleteSlot, exportSchedule, importSchedule, restoreDefaultSchedule, importTemplateFromExcel, deleteTemplate, fetchConflicts, previewRecalculation, confirmRecalculation, fetchFixedSubjectConfigs, createFixedSubjectConfig, updateFixedSubjectConfig, deleteFixedSubjectConfig, autoFixConflict, autoFixAllConflicts, analyzeExcelForImport, applyImportWithMerges, backupAll, restoreAll, fixPeriodNormalization, exportDiagnostic } from './actions';
import { ScheduleConfig, DEFAULT_CONFIG, ScoreBreakdown } from './types';
import { Conflict, ScheduleDiff, RecalculationProposal } from './conflict-detector';
import { RecalculationChange } from './recalculator';
import type { ParsedCurriculum, TeacherMergeSuggestion } from './actions';

type ScheduleEntry = {
  id: string;
  dayOfWeek: number;
  period: number;
  isFixed: boolean;
  Class: { id: string; name: string; level: string; shift: string };
  Subject: { id: string; name: string };
  Teacher: { id: string; name: string } | null;
};

type Teacher = { id: string; name: string };

type TimeSlot = {
  id: string;
  level: string;
  shift: string;
  dayOfWeek: number;
  period: number;
  startTime: string;
  endTime: string;
};

type Subject = { id: string; name: string };

type Template = {
  id: string;
  name: string;
  createdAt: Date;
  _count: { entries: number };
};

export default function GeradorClient({
  initialSchedules,
  teachers,
  timeSlots,
  subjects,
  classes,
  templates,
}: {
  initialSchedules: ScheduleEntry[];
  teachers: Teacher[];
  timeSlots: TimeSlot[];
  subjects: Subject[];
  classes: { id: string; name: string; level: string; shift: string }[];
  templates: Template[];
}) {
  const { showToast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [mode, setMode] = useState<'REPAIR' | 'SCRATCH'>('REPAIR');

  // Configuration state with localStorage persistence
  const [mounted, setMounted] = useState(false);
  const [config, setConfig] = useState<ScheduleConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem('gerador-config');
    if (saved) {
      try { setConfig({ ...DEFAULT_CONFIG, ...JSON.parse(saved) }); } catch {}
    }
  }, []);

  useEffect(() => {
    if (mounted) {
      localStorage.setItem('gerador-config', JSON.stringify(config));
    }
  }, [config, mounted]);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [lastScore, setLastScore] = useState<ScoreBreakdown | null>(null);

  // Accordion state
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['distribution']));

  // Recalculation state
  const [showRecalcModal, setShowRecalcModal] = useState(false);
  const [recalcStep, setRecalcStep] = useState<'changes' | 'preview' | 'result'>('changes');
  const [detectedConflicts, setDetectedConflicts] = useState<Conflict[]>([]);
  const [isLoadingConflicts, setIsLoadingConflicts] = useState(false);
  const [recalcChanges, setRecalcChanges] = useState<RecalculationChange[]>([]);
  const [recalcProposal, setRecalcProposal] = useState<RecalculationProposal | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [recalcResult, setRecalcResult] = useState<{ success: boolean; applied: number } | null>(null);
  
  // Auto-fix state
  const [isAutoFixing, setIsAutoFixing] = useState(false);
  const [autoFixResults, setAutoFixResults] = useState<{ conflictId: string; success: boolean; message: string }[]>([]);
  const [selectedConflict, setSelectedConflict] = useState<Conflict | null>(null);

  // Fixed subject configs state
  const [fixedSubjectConfigs, setFixedSubjectConfigs] = useState<any[]>([]);
  const [showFixedSubjectModal, setShowFixedSubjectModal] = useState(false);
  const [editingFixedSubject, setEditingFixedSubject] = useState<any>(null);
  const [fixedSubjectForm, setFixedSubjectForm] = useState({ subjectId: '', classIds: [] as string[], classesPerWeek: 5 });

  // States for Editing Slot
  const [editingSlot, setEditingSlot] = useState<ScheduleEntry | null>(null);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('');
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');
  const [isSavingSlot, setIsSavingSlot] = useState(false);
  const [schedules, setSchedules] = useState<ScheduleEntry[]>(initialSchedules);

  // Import/Export/Restore states
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // Template states
  const [currentTemplates, setCurrentTemplates] = useState<Template[]>(templates);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [isImportingTemplate, setIsImportingTemplate] = useState(false);

  // Import merge states
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [parsedCurriculums, setParsedCurriculums] = useState<ParsedCurriculum[]>([]);
  const [mergeSuggestions, setMergeSuggestions] = useState<TeacherMergeSuggestion[]>([]);
  const [mergeDecisions, setMergeDecisions] = useState<Record<string, string>>({});
  const [mergeFinalNames, setMergeFinalNames] = useState<Record<string, string>>({});
  const [isApplyingImport, setIsApplyingImport] = useState(false);
  const [pendingTemplateBase64, setPendingTemplateBase64] = useState<string>('');
  const [pendingTemplateName, setPendingTemplateName] = useState<string>('');

  // Custom confirm dialog
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    message: string;
    variant: 'danger' | 'warning' | 'default';
    confirmLabel: string;
    action: 'deleteSlot' | 'restoreDefault' | 'deleteTemplate' | 'deleteFixedSubject' | null;
    payload?: any;
  }>({ open: false, title: '', message: '', variant: 'default', confirmLabel: 'Confirmar', action: null });

  const router = useRouter();

  useEffect(() => {
    setSchedules(initialSchedules);
    setCurrentTemplates(templates);
  }, [initialSchedules, templates]);

  const toggleAccordion = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const updateConfig = (path: string, value: any) => {
    setConfig(prev => {
      const next = { ...prev };
      const keys = path.split('.');
      let obj: any = next;
      for (let i = 0; i < keys.length - 1; i++) {
        obj[keys[i]] = { ...obj[keys[i]] };
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return next;
    });
  };

  const handleGenerateClick = (selectedMode: 'REPAIR' | 'SCRATCH') => {
    setMode(selectedMode);
    setShowConfigModal(true);
  };

  const handleConfirmGeneration = async () => {
    setShowConfirmModal(false);
    setIsGenerating(true);
    showToast('Iniciando o motor de geração...', 'info');
    try {
      const result = await generateSchedule(mode);
      if (result.success) {
        showToast(result.message || 'Sucesso!', 'success');
      } else {
        showToast(`Erro ao gerar: ${result.error || 'desconhecido'}`, 'error');
      }
    } catch (e: any) {
      showToast(`Erro ao comunicar com o motor: ${e?.message || e}`, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateWithConfig = async () => {
    setShowConfigModal(false);
    setIsGenerating(true);
    setLastScore(null);
    showToast('Iniciando geração com configurações personalizadas...', 'info');
    try {
      const result = await generateWithConfig(mode, config);
      if (result.success) {
        showToast(result.message || 'Sucesso!', 'success');
        if (result.score) setLastScore(result.score);
      } else {
        showToast(`Erro ao gerar: ${result.error || 'desconhecido'}`, 'error');
      }
    } catch (e: any) {
      showToast(`Erro ao comunicar com o motor: ${e?.message || e}`, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleOpenRecalcModal = async () => {
    setShowRecalcModal(true);
    setRecalcStep('changes');
    setIsLoadingConflicts(true);
    setDetectedConflicts([]);
    setRecalcChanges([]);
    setRecalcProposal(null);
    setRecalcResult(null);
    try {
      const conflicts = await fetchConflicts();
      setDetectedConflicts(conflicts);
    } catch {
      showToast('Erro ao detectar conflitos.', 'error');
    } finally {
      setIsLoadingConflicts(false);
    }
  };

  const addRecalcChange = () => {
    setRecalcChanges(prev => [...prev, { type: 'replace_teacher' as const, oldTeacherId: '', newTeacherId: '' }]);
  };

  const updateRecalcChange = (index: number, field: 'oldTeacherId' | 'newTeacherId', value: string) => {
    setRecalcChanges(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const removeRecalcChange = (index: number) => {
    setRecalcChanges(prev => prev.filter((_, i) => i !== index));
  };

  const handlePreviewRecalc = async () => {
    const validChanges = recalcChanges.filter(c => c.oldTeacherId && c.newTeacherId);
    if (validChanges.length === 0) {
      showToast('Adicione pelo menos uma mudança válida.', 'error');
      return;
    }
    setIsPreviewing(true);
    try {
      const proposal = await previewRecalculation(validChanges);
      setRecalcProposal(proposal);
      setRecalcStep('preview');
    } catch {
      showToast('Erro ao gerar pré-visualização.', 'error');
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleConfirmRecalc = async () => {
    const validChanges = recalcChanges.filter(c => c.oldTeacherId && c.newTeacherId);
    setIsApplying(true);
    try {
      const result = await confirmRecalculation(validChanges);
      if (result.success) {
        setRecalcResult(result);
        setRecalcStep('result');
        showToast(`Recálculo aplicado! ${result.applied} aula(s) atualizada(s).`, 'success');
        router.refresh();
      } else {
        showToast('Erro ao aplicar recálculo.', 'error');
      }
    } catch {
      showToast('Erro ao comunicar com o servidor.', 'error');
    } finally {
      setIsApplying(false);
    }
  };

  const handleAutoFixConflict = async (conflict: Conflict) => {
    if (!conflict.autoFixable || !conflict.suggestedFix) {
      showToast('Este conflito não pode ser corrigido automaticamente.', 'error');
      return;
    }

    setIsAutoFixing(true);
    try {
      const result = await autoFixConflict(conflict.id);
      if (result.success) {
        showToast(`Conflito corrigido: ${result.message}`, 'success');
        // Refresh conflicts
        const updatedConflicts = await fetchConflicts();
        setDetectedConflicts(updatedConflicts);
      } else {
        showToast(`Erro ao corrigir: ${result.message}`, 'error');
      }
    } catch {
      showToast('Erro ao comunicar com o servidor.', 'error');
    } finally {
      setIsAutoFixing(false);
    }
  };

  const handleAutoFixAll = async () => {
    setIsAutoFixing(true);
    setAutoFixResults([]);
    try {
      const result = await autoFixAllConflicts();
      setAutoFixResults(result.results);
      
      if (result.fixed > 0) {
        showToast(`${result.fixed} conflito(s) corrigido(s) com sucesso!`, 'success');
        // Refresh conflicts
        const updatedConflicts = await fetchConflicts();
        setDetectedConflicts(updatedConflicts);
      }
      
      if (result.failed > 0) {
        showToast(`${result.failed} conflito(s) não puderam ser corrigidos automaticamente.`, 'info');
      }
    } catch {
      showToast('Erro ao comunicar com o servidor.', 'error');
    } finally {
      setIsAutoFixing(false);
    }
  };

  // Fixed Subject Config functions
  const loadFixedSubjectConfigs = async () => {
    try {
      const configs = await fetchFixedSubjectConfigs();
      setFixedSubjectConfigs(configs);
    } catch {
      showToast('Erro ao carregar disciplinas de período fixo.', 'error');
    }
  };

  const handleOpenFixedSubjectModal = (config?: any) => {
    if (config) {
      setEditingFixedSubject(config);
      setFixedSubjectForm({
        subjectId: config.subjectId,
        classIds: config.classes.map((c: any) => c.classId),
        classesPerWeek: config.classesPerWeek,
      });
    } else {
      setEditingFixedSubject(null);
      setFixedSubjectForm({ subjectId: '', classIds: [], classesPerWeek: 5 });
    }
    setShowFixedSubjectModal(true);
  };

  const handleSaveFixedSubject = async () => {
    if (!fixedSubjectForm.subjectId) {
      showToast('Selecione uma disciplina.', 'error');
      return;
    }
    if (fixedSubjectForm.classIds.length === 0) {
      showToast('Selecione pelo menos uma turma.', 'error');
      return;
    }
    try {
      if (editingFixedSubject) {
        const result = await updateFixedSubjectConfig(editingFixedSubject.id, fixedSubjectForm.classIds, fixedSubjectForm.classesPerWeek);
        if (result.success) {
          showToast('Disciplina de período fixo atualizada!', 'success');
        } else {
          showToast(result.error || 'Erro ao atualizar.', 'error');
          return;
        }
      } else {
        const result = await createFixedSubjectConfig(fixedSubjectForm.subjectId, fixedSubjectForm.classIds, fixedSubjectForm.classesPerWeek);
        if (result.success) {
          showToast('Disciplina de período fixo criada!', 'success');
        } else {
          showToast(result.error || 'Erro ao criar.', 'error');
          return;
        }
      }
      setShowFixedSubjectModal(false);
      await loadFixedSubjectConfigs();
    } catch {
      showToast('Erro ao salvar.', 'error');
    }
  };

  const handleDeleteFixedSubject = async (configId: string) => {
    setConfirmState({
      open: true,
      title: 'Excluir Disciplina de Período Fixo',
      message: 'Tem certeza que deseja excluir esta configuração? As aulas serão redistribuídas na próxima geração.',
      variant: 'danger',
      confirmLabel: 'Excluir',
      action: 'deleteFixedSubject',
      payload: configId,
    });
  };

  const executeDeleteFixedSubject = async (configId: string) => {
    try {
      const result = await deleteFixedSubjectConfig(configId);
      if (result.success) {
        showToast('Configuração excluída.', 'success');
        await loadFixedSubjectConfigs();
      } else {
        showToast('Erro ao excluir.', 'error');
      }
    } catch {
      showToast('Erro interno.', 'error');
    }
  };

  useEffect(() => {
    loadFixedSubjectConfigs();
  }, []);

  const handleSlotClick = (slot: ScheduleEntry | null, classId: string, day: number, displayPeriod: number, classLevel: string, classShift: string) => {
    if (slot) {
      setEditingSlot(slot);
      setSelectedTeacherId(slot.Teacher?.id || '');
      setSelectedSubjectId(slot.Subject.id);
    } else {
      setEditingSlot({
        id: `new-${classId}-${day}-${displayPeriod}`,
        dayOfWeek: day,
        period: displayPeriod,
        isFixed: false,
        Class: { id: classId, name: classes.find(c => c.id === classId)?.name || '', level: classLevel, shift: classShift },
        Subject: { id: '', name: '' },
        Teacher: null,
      } as ScheduleEntry);
      setSelectedTeacherId('');
      setSelectedSubjectId('');
    }
  };

  const handleSaveSlot = async () => {
    if (!editingSlot) return;
    setIsSavingSlot(true);
    try {
      const isNew = editingSlot.id.startsWith('new-');
      let res;
      if (isNew) {
        if (!selectedSubjectId) { showToast('Selecione uma disciplina.', 'error'); return; }
        res = await createSlot({
          classId: editingSlot.Class.id,
          subjectId: selectedSubjectId,
          teacherId: selectedTeacherId || null,
          dayOfWeek: editingSlot.dayOfWeek,
          period: editingSlot.period,
        });
      } else {
        res = await updateSlotTeacher(editingSlot.id, selectedTeacherId || null);
      }
      if (res?.success) {
        showToast(isNew ? 'Aula adicionada!' : 'Professor atualizado!', 'success');
        setEditingSlot(null);
        router.refresh();
      } else {
        showToast('Erro ao salvar.', 'error');
      }
    } catch {
      showToast('Erro interno.', 'error');
    } finally {
      setIsSavingSlot(false);
    }
  };

  const handleDeleteSlot = async (slot: ScheduleEntry) => {
    setConfirmState({
      open: true,
      title: 'Remover Aula',
      message: `Remover a aula de ${slot.Subject.name} (${slot.Class.name})?`,
      variant: 'danger',
      confirmLabel: 'Remover',
      action: 'deleteSlot',
      payload: slot,
    });
  };

  const executeDeleteSlot = async (slot: ScheduleEntry) => {
    try {
      const res = await deleteSlot(slot.id);
      if (res?.success) {
        showToast('Aula removida.', 'success');
        router.refresh();
      } else {
        showToast('Erro ao remover.', 'error');
      }
    } catch {
      showToast('Erro interno.', 'error');
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const blob = await backupAll();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup-chronogrid-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Backup realizado com sucesso!', 'success');
    } catch {
      showToast('Erro ao exportar backup.', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async () => {
    if (!importFile) { showToast('Selecione um arquivo.', 'error'); return; }
    setIsImporting(true);
    try {
      const text = await importFile.text();
      const res = await restoreAll(text);
      if (res?.success) {
        showToast('Dados restaurados com sucesso!', 'success');
        setShowImportModal(false);
        setImportFile(null);
        router.refresh();
      } else {
        showToast(res?.error || 'Erro ao restaurar dados.', 'error');
      }
    } catch {
      showToast('Erro ao ler arquivo.', 'error');
    } finally {
      setIsImporting(false);
    }
  };

  const handleFixPeriods = async () => {
    showToast('Corrigindo períodos...', 'info');
    const result = await fixPeriodNormalization();
    showToast(result.message, result.fixed > 0 ? 'success' : 'info');
    router.refresh();
  };

  const handleExportDiagnostic = async () => {
    try {
      const json = await exportDiagnostic();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `diagnostico-chronogrid-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Diagnóstico exportado!', 'success');
    } catch {
      showToast('Erro ao exportar diagnóstico.', 'error');
    }
  };

  const handleRestoreDefault = async () => {
    if (currentTemplates.length === 0) {
      showToast('Nenhum modelo cadastrado. Importe um modelo Excel primeiro.', 'error');
      return;
    }

    const templateId = selectedTemplateId || currentTemplates[0]?.id;
    if (!templateId) return;

    const template = currentTemplates.find(t => t.id === templateId);
    setConfirmState({
      open: true,
      title: 'Restaurar Grade',
      message: `Restaurar grade usando modelo "${template?.name}"? Isso sobrescreverá a grade atual.`,
      variant: 'warning',
      confirmLabel: 'Restaurar',
      action: 'restoreDefault',
      payload: templateId,
    });
  };

  const executeRestoreDefault = async (templateId: string) => {
    setIsRestoring(true);
    try {
      const res = await restoreDefaultSchedule(templateId);
      if (res?.success) {
        showToast(res.templateName ? `Grade restaurada usando modelo "${res.templateName}"!` : 'Grade padrão restaurada!', 'success');
        router.refresh();
      } else {
        showToast(res?.error || 'Erro ao restaurar.', 'error');
      }
    } catch {
      showToast('Erro interno.', 'error');
    } finally {
      setIsRestoring(false);
    }
  };

  const handleImportTemplate = async () => {
    if (!templateFile) { showToast('Selecione um arquivo.', 'error'); return; }
    setIsImportingTemplate(true);
    try {
      const arrayBuffer = await templateFile.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      setPendingTemplateBase64(base64);
      setPendingTemplateName(templateFile.name);
      const res = await analyzeExcelForImport(base64, templateFile.name);
      if (res?.success && res.curriculums && res.mergeSuggestions) {
        setParsedCurriculums(res.curriculums);
        setMergeSuggestions(res.mergeSuggestions);
        const initialDecisions: Record<string, string> = {};
        res.mergeSuggestions.forEach(s => { initialDecisions[s.newName] = s.existingTeacherName; });
        setMergeDecisions(initialDecisions);
        setShowMergeModal(true);
        setShowTemplateModal(false);
      } else {
        showToast(res?.error || 'Erro ao analisar arquivo.', 'error');
      }
    } catch {
      showToast('Erro ao ler arquivo.', 'error');
    } finally {
      setIsImportingTemplate(false);
    }
  };

  const handleApplyImport = async () => {
    setIsApplyingImport(true);
    try {
      const res = await applyImportWithMerges(parsedCurriculums, mergeDecisions, mergeFinalNames);
      if (res?.success) {
        let templateId = '';
        if (pendingTemplateBase64) {
          const tplRes = await importTemplateFromExcel(pendingTemplateBase64, pendingTemplateName);
          if (tplRes?.success && tplRes.templateId) templateId = tplRes.templateId;
        }
        if (templateId) {
          await restoreDefaultSchedule(templateId, mergeDecisions);
        }
        showToast(`Importação concluída! ${res.created} vínculos criados, ${res.updated} atualizados.${res.classesCreated ? ` ${res.classesCreated} turmas criadas.` : ''}${res.subjectsCreated ? ` ${res.subjectsCreated} disciplinas criadas.` : ''}${res.deleted ? ` ${res.deleted} professores mesclados removidos.` : ''}`, 'success');
        setShowMergeModal(false);
        setParsedCurriculums([]);
        setMergeSuggestions([]);
        setMergeDecisions({});
        setPendingTemplateBase64('');
        setPendingTemplateName('');
        router.refresh();
      } else {
        showToast(res?.error || 'Erro ao aplicar importação.', 'error');
      }
    } catch {
      showToast('Erro ao aplicar importação.', 'error');
    } finally {
      setIsApplyingImport(false);
    }
  };

  const handleDeleteTemplate = async (templateId: string, templateName: string) => {
    setConfirmState({
      open: true,
      title: 'Excluir Modelo',
      message: `Excluir modelo "${templateName}"? Esta ação não pode ser desfeita.`,
      variant: 'danger',
      confirmLabel: 'Excluir',
      action: 'deleteTemplate',
      payload: { id: templateId, name: templateName },
    });
  };

  const executeDeleteTemplate = async (templateId: string) => {
    try {
      const res = await deleteTemplate(templateId);
      if (res?.success) {
        showToast('Modelo excluído.', 'success');
        router.refresh();
      } else {
        showToast('Erro ao excluir.', 'error');
      }
    } catch {
      showToast('Erro interno.', 'error');
    }
  };

  // Helper: get the time label for a given class+period combo.
  // We use Monday (dayOfWeek=1) as the representative day for most classes,
  // but fall back to any day if Monday doesn't have that slot.
  const getSlotTime = (level: string, shift: string, period: number): string | null => {
    const ts =
      timeSlots.find(t => t.level === level && t.shift === shift && t.period === period && t.dayOfWeek === 1) ??
      timeSlots.find(t => t.level === level && t.shift === shift && t.period === period);
    return ts ? `${ts.startTime}–${ts.endTime}` : null;
  };

  // Group schedules by class name
  const classesMap = new Map<string, ScheduleEntry[]>();
  schedules.forEach(s => {
    if (!classesMap.has(s.Class.name)) classesMap.set(s.Class.name, []);
    classesMap.get(s.Class.name)!.push(s);
  });

  const getTotalSlots = (level: string, shift: string): number => {
    if (!level || !shift) return 0;
    const shiftKey = shift.toLowerCase() as 'morning' | 'afternoon';
    const wd = config.classDistribution.weekdays[shiftKey];
    const fri = config.classDistribution.friday[shiftKey];
    if (!wd || !fri) return 0;
    const levelKey = level as keyof typeof wd;
    return (wd[levelKey] || 5) * 4 + (fri[levelKey] || 5);
  };

  const classOrder = ['Maternal', 'Pré I', 'Pré II'];
  const classNames = Array.from(classesMap.keys()).sort((a, b) => {
    const aIdx = classOrder.indexOf(a);
    const bIdx = classOrder.indexOf(b);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    const aNum = parseInt(a);
    const bNum = parseInt(b);
    if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
    return a.localeCompare(b);
  });

  const [selectedClassName, setSelectedClassName] = useState<string>(classNames[0] || '');
  const displayedClassNames = selectedClassName ? [selectedClassName] : classNames;

  const days = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];

  return (
    <>
      <div className="table-container" style={{ padding: '2rem', marginBottom: '2rem', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
          <div>
            <h2 style={{ marginBottom: '0.5rem' }}>Controle do Motor Gerador</h2>
            <p style={{ color: 'var(--text-secondary)' }}>
              Escolha como deseja que o algoritmo trabalhe. Recomendamos o modo de <strong>Recálculo</strong> para preservar a grade atual.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={() => setShowTemplateModal(true)}>
              📋 Importar Modelo Excel
            </button>
            <button className="btn btn-secondary" onClick={handleExport} disabled={isExporting}>
              {isExporting ? 'Exportando...' : '💾 Backup'}
            </button>
            <button className="btn btn-secondary" onClick={() => setShowImportModal(true)} disabled={isImporting}>
              {isImporting ? 'Restaurando...' : '🔄 Restaurar'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleRestoreDefault}
              disabled={isRestoring || currentTemplates.length === 0}
              style={{
                backgroundColor: currentTemplates.length === 0 ? '#ccc' : 'var(--warning-color)',
                borderColor: currentTemplates.length === 0 ? '#ccc' : 'var(--warning-color)',
                cursor: currentTemplates.length === 0 ? 'not-allowed' : 'pointer',
              }}
              title={currentTemplates.length === 0 ? 'Nenhum modelo cadastrado. Importe um modelo Excel primeiro.' : 'Restaurar grade a partir do modelo selecionado'}
            >
              {isRestoring ? 'Restaurando...' : '🔄 Restaurar Padrão'}
            </button>
            <button className="btn btn-secondary" onClick={handleFixPeriods} title="Corrigir períodos > 6 no banco de dados">
              🔧 Corrigir Períodos
            </button>
            <button className="btn btn-secondary" onClick={handleExportDiagnostic} title="Exportar diagnóstico da grade atual">
              📊 Diagnóstico
            </button>
          </div>
        </div>

        {currentTemplates.length > 0 && (
          <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Modelo para restaurar:</label>
            <select
              className="input"
              value={selectedTemplateId || currentTemplates[0]?.id || ''}
              onChange={e => setSelectedTemplateId(e.target.value)}
              style={{ maxWidth: '300px' }}
            >
              {currentTemplates.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t._count.entries} aulas)</option>
              ))}
            </select>
          </div>
        )}

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', opacity: isGenerating ? 0.7 : 1 }}
            onClick={handleOpenRecalcModal}
            disabled={isGenerating}
          >
            {isGenerating && mode === 'REPAIR' ? '⏳ Recalculando...' : '✨ Recalcular Conflitos (Recomendado)'}
          </button>

          <button
            className="btn btn-secondary"
            style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', opacity: isGenerating ? 0.7 : 1 }}
            onClick={() => handleGenerateClick('SCRATCH')}
            disabled={isGenerating}
          >
            {isGenerating && mode === 'SCRATCH' ? '⏳ Gerando...' : '⚠️ Gerar do Zero'}
          </button>
        </div>
      </div>

      <div style={{ padding: '0 2rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Grade de Horários Atual</h3>
        <select
          className="input"
          style={{ padding: '0.4rem 0.75rem', fontSize: '0.9rem', minWidth: '200px' }}
          value={selectedClassName}
          onChange={e => setSelectedClassName(e.target.value)}
        >
          <option value="">Todas as turmas</option>
          {classNames.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>

      {displayedClassNames.map(className => {
        const classSchedules = classesMap.get(className) || [];
        const classInfo = classes.find(c => c.name === className);
        const classLevel = classSchedules[0]?.Class.level ?? classInfo?.level ?? 'FUND2';
        const classShift = classSchedules[0]?.Class.shift ?? classInfo?.shift ?? 'MORNING';
        const maxP = (classLevel === 'INFANTIL' || classLevel === 'FUND1') ? 5 : 6;

        // Build lookup: "day-normalizedPeriod" -> schedule entry
        const validSchedules = classSchedules.filter(s => {
          return s.period >= 1 && s.period <= maxP;
        });
        const slotLookup = new Map<string, ScheduleEntry>();
        for (const s of validSchedules) {
          slotLookup.set(s.dayOfWeek + '-' + s.period, s);
        }

        return (
          <div key={className} className="table-container" style={{ padding: '1.5rem', marginBottom: '2rem', marginLeft: '2rem', marginRight: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h4 style={{ color: 'var(--primary-color)', margin: 0, fontSize: '1.2rem' }}>
                Turma: {className}
              </h4>
              <span style={{
                fontSize: '0.9rem',
                fontWeight: 'bold',
                color: validSchedules.length >= getTotalSlots(classLevel, classShift) ? 'var(--success-color)' : 'var(--text-secondary)',
                backgroundColor: validSchedules.length >= getTotalSlots(classLevel, classShift) ? '#dcfce7' : '#f3f4f6',
                padding: '0.25rem 0.75rem',
                borderRadius: 'var(--radius-sm)',
              }}>
                {validSchedules.length}/{getTotalSlots(classLevel, classShift)} aulas
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr>
                    <th style={{ borderBottom: '2px solid var(--border-color)', padding: '0.5rem', textAlign: 'left', minWidth: '90px' }}>
                      Aula
                    </th>
                    {days.map(d => (
                      <th key={d} style={{ borderBottom: '2px solid var(--border-color)', padding: '0.5rem', textAlign: 'left' }}>
                        {d}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: maxP }).map((_, periodIndex) => {
                    const displayPeriod = periodIndex + 1;
                    const timeLabel = getSlotTime(classLevel, classShift, displayPeriod);
                    return (
                      <tr key={displayPeriod} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '0.5rem', minWidth: '90px' }}>
                          <div style={{ fontWeight: 'bold', color: 'var(--text-secondary)' }}>{displayPeriod}ª Aula</div>
                          {timeLabel && (
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', opacity: 0.7, marginTop: '2px' }}>
                              {timeLabel}
                            </div>
                          )}
                        </td>
                        {days.map((_, dayIndex) => {
                          const day = dayIndex + 1;
                          const slot = slotLookup.get(day + '-' + displayPeriod);
                          const classId = classes.find(c => c.name === className)?.id || '';
                          return (
                            <td key={day} style={{ padding: '0.5rem' }}>
                              {slot ? (
                                <div
                                  onClick={() => handleSlotClick(slot, classId, day, slot.period, classLevel, classShift)}
                                  style={{
                                    backgroundColor: slot.isFixed ? '#fef3c7' : 'var(--bg-primary)',
                                    padding: '0.5rem',
                                    borderRadius: 'var(--radius-sm)',
                                    border: '1px solid var(--border-color)',
                                    cursor: 'pointer',
                                    transition: 'border-color 0.2s',
                                    position: 'relative',
                                  }}
                                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--primary-color)')}
                                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-color)')}
                                  title="Clique para editar"
                                >
                                  <div style={{ fontWeight: 'bold' }}>{slot.Subject.name}</div>
                                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                                    {slot.Teacher ? slot.Teacher.name : 'Sem Prof.'}
                                  </div>
                                  {!slot.isFixed && (
                                    <button
                                      onClick={e => { e.stopPropagation(); handleDeleteSlot(slot); }}
                                      style={{
                                        position: 'absolute',
                                        top: '2px',
                                        right: '2px',
                                        padding: '2px 6px',
                                        fontSize: '0.7rem',
                                        background: 'var(--danger-color)',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: 'var(--radius-sm)',
                                        cursor: 'pointer',
                                      }}
                                    >
                                      ✕
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <div
                                  onClick={() => handleSlotClick(null, classId, day, displayPeriod, classLevel, classShift)}
                                  style={{
                                    color: '#888',
                                    fontStyle: 'italic',
                                    padding: '0.5rem',
                                    border: '2px dashed var(--border-color)',
                                    borderRadius: 'var(--radius-sm)',
                                    cursor: 'pointer',
                                    backgroundColor: 'var(--bg-secondary)',
                                    transition: 'border-color 0.2s, background-color 0.2s',
                                  }}
                                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary-color)'; e.currentTarget.style.backgroundColor = 'rgba(79,70,229,0.05)'; }}
                                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'; }}
                                  title="Clique para adicionar aula"
                                >
                                  + Adicionar
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {/* ── Modal de Confirmação ────────────────────────────────── */}
      <Modal
        isOpen={showConfirmModal}
        onClose={() => !isGenerating && setShowConfirmModal(false)}
        title={mode === 'REPAIR' ? 'Confirmar Recálculo' : 'Atenção: Geração do Zero'}
      >
        <p style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>
          {mode === 'REPAIR'
            ? 'O sistema tentará resolver os conflitos de horário alterando apenas o necessário e preservando a maior parte da grade atual. Deseja continuar?'
            : 'ATENÇÃO: A grade inteira será apagada e o algoritmo tentará encaixar todas as aulas novamente do zero. Isso mudará completamente os horários atuais. Deseja continuar?'}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          <button className="btn btn-secondary" onClick={() => setShowConfirmModal(false)}>
            Cancelar
          </button>
          <button
            className="btn btn-primary"
            style={mode === 'SCRATCH' ? { backgroundColor: 'var(--danger-color)' } : {}}
            onClick={handleConfirmGeneration}
          >
            Sim, Iniciar
          </button>
        </div>
      </Modal>

      {/* ── Modal de Edição/Adição de Aula ─────────────────────────── */}
      <Modal
        isOpen={!!editingSlot}
        onClose={() => !isSavingSlot && setEditingSlot(null)}
        title={editingSlot?.id.startsWith('new-') ? 'Adicionar Nova Aula' : 'Editar Aula'}
      >
        {editingSlot && (
          <>
            <p style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>
              {editingSlot.id.startsWith('new-')
                ? `Adicionar aula na <strong>${editingSlot.Class.name}</strong>, ${days[editingSlot.dayOfWeek - 1]}, ${editingSlot.period}ª aula.`
                : `Alterar a aula de <strong>${editingSlot.Subject.name}</strong> da turma <strong>${editingSlot.Class.name}</strong>.`}
            </p>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                Disciplina {editingSlot.id.startsWith('new-') ? '*' : ''}
              </label>
              <select className="input" value={selectedSubjectId} onChange={e => setSelectedSubjectId(e.target.value)}>
                <option value="">Selecione...</option>
                {subjects.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                Professor
              </label>
              <select className="input" value={selectedTeacherId} onChange={e => setSelectedTeacherId(e.target.value)}>
                <option value="">(Sem Professor)</option>
                {teachers.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
              {editingSlot.id.startsWith('new-') && (
                <button className="btn btn-secondary" onClick={() => setEditingSlot(null)}>
                  Cancelar
                </button>
              )}
              <button className="btn btn-primary" onClick={handleSaveSlot} disabled={isSavingSlot}>
                {isSavingSlot ? 'Salvando...' : editingSlot.id.startsWith('new-') ? 'Adicionar' : 'Salvar Alteração'}
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* ── Modal de Restauração ──────────────────────────────────── */}
      <Modal
        isOpen={showImportModal}
        onClose={() => !isImporting && setShowImportModal(false)}
        title="Restaurar Dados"
      >
        <p style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Selecione um arquivo de backup (.json) gerado pelo botão "Backup". <strong>Atenção:</strong> isso substituirá TODOS os dados atuais (professores, disciplinas, turmas, grades e horários).
        </p>
        <div style={{ marginBottom: '1.5rem' }}>
          <input
            type="file"
            accept=".json"
            className="input"
            onChange={e => setImportFile(e.target.files?.[0] || null)}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          <button className="btn btn-secondary" onClick={() => { setShowImportModal(false); setImportFile(null); }}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={handleImport} disabled={isImporting || !importFile}>
            {isImporting ? 'Restaurando...' : '🔄 Restaurar'}
          </button>
        </div>
      </Modal>

      {/* ── Modal de Importação de Modelo Excel ──────────────────── */}
      <Modal
        isOpen={showTemplateModal}
        onClose={() => !isImportingTemplate && setShowTemplateModal(false)}
        title="Importar Modelo Excel"
      >
        <p style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Selecione o arquivo Excel (.xlsx) com a grade horária. O modelo será salvo para uso posterior com o botão "Restaurar Padrão".
        </p>
        <div style={{ marginBottom: '1.5rem' }}>
          <input
            type="file"
            accept=".xlsx,.xls"
            className="input"
            onChange={e => setTemplateFile(e.target.files?.[0] || null)}
            style={{ width: '100%' }}
          />
        </div>
        {currentTemplates.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
              Modelos existentes:
            </label>
            <div style={{ maxHeight: '150px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)' }}>
              {currentTemplates.map(t => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>
                  <span style={{ fontSize: '0.875rem' }}>{t.name} ({t._count.entries} aulas)</span>
                  <button
                    onClick={() => handleDeleteTemplate(t.id, t.name)}
                    style={{
                      padding: '2px 6px',
                      fontSize: '0.7rem',
                      background: 'var(--danger-color)',
                      color: 'white',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                    }}
                  >
                    Excluir
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          <button className="btn btn-secondary" onClick={() => { setShowTemplateModal(false); setTemplateFile(null); }}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={handleImportTemplate} disabled={isImportingTemplate || !templateFile}>
            {isImportingTemplate ? 'Importando...' : 'Importar Modelo'}
          </button>
        </div>
      </Modal>

      {/* ── Modal de Mesclagem de Professores ──────────────────── */}
      <Modal
        isOpen={showMergeModal}
        onClose={() => !isApplyingImport && setShowMergeModal(false)}
        title="Importar Grade Curricular"
        size="lg"
      >
        <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Foram encontrados <strong>{parsedCurriculums.length}</strong> vínculos de disciplinas
          ({parsedCurriculums.reduce((s, c) => s + c.classesPerWeek, 0)} aulas no total).
        </p>

        {mergeSuggestions.length > 0 && (
          <>
            <h4 style={{ marginBottom: '0.75rem', color: 'var(--primary-color)' }}>
              Professores para mesclar
            </h4>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
              O Excel menciona professores que parecem ser os mesmos já cadastrados. Verifique:
            </p>
            <div style={{ maxHeight: '250px', overflowY: 'auto', marginBottom: '1.5rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)' }}>
              {mergeSuggestions.map((s, idx) => {
                const isMerging = mergeDecisions[s.newName] === s.existingTeacherName;
                return (
                  <div key={idx} style={{ padding: '0.75rem', borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: isMerging ? '0.5rem' : 0 }}>
                      <span style={{ flex: 1 }}>
                        <strong>"{s.newName}"</strong> do Excel parece ser o mesmo que{' '}
                        <select
                          className="input"
                          style={{ padding: '0.2rem 0.4rem', fontSize: '0.8rem', display: 'inline', width: 'auto' }}
                          value={mergeDecisions[s.newName] || ''}
                          onChange={e => {
                            const val = e.target.value;
                            setMergeDecisions(prev => ({ ...prev, [s.newName]: val }));
                            if (val === s.existingTeacherName) {
                              setMergeFinalNames(prev => ({ ...prev, [s.newName]: s.existingTeacherName }));
                            }
                          }}
                        >
                          <option value={s.newName}>Criar como "{s.newName}" (novo professor)</option>
                          <option value={s.existingTeacherName}>Mesclar com "{s.existingTeacherName}"</option>
                        </select>
                      </span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                        {Math.round(s.confidence * 100)}% similar
                      </span>
                    </div>
                    {isMerging && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingLeft: '1rem' }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Manter nome:</label>
                        <input
                          type="text"
                          className="input"
                          style={{ flex: 1, padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                          value={mergeFinalNames[s.newName] || s.existingTeacherName}
                          onChange={e => setMergeFinalNames(prev => ({ ...prev, [s.newName]: e.target.value }))}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {mergeSuggestions.length === 0 && (
          <div style={{ padding: '1rem', backgroundColor: '#dcfce7', borderRadius: 'var(--radius-sm)', marginBottom: '1rem', fontSize: '0.875rem' }}>
            Nenhuma mesclagem necessária. Todos os professores do Excel são novos.
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          <button className="btn btn-secondary" onClick={() => setShowMergeModal(false)} disabled={isApplyingImport}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={handleApplyImport} disabled={isApplyingImport}>
            {isApplyingImport ? 'Aplicando...' : `Aplicar ${parsedCurriculums.length} vínculos`}
          </button>
        </div>
      </Modal>

      {/* ── Confirm Modal ────────────────────────────────────────── */}
      <ConfirmModal
        isOpen={confirmState.open}
        onClose={() => setConfirmState(s => ({ ...s, open: false }))}
        onConfirm={() => {
          setConfirmState(s => ({ ...s, open: false }));
          if (confirmState.action === 'deleteSlot' && confirmState.payload) {
            executeDeleteSlot(confirmState.payload);
          } else if (confirmState.action === 'restoreDefault' && confirmState.payload) {
            executeRestoreDefault(confirmState.payload);
          } else if (confirmState.action === 'deleteTemplate' && confirmState.payload) {
            executeDeleteTemplate(confirmState.payload.id);
          } else if (confirmState.action === 'deleteFixedSubject' && confirmState.payload) {
            executeDeleteFixedSubject(confirmState.payload);
          }
        }}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel={confirmState.confirmLabel}
        variant={confirmState.variant}
      />

      {/* ── Modal de Configuração do Gerador ─────────────────────── */}
      <Modal
        isOpen={showConfigModal}
        onClose={() => !isGenerating && setShowConfigModal(false)}
        title={mode === 'REPAIR' ? '⚙️ Configurar Recálculo' : '⚙️ Configurar Geração do Zero'}
        size="lg"
      >
        <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: '0.5rem' }}>
          {/* Seção: Distribuição de Aulas */}
          <div style={{ marginBottom: '1rem' }}>
            <button
              onClick={() => toggleAccordion('distribution')}
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.75rem 1rem',
                backgroundColor: expandedSections.has('distribution') ? 'var(--primary-color)' : 'var(--bg-primary)',
                color: expandedSections.has('distribution') ? 'white' : 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
              }}
            >
              <span>📅 Aulas por Dia e Turno</span>
              <span>{expandedSections.has('distribution') ? '▼' : '▶'}</span>
            </button>
            {expandedSections.has('distribution') && (
              <div style={{ padding: '1rem', border: '1px solid var(--border-color)', borderTop: 'none', borderRadius: '0 0 var(--radius-md) var(--radius-md)', backgroundColor: 'white' }}>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                  Configure quantas aulas por turno para cada nível. Sexta-feira pode ter menos aulas (pôr do sol).
                </p>

                {/* Segunda a Quinta */}
                <div style={{ marginBottom: '1rem' }}>
                  <h4 style={{ fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--primary-color)' }}>Segunda a Quinta</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '140px 80px 80px', gap: '0.5rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 500 }}></span>
                    <span style={{ fontSize: '0.75rem', textAlign: 'center', fontWeight: 600 }}>Manhã</span>
                    <span style={{ fontSize: '0.75rem', textAlign: 'center', fontWeight: 600 }}>Tarde</span>
                    {['INFANTIL', 'FUND1', 'FUND2', 'MEDIO'].map(level => (
                      <React.Fragment key={level}>
                        <span style={{ fontSize: '0.8rem' }}>
                          {level === 'INFANTIL' ? 'Infantil' : level === 'FUND1' ? 'Fund. I' : level === 'FUND2' ? 'Fund. II' : 'Médio'}
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={6}
                          value={config.classDistribution.weekdays.morning[level as keyof typeof config.classDistribution.weekdays.morning]}
                          onChange={e => updateConfig(`classDistribution.weekdays.morning.${level}`, parseInt(e.target.value) || 5)}
                          style={{ width: '100%', padding: '0.4rem', textAlign: 'center', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' }}
                        />
                        <input
                          type="number"
                          min={1}
                          max={6}
                          value={config.classDistribution.weekdays.afternoon[level as keyof typeof config.classDistribution.weekdays.afternoon]}
                          onChange={e => updateConfig(`classDistribution.weekdays.afternoon.${level}`, parseInt(e.target.value) || 5)}
                          style={{ width: '100%', padding: '0.4rem', textAlign: 'center', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' }}
                        />
                      </React.Fragment>
                    ))}
                  </div>
                </div>

                {/* Sexta-feira */}
                <div>
                  <h4 style={{ fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--warning-color)' }}>🌅 Sexta-feira (Pôr do Sol)</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '140px 80px 80px', gap: '0.5rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 500 }}></span>
                    <span style={{ fontSize: '0.75rem', textAlign: 'center', fontWeight: 600 }}>Manhã</span>
                    <span style={{ fontSize: '0.75rem', textAlign: 'center', fontWeight: 600 }}>Tarde</span>
                    {['INFANTIL', 'FUND1', 'FUND2', 'MEDIO'].map(level => (
                      <React.Fragment key={level}>
                        <span style={{ fontSize: '0.8rem' }}>
                          {level === 'INFANTIL' ? 'Infantil' : level === 'FUND1' ? 'Fund. I' : level === 'FUND2' ? 'Fund. II' : 'Médio'}
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={6}
                          value={config.classDistribution.friday.morning[level as keyof typeof config.classDistribution.friday.morning]}
                          onChange={e => updateConfig(`classDistribution.friday.morning.${level}`, parseInt(e.target.value) || 5)}
                          style={{ width: '100%', padding: '0.4rem', textAlign: 'center', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' }}
                        />
                        <input
                          type="number"
                          min={1}
                          max={6}
                          value={config.classDistribution.friday.afternoon[level as keyof typeof config.classDistribution.friday.afternoon]}
                          onChange={e => updateConfig(`classDistribution.friday.afternoon.${level}`, parseInt(e.target.value) || 4)}
                          style={{ width: '100%', padding: '0.4rem', textAlign: 'center', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' }}
                        />
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Seção: Dobradinhas */}
          <div style={{ marginBottom: '1rem' }}>
            <button
              onClick={() => toggleAccordion('doubles')}
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.75rem 1rem',
                backgroundColor: expandedSections.has('doubles') ? 'var(--primary-color)' : 'var(--bg-primary)',
                color: expandedSections.has('doubles') ? 'white' : 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
              }}
            >
              <span>🔄 Dobradinhas</span>
              <span>{expandedSections.has('doubles') ? '▼' : '▶'}</span>
            </button>
            {expandedSections.has('doubles') && (
              <div style={{ padding: '1rem', border: '1px solid var(--border-color)', borderTop: 'none', borderRadius: '0 0 var(--radius-md) var(--radius-md)', backgroundColor: 'white' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
                  <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={config.doublePeriods.enabled}
                      onChange={e => updateConfig('doublePeriods.enabled', e.target.checked)}
                      style={{ width: '16px', height: '16px' }}
                    />
                    Permitir dobradinhas (2+ aulas seguidas da mesma disciplina)
                  </label>
                </div>
                {config.doublePeriods.enabled && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <label style={{ fontSize: '0.85rem' }}>Máximo de aulas consecutivas:</label>
                      <select
                        value={config.doublePeriods.maxConsecutive}
                        onChange={e => updateConfig('doublePeriods.maxConsecutive', parseInt(e.target.value))}
                        style={{ padding: '0.4rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' }}
                      >
                        <option value={1}>1 (sem dobradinhas)</option>
                        <option value={2}>2 (dobradinha padrão)</option>
                        <option value={3}>3 (tripla)</option>
                      </select>
                    </div>
                    <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={config.doublePeriods.flexible}
                        onChange={e => updateConfig('doublePeriods.flexible', e.target.checked)}
                        style={{ width: '16px', height: '16px' }}
                      />
                      Flexível (tentar dobradinha, mas aceitar separado se não for possível)
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Seção: Balanceamento e Prioridades */}
          <div style={{ marginBottom: '1rem' }}>
            <button
              onClick={() => toggleAccordion('advanced')}
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.75rem 1rem',
                backgroundColor: expandedSections.has('advanced') ? 'var(--primary-color)' : 'var(--bg-primary)',
                color: expandedSections.has('advanced') ? 'white' : 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
              }}
            >
              <span>⚖️ Balanceamento e Prioridades</span>
              <span>{expandedSections.has('advanced') ? '▼' : '▶'}</span>
            </button>
            {expandedSections.has('advanced') && (
              <div style={{ padding: '1rem', border: '1px solid var(--border-color)', borderTop: 'none', borderRadius: '0 0 var(--radius-md) var(--radius-md)', backgroundColor: 'white' }}>
                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>Preferência de distribuição:</label>
                  <select
                    value={config.advanced.preference}
                    onChange={e => updateConfig('advanced.preference', e.target.value)}
                    style={{ padding: '0.4rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', width: '100%' }}
                  >
                    <option value="BALANCED">Balanceada (distribuir igualmente)</option>
                    <option value="MORNING">Priorizar manhã</option>
                    <option value="AFTERNOON">Priorizar tarde</option>
                  </select>
                </div>
                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                    Peso para gaps na turma: {config.advanced.gapWeights.classWeight}
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    value={config.advanced.gapWeights.classWeight}
                    onChange={e => updateConfig('advanced.gapWeights.classWeight', parseInt(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </div>
                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                    Peso para gaps do professor: {config.advanced.gapWeights.teacherWeight}
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    value={config.advanced.gapWeights.teacherWeight}
                    onChange={e => updateConfig('advanced.gapWeights.teacherWeight', parseInt(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>Tentativas máximas:</label>
                  <select
                    value={config.advanced.maxAttempts}
                    onChange={e => updateConfig('advanced.maxAttempts', parseInt(e.target.value))}
                    style={{ padding: '0.4rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', width: '100%' }}
                  >
                    <option value={10}>10 (rápido)</option>
                    <option value={25}>25 (moderado)</option>
                    <option value={50}>50 (padrão)</option>
                    <option value={100}>100 (exaustivo)</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Seção: Disciplinas de Período Fixo */}
          <div style={{ marginBottom: '1rem' }}>
            <button
              onClick={() => toggleAccordion('fixedSubjects')}
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.75rem 1rem',
                backgroundColor: expandedSections.has('fixedSubjects') ? 'var(--primary-color)' : 'var(--bg-primary)',
                color: expandedSections.has('fixedSubjects') ? 'white' : 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
              }}
            >
              <span>📌 Disciplinas de Período Fixo (ex: Bilingue)</span>
              <span>{expandedSections.has('fixedSubjects') ? '▼' : '▶'}</span>
            </button>
            {expandedSections.has('fixedSubjects') && (
              <div style={{ padding: '1rem', border: '1px solid var(--border-color)', borderTop: 'none', borderRadius: '0 0 var(--radius-md) var(--radius-md)', backgroundColor: 'white' }}>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                  Disciplinas que ocorrem no <strong>mesmo período</strong> todos os dias da semana para cada turma. O sistema calcula automaticamente qual período cada turma recebe.
                </p>

                {fixedSubjectConfigs.length > 0 && (
                  <div style={{ marginBottom: '0.75rem' }}>
                    {fixedSubjectConfigs.map((fsc: any) => (
                      <div key={fsc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', marginBottom: '0.5rem', backgroundColor: 'var(--bg-primary)' }}>
                        <div>
                          <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{fsc.Subject?.name || '???'}</span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>
                            ({fsc.FixedSubjectClass?.length || 0} turmas, {fsc.classesPerWeek}x/semana)
                          </span>
                          {(fsc.FixedSubjectClass?.length || 0) > 0 && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                              {fsc.FixedSubjectClass?.map((c: any) => {
                                const cls = classes.find(cl => cl.id === c.classId);
                                return `${cls?.name || '?'}${c.assignedPeriod ? ` → Per. ${c.assignedPeriod}` : ''}`;
                              }).join(', ')}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '0.25rem' }}>
                          <button onClick={() => handleOpenFixedSubjectModal(fsc)} style={{ padding: '2px 8px', fontSize: '0.7rem', background: 'var(--primary-color)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}>Editar</button>
                          <button onClick={() => handleDeleteFixedSubject(fsc.id)} style={{ padding: '2px 8px', fontSize: '0.7rem', background: 'var(--danger-color)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}>Excluir</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <button className="btn btn-secondary" onClick={() => handleOpenFixedSubjectModal()} style={{ fontSize: '0.8rem' }}>
                  + Adicionar Disciplina de Período Fixo
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Score da Última Geração */}
        {lastScore && (
          <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-md)', marginBottom: '1rem', border: '1px solid var(--border-color)' }}>
            <h4 style={{ fontSize: '0.8rem', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Score da Última Geração</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem', fontSize: '0.75rem' }}>
              <span>Alocação: {(lastScore.allocation * 100).toFixed(0)}%</span>
              <span>Balanceamento: {(lastScore.teacherBalance * 100).toFixed(0)}%</span>
              <span>Gaps: {(lastScore.gapMinimization * 100).toFixed(0)}%</span>
              <span>Preferência: {(lastScore.preferenceRespect * 100).toFixed(0)}%</span>
              <span>Agrupamento: {(lastScore.subjectGrouping * 100).toFixed(0)}%</span>
              <span style={{ fontWeight: 700 }}>Total: {(lastScore.total * 100).toFixed(0)}%</span>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
          <button className="btn btn-secondary" onClick={() => setShowConfigModal(false)}>
            Cancelar
          </button>
          {mode === 'SCRATCH' ? (
            <button className="btn btn-primary" style={{ backgroundColor: 'var(--danger-color)' }} onClick={handleGenerateWithConfig} disabled={isGenerating}>
              {isGenerating ? '⏳ Gerando...' : '⚠️ Gerar do Zero'}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleGenerateWithConfig} disabled={isGenerating}>
              {isGenerating ? '⏳ Recalculando...' : '✨ Recalcular Conflitos'}
            </button>
          )}
        </div>
      </Modal>

      {/* ── Modal de Recálculo Inteligente ─────────────────────────── */}
      <Modal
        isOpen={showRecalcModal}
        onClose={() => !isApplying && setShowRecalcModal(false)}
        title="✨ Recálculo Inteligente de Conflitos"
        size="xl"
      >
        {recalcStep === 'changes' && (
          <div>
            {/* Conflitos Detectados */}
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h4 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                  🔍 Conflitos Detectados na Grade
                </h4>
                {detectedConflicts.some(c => c.autoFixable) && (
                  <button 
                    className="btn btn-primary" 
                    onClick={handleAutoFixAll}
                    disabled={isAutoFixing}
                    style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
                  >
                    {isAutoFixing ? '⏳ Corrigindo...' : '🔧 Corrigir Todos'}
                  </button>
                )}
              </div>
              {isLoadingConflicts ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Analisando grade...</p>
              ) : detectedConflicts.length === 0 ? (
                <div style={{ padding: '1rem', backgroundColor: '#f0fdf4', borderRadius: 'var(--radius-md)', border: '1px solid #bbf7d0' }}>
                  <p style={{ color: '#166534', fontSize: '0.85rem', fontWeight: 500 }}>✅ Nenhum conflito detectado na grade atual.</p>
                </div>
              ) : (
                <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
                  {detectedConflicts.map((conflict) => (
                    <div key={conflict.id} style={{
                      padding: '0.75rem',
                      borderBottom: '1px solid var(--border-color)',
                      backgroundColor: conflict.severity === 'high' ? '#fef2f2' : conflict.severity === 'medium' ? '#fffbeb' : 'white',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                            <span style={{
                              fontSize: '0.65rem',
                              fontWeight: 600,
                              padding: '2px 6px',
                              borderRadius: 'var(--radius-sm)',
                              backgroundColor: conflict.severity === 'high' ? '#fecaca' : conflict.severity === 'medium' ? '#fde68a' : '#e2e8f0',
                              color: conflict.severity === 'high' ? '#991b1b' : conflict.severity === 'medium' ? '#92400e' : '#475569',
                            }}>
                              {conflict.type.replace(/_/g, ' ')}
                            </span>
                            <span style={{ fontSize: '0.8rem' }}>{conflict.description}</span>
                          </div>
                          {conflict.suggestedFix && (
                            <div style={{ fontSize: '0.75rem', color: '#1e40af', marginTop: '0.25rem', fontStyle: 'italic' }}>
                              💡 {conflict.suggestedFix.description}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', marginLeft: '1rem' }}>
                          {conflict.autoFixable && (
                            <button
                              className="btn btn-primary"
                              onClick={() => handleAutoFixConflict(conflict)}
                              disabled={isAutoFixing}
                              style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}
                            >
                              🔧 Corrigir
                            </button>
                          )}
                          <button
                            className="btn btn-secondary"
                            onClick={() => setSelectedConflict(selectedConflict?.id === conflict.id ? null : conflict)}
                            style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}
                          >
                            {selectedConflict?.id === conflict.id ? '▲ Ocultar' : '▼ Detalhes'}
                          </button>
                        </div>
                      </div>
                      
                      {/* Conflict Details Panel */}
                      {selectedConflict?.id === conflict.id && (
                        <div style={{ 
                          marginTop: '0.75rem', 
                          padding: '0.75rem', 
                          backgroundColor: '#f8fafc', 
                          borderRadius: 'var(--radius-md)',
                          border: '1px solid #e2e8f0'
                        }}>
                          <h5 style={{ fontSize: '0.8rem', marginBottom: '0.5rem', color: '#334155' }}>
                            🤖 Assistente de Correção
                          </h5>
                          <div style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.5 }}>
                            <p style={{ marginBottom: '0.5rem' }}>
                              <strong>Problema:</strong> {conflict.description}
                            </p>
                            {conflict.suggestedFix && (
                              <p style={{ marginBottom: '0.5rem' }}>
                                <strong>Solução sugerida:</strong> {conflict.suggestedFix.description}
                              </p>
                            )}
                            <p style={{ marginBottom: '0.5rem' }}>
                              <strong>Tipo:</strong> {conflict.type.replace(/_/g, ' ')}
                            </p>
                            <p>
                              <strong>Severidade:</strong> {conflict.severity === 'high' ? 'Alta' : conflict.severity === 'medium' ? 'Média' : 'Baixa'}
                            </p>
                          </div>
                          {!conflict.autoFixable && (
                            <div style={{ 
                              marginTop: '0.5rem', 
                              padding: '0.5rem', 
                              backgroundColor: '#fef3c7', 
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid #fcd34d'
                            }}>
                              <p style={{ fontSize: '0.75rem', color: '#92400e' }}>
                                ⚠️ Este conflito requer intervenção manual. Use o formulário abaixo para definir a correção.
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              
              {/* Auto-fix Results Summary */}
              {autoFixResults.length > 0 && (
                <div style={{ 
                  marginTop: '1rem', 
                  padding: '0.75rem', 
                  backgroundColor: '#f0fdf4', 
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid #bbf7d0'
                }}>
                  <h5 style={{ fontSize: '0.8rem', marginBottom: '0.5rem', color: '#166534' }}>
                    📊 Resultados da Correção Automática
                  </h5>
                  <div style={{ fontSize: '0.75rem', color: '#166534' }}>
                    <p>
                      <strong>{autoFixResults.filter(r => r.success).length}</strong> conflito(s) corrigido(s) com sucesso
                    </p>
                    {autoFixResults.filter(r => !r.success).length > 0 && (
                      <p style={{ color: '#991b1b' }}>
                        <strong>{autoFixResults.filter(r => !r.success).length}</strong> conflito(s) não puderam ser corrigidos
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Mudas a Aplicar */}
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h4 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>📝 Mudanças a Aplicar</h4>
                <button className="btn btn-secondary" onClick={addRecalcChange} style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}>
                  + Adicionar Mudança
                </button>
              </div>
              {recalcChanges.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontStyle: 'italic' }}>
                  Nenhuma mudança definida. Clique em "Adicionar Mudança" para substituir um professor.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {recalcChanges.map((change, index) => (
                    <div key={index} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-primary)' }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>Professor Atual (sai)</label>
                        <select
                          className="input"
                          value={change.oldTeacherId}
                          onChange={e => updateRecalcChange(index, 'oldTeacherId', e.target.value)}
                          style={{ fontSize: '0.8rem', padding: '0.4rem' }}
                        >
                          <option value="">Selecione...</option>
                          {teachers.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </div>
                      <span style={{ fontSize: '1.2rem', marginTop: '1rem' }}>→</span>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>Novo Professor (entra)</label>
                        <select
                          className="input"
                          value={change.newTeacherId}
                          onChange={e => updateRecalcChange(index, 'newTeacherId', e.target.value)}
                          style={{ fontSize: '0.8rem', padding: '0.4rem' }}
                        >
                          <option value="">Selecione...</option>
                          {teachers.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </div>
                      <button
                        onClick={() => removeRecalcChange(index)}
                        style={{ marginTop: '1rem', padding: '0.4rem 0.6rem', fontSize: '0.75rem', background: 'var(--danger-color)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
              <button className="btn btn-secondary" onClick={() => setShowRecalcModal(false)}>Cancelar</button>
              <button
                className="btn btn-primary"
                onClick={handlePreviewRecalc}
                disabled={isPreviewing || recalcChanges.filter(c => c.oldTeacherId && c.newTeacherId).length === 0}
              >
                {isPreviewing ? '⏳ Analisando...' : '👁️ Visualizar Mudanças'}
              </button>
            </div>
          </div>
        )}

        {recalcStep === 'preview' && recalcProposal && (
          <div>
            {/* Resumo */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1.5rem' }}>
              {[
                { label: 'Mantidas', value: recalcProposal.summary.slotsKept, color: '#dcfce7', textColor: '#166534' },
                { label: 'Alteradas', value: recalcProposal.summary.slotsChanged, color: '#fef9c3', textColor: '#854d0e' },
                { label: 'Removidas', value: recalcProposal.summary.slotsRemoved, color: '#fecaca', textColor: '#991b1b' },
                { label: 'Adicionadas', value: recalcProposal.summary.slotsAdded, color: '#dbeafe', textColor: '#1e40af' },
              ].map((stat) => (
                <div key={stat.label} style={{ padding: '0.75rem', backgroundColor: stat.color, borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: stat.textColor }}>{stat.value}</div>
                  <div style={{ fontSize: '0.75rem', color: stat.textColor }}>{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Legenda */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              {[
                { color: '#dcfce7', border: '#86efac', label: 'Mantida' },
                { color: '#fef9c3', border: '#fde047', label: 'Alterada' },
                { color: '#fecaca', border: '#fca5a5', label: 'Removida' },
                { color: '#dbeafe', border: '#93c5fd', label: 'Adicionada' },
              ].map((item) => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <div style={{ width: '14px', height: '14px', backgroundColor: item.color, border: `2px solid ${item.border}`, borderRadius: '3px' }} />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{item.label}</span>
                </div>
              ))}
            </div>

            {/* Grid de Diffs por Turma */}
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {Array.from(new Set(recalcProposal.diffs.map(d => d.className))).map(className => {
                const classDiffs = recalcProposal.diffs.filter(d => d.className === className);
                return (
                  <div key={className} style={{ marginBottom: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                    <div style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-primary)', fontWeight: 600, fontSize: '0.85rem' }}>
                      Turma: {className}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'auto repeat(5, 1fr)', gap: '1px', backgroundColor: 'var(--border-color)', fontSize: '0.75rem' }}>
                      <div style={{ padding: '0.4rem 0.6rem', backgroundColor: 'var(--bg-primary)', fontWeight: 600 }}>Aula</div>
                      {['Seg', 'Ter', 'Qua', 'Qui', 'Sex'].map(d => (
                        <div key={d} style={{ padding: '0.4rem 0.6rem', backgroundColor: 'var(--bg-primary)', fontWeight: 600, textAlign: 'center' }}>{d}</div>
                      ))}
                      {Array.from({ length: 6 }).map((_, periodIdx) => {
                        const displayPeriod = periodIdx + 1;
                        return (
                          <React.Fragment key={displayPeriod}>
                            <div style={{ padding: '0.4rem 0.6rem', backgroundColor: 'var(--bg-primary)', fontWeight: 500 }}>{displayPeriod}ª</div>
                            {[1, 2, 3, 4, 5].map(day => {
                              const diff = classDiffs.find(d => d.dayOfWeek === day && d.period === displayPeriod);
                              const bgColor = !diff ? 'white' :
                                diff.status === 'kept' ? '#dcfce7' :
                                diff.status === 'changed' ? '#fef9c3' :
                                diff.status === 'removed' ? '#fecaca' :
                                '#dbeafe';
                              const borderColor = !diff ? 'var(--border-color)' :
                                diff.status === 'kept' ? '#86efac' :
                                diff.status === 'changed' ? '#fde047' :
                                diff.status === 'removed' ? '#fca5a5' :
                                '#93c5fd';
                              return (
                                <div key={day} style={{ padding: '0.3rem', backgroundColor: bgColor, border: `1px solid ${borderColor}`, textAlign: 'center', fontSize: '0.65rem' }}>
                                  {diff ? (
                                    <div>
                                      <div style={{ fontWeight: 600 }}>{diff.status === 'removed' ? diff.oldSubject : (diff.newSubject || diff.oldSubject)}</div>
                                      {diff.newTeacher && diff.status === 'changed' && (
                                        <div style={{ color: '#1e40af' }}>{diff.newTeacher}</div>
                                      )}
                                      {diff.status === 'removed' && (
                                        <div style={{ textDecoration: 'line-through', opacity: 0.6 }}>{diff.oldTeacher}</div>
                                      )}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
              <button className="btn btn-secondary" onClick={() => setRecalcStep('changes')}>← Voltar</button>
              <button className="btn btn-secondary" onClick={() => setShowRecalcModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleConfirmRecalc} disabled={isApplying}>
                {isApplying ? '⏳ Aplicando...' : '✅ Aceitar e Consolidar'}
              </button>
            </div>
          </div>
        )}

        {recalcStep === 'result' && recalcResult && (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>{recalcResult.success ? '✅' : '❌'}</div>
            <h3 style={{ marginBottom: '0.5rem' }}>{recalcResult.success ? 'Recálculo Aplicado com Sucesso!' : 'Erro ao Aplicar Recálculo'}</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
              {recalcResult.success
                ? `${recalcResult.applied} aula(s) foram atualizada(s) na grade.`
                : 'Ocorreu um erro ao aplicar as mudanças.'}
            </p>
            <button className="btn btn-primary" onClick={() => setShowRecalcModal(false)}>Fechar</button>
          </div>
        )}
      </Modal>

      {/* ── Modal de Disciplina de Período Fixo ─────────────────────── */}
      <Modal
        isOpen={showFixedSubjectModal}
        onClose={() => setShowFixedSubjectModal(false)}
        title={editingFixedSubject ? 'Editar Disciplina de Período Fixo' : 'Nova Disciplina de Período Fixo'}
      >
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
            Disciplina *
          </label>
          <select
            className="input"
            value={fixedSubjectForm.subjectId}
            onChange={e => setFixedSubjectForm(prev => ({ ...prev, subjectId: e.target.value }))}
            disabled={!!editingFixedSubject}
          >
            <option value="">Selecione uma disciplina...</option>
            {subjects.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {editingFixedSubject && (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              A disciplina não pode ser alterada após a criação.
            </p>
          )}
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
            Aulas por semana *
          </label>
          <select
            className="input"
            value={fixedSubjectForm.classesPerWeek}
            onChange={e => setFixedSubjectForm(prev => ({ ...prev, classesPerWeek: parseInt(e.target.value) }))}
          >
            <option value={1}>1 (1 dia por semana)</option>
            <option value={2}>2 (2 dias por semana)</option>
            <option value={3}>3 (3 dias por semana)</option>
            <option value={4}>4 (4 dias por semana)</option>
            <option value={5}>5 (Segunda a Sexta)</option>
          </select>
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
            Turmas participantes *
          </label>
          <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.5rem' }}>
            {classes.map(c => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0', cursor: 'pointer', fontSize: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={fixedSubjectForm.classIds.includes(c.id)}
                  onChange={e => {
                    setFixedSubjectForm(prev => ({
                      ...prev,
                      classIds: e.target.checked
                        ? [...prev.classIds, c.id]
                        : prev.classIds.filter(id => id !== c.id),
                    }));
                  }}
                  style={{ width: '16px', height: '16px' }}
                />
                {c.name} ({c.shift === 'MORNING' ? 'Manhã' : 'Tarde'})
              </label>
            ))}
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            {fixedSubjectForm.classIds.length} turma(s) selecionada(s)
          </p>
        </div>

        <div style={{ padding: '0.75rem', backgroundColor: '#eff6ff', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', border: '1px solid #bfdbfe' }}>
          <p style={{ fontSize: '0.8rem', color: '#1e40af' }}>
            <strong>Como funciona:</strong> O sistema atribuirá automaticamente o mesmo período para esta disciplina em todos os dias da semana para cada turma selecionada. Ex: Se a turma 1ºano A receber período 1, terá aula de Bilingue sempre na 1ª aula de Seg a Sex.
          </p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          <button className="btn btn-secondary" onClick={() => setShowFixedSubjectModal(false)}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSaveFixedSubject}>
            {editingFixedSubject ? 'Salvar Alterações' : 'Criar Configuração'}
          </button>
        </div>
      </Modal>
    </>
  );
}
