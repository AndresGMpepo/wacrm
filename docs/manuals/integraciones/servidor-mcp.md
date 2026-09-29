---
title: "Servidor MCP — conecta un asistente de IA externo"
description: "Consulta y opera tu CRM en lenguaje natural desde Claude, Cursor u otro asistente compatible con MCP."
section: "integraciones"
role: ["admin", "owner"]
plan: ["premium"]
updated: "2026-09-29"
---

## ¿Qué es?

MCP (Model Context Protocol) es un estándar que permite a asistentes de
IA como Claude o Cursor conectarse directamente a tus datos. Con el
servidor MCP de NexoOmni, puedes preguntarle a tu asistente de IA
cosas como:

> "¿Cuántas conversaciones siguen abiertas hoy?"
> "Muéstrame los últimos 5 mensajes con el +52 55 1234 5678."
> "¿Qué sabemos de este cliente? Revisa Nexo Memory."
> "Agenda una tarea para llamar a Juan Pérez mañana a las 3pm."

Es una capa fina sobre la misma [API pública](./api-publica.md) — todo
queda igual de protegido y con los mismos permisos que le diste a tu
clave de API. Aunque el asistente corra en tu computadora, siempre
consulta y modifica tus datos **reales de producción** — no hay una
copia ni un ambiente de pruebas de por medio.

## Ejemplo real de uso

Imagina que acabas de colgar una llamada con un cliente y te dijo que
te contactará en dos días para confirmar el pedido. En vez de abrir
NexoOmni y crear la tarea manualmente, le dices a tu asistente:

> "En NexoOmni, agenda un seguimiento con Juan Pérez para el jueves a
> las 10am: confirmar si acepta la cotización."

Y antes de tu próxima llamada con ese mismo cliente:

> "Revisa la memoria de Juan Pérez en NexoOmni — ¿en qué etapa está y
> qué le prometimos la última vez?"

El asistente consulta o crea esos datos directamente en tu cuenta,
respetando exactamente los permisos que le diste a la clave que usa.

## Cómo conectarlo — depende de tu asistente

**Importante**: no todos los asistentes de IA aceptan el mismo tipo de
conexión. Elige la sección que corresponda al tuyo.

### Cursor (y otros que aceptan una URL con encabezados personalizados)

1. Ve a **Configuración → API** — ahí encontrarás una tarjeta
   "Servidor MCP" con la URL y una configuración lista para copiar.
2. Crea una clave de API con solo los permisos de lectura si tu
   asistente solo va a consultar, no a modificar datos.
3. Pega la configuración (incluye la URL y el encabezado
   `Authorization`) donde tu asistente pida agregar un servidor MCP
   remoto.
4. Las herramientas que ve el asistente dependen **únicamente de los
   permisos de esa clave** — los mismos que ya administras en
   Configuración → API. Revocar la clave corta el acceso al instante.

### Claude Desktop (la app instalada, no claude.ai en el navegador)

La pantalla de "Agregar conector personalizado" de Claude (por
navegador) **no tiene dónde poner una clave de API** — solo acepta
inicio de sesión (OAuth) o acceso totalmente abierto. Para Claude, usa
en cambio este método, que no pasa por esa pantalla:

1. Crea tu clave de API igual que arriba (Configuración → API →
   tarjeta "Servidor MCP" → botón para crear la clave, solo lectura
   recomendado). Cópiala, se muestra una sola vez.
2. Pide a quien administre tu instalación de NexoOmni el archivo
   `mcp-server` ya preparado (`node mcp-server/dist/index.js`) — es un
   pequeño programa que reenvía las preguntas de Claude a tu NexoOmni
   real, no una copia de tu sistema.
3. Presiona **Windows + R**, escribe `notepad "%APPDATA%\Claude\claude_desktop_config.json"`
   y presiona Enter.
4. Agrega (o pide que agreguen) esta entrada, con la ruta real del
   archivo y tu clave real:
   ```json
   {
     "mcpServers": {
       "nexoomni": {
         "command": "node",
         "args": ["C:\\ruta\\a\\mcp-server\\dist\\index.js"],
         "env": {
           "NEXOOMNI_BASE_URL": "https://tu-instancia.example.com",
           "NEXOOMNI_API_KEY": "tu-clave-de-api"
         }
       }
     }
   }
   ```
5. Guarda el archivo y **cierra Claude Desktop por completo** (clic
   derecho en su ícono junto al reloj → Salir) antes de volver a
   abrirlo — no basta con cerrar la ventana.
6. Pruébalo pidiéndole algo real, como "¿cuántos contactos tengo en
   NexoOmni?". El número debe coincidir con lo que ves en tu panel.

### ChatGPT

El soporte de ChatGPT para conectores MCP personalizados depende de tu
plan y ha ido cambiando — revisa la documentación de conectores de
OpenAI vigente para los pasos exactos. Lo que necesitarás en cualquier
caso es la misma URL de la tarjeta "Servidor MCP" y el encabezado
`Authorization: Bearer <tu-clave>`.

## Preguntas frecuentes

**¿Es seguro darle acceso a un asistente de IA externo?**
Solo tiene acceso a lo que le permite la clave de API que le diste —
igual que cualquier otra integración. Empieza siempre en modo
solo-lectura.

**¿Puede enviar mensajes a mis clientes por sí solo?**
Solo si le das una clave con el permiso de enviar mensajes — no ocurre
por accidente. Puedes revisar y revocar cualquier clave en
Configuración → API en cualquier momento.

**¿"Claude Desktop" con el método local consulta datos de prueba o mis datos reales?**
Tus datos reales. Lo único que corre en tu computadora es un pequeño
programa que reenvía las preguntas a tu NexoOmni real por internet —
no hay ninguna base de datos ni copia local involucrada.

## Ver también

- [Claves de API](./claves-api.md)
- [API pública](./api-publica.md)

