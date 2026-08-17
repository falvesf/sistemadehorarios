'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

import { runGenerator } from './engine';
import { ScheduleConfig, DEFAULT_CONFIG } from './types';
import { detectConflicts, Conflict } from './conflict-detector';
import { runRecalculation, applyRecalculation, autoFixAllConflicts as autoFixAllConflictsFromRecalculator, applyAutoFix, RecalculationChange, RecalculationProposal } from './recalculator';
import * as XLSX from 'xlsx';

export async function fetchCurrentSchedule() {
  const schedules = await prisma.schedule.findMany({
    include: {
      Class: true,
      Subject: true,
      Teacher: true,
    },
    orderBy: [
      { Class: { level: 'asc' } },
      { Class: { name: 'asc' } },
      { dayOfWeek: 'asc' },
      { period: 'asc' }
    ]
  });
  return schedules;
}

export async function fetchSubjects() {
  return await prisma.subject.findMany({ orderBy: { name: 'asc' } });
}

export async function fetchClasses() {
  return await prisma.class.findMany({ orderBy: { name: 'asc' } });
}

export async function generateSchedule(mode: 'REPAIR' | 'SCRATCH') {
  try {
    const res = await runGenerator(mode, DEFAULT_CONFIG);
    revalidatePath('/gerador');
    
    if (res.error) {
      return { success: false, error: res.error };
    }
    
    if (res.success) {
      return { success: true, message: `Grade gerada com sucesso! ${res.assigned} aulas alocadas.` };
    } else {
      let msg = res.timeout ? 'O limite de calculo foi atingido. A grade foi gerada parcialmente.' : 'Impossivel fechar a grade com as regras atuais.';
      return { success: true, message: `${msg} (${res.assigned} de ${res.total} alocadas).` };
    }
  } catch (e: any) {
    console.error(e);
    return { success: false, error: e.message };
  }
}

export async function generateWithConfig(mode: 'REPAIR' | 'SCRATCH', config: ScheduleConfig) {
  try {
    const res = await runGenerator(mode, config);
    revalidatePath('/gerador');
    
    if (res.error) {
      return { success: false, error: res.error };
    }

    const scoreInfo = res.score ? ` Score: ${(res.score.total * 100).toFixed(0)}%` : '';
    
    if (res.success) {
      return { success: true, message: `Grade gerada com sucesso! ${res.assigned} aulas alocadas.${scoreInfo}`, score: res.score };
    } else {
      let msg = res.timeout ? 'O limite de calculo foi atingido. A grade foi gerada parcialmente.' : 'Impossivel fechar a grade com as regras atuais.';
      return { success: true, message: `${msg} (${res.assigned} de ${res.total} alocadas).${scoreInfo}`, score: res.score };
    }
  } catch (e: any) {
    console.error(e);
    return { success: false, error: e.message };
  }
}

export async function updateSlotTeacher(scheduleId: string, newTeacherId: string | null) {
  try {
    const schedule = await prisma.schedule.findUnique({ where: { id: scheduleId } });
    if (!schedule) throw new Error('Horário não encontrado');

    await prisma.schedule.updateMany({
      where: { classId: schedule.classId, subjectId: schedule.subjectId },
      data: { teacherId: newTeacherId }
    });

    await prisma.curriculum.updateMany({
      where: { classId: schedule.classId, subjectId: schedule.subjectId },
      data: { teacherId: newTeacherId }
    });

    revalidatePath('/gerador');
    revalidatePath('/turmas');
    return { success: true };
  } catch (e: any) {
    console.error(e);
    return { success: false, error: e.message };
  }
}

export async function createSlot(data: { classId: string; subjectId: string; teacherId: string | null; dayOfWeek: number; period: number }) {
  try {
    const existing = await prisma.schedule.findFirst({
      where: { classId: data.classId, dayOfWeek: data.dayOfWeek, period: data.period }
    });
    if (existing) {
      return { success: false, error: 'Ja existe uma aula nesse horario.' };
    }

    await prisma.schedule.create({
      data: {
        classId: data.classId,
        subjectId: data.subjectId,
        teacherId: data.teacherId,
        dayOfWeek: data.dayOfWeek,
        period: data.period,
        isFixed: false,
      }
    });

    revalidatePath('/gerador');
    revalidatePath('/turmas');
    return { success: true };
  } catch (e: any) {
    console.error(e);
    return { success: false, error: e.message };
  }
}

export async function deleteSlot(scheduleId: string) {
  try {
    const schedule = await prisma.schedule.findUnique({ where: { id: scheduleId } });
    if (!schedule) throw new Error('Horario nao encontrado');
    if (schedule.isFixed) throw new Error('Nao e possivel remover aulas fixas (Capela).');

    await prisma.schedule.delete({ where: { id: scheduleId } });
    revalidatePath('/gerador');
    revalidatePath('/turmas');
    return { success: true };
  } catch (e: any) {
    console.error(e);
    return { success: false, error: e.message };
  }
}

