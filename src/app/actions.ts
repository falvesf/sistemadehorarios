'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

export async function updateTeacher(id: string, data: { name: string; type: 'REGENTE' | 'AULISTA' }) {
  await prisma.teacher.update({
    where: { id },
    data: {
      name: data.name,
      type: data.type,
    }
  });
  revalidatePath('/professores');
  revalidatePath('/turmas'); // since teacher name appears in turmas too
}

export async function updateCurriculum(id: string, classesPerWeek: number, teacherId: string | null) {
  await prisma.curriculum.update({
    where: { id },
    data: {
      classesPerWeek,
      teacherId
    }
  });
  revalidatePath('/turmas');
  revalidatePath('/professores');
}
