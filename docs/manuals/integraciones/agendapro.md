---
title: "AgendaPro: reservas y confirmación automática de citas"
description: "Conecta AgendaPro, consulta sus reservas desde NexoOmni y activa el recordatorio de confirmación por WhatsApp 24 horas antes de cada cita."
section: "integraciones"
role: ["admin", "owner"]
plan: ["crecimiento", "premium"]
updated: "2026-10-02"
---

## ¿Qué es?

Conecta tu cuenta de [AgendaPro](https://agendapro.com) (reservas,
clientes y pagos) con NexoOmni para ver y crear reservas desde el panel,
y para que NexoOmni le envíe automáticamente a cada cliente un mensaje
de WhatsApp **24 horas antes de su cita** pidiéndole que confirme. Si el
cliente responde que no puede asistir, o si no responde nada, recepción
recibe un aviso para reagendar o cancelar — nadie llega a una cita que
el cliente ya había cancelado en silencio.

Este módulo es independiente del módulo de **Citas** interno de
NexoOmni (ver [Agenda de citas](../pipelines-y-citas/agenda-de-citas.md)).

## ¿Para quién es?

- Un **administrador o propietario** conecta AgendaPro y activa la
  confirmación automática desde **Configuración → AgendaPro**.
- **Recepción** recibe los avisos de citas sin confirmar (dentro de
  NexoOmni y, si se configura, por WhatsApp).
- Cualquier **agente** puede consultar y crear reservas desde el menú
  **AgendaPro**.

## Cómo se usa

### 1. Conectar AgendaPro

1. En AgendaPro, ve a **Configuraciones → API Pública** y copia el
   usuario y la contraseña que se muestran ahí.
2. En NexoOmni, ve a **Configuración → AgendaPro** y pégalos en
   "Conectar".
3. Copia la URL del webhook que aparece y pégala en AgendaPro →
   **Configuraciones → API Pública → Webhooks** ("Crear Webhook"). Esto
   mantiene sincronizadas las reservas, aunque se creen directamente
   desde el panel de AgendaPro.
4. Si tus locales **no** operan en Ciudad de México, ajusta la zona
   horaria en **Configuración → AgendaPro → "Zona horaria de
   AgendaPro"** — AgendaPro reporta la hora de cada cita sin indicar
   correctamente la zona horaria, así que NexoOmni necesita saber la
   zona real para mostrar y registrar la hora correcta.

### 2. Crear las plantillas de WhatsApp (requerido por Meta)

Cualquier mensaje que un negocio envía por iniciativa propia por
WhatsApp (no como respuesta a un cliente) debe ser una **plantilla
aprobada por Meta** — por eso el recordatorio de confirmación no es un
texto libre, sino dos plantillas que debes crear y enviar a aprobación
una sola vez, desde **Configuración → Plantillas**:

| | Nombre sugerido | Categoría | Idioma | Texto sugerido |
|---|---|---|---|---|
| Plantilla 1 — al cliente | `confirmacion_cita_24h` | Utility | es_MX | "Hola {{1}}, te recordamos tu cita de *{{2}}* el día {{3}} a las {{4}} hrs en {{5}}. Por favor responde *SI* para confirmar tu asistencia o *NO* si necesitas cancelarla o reagendarla." |
| Plantilla 2 — a recepción | `aviso_recepcion_cita_sin_confirmar` | Utility | es_MX | "Aviso NexoOmni: {{1}} no confirmó su cita de {{2}} el {{3}} a las {{4}} hrs. Motivo: {{5}}. Por favor contáctalo para reagendar o cancelar." |

Usa la categoría **Utility** (no Marketing): es una notificación de
servicio sobre una cita existente, que Meta aprueba más rápido y cobra
más barato que una plantilla promocional. Evita lenguaje de venta o
promociones en el texto — Meta puede rechazar la plantilla si lo
detecta.

