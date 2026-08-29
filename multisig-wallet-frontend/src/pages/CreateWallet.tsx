import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ethers } from 'ethers'
import { getSigner, ABI, BYTECODE } from '../lib/contract'

export default function CreateWallet() {
  const navigate = useNavigate()
  const [owners, setOwners] = useState<string[]>([''])
  const [threshold, setThreshold] = useState(1)
  const [isDeploying, setIsDeploying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateOwner(index: number, value: string) {
    const next = [...owners]
    next[index] = value
    setOwners(next)
  }

  function addOwnerField() {
    setOwners([...owners, ''])
  }

  function removeOwnerField(index: number) {
    if (owners.length === 1) return
    const next = owners.filter((_, i) => i !== index)
    setOwners(next)
    if (threshold > next.length) setThreshold(next.length)
  }

  function validate(): string | null {
    const cleaned = owners.map((o) => o.trim())
    if (cleaned.some((o) => o === '')) return 'All owner fields must be filled in'
    if (cleaned.some((o) => !ethers.isAddress(o))) return 'One of the addresses is not a valid Ethereum address'
    const unique = new Set(cleaned.map((o) => o.toLowerCase()))
    if (unique.size !== cleaned.length) return 'Owner addresses must be unique'
    if (threshold < 1 || threshold > cleaned.length) return 'Threshold cannot exceed the number of owners'
    return null
  }

  async function handleDeploy() {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    setIsDeploying(true)

    try {
      const signer = await getSigner()
      const factory = new ethers.ContractFactory(ABI, BYTECODE, signer)
      const contract = await factory.deploy(owners.map((o) => o.trim()), threshold)
      await contract.waitForDeployment()

      const deployedAddress = await contract.getAddress()
      navigate(`/wallet/${deployedAddress}`)
    } catch (err: any) {
      setError(err?.reason || err?.message || 'Something went wrong while deploying')
    } finally {
      setIsDeploying(false)
    }
  }

  return (
    <div className="min-h-screen bg-graphite-900 flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl">
        <div className="mb-10">
          <p className="font-mono text-xs tracking-[0.2em] text-seal uppercase mb-3">
            New Wallet
          </p>
          <h1 className="font-display text-3xl font-semibold text-parchment mb-2">
            Set up your Multi-Sig wallet
          </h1>
          <p className="text-parchment-dim text-sm">
            Add signers and choose how many confirmations each transaction needs.
          </p>
        </div>

        <div className="space-y-3 mb-6">
          {owners.map((owner, index) => (
            <div key={index} className="flex items-center gap-3">
              <span className="font-mono text-xs text-parchment-dim w-6 shrink-0">
                {String(index + 1).padStart(2, '0')}
              </span>
              <input
                type="text"
                value={owner}
                onChange={(e) => updateOwner(index, e.target.value)}
                placeholder="0x..."
                className="flex-1 bg-graphite-800 border border-graphite-700 rounded-lg px-4 py-3 font-mono text-sm text-parchment placeholder:text-parchment-dim/50 focus:outline-none focus:border-seal transition-colors"
              />
              {owners.length > 1 && (
                <button
                  onClick={() => removeOwnerField(index)}
                  className="text-parchment-dim hover:text-danger transition-colors px-2"
                  aria-label="Remove owner"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={addOwnerField}
          className="text-seal hover:text-seal-bright text-sm font-medium mb-8 transition-colors"
        >
          + Add owner
        </button>

        <div className="mb-10 pt-6 border-t border-graphite-700">
          <label className="block font-mono text-xs tracking-[0.15em] text-parchment-dim uppercase mb-4">
            Confirmation threshold
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={1}
              max={Math.max(owners.length, 1)}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="flex-1 accent-seal"
            />
            <span className="font-mono text-lg text-seal-bright whitespace-nowrap">
              {threshold} / {owners.length}
            </span>
          </div>
          <p className="text-parchment-dim text-xs mt-2">
            Each transaction needs at least {threshold} signature{threshold > 1 ? 's' : ''} to execute.
          </p>
        </div>

        {error && (
          <div className="mb-6 px-4 py-3 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleDeploy}
          disabled={isDeploying}
          className="w-full bg-seal hover:bg-seal-bright disabled:opacity-50 disabled:cursor-not-allowed text-graphite-950 font-display font-semibold py-4 rounded-lg transition-colors"
        >
          {isDeploying ? 'Deploying...' : 'Create wallet'}
        </button>
      </div>
    </div>
  )
}