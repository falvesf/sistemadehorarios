# Regras Básicas do Sistema de Horários

## 1. Períodos: SEMPRE 1-6, NUNCA 7-12

**REGRA FUNDAMENTAL: Não existe normalização nem desnormalização de períodos.**

O banco de dados armazena períodos de **1 a 6** para ambos os turnos:
- **Manhã (MORNING)**: 1ª a 6ª aula (07:15 - 12:05)
- **Tarde (AFTERNOON)**: 1ª a 6ª aula (12:50 - 17:20)

Os turnos são **completamente distintos** e não se conflitam. Um professor pode lecionar 1ª aula na manhã E 1ª aula na tarde sem conflito.

### O que NÃO fazer:
- ❌ Armazenar período 7-12 para turmas da tarde
- ❌ Usar funções `np()` (normalize period) ou `dp()` (denormalize period)
- ❌ Qualquer conversão entre períodos

### O que fazer:
- ✅ Sempre armazenar período como 1-6
- ✅ Usar o campo `shift` para distinguishir turnos
- ✅ Ao verificar conflitos de professor, comparar: `teacherId + day + shift + period`

### Exemplo correto:
```
Turma A (Manhã): Segunda, período 1, shift=MORNING → 07:15-08:00
Turma B (Tarde): Segunda, período 1, shift=AFTERNOON → 12:50-13:35
→ NÃO HÁ CONFLITO (turnos diferentes)
```

## 2. Ordem de Geração "Gerar do Zero"

1. **Capela**: Preencher todos os horários de capela definidos nas regras
2. **Disciplinas de Período Fixo**: Preencher disciplinas como Bilingue
3. **Resto da grade**: Preencher demais disciplinas respeitando posições já ocupadas

## 3. Tipos de Professor

- **REGENTE**: Leciona Infantil e Fund. I (turmas com 5 aulas/dia)
- **AULISTA**: Leciona Fund. II e Médio (turmas com 6 aulas/dia)

## 4. Distribuição de Aulas por Dia

| Nível       | Seg-Sex (Manhã/Tarde) | Sexta |
|-------------|----------------------|-------|
| Infantil    | 5 aulas              | 5     |
| Fund. I     | 5 aulas              | 5     |
| Fund. II    | 6 aulas              | 5*    |
| Médio       | 6 aulas              | 5*    |

*Na sexta, há menos aulas devido ao pôr do sol.