La aprobación de Meta suele tardar de minutos a unas horas. Mientras
una plantilla esté en estado "Pendiente", no actives el paso 3.

> **Si tu WhatsApp está conectado con la Conexión NexoOmni** (la
> "Conexión rápida de canales" de **Configuración → WhatsApp**) y no
> tienes "WhatsApp directo" conectado, NexoOmni envía el recordatorio, el
> aviso a recepción y recibe la respuesta SI/NO por ese número. Crea las
> dos plantillas **para ese mismo número** en **Configuración →
> Plantillas** (al crear la plantilla, elige ese número en lugar de
> "WhatsApp directo"): una plantilla aprobada en otro número no sirve
> para enviar desde este. Si tienes ambos conectados, se usa el WhatsApp
> directo.

### 3. Activar la confirmación automática

En **Configuración → AgendaPro**, en la sección "Confirmación de citas
por WhatsApp":

1. Escribe el nombre exacto de cada plantilla aprobada (si usaste los
   nombres sugeridos arriba, ya vienen precargados).
2. Opcional: escribe el teléfono de recepción en formato internacional
   (ej. `+52 55 1234 5678`) para que también reciba el aviso por
   WhatsApp, además del aviso dentro de NexoOmni.
3. Activa el interruptor.

A partir de ahí, 24 horas antes de cada cita AgendaPro:

1. NexoOmni envía la plantilla de confirmación al cliente.
2. Si el cliente responde **SI**, la cita queda marcada como
   confirmada — no pasa nada más.
3. Si el cliente responde **NO**, recepción recibe el aviso de
   inmediato.
4. Si el cliente no responde nada, recepción recibe el aviso **6 horas
   después** del recordatorio.

El aviso a recepción llega como notificación dentro de NexoOmni (campana
de notificaciones) y, si configuraste un teléfono, también por
WhatsApp.

### 4. Vista de calendario por día, semana y mes, y colores por estado

El menú **AgendaPro** se ve como el calendario de AgendaPro: una vista
de **día** con una columna por prestador, donde cada reserva aparece
como un bloque de color en su horario real. También hay vista de
**Semana** (lunes a domingo, todas las reservas de la semana con el
nombre del prestador en cada bloque; haz clic en el encabezado de un día
para abrirlo en la vista de día), de **Mes** y de **Lista**. Haz clic en
cualquier reserva para ver el detalle (cliente, servicio, horario,
teléfono con acceso directo a WhatsApp, correo, comentario interno) y
para **cambiar su estado** con un clic, igual que en AgendaPro.

> **"Hablar por WhatsApp" y "Llamar"**: nunca abren tu WhatsApp o
> marcador personal — "Hablar por WhatsApp" te lleva a la conversación
> en la Bandeja de entrada de NexoOmni (o, si tu WhatsApp está
> conectado con la Conexión NexoOmni y este cliente nunca ha escrito, a
> su ficha de contacto para enviarle la plantilla que abre la
> conversación, como lo exige Meta) y "Llamar" marca por NexPhone. Si ves
> un error de "WhatsApp no configurado", revisa que tu número esté
> conectado en **Configuración → WhatsApp**.

Los colores vienen precargados con los seis estados de AgendaPro y el
código de colores que ya usas:

| Color | Estado (AgendaPro) |
|---|---|
| 🔵 Azul | Reservado |
| 🟡 Amarillo | Confirmado (el cliente confirmó) |
| 🌸 Rosa | Asiste |
| 🟢 Verde | En espera |
| 🔴 Rojo | Pendiente |
| 🔴 Rojo claro | No asiste |

Puedes ajustar cualquiera de estos colores, o agregar uno nuevo, desde
**Configuración → AgendaPro → "Colores del calendario por estado"**.

