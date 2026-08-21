export function getReactionEndpoint(channelType: string | null | undefined): string {
  if (!channelType) return '/api/whatsapp/react'
  const nativeOmnichannel = channelType === 'facebook' || channelType === 'instagram' || channelType === 'zernio_whatsapp' || channelType === 'zernio_facebook' || channelType === 'zernio_instagram'
  return nativeOmnichannel ? '/api/omnichannel/react' : '/api/whatsapp/react'
}
