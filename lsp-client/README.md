# Dependency Graph

Analizador estático de Python que genera un grafo interactivo de dependencias entre archivos, clases y funciones.

## Características

- Analiza todos los archivos `.py` del workspace automáticamente
- Muestra un grafo interactivo navegable: carpetas → archivos → clases → funciones
- Detecta relaciones `imports`, `calls`, `declares` y `contains` entre elementos
- Permite renombrar funciones directamente desde el grafo
- Avisa qué archivos se ven afectados cuando cambia la firma de una función
- Usa [tree-sitter](https://tree-sitter.github.io/) para parseo preciso, sin ejecutar el código

## Uso

1. Abrí un workspace que contenga archivos `.py`
2. Ejecutá el comando **Show Dependency Graph** desde la paleta de comandos (`Ctrl+Shift+P` / `Cmd+Shift+P`)
3. El grafo se genera automáticamente y se actualiza al guardar archivos

## Requisitos

- Python 3 (opcional: instalar `jedi` para inferencia de tipos mejorada)

## Telemetría

Esta extensión recolecta datos anónimos de uso (cantidad de archivos y funciones analizadas) con tu consentimiento. Podés desactivar la telemetría en **Ajustes → Telemetry → Telemetry Level**.

## Configuración

Podés excluir carpetas del análisis creando un archivo `.lspignore` en la raíz del workspace (sintaxis gitignore):

```
node_modules/
__pycache__/
.venv/
dist/
```