export async function exportSchedule(): Promise<Blob> {
  const schedules = await prisma.schedule.findMany({
    include: { Class: true, Subject: true, Teacher: true },
    orderBy: [{ Class: { name: 'asc' } }, { dayOfWeek: 'asc' }, { period: 'asc' }]
  });

  const curriculums = await prisma.curriculum.findMany({
    include: { Class: true, Subject: true, Teacher: true }
  });

  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    schedules: schedules.map(s => ({
      className: s.Class.name,
      subjectName: s.Subject.name,
      teacherName: s.Teacher?.name || null,
      dayOfWeek: s.dayOfWeek,
      period: s.period,
      isFixed: s.isFixed,
    })),
    curriculums: curriculums.map(c => ({
      className: c.Class.name,
      subjectName: c.Subject.name,
      teacherName: c.Teacher?.name || null,
      classesPerWeek: c.classesPerWeek,
    })),
  };

  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}

export async function importSchedule(jsonText: string) {
  try {
    const data = JSON.parse(jsonText);
    if (!data.schedules || !Array.isArray(data.schedules)) {
      return { success: false, error: 'Formato de arquivo invalido.' };
    }

    await prisma.schedule.deleteMany({ where: { isFixed: false } });

    let imported = 0;
    for (const item of data.schedules) {
      if (item.isFixed) continue;

      const classRecord = await prisma.class.findFirst({ where: { name: item.className } });
      const subjectRecord = await prisma.subject.findFirst({ where: { name: item.subjectName } });
      if (!classRecord || !subjectRecord) continue;

      let teacherId = null;
      if (item.teacherName) {
        const teacherRecord = await prisma.teacher.findFirst({ where: { name: item.teacherName } });
        teacherId = teacherRecord?.id || null;
      }

      await prisma.schedule.create({
        data: {
          classId: classRecord.id,
          subjectId: subjectRecord.id,
          teacherId,
          dayOfWeek: item.dayOfWeek,
          period: item.period,
          isFixed: false,
        }
      });
      imported++;
    }

    if (data.curriculums && Array.isArray(data.curriculums)) {
      for (const item of data.curriculums) {
        const classRecord = await prisma.class.findFirst({ where: { name: item.className } });
        const subjectRecord = await prisma.subject.findFirst({ where: { name: item.subjectName } });
        if (!classRecord || !subjectRecord) continue;

        let teacherId = null;
        if (item.teacherName) {
          const teacherRecord = await prisma.teacher.findFirst({ where: { name: item.teacherName } });
          teacherId = teacherRecord?.id || null;
        }

        await prisma.curriculum.upsert({
          where: { classId_subjectId: { classId: classRecord.id, subjectId: subjectRecord.id } },
          update: { teacherId, classesPerWeek: item.classesPerWeek },
          create: { classId: classRecord.id, subjectId: subjectRecord.id, teacherId, classesPerWeek: item.classesPerWeek },
        });
      }
    }

    revalidatePath('/gerador');
    revalidatePath('/turmas');
    return { success: true, imported };
  } catch (e: any) {
    console.error(e);
    return { success: false, error: e.message };
  }
}

export async function backupAll(): Promise<Blob> {
  const teachers = await prisma.teacher.findMany({ orderBy: { name: 'asc' } });
  const subjects = await prisma.subject.findMany({ orderBy: { name: 'asc' } });
  const classes = await prisma.class.findMany({ orderBy: { name: 'asc' } });
  const curriculums = await prisma.curriculum.findMany();
  const schedules = await prisma.schedule.findMany();
  const availability = await prisma.availability.findMany();
  const subjectAliases = await prisma.subjectAlias.findMany();
  const fixedSubjectConfigs = await prisma.fixedSubjectConfig.findMany({ include: { FixedSubjectClass: true } });
  const timeSlots = await prisma.timeSlot.findMany();

  const data = {
    version: 2,
    type: 'full-backup',
    exportedAt: new Date().toISOString(),
    teachers: teachers.map(t => ({ name: t.name, type: t.type })),
    subjects: subjects.map(s => ({ name: s.name })),
    classes: classes.map(c => ({ name: c.name, level: c.level, shift: c.shift })),
    curriculums: curriculums.map(c => {
      const cls = classes.find(cl => cl.id === c.classId);
      const sub = subjects.find(s => s.id === c.subjectId);
      const teacher = teachers.find(t => t.id === c.teacherId);
      return {
        className: cls?.name || '',
        subjectName: sub?.name || '',
        teacherName: teacher?.name || null,
        classesPerWeek: c.classesPerWeek,
      };
    }),
    schedules: schedules.map(s => {
      const cls = classes.find(c => c.id === s.classId);
      const sub = subjects.find(su => su.id === s.subjectId);
      const teacher = teachers.find(t => t.id === s.teacherId);
      return {
        className: cls?.name || '',
        subjectName: sub?.name || '',
        teacherName: teacher?.name || null,
        dayOfWeek: s.dayOfWeek,
        period: s.period,
        isFixed: s.isFixed,
      };
    }),
    availability: availability.map(a => {
      const teacher = teachers.find(t => t.id === a.teacherId);
      return {
        teacherName: teacher?.name || '',
        dayOfWeek: a.dayOfWeek,
        shift: a.shift,
        period: a.period,
        isAvailable: a.isAvailable,
      };
    }),
    subjectAliases: subjectAliases.map(a => ({
      sourceName: a.sourceName,
      targetName: a.targetName,
    })),
    fixedSubjectConfigs: fixedSubjectConfigs.map(fsc => {
      const sub = subjects.find(s => s.id === fsc.subjectId);
      return {
        subjectName: sub?.name || '',
        classesPerWeek: fsc.classesPerWeek,
        classNames: fsc.FixedSubjectClass.map((fc: any) => {
          const cls = classes.find(c => c.id === fc.classId);
          return cls?.name || '';
        }),
      };
    }),
    timeSlots: timeSlots.map(ts => ({
      level: ts.level,
      shift: ts.shift,
      dayOfWeek: ts.dayOfWeek,
      period: ts.period,
      startTime: ts.startTime,
      endTime: ts.endTime,
    })),
  };

  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}

