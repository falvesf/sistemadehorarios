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
