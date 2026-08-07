import prisma from '@/lib/prisma';
import styles from '../professores/professores.module.css';

export default async function TurmasPage() {
  const turmas = await prisma.class.findMany({
    orderBy: [
      { level: 'asc' },
      { name: 'asc' }
    ],
    include: {
      curriculums: {
        include: { subject: true, teacher: true }
      }
    }
  });

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1>Turmas e Grade Curricular</h1>
          <p>Gerencie as turmas, turnos e as disciplinas que cada uma possui.</p>
        </div>
        <button className="btn btn-primary">+ Nova Turma</button>
      </header>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Turma</th>
              <th>Nível</th>
              <th>Turno</th>
              <th>Grade Curricular (Matéria - Prof)</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {turmas.map(t => (
              <tr key={t.id}>
                <td><strong>{t.name}</strong></td>
                <td>{t.level}</td>
                <td>{t.shift === 'MORNING' ? 'Manhã' : 'Tarde'}</td>
                <td>
                  <div className={styles.curriculumList}>
                    {t.curriculums.map(c => (
                      <span key={c.id} className={styles.curriculumItem}>
                        <strong>{c.subject.name}</strong> 
                        {c.teacher ? ` (${c.teacher.name})` : ''} 
                        <span style={{opacity: 0.6}}> - {c.classesPerWeek}x</span>
                      </span>
                    ))}
                    {t.curriculums.length === 0 && <span className={styles.empty}>Grade vazia</span>}
                  </div>
                </td>
                <td>
                  <button className="btn btn-secondary">Editar Grade</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
