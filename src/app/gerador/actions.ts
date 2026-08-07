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

export async function generateSchedule(mode: 'REPAIR' | 'SCRATCH') {
  try {
    const res = await runGenerator(mode);
    revalidatePath('/gerador');
    
    if (res.success) {
      return { success: true, message: `Grade gerada com sucesso! ${res.assigned} aulas alocadas.` };
    } else {
      let msg = res.timeout ? 'O limite de cálculo foi atingido. A grade foi gerada parcialmente.' : 'Impossível fechar a grade com as regras atuais.';
      return { success: true, message: `${msg} (${res.assigned} de ${res.total} alocadas).` }; // Return true so it refreshes grid
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

    // Update all schedules for this class and subject to keep consistency
    await prisma.schedule.updateMany({
      where: { classId: schedule.classId, subjectId: schedule.subjectId },
      data: { teacherId: newTeacherId }
    });

    // Update the curriculum so it reflects in Turmas & Grade
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