export async function restoreAll(jsonText: string) {
  try {
    const data = JSON.parse(jsonText);
    if (!data.version) {
      return { success: false, error: 'Formato de arquivo invalido.' };
    }

    // Clear all existing data
    await prisma.schedule.deleteMany({});
    await prisma.curriculum.deleteMany({});
    await prisma.availability.deleteMany({});
    await prisma.subjectAlias.deleteMany({});
    await prisma.fixedSubjectClass.deleteMany({});
    await prisma.fixedSubjectConfig.deleteMany({});
    await prisma.teacher.deleteMany({});
    await prisma.subject.deleteMany({});
    await prisma.class.deleteMany({});
    await prisma.timeSlot.deleteMany({});

    // Restore teachers
    for (const t of data.teachers || []) {
      await prisma.teacher.create({ data: { name: t.name, type: t.type || 'AULISTA' } });
    }

    // Restore subjects
    for (const s of data.subjects || []) {
      await prisma.subject.create({ data: { name: s.name } });
    }

    // Restore classes
    for (const c of data.classes || []) {
      await prisma.class.create({ data: { name: c.name, level: c.level, shift: c.shift } });
    }

    // Restore curriculums
    for (const c of data.curriculums || []) {
      const cls = await prisma.class.findFirst({ where: { name: c.className } });
      const sub = await prisma.subject.findFirst({ where: { name: c.subjectName } });
      if (!cls || !sub) continue;
      let teacherId = null;
      if (c.teacherName) {
        const teacher = await prisma.teacher.findFirst({ where: { name: c.teacherName } });
        teacherId = teacher?.id || null;
      }
      await prisma.curriculum.create({
        data: { classId: cls.id, subjectId: sub.id, teacherId, classesPerWeek: c.classesPerWeek || 1 },
      });
    }

    // Restore schedules
    for (const s of data.schedules || []) {
      const cls = await prisma.class.findFirst({ where: { name: s.className } });
      const sub = await prisma.subject.findFirst({ where: { name: s.subjectName } });
      if (!cls || !sub) continue;
      let teacherId = null;
      if (s.teacherName) {
        const teacher = await prisma.teacher.findFirst({ where: { name: s.teacherName } });
        teacherId = teacher?.id || null;
      }
      await prisma.schedule.create({
        data: {
          classId: cls.id,
          subjectId: sub.id,
          teacherId,
          dayOfWeek: s.dayOfWeek,
          period: s.period,
          isFixed: s.isFixed || false,
        },
      });
    }

    // Restore availability
    for (const a of data.availability || []) {
      const teacher = await prisma.teacher.findFirst({ where: { name: a.teacherName } });
      if (!teacher) continue;
      await prisma.availability.create({
        data: {
          teacherId: teacher.id,
          dayOfWeek: a.dayOfWeek,
          shift: a.shift || 'MORNING',
          period: a.period,
          isAvailable: a.isAvailable,
        },
      });
    }

    // Restore subject aliases
    for (const a of data.subjectAliases || []) {
      await prisma.subjectAlias.create({
        data: { sourceName: a.sourceName, targetName: a.targetName },
      });
    }

    // Restore time slots
    for (const ts of data.timeSlots || []) {
      await prisma.timeSlot.create({
        data: {
          level: ts.level,
          shift: ts.shift,
          dayOfWeek: ts.dayOfWeek,
          period: ts.period,
          startTime: ts.startTime,
          endTime: ts.endTime,
        },
      });
    }

    revalidatePath('/gerador');
    revalidatePath('/professores');
    revalidatePath('/disciplinas');
    revalidatePath('/turmas');
    revalidatePath('/restricoes');

    return { success: true };
  } catch (e: any) {
    console.error('Restore error:', e);
    return { success: false, error: e.message };
  }
}

