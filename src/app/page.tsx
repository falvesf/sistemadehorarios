import styles from './page.module.css';

export default function Home() {
  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        <h1>Dashboard</h1>
        <p>Bem-vindo ao novo sistema inteligente de geração de horários.</p>
      </header>

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <h3>Total de Professores</h3>
          <p className={styles.statValue}>15</p>
        </div>
        <div className={styles.statCard}>
          <h3>Turmas Cadastradas</h3>
          <p className={styles.statValue}>20</p>
        </div>
        <div className={styles.statCard}>
          <h3>Conflitos Atuais</h3>
          <p className={styles.statValue} style={{color: 'var(--success-color)'}}>0</p>
        </div>
      </div>
    </div>
  );
}
