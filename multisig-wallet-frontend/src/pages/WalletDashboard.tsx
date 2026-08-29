import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { ethers } from 'ethers'
import { getProvider, getSigner, getWalletContract, ABI } from '../lib/contract'
import { useToast } from '../components/ToastProvider'
import { CopyableAddress } from '../components/CopyableAddress'

interface WalletInfo {
  owners: string[]
  threshold: number
  balance: string
}

interface Transaction {
  id: number
  to: string
  value: bigint
  data: string
  executed: boolean
  cancelled: boolean
  numConfirmations: bigint
  submitter: string
  isConfirmedByMe: boolean
}

export default function WalletDashboard() {
  const { address } = useParams<{ address: string }>()
  const { showToast } = useToast()

  // ============ Wallet info state ============
  const [info, setInfo] = useState<WalletInfo | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // ============ Submit transaction form state ============
  const [toAddress, setToAddress] = useState('')
  const [amount, setAmount] = useState('')
  const [txData, setTxData] = useState('0x')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // ============ Transactions list state ============
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [currentAccount, setCurrentAccount] = useState<string | null>(null)
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<'pending' | 'executed'>('pending')

  // ============ Manage owners / threshold state ============
  const [newOwnerAddress, setNewOwnerAddress] = useState('')
  const [newThreshold, setNewThreshold] = useState('')
  const [isManaging, setIsManaging] = useState(false)
  const [manageError, setManageError] = useState<string | null>(null)

  // ============ Data loading functions ============

  async function loadWalletInfo(walletAddress: string) {
    setIsLoading(true)
    setLoadError(null)
    try {
      const provider = getProvider()
      const contract = getWalletContract(walletAddress, provider)

      const [owners, threshold, balance] = await Promise.all([
        contract.getOwners(),
        contract.numConfirmationsRequired(),
        provider.getBalance(walletAddress),
      ])

      setInfo({
        owners,
        threshold: Number(threshold),
        balance: ethers.formatEther(balance),
      })
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load wallet data')
    } finally {
      setIsLoading(false)
    }
  }

  async function loadTransactions(walletAddress: string) {
    try {
      const provider = getProvider()
      const contract = getWalletContract(walletAddress, provider)

      let account: string | null = null
      try {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' })
        account = accounts[0] || null
      } catch {
        account = null
      }
      setCurrentAccount(account)

      const rawTxs = await contract.getAllTransactions()

        const parsed: Transaction[] = await Promise.all(
        rawTxs.map(async (tx: any, index: number) => {
          const isConfirmedByMe = account
            ? await contract.isConfirmed(index, account)
            : false

          return {
            id: index,
            to: tx.to,
            value: tx.value,
            data: tx.data,
            executed: tx.executed,
            cancelled: tx.cancelled,
            numConfirmations: tx.numConfirmations,
            submitter: tx.submitter,
            isConfirmedByMe,
          }
        })
      )

      setTransactions(parsed.reverse())
    } catch (err: any) {
      console.error('Failed to load transactions', err)
    }
  }

  // ============ Helpers ============

  function describeTransaction(tx: Transaction): string {
    if (tx.data === '0x' || tx.data === '') {
      return 'ETH Transfer'
    }

    try {
      const iface = new ethers.Interface(ABI)
      const parsed = iface.parseTransaction({ data: tx.data })

      if (!parsed) return 'Contract Call'

      switch (parsed.name) {
        case 'addOwner':
          return `Add Owner: ${parsed.args[0].slice(0, 6)}...${parsed.args[0].slice(-4)}`
        case 'removeOwner':
          return `Remove Owner: ${parsed.args[0].slice(0, 6)}...${parsed.args[0].slice(-4)}`
        case 'changeThreshold':
          return `Change Threshold to ${parsed.args[0].toString()}`
        case 'cancelTransaction':
          return `Cancel Tx #${parsed.args[0].toString()}`
        default:
          return `Contract Call: ${parsed.name}`
      }
    } catch {
      return 'Contract Call'
    }
  }

  // ============ Action handlers ============

  async function handleSubmitTransaction() {
    if (!address) return

    if (!ethers.isAddress(toAddress)) {
      showToast('error', 'Enter a valid recipient address')
      return
    }
    if (amount === '' || Number(amount) < 0) {
      showToast('error', 'Enter a valid amount')
      return
    }

    setIsSubmitting(true)
    try {
      const signer = await getSigner()
      const contract = getWalletContract(address, signer)

      const valueInWei = ethers.parseEther(amount || '0')
      const dataToSend = txData.trim() === '' ? '0x' : txData.trim()

      const tx = await contract.submitTransaction(toAddress, valueInWei, dataToSend)
      await tx.wait()

      showToast('success', 'Transaction submitted successfully')
      setToAddress('')
      setAmount('')
      setTxData('0x')

      await loadTransactions(address)
    } catch (err: any) {
      showToast('error', err?.reason || err?.message || 'Failed to submit transaction')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function submitOwnerChange(functionName: 'addOwner' | 'removeOwner', ownerAddress: string) {
    if (!address || !info) return
    setManageError(null)

    if (!ethers.isAddress(ownerAddress)) {
      setManageError('Enter a valid address')
      return
    }

    const isAlreadyOwner = info.owners.some(
      (o) => o.toLowerCase() === ownerAddress.toLowerCase()
    )

    if (functionName === 'addOwner' && isAlreadyOwner) {
      setManageError('This address is already an owner')
      return
    }

    if (functionName === 'removeOwner') {
      if (!isAlreadyOwner) {
        setManageError('This address is not an owner')
        return
      }
      if (info.owners.length - 1 < info.threshold) {
        setManageError(
          `Cannot remove: would leave ${info.owners.length - 1} owners, below threshold of ${info.threshold}. Lower the threshold first.`
        )
        return
      }
    }

    setManageError(null)
    setIsManaging(true)
    try {
      const signer = await getSigner()
      const contract = getWalletContract(address, signer)

      const iface = new ethers.Interface(ABI)
      const data = iface.encodeFunctionData(functionName, [ownerAddress])

      const tx = await contract.submitTransaction(address, 0, data)
      await tx.wait()

      showToast('success', `${functionName === 'addOwner' ? 'Add owner' : 'Remove owner'} transaction submitted`)
      setNewOwnerAddress('')
      await loadTransactions(address)
    } catch (err: any) {
      showToast('error', err?.reason || err?.message || `Failed to submit ${functionName}`)
    } finally {
      setIsManaging(false)
    }
  }

  async function submitThresholdChange() {
    if (!address || !info) return
    setManageError(null)

    const parsed = Number(newThreshold)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > info.owners.length) {
      setManageError(`Threshold must be between 1 and ${info.owners.length}`)
      return
    }

    if (parsed === info.threshold) {
      setManageError(`Threshold is already ${info.threshold}`)
      return
    }

    setManageError(null)
    setIsManaging(true)
    try {
      const signer = await getSigner()
      const contract = getWalletContract(address, signer)

      const iface = new ethers.Interface(ABI)
      const data = iface.encodeFunctionData('changeThreshold', [parsed])

      const tx = await contract.submitTransaction(address, 0, data)
      await tx.wait()

      showToast('success', 'Change threshold transaction submitted')
      setNewThreshold('')
      await loadTransactions(address)
    } catch (err: any) {
      showToast('error', err?.reason || err?.message || 'Failed to submit changeThreshold')
    } finally {
      setIsManaging(false)
    }
  }

  async function handleConfirm(txId: number) {
    if (!address) return
    setActionLoadingId(txId)
    try {
      const signer = await getSigner()
      const contract = getWalletContract(address, signer)
      const tx = await contract.confirmTransaction(txId)
      await tx.wait()
      showToast('success', 'Confirmed successfully')
      await loadTransactions(address)
    } catch (err: any) {
      showToast('error', err?.reason || err?.message || 'Failed to confirm')
    } finally {
      setActionLoadingId(null)
    }
  }

  async function handleExecute(txId: number) {
    if (!address) return
    setActionLoadingId(txId)
    try {
      const signer = await getSigner()
      const contract = getWalletContract(address, signer)
      const tx = await contract.executeTransaction(txId)
      await tx.wait()
      showToast('success', 'Transaction executed')
      await loadTransactions(address)
      await loadWalletInfo(address)
    } catch (err: any) {
      showToast('error', err?.reason || err?.message || 'Failed to execute')
    } finally {
      setActionLoadingId(null)
    }
  }

  async function handleRevoke(txId: number) {
    if (!address) return
    setActionLoadingId(txId)
    try {
      const signer = await getSigner()
      const contract = getWalletContract(address, signer)
      const tx = await contract.revokeConfirmation(txId)
      await tx.wait()
      showToast('success', 'Confirmation revoked')
      await loadTransactions(address)
    } catch (err: any) {
      showToast('error', err?.reason || err?.message || 'Failed to revoke')
    } finally {
      setActionLoadingId(null)
    }
  }

    async function handleCancel(txId: number) {
    if (!address) return
    setActionLoadingId(txId)
    try {
      const signer = await getSigner()
      const contract = getWalletContract(address, signer)
      const tx = await contract.cancelTransaction(txId)
      await tx.wait()
      showToast('success', 'Transaction cancelled')
      await loadTransactions(address)
    } catch (err: any) {
      showToast('error', err?.reason || err?.message || 'Failed to cancel')
    } finally {
      setActionLoadingId(null)
    }
  }

    async function proposeCancelViaMultisig(targetTxId: number) {
    if (!address) return

    setActionLoadingId(targetTxId)
    try {
      const signer = await getSigner()
      const contract = getWalletContract(address, signer)

      const iface = new ethers.Interface(ABI)
      const data = iface.encodeFunctionData('cancelTransaction', [targetTxId])

      const tx = await contract.submitTransaction(address, 0, data)
      await tx.wait()

      showToast('success', `Cancel proposal submitted for tx #${targetTxId}`)
      await loadTransactions(address)
    } catch (err: any) {
      showToast('error', err?.reason || err?.message || 'Failed to propose cancel')
    } finally {
      setActionLoadingId(null)
    }
  }

  // ============ Effects ============

  useEffect(() => {
    if (!address) return
    loadWalletInfo(address)
    loadTransactions(address)
  }, [address])

  useEffect(() => {
    if (!window.ethereum) return

    function handleAccountsChanged(accounts: string[]) {
      setCurrentAccount(accounts[0] || null)
      if (address) {
        loadTransactions(address)
      }
    }

    window.ethereum.on('accountsChanged', handleAccountsChanged)

    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged)
    }
  }, [address])

  useEffect(() => {
    if (!address) return

    const provider = getProvider()
    const contract = getWalletContract(address, provider)

    function handleUpdate() {
      loadWalletInfo(address!)
      loadTransactions(address!)
    }

    contract.on('Deposit', handleUpdate)
    contract.on('SubmitTransaction', handleUpdate)
    contract.on('ConfirmTransaction', handleUpdate)
    contract.on('RevokeConfirmation', handleUpdate)
    contract.on('ExecuteTransaction', handleUpdate)

    return () => {
      contract.removeAllListeners()
    }
  }, [address])

  useEffect(() => {
    if (!manageError) return
    const timer = setTimeout(() => setManageError(null), 8000)
    return () => clearTimeout(timer)
  }, [manageError])

  // ============ Early returns ============

  if (isLoading) {
    return (
      <div className="min-h-screen bg-graphite-900 flex items-center justify-center">
        <p className="text-parchment-dim font-mono text-sm">Loading wallet...</p>
      </div>
    )
  }

  if (loadError || !info) {
    return (
      <div className="min-h-screen bg-graphite-900 flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <p className="text-danger text-sm mb-2">{loadError || 'Wallet not found'}</p>
          <p className="text-parchment-dim text-xs font-mono">{address}</p>
        </div>
      </div>
    )
  }

  const pendingTxs = transactions.filter((tx) => !tx.executed && !tx.cancelled)
  const executedTxs = transactions.filter((tx) => tx.executed || tx.cancelled)
  const visibleTxs = activeTab === 'pending' ? pendingTxs : executedTxs

  // ============ Main render ============

  return (
    <div className="min-h-screen bg-graphite-900 px-6 py-16">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-10">
          <p className="font-mono text-xs tracking-[0.2em] text-seal uppercase mb-3">
            Multi-Sig Wallet
          </p>
          <h1 className="font-mono text-sm text-parchment-dim mb-2">
            <CopyableAddress address={address!} truncate={false} />
          </h1>
          {currentAccount && (
            <p className="font-mono text-xs text-parchment-dim">
              Connected as: <span className="text-seal-bright">{currentAccount.slice(0, 6)}...{currentAccount.slice(-4)}</span>
            </p>
          )}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4 mb-10">
          <div className="bg-graphite-800 border border-graphite-700 rounded-lg p-5">
            <p className="font-mono text-xs tracking-[0.15em] text-parchment-dim uppercase mb-2">
              Balance
            </p>
            <p className="font-display text-2xl font-semibold text-parchment">
              {parseFloat(info.balance).toFixed(4)} <span className="text-base text-parchment-dim">ETH</span>
            </p>
          </div>

          <div className="bg-graphite-800 border border-graphite-700 rounded-lg p-5">
            <p className="font-mono text-xs tracking-[0.15em] text-parchment-dim uppercase mb-2">
              Owners
            </p>
            <p className="font-display text-2xl font-semibold text-parchment">
              {info.owners.length}
            </p>
          </div>

          <div className="bg-graphite-800 border border-graphite-700 rounded-lg p-5">
            <p className="font-mono text-xs tracking-[0.15em] text-parchment-dim uppercase mb-2">
              Threshold
            </p>
            <p className="font-display text-2xl font-semibold text-seal-bright mb-3">
              {info.threshold} <span className="text-base text-parchment-dim">/ {info.owners.length}</span>
            </p>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={info.owners.length}
                value={newThreshold}
                onChange={(e) => setNewThreshold(e.target.value)}
                placeholder="New"
                className="w-16 bg-graphite-900 border border-graphite-700 rounded px-2 py-1.5 font-mono text-xs text-parchment focus:outline-none focus:border-seal transition-colors"
              />
              <button
                onClick={submitThresholdChange}
                disabled={isManaging || newThreshold === ''}
                className="text-seal hover:text-seal-bright disabled:opacity-40 text-xs font-medium transition-colors"
              >
                Change
              </button>
            </div>
          </div>
        </div>

        {/* Owners list + management */}
        <div className="mb-10">
          <p className="font-mono text-xs tracking-[0.15em] text-parchment-dim uppercase mb-4">
            Signers
          </p>
          <div className="space-y-2 mb-4">
            {info.owners.map((owner, index) => (
              <div
                key={owner}
                className="flex items-center gap-3 bg-graphite-800 border border-graphite-700 rounded-lg px-4 py-3"
              >
                <span className="font-mono text-xs text-parchment-dim w-6">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="font-mono text-sm text-parchment flex-1">
                  <CopyableAddress address={owner} truncate={false} />
                </span>
                <button
                  onClick={() => submitOwnerChange('removeOwner', owner)}
                  disabled={isManaging}
                  className="text-parchment-dim hover:text-danger disabled:opacity-40 text-xs transition-colors shrink-0"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          {manageError && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm">
              {manageError}
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newOwnerAddress}
              onChange={(e) => setNewOwnerAddress(e.target.value)}
              placeholder="0x... new owner address"
              className="flex-1 bg-graphite-800 border border-graphite-700 rounded-lg px-4 py-2.5 font-mono text-xs text-parchment placeholder:text-parchment-dim/50 focus:outline-none focus:border-seal transition-colors"
            />
            <button
              onClick={() => submitOwnerChange('addOwner', newOwnerAddress)}
              disabled={isManaging}
              className="bg-graphite-700 hover:bg-graphite-700/70 disabled:opacity-40 text-parchment text-xs font-medium px-4 py-2.5 rounded-lg transition-colors shrink-0"
            >
              + Add Owner
            </button>
          </div>
        </div>

        {/* New Transaction form */}
        <div className="mb-10 border-t border-graphite-700 pt-8">
          <p className="font-mono text-xs tracking-[0.15em] text-seal uppercase mb-4">
            New Transaction
          </p>

          <div className="space-y-4 mb-4">
            <div>
              <label className="block text-parchment-dim text-xs mb-2">Recipient</label>
              <input
                type="text"
                value={toAddress}
                onChange={(e) => setToAddress(e.target.value)}
                placeholder="0x..."
                className="w-full bg-graphite-800 border border-graphite-700 rounded-lg px-4 py-3 font-mono text-sm text-parchment placeholder:text-parchment-dim/50 focus:outline-none focus:border-seal transition-colors"
              />
            </div>

            <div>
              <label className="block text-parchment-dim text-xs mb-2">Amount (ETH)</label>
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                className="w-full bg-graphite-800 border border-graphite-700 rounded-lg px-4 py-3 font-mono text-sm text-parchment placeholder:text-parchment-dim/50 focus:outline-none focus:border-seal transition-colors"
              />
            </div>

            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-seal hover:text-seal-bright text-xs font-medium transition-colors"
            >
              {showAdvanced ? '− Hide advanced' : '+ Advanced (contract call data)'}
            </button>

            {showAdvanced && (
              <div>
                <label className="block text-parchment-dim text-xs mb-2">
                  Data (hex, leave as 0x for plain ETH transfer)
                </label>
                <input
                  type="text"
                  value={txData}
                  onChange={(e) => setTxData(e.target.value)}
                  placeholder="0x"
                  className="w-full bg-graphite-800 border border-graphite-700 rounded-lg px-4 py-3 font-mono text-sm text-parchment placeholder:text-parchment-dim/50 focus:outline-none focus:border-seal transition-colors"
                />
              </div>
            )}
          </div>

          <button
            onClick={handleSubmitTransaction}
            disabled={isSubmitting}
            className="w-full bg-seal hover:bg-seal-bright disabled:opacity-50 disabled:cursor-not-allowed text-graphite-950 font-display font-semibold py-3 rounded-lg transition-colors"
          >
            {isSubmitting ? 'Submitting...' : 'Submit Transaction'}
          </button>
        </div>

                {/* Transaction list */}
        <div className="border-t border-graphite-700 pt-8">
          <div className="flex items-center justify-between mb-4">
            <p className="font-mono text-xs tracking-[0.15em] text-seal uppercase">
              Transactions
            </p>
            <div className="flex items-center gap-1 bg-graphite-800 border border-graphite-700 rounded-lg p-1">
              <button
                onClick={() => setActiveTab('pending')}
                className={`px-3 py-1.5 rounded text-xs font-mono transition-colors ${
                  activeTab === 'pending'
                    ? 'bg-seal text-graphite-950 font-medium'
                    : 'text-parchment-dim hover:text-parchment'
                }`}
              >
                Pending {pendingTxs.length > 0 && `(${pendingTxs.length})`}
              </button>
              <button
                onClick={() => setActiveTab('executed')}
                className={`px-3 py-1.5 rounded text-xs font-mono transition-colors ${
                  activeTab === 'executed'
                    ? 'bg-seal text-graphite-950 font-medium'
                    : 'text-parchment-dim hover:text-parchment'
                }`}
              >
                Executed {executedTxs.length > 0 && `(${executedTxs.length})`}
              </button>
            </div>
          </div>

          {visibleTxs.length === 0 ? (
            <p className="text-parchment-dim text-sm">
              {activeTab === 'pending' ? 'No pending transactions.' : 'No executed transactions yet.'}
            </p>
          ) : (
            <div className="space-y-3">
              {visibleTxs.map((tx) => {
                const confirmProgress = info.threshold > 0
                  ? Number(tx.numConfirmations) / info.threshold
                  : 0
                const canExecute = Number(tx.numConfirmations) >= info.threshold && !tx.executed
                const isActionLoading = actionLoadingId === tx.id

                return (
                  <div
                    key={tx.id}
                    className="bg-graphite-800 border border-graphite-700 rounded-lg p-5"
                  >
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-xs text-parchment-dim mb-1">
                          #{tx.id} → <CopyableAddress address={tx.to} />
                        </p>
                        <p className="font-display text-lg text-parchment">
                          {ethers.formatEther(tx.value)} ETH
                        </p>
                        <p className="font-mono text-xs text-seal mt-1">
                          {describeTransaction(tx)}
                        </p>
                      </div>

                      <div className="relative w-14 h-14 shrink-0">
                        <svg viewBox="0 0 56 56" className="w-14 h-14 -rotate-90">
                          <circle
                            cx="28" cy="28" r="24"
                            fill="none"
                            stroke="var(--color-graphite-700)"
                            strokeWidth="4"
                          />
                          <circle
                            cx="28" cy="28" r="24"
                            fill="none"
                            stroke={tx.executed ? 'var(--color-success)' : 'var(--color-seal)'}
                            strokeWidth="4"
                            strokeDasharray={2 * Math.PI * 24}
                            strokeDashoffset={2 * Math.PI * 24 * (1 - Math.min(confirmProgress, 1))}
                            strokeLinecap="round"
                          />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center font-mono text-xs text-parchment">
                          {tx.numConfirmations.toString()}/{info.threshold}
                        </div>
                      </div>
                    </div>

                                        <div className="flex items-center gap-2 mt-4">
                      {tx.cancelled ? (
                        <span className="text-parchment-dim text-xs font-mono uppercase tracking-wide">
                          ✕ Cancelled
                        </span>
                      ) : tx.executed ? (
                        <span className="text-success text-xs font-mono uppercase tracking-wide">
                          ✓ Executed
                        </span>
                      ) : (
                        <>
                          {tx.isConfirmedByMe ? (
                            <button
                              onClick={() => handleRevoke(tx.id)}
                              disabled={isActionLoading}
                              className="flex-1 bg-graphite-700 hover:bg-graphite-700/70 disabled:opacity-40 disabled:cursor-not-allowed text-parchment-dim text-sm py-2 rounded-lg transition-colors"
                            >
                              {isActionLoading ? '...' : 'Revoke'}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleConfirm(tx.id)}
                              disabled={isActionLoading}
                              className="flex-1 bg-graphite-700 hover:bg-graphite-700/70 disabled:opacity-40 disabled:cursor-not-allowed text-parchment text-sm py-2 rounded-lg transition-colors"
                            >
                              {isActionLoading ? '...' : 'Confirm'}
                            </button>
                          )}
                          <button
                            onClick={() => handleExecute(tx.id)}
                            disabled={!canExecute || isActionLoading}
                            className="flex-1 bg-seal hover:bg-seal-bright disabled:opacity-40 disabled:cursor-not-allowed text-graphite-950 text-sm font-medium py-2 rounded-lg transition-colors"
                          >
                            {isActionLoading ? '...' : 'Execute'}
                          </button>
                                                    {currentAccount?.toLowerCase() === tx.submitter.toLowerCase() ? (
                            <button
                              onClick={() => handleCancel(tx.id)}
                              disabled={isActionLoading}
                              className="text-parchment-dim hover:text-danger disabled:opacity-40 text-xs px-2 transition-colors"
                              title="Cancel this transaction"
                            >
                              ✕
                            </button>
                          ) : (
                            <button
                              onClick={() => proposeCancelViaMultisig(tx.id)}
                              disabled={isActionLoading}
                              className="text-parchment-dim hover:text-danger disabled:opacity-40 text-xs px-2 transition-colors"
                              title="Propose cancelling this transaction via multisig"
                            >
                              ⊘
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}