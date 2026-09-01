# Seguridad de datos financieros

Firestore puede contener información financiera real. El frontend y el historial de datos tienen ciclos de vida separados: publicar una nueva versión de la interfaz no elimina documentos de Firestore.

Las colecciones `users`, `financeTransactions`, `financeMonthlySummaries`, `titheProfiles`, `titheAttributions` y `pastoralFollowups` deben conservar sus nombres y su compatibilidad histórica. Los movimientos se corrigen mediante actualización o anulación; nunca se eliminan para corregir contabilidad. Los campos de auditoría existentes también deben preservarse.

Production financial data is append/update/void oriented. Never perform destructive schema migrations without a reviewed migration plan.

Cualquier cambio futuro de esquema debe tener antes una migración versionada, documentada, revisada y con un plan de recuperación. Las reglas de Firestore, las migraciones y los scripts administrativos son cambios sensibles porque sí pueden alterar el acceso o los datos. La aplicación no debe modificar documentos históricos automáticamente al iniciar.

## Antes de publicar

- [ ] lint
- [ ] typecheck
- [ ] tests
- [ ] build
- [ ] validar Firebase project ID
- [ ] revisar firestore.rules si fueron modificadas
- [ ] confirmar que no hay migraciones destructivas
- [ ] prueba mobile
- [ ] prueba registro de movimiento
- [ ] prueba registro de diezmo
- [ ] prueba PDF
