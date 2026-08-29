import { useToast } from './ToastProvider'

interface CopyableAddressProps {
  address: string
  truncate?: boolean
  className?: string
}

export function CopyableAddress({ address, truncate = true, className = '' }: CopyableAddressProps) {
  const { showToast } = useToast()

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(address)
      showToast('success', 'Address copied')
    } catch {
      showToast('error', 'Failed to copy')
    }
  }

  const display = truncate ? `${address.slice(0, 6)}...${address.slice(-4)}` : address

  return (
    <button
      onClick={handleCopy}
      title="Click to copy"
      className={`font-mono hover:text-seal-bright transition-colors cursor-pointer text-left ${className}`}
    >
      {display}
    </button>
  )
}