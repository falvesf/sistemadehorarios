
## Regras de Interface de Usuário (UI)
- **NUNCA** utilize funções nativas do navegador (como `window.confirm`, `window.alert` ou `window.prompt`) para interações com o usuário, avisos ou confirmações.
- Utilize EXCLUSIVAMENTE o componente `<Modal>` já existente no projeto ou o sistema de `Toast` para manter a padronização visual e a coesão da interface.
