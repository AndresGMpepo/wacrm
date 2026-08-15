export type MetaProvider = 'facebook' | 'instagram'

export type MetaConnectionDiagnostic = {
  title: string
  message: string
  nextStep: string
}

export type MetaSendDiagnostic = {
  code: string
  message: string
  nextStep: string
}

/**
 * Meta returns Graph API messages intended for developers. Keep those details out
 * of the product UI and turn the common cases into a safe, actionable diagnosis.
 */
export function describeMetaConnectionError(rawError: string | null | undefined, provider: MetaProvider): MetaConnectionDiagnostic {
  const raw = (rawError ?? '').toLowerCase()
  const asset = provider === 'facebook' ? 'Página de Facebook' : 'cuenta profesional de Instagram'
  const tokenLabel = provider === 'facebook' ? 'token de acceso de la Página' : 'token de acceso de Instagram'

  if (/pages_read_engagement|page public content access|page public metadata access|missing permission|reviewable feature/.test(raw)) {
    return {
      title: 'Falta autorización de Meta',
      message: `Meta no autorizó la lectura de la ${asset}. La conexión sigue protegida; no se recibirá ni enviará información hasta corregirlo.`,
      nextStep: `Genera un ${tokenLabel} de esa misma cuenta y habilita el permiso pages_read_engagement. Si la app se usará con clientes externos, solicita en Meta el acceso avanzado o la revisión que indique la consola.`,
    }
  }

  if (/no permite acceder|no tiene acceso al id configurado/.test(raw)) {
    return {
      title: 'El token no administra este canal',
      message: `El token es válido, pero no tiene acceso a la ${asset} registrada.`,
      nextStep: `Confirma el ID numérico y reemplaza el token por un ${tokenLabel} del mismo activo.`,
    }
  }

  if (/unsupported get request|object does not exist|no existe|no encontrado|cannot be loaded/.test(raw)) {
    return {
      title: 'No se encontró el canal configurado',
      message: `Meta no pudo encontrar la ${asset} o el token no tiene acceso a ella.`,
      nextStep: `Confirma que el ID registrado sea el identificador numérico de la ${asset}, no un correo, una URL ni el ID de la app. Después usa el ${tokenLabel} de ese mismo activo.`,
    }
  }

  if (/invalid oauth|expired|access token|token.*invalid|oauth/.test(raw)) {
    return {
      title: 'Token de acceso no válido',
      message: 'Meta rechazó el token de acceso configurado.',
      nextStep: `Genera un nuevo ${tokenLabel}, guárdalo en NexoOmni y vuelve a validar la conexión.`,
    }
  }

  return {
    title: 'No se pudo validar la conexión con Meta',
    message: `Meta no autorizó el acceso a la ${asset}.`,
    nextStep: `Revisa el ID numérico y el ${tokenLabel}; ambos deben pertenecer al mismo activo en Meta.`,
  }
}

export function metaConnectionErrorText(rawError: string | null | undefined, provider: MetaProvider) {
  const diagnostic = describeMetaConnectionError(rawError, provider)
  return `${diagnostic.message} ${diagnostic.nextStep}`
}

/**
 * The Graph API error is useful in server logs, but is confusing and often
 * exposes implementation details to an agent. Keep the visible response short
 * and tell the account owner what needs to be checked in Meta.
 */
export function describeMetaSendError(
  rawError: string | null | undefined,
  provider: MetaProvider,
  isPublicComment: boolean,
): MetaSendDiagnostic {
  const raw = (rawError ?? '').toLowerCase()
  const channel = provider === 'facebook' ? 'Facebook Messenger' : 'Instagram'

  if (/24.?hour|outside.*window|message tag|standard messaging window/.test(raw)) {
    return {
      code: 'messaging_window_closed',
      message: `No se puede responder porque la ventana de atención de 24 horas de ${channel} ya terminó.`,
      nextStep: 'Pide al cliente que escriba nuevamente o utiliza una plantilla autorizada por Meta cuando aplique.',
    }
  }

  if (/pages_messaging|instagram_manage_messages|permission|missing permission|reviewable feature|not authorized/.test(raw)) {
    return {
      code: 'missing_send_permission',
      message: `Meta no autorizó a NexoOmni para enviar respuestas por ${channel}.`,
      nextStep: isPublicComment
        ? 'Revisa que el token de la página o cuenta tenga permisos de administración y de comentarios para ese activo.'
        : 'Genera nuevamente el token del activo con el permiso pages_messaging (o instagram_manage_messages) y vuelve a validar el canal.',
    }
  }

  if (/recipient.*not.*found|recipient.*invalid|cannot.*message|does not exist|unsupported get request/.test(raw)) {
    return {
      code: 'recipient_unavailable',
      message: 'Meta no reconoce al destinatario de esta conversación para enviarle un mensaje.',
      nextStep: 'Verifica que el cliente haya escrito a la página recientemente y que el canal configurado sea la misma página que recibió el mensaje.',
    }
  }

  if (/invalid oauth|expired|access token|oauth/.test(raw)) {
    return {
      code: 'invalid_access_token',
      message: `El token de acceso de ${channel} ya no es válido para enviar mensajes.`,
      nextStep: 'Actualiza el token del canal en Configuración, Facebook e Instagram, y valida la conexión.',
    }
  }

  return {
    code: 'meta_send_rejected',
    message: `Meta rechazó el envío por ${channel}. La conversación y el mensaje no se perdieron.`,
    nextStep: 'Valida la conexión del canal y revisa los permisos del token de acceso en Meta.',
  }
}
