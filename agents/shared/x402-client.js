// x402 HTTP Micropayment Client
// Sends EIP-3009 transferWithAuthorization signed payments to a facilitator.
// Primary agent payment happens on-chain (FeePool → devWallet).
// x402 provides an additional off-chain settlement receipt and audit trail.
//
// If X402_FACILITATOR_URL is not set, payment is skipped gracefully.
// Rebalance still executes on-chain — x402 is never blocking.

const { ethers } = require('ethers');
require('dotenv').config();

async function sendX402Payment({ amount, memo }) {
  const facilitatorUrl = process.env.X402_FACILITATOR_URL;
  if (!facilitatorUrl) {
    console.log(`[x402] No facilitator configured — skipping (${memo})`);
    return null;
  }

  const provider = new ethers.JsonRpcProvider(process.env.FUJI_RPC_URL);
  const wallet   = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);

  try {
    // Step 1: Probe facilitator — expect HTTP 402 with payment terms
    const probe = await fetch(`${facilitatorUrl}/pay`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ amount, memo, currency: 'USDC', chain: 'avalanche-fuji' }),
    });

    if (probe.status !== 402) {
      console.warn(`[x402] Expected HTTP 402, got ${probe.status} — skipping`);
      return null;
    }

    const payReq = await probe.json();
    // payReq = { recipient, nonce, deadline, amount, currency }

    // Step 2: Sign EIP-3009 transferWithAuthorization
    const domain = {
      name:              'USD Coin',
      version:           '2',
      chainId:           43113,
      verifyingContract: process.env.USDC_ADDRESS,
    };

    const types = {
      TransferWithAuthorization: [
        { name: 'from',        type: 'address' },
        { name: 'to',          type: 'address' },
        { name: 'value',       type: 'uint256' },
        { name: 'validAfter',  type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce',       type: 'bytes32' },
      ],
    };

    const msgValue = {
      from:        wallet.address,
      to:          payReq.recipient,
      value:       ethers.parseUnits(amount, 6),
      validAfter:  0,
      validBefore: payReq.deadline,
      nonce:       payReq.nonce,
    };

    const signature = await wallet.signTypedData(domain, types, msgValue);

    // Step 3: Submit with X-PAYMENT header
    const payload = Buffer.from(JSON.stringify({ ...msgValue, signature })).toString('base64');

    const result = await fetch(`${facilitatorUrl}/pay`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PAYMENT':    payload,
      },
      body: JSON.stringify({ amount, memo, currency: 'USDC', chain: 'avalanche-fuji' }),
    });

    if (result.ok) {
      const receipt = result.headers.get('X-PAYMENT-RESPONSE');
      console.log(`[x402] Payment confirmed. Receipt: ${receipt?.slice(0, 50)}...`);
      return receipt;
    } else {
      console.warn(`[x402] Payment rejected: ${result.status}`);
      return null;
    }

  } catch (err) {
    // Never throw — x402 failure must never block on-chain operations
    console.warn(`[x402] Error (non-fatal): ${err.message}`);
    return null;
  }
}

module.exports = { sendX402Payment };
