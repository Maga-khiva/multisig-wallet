import { ethers } from 'ethers'
import MultiSigWalletArtifact from '../contracts/MultiSigWallet.json'

export const ABI = MultiSigWalletArtifact.abi
export const BYTECODE = MultiSigWalletArtifact.bytecode

export function getProvider() {
  if (!window.ethereum) {
    throw new Error('MetaMask topilmadi. Iltimos, MetaMask o‘rnating.')
  }
  return new ethers.BrowserProvider(window.ethereum)
}

export async function getSigner() {
  const provider = getProvider()
  await provider.send('eth_requestAccounts', [])
  return provider.getSigner()
}

export function getWalletContract(address: string, signerOrProvider: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(address, ABI, signerOrProvider)
}