export async function restoreDefaultSchedule(templateId?: string, teacherNameMap?: Record<string, string>) {
  try {
    // If templateId is provided, use that template
    if (templateId) {
      const template = await prisma.scheduleTemplate.findUnique({
        where: { id: templateId },
        include: { ScheduleTemplateEntry: true },
      });

      if (!template) {
        return { success: false, error: 'Modelo não encontrado.' };
      }

      // Load subject aliases (e.g., "Cultura Geral" -> "Capela")
      const aliases = await prisma.subjectAlias.findMany();
      const aliasMap = new Map<string, string>();
      for (const a of aliases) {
        aliasMap.set(a.sourceName.toLowerCase(), a.targetName);
      }

      // Clear ALL current schedules (including fixed) before restoring from template
      await prisma.schedule.deleteMany({});

      // Get or create subjects, teachers, classes from template entries
      const teachersMap = new Map<string, string>();
      const subjectsMap = new Map<string, string>();
      const classesMap = new Map<string, string>();

      let created = 0;
      for (const entry of template.ScheduleTemplateEntry) {
        // Apply subject alias: resolve the actual subject name
        const aliasTarget = aliasMap.get(entry.subjectName.toLowerCase());
        const resolvedSubjectName = aliasTarget || entry.subjectName;
        const isFixed = entry.isFixed || !!aliasTarget; // aliased subjects become fixed

        // Get or create subject using resolved name
        if (!subjectsMap.has(resolvedSubjectName)) {
          let subject = await prisma.subject.findFirst({ where: { name: resolvedSubjectName } });
          if (!subject) {
            subject = await prisma.subject.create({ data: { name: resolvedSubjectName } });
          }
          subjectsMap.set(resolvedSubjectName, subject.id);
        }
        const subjectId = subjectsMap.get(resolvedSubjectName)!;

        // Get or create class
        if (!classesMap.has(entry.className)) {
          let cls = await prisma.class.findFirst({ where: { name: entry.className } });
          if (!cls) {
            const shift = inferShift(entry.className);
            const level = inferLevel(entry.className);
            cls = await prisma.class.create({ data: { name: entry.className, shift, level } });
          }
          classesMap.set(entry.className, cls.id);
        }
        const classId = classesMap.get(entry.className)!;

        // Get or create teacher
        let teacherId = null;
        if (entry.teacherName) {
          const resolvedName = teacherNameMap?.[entry.teacherName] || entry.teacherName;
          if (!teachersMap.has(resolvedName)) {
            let teacher = await prisma.teacher.findFirst({ where: { name: resolvedName } });
            if (!teacher) {
              teacher = await prisma.teacher.create({ data: { name: resolvedName, type: 'AULISTA' } });
            }
            teachersMap.set(resolvedName, teacher.id);
          }
          teacherId = teachersMap.get(resolvedName)!;
        }

        // Create schedule entry
        const classObj = await prisma.class.findUnique({ where: { id: classId } });

        await prisma.schedule.create({
          data: {
            classId,
            subjectId,
            teacherId,
            dayOfWeek: entry.dayOfWeek,
            period: entry.period,
            isFixed,
          }
        });
        created++;
      }

      revalidatePath('/gerador');
      revalidatePath('/turmas');
      revalidatePath('/restricoes');
      return { success: true, created, templateName: template.name };
    }

    // No templateId provided - fallback to original behavior (create empty schedules from curriculum)
    await prisma.schedule.deleteMany({ where: { isFixed: false } });

    const curriculums = await prisma.curriculum.findMany({ include: { Class: true } });

    let created = 0;
    for (const curr of curriculums) {
      for (let i = 0; i < curr.classesPerWeek; i++) {
        await prisma.schedule.create({
          data: {
            classId: curr.classId,
            subjectId: curr.subjectId,
            teacherId: curr.teacherId,
            dayOfWeek: 1,
            period: 1,
            isFixed: false,
          }
        });
        created++;
      }
    }

    revalidatePath('/gerador');
    revalidatePath('/turmas');
    return { success: true, created };
  } catch (e: any) {
    console.error(e);
    return { success: false, error: e.message };
  }
}

function inferShift(className: string): string {
  const name = className.toLowerCase();
  if (name.includes('b') && (name.includes('4') || name.includes('5') || name.includes('6'))) return 'AFTERNOON';
  if (name.includes('tarde')) return 'AFTERNOON';
  return 'MORNING';
}

