'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

export async function getTeacherAvailability(teacherId: string) {
  return await prisma.availability.findMany({
    where: { teacherId }
  });
}

export async function saveTeacherAvailability(teacherId: string, availabilities: { dayOfWeek: number, period: number, isAvailable: boolean }[]) {
  // Clear existing availabilities for this teacher
  await prisma.availability.deleteMany({
    where: { teacherId }
  });

  // Only insert the ones that are marked as unavailable (isAvailable: false)
  // Assuming by default they are available if not in the DB, to save space.
  // Or we can just insert everything passed. Let's insert what is passed.
  const data = availabilities.map(a => ({
    teacherId,
    dayOfWeek: a.dayOfWeek,
    period: a.period,
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

    const data = classIds.map(classId => ({
      classId,
      subjectId: capelaSubject!.id,
      teacherId,
      dayOfWeek,
      period,
      isFixed: true
    }));

    await prisma.schedule.deleteMany({
      where: { classId: { in: classIds }, dayOfWeek, period }
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
    return { success: true };
  } catch (e: any) {
    console.error(e);
    return { success: false, error: e.message };
  }
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
