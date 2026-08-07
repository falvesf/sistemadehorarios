import styles from '../professores/professores.module.css';

export default function GeradorPage() {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1>Motor Gerador de Horários</h1>
          <p>Configure as opções e inicie o algoritmo inteligente para alocar as aulas.</p>
        </div>
        <button className="btn btn-primary">Gerar Horários</button>
      </header>

      <div className="table-container" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
        <h2>Pronto para iniciar?</h2>
        <p>O algoritmo levará em consideração a disponibilidade dos professores, turmas, dias de capela e evitará colisões.</p>
        <br />
        <button className="btn btn-primary" style={{ padding: '1rem 2rem', fontSize: '1.25rem' }}>
          ✨ Iniciar Geração Automática
        </button>
      </div>
    </div>
  );
}
