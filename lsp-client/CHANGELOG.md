# Changelog

## [0.1.0] - 2026-06-08

### Agregado
- Análisis estático de Python con tree-sitter
- Grafo interactivo de dependencias (carpetas, archivos, clases, funciones)
- Navegación jerárquica con drill-down por carpeta
- Detección de llamadas entre funciones (call graph)
- Renombrado de funciones desde el grafo con propagación automática
- Aviso de archivos afectados al cambiar firmas de funciones
- Soporte de `.lspignore` para excluir directorios del análisis
- Telemetría anónima opt-in respetando el setting global de VSCode
