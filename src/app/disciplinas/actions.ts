'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

export async function getSubjects() {
  return await prisma.subject.findMany({
    include: {
      _count: { select: { curriculums: true, schedules: true } },
    },
    orderBy: { name: 'asc' },
  });
}

export async function createSubject(name: string) {
  try {
    const trimmed = name.trim();
    if (!trimmed) {
      return { success: false, error: 'Nome da disciplina é obrigatório.' };
    }

    const existing = await prisma.subject.findFirst({
      where: { name: { equals: trimmed, mode: 'insensitive' } },
    });
    if (existing) {
      return { success: false, error: `Já existe uma disciplina com o nome "${trimmed}".` };
    }

    await prisma.subject.create({ data: { name: trimmed } });
    revalidatePath('/disciplinas');
    return { success: true };
  } catch (e: any) {
    console.error(e);
    return { success: false, error: e.message };
  }
}

export async function updateSubject(id: string, name: string) {
  try {
    const trimmed = name.trim();
    if (!trimmed) {
      return { success: false, error: 'Nome da disciplina é obrigatório.' };
    }

    const existing = await prisma.subject.findFirst({
      where: { name: { equals: trimmed, mode: 'insensitive' }, id: { not: id } },
    });
    if (existing) {
      return { success: false, error: `Já existe uma disciplina com o nome "${trimmed}".` };
    }

    await prisma.subject.update({ where: { id }, data: { name: trimmed } });
    revalidatePath('/disciplinas');
    revalidatePath('/turmas');
    revalidatePath('/gerador');
    return { success: true };
  } catch (e: any) {
    console.error(e);
    return { success: false, error: e.message };
  }
}

export async function deleteSubject(id: string) {
  try {
    const subject = await prisma.subject.findUnique({
      where: { id },
      include: { _count: { select: { curriculums: true, schedules: true } } },
    });
    if (!subject) {
      return { success: false, error: 'Disciplina não encontrada.' };
    }
    if (subject._count.curriculums > 0 || subject._count.schedules > 0) {
      return {
        success: false,
        error: `Não é possível excluir "${subject.name}" pois está vinculada a ${subject._count.curriculums} grade(s) curricular(es) e ${subject._count.schedules} horário(s).`,
      };
    }

    await prisma.subject.delete({ where: { id } });
    revalidatePath('/disciplinas');
    return { success: true };
  } catch (e: any) {
    console.error(e);
    return { success: false, error: e.message };
  }
}
