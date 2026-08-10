'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

import { runGenerator } from './engine';

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

export async function restoreDefaultSchedule() {
  try {
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