function inferLevel(className: string): string {
  const name = className.toLowerCase();
  if (name.includes('maternal') || name.includes('jardim') || name.includes('pré')) return 'INFANTIL';
  if (name.includes('1º') || name.includes('2º') || name.includes('3º') || name.includes('4º') || name.includes('5º')) return 'FUND1';
  if (name.includes('6º') || name.includes('7º') || name.includes('8º') || name.includes('9º')) return 'FUND2';
  return 'FUND1';
}

export async function hasTemplates(): Promise<boolean> {
  const count = await prisma.scheduleTemplate.count();
  return count > 0;
}

export async function getTemplates() {
  return await prisma.scheduleTemplate.findMany({
    include: { _count: { select: { ScheduleTemplateEntry: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function importTemplateFromExcel(base64Data: string, fileName: string) {
  try {
    const buffer = Buffer.from(base64Data, 'base64');
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    // Create template
    const template = await prisma.scheduleTemplate.create({
      data: { name: fileName.replace(/\.xlsx?$/i, '') },
    });

    let totalEntries = 0;

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

      if (data.length < 6) continue;

      // The class name is the sheet name
      const className = sheetName.trim();

      // Try to extract regente from row 1 or row 2
      let regenteName: string | null = null;
      for (const rowIdx of [1, 2]) {
        const infoRow = data[rowIdx];
        if (!infoRow) continue;
        for (const col of infoRow) {
          if (col && col.toString().toLowerCase().includes('professor')) {
            const match = col.toString().match(/professor[a-z]*:\s*(.+)/i);
            if (match) regenteName = match[1].trim();
          }
        }
      }

      // Read schedule grid starting from row 6 (data rows)
      let periodIndex = 1;
      for (let i = 6; i < data.length; i++) {
        const row = data[i];
        if (!row || row.length === 0) continue;

        // Detect period column: check col 0 and col 1 for "ª"
        let periodCol = -1;
        for (let c = 0; c <= 1; c++) {
          const val = (row[c] || '').toString().trim().toUpperCase();
          if (val.includes('ª')) { periodCol = c; break; }
        }
        if (periodCol === -1) {
          const val0 = (row[0] || '').toString().trim().toUpperCase();
          if (val0.includes('INTERVALO') || val0.includes('ATUALIZADO') || val0 === 'AULA') continue;
          continue;
        }

        const subjectStartCol = periodCol + 1;

        // Days are in columns after the period column
        for (let dayIndex = 0; dayIndex < 5; dayIndex++) {
          const cellData = row[subjectStartCol + dayIndex];
          if (!cellData) continue;

          let subjectName = cellData.toString().trim();
          let teacherName = regenteName;
          let isAulista = false;

          // Parse "Subject\n(teacher name)" format
          if (subjectName.includes('\n')) {
            const parts = subjectName.split('\n');
            subjectName = parts[0].trim();
            if (parts[1]) {
              let rawTeacher = parts[1].trim();
              if (rawTeacher.startsWith('(')) rawTeacher = rawTeacher.replace(/\(/g, '').replace(/\)/g, '');
              rawTeacher = rawTeacher.replace(/profº\s*/gi, '').replace(/profª\s*/gi, '').replace(/prof\.\s*/gi, '').trim();
              teacherName = rawTeacher;
              isAulista = true;
            }
          }

          // Skip empty subjects
          if (!subjectName || subjectName === '') continue;

          const isFixed = subjectName.toLowerCase().includes('capela');

          await prisma.scheduleTemplateEntry.create({
            data: {
              templateId: template.id,
              className,
              subjectName,
              teacherName: teacherName || null,
              dayOfWeek: dayIndex + 1, // 1=Mon..5=Fri
              period: periodIndex,
              isFixed,
            }
          });
          totalEntries++;
        }
        periodIndex++;
      }
    }

    revalidatePath('/gerador');
    return { success: true, templateId: template.id, totalEntries };
  } catch (e: any) {
    console.error('Template import error:', e);
    return { success: false, error: e.message };
  }
}

export interface ParsedCurriculum {
  className: string;
  subjectName: string;
  teacherName: string | null;
  classesPerWeek: number;
  level: string;
  shift: string;
}

export interface TeacherMergeSuggestion {
  newName: string;
  existingTeacherId: string;
  existingTeacherName: string;
  confidence: number;
}

export async function analyzeExcelForImport(base64Data: string, fileName: string) {
  try {
    const buffer = Buffer.from(base64Data, 'base64');
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    const curriculums: ParsedCurriculum[] = [];
    const uniqueTeacherNames = new Set<string>();

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

      if (data.length < 6) continue;

      const className = sheetName.trim();

      let regenteName: string | null = null;
      for (const rowIdx of [1, 2]) {
        const infoRow = data[rowIdx];
        if (!infoRow) continue;
        for (const col of infoRow) {
          if (col && col.toString().toLowerCase().includes('professor')) {
            const match = col.toString().match(/professor[a-z]*:\s*(.+)/i);
            if (match) regenteName = match[1].trim();
          }
        }
      }

      const subjectCounts = new Map<string, Map<string, number>>();

      for (let i = 6; i < data.length; i++) {
        const row = data[i];
        if (!row || row.length === 0) continue;

        // Detect period column: check col 0 and col 1 for "ª"
        let periodCol = -1;
        for (let c = 0; c <= 1; c++) {
          const val = (row[c] || '').toString().trim().toUpperCase();
          if (val.includes('ª')) { periodCol = c; break; }
        }
        if (periodCol === -1) {
          const val0 = (row[0] || '').toString().trim().toUpperCase();
          if (val0.includes('INTERVALO') || val0.includes('ATUALIZADO') || val0 === 'AULA') continue;
          continue;
        }

        const subjectStartCol = periodCol + 1;

        for (let dayIndex = 0; dayIndex < 5; dayIndex++) {
          const cellData = row[subjectStartCol + dayIndex];
          if (!cellData) continue;

          let subjectName = cellData.toString().trim();
          let teacherName = regenteName;

          if (subjectName.includes('\n')) {
            const parts = subjectName.split('\n');
            subjectName = parts[0].trim();
            if (parts[1]) {
              let rawTeacher = parts[1].trim();
              if (rawTeacher.startsWith('(')) rawTeacher = rawTeacher.replace(/\(/g, '').replace(/\)/g, '');
              rawTeacher = rawTeacher.replace(/profº\s*/gi, '').replace(/profª\s*/gi, '').replace(/prof\.\s*/gi, '').trim();
              teacherName = rawTeacher;
            }
          }

          if (!subjectName || subjectName === '') continue;
          if (subjectName.toLowerCase().includes('capela')) continue;

          const key = subjectName + '|' + (teacherName || '');
          if (!subjectCounts.has(key)) subjectCounts.set(key, new Map());
          const dayMap = subjectCounts.get(key)!;
          dayMap.set('' + (dayIndex + 1), (dayMap.get('' + (dayIndex + 1)) || 0) + 1);

          if (teacherName) uniqueTeacherNames.add(teacherName);
        }
      }

      for (const [key, dayMap] of subjectCounts) {
        const [subjectName, teacherName] = key.split('|');
        let totalClasses = 0;
        for (const count of dayMap.values()) {
          totalClasses += count;
        }
        curriculums.push({
          className,
          subjectName,
          teacherName: teacherName || null,
          classesPerWeek: totalClasses,
          level: inferLevel(className),
          shift: inferShift(className),
        });
      }
    }

    const existingTeachers = await prisma.teacher.findMany({
      select: { id: true, name: true }
    });

    const mergeSuggestions: TeacherMergeSuggestion[] = [];
    const seenPairs = new Set<string>();

    // Check within the Excel file itself for similar names
    const teacherArray = Array.from(uniqueTeacherNames);
    for (let i = 0; i < teacherArray.length; i++) {
      for (let j = i + 1; j < teacherArray.length; j++) {
        const a = teacherArray[i];
        const b = teacherArray[j];
        const similarity = calculateSimilarity(a.toLowerCase(), b.toLowerCase());
        if (similarity > 0.6) {
          const pairKey = [a.toLowerCase(), b.toLowerCase()].sort().join('|');
          if (seenPairs.has(pairKey)) continue;
          seenPairs.add(pairKey);
          // Longer name gets replaced by shorter name
          const toReplace = a.length >= b.length ? a : b;
          const toKeep = a.length >= b.length ? b : a;
          mergeSuggestions.push({
            newName: toReplace,
            existingTeacherId: '',
            existingTeacherName: toKeep,
            confidence: similarity,
          });
        }
      }
    }

    // Check against existing database teachers
    for (const newName of uniqueTeacherNames) {
      for (const existing of existingTeachers) {
        const similarity = calculateSimilarity(newName.toLowerCase(), existing.name.toLowerCase());
        if (similarity > 0.6 && newName.toLowerCase() !== existing.name.toLowerCase()) {
          const pairKey = [newName.toLowerCase(), existing.name.toLowerCase()].sort().join('|');
          if (seenPairs.has(pairKey)) continue;
          seenPairs.add(pairKey);
          mergeSuggestions.push({
            newName,
            existingTeacherId: existing.id,
            existingTeacherName: existing.name,
            confidence: similarity,
          });
        }
      }
    }

    return {
      success: true,
      curriculums,
      mergeSuggestions,
      totalEntries: curriculums.reduce((sum, c) => sum + c.classesPerWeek, 0),
    };
  } catch (e: any) {
    console.error('Excel analysis error:', e);
    return { success: false, error: e.message };
  }
}

function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.8;

  const wordsA = a.split(/\s+/);
  const wordsB = b.split(/\s+/);
  let matchingWords = 0;
  for (const wa of wordsA) {
    for (const wb of wordsB) {
      if (wa === wb || wa.includes(wb) || wb.includes(wa)) {
        matchingWords++;
        break;
      }
    }
  }
  return matchingWords / Math.max(wordsA.length, wordsB.length);
}

export async function applyImportWithMerges(
  curriculums: ParsedCurriculum[],
  mergeMap: Record<string, string>,
  mergeFinalNames: Record<string, string>
) {
  try {
    const existingTeachers = await prisma.teacher.findMany();
    const teacherByName = new Map(existingTeachers.map(t => [t.name.toLowerCase(), t]));

    // Apply renames first
    for (const [newName, existingName] of Object.entries(mergeMap)) {
      if (newName === existingName) continue;
      const finalName = mergeFinalNames[newName] || existingName;
      const teacher = teacherByName.get(existingName.toLowerCase());
      if (teacher && teacher.name.toLowerCase() !== finalName.toLowerCase()) {
        const alreadyExists = teacherByName.get(finalName.toLowerCase());
        if (!alreadyExists) {
          await prisma.teacher.update({
            where: { id: teacher.id },
            data: { name: finalName }
          });
          teacherByName.delete(teacher.name.toLowerCase());
          teacherByName.set(finalName.toLowerCase(), { ...teacher, name: finalName });
        }
      }
    }

    let created = 0;
    let updated = 0;
    let classesCreated = 0;
    let subjectsCreated = 0;

    const classCache = new Map<string, any>();
    const subjectCache = new Map<string, any>();

    for (const curr of curriculums) {
      let classObj = classCache.get(curr.className);
      if (!classObj) {
        classObj = await prisma.class.findFirst({ where: { name: curr.className } });
        if (!classObj) {
          classObj = await prisma.class.create({
            data: {
              name: curr.className,
              level: curr.level,
              shift: curr.shift,
            }
          });
          classesCreated++;
        }
        classCache.set(curr.className, classObj);
      }

      let subject = subjectCache.get(curr.subjectName);
      if (!subject) {
        subject = await prisma.subject.findFirst({ where: { name: curr.subjectName } });
        if (!subject) {
          subject = await prisma.subject.create({
            data: { name: curr.subjectName }
          });
          subjectsCreated++;
        }
        subjectCache.set(curr.subjectName, subject);
      }

      const isRegente = classObj.level === 'INFANTIL' || classObj.level === 'FUND1';

      let teacherId: string | null = null;
      if (curr.teacherName) {
        const resolvedName = mergeMap[curr.teacherName]
          ? (mergeFinalNames[curr.teacherName] || mergeMap[curr.teacherName])
          : curr.teacherName;
        const teacher = teacherByName.get(resolvedName.toLowerCase());
        if (teacher) {
          teacherId = teacher.id;
          if (teacher.type !== (isRegente ? 'REGENTE' : 'AULISTA')) {
            await prisma.teacher.update({
              where: { id: teacher.id },
              data: { type: isRegente ? 'REGENTE' : 'AULISTA' }
            });
          }
        } else {
          const newTeacher = await prisma.teacher.create({
            data: { name: resolvedName, type: isRegente ? 'REGENTE' : 'AULISTA' }
          });
          teacherId = newTeacher.id;
          teacherByName.set(resolvedName.toLowerCase(), newTeacher);
        }
      }

      const existing = await prisma.curriculum.findUnique({
        where: { classId_subjectId: { classId: classObj.id, subjectId: subject.id } }
      });

      if (existing) {
        await prisma.curriculum.update({
          where: { id: existing.id },
          data: { teacherId, classesPerWeek: curr.classesPerWeek }
        });
        updated++;
      } else {
        await prisma.curriculum.create({
          data: {
            classId: classObj.id,
            subjectId: subject.id,
            teacherId,
            classesPerWeek: curr.classesPerWeek,
          }
        });
        created++;
      }
    }

    // Delete teachers that were merged (have no curriculums)
    let deleted = 0;
    for (const [newName, existingName] of Object.entries(mergeMap)) {
      if (newName === existingName) continue;
      const oldTeacher = await prisma.teacher.findFirst({ where: { name: newName } });
      if (oldTeacher) {
        const curriculumCount = await prisma.curriculum.count({ where: { teacherId: oldTeacher.id } });
        if (curriculumCount === 0) {
          await prisma.teacher.delete({ where: { id: oldTeacher.id } });
          deleted++;
        }
      }
    }

    revalidatePath('/turmas');
    revalidatePath('/gerador');
    revalidatePath('/professores');

    return { success: true, created, updated, classesCreated, subjectsCreated, deleted };
  } catch (e: any) {
    console.error('Apply import error:', e);
    return { success: false, error: e.message };
  }
}

export async function deleteTemplate(templateId: string) {
  try {
    await prisma.scheduleTemplate.delete({ where: { id: templateId } });
    revalidatePath('/gerador');
    return { success: true };
  } catch (e: any) {
    console.error(e);
    return { success: false, error: e.message };
  }
}

export async function fetchConflicts(): Promise<Conflict[]> {
  return await detectConflicts();
}

export async function previewRecalculation(changes: RecalculationChange[]): Promise<RecalculationProposal> {
  return await runRecalculation(changes);
}

export async function confirmRecalculation(changes: RecalculationChange[]): Promise<{ success: boolean; applied: number; error?: string }> {
  const result = await applyRecalculation(changes);
  if (result.success) {
    revalidatePath('/gerador');
  }
  return result;
}

export async function fetchFixedSubjectConfigs() {
  return await prisma.fixedSubjectConfig.findMany({
    include: { Subject: true, FixedSubjectClass: { include: { Class: true } } },
  });
}

export async function createFixedSubjectConfig(subjectId: string, classIds: string[], classesPerWeek: number) {
  try {
    const existing = await prisma.fixedSubjectConfig.findUnique({ where: { subjectId } });
    if (existing) {
      return { success: false, error: 'Esta disciplina já possui configuração de período fixo.' };
    }

    const config = await prisma.fixedSubjectConfig.create({
      data: {
        subjectId,
        classesPerWeek,
        FixedSubjectClass: {
          create: classIds.map(classId => ({ classId })),
        },
      },
      include: { Subject: true, FixedSubjectClass: true },
    });

    revalidatePath('/gerador');
    return { success: true, config };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function updateFixedSubjectConfig(configId: string, classIds: string[], classesPerWeek: number) {
  try {
    // Delete existing class associations
    await prisma.fixedSubjectClass.deleteMany({ where: { configId } });

    // Create new associations
    await prisma.fixedSubjectClass.createMany({
      data: classIds.map(classId => ({ configId, classId })),
    });

    // Update classesPerWeek
    await prisma.fixedSubjectConfig.update({
      where: { id: configId },
      data: { classesPerWeek },
    });

    revalidatePath('/gerador');
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function deleteFixedSubjectConfig(configId: string) {
  try {
    await prisma.fixedSubjectConfig.delete({ where: { id: configId } });
    revalidatePath('/gerador');
    return { success: true };
  } catch (e: any) {
    console.error(e);
    return { success: false, error: e.message };
  }
}

export async function autoFixConflict(conflictId: string): Promise<{ success: boolean; message: string; error?: string }> {
  try {
    const conflicts = await detectConflicts();
    const conflict = conflicts.find(c => c.id === conflictId);
    
    if (!conflict) {
      return { success: false, message: 'Conflito não encontrado', error: 'Conflict not found' };
    }
    
    if (!conflict.autoFixable || !conflict.suggestedFix) {
      return { success: false, message: 'Este conflito não pode ser corrigido automaticamente', error: 'Not auto-fixable' };
    }
    
    const result = await applyAutoFix(conflict.suggestedFix);
    if (result.success) {
      revalidatePath('/gerador');
    }
    return result;
  } catch (e: any) {
    console.error(e);
    return { success: false, message: 'Erro ao aplicar correção', error: e.message };
  }
}

export async function autoFixAllConflicts(): Promise<{ 
  fixed: number; 
  failed: number; 
  results: { conflictId: string; success: boolean; message: string }[];
  error?: string;
}> {
  try {
    const result = await autoFixAllConflictsFromRecalculator();
    revalidatePath('/gerador');
    return result;
  } catch (e: any) {
    console.error(e);
    return { fixed: 0, failed: 0, results: [], error: e.message };
  }
}

export async function fixPeriodNormalization(): Promise<{ fixed: number; message: string }> {
  try {
    // Fix schedules with period > 6 (should be 1-6)
    const wrongSchedules = await prisma.schedule.findMany({
      where: { period: { gt: 6 } }
    });

    for (const s of wrongSchedules) {
      const normalizedPeriod = s.period - 6;
      await prisma.schedule.update({
        where: { id: s.id },
        data: { period: normalizedPeriod }
      });
    }

    // Fix availability with period > 6
    const wrongAvail = await prisma.availability.findMany({
      where: { period: { gt: 6 } }
    });

    for (const a of wrongAvail) {
      const normalizedPeriod = a.period - 6;
      await prisma.availability.update({
        where: { id: a.id },
        data: { period: normalizedPeriod }
      });
    }

    const total = wrongSchedules.length + wrongAvail.length;
    revalidatePath('/gerador');
    revalidatePath('/restricoes');
    revalidatePath('/professores');

    return {
      fixed: total,
      message: `Corrigidos ${wrongSchedules.length} horários e ${wrongAvail.length} disponibilidades (períodos > 6 → normalizados para 1-6).`
    };
  } catch (e: any) {
    return { fixed: 0, message: `Erro: ${e.message}` };
  }
}
