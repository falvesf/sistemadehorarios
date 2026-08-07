'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

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
  // TODO: Implement the actual algorithm here
  // For now, just simulate a delay and return success
  await new Promise(r => setTimeout(r, 2000));
  
  revalidatePath('/gerador');
  return { success: true, message: 'Algoritmo simulado com sucesso. (Lógica em desenvolvimento)' };
}
