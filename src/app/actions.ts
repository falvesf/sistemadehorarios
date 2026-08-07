'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

export async function updateTeacher(id: string, data: { name: string; type: 'REGENTE' | 'AULISTA' }) {
  try {
    await prisma.teacher.update({
      where: { id },
      data: {
        name: data.name,
        type: data.type,
      }
    });
    revalidatePath('/professores');
    revalidatePath('/turmas');
    return { success: true };
  } catch (e: any) {
    console.error(e);
    return { success: false, error: e.message };
  }
}

export async function createTeacher(data: { name: string; type: 'REGENTE' | 'AULISTA' }) {
  try {
    await prisma.teacher.create({
      data: {
        name: data.name,
        type: data.type,
      }
    });
    revalidatePath('/professores');
    return { success: true };
  } catch (e: any) {
    console.error(e);
    return { success: false, error: e.message };
  }
}

export async function deleteTeacher(id: string) {
  try {
    await prisma.teacher.delete({
      where: { id }
    });
    revalidatePath('/professores');
    revalidatePath('/turmas');
    return { success: true };
  } catch (e: any) {
    console.error(e);
    return { success: false, error: e.message };
  }
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
