'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

export async function getTeacherAvailability(teacherId: string) {
  return await prisma.availability.findMany({
    where: { teacherId }
  });
}

export async function saveTeacherAvailability(teacherId: string, availabilities: { dayOfWeek: number, period: number, isAvailable: boolean, shift?: string }[]) {
  // Clear existing availabilities for this teacher
  await prisma.availability.deleteMany({
    where: { teacherId }
  });

  // Save with shift and normalized period (1-6)
  const data = availabilities.map(a => ({
    teacherId,
    dayOfWeek: a.dayOfWeek,
    shift: a.shift || (a.period > 6 ? 'AFTERNOON' : 'MORNING'),
    period: a.period > 6 ? a.period - 6 : a.period,
    isAvailable: a.isAvailable
  }));

  if (data.length > 0) {
    await prisma.availability.createMany({
      data
    });
  }

  revalidatePath('/restricoes');
  return { success: true };
}

export async function addCapelaRule(classIds: string[], dayOfWeek: number, period: number, teacherId: string) {
  try {
    let capelaSubject = await prisma.subject.findUnique({ where: { name: 'Capela' } });
    if (!capelaSubject) {
      capelaSubject = await prisma.subject.create({ data: { name: 'Capela' } });
    }

    // Normalize: periods 7-12 → 1-6
    const normalizedPeriod = period > 6 ? period - 6 : period;

    const data = classIds.map(classId => ({
      classId,
      subjectId: capelaSubject!.id,
      teacherId,
      dayOfWeek,
      period: normalizedPeriod,
      isFixed: true
    }));

    await prisma.schedule.deleteMany({
      where: { classId: { in: classIds }, dayOfWeek, period: normalizedPeriod }
    });

    await prisma.schedule.createMany({ data });
    revalidatePath('/restricoes');
    return { success: true };
  } catch (e: any) {
    console.error(e);
    return { success: false, error: e.message };
  }
}

export async function deleteCapelaRule(scheduleId: string) {
  try {
    await prisma.schedule.delete({ where: { id: scheduleId } });
    revalidatePath('/restricoes');
    revalidatePath('/gerador');
    return { success: true };
  } catch (e: any) {
    console.error(e);
    return { success: false, error: e.message };
  }
}

export async function updateCapelaRule(scheduleId: string, dayOfWeek: number, period: number, teacherId: string) {
  try {
    const currentRule = await prisma.schedule.findUnique({ where: { id: scheduleId } });
    if (!currentRule) return { success: false, error: 'Regra não encontrada.' };

    // Delete any existing entry for this class/day/period (including non-fixed)
    await prisma.schedule.deleteMany({
      where: { classId: currentRule.classId, dayOfWeek, period }
    });

    await prisma.schedule.update({
      where: { id: scheduleId },
      data: { dayOfWeek, period, teacherId },
    });
    revalidatePath('/restricoes');
    revalidatePath('/gerador');
    return { success: true };
  } catch (e: any) {
    console.error(e);
    return { success: false, error: e.message };
  }
}

export async function getCapelaRules() {
  const capelaSubject = await prisma.subject.findUnique({ where: { name: 'Capela' } });
  if (!capelaSubject) return [];
  return await prisma.schedule.findMany({
    where: { isFixed: true, subjectId: capelaSubject.id },
    include: { Class: true, Subject: true, Teacher: true },
    orderBy: [{ Class: { name: 'asc' } }, { dayOfWeek: 'asc' }, { period: 'asc' }]
  });
}

export async function getTimeSlots() {
  return await prisma.timeSlot.findMany({
    orderBy: [
      { level: 'asc' },
      { shift: 'asc' },
      { dayOfWeek: 'asc' },
      { period: 'asc' }
    ]
  });
}

export async function saveTimeSlots(timeSlots: { id: string, startTime: string, endTime: string }[]) {
  try {
    for (const slot of timeSlots) {
      await prisma.timeSlot.update({
        where: { id: slot.id },
        data: { startTime: slot.startTime, endTime: slot.endTime }
      });
    }
    revalidatePath('/restricoes');
    return { success: true };
  } catch (e: any) {
    console.error(e);
    return { success: false, error: e.message };
  }
}

// ── Subject Aliases (e.g., "Cultura Geral" -> "Capela") ─────────

export async function getSubjectAliases() {
  return await prisma.subjectAlias.findMany({
    orderBy: { sourceName: 'asc' }
  });
}

export async function addSubjectAlias(sourceName: string, targetName: string) {
  try {
    if (!sourceName.trim() || !targetName.trim()) {
      return { success: false, error: 'Preencha ambos os campos.' };
    }

    const existing = await prisma.subjectAlias.findUnique({
      where: { sourceName: sourceName.trim() }
    });
    if (existing) {
      return { success: false, error: `Já existe uma regra para "${sourceName}".` };
    }

    await prisma.subjectAlias.create({
      data: {
        sourceName: sourceName.trim(),
        targetName: targetName.trim(),
      }
    });
    revalidatePath('/restricoes');
    revalidatePath('/gerador');
    return { success: true };
  } catch (e: any) {
    console.error(e);
    return { success: false, error: e.message };
  }
}

export async function deleteSubjectAlias(id: string) {
  try {
    await prisma.subjectAlias.delete({ where: { id } });
    revalidatePath('/restricoes');
    revalidatePath('/gerador');
    return { success: true };
  } catch (e: any) {
    console.error(e);
    return { success: false, error: e.message };
  }
}
