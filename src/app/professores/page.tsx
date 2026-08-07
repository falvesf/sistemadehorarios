import prisma from '@/lib/prisma';
import styles from './professores.module.css';

export default async function ProfessoresPage() {
  const professores = await prisma.teacher.findMany({
    orderBy: { name: 'asc' },
    include: {
      curriculums: {
        include: { class: true, subject: true }
      }
    }
  });

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1>Professores</h1>
          <p>Gerencie os professores regentes e aulistas da escola.</p>
        </div>
        <button className="btn btn-primary">+ Novo Professor</button>
      </header>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Turmas/Disciplinas</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {professores.map(p => (
              <tr key={p.id}>
                <td><strong>{p.name}</strong></td>
                <td>
                  <span className={`${styles.badge} ${p.type === 'REGENTE' ? styles.badgeRegente : styles.badgeAulista}`}>
                    {p.type}
                  </span>
                </td>
                <td>
                  <div className={styles.curriculumList}>
                    {p.curriculums.map(c => (
                      <span key={c.id} className={styles.curriculumItem}>
                        {c.class.name} - {c.subject.name}
                      </span>
                    ))}
                    {p.curriculums.length === 0 && <span className={styles.empty}>Nenhuma</span>}
                  </div>
                </td>
                <td>
                  <button className="btn btn-secondary">Editar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
