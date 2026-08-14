export type MetaProvider = 'facebook' | 'instagram'

export type MetaConnectionDiagnostic = {
  title: string
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
