'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

export async function updateTeacher(id: string, data: { name: string; type: 'REGENTE' | 'AULISTA' }, forceMerge: boolean = false) {
  try {
    const existing = await prisma.teacher.findUnique({ where: { name: data.name } });
    if (existing && existing.id !== id) {
      if (!forceMerge) {
        return { success: false, error: 'EXISTS' };
      }
      
      // Merge: transfer classes and delete old
      await prisma.curriculum.updateMany({ where: { teacherId: id }, data: { teacherId: existing.id } });
      await prisma.schedule.updateMany({ where: { teacherId: id }, data: { teacherId: existing.id } });
      await prisma.teacher.delete({ where: { id } });
      await prisma.teacher.update({ where: { id: existing.id }, data: { type: data.type } });
      
      revalidatePath('/professores');
      revalidatePath('/turmas');
      revalidatePath('/gerador');
      return { success: true };
    }

    await prisma.teacher.update({
      where: { id },
      data: {
        name: data.name,
        type: data.type,
      }
    });
    revalidatePath('/professores');
    revalidatePath('/turmas');
    revalidatePath('/gerador');
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

export async function deleteClass(id: string) {
  try {
    await prisma.class.delete({
      where: { id }
    });
    revalidatePath('/turmas');
    revalidatePath('/gerador');
    return { success: true };
  } catch (e: any) {
    console.error(e);
    return { success: false, error: e.message };
  }
}

export async function updateClass(id: string, data: { name: string, level: string, shift: string }) {
  try {
    await prisma.class.update({
      where: { id },
      data: {
        name: data.name,
        level: data.level,
        shift: data.shift
      }
    });
    revalidatePath('/turmas');
    revalidatePath('/gerador');
    return { success: true };
  } catch (e: any) {
    console.error(e);
    return { success: false, error: e.message };
  }
}
