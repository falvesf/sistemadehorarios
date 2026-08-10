'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

import { runGenerator } from './engine';
import * as XLSX from 'xlsx';

export async function fetchCurrentSchedule() {
  const schedules = await prisma.schedule.findMany({
    include: {
      class: true,
      subject: true,
      teacher: true,
    },
    orderBy: [
      { class: { level: 'asc' } },
      { class: { name: 'asc' } },
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
    const res = await runGenerator(mode);
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
    include: { class: true, subject: true, teacher: true },
    orderBy: [{ class: { name: 'asc' } }, { dayOfWeek: 'asc' }, { period: 'asc' }]
  });

  const curriculums = await prisma.curriculum.findMany({
    include: { class: true, subject: true, teacher: true }
  });

  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    schedules: schedules.map(s => ({
      className: s.class.name,
      subjectName: s.subject.name,
      teacherName: s.teacher?.name || null,
      dayOfWeek: s.dayOfWeek,
      period: s.period,
      isFixed: s.isFixed,
    })),
    curriculums: curriculums.map(c => ({
      className: c.class.name,
      subjectName: c.subject.name,
      teacherName: c.teacher?.name || null,
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

export async function restoreDefaultSchedule(templateId?: string) {
  try {
    // If templateId is provided, use that template
    if (templateId) {
      const template = await prisma.scheduleTemplate.findUnique({
        where: { id: templateId },
        include: { entries: true },
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
      for (const entry of template.entries) {
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
          if (!teachersMap.has(entry.teacherName)) {
            let teacher = await prisma.teacher.findFirst({ where: { name: entry.teacherName } });
            if (!teacher) {
              teacher = await prisma.teacher.create({ data: { name: entry.teacherName, type: 'AULISTA' } });
            }
            teachersMap.set(entry.teacherName, teacher.id);
          }
          teacherId = teachersMap.get(entry.teacherName)!;
        }

        // Create schedule entry
        const classObj = await prisma.class.findUnique({ where: { id: classId } });
        const shift = classObj?.shift || 'MORNING';
        const dbPeriod = shift === 'AFTERNOON' ? entry.period + 6 : entry.period;

        await prisma.schedule.create({
          data: {
            classId,
            subjectId,
            teacherId,
            dayOfWeek: entry.dayOfWeek,
            period: dbPeriod,
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

    const curriculums = await prisma.curriculum.findMany({ include: { class: true } });

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
    include: { _count: { select: { entries: true } } },
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
      // Structure: row[0]=null, row[1]="1ª", row[2..6]=Mon-Fri subjects
      let periodIndex = 1;
      for (let i = 6; i < data.length; i++) {
        const row = data[i];
        if (!row || row.length === 0) continue;

        // Period indicator is in column 1 (e.g., "1ª", "2ª")
        const periodCell = (row[1] || '').toString().trim().toUpperCase();

        // Skip INTERVALO, legend rows, etc.
        if (periodCell.includes('INTERVALO')) continue;
        if (periodCell.includes('ATUALIZADO')) continue;
        if (periodCell === '' || periodCell === 'AULA') continue;

        // Check if it looks like a period (contains "ª")
        if (!periodCell.includes('ª')) continue;

        // Days are in columns 2-6 (Segunda=2, Terça=3, Quarta=4, Quinta=5, Sexta=6)
        for (let dayIndex = 0; dayIndex < 5; dayIndex++) {
          const cellData = row[dayIndex + 2]; // columns 2..6
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
