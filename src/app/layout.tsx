import type { Metadata } from 'next';
import './globals.css';
import styles from './layout.module.css';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Sistema de Horários',
  description: 'Gerador inteligente de horários escolares',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>
        <div className={styles.appContainer}>
          <aside className={styles.sidebar}>
            <div className={styles.logo}>
              <h2>ChronoGrid</h2>
            </div>
            <nav className={styles.nav}>
              <Link href="/" className={styles.navLink}>Dashboard</Link>
              <Link href="/professores" className={styles.navLink}>Professores</Link>
              <Link href="/turmas" className={styles.navLink}>Turmas & Grade</Link>
              <Link href="/restricoes" className={styles.navLink}>Regras e Capela</Link>
              <Link href="/gerador" className={styles.navLink}>Motor Gerador</Link>
            </nav>
          </aside>
          <main className={styles.mainContent}>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
