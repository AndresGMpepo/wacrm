---
title: "Importar contactos por CSV"
description: "Sube tu lista de clientes existente desde una hoja de cálculo, con etiquetas y detección de duplicados."
section: "contactos"
role: ["agent", "supervisor", "admin", "owner"]
plan: ["basico", "crecimiento", "premium"]
updated: "2026-09-28"
---

## ¿Qué es?

Una forma de cargar muchos contactos de una sola vez desde un archivo
CSV (exportado de Excel, Google Sheets, u otro sistema), en vez de
crearlos uno por uno.

## ¿Para quién es?

Cualquier persona con permiso para agregar contactos.

## Cómo se usa

1. Ve a **Contactos → Importar**.
2. Sube tu archivo CSV. Columnas reconocidas automáticamente: teléfono
   (obligatoria), nombre, empresa y etiquetas.
3. Revisa la vista previa — se muestran las etiquetas que ya existen y
   cuáles se crearán nuevas.
4. Confirma la importación.

## Preguntas frecuentes

**¿Qué pasa si un número ya existe en mi base?**
Los duplicados dentro del mismo archivo se filtran automáticamente
antes de importar (se queda con la primera aparición). Si el número ya
existe como contacto, no se crea uno nuevo.

**¿El teléfono es obligatorio?**
Sí — es el dato que identifica a un contacto en NexoOmni; una fila sin
teléfono válido no se importa.

## Ver también

- [Fusionar contactos duplicados](./fusionar-contactos.md)
- [Audiencias y exclusiones](../difusiones/audiencias-y-exclusiones.md)
