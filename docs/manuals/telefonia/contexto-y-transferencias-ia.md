---
title: "Contexto del recepcionista de IA al transferir"
description: "Configura Yeastar para pasar a NexPhone un resumen de la necesidad del cliente antes de transferir la llamada."
section: "telefonia"
role: ["admin", "owner"]
plan: ["premium"]
updated: "2026-10-05"
---

## ¿Qué es?

Cuando un agente contesta una llamada entrante en NexPhone, aparece la
ficha del contacto y su interacción más reciente registrada en cualquier
canal, junto al historial de Nexo Memory y los pendientes. Si el
recepcionista de IA guardó un resumen antes de transferir, también se
muestra separado del historial.

La herramienta envía un resumen, no una transcripción inventada. La
transcripción completa se recupera después de que Yeastar la publique.

## ¿Para quién es?

Administradores y propietarios que configuran el recepcionista de IA de
Yeastar. Los agentes reciben el contexto en su propia extensión de
NexPhone, sin necesitar una clave API personal.

## Cómo se configura

### 1. Preparar la conexión

- Tu cuenta debe tener telefonía Yeastar activa y extensiones asignadas
  a los agentes.
- Configura las notificaciones firmadas **30011** (estado de llamadas)
  y **30012** (fin de llamada) hacia NexoOmni.
- Comprueba los permisos OpenAPI para consultar llamadas activas y
  transcripciones.
- El recepcionista debe admitir herramientas HTTP personalizadas.
  En **P-Series Cloud Edition**, Yeastar documenta firmware
  **84.23.0.123 o superior** para esas herramientas; verifica la
  compatibilidad de tu edición.

### 2. Crear una clave exclusiva

En **Configuración → Claves API**, crea una clave llamada, por ejemplo,
`Recepcionista IA - contexto`. Activa únicamente el permiso de
**guardar contexto de llamadas** (`call-context:write`).

La clave funciona solo en la cuenta donde se creó. Guárdala como
secreto en la herramienta del PBX; no la incluyas en el prompt ni la
compartas con clientes. Puedes revocarla sin afectar otras claves.

### 3. Añadir la herramienta HTTP en Yeastar

Nombre sugerido: **`nexoomni_contexto_llamada`**.

- Método: **POST**.
- URL: `https://TU-DOMINIO/api/v1/telephony/handoff`.
- Encabezados estáticos:
  - `Authorization: Bearer TU_CLAVE_API`
  - `Content-Type: application/json`
- Parámetros del cuerpo:
  - `ai_extension`: **constante**, número real de la extensión del
    recepcionista de IA.
  - `summary`: generado por la IA; motivo, lo ya resuelto y lo pendiente,
    en dos o tres frases, máximo 800 caracteres.
  - `customer_need`: opcional, necesidad concreta, máximo 400 caracteres.
  - `next_action`: opcional, siguiente acción sugerida para el agente,
    máximo 400 caracteres.
  - `customer_phone`: opcional, teléfono internacional **exacto**, solo
    si se conoce.
  - `call_id`: opcional, identificador real del PBX, solo si está
    disponible mediante una fuente verificada. Nunca lo inventes.

Configura la extensión como `constant` y los campos de resumen como
`llm` en la herramienta. No se ha confirmado una variable automática
de Yeastar que entregue teléfono o identificador de llamada; no uses
marcadores supuestos.

Ejemplo del cuerpo que enviaría la herramienta:

```json
{
  "ai_extension": "7000",
  "summary": "La cliente necesita cambiar su terapia de mañana. Ya explicó que no puede asistir por la mañana; solicita un horario por la tarde.",
  "customer_need": "Reagendar la terapia de mañana.",
  "next_action": "Revisar disponibilidad por la tarde antes de modificar la cita."
}
```

Sustituye `7000` por tu extensión real. NexoOmni verifica la llamada
activa directamente con el PBX; no elige una llamada por su antigüedad.
Si hay varias llamadas simultáneas en la misma extensión, hace falta el
teléfono exacto del cliente o el identificador real para distinguirlas.
Si no hay una coincidencia única, rechaza el contexto en lugar de
mostrárselo al agente incorrecto.

### 4. Indicar cuándo debe ejecutarse

Añade una instrucción como esta al recepcionista:

> Antes de transferir a una persona, ejecuta
> `nexoomni_contexto_llamada`. Resume únicamente información que el
> cliente dijo durante esta llamada: necesidad, lo ya atendido y
> siguiente paso. No inventes teléfonos, identificadores o acuerdos.
> Comprueba que la respuesta contenga `data.saved = true` antes de dar
> por entregado el contexto. Si falla, no afirmes que el agente ya lo
> recibió; aplica el procedimiento de contingencia de la clínica.

Asocia esta herramienta al recepcionista y coloca su ejecución **antes
de la acción de transferencia**.

### 5. Validar una llamada de prueba

1. Llama desde un teléfono externo y explica una necesidad concreta.
2. Pide hablar con una persona.
3. Verifica en Yeastar que la herramienta devolvió
   `{"data":{"saved":true,"call_id":"..."}}`.
4. Contesta dentro de NexPhone en NexoOmni.
5. Comprueba que la ventana de contexto aparezca al entrar la llamada y
   muestre el contacto y su última interacción registrada. El resumen de
   transferencia aparece separado si la herramienta se ejecutó
   correctamente.
6. Cuelga y verifica después la transcripción y la actualización de
   Nexo Memory.

## Preguntas frecuentes

**¿Basta con actualizar NexoOmni para recibir el resumen al transferir?**
No. También debes configurar y asociar la herramienta en Yeastar.
La integración no supone que el CDR completo esté disponible en vivo.

**¿Se abre la ventana en un teléfono físico o en Linkus?**
No. Esta ventana está integrada en NexPhone dentro de NexoOmni.

**¿Qué pasa si el cliente no existe todavía en Contactos?**
La ventana avisa que el número aún no está registrado y recomienda
solicitar el nombre y datos del cliente para darlo de alta en Contactos.
No muestra historial de otra persona ni espera a que finalice la llamada
para mostrar contexto de interacciones anteriores.

## Ver también

- [NexPhone](./nexphone-softphone.md)
- [Transcripción y análisis](../supervision-y-reportes/transcripcion-de-llamadas.md)
- [Claves API](../integraciones/claves-api.md)

### Referencias oficiales de compatibilidad

- [Consulta de transcripción de IA](https://help.yeastar.com/en/p-series-cloud-edition/developer-guide/get-ai-call-transcript.html)
- [Consulta de llamadas activas](https://help.yeastar.com/en/p-series-cloud-edition/developer-guide/query-calls.html)
- [Herramientas del recepcionista](https://help.yeastar.com/en/p-series-cloud-edition/ai-guide/tool-overview.html)
- [Configuración manual de una herramienta](https://help.yeastar.com/en/p-series-cloud-edition/ai-guide/add-a-tool-manually.html)
