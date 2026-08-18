import PayStatus from "@/components/PayStatus";

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const walletAddress = process.env.TON_WALLET_ADDRESS ?? "";
  return <PayStatus orderId={id} walletAddress={walletAddress} />;
}