Si un prestador tiene **varias sesiones al mismo tiempo** (por ejemplo,
una terapeuta con 2 o 3 pacientes en paralelo), la vista de día ya no
las encima: las muestra una junto a otra, repartiendo el ancho de la
columna entre ellas, igual que en AgendaPro. También aparece un bloque
**gris con rayas** en los horarios en los que el prestador no trabaja
ese día (fuera de su turno) y en el hueco entre dos turnos del mismo
día (su comida) — esto se calcula a partir del horario real que cada
prestador tiene configurado en AgendaPro (**Prestadores → horario**),
así que para que se vea correctamente ese horario debe estar
actualizado allá.

### 5. Filtrar por estado

Debajo de los filtros de local, servicio y prestador hay una fila de
**Estados**, con el color de cada uno. Haz clic en un estado para
ocultarlo o mostrarlo en todas las vistas (por ejemplo, ver solo las
citas "Reservado" que aún no confirman). Las citas **canceladas** vienen
ocultas por defecto; activa "Cancelado" para verlas.

### 6. Crear una cita haciendo clic en un horario libre

En la vista de **día** o de **semana**, haz clic en un espacio vacío del
calendario. Se abre "Nueva reserva" con la fecha, la hora (redondeada al
cuarto de hora) y, en la vista de día, el prestador de esa columna ya
elegidos. Solo falta escoger el contacto y el servicio: si AgendaPro
tiene libre ese horario para ese servicio, queda seleccionado solo; si
no, te avisa para que elijas otro de los horarios disponibles.

### 7. Reagendar o cancelar una cita

Haz clic en la cita y usa los botones del detalle:

- **Reagendar**: elige la nueva fecha y, si quieres, otro prestador.
  NexoOmni te muestra solo los horarios que AgendaPro tiene libres para
  ese servicio, y al confirmar mueve la cita en AgendaPro. El
  recordatorio de confirmación de 24 horas se reprograma solo para la
  nueva fecha.
- **Cancelar cita**: pide confirmación y cancela la cita en AgendaPro
  (queda con estado "Cancelado", no se borra). El horario queda libre y
  ya **no se envía** el recordatorio de confirmación.

> **Nota:** si la propia política de edición de AgendaPro restringe el
> cambio (por ejemplo, por estar muy cerca de la hora de la cita),
> AgendaPro rechaza el cambio de estado, el reagendado o la
> cancelación, y NexoOmni te lo muestra como error.

## Preguntas frecuentes

**¿Por qué no veía todas mis reservas del día?**
Si tienes muchos profesionales con agenda llena, es posible que
NexoOmni mostrara solo una parte — AgendaPro entrega las reservas en
páginas de 30, y la versión anterior solo pedía la primera. Esto ya
está corregido: NexoOmni ahora pide todas las páginas necesarias para
el rango que estás viendo.

**¿Qué pasa si el cliente responde algo distinto a SI o NO?**
NexoOmni solo reconoce variantes directas (sí, confirmo, no, cancelar,
reagendar). Cualquier otra respuesta no se interpreta automáticamente;
recepción la verá igual en el buzón de conversaciones y puede resolverla
a mano.

**¿Y si la cita se reagenda en AgendaPro?**
El recordatorio se reprograma automáticamente para 24h antes de la
nueva fecha, y el estado de confirmación vuelve a quedar pendiente.

**¿Por qué no se usan botones de "Confirmar"/"Cancelar" en la
plantilla?**
Por decisión del negocio se usa texto libre (SI/NO) en vez de botones
de respuesta rápida — más simple de leer para el cliente en un mensaje
de texto normal.

**¿Esto reemplaza al webhook de AgendaPro?**
No — el webhook sigue siendo necesario para mantener sincronizadas las
reservas (incluyendo las creadas directamente en el panel de AgendaPro,
sin pasar por NexoOmni).

## Ver también

- [Plantillas y botones de WhatsApp](../inbox/plantillas-y-botones.md)
- [Notificaciones](../notificaciones/notificaciones.md)
- [Agenda de citas (módulo interno)](../pipelines-y-citas/agenda-de-citas.md)
