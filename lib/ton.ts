// USDT is a token ("jetton") on the TON blockchain, not the native TON
// coin — a plain coin-transfer check (what an earlier version of this
// file did) won't see it at all. Checking a jetton transfer means reading
// TonAPI's higher-level "events" endpoint, which decodes the underlying
// token-contract call into a simple JettonTransfer action for us, instead
// of us having to parse raw contract message cells ourselves.
//
// NOTE: the exact field names TonAPI returns for a JettonTransfer action
// are documented inconsistently in different places, and this couldn't be
// tested against a live payment while writing it. If findTonPayment
// doesn't detect a real payment, check the Vercel function logs for this
// route — on a miss, the raw action JSON is logged so the field names can
// be corrected quickly. The /credit admin command in lib/bot.ts is a
// manual fallback for exactly this situation.

const TONAPI_BASE = "https://tonapi.io/v2";

// USDT (Tether) jetton master contract address on TON mainnet, in both
// representations that might come back from different tools/APIs.
const USDT_JETTON_MASTER_VARIANTS = [
  "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs",
  "0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe",
].map((a) => a.toLowerCase());

const USDT_DECIMALS = 6;

function isUsdtJetton(jettonAddress?: string): boolean {
  if (!jettonAddress) return false;
  return USDT_JETTON_MASTER_VARIANTS.includes(jettonAddress.toLowerCase());
}

interface JettonTransferDetails {
  amount?: string;
  comment?: string;
  jetton?: { address?: string };
}

async function getRecentJettonTransfers(limit = 30): Promise<JettonTransferDetails[]> {
  const address = process.env.TON_WALLET_ADDRESS;
  const apiKey = process.env.TONAPI_KEY;
  if (!address) throw new Error("TON_WALLET_ADDRESS is not set.");
  if (!apiKey) throw new Error("TONAPI_KEY is not set (free key at tonconsole.com).");

  const res = await fetch(`${TONAPI_BASE}/accounts/${encodeURIComponent(address)}/events?limit=${limit}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TonAPI error ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = await res.json();
  const transfers: JettonTransferDetails[] = [];

  for (const event of json.events ?? []) {
    for (const action of event.actions ?? []) {
      const isJettonTransfer = action.type === "JettonTransfer" || action.type === "jetton_transfer";
      if (!isJettonTransfer) continue;

      const details = action.JettonTransfer ?? action.jetton_transfer ?? {};
      transfers.push(details);
    }
  }

  return transfers;
}

/**
 * Checks recent incoming USDT transfers for one matching this memo
 * (the on-chain comment) and at least the expected amount.
 */
export async function findTonPayment(memo: string, expectedUsdtAmount: number): Promise<boolean> {
  const expectedUnits = Math.round(expectedUsdtAmount * 10 ** USDT_DECIMALS);
  const transfers = await getRecentJettonTransfers();

  let sawAnyJettonTransfer = false;
  const matched = transfers.some((t) => {
    if (!isUsdtJetton(t.jetton?.address)) return false;
    sawAnyJettonTransfer = true;
    if ((t.comment ?? "").trim() !== memo) return false;
    return Number(t.amount ?? 0) >= expectedUnits;
  });

  if (!matched && sawAnyJettonTransfer) {
    console.warn(
      "findTonPayment: saw USDT transfers but none matched memo/amount. Raw transfers:",
      JSON.stringify(transfers)
    );
  }

  return matched;
}